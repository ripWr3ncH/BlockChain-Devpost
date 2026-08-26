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
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { configFor, currentDir, networkFromEnv } from './config.js';
import { buildFreshWallet, buildWalletAndWaitForFunds, configureProviders, deploy } from './api.js';
import { commitmentPrivateStateId, type CommitmentPrivateState } from './witnesses.js';
import { preflight } from './preflight.js';

async function main() {
  const network = networkFromEnv();
  const config = configFor(network);
  console.log(`Deploying to Midnight ${network}`);

  // Before the long sync, not after it.
  await preflight(config);

  const seed = process.env.MIDNIGHT_WALLET_SEED;
  const walletCtx = seed ? await buildWalletAndWaitForFunds(config, seed) : await buildFreshWallet(config);

  const providers = await configureProviders(walletCtx, config);

  const initialPrivateState: CommitmentPrivateState = {
    callerRole: 3, // CENTRAL_AUTHORITY deploys and holds the genesis role for governance bootstrap
    pendingBoardSignatures: [],
    pendingBoardKeyIds: [],
  };

  // Genesis parameters. These are not decoration: without them councilMembers is
  // empty, so setRegulatoryConfig could never satisfy its own membership check and
  // boardThresholdK would stay 0 — which silently makes the board threshold
  // unenforceable while still looking enforced.
  const contract = await deploy(providers, initialPrivateState, {
    rescheduleCapOccasions: 4n,
    boardEscalationFromAttempt: 3n,
    boardThresholdK: 2n,
    councilQuorum: 2n,
  });
  const contractAddress = contract.deployTxData.public.contractAddress;

  console.log(`Deployed commitment contract at: ${contractAddress}`);
  console.log(`Private state id: ${commitmentPrivateStateId}`);

  // Every later step — the bridge's joinContract, the smoke test, the frontend —
  // needs this address, and it is only ever printed once. Persist it so a
  // scrolled-away terminal is not the only copy.
  const deploymentFile = path.resolve(currentDir, '..', `deployment.${network}.json`);
  writeFileSync(
    deploymentFile,
    JSON.stringify(
      {
        network,
        contractAddress,
        privateStateId: commitmentPrivateStateId,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Wrote ${deploymentFile}`);
}

// The Midnight SDK throws "effect" library tagged errors — plain objects with a
// custom Node inspect symbol and a null prototype — which Node's default top-level
// uncaught-exception printer renders as an unreadable stub. Catch explicitly and
// force the real inspect output so failures are actually diagnosable.
main().catch((err) => {
  console.error('Deploy failed:\n' + inspect(err, { depth: 10, colors: false, customInspect: true }));
  process.exitCode = 1;
});
