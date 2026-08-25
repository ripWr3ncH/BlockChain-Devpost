// Entry point: deploy the commitment contract to Preprod using a seed from
// the MIDNIGHT_WALLET_SEED env var (generates + prints a fresh one if unset —
// save it, it will not be shown again).
//
// Usage:
//   MIDNIGHT_WALLET_SEED=<hex seed> npm run deploy:preprod
//
// Requires the local proof server running first:
//   docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v

import { inspect } from 'node:util';
import { PreprodConfig } from './config.js';
import { buildFreshWallet, buildWalletAndWaitForFunds, configureProviders, deploy } from './api.js';
import { commitmentPrivateStateId, type CommitmentPrivateState } from './witnesses.js';

async function main() {
  const config = new PreprodConfig();

  const seed = process.env.MIDNIGHT_WALLET_SEED;
  const walletCtx = seed ? await buildWalletAndWaitForFunds(config, seed) : await buildFreshWallet(config);

  const providers = await configureProviders(walletCtx, config);

  const initialPrivateState: CommitmentPrivateState = {
    callerRole: 3, // CENTRAL_AUTHORITY deploys and holds the genesis role for governance bootstrap
    pendingBoardSignatures: {},
  };

  const contract = await deploy(providers, initialPrivateState);
  console.log(`Deployed commitment contract at: ${contract.deployTxData.public.contractAddress}`);
  console.log(`Private state id: ${commitmentPrivateStateId}`);
}

// The Midnight SDK throws "effect" library tagged errors — plain objects with a
// custom Node inspect symbol and a null prototype — which Node's default top-level
// uncaught-exception printer renders as an unreadable stub. Catch explicitly and
// force the real inspect output so failures are actually diagnosable.
main().catch((err) => {
  console.error('Deploy failed:\n' + inspect(err, { depth: 10, colors: false, customInspect: true }));
  process.exitCode = 1;
});
