'use client';

/**
 * QUORUM — the board room.
 *
 * The demo is one specific refusal. Write-off requires board authorisation.
 * Submit it with too few director approvals and the circuit refuses — that
 * refusal is produced by the proof failing, not by this page checking a number.
 * Add approvals and the same submission commits.
 *
 * Layout follows the reference: a status strip, a stepper for the quantity that
 * matters, pastel tiles for state, and outlined cards for each step. The
 * approvals stepper is deliberately the same control the reference uses for
 * temperature — it is the one number the whole demo turns on.
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
}

type LogEntry = { label: string; outcome: CircuitOutcome };

/**
 * The grade the demo loan is sanctioned at. A revision has to beat it, so the
 * default acting grade starts equal — refusing — and the user raises it.
 */
const SANCTIONED_AT = 2;

export default function BoardRoom(): React.ReactNode {
  const [state, setState] = useState<ContractState>();
  const [bridgeError, setBridgeError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [log, setLog] = useState<LogEntry[]>([]);

  const [commitmentId, setCommitmentId] = useState('');
  const [prevStateHash, setPrevStateHash] = useState('');
  const [directors, setDirectors] = useState<Director[]>([]);
  const [approvals, setApprovals] = useState(0);
  const [wroteOff, setWroteOff] = useState(false);
  const [actingGrade, setActingGrade] = useState(SANCTIONED_AT);

  const refresh = useCallback(async () => {
    try {
      setState(await midnight.contract());
      setBridgeError(undefined);
    } catch (e) {
      setBridgeError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const record = (label: string, outcome: CircuitOutcome) => {
    setLog((prev) => [{ label, outcome }, ...prev].slice(0, 10));
    void refresh();
  };

  const run = async (key: string, label: string, fn: () => Promise<CircuitOutcome>) => {
    setBusy(key);
    try {
      const outcome = await fn();
      record(label, outcome);
      return outcome;
    } catch (e) {
      const outcome: CircuitOutcome = { refused: true, message: (e as Error).message };
      record(label, outcome);
      return outcome;
    } finally {
      setBusy(undefined);
    }
  };

  const threshold = Number(state?.config?.boardThresholdK ?? '0');
  const enough = threshold > 0 && approvals >= threshold;
  const working = busy !== undefined;

  const addDirector = async () => {
    setBusy('director');
    try {
      // The bridge derives the on-ledger commitment with the same runtime the
      // circuit hashes with, so the browser never has to agree with the circuit
      // about a hash function. It returns the secret because approving later
      // means proving knowledge of it.
      const d = await midnight.provisionDirector('BANK_A');
      setDirectors((prev) => {
        const next = [...prev, { keyId: d.keyId, secret: d.secret }];
        // Track the board up to the threshold, so the control starts where a user
        // would expect it. Past the threshold it stays put, because choosing to
        // supply FEWER approvals than you hold is the whole demonstration.
        setApprovals((a) => (a >= threshold ? a : Math.min(next.length, threshold)));
        return next;
      });
      record(`registerDirector + confirmDirector`, { refused: false, receipt: d.receipts.confirmed });
    } catch (e) {
      record('provision director', { refused: true, message: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  };

  const originate = async () => {
    const id = randomHex32();
    const outcome = await run('originate', 'originateLoan', () =>
      midnight.originateLoan(id, TIERS.indexOf('STANDARD'), randomHex32(), SANCTIONED_AT),
    );
    if (isCircuitRefusal(outcome)) return;
    setCommitmentId(id);
    setWroteOff(false);
    setActingGrade(SANCTIONED_AT);
    // Read back the hash the contract stored. appendEvent asserts against it, so
    // a guessed value fails as state divergence before any authority check runs.
    const loan = await midnight.loan(id).catch(() => undefined);
    if (loan) setPrevStateHash(loan.prevStateHash);
  };

  const writeOff = async () => {
    const outcome = await run('writeoff', `appendEvent · WRITE_OFF · ${approvals} approval${approvals === 1 ? '' : 's'}`, () =>
      midnight.appendEvent({
        commitmentId,
        eventType: EVENT_TYPES.indexOf('WRITE_OFF'),
        tierAfter: TIERS.indexOf('BAD_LOSS'),
        prevStateHash,
        payloadHash: randomHex32(),
        boardApprovals: directors.slice(0, approvals),
      }),
    );
    if (!isCircuitRefusal(outcome)) setWroteOff(true);
    // A committed event advances the chain; a refused one leaves the hash valid.
    // Re-reading covers both and keeps a retry from failing as state divergence.
    const loan = await midnight.loan(commitmentId).catch(() => undefined);
    if (loan) setPrevStateHash(loan.prevStateHash);
  };

  const restructure = async () => {
    await run('restructure', `appendEvent · RESTRUCTURE · grade ${actingGrade}`, () =>
      midnight.appendEvent({
        commitmentId,
        eventType: EVENT_TYPES.indexOf('RESTRUCTURE'),
        tierAfter: TIERS.indexOf('SMA'),
        prevStateHash,
        payloadHash: randomHex32(),
        actingSeniority: actingGrade,
      }),
    );
    const loan = await midnight.loan(commitmentId).catch(() => undefined);
    if (loan) setPrevStateHash(loan.prevStateHash);
  };

  return (
    <>
      <section style={{ marginBottom: '1.25rem' }}>
        <span className="eyebrow">Board room</span>
        <h1 style={{ fontSize: 'clamp(1.7rem, 4vw, 2.6rem)', maxWidth: '20ch' }}>
          Approve a write-off without publishing the board.
        </h1>
      </section>

      {bridgeError && (
        <div className="outcome refused" role="alert" style={{ marginBottom: '1.25rem' }}>
          <span className="code">bridge unreachable</span>
          <p className="text">
            {bridgeError}. Start the proof server and the bridge — see the contract README.
          </p>
        </div>
      )}

      {/* ── Contract status strip ─────────────────────────────────────── */}
      {state && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: '.8rem' }}>
            <h3 style={{ margin: 0 }}>Deployed contract</h3>
            <span className="status on">live · preview</span>
          </div>
          <dl className="receipt">
            <dt>Address</dt>
            <dd>{state.contractAddress}</dd>
            <dt>Threshold</dt>
            <dd>{state.config?.boardThresholdK ?? '—'} of n directors</dd>
            <dt>Loans</dt>
            <dd>{state.loanCount ?? '—'}</dd>
            <dt>Directors</dt>
            <dd>{state.directorCount ?? '—'} registered</dd>
          </dl>
        </div>
      )}

      {/* ── 1 · board ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="step">
          <span className={`n${directors.length >= threshold && threshold > 0 ? ' done' : ''}`}>1</span>
          <h3 style={{ margin: 0 }}>Constitute the board</h3>
        </div>
        <p className="hint" style={{ marginBottom: '.9rem' }}>
          A director registers a <em>commitment</em> to a secret, never the secret. Only the Central
          Authority may confirm them — a bank cannot constitute its own board, and the contract
          refuses if it tries.
        </p>
        <div className="row">
          <button className="mint" disabled={working} onClick={() => void addDirector()}>
            {busy === 'director' ? 'Proving…' : '+ Register & confirm a director'}
          </button>
          <span className="status">{directors.length} on the board</span>
        </div>

        {directors.length > 0 && (
          <div className="grid-3" style={{ marginTop: '1rem' }}>
            {directors.map((d, i) => (
              <div key={d.keyId} className="tile violet">
                <span className="chip" aria-hidden>
                  👤
                </span>
                <span className="label">Director {i + 1}</span>
                <span className="status on">confirmed</span>
                <span className="mono" style={{ fontSize: '.62rem', color: 'var(--ink-2)' }}>
                  {d.keyId.slice(0, 18)}…
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2 · loan ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="step">
          <span className={`n${commitmentId ? ' done' : ''}`}>2</span>
          <h3 style={{ margin: 0 }}>Originate a loan</h3>
        </div>
        <p className="hint" style={{ marginBottom: '.9rem' }}>
          Opens an append-only event chain. Every later event must carry the previous state hash, so
          the record cannot be quietly rewritten behind the supervisor.
        </p>
        <div className="row">
          <button disabled={working} onClick={() => void originate()}>
            {busy === 'originate' ? 'Proving…' : 'Originate'}
          </button>
          {commitmentId && (
            <span className="mono" style={{ fontSize: '.72rem', color: 'var(--ink-2)' }}>
              {commitmentId.slice(0, 22)}…
            </span>
          )}
        </div>
      </div>

      {/* ── 3 · the refusal ───────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="step">
          <span className={`n${wroteOff ? ' done' : ''}`}>3</span>
          <h3 style={{ margin: 0 }}>Write it off</h3>
        </div>
        <p className="hint" style={{ marginBottom: '1rem' }}>
          Write-off requires board authorisation. Submit it with fewer than {threshold || '—'} valid
          approvals and the circuit refuses — and that refusal comes from the proof, not from this
          page. There is no front-end check to bypass.
        </p>

        <div className="row" style={{ gap: '1.5rem', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="approvals">Director approvals supplied</label>
            <div className="stepper">
              <button
                type="button"
                aria-label="one fewer approval"
                disabled={approvals <= 0}
                onClick={() => setApprovals((n) => Math.max(0, n - 1))}
              >
                −
              </button>
              <span className="value" id="approvals">
                {approvals}
              </span>
              <button
                type="button"
                aria-label="one more approval"
                disabled={approvals >= directors.length}
                onClick={() => setApprovals((n) => Math.min(directors.length, n + 1))}
              >
                +
              </button>
            </div>
          </div>

          <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
            <label>Against a threshold of {threshold || '—'}</label>
            <div className={`meter${enough ? ' met' : ''}`}>
              <span style={{ width: threshold > 0 ? `${Math.min(100, (approvals / threshold) * 100)}%` : '0%' }} />
            </div>
            <div className="meter-labels">
              <span>{approvals} supplied</span>
              <span>{enough ? 'sufficient' : `${Math.max(0, threshold - approvals)} short`}</span>
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: '1.1rem' }}>
          <button
            className={enough ? 'mint' : undefined}
            disabled={working || !commitmentId || !prevStateHash}
            onClick={() => void writeOff()}
          >
            {busy === 'writeoff' ? 'Proving…' : 'Submit write-off'}
          </button>
          {!commitmentId && <span className="hint" style={{ margin: 0 }}>Originate a loan first.</span>}
        </div>
      </div>

      {/* ── 4 · seniority ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="step">
          <span className="n">4</span>
          <h3 style={{ margin: 0 }}>Or restructure it</h3>
        </div>
        <p className="hint" style={{ marginBottom: '1rem' }}>
          A restructure does not need the board, but it does need rank: it must be authorised
          at least one grade above the officer who sanctioned the loan (grade {SANCTIONED_AT}).
          The acting grade is a <strong>private witness</strong> — the ledger records that the
          rule held, never the officer&rsquo;s actual grade, because a bank&rsquo;s internal
          hierarchy is nobody else&rsquo;s business.
        </p>
        <div className="row" style={{ gap: '1.5rem', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="grade">Acting officer grade</label>
            <div className="stepper">
              <button
                type="button"
                aria-label="lower grade"
                disabled={actingGrade <= 0}
                onClick={() => setActingGrade((g) => Math.max(0, g - 1))}
              >
                −
              </button>
              <span className="value" id="grade">
                {actingGrade}
              </span>
              <button
                type="button"
                aria-label="higher grade"
                disabled={actingGrade >= 9}
                onClick={() => setActingGrade((g) => Math.min(9, g + 1))}
              >
                +
              </button>
            </div>
          </div>
          <div style={{ flex: '1 1 200px', minWidth: '190px' }}>
            <label>Sanctioned at grade {SANCTIONED_AT}</label>
            <div className={`meter${actingGrade > SANCTIONED_AT ? ' met' : ''}`}>
              <span style={{ width: `${Math.min(100, (actingGrade / (SANCTIONED_AT + 2)) * 100)}%` }} />
            </div>
            <div className="meter-labels">
              <span>grade {actingGrade}</span>
              <span>{actingGrade > SANCTIONED_AT ? 'senior enough' : 'not above sanctioning officer'}</span>
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: '1.1rem' }}>
          <button
            className={actingGrade > SANCTIONED_AT ? 'mint' : undefined}
            disabled={working || !commitmentId || !prevStateHash}
            onClick={() => void restructure()}
          >
            {busy === 'restructure' ? 'Proving…' : 'Submit restructure'}
          </button>
        </div>
      </div>

      {/* ── Outcomes ──────────────────────────────────────────────────── */}
      {log.length > 0 && (
        <section>
          <h2>What the chain said</h2>
          {log.map((entry, i) => (
            <div key={i} style={{ marginBottom: '.9rem' }}>
              <p className="hint" style={{ margin: '0 0 .35rem', fontWeight: 700 }}>
                {entry.label}
              </p>
              {isCircuitRefusal(entry.outcome) ? (
                <div className="outcome refused" role="alert">
                  <span className="code">circuit refused</span>
                  <p className="text">{entry.outcome.message}</p>
                </div>
              ) : (
                <Receipt receipt={entry.outcome.receipt} />
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Receipt({ receipt }: { receipt: MidnightReceipt }): React.ReactNode {
  return (
    <div className="outcome committed">
      <span className="code">proved &amp; committed</span>
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
        <dt>Time</dt>
        <dd>{new Date(receipt.timestamp).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd>
      </dl>
    </div>
  );
}
