// Reimbursable expenses and the side vault: the feature's acceptance cases (AC-01 … AC-09) and edge cases.
// Synthetic household, payday on the 1st, so September and October are separate rounds.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const base = () => ({
  settings: { salary: 60000, payday: 1 }, fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [],
  budgets: [{ id: 'b1', name: 'Travel', amount: 0, auto: true }, { id: 'b2', name: 'Misc', amount: 0, auto: true }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  balanceCheck: { date: '2026-09-01', amount: 50000 },
});
const SEP = '2026-09-25';
const OCT = '2026-10-11';
const run = (s, d) => Core.projectRunway(s, d);
const worth = (s, d) => Core.netWorth(s, d).value;
const view = (s) => Core.reimbView(s);
// A reimbursable expense: ₹2,000 bus ticket on 20 Sep, all of it eligible.
function withClaim(routing) {
  const s = base();
  s.transactions.push({ id: 'bus', date: '2026-09-20', amount: 2000, category: 'Travel', note: 'Redbus' });
  const c = Core.addClaim(s, 'bus', { routing, who: 'Office', ref: 'CLM-1' }, '2026-09-20T10:00:00Z');
  return { s, c };
}
function pay(s, amount, date, claimIds, id) {
  s.transactions.push({ id: id || 'in' + amount, kind: 'in', date: date || OCT, amount, category: 'Money received', note: 'Office', useFor: null });
  return Core.recordPayout(s, id || 'in' + amount, claimIds);
}

test('AC-01 a reimbursable ₹2,000 expense: cash −2,000, owed back +2,000, no budget impact, PENDING', () => {
  const s = base();
  const r0 = run(s, SEP); const w0 = worth(s, SEP);
  s.transactions.push({ id: 'bus', date: '2026-09-20', amount: 2000, category: 'Travel', note: 'Redbus' });
  const spentAsPlain = run(s, SEP).spentToDate;
  const c = Core.addClaim(s, 'bus', {}, 'now');
  const r1 = run(s, SEP);
  assert.equal(r1.balanceToday - r0.balanceToday, -2000);
  assert.equal(view(s).pendingFloat, 2000);
  assert.equal(r1.spentToDate - r0.spentToDate, 0);
  assert.equal(spentAsPlain - r0.spentToDate, 2000);
  assert.equal(view(s).claims[0].status, 'PENDING');
  assert.equal(worth(s, SEP) - w0, 0); // cash out, receivable in
  assert.ok(c.id);
});

test('AC-02 settled with ₹2,300: cash +2,300, nothing outstanding, SETTLED, margin 300, recorded once', () => {
  const { s, c } = withClaim('daily');
  const r0 = run(s, OCT);
  const p = pay(s, 2300, OCT, [c.id]);
  const v = view(s);
  assert.equal(run(s, OCT).balanceToday - r0.balanceToday, 2300);
  assert.deepEqual([v.claims[0].outstanding, v.claims[0].status, v.claims[0].margin], [0, 'SETTLED', 300]);
  // The same money-in entry can't be recorded as a payout twice
  assert.equal(Core.recordPayout(s, p.txId, [c.id]), null);
  assert.equal(view(s).payouts.length, 1);
});

test('AC-03 daily routing: +300 to this month\'s budget, vault 0, cash +2,300', () => {
  const { s, c } = withClaim('daily');
  const r0 = run(s, OCT);
  pay(s, 2300, OCT, [c.id]);
  const r1 = run(s, OCT);
  assert.equal(r1.extraIn - r0.extraIn, 300);
  assert.equal(view(s).vault, 0);
  assert.equal(r1.balanceToday - r0.balanceToday, 2300);
});

test('AC-04 side-vault routing: vault +300, no budget credit, net worth +300 either way', () => {
  const a = withClaim('vault');
  const b = withClaim('daily');
  const w0 = worth(a.s, OCT);
  const r0 = run(a.s, OCT);
  pay(a.s, 2300, OCT, [a.c.id]);
  pay(b.s, 2300, OCT, [b.c.id]);
  const r1 = run(a.s, OCT);
  assert.equal(view(a.s).vault, 300);
  assert.equal(r1.extraIn - r0.extraIn, 0);
  // Kept apart from daily money
  assert.equal(r1.kept - r0.kept, 300);
  assert.equal(worth(a.s, OCT) - w0, 300);
  assert.equal(worth(b.s, OCT), worth(a.s, OCT));
  assert.equal(Core.netWorth(a.s, OCT).vault, 300);
});

test('AC-05 cross-month: September stays as it was; October gets the cash; owed back falls', () => {
  const { s, c } = withClaim('daily');
  const sep = (st) => { const r = run(st, '2026-09-30'); return JSON.stringify([r.spentToDate, Core.spendWhere(st, '2026-09-30', 'cycle').categories.map((x) => [x.name, x.spent])]); };
  const before = sep(s);
  const octCash = run(s, OCT).balanceToday;
  pay(s, 2300, OCT, [c.id]);
  assert.equal(sep(s), before);
  assert.equal(run(s, OCT).balanceToday - octCash, 2300);
  assert.equal(view(s).pendingFloat, 0);
});

