// QUORUM — Midnight bridge service.
//
// This is the back end for the Midnight build. It exists as its own long-lived
// process for one hard reason: a first-time wallet sync against Preprod replays the
// whole ledger history and takes minutes, so the wallet cannot be constructed per
// request. The bridge syncs once at boot, holds the wallet + provider bundle, and
// serves circuit calls against the deployed commitment contract over HTTP.
//
//   PROOF_SERVER   local proof server            (default http://127.0.0.1:6300)
//   MIDNIGHT_WALLET_SEED   hex seed for the operator wallet (required)
//   MIDNIGHT_NETWORK       preview (default) | preprod | standalone
//   COMMITMENT_CONTRACT_ADDRESS  deployed address; falls back to deployment.<network>.json
//   BRIDGE_PORT    default 8090
//
// Start the proof server first:
//   docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v

import { inspect } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { configFor, currentDir, networkFromEnv } from './config.js';
import {
  appendEvent,
  buildWalletAndWaitForFunds,
  confirmDirector,
  configureProviders,
  getCommitmentLedgerState,
  joinContract,
  originateLoan,
  registerDirector,
  revokeDirector,
  setRegulatoryConfig,
} from './api.js';
import { commitmentPrivateStateId, type CommitmentPrivateState } from './witnesses.js';
import type { DeployedCommitmentContract } from './common-types.js';
import { preflight } from './preflight.js';
import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js/types';

const PORT = Number(process.env.BRIDGE_PORT ?? 8090);

const hexToBytes = (hex: string, label: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length !== 64) {
    throw new BadRequest(`${label} must be 32 bytes of hex (64 characters), got ${clean.length}`);
  }
  return Uint8Array.from(Buffer.from(clean, 'hex'));
};

class BadRequest extends Error {}

const randomBytes32 = (): Uint8Array => Uint8Array.from(randomBytes(32));

/**
 * The commitment a director registers, derived exactly as the circuit derives it:
 * `persistentHash<Vector<1, Bytes<32>>>([secret])` in commitment.compact.
 */
const directorCommitment = (secret: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeVector(1, new CompactTypeBytes(32)), [secret]);

/** Role enum order in commitment.compact. */
const ROLES: Record<string, number> = {
  NONE: 0,
  BANK_A: 1,
  BANK_B: 2,
  CENTRAL_AUTHORITY: 3,
  REGULATORY_COUNCIL: 4,
};

