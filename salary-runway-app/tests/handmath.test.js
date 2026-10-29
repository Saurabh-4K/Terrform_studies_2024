// A hand-made salary cycle: every number below was worked out on paper first.
// ₹30,000 salary, payday on the 1st, November (30 days), ₹10,000 rent on the 5th, nothing set aside.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

function cycle() {
  return {
    settings: { salary: 30000, payday: 1 },
    fixed: [{ id: 'f1', name: 'Rent', amount: 10000, dueDay: 5 }],
    debts: [], bills: [], sinking: [], cards: [],
    budgets: [{ id: 'b1', name: 'Food', amount: 0, auto: true }, { id: 'b2', name: 'Shopping', amount: 0, auto: true }],
    savings: { auto: false, emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, emergencyBalance: 0, emergencyTargetMonths: 3, investSaved: 0 },
    transactions: [], merchantRules: {}, adjustment: null,
  };
}
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 0.01, what + ': got ' + got + ', want ' + want);

test('hand math: day 1, the bill to come is taken off before the daily amount', () => {
  const s = cycle();
  const p = Core.monthlyPlan(s, '2026-11-01');
  assert.equal(p.flexTotal, 20000);
  assert.equal(p.budgets.reduce((a, b) => a + b.amount, 0), 20000);
  const r = Core.projectRunway(s, '2026-11-01');
  assert.equal(r.balanceToday, 30000);
  assert.equal(r.billsAhead, 10000);
  near(r.dailyAllowance, 20000 / 30, 'daily amount');
  near(r.endPace, 0, 'payday balance at pace');
  assert.equal(Core.zoneStatus(s, '2026-11-01', r).zone, 'green');
});

test('hand math: spending, saving and money in each change the balance once', () => {
  const s = cycle();
  s.transactions.push({ id: 't1', date: '2026-11-01', amount: 1000, category: 'Food' });
  let r = Core.projectRunway(s, '2026-11-01');
  assert.equal(r.balanceToday, 29000);
  near(r.overToday, 1000 - 20000 / 30, 'over today');
  near(r.tomorrowAllowance, 19000 / 29, 'tomorrow');
  near(Core.projectRunway(s, '2026-11-02').dailyAllowance, 19000 / 29, 'day 2');

  // A move to savings leaves the account but isn't spending.
  s.transactions.push({ id: 'm1', kind: 'move', date: '2026-11-02', amount: 2000, category: 'Savings', useFor: 'emergency' });
  r = Core.projectRunway(s, '2026-11-02');
  assert.equal(r.balanceToday, 27000);
  assert.equal(r.spentToDate, 1000);
  assert.equal(r.leftToday, 0);
  assert.equal(Core.spendWhere(s, '2026-11-02').total, 1000);
  assert.deepEqual([Core.spendTrend(s, '2026-11-02', 1)[0].spent, Core.spendTrend(s, '2026-11-02', 1)[0].saved], [1000, 2000]);
  near(Core.projectRunway(s, '2026-11-03').dailyAllowance, 17000 / 28, 'day 3');

  s.transactions.push({ id: 'i1', kind: 'in', date: '2026-11-03', amount: 5000, category: 'Money received', useFor: 'spend' });
  r = Core.projectRunway(s, '2026-11-03');
  assert.equal(r.balanceToday, 32000);
  assert.equal(r.extraIn, 5000);
  // Rent was due on the 5th. Not recorded yet: still in the account, still to pay.
  r = Core.projectRunway(s, '2026-11-06');
  assert.equal(r.balanceToday, 32000);
  assert.deepEqual([r.dueTotal, r.billsAhead], [10000, 10000]);
  // Recorded as paid on the 5th: it leaves the account then, and nothing is left to pay
  Core.payFixed(s, 'f1', { amount: 10000, date: '2026-11-05' });
  r = Core.projectRunway(s, '2026-11-06');
  assert.equal(r.balanceToday, 22000);
  assert.equal(r.billsAhead, 0);
});

test('hand math: card spending counts once, when it happens, not again when the bill is paid', () => {
  const s = cycle();
  s.cards = [{ id: 'c1', name: 'HDFC', last4: '1', limit: 50000, rate: 42, statementDay: 20, dueDay: 8, created: '2026-10-01' }];
  s.transactions.push({ id: 'k1', date: '2026-11-07', amount: 1500, category: 'Shopping', paidFrom: 'c1' });
  Core.payFixed(s, 'f1', { amount: 10000, date: '2026-11-05' });
  assert.equal(Core.projectRunway(s, '2026-11-07').balanceToday, 30000 - 10000 - 1500);
  Core.recordCardPayment(s, 'c1', 1500, '2026-11-10', 'account');
  assert.equal(Core.projectRunway(s, '2026-11-10').balanceToday, 30000 - 10000 - 1500);
});

test('hand math: category changes, cycle edges and a payday change', () => {
  const s = cycle();
  s.transactions.push({ id: 't1', date: '2026-11-01', amount: 1000, category: 'Food' }, { id: 't2', date: '2026-11-07', amount: 1500, category: 'Shopping' });
  s.transactions[0].category = 'Shopping';
  assert.deepEqual(Core.spendWhere(s, '2026-11-10').categories.map((c) => [c.name, c.spent]), [['Shopping', 2500]]);
  s.transactions.push({ id: 'e1', date: '2026-11-30', amount: 300, category: 'Food' }, { id: 'e2', date: '2026-12-01', amount: 400, category: 'Food' });
  assert.equal(Core.spendWhere(s, '2026-11-30').total, 2800);
  assert.equal(Core.spendWhere(s, '2026-12-01').total, 400);
  s.settings.payday = 15;
  assert.deepEqual(Core.cycleFor('2026-11-20', 15), Object.assign({}, Core.cycleFor('2026-11-20', 15), { start: '2026-11-15', next: '2026-12-15' }));
  assert.equal(Core.spendWhere(s, '2026-11-20').total, 0);
});

test('hand math: lower pay, and emergency spending out of the balance but not the pace', () => {
  const s = cycle();
  s.payslips = { '2026-11-01': { amount: 25000, usual: 30000, reason: 'Unpaid leave' } };
  let r = Core.projectRunway(s, '2026-11-01');
  assert.deepEqual([r.plan.salary, r.plan.flexTotal, r.balanceToday], [25000, 15000, 25000]);
  const t = cycle();
  for (let d = 1; d <= 4; d++) t.transactions.push({ id: 'f' + d, date: '2026-11-0' + d, amount: 600, category: 'Food' });
  t.transactions.push({ id: 'e', date: '2026-11-03', amount: 5000, category: 'Emergency' });
  Core.payFixed(t, 'f1', { amount: 10000, date: '2026-11-05' });
  r = Core.projectRunway(t, '2026-11-05');
  assert.equal(r.balanceToday, 30000 - 2400 - 5000 - 10000);
  near(r.paceRate, 600, 'pace');
});
