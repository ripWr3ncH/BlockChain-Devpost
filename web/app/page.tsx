import Link from 'next/link';

/**
 * Overview. The thesis, the number that motivates it, and one door.
 *
 * The reference's landing surface is a stack of outlined cards with a progress
 * meter near the top and a grid of pastel tiles below it. That shape is kept,
 * because it happens to be exactly right here: the meter is a board vote, and the
 * tiles are the three things the contract can be asked to do.
 */
export default function Home() {
  return (
    <>
      <section style={{ maxWidth: '60rem', margin: '.5rem 0 2rem' }}>
        <span className="eyebrow">Brainwave 2026 · Midnight Track</span>
        <h1 style={{ maxWidth: '17ch' }}>A board vote that proves itself.</h1>
        <p className="sub" style={{ fontSize: '1rem', marginTop: '1.1rem', maxWidth: '56ch' }}>
          Supervisors already require board approval before a bank writes a loan off. Proving you
          had it normally means <strong>publishing every director&rsquo;s signature</strong> — handing
          a competitor your governance record. Quorum proves the vote happened and discloses nothing
          but the count.
        </p>
        <div className="row" style={{ marginTop: '1.5rem' }}>
          <Link href="/board" style={{ textDecoration: 'none' }}>
            <button>Watch a rule refuse something →</button>
          </Link>
        </div>
      </section>

      {/* The shape of the claim, before any numbers. */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '.7rem' }}>
          <h3 style={{ margin: 0 }}>What the ledger learns</h3>
          <span className="status on">2 of 3</span>
        </div>
        <div className="meter met">
          <span style={{ width: '67%' }} />
        </div>
        <div className="meter-labels">
          <span>enough directors approved</span>
          <span>which ones · never recorded</span>
        </div>
        <p className="hint">
          The approving credentials go in as a private witness. The circuit counts them and
          discloses the count. Nothing else crosses the boundary.
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: '2rem' }}>
        <div className="card">
          <div className="stat alert">
            <span className="value">4.2×</span>
            <span className="label">assessed vs reported</span>
          </div>
          <p className="hint">
            An Asset Quality Review of six banks found $147,595M of non-performing loans against
            $35,044M reported.
          </p>
        </div>
        <div className="card">
          <div className="stat alert">
            <span className="value">once</span>
            <span className="label">how often the book is read</span>
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
            Director approvals are proved in zero knowledge. The secrets never reach the chain.
          </p>
        </div>
      </div>

      <h2>What the contract enforces</h2>
      <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
        <div className="tile mint">
          <span className="chip" aria-hidden>
            📄
          </span>
          <span className="label">Loan lifecycle</span>
          <span className="status on">append-only</span>
        </div>
        <div className="tile violet">
          <span className="chip" aria-hidden>
            ⚖
          </span>
          <span className="label">Board threshold</span>
          <span className="status on">k-of-n · ZK</span>
        </div>
        <div className="tile peach">
          <span className="chip" aria-hidden>
            📕
          </span>
          <span className="label">Director registry</span>
          <span className="status on">council-confirmed</span>
        </div>
      </div>

      <h2>The trade nobody should have to make</h2>
      <div className="card lilac" style={{ maxWidth: '70ch', marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, fontSize: '.92rem', color: 'var(--ink-2)' }}>
          A supervisor needs to know that <strong>enough of the right people approved</strong>. It
          does not need to know who they were, or what they signed. Those are two different
          questions, and only one of them requires anyone to publish anything. Midnight is what
          makes the distinction expressible in a contract rather than a policy document.
        </p>
      </div>

      <h2>What this is not</h2>
      <div className="card" style={{ maxWidth: '70ch' }}>
        <p style={{ margin: 0, fontSize: '.92rem', color: 'var(--ink-2)' }}>
          An approval proves knowledge of a registered commitment, not a signature over the event —
          so it is replayable across events, and we say so rather than let the demo imply otherwise.
          Director identities are still public, because a ledger map lookup needs a public key; what
          the proof buys is credential secrecy, not voter anonymity. No production HSM. All data
          synthetic.
        </p>
      </div>
    </>
  );
}
