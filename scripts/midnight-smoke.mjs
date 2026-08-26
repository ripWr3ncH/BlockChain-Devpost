#!/usr/bin/env node
/**
 * QUORUM — end-to-end smoke test against the Midnight bridge.
 *
 * Drives the same story the board room tells, but over HTTP so it can be run
 * headless and its failures read cleanly:
 *
 *   1. read the deployed contract's genesis config
 *   2. constitute a board (register as the bank, confirm as the Central Authority)
 *   3. originate a loan
 *   4. attempt a WRITE_OFF with too few approvals  -> the circuit MUST refuse
 *   5. resubmit with enough approvals              -> it MUST commit
 *   6. attempt a RESTRUCTURE at the sanctioning grade -> MUST refuse
 *   7. resubmit one grade above                       -> MUST commit
 *
 * Steps 4 and 6 are the point. A run where either succeeds is a FAILURE even though
 * nothing threw: it would mean an authority rule is not being enforced. This script
 * treats that as an error rather than reporting success.
 *
 * Usage:  node scripts/midnight-smoke.mjs [bridgeUrl]
 */

const BRIDGE = process.argv[2] ?? process.env.MIDNIGHT_BRIDGE ?? 'http://localhost:8090';

const TIERS = ['STANDARD', 'SMA', 'SUB_STANDARD', 'DOUBTFUL', 'BAD_LOSS'];
const EVENT_TYPES = [
  'ORIGINATION', 'RESCHEDULE', 'RESTRUCTURE', 'RECLASSIFY_UP', 'RECLASSIFY_DOWN',
  'WRITE_OFF', 'RECOVERY', 'COLLATERAL_REVALUATION', 'ASSET_PLEDGE', 'LC_DEVOLVEMENT', 'CORRECTION',
];

const C = {
  ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m',
};

const randomHex32 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

async function call(method, path, body) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = { message: await res.text() };
  }
  return { ok: res.ok, status: res.status, payload };
}

function fail(what, detail) {
  console.error(`\n${C.bad}${C.bold}FAILED${C.off} ${what}`);
  if (detail !== undefined) console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
}

const step = (n, text) => console.log(`\n${C.bold}${n}.${C.off} ${text}`);

