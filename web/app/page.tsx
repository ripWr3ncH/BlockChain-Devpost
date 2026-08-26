import Link from 'next/link';

/**
 * Landing. The thesis, then the one door that matters.
 *
 * "The rules are not what is missing" is the argument the whole project rests on,
 * so it is set at display size and nothing competes with it.
 */
export default function Home() {
  return (
    <>
      <section style={{ maxWidth: '62rem', margin: '1.5rem 0 3.5rem' }}>
        <span className="eyebrow">Brainwave 2026 · Midnight Track</span>
        <h1 style={{ fontSize: 'clamp(2.1rem, 5.2vw, 3.6rem)', maxWidth: '19ch' }}>
          The rules are not
          <br />
          what is <span style={{ background: 'var(--mint)', padding: '0 .18em', borderRadius: '6px' }}>missing</span>.
        </h1>
        <p className="sub" style={{ fontSize: '1.05rem', marginTop: '1.25rem', maxWidth: '58ch' }}>
          Supervisors already require two signatures on every classification, cap rescheduling at a
          fixed number of occasions, and reserve the later attempts to the Board.{' '}
          <strong>The record is what is missing</strong> — it is held by the institution being
          examined, it can be revised afterwards, and it is read only when an inspector is present.
        </p>

        <div className="row" style={{ marginTop: '1.75rem' }}>
          <Link href="/midnight" style={{ textDecoration: 'none' }}>
            <button>See a rule refuse something →</button>
          </Link>
        </div>
      </section>

      {/* The number that motivates the whole project. */}
      <div className="grid-3" style={{ marginBottom: '2.5rem' }}>
        <div className="card">
          <div className="stat alert">
            <span className="value">4.2×</span>
            <span className="label">assessed against reported</span>
          </div>
          <p className="hint">
            An Asset Quality Review of six banks found $147,595M of non-performing loans against
            $35,044M reported.
          </p>
        </div>
        <div className="card">
          <div className="stat alert">
            <span className="value">once</span>
            <span className="label">how often the book is examined</span>
          </div>
          <p className="hint">
            120 calendar days per bank, international firms, donor money — and then it is over.
          </p>
        </div>
        <div className="card">
          <div className="stat">
            <span className="value">0</span>
            <span className="label">credentials published</span>
          </div>
          <p className="hint">
            The board approvals that authorise a write-off are proved in zero knowledge. Only the
            count reaches the ledger.
          </p>
        </div>
      </div>

      <h2>The trade nobody should have to make</h2>
      <div className="card" style={{ maxWidth: '70ch', marginBottom: '2.5rem' }}>
        <p style={{ margin: 0, fontSize: '.92rem', color: 'var(--ink-2)' }}>
          Putting approvals on a public chain normally means publishing every director&rsquo;s
          signature to prove you had authorisation — handing a competitor your governance record.
          That is a real reason institutions resist transparent ledgers, and not an unreasonable one.{' '}
          <strong>
            A supervisor needs to know that enough of the right people approved. It does not need to
            know who they were.
          </strong>{' '}
          That distinction is what Midnight makes expressible.
        </p>
      </div>

      <h2>What this is not</h2>
      <div className="card" style={{ maxWidth: '70ch' }}>
        <p style={{ margin: 0, fontSize: '.92rem', color: 'var(--ink-2)' }}>
          A board approval proves knowledge of a registered commitment, not a signature over the
          event — so it is replayable across events, and we say so. Director identities are still
          public, because a ledger map lookup needs a public key; what the proof buys is credential
          secrecy, not voter anonymity. No production HSM. All data synthetic.
        </p>
      </div>
    </>
  );
}
