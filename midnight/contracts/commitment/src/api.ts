// QUORUM — wallet, providers, and circuit calls for the commitment contract.
//
// Adapted from midnightntwrk/example-counter's counter-cli/src/api.ts (fetched from
// https://raw.githubusercontent.com/midnightntwrk/example-counter/main/counter-cli/src/api.ts,
// full copy kept at midnight/reference/counter-example-api.ts for reference). The wallet
// construction, provider wiring, and dust-registration plumbing are generic midnight-js
// boilerplate and port with no logic changes — only the contract-specific pieces
// (compiled contract reference, circuit calls, ledger read) are Quorum's.
//
// VERIFIED END TO END against a live contract on Midnight Preview: deploy, director
// registration and confirmation, loan origination, a refused write-off and a committed
// one. Reproduce with `node scripts/midnight-smoke.mjs`. bridge.ts is the only consumer.

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { WalletFacade, type FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import {
  type CommitmentCircuits,
  type CommitmentContract,
  type CommitmentProviders,
  type DeployedCommitmentContract,
} from './common-types.js';
import { currentDir, type Config, contractConfig } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js/utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { Contract as CommitmentContractClass } from './managed/commitment/contract/index.js';
import { ledger as commitmentLedger, type Ledger as CommitmentLedger } from './managed/commitment/contract/index.js';
import { commitmentPrivateStateId, createCommitmentWitnesses, type CommitmentPrivateState } from './witnesses.js';

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// withVacantWitnesses (what the counter example uses) installs an EMPTY witness
// object. The counter has no witnesses so that is fine there; this contract has
// three, and vacant witnesses fail at the first circuit call with
//   CompactError: first (witnesses) argument to Contract constructor does not
//   contain a function-valued field named callerRole
// which is thrown at deploy time, after the wallet has already synced.
const commitmentCompiledContract = CompiledContract.make('commitment', CommitmentContractClass).pipe(
  CompiledContract.withWitnesses(createCommitmentWitnesses()),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

export const commitmentContractInstance: CommitmentContract = new CommitmentContractClass(createCommitmentWitnesses());

// --------------------------------------------------------------------------
//  Ledger reads
// --------------------------------------------------------------------------

export const getCommitmentLedgerState = async (
  providers: CommitmentProviders,
  contractAddress: ContractAddress,
): Promise<CommitmentLedger | null> => {
  assertIsContractAddress(contractAddress);
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  return state != null ? commitmentLedger(state.data) : null;
};

// --------------------------------------------------------------------------
//  Deploy / join
// --------------------------------------------------------------------------

export const joinContract = async (
  providers: CommitmentProviders,
  contractAddress: string,
  privateState: CommitmentPrivateState,
): Promise<DeployedCommitmentContract> =>
  findDeployedContract(providers, {
    contractAddress,
    compiledContract: commitmentCompiledContract,
    privateStateId: commitmentPrivateStateId,
    initialPrivateState: privateState,
  });

/** Genesis parameters for the contract's constructor. */
export interface GenesisConfig {
  rescheduleCapOccasions: bigint;
  boardEscalationFromAttempt: bigint;
  boardThresholdK: bigint;
  councilQuorum: bigint;
}

export const deploy = async (
  providers: CommitmentProviders,
  privateState: CommitmentPrivateState,
  genesis: GenesisConfig,
): Promise<DeployedCommitmentContract> =>
  deployContract(providers, {
    compiledContract: commitmentCompiledContract,
    privateStateId: commitmentPrivateStateId,
    initialPrivateState: privateState,
    args: [
      genesis.rescheduleCapOccasions,
      genesis.boardEscalationFromAttempt,
      genesis.boardThresholdK,
      genesis.councilQuorum,
    ],
  });

// --------------------------------------------------------------------------
//  Circuit calls — one per exported circuit in commitment.compact
// --------------------------------------------------------------------------

export const originateLoan = async (
  contract: DeployedCommitmentContract,
  commitmentId: Uint8Array,
  initialTier: number,
  payloadHash: Uint8Array,
): Promise<FinalizedTxData> => {
  const tx = await contract.callTx.originateLoan(commitmentId, initialTier, payloadHash);
  return tx.public;
};

export const appendEvent = async (
  contract: DeployedCommitmentContract,
  commitmentId: Uint8Array,
  eventType: number,
  tierAfter: number,
  prevStateHash: Uint8Array,
  payloadHash: Uint8Array,
): Promise<FinalizedTxData> => {
  const tx = await contract.callTx.appendEvent(commitmentId, eventType, tierAfter, prevStateHash, payloadHash);
  return tx.public;
};

export const registerDirector = async (
  contract: DeployedCommitmentContract,
  institution: number,
  keyId: Uint8Array,
  publicKeyCommitment: Uint8Array,
): Promise<FinalizedTxData> => {
  const tx = await contract.callTx.registerDirector(institution, keyId, publicKeyCommitment);
  return tx.public;
};

export const confirmDirector = async (
  contract: DeployedCommitmentContract,
  institution: number,
  keyId: Uint8Array,
): Promise<FinalizedTxData> => {
  const tx = await contract.callTx.confirmDirector(institution, keyId);
  return tx.public;
};

export const revokeDirector = async (
  contract: DeployedCommitmentContract,
  institution: number,
  keyId: Uint8Array,
): Promise<FinalizedTxData> => {
  const tx = await contract.callTx.revokeDirector(institution, keyId);
  return tx.public;
};

export const setRegulatoryConfig = async (
  contract: DeployedCommitmentContract,
  next: { rescheduleCapOccasions: bigint; boardEscalationFromAttempt: bigint; boardThresholdK: bigint; councilQuorum: bigint },
): Promise<FinalizedTxData> => {
  const tx = await contract.callTx.setRegulatoryConfig(next);
  return tx.public;
};

// ══════════════════════════════════════════════════════════════════════════
//  Everything below is unmodified wallet/provider plumbing, ported from the
//  counter example (see file header). It has nothing to do with the
//  commitment contract specifically — it is what any Quorum contract module
//  (exposure, claims) will also need, so it belongs here rather than being
//  re-derived per contract.
// ══════════════════════════════════════════════════════════════════════════

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );
    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (ctx: WalletContext): Promise<WalletProvider & MidnightProvider> => {
  // The coin/encryption public keys are derived from the secret keys, so the first
  // emitted state already carries them - no need to block on a full sync here.
  const state = await Rx.firstValueFrom(ctx.wallet.state());
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

// Deploying only spends unshielded NIGHT (and the DUST it generates) for fees, so
// those are the only two wallets that have to be caught up. The facade's own
// `isSynced` also ANDs in the shielded/Zswap wallet, whose first-time scan walks the
// whole Preprod history and exhausted a 6GB heap around index 83k without ever
// reporting a target height. Gating on the two wallets the deploy actually reads
// lets it proceed while that scan is still running in the background.
// isCompleteWithin measures the gap between appliedIndex and *highestRelevantWalletIndex*
// (unshielded: appliedId vs highestTransactionId) — not the highestIndex the heartbeat
// used to print. Strict equality against a chain that keeps advancing is racy, so this
// keeps the SDK's own default tolerance; the real go/no-go is the DUST balance check
// that follows, which only passes once fees are actually payable.
const SYNC_GAP = 50n;

const feeWalletsSynced = (state: FacadeState): boolean =>
  state.unshielded.progress.isCompleteWithin(SYNC_GAP) && state.dust.progress.isCompleteWithin(SYNC_GAP);

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        // No isSynced=true event may arrive for minutes on a fresh wallet's first
        // sync against Preprod — without this the process looks hung. progress
        // tracks index-in-chain, not a percentage, but a climbing number (or a
        // stalled one) is the difference between "working" and "actually stuck".
        //
        // The two wallets report progress under different field names: shielded
        // uses appliedIndex/highestIndex, unshielded appliedId/highestTransactionId.
        // Both are logged because either one lagging holds back isSynced.
        const sh = state.shielded.progress;
        const un = state.unshielded.progress;
        const du = state.dust.progress;
        console.log(
          `  syncing... unshielded=${un.appliedId}/${un.highestTransactionId} ` +
            `dust=${du.appliedIndex}/${du.highestRelevantWalletIndex} ` +
            `shielded=${sh.appliedIndex}/${sh.highestRelevantWalletIndex} (not required) ` +
            `feeWalletsSynced=${feeWalletsSynced(state)}`,
        );
      }),
      Rx.filter(feeWalletsSynced),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter(feeWalletsSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

// The shielded wallet replays every ledger event from genesis on a first sync, and
// the SDK's default batching walks Preprod at ~80 events/s — roughly five hours, and
// it exhausted a 6GB heap long before finishing. Pulling the stream in large batches
// took the same scan to ~14,000/s with resident memory flat around 340MB. This single
// number is the difference between "cannot sync at all" and "synced in ~2 minutes".
const SHIELDED_SYNC_BATCH = 5_000;

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
  batchSize: SHIELDED_SYNC_BATCH,
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet from seed');
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const formatBalance = (balance: bigint): string => balance.toLocaleString();

const registerForDustGeneration = async (wallet: WalletFacade, unshieldedKeystore: UnshieldedKeystore): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter(feeWalletsSynced)));
  if (state.dust.availableCoins.length > 0) return;

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter(feeWalletsSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    );
    return;
  }

  const recipe = await wallet.registerNightUtxosForDustGeneration(
    nightUtxos,
    unshieldedKeystore.getPublicKey(),
    (payload) => unshieldedKeystore.signData(payload),
  );
  const finalized = await wallet.finalizeRecipe(recipe);
  await wallet.submitTransaction(finalized);

  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter(feeWalletsSynced),
      Rx.filter((s) => s.dust.balance(new Date()) > 0n),
    ),
  );
};

