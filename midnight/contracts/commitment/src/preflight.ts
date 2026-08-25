// Fail fast on the things that are cheap to check and expensive to discover late.
//
// The wallet sync takes tens of minutes, and everything below is only consulted
// AFTER it finishes — so a missing verifier key or an unreachable proof server costs
// half an hour before it surfaces, with an error that points nowhere near the cause.
// Checking up front turns those into a two-second failure with a fix in the message.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { contractConfig, type Config } from './config.js';

const CIRCUITS = [
  'originateLoan',
  'appendEvent',
  'registerDirector',
  'confirmDirector',
  'revokeDirector',
  'setRegulatoryConfig',
] as const;

export async function preflight(config: Config): Promise<void> {
  const problems: string[] = [];

  // 1. Compiled contract assets. This is the check that would have caught the
  //    Windows file-URL path bug (currentDir resolving to "G:\G:\…") immediately.
  if (!existsSync(contractConfig.zkConfigPath)) {
    problems.push(
      `Compiled contract not found at:\n    ${contractConfig.zkConfigPath}\n` +
        `  Run "npm run compact" (needs the Compact toolchain under WSL on Windows).`,
    );
  } else {
    const missing = CIRCUITS.filter(
      (c) => !existsSync(path.join(contractConfig.zkConfigPath, 'keys', `${c}.verifier`)),
    );
    if (missing.length > 0) {
      problems.push(
        `Verifier keys missing for: ${missing.join(', ')}\n` +
          `  The managed/ directory is stale — re-run "npm run compact".`,
      );
    }
  }

  // 2. Proof server. Without it every circuit call fails at proving time.
  try {
    const res = await fetch(`${config.proofServer}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) problems.push(`Proof server at ${config.proofServer} answered ${res.status}.`);
  } catch {
    problems.push(
      `Proof server unreachable at ${config.proofServer}\n` +
        `  docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`Pre-flight checks failed:\n\n- ${problems.join('\n\n- ')}\n`);
  }

  console.log(`Pre-flight OK — contract assets present, proof server reachable.`);
}
