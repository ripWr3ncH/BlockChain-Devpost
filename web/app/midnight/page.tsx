'use client';

/**
 * VERITY — the Midnight portal.
 *
 * This is the page that demonstrates the thing the whole migration was for: a
 * loan's lifecycle enforced by a Compact contract deployed on Midnight, where the
 * board-approval credentials are proved in zero knowledge instead of being handed
 * to the chain in cleartext.
 *
 * The demo it is built around is one specific refusal. Write-off requires board
 * authorisation. Submit it with too few director approvals and the circuit refuses
 * — that refusal is produced by the proof failing, not by this page checking a
 * number. Add approvals and the same submission commits.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  EVENT_TYPES,
  TIERS,
  isCircuitRefusal,
  midnight,
  randomHex32,
  type CircuitOutcome,
  type ContractState,
  type MidnightReceipt,
} from '@/lib/midnight';

interface Director {
  keyId: string;
  /** Preimage of the commitment registered on-ledger. Never leaves the witness. */
  secret: string;
  publicKeyCommitment?: string;
  confirmed: boolean;
}

export default function MidnightPage(): React.ReactNode {
  const [state, setState] = useState<ContractState>();
  const [bridgeError, setBridgeError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [log, setLog] = useState<Array<{ label: string; outcome: CircuitOutcome }>>([]);

  const [commitmentId, setCommitmentId] = useState('');
  const [prevStateHash, setPrevStateHash] = useState('');
  const [directors, setDirectors] = useState<Director[]>([]);
  const [approvalsToSend, setApprovalsToSend] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const s = await midnight.contract();
      setState(s);
      setBridgeError(undefined);
    } catch (e) {
      setBridgeError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const record = (label: string, outcome: CircuitOutcome) => {
    setLog((prev) => [{ label, outcome }, ...prev].slice(0, 12));
    void refresh();
  };

  const run = async (label: string, fn: () => Promise<CircuitOutcome>) => {
    setBusy(label);
    try {
      record(label, await fn());
    } catch (e) {
      record(label, { refused: true, message: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  };

  const threshold = Number(state?.config?.boardThresholdK ?? '0');

  return (
    <>
      <section style={{ maxWidth: '62rem', marginBottom: '2rem' }}>
        <span className="eyebrow">Midnight Preview · Compact contract</span>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', maxWidth: '22ch' }}>
          A board vote that proves itself.
        </h1>
        <p className="sub" style={{ marginTop: '1rem', maxWidth: '60ch' }}>
          Every action below is a circuit call against a Compact contract deployed on Midnight.
          Director approvals are supplied as a <strong>private witness</strong>: the circuit proves
          that enough registered directors approved and discloses only the count. The credentials
          themselves never reach the ledger.
        </p>
      </section>

      {bridgeError && (
        <div className="outcome refused" role="alert" style={{ marginBottom: '1.5rem' }}>
          <span className="code">⛔ BRIDGE UNREACHABLE</span>
          <p className="text">
            {bridgeError}. Start the proof server and the bridge — see
            midnight/contracts/commitment/README.md.
          </p>
        </div>
      )}

      {state && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Deployed contract</h3>
          <dl className="receipt">
            <dt>Address</dt>
            <dd>{state.contractAddress}</dd>
            <dt>Loans</dt>
            <dd>{state.loanCount ?? '—'}</dd>
            <dt>Directors</dt>
            <dd>{state.directorCount ?? '—'}</dd>
            <dt>Board threshold</dt>
            <dd>{state.config?.boardThresholdK ?? '—'} of n</dd>
            <dt>Reschedule cap</dt>
            <dd>{state.config?.rescheduleCapOccasions ?? '—'} occasions</dd>
          </dl>
        </div>
      )}

      {/* ── 1. Governance ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>1 · Set the rule</h3>
        <p className="hint">
          The reschedule cap and board threshold are Council-governed ledger state, not constants
          compiled into the contract. This is the genericisation applied to logic rather than text.
        </p>
        <div className="row">
          <button
            disabled={busy !== undefined}
            onClick={() =>
              void run('setRegulatoryConfig(cap 4, escalate at 3, board 2-of-n)', () =>
                midnight.setConfig({
                  rescheduleCapOccasions: 4,
                  boardEscalationFromAttempt: 3,
                  boardThresholdK: 2,
                  councilQuorum: 2,
                }),
              )
            }
          >
            Set board threshold to 2
          </button>
        </div>
      </div>

      {/* ── 2. Directors ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>2 · Constitute the board</h3>
        <p className="hint">
          A director registers a commitment to a secret. Only the Central Authority may confirm
          them — a bank can never constitute its own board.
        </p>
        <div className="row">
          <button
            disabled={busy !== undefined}
            onClick={() =>
              void (async () => {
                setBusy('provisionDirector');
                try {
                  // The bridge derives the registered commitment with the same
                  // runtime the circuit hashes with, so the two cannot drift. It
                  // hands back the secret because approving later means proving
                  // knowledge of it.
                  const d = await midnight.provisionDirector('BANK_A');
                  setDirectors((prev) => [...prev, { ...d, confirmed: true }]);
                  record(`registerDirector + confirmDirector(${d.keyId.slice(0, 12)}…)`, {
                    refused: false,
                    receipt: d.receipts.confirmed,
                  });
                } catch (e) {
                  record('provision director', { refused: true, message: (e as Error).message });
                } finally {
                  setBusy(undefined);
                }
              })()
            }
          >
            Register + confirm a director
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {directors.length} on the board
          </span>
        </div>
        {directors.length > 0 && (
          <div className="scroller" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Key id</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {directors.map((d) => (
                  <tr key={d.keyId}>
                    <td className="mono">{d.keyId.slice(0, 16)}…</td>
                    <td>{d.confirmed ? 'confirmed' : 'registered locally'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 3. Lifecycle ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>3 · Originate a loan</h3>
        <div className="row">
          <button
            disabled={busy !== undefined}
            onClick={() => {
              const id = randomHex32();
              setCommitmentId(id);
              void (async () => {
                await run(`originateLoan(${id.slice(0, 12)}…)`, () =>
                  midnight.originateLoan(id, TIERS.indexOf('STANDARD'), randomHex32()),
                );
                // Read back the hash the contract actually stored. appendEvent
                // asserts against it, so a guessed value fails as state divergence
                // before any authority check runs.
                const loan = await midnight.loan(id).catch(() => undefined);
                if (loan) setPrevStateHash(loan.prevStateHash);
              })();
            }}
          >
            Originate
          </button>
          {commitmentId && <span className="mono hint">{commitmentId.slice(0, 24)}…</span>}
        </div>
      </div>

      {/* ── 4. The refusal ────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>4 · Write it off</h3>
        <p className="hint">
          Write-off requires board authorisation. With fewer than {threshold || '—'} valid director
          approvals the circuit refuses, and the refusal comes from the proof, not from this page.
        </p>
        <div className="row" style={{ alignItems: 'center' }}>
          <label htmlFor="approvals" style={{ margin: 0 }}>
            Director approvals to supply
          </label>
          <input
            id="approvals"
            type="number"
            min={0}
            max={4}
            value={approvalsToSend}
            onChange={(e) => setApprovalsToSend(Number(e.target.value))}
            style={{ width: '5rem' }}
          />
          <button
            disabled={busy !== undefined || !commitmentId || !prevStateHash}
            onClick={() =>
              void (async () => {
                await run(`appendEvent(WRITE_OFF, ${approvalsToSend} approvals)`, () =>
                  midnight.appendEvent({
                    commitmentId,
                    eventType: EVENT_TYPES.indexOf('WRITE_OFF'),
                    tierAfter: TIERS.indexOf('BAD_LOSS'),
                    prevStateHash,
                    payloadHash: randomHex32(),
                    boardApprovals: directors
                      .slice(0, approvalsToSend)
                      .map((d) => ({ keyId: d.keyId, secret: d.secret })),
                  }),
                );
                // A committed event advances the chain, so the hash we hold is now
                // stale; a refused one leaves it valid. Re-reading covers both and
                // keeps a second attempt from failing as state divergence.
                const loan = await midnight.loan(commitmentId).catch(() => undefined);
                if (loan) setPrevStateHash(loan.prevStateHash);
              })()
            }
          >
            Submit write-off
          </button>
        </div>
        {!commitmentId && <p className="hint">Originate a loan first.</p>}
      </div>

      {/* ── Outcomes ──────────────────────────────────────────────────── */}
      {log.length > 0 && (
        <section>
          <h3>What the chain said</h3>
          {log.map((entry, i) => (
            <div key={i} style={{ marginBottom: '1rem' }}>
              <p className="hint" style={{ marginBottom: '.4rem' }}>
                {entry.label}
              </p>
              {isCircuitRefusal(entry.outcome) ? (
                <div className="outcome refused" role="alert">
                  <span className="code">⛔ CIRCUIT REFUSED</span>
                  <p className="text">{entry.outcome.message}</p>
                </div>
              ) : (
                <MidnightReceiptPanel receipt={entry.outcome.receipt} />
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function MidnightReceiptPanel({ receipt }: { receipt: MidnightReceipt }): React.ReactNode {
  return (
    <div className="outcome committed">
      <span className="code">✓ PROVED AND COMMITTED ON MIDNIGHT</span>
      <dl className="receipt">
        <dt>Transaction</dt>
        <dd>{receipt.txId}</dd>
        {receipt.blockHeight && (
          <>
            <dt>Block</dt>
            <dd>{receipt.blockHeight}</dd>
          </>
        )}
        <dt>Network</dt>
        <dd>Midnight {receipt.network}</dd>
        <dt>Contract</dt>
        <dd>{receipt.contractAddress}</dd>
        <dt>Time</dt>
        <dd>{new Date(receipt.timestamp).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd>
      </dl>
    </div>
  );
}