/** Build (or restore) a wallet from a hex seed; wait for sync and funds. */
/**
 * Where a synced wallet's state is cached between runs.
 *
 * Re-syncing from genesis costs tens of minutes (see SHIELDED_SYNC_BATCH and the
 * DUST notes in README.md), and every restart of the bridge or a redeploy would
 * otherwise pay it again. The cached state resumes from its own offset and catches
 * up from there. Delete the file to force a clean re-sync.
 *
 * Gitignored: it is derived from the wallet seed and should be treated as secret.
 */
const walletCacheFile = (config: Config): string =>
  path.resolve(currentDir, '..', `.wallet-cache.${networkOf(config)}.json`);

const networkOf = (config: Config): string =>
  config.indexer.includes('preview') ? 'preview' : config.indexer.includes('preprod') ? 'preprod' : 'standalone';

interface WalletCache {
  shielded?: string;
  dust?: string;
}

const readWalletCache = (config: Config): WalletCache => {
  try {
    return JSON.parse(readFileSync(walletCacheFile(config), 'utf8')) as WalletCache;
  } catch {
    return {};
  }
};

const writeWalletCache = (config: Config, state: FacadeState): void => {
  try {
    writeFileSync(
      walletCacheFile(config),
      JSON.stringify({ shielded: state.shielded.serialize(), dust: state.dust.serialize() }),
    );
  } catch (err) {
    // A cache that cannot be written costs time on the next run, nothing more.
    console.warn(`  (could not cache wallet state: ${(err as Error).message})`);
  }
};