const resolveContractAddress = (network: string): string => {
  const fromEnv = process.env.COMMITMENT_CONTRACT_ADDRESS;
  if (fromEnv) return fromEnv;
  const file = path.resolve(currentDir, '..', `deployment.${network}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8')).contractAddress as string;
  } catch {
    throw new Error(
      `No contract address: set COMMITMENT_CONTRACT_ADDRESS or run "npm run deploy" to create ${file}`,
    );
  }
};

async function main() {
  const seed = process.env.MIDNIGHT_WALLET_SEED;
  if (!seed) throw new Error('MIDNIGHT_WALLET_SEED is required');

  const network = networkFromEnv();
  const contractAddress = resolveContractAddress(network);
  const config = configFor(network);

  console.log(`Bridge starting; joining commitment contract ${contractAddress}`);
  await preflight(config);
  console.log('Syncing wallet — first run replays ledger history, expect several minutes.');

  const walletCtx = await buildWalletAndWaitForFunds(config, seed);
  const providers = await configureProviders(walletCtx, config);

  const privateState: CommitmentPrivateState = {
    callerRole: ROLES.CENTRAL_AUTHORITY!,
    pendingBoardSignatures: [],
    pendingBoardKeyIds: [],
  };

  const contract: DeployedCommitmentContract = await joinContract(providers, contractAddress, privateState);
  console.log(`Joined. Bridge listening on :${PORT}`);

  /**
   * Run a circuit call while acting as a particular role.
   *
   * `callerRole` is a witness, and the contract genuinely checks it: originateLoan
   * demands a bank, confirmDirector demands the Central Authority, and
   * registerDirector asserts the caller IS the institution it is registering for.
   * A bridge pinned to one role would have most of its own endpoints refused.
   *
   * This is honest for a prototype where one operator drives every party in the
   * demo, and it is NOT a security boundary: the role is asserted by this process,
   * not proved against a credential. A production deployment would derive it from
   * the caller's own key rather than letting the bridge assume any role it likes.
   * That gap is the direct equivalent of the seniority placeholder in the contract.
   */
  const asRole = async <T>(role: keyof typeof ROLES, fn: () => Promise<T>): Promise<T> => {
    privateState.callerRole = ROLES[role]!;
    await providers.privateStateProvider.set(commitmentPrivateStateId, privateState);
    return fn();
  };

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  /**
   * A submitted transaction returns a receipt. It is the simplest proof that a
   * real chain wrote a real block, rather than the UI asserting that it did.
   */
  const receipt = (txData: FinalizedTxData) => ({
    txId: txData.txId,
    txHash: txData.txHash,
    blockHeight: txData.blockHeight?.toString(),
    network,
    contractAddress,
    timestamp: new Date().toISOString(),
  });

  app.get('/health', async () => ({ status: 'ok', network, contractAddress }));

  app.get('/contract', async () => {
    const state = await getCommitmentLedgerState(providers, contractAddress);
    if (state === null) return { contractAddress, found: false };
    return {
      contractAddress,
      found: true,
      config: {
        rescheduleCapOccasions: state.config.rescheduleCapOccasions.toString(),
        boardEscalationFromAttempt: state.config.boardEscalationFromAttempt.toString(),
        boardThresholdK: state.config.boardThresholdK.toString(),
        councilQuorum: state.config.councilQuorum.toString(),
      },
      loanCount: state.loans.size().toString(),
      directorCount: state.directors.size().toString(),
    };
  });

  /**
   * Read one loan's current record.
   *
   * `prevStateHash` is the reason this endpoint exists. appendEvent asserts that the
   * hash it is handed equals the loan's current one — that assert IS the append-only
   * chain — so a caller has to read the live value before it can submit the next
   * event. Guessing it fails with "state divergence" long before any authority check
   * is reached.
   */
  app.get<{ Params: { id: string } }>('/loans/:id', async (request, reply) => {
    const id = hexToBytes(request.params.id, 'commitmentId');
    const state = await getCommitmentLedgerState(providers, contractAddress);
    if (state === null || !state.loans.member(id)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'no loan for this commitment id' });
    }
    const loan = state.loans.lookup(id);
    return {
      commitmentId: request.params.id,
      institution: loan.institution,
      currentTier: loan.currentTier,
      prevStateHash: Buffer.from(loan.prevStateHash).toString('hex'),
      rsSequence: loan.rsSequence.toString(),
      eventCount: loan.eventCount.toString(),
      active: loan.active,
    };
  });

  app.post<{ Body: { commitmentId: string; initialTier: number; payloadHash: string } }>(
    '/loans',
    async (request, reply) => {
      const b = request.body;
      const out = await asRole('BANK_A', () =>
        originateLoan(
          contract,
          hexToBytes(b.commitmentId, 'commitmentId'),
          Number(b.initialTier),
          hexToBytes(b.payloadHash, 'payloadHash'),
        ),
      );
      return reply.code(201).send({ receipt: receipt(out) });
    },
  );

  app.post<{
    Body: {
      commitmentId: string;
      eventType: number;
      tierAfter: number;
      prevStateHash: string;
      payloadHash: string;
      /** Director approvals for this event: { keyId, secret } pairs, both 32-byte hex. */
      boardApprovals?: Array<{ keyId: string; secret: string }>;
    };
  }>('/events', async (request, reply) => {
    const b = request.body;
    const commitmentId = hexToBytes(b.commitmentId, 'commitmentId');
    const prevStateHash = hexToBytes(b.prevStateHash, 'prevStateHash');
    const payloadHash = hexToBytes(b.payloadHash, 'payloadHash');

    // Board approvals ride in the private state the circuit reads its witnesses from.
    // The secrets never reach the ledger: the circuit proves knowledge of them and
    // discloses only how many counted.
    privateState.pendingBoardSignatures = (b.boardApprovals ?? []).map((a) => hexToBytes(a.secret, 'secret'));
    privateState.pendingBoardKeyIds = (b.boardApprovals ?? []).map((a) => hexToBytes(a.keyId, 'keyId'));
    await providers.privateStateProvider.set(commitmentPrivateStateId, privateState);

    const out = await asRole('BANK_A', () =>
      appendEvent(contract, commitmentId, Number(b.eventType), Number(b.tierAfter), prevStateHash, payloadHash),
    );
    return reply.code(201).send({ receipt: receipt(out) });
  });

  /**
   * Register AND confirm a director in one call, deriving the commitment here.
   *
   * The commitment a director registers is persistentHash([secret]) over exactly the
   * Compact type the circuit hashes — `Vector<1, Bytes<32>>`. Deriving it in the
   * browser would mean re-implementing that hash and hoping the two agree; deriving
   * it here reuses the same runtime the circuit does, so they cannot drift.
   *
   * The secret is returned to the caller because the caller is the one who later
   * supplies it as an approval. It is never written to the ledger.
   */
  app.post<{ Body: { institution: string; keyId?: string; secret?: string } }>(
    '/directors/provision',
    async (request, reply) => {
      const b = request.body;
      const institution = ROLES[b.institution] ?? 0;
      const keyId = b.keyId ? hexToBytes(b.keyId, 'keyId') : randomBytes32();
      const secret = b.secret ? hexToBytes(b.secret, 'secret') : randomBytes32();
      const publicKeyCommitment = directorCommitment(secret);

      // A bank registers its own directors; only the Central Authority may confirm
      // them. Doing both under one role is exactly what the contract refuses, so the
      // two calls are made as different parties.
      const registered = await asRole(b.institution as keyof typeof ROLES, () =>
        registerDirector(contract, institution, keyId, publicKeyCommitment),
      );
      const confirmed = await asRole('CENTRAL_AUTHORITY', () =>
        confirmDirector(contract, institution, keyId),
      );

      return reply.code(201).send({
        keyId: Buffer.from(keyId).toString('hex'),
        secret: Buffer.from(secret).toString('hex'),
        publicKeyCommitment: Buffer.from(publicKeyCommitment).toString('hex'),
        receipts: { registered: receipt(registered), confirmed: receipt(confirmed) },
      });
    },
  );

  app.post<{ Body: { institution: string; keyId: string; publicKeyCommitment: string } }>(
    '/directors/register',
    async (request, reply) => {
      const b = request.body;
      const out = await asRole(b.institution as keyof typeof ROLES, () =>
        registerDirector(
          contract,
          ROLES[b.institution] ?? 0,
          hexToBytes(b.keyId, 'keyId'),
          hexToBytes(b.publicKeyCommitment, 'publicKeyCommitment'),
        ),
      );
      return reply.code(201).send({ receipt: receipt(out) });
    },
  );

  app.post<{ Body: { institution: string; keyId: string } }>('/directors/confirm', async (request, reply) => {
    const b = request.body;
    const out = await asRole('CENTRAL_AUTHORITY', () =>
      confirmDirector(contract, ROLES[b.institution] ?? 0, hexToBytes(b.keyId, 'keyId')),
    );
    return reply.code(201).send({ receipt: receipt(out) });
  });

  app.post<{ Body: { institution: string; keyId: string } }>('/directors/revoke', async (request, reply) => {
    const b = request.body;
    const out = await asRole('CENTRAL_AUTHORITY', () =>
      revokeDirector(contract, ROLES[b.institution] ?? 0, hexToBytes(b.keyId, 'keyId')),
    );
    return reply.code(201).send({ receipt: receipt(out) });
  });

  app.post<{
    Body: {
      rescheduleCapOccasions: number;
      boardEscalationFromAttempt: number;
      boardThresholdK: number;
      councilQuorum: number;
    };
  }>('/config', async (request, reply) => {
    const b = request.body;
    const out = await asRole('REGULATORY_COUNCIL', () =>
      setRegulatoryConfig(contract, {
      rescheduleCapOccasions: BigInt(b.rescheduleCapOccasions),
      boardEscalationFromAttempt: BigInt(b.boardEscalationFromAttempt),
      boardThresholdK: BigInt(b.boardThresholdK),
        councilQuorum: BigInt(b.councilQuorum),
      }),
    );
    return reply.code(201).send({ receipt: receipt(out) });
  });

  // A refused circuit is the interesting case, not an accident: surface the
  // assert message the contract actually wrote rather than a stack trace.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BadRequest) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: error.message });
    }
    const message = extractAssertMessage(error);
    console.error('circuit call failed:\n' + inspect(error, { depth: 8, customInspect: true }));
    return reply.code(422).send({ error: 'CIRCUIT_REFUSED', message });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
}

function extractAssertMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // compact-runtime surfaces a failed assert as "failed assert: <message>".
  const m = /failed assert:?\s*(.+)/i.exec(text);
  return m ? m[1]!.trim() : text;
}

main().catch((err) => {
  console.error('Bridge failed to start:\n' + inspect(err, { depth: 10, customInspect: true }));
  process.exitCode = 1;
});