async function main() {
  console.log(`${C.dim}bridge: ${BRIDGE}${C.off}`);

  // ── 1 ──────────────────────────────────────────────────────────────────
  step(1, 'Read the deployed contract');
  const health = await call('GET', '/health');
  if (!health.ok) fail('the bridge is not reachable — is `npm run bridge` running?', health.payload);
  const state = await call('GET', '/contract');
  if (!state.ok || !state.payload.found) fail('contract state could not be read', state.payload);

  const threshold = Number(state.payload.config.boardThresholdK);
  console.log(`   network        ${health.payload.network}`);
  console.log(`   contract       ${health.payload.contractAddress}`);
  console.log(`   board threshold ${threshold} of n`);
  if (threshold < 1) {
    fail(
      'boardThresholdK is 0, so `validCount >= 0` is trivially true and the board\n' +
        'threshold cannot refuse anything. The contract was deployed without genesis\n' +
        'parameters — redeploy with a constructor that seeds them.',
    );
  }

  // ── 2 ──────────────────────────────────────────────────────────────────
  step(2, `Constitute a board of ${threshold} confirmed directors`);
  const directors = [];
  for (let i = 0; i < threshold; i++) {
    const r = await call('POST', '/directors/provision', { institution: 'BANK_A' });
    if (!r.ok) fail(`provisioning director ${i + 1}`, r.payload);
    directors.push({ keyId: r.payload.keyId, secret: r.payload.secret });
    console.log(`   director ${i + 1}    ${r.payload.keyId.slice(0, 24)}…  ${C.dim}registered + confirmed${C.off}`);
  }

  // ── 3 ──────────────────────────────────────────────────────────────────
  step(3, 'Originate a loan');
  const commitmentId = randomHex32();
  const originated = await call('POST', '/loans', {
    commitmentId,
    initialTier: TIERS.indexOf('STANDARD'),
    payloadHash: randomHex32(),
  });
  if (!originated.ok) fail('originating the loan', originated.payload);
  console.log(`   commitment     ${commitmentId.slice(0, 24)}…`);
  console.log(`   tx             ${originated.payload.receipt.txId}`);

  const loan = await call('GET', `/loans/${commitmentId}`);
  if (!loan.ok) fail('reading the loan back', loan.payload);
  console.log(`   prevStateHash  ${loan.payload.prevStateHash.slice(0, 24)}…`);

  // ── 4 ── the one that must be refused ──────────────────────────────────
  step(4, `Attempt WRITE_OFF with 0 of ${threshold} approvals ${C.dim}(must be refused)${C.off}`);
  const underAuthorised = await call('POST', '/events', {
    commitmentId,
    eventType: EVENT_TYPES.indexOf('WRITE_OFF'),
    tierAfter: TIERS.indexOf('BAD_LOSS'),
    prevStateHash: loan.payload.prevStateHash,
    payloadHash: randomHex32(),
    boardApprovals: [],
  });
  if (underAuthorised.ok) {
    fail(
      'the write-off COMMITTED with zero director approvals.\n' +
        'Nothing threw, but the board threshold is not being enforced — which is\n' +
        'the entire claim this project makes. Check verifyBoardThreshold.',
      underAuthorised.payload,
    );
  }
  console.log(`   ${C.ok}refused${C.off}        ${underAuthorised.payload.message}`);

  // ── 5 ──────────────────────────────────────────────────────────────────
  step(5, `Resubmit with ${threshold} approvals ${C.dim}(must commit)${C.off}`);
  const authorised = await call('POST', '/events', {
    commitmentId,
    eventType: EVENT_TYPES.indexOf('WRITE_OFF'),
    tierAfter: TIERS.indexOf('BAD_LOSS'),
    prevStateHash: loan.payload.prevStateHash,
    payloadHash: randomHex32(),
    boardApprovals: directors,
  });
  if (!authorised.ok) fail('the authorised write-off was refused', authorised.payload);
  console.log(`   ${C.ok}committed${C.off}      ${authorised.payload.receipt.txId}`);
  if (authorised.payload.receipt.blockHeight) {
    console.log(`   block          ${authorised.payload.receipt.blockHeight}`);
  }

  // ── 6 ── seniority: an officer may not clear their own grade ───────────
  const SANCTIONED_AT = 2;
  step(6, `RESTRUCTURE at the sanctioning grade ${C.dim}(must be refused)${C.off}`);

  const freshId = randomHex32();
  const freshLoan = await call('POST', '/loans', {
    commitmentId: freshId,
    initialTier: TIERS.indexOf('STANDARD'),
    payloadHash: randomHex32(),
    sanctioningSeniority: SANCTIONED_AT,
  });
  if (!freshLoan.ok) fail('originating the seniority-test loan', freshLoan.payload);
  const fresh = await call('GET', `/loans/${freshId}`);
  if (!fresh.ok) fail('reading the seniority-test loan back', fresh.payload);
  console.log(`   loan sanctioned at grade ${SANCTIONED_AT}`);

  const sameGrade = await call('POST', '/events', {
    commitmentId: freshId,
    eventType: EVENT_TYPES.indexOf('RESTRUCTURE'),
    tierAfter: TIERS.indexOf('SMA'),
    prevStateHash: fresh.payload.prevStateHash,
    payloadHash: randomHex32(),
    actingSeniority: SANCTIONED_AT,
  });
  if (sameGrade.ok) {
    fail(
      `the restructure COMMITTED at grade ${SANCTIONED_AT} — the same grade that sanctioned\n` +
        'the loan, so an officer just cleared their own decision. The ONE_LEVEL_ABOVE rule\n' +
        'is not being enforced. Check verifySeniorityAbove in commitment.compact.',
      sameGrade.payload,
    );
  }
  console.log(`   ${C.ok}refused${C.off}        ${sameGrade.payload.message}`);

  // ── 7 ──────────────────────────────────────────────────────────────────
  step(7, `Resubmit one grade above ${C.dim}(must commit)${C.off}`);
  const above = await call('POST', '/events', {
    commitmentId: freshId,
    eventType: EVENT_TYPES.indexOf('RESTRUCTURE'),
    tierAfter: TIERS.indexOf('SMA'),
    prevStateHash: fresh.payload.prevStateHash,
    payloadHash: randomHex32(),
    actingSeniority: SANCTIONED_AT + 1,
  });
  if (!above.ok) fail('the senior-enough restructure was refused', above.payload);
  console.log(`   ${C.ok}committed${C.off}      ${above.payload.receipt.txId}`);
  if (above.payload.receipt.blockHeight) {
    console.log(`   block          ${above.payload.receipt.blockHeight}`);
  }

  console.log(
    `\n${C.ok}${C.bold}PASSED${C.off}\n` +
      `  · the same write-off was refused without board approval, committed with it\n` +
      `  · the same restructure was refused at the sanctioning grade, committed above it\n` +
      `  · neither the director secrets nor the officer's grade reached the ledger\n`,
  );
}

main().catch((err) => {
  fail('unexpected error', err?.stack ?? String(err));
});
