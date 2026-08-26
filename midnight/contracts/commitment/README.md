# Commitment contract — build status

**Deployed and verified on Midnight Preview.**
Contract: `08b5b8b1bb403524b1066615752512019714a64859f77bea868f8615fe0f51da`
Both authority rules confirmed live: the same write-off was refused with 0 director
approvals and committed with 2 (block 586223), and the same restructure was refused at the
sanctioning grade and committed one grade above it (block 586236). Neither the director
secrets nor the officer's grade reached the ledger.
Reproduce with `node scripts/midnight-smoke.mjs`.

`src/commitment.compact` compiles cleanly against `compact 0.31.1` (language version 0.23),
verified by rebuilding the toolchain from scratch under WSL Ubuntu:

```
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1
compact compile src/commitment.compact src/managed/commitment
```

Output: 6 circuits (`originateLoan`, `appendEvent`, `registerDirector`, `confirmDirector`,
`revokeDirector`, `setRegulatoryConfig`) with prover/verifier keys and zkir under
`src/managed/commitment/`. `contract/index.js` + `.d.ts` are the generated TypeScript
contract binding for `services/api`.

### Toolchain gotchas hit rebuilding this

- **`compact update` shells out to `unzip`**, which this WSL image does not ship, and
  `sudo` needs a password. Symptom: `Failed to spawn artifact extraction command`. Worked
  around with a `python3 -m zipfile` shim on `$PATH` at `~/.local/bin/unzip` that also
  restores each entry's mode from `external_attr` — plain `extractall` drops the exec bit
  and the extracted `compactc` will not run.
- **Pin the compiler to 0.31.1, not `latest`.** `compact update` with no argument now
  installs 0.34.0, which speaks language version 0.26 and rejects this contract's
  `pragma language_version 0.23` outright (`language version 0.26.0 mismatch`). More
  importantly the whole installed `@midnight-ntwrk/*` tree dedupes on
  `compact-runtime@0.16.0`, which is exactly what 0.31.1 emits — `contract-info.json`
  records `"runtime-version": "0.16.0"`. Upgrading the compiler means re-checking that pin.
- If a version directory already exists but the compile fails with
  `Expecting a file: .../compactc`, the artifact downloaded but never unpacked. Extract
  `artifact.zip` in place; `compact update` skips extraction when it thinks the version is
  already installed.

## API/deploy layer

`src/{witnesses,config,common-types,api,deploy}.ts` wire the compiled contract up to
midnight-js: wallet construction, provider bundle (privateState/publicData/zkConfig/proof/
wallet/midnight providers), deploy/join, and one function per circuit. The wallet/provider
plumbing in `api.ts` is adapted near-verbatim from the real, working
`midnightntwrk/example-counter` reference app (copy kept under `midnight/reference/`,
fetched from GitHub) — only the contract-specific parts are Quorum's.

`npx tsc --noEmit -p tsconfig.json` passes with **zero type errors** against the actual
installed packages. Note that `tsconfig.json` is new: the package had none, so an earlier
bare `npx tsc --noEmit` was printing its help text and exiting 0 without checking anything.
With a real config in place it immediately surfaced two genuine bugs in the sync heartbeat
(`appliedIndex`/`highestIndex` do not exist on the unshielded wallet's `SyncProgress` —
that one uses `appliedId`/`highestTransactionId`).

### Wallet sync — the thing that actually blocked deployment

A first-time wallet sync against Preprod replays every ledger event from genesis
(~1.45M at the time of writing). Two independent problems, both now fixed in `api.ts`:

1. **Throughput.** The SDK's default batching walked the shielded stream at ~80 events/s —
   about five hours — and exhausted a 6GB heap around index 83k before finishing. The
   shielded wallet's sync configuration accepts a `batchSize`; setting it to 5,000 took the
   same scan to **~14,000 events/s with resident memory flat near 340MB**, i.e. the full
   history in roughly two minutes. This one number is the difference between "cannot sync
   at all" and "syncs in about the time it takes to read this paragraph".
2. **What "synced" means.** `FacadeState.isSynced` ANDs all three wallets. Deploying only
   spends unshielded NIGHT and the DUST it generates, so `api.ts` now gates on those two
   (`feeWalletsSynced`) and lets the shielded scan finish in the background. Note the
   completion predicate compares `appliedIndex` against **`highestRelevantWalletIndex`**,
   not `highestIndex` — `highestIndex` reads 0 until the stream reports a target, which is
   why an earlier heartbeat made a working sync look stalled.