test('AC-06 partial: ₹1,200 of ₹2,000 → ₹800 outstanding, PARTIALLY_REIMBURSED, no margin', () => {
  const { s, c } = withClaim('daily');
  const r0 = run(s, OCT);
  pay(s, 1200, OCT, [c.id]);
  const v = view(s).claims[0];
  assert.deepEqual([v.outstanding, v.status, v.margin], [800, 'PARTIALLY_REIMBURSED', 0]);
  assert.equal(run(s, OCT).extraIn - r0.extraIn, 0);
  // The rest comes later with ₹100 extra: margin only now, by that payout
  pay(s, 900, '2026-10-20', [c.id], 'in900');
  const v2 = view(s);
  assert.deepEqual([v2.claims[0].status, v2.claims[0].margin, v2.payouts.map((p) => p.marginDaily)], ['SETTLED', 100, [0, 100]]);
});

test('AC-07 under-reimbursed: ₹1,800 of ₹2,000 → PARTIAL until closed; closing makes ₹200 your spending', () => {
  const { s, c } = withClaim('daily');
  pay(s, 1800, OCT, [c.id]);
  assert.equal(view(s).claims[0].status, 'PARTIALLY_REIMBURSED');
  const sepSpent = run(s, '2026-09-30').spentToDate;
  const w0 = worth(s, OCT);
  Core.claimSet(s, c.id, { closed: true }, 'now');
  const v = view(s).claims[0];
  assert.deepEqual([v.status, v.shortfall, v.outstanding], ['CLOSED', 200, 0]);
  assert.equal(run(s, '2026-09-30').spentToDate - sepSpent, 200);
  assert.equal(worth(s, OCT) - w0, -200);
  // Reopened: back to owed
  Core.claimSet(s, c.id, { closed: false }, 'now');
  assert.equal(view(s).claims[0].outstanding, 200);
});

test('AC-08 idempotent: re-syncing and switching routing back and forth never duplicates', () => {
  const { s, c } = withClaim('daily');
  pay(s, 2300, OCT, [c.id]);
  const snap = () => JSON.stringify([run(s, OCT).extraIn, run(s, OCT).balanceToday, view(s).vault, worth(s, OCT), s.transactions.length]);
  const daily = snap();
  for (let i = 0; i < 3; i++) Core.syncReimb(s);
  assert.equal(snap(), daily);
  Core.claimSet(s, c.id, { routing: 'vault' }, 'now');
  const vault = snap();
  Core.claimSet(s, c.id, { routing: 'vault' }, 'now');
  assert.equal(snap(), vault);
  Core.claimSet(s, c.id, { routing: 'daily' }, 'now');
  assert.equal(snap(), daily);
  assert.equal(s.transactions.filter((t) => t.kind === 'in').length, 1);
});

test('AC-09 regression: money identities hold with claims in the data', () => {
  const { s, c } = withClaim('vault');
  pay(s, 2300, OCT, [c.id]);
  const n = Core.netWorth(s, OCT);
  assert.equal(n.value, Math.round(n.own - n.owe));
  const r = run(s, OCT);
  assert.equal(Core.spendWhere(s, OCT, 'cycle').categories.reduce((a, x) => a + x.spent, 0), r.spentToDate);
  // The work ticket isn't in September's "where my money went"
  assert.equal(Core.spendWhere(s, '2026-09-30', 'cycle').categories.reduce((a, x) => a + x.spent, 0), 0);
  ['balanceToday', 'dailyAllowance', 'endPace'].forEach((k) => assert.ok(Number.isFinite(r[k]), k));
});

test('overpayment across two claims: each gets what it\'s owed; the rest is flagged, not profit', () => {
  const s = base();
  s.transactions.push({ id: 'a', date: '2026-09-10', amount: 1000, category: 'Travel', note: 'Ola' }, { id: 'b', date: '2026-09-12', amount: 1000, category: 'Travel', note: 'Uber' });
  const c1 = Core.addClaim(s, 'a', {}, 'now');
  const c2 = Core.addClaim(s, 'b', {}, 'now');
  pay(s, 2500, OCT, [c1.id, c2.id]);
  const v = view(s);
  assert.deepEqual(v.claims.map((c) => [c.status, c.margin]), [['SETTLED', 0], ['SETTLED', 0]]);
  assert.equal(v.unallocated, 500);
  assert.equal(v.payouts[0].marginDaily, 0);
});

test('partly eligible, deleting entries and changing the amount keep every link right', () => {
  const s = base();
  s.transactions.push({ id: 'hotel', date: '2026-09-10', amount: 5000, category: 'Travel', note: 'Hotel' });
  const r0 = run(s, SEP).spentToDate;
  const c = Core.addClaim(s, 'hotel', { eligible: 4000 }, 'now');
  // ₹1,000 of it is yours
  assert.equal(r0 - run(s, SEP).spentToDate, 4000);
  assert.equal(Core.addClaim(s, 'hotel', {}, 'now'), null);
  pay(s, 4000, OCT, [c.id]);
  // Deleting the payout's entry: owed again
  const payTx = s.transactions.find((t) => t.payoutId);
  Core.reimbForget(s, payTx);
  s.transactions = s.transactions.filter((t) => t !== payTx);
  assert.equal(view(s).pendingFloat, 4000);
  // The expense is now ₹3,000: eligible follows, never above what was paid
  const hotel = s.transactions.find((t) => t.id === 'hotel');
  hotel.amount = 3000;
  Core.reimbAmount(s, hotel);
  assert.deepEqual([view(s).claims[0].eligible, hotel.reimbExcluded], [3000, 3000]);
  // Deleting the expense removes the claim
  Core.reimbForget(s, hotel);
  s.transactions = s.transactions.filter((t) => t !== hotel);
  assert.deepEqual([view(s).claims.length, view(s).pendingFloat], [0, 0]);
});
