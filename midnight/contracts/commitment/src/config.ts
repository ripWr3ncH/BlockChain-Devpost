// Adapted near-verbatim from midnightntwrk/example-counter's counter-cli/src/config.ts
// (fetched from https://raw.githubusercontent.com/midnightntwrk/example-counter/main/counter-cli/src/config.ts,
// see midnight/reference/counter-example-config.ts) — this boilerplate is network/wallet
// plumbing, not counter-specific, so it ports with only the contract name changed.

import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

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
