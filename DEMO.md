# Verity — demo runbook (Midnight)

**Written against the system as it actually is**, not as it was planned. Where something
is not verified, it says so.

This replaces the Hyperledger Fabric runbook that preceded the Midnight port. The Fabric
stack still exists in the repository (`network/`, `chaincode/`, `services/api/`) but is
**not** what this demo runs on.

**Target: 5 minutes.** One driver holds the mouse throughout.

---

## 0. Before you start

Do this well before you record. The wallet sync is the long pole.

```bash
# 1. Proof server (leave running)
docker run -d --name verity-proof-server -p 6300:6300 \
  midnightntwrk/proof-server:8.1.0 midnight-proof-server -v

# 2. Bridge — syncs the wallet, then serves circuit calls
cd midnight/contracts/commitment
MIDNIGHT_NETWORK=preview MIDNIGHT_WALLET_SEED=$MIDNIGHT_WALLET_SEED npm run bridge

# 3. Front end
npm --prefix web run dev
```

**The first sync replays the whole ledger and takes tens of minutes.** It writes
`.wallet-cache.preview.json` when it finishes, so every later start is fast. Do the first
run the day before, not fifteen minutes before recording.

Sanity-check the whole path before you start talking:

```bash
node scripts/midnight-smoke.mjs
```

It must print `PASSED`. If it prints that the write-off committed with zero approvals,
**stop** — the board threshold is not being enforced and the demo's central claim is
false. Do not record around it.

---

## 1. The frame (45 seconds)

Open <http://localhost:3000>.

> "A supervisor's rules are usually not what's missing. Classification already needs two
> named signatures. Rescheduling is already capped. The later attempts already need board
> approval. What's missing is the *record* — it's held by the bank being examined, it can
> be edited afterwards, and it's read once a year when an inspector shows up."

> "One asset quality review of six banks found about four times the bad loans the banks
> had reported."

Then the turn to Midnight:

> "The obvious fix — put the approvals on a chain — has a problem. A bank's board
> approving a write-off is commercially sensitive. Publishing every director's signature
> to prove you had authorisation is a bad trade. That's the part Midnight changes."

---

## 2. The contract is real (30 seconds)

Go to `/midnight`. Point at the **Deployed contract** card.

> "That's a live contract address on Midnight Preview. Board threshold, reschedule cap —
> those aren't constants compiled in, they're ledger state the council governs."

Have `deployment.preview.json` open in a second tab if you want to show provenance.

---

## 3. Constitute a board (45 seconds)

Click **Register + confirm a director** twice.

> "A director registers a *commitment* to a secret — not the secret. And notice this takes
> two different parties: the bank registers its own directors, but only the Central
> Authority can confirm them. A bank that could confirm its own board could approve its own
> write-offs, so the contract refuses it."

---

## 4. Originate, then the refusal (2 minutes — this is the demo)

Click **Originate**. One receipt.

Set **Director approvals to supply** to `0`. Click **Submit write-off**.

> "Write-off needs board authorisation. I'm submitting it with none."

The circuit refuses:

```
⛔ CIRCUIT REFUSED
board authorisation required: insufficient confirmed director signatures
```

**Say the important sentence:**

> "That refusal did not come from the page. The page happily sent it. It came from the
> *proof* — the circuit counted the valid director approvals, got zero, and the transaction
> could not be constructed. There's no front-end check to bypass."

Now set approvals to `2` and submit again. It commits, with a receipt.

> "Same submission, same loan, now with two director approvals — committed."

Then land the point the whole port was for:

> "Here's what did *not* happen. Those directors' credentials were never published. They
> went in as a private witness. What reached the chain is that *enough* registered,
> confirmed, non-revoked, distinct directors approved — the count, and nothing else. The
> supervisor gets the guarantee; the bank doesn't have to publish its board's keys."

---

## 5. What we are not claiming (30 seconds)

Say this out loud. It is worth more than another feature.

> "Two honest limits. The approval proves knowledge of a registered commitment — it isn't
> a signature over this specific event, so a bank holding a director's secret could reuse
> it for a later vote. And director *identities* are still public, because looking one up
> in a public map needs a public key. What we bought is credential secrecy, not voter
> anonymity. Both are written down in the README."

---

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| `BRIDGE UNREACHABLE` on the page | bridge not running, or still syncing | check the bridge terminal; a climbing `dust=` means it is working, not hung |
| Every circuit call refused | wrong `callerRole` for that circuit | the bridge sets it per endpoint; check `asRole` in `bridge.ts` |
| `state divergence: append-only chain broken` | stale `prevStateHash` | re-read `GET /loans/:id`; the page does this automatically |
| Write-off commits with 0 approvals | contract deployed without genesis params | `boardThresholdK` is 0 — redeploy; see the constructor note in the contract README |
| Proof server errors | container not up | `docker ps`; restart it |

---

## Recording notes

- Record the smoke test passing in a terminal as a cutaway — it is the most compact
  evidence that the refusal is real.
- Do not speed up the proving step in post without saying so. It takes as long as it takes.
- All data on screen is synthetic. The banner says so; leave it visible.