export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const walletConfig = {
    ...buildShieldedConfig(config),
    ...buildUnshieldedConfig(config),
    ...buildDustConfig(config),
  };

  const cache = readWalletCache(config);
  if (cache.shielded && cache.dust) {
    console.log('Resuming from cached wallet state (delete .wallet-cache.*.json to re-sync from genesis).');
  }

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) =>
      cache.shielded
        ? ShieldedWallet(cfg).restore(cache.shielded)
        : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      cache.dust
        ? DustWallet(cfg).restore(cache.dust)
        : DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  console.log(`Unshielded address (fund via faucet): ${unshieldedKeystore.getBech32Address()}`);
  console.log(`Faucet: https://faucet.${networkOf(config)}.midnight.network/`);

  const syncedState = await waitForSync(wallet);
  writeWalletCache(config, syncedState);
  const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  if (balance === 0n) {
    console.log('Waiting for incoming tokens...');
    const funded = await waitForFunds(wallet);
    console.log(`Balance: ${formatBalance(funded)} tNight`);
  }

  await registerForDustGeneration(wallet, unshieldedKeystore);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const buildFreshWallet = async (config: Config): Promise<WalletContext> => {
  const seed = toHex(Buffer.from(generateRandomSeed()));
  console.log(`New wallet seed (save this): ${seed}`);
  return buildWalletAndWaitForFunds(config, seed);
};

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<CommitmentProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<CommitmentCircuits>(contractConfig.zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<typeof commitmentPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};
