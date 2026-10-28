// Maybe expenses: costs that may or may not come. Likely ones are held, maybe ones are shown
// as "if it happens", unlikely ones are listed. Made-up household, payday on the 1st.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-10';
// 22 days to payday (10 Oct to 31 Oct). ₹20,000 in the account, ₹6,000 rent still to pay on the 25th.
const base = () => ({
  settings: { salary: 50000, payday: 1 },
  fixed: [{ id: 'rent', name: 'Rent', amount: 6000, dueDay: 25 }],
  debts: [], bills: [], sinking: [], goals: [], cards: [],
  budgets: [{ id: 'b1', name: 'Misc', amount: 40000 }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  balanceCheck: { date: T, amount: 20000 },
});
const run = (s) => Core.projectRunway(s, T);
const add = (s, likely, amount, date) => Core.addMaybe(s, { name: 'Wedding gift', amount, date: date || '2026-10-20', likely }, 'now');

test('likely: held from today\'s limit, the balance and net worth stay as they are', () => {
  const s = base();
  const r0 = run(s);
  // (20,000 − 6,000 rent) ÷ 22 days = ₹636
  assert.equal(Math.round(r0.limit.byMoney), 636);
  add(s, 'likely', 10000);
  const r1 = run(s);
  // (20,000 − 10,000 held − 6,000 rent) ÷ 22 = ₹182
  assert.equal(r1.held, 10000);
  assert.equal(Math.round(r1.limit.byMoney), 182);
  assert.equal(Math.round(r1.dailyAllowance), 182);
  assert.equal(r1.balanceToday, r0.balanceToday);
  assert.equal(Core.netWorth(s, T).value, Core.netWorth(base(), T).value);
});

test('maybe: today\'s limit unchanged, and what it would be if it comes', () => {
  const s = base();
  add(s, 'maybe', 10000);
  assert.equal(run(s).held, 0);
  assert.equal(Math.round(run(s).dailyAllowance), 636);
  const w = Core.maybeIfHappens(s, T);
  assert.deepEqual([w.amount, w.count, Math.round(w.limit)], [10000, 1, 182]);
});

test('unlikely: only listed; a likely cost next round is held only then, and shows in next payday', () => {
  const s = base();
  add(s, 'unlikely', 10000);
  assert.equal(run(s).held, 0);
  assert.equal(Core.maybeIfHappens(s, T), null);
  const s2 = base();
  const before = Core.nextPaydayPreview(s2, T);
  add(s2, 'likely', 4000, '2026-11-05');
  assert.equal(run(s2).held, 0);
  const after = Core.nextPaydayPreview(s2, T);
  assert.deepEqual([after.maybeNext, after.freeAfter], [4000, before.freeAfter - 4000]);
  assert.equal(Core.projectRunway(s2, '2026-11-02').held, 4000);
});

test('it came: the payment is in reports but not daily spending; the hold is released', () => {
  const s = base();
  const m = add(s, 'likely', 10000);
  const r1 = run(s);
  s.transactions.push({ id: 'g', date: T, amount: 12000, category: 'Family', note: 'Gift' });
  assert.ok(Core.maybeCandidates(s, m.id, T).some((t) => t.id === 'g'));
  assert.equal(Core.maybeHappened(s, m.id, 'g', 'now'), true);
  const r2 = run(s);
  assert.equal(r2.held, 0);
  assert.equal(r2.spentToDate, r1.spentToDate);
  assert.equal(r2.balanceToday, r1.balanceToday - 12000);
  // It cost ₹2,000 more than held: the account has that much less to cover the days ahead
  assert.equal(Math.round(r2.limit.money - r1.limit.money), -2000);
  assert.equal(Core.spendWhere(s, T, 'cycle').categories.reduce((a, c) => a + c.spent, 0), 12000);
  // The same payment can't pay two costs
  const m2 = add(s, 'likely', 12000);
  assert.equal(Core.maybeHappened(s, m2.id, 'g', 'now'), false);
  // Deleting the payment: the cost is open again
  const tx = s.transactions.find((t) => t.id === 'g');
  Core.maybeForget(s, tx);
  s.transactions = s.transactions.filter((t) => t !== tx);
  assert.equal(run(s).held, 22000);
});

test('it didn\'t come: the hold goes back to today\'s limit; reopening holds it again', () => {
  const s = base();
  const m = add(s, 'likely', 10000, '2026-10-05');
  assert.deepEqual(Core.maybeDue(s, T).map((x) => x.id), [m.id]);
  Core.maybeDidnt(s, m.id, 'now');
  assert.equal(run(s).held, 0);
  assert.equal(Math.round(run(s).dailyAllowance), 636);
  assert.equal(Core.maybeDue(s, T).length, 0);
  Core.maybeReopen(s, m.id);
  assert.equal(run(s).held, 10000);
});

test('how good the guesses were, per likelihood', () => {
  const s = base();
  const a = add(s, 'likely', 10000);
  const b = add(s, 'likely', 5000);
  add(s, 'maybe', 3000);
  s.transactions.push({ id: 'g', date: T, amount: 12000, category: 'Family', note: 'Gift' });
  Core.maybeHappened(s, a.id, 'g', 'now');
  Core.maybeDidnt(s, b.id, 'now');
  const st = Core.maybeStats(s);
  assert.deepEqual(st.likely, { answered: 2, happened: 1, rate: 0.5, guess: 10000, actual: 12000 });
  assert.equal(st.maybe.answered, 0);
});

test('bad input is refused; backup and restore keep the list', () => {
  const s = base();
  assert.equal(Core.addMaybe(s, { name: 'x', amount: 0, date: T, likely: 'likely' }, 'now'), null);
  assert.equal(Core.addMaybe(s, { name: 'x', amount: 100, date: T, likely: 'sure' }, 'now'), null);
  add(s, 'likely', 10000);
  const back = Core.cleanState(JSON.parse(JSON.stringify(s)));
  assert.equal(run(back).held, 10000);
  assert.equal(Core.cleanState(Object.assign(base(), { maybe: 'oops' })).maybe, undefined);
});
