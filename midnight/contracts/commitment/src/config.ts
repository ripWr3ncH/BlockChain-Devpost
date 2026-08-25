// Adapted near-verbatim from midnightntwrk/example-counter's counter-cli/src/config.ts
// (fetched from https://raw.githubusercontent.com/midnightntwrk/example-counter/main/counter-cli/src/config.ts,
// see midnight/reference/counter-example-config.ts) — this boilerplate is network/wallet
// plumbing, not counter-specific, so it ports with only the contract name changed.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

// fileURLToPath, NOT `new URL(...).pathname`. On Windows the pathname of a file URL
// keeps a leading slash — "/G:/…/src/config.ts" — and path.resolve then reads that as
// relative to the drive root, producing "G:\G:\…\src". Everything derived from
// currentDir (the zk config path, the deployment file, the wallet cache) silently
// points at a directory that does not exist. The symptom is a long way from the cause:
// the deploy syncs for half an hour and then fails with
//   ZKConfigurationReadError: Failed to read verifier key for commitment#originateLoan
// even though the key is sitting on disk exactly where it should be.
export const currentDir = path.resolve(fileURLToPath(import.meta.url), '..');

export const contractConfig = {
  privateStateStoreName: 'commitment-private-state',
  zkConfigPath: path.resolve(currentDir, 'managed', 'commitment'),
};

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class StandaloneConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone', `${new Date().toISOString()}.log`);
  indexer = 'http://127.0.0.1:8088/api/v3/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v3/graphql/ws';
  node = 'http://127.0.0.1:9944';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('undeployed');
  }
}

export class PreviewConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'preview', `${new Date().toISOString()}.log`);
  indexer = 'https://indexer.preview.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preview.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('preview');
  }
}

export class PreprodConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod', `${new Date().toISOString()}.log`);
  indexer = 'https://indexer.preprod.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('preprod');
  }
}

export type NetworkName = 'preview' | 'preprod' | 'standalone';

/**
 * Which testnet to talk to. Defaults to Preview, and that default is a measured
 * choice rather than a preference: a first-time wallet sync replays the whole
 * ledger, and at the time of writing Preview's stream is ~151k events against
 * Preprod's ~1.45M. The DUST wallet's sync is the binding constraint — the SDK
 * hardcodes its batch size at 10 events per tick, so it moves at ~150 events/s no
 * matter what, which is ~17 minutes on Preview and over nine hours on Preprod.
 * The competition rules accept either network.
 */
export const configFor = (network: NetworkName = 'preview'): Config => {
  switch (network) {
    case 'preprod':
      return new PreprodConfig();
    case 'standalone':
      return new StandaloneConfig();
    case 'preview':
      return new PreviewConfig();
  }
};

export const networkFromEnv = (): NetworkName => {
  const raw = (process.env.MIDNIGHT_NETWORK ?? 'preview').toLowerCase();
  if (raw === 'preview' || raw === 'preprod' || raw === 'standalone') return raw;
  throw new Error(`MIDNIGHT_NETWORK must be preview|preprod|standalone, got "${raw}"`);
};
