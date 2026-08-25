/**
 * VERITY — client for the Midnight bridge.
 *
 * The bridge is a separate service from the legacy Fabric API for a structural
 * reason, not a stylistic one: a Midnight wallet has to replay ledger history
 * before it can sign anything, which takes minutes, so it lives in a long-running
 * process that syncs once at boot. See midnight/contracts/commitment/src/bridge.ts.
 *
 * Everything here talks to the deployed Compact contract on Midnight Preview.
 */

export const MIDNIGHT_BRIDGE =
  process.env['NEXT_PUBLIC_MIDNIGHT_BRIDGE'] ?? 'http://localhost:8090';

/** Role enum order in commitment.compact. */
export type Institution = 'BANK_A' | 'BANK_B' | 'CENTRAL_AUTHORITY' | 'REGULATORY_COUNCIL';

/** ClassificationTier enum order in commitment.compact. */
export const TIERS = ['STANDARD', 'SMA', 'SUB_STANDARD', 'DOUBTFUL', 'BAD_LOSS'] as const;
export type Tier = (typeof TIERS)[number];

/** EventType enum order in commitment.compact. */
export const EVENT_TYPES = [
  'ORIGINATION',
  'RESCHEDULE',
  'RESTRUCTURE',
  'RECLASSIFY_UP',
  'RECLASSIFY_DOWN',
  'WRITE_OFF',
  'RECOVERY',
  'COLLATERAL_REVALUATION',
  'ASSET_PLEDGE',
  'LC_DEVOLVEMENT',
  'CORRECTION',
] as const;
export type EventTypeName = (typeof EVENT_TYPES)[number];

export interface MidnightReceipt {
  txId: string;
  txHash?: string;
  blockHeight?: string;
  network: string;
  contractAddress: string;
  timestamp: string;
}

export interface ContractState {
  contractAddress: string;
  found: boolean;
  config?: {
    rescheduleCapOccasions: string;
    boardEscalationFromAttempt: string;
    boardThresholdK: string;
    councilQuorum: string;
  };
  loanCount?: string;
  directorCount?: string;
}

export interface LoanRecord {
  commitmentId: string;
  institution: number;
  currentTier: number;
  /** Feed this straight back into appendEvent — the contract checks it. */
  prevStateHash: string;
  rsSequence: string;
  eventCount: string;
  active: boolean;
}

export interface CircuitRefusal {
  refused: true;
  message: string;
}

export interface CircuitCommitted {
  refused: false;
  receipt: MidnightReceipt;
}

export type CircuitOutcome = CircuitCommitted | CircuitRefusal;

export const isCircuitRefusal = (o: CircuitOutcome): o is CircuitRefusal => o.refused;

async function call(path: string, body?: unknown): Promise<CircuitOutcome> {
  const res = await fetch(`${MIDNIGHT_BRIDGE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await res.json()) as { receipt?: MidnightReceipt; message?: string };

  // A refused circuit is the interesting case, not an error page: the contract
  // declined and said why, and that message is the demo.
  if (!res.ok) {
    return { refused: true, message: payload.message ?? `Bridge returned ${res.status}` };
  }
  return { refused: false, receipt: payload.receipt! };
}

/** 32 bytes of hex, which is what every Bytes<32> circuit argument wants. */
export const randomHex32 = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export const midnight = {
  async health(): Promise<{ status: string; network: string; contractAddress: string }> {
    const res = await fetch(`${MIDNIGHT_BRIDGE}/health`);
    if (!res.ok) throw new Error(`Bridge unreachable (${res.status})`);
    return res.json() as Promise<{ status: string; network: string; contractAddress: string }>;
  },

  async contract(): Promise<ContractState> {
    const res = await fetch(`${MIDNIGHT_BRIDGE}/contract`);
    if (!res.ok) throw new Error(`Bridge unreachable (${res.status})`);
    return res.json() as Promise<ContractState>;
  },

  /**
   * Read a loan's live record. The caller needs `prevStateHash` before it can append:
   * the contract asserts the supplied hash equals the current one, which is what makes
   * the event chain append-only.
   */
  async loan(commitmentId: string): Promise<LoanRecord | undefined> {
    const res = await fetch(`${MIDNIGHT_BRIDGE}/loans/${commitmentId}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
    return res.json() as Promise<LoanRecord>;
  },

  originateLoan: (commitmentId: string, initialTier: number, payloadHash: string) =>
    call('/loans', { commitmentId, initialTier, payloadHash }),

  appendEvent: (input: {
    commitmentId: string;
    eventType: number;
    tierAfter: number;
    prevStateHash: string;
    payloadHash: string;
    boardApprovals?: Array<{ keyId: string; secret: string }>;
  }) => call('/events', input),

  /**
   * Register and confirm a director in one round trip. The bridge generates the key id
   * and secret and derives the on-ledger commitment, then returns the secret so the
   * caller can later supply it as an approval. The secret is a private witness at
   * proving time — it never reaches the ledger.
   */
  async provisionDirector(institution: Institution): Promise<{
    keyId: string;
    secret: string;
    publicKeyCommitment: string;
    receipts: { registered: MidnightReceipt; confirmed: MidnightReceipt };
  }> {
    const res = await fetch(`${MIDNIGHT_BRIDGE}/directors/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution }),
    });
    const payload = (await res.json()) as { message?: string };
    if (!res.ok) throw new Error(payload.message ?? `Bridge returned ${res.status}`);
    return payload as never;
  },

  registerDirector: (institution: Institution, keyId: string, publicKeyCommitment: string) =>
    call('/directors/register', { institution, keyId, publicKeyCommitment }),

  confirmDirector: (institution: Institution, keyId: string) =>
    call('/directors/confirm', { institution, keyId }),

  setConfig: (input: {
    rescheduleCapOccasions: number;
    boardEscalationFromAttempt: number;
    boardThresholdK: number;
    councilQuorum: number;
  }) => call('/config', input),
};