Restoring a wallet at a non-zero `offset` (present in the serialized state) to skip history
**does not work**: the commitment trees must be built linearly, and the ledger rejects it
with `values inserted non-linearly into dust commitment tree; expected to insert index 0`.

### Wallet state is cached between runs

After a successful sync, `api.ts` writes `.wallet-cache.<network>.json` (gitignored,
derived from the seed — treat as secret) and restores from it next time. Without this,
every bridge restart and every redeploy pays the full historical sync again. Delete the
file to force a clean re-sync.

To get a funded wallet: create one (the seed can be freshly generated by
`deploy.ts` itself if `MIDNIGHT_WALLET_SEED` is unset — it will print and wait), then fund
its unshielded address via the Preprod faucet at **https://faucet.preprod.midnight.network/**.

### Four bugs that only surface at run time

None of these are caught by type-checking, and the first three fail *after* the wallet has
spent tens of minutes syncing — so they are expensive to discover. `preflight.ts` now
front-loads the checks that can be made cheaply.

- **`withVacantWitnesses` installs an empty witness object.** The counter example this
  layer was adapted from has no witnesses, so it is correct there. This contract has
  three, and the mismatch throws
  `CompactError: first (witnesses) argument to Contract constructor does not contain a
  function-valued field named callerRole`. Use `CompiledContract.withWitnesses(...)`.
- **Windows file URLs break every derived path.** `new URL(import.meta.url).pathname`
  keeps a leading slash on Windows, so `path.resolve` reads it as relative to the drive
  root and yields `G:\G:\…`. The zk config path, the deployment file and the wallet cache
  all silently pointed at a directory that does not exist, and the deploy died half an hour
  in with `ZKConfigurationReadError: Failed to read verifier key for commitment#originateLoan`
  while the key sat on disk exactly where it belonged. Use `fileURLToPath`.
- **Two installs of `onchain-runtime-v3` break `instanceof`, even at the same version.**
  Two installs means two wasm instantiations, so a `StateValue` built by one is not an
  instance of the other's class. Symptom: a bare `expected instance of StateValue` from
  inside a transaction merge. `npm ls @midnight-ntwrk/onchain-runtime-v3` must show a single
  *hoisted* copy — an `overrides` entry that merely aligns the version still leaves two
  nested installs. It is now a direct dependency so npm hoists it.
  (And when testing this: actually restart the process. A stale bridge holds the old modules
  in memory and will keep reproducing a bug you have already fixed.)
- **A contract with no constructor starts every ledger field at zero.** Here that meant
  `councilMembers` was empty, so `setRegulatoryConfig` could never satisfy its own
  membership check, so `config` could never be set — leaving `boardThresholdK` at 0
  forever, which makes `validCount >= 0` trivially true. The board threshold would have
  been unenforceable while still looking enforced. The constructor now seeds the
  parameters, the council, and the central authority at genesis.

## Board threshold — now a real k-of-n check

`verifyBoardThreshold` used to hardcode `validCount = 0`, which meant every
board-authorised transition (`WRITE_OFF`, a third-plus reschedule, an upgrade out of a
classified tier) asserted `0 >= boardThresholdK` and could **never** commit. It now:

- takes up to 4 approval slots from the `boardSignatures` witness plus their director key
  ids from a new `boardKeyIds` witness;
- for each slot looks the director up in the `directors` ledger map and counts it only if
  the record is confirmed, not revoked, and `persistentHash([secret])` equals the
  registered `publicKeyCommitment`;
- rejects duplicate directors pairwise, so one director cannot fill several slots;
- discloses only the resulting count, never the secrets.

**What this does and does not prove.** It proves knowledge of the preimage of a registered
commitment, so a director's credential never appears on-chain — a real improvement over the
Fabric version, which put every signature in the cleartext transaction argument. It is
*not* a signature over the event: a bank that has collected a director's secret once could
reuse it for a later vote without asking again. Binding an approval to a specific event
needs a per-event registration step this registry does not model yet.

Director *identities* are still disclosed, because looking a director up in a public ledger
`Map` requires a public key. What the ZK layer buys here is credential secrecy, not voter
anonymity.

## Known gaps before this is submission-ready

- Board approvals are replayable across events (see above).
- `exposure` and `claims` contracts (the other two Fabric channels) are not yet ported.
- `services/api` still talks to the Fabric gateway; nothing imports `api.ts` yet.
