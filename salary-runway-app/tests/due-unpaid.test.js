// A payment due with nothing recorded: the balance shows only what really left the account,
// and the payment stays to pay. Made-up household: payday the 1st, balance entered on 28 Oct.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-29';
// ₹90,000 in the bank on the 28th. Rent ₹20,000 due the 28th, EMI ₹5,000 due the 30th. 3 days to payday.
const base = () => ({
  settings: { salary: 60000, payday: 1 },
  fixed: [{ id: 'rent', name: 'Rent', amount: 20000, dueDay: 28 }],
  debts: [{ id: 'pl', name: 'Personal loan', balance: 100000, rate: 12, minPayment: 5000, dueDay: 30 }],
  bills: [], sinking: [], goals: [], cards: [],
  budgets: [{ id: 'b1', name: 'Misc', amount: 20000 }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  balanceCheck: { date: '2026-10-28', amount: 90000 },
});
const run = (s, d) => Core.projectRunway(s, d || T);

test('rent due yesterday, not recorded: the balance is the bank\'s, and the rent is still to pay', () => {
  const s = base();
  s.transactions.push({ id: 'g', date: T, amount: 1000, category: 'Groceries', note: '' });
  const r = run(s);
  // 90,000 − 1,000 groceries: only what really left
  assert.equal(r.balanceToday, 89000);
  assert.deepEqual(r.dueNow.map((e) => [e.name, e.date, e.amount]), [['Rent', '2026-10-28', 20000]]);
  // Still to pay: rent 20,000 + EMI 5,000 on the 30th
  assert.equal(r.billsAhead, 25000);
  // (89,000 + 1,000 spent today − 25,000) ÷ 3 days = ₹21,667
  assert.equal(Math.round(r.limit.byMoney), 21667);
  // Payday comes with the same money as if the rent had been taken off: the projection pays it today
  assert.equal(r.points[r.idxToday].actual, 89000);
  assert.equal(r.points[r.idxToday].plan, 69000);
  // Net worth counts the rent once, as owed; the loan's EMI is part of the loan already
  const n = Core.netWorth(s, T);
  assert.deepEqual([n.money, n.dueUnpaid, n.loans], [89000, 20000, 100000]);
  assert.equal(n.value, 89000 - 20000 - 100000);
});

test('recorded as paid: it leaves the balance, and isn\'t to pay any more; nothing else moves', () => {
  const s = base();
  const r0 = run(s);
  const n0 = Core.netWorth(s, T).value;
  const z0 = Core.zoneStatus(s, T, r0);
  Core.payFixed(s, 'rent', { amount: 20000, date: '2026-10-28' });
  const r1 = run(s);
  assert.equal(r1.balanceToday, r0.balanceToday - 20000);
  assert.equal(r1.billsAhead, r0.billsAhead - 20000);
  assert.equal(r1.dueTotal, 0);
  assert.equal(r1.dailyAllowance, r0.dailyAllowance);
  assert.equal(r1.endPace, r0.endPace);
  assert.equal(Core.netWorth(s, T).value, n0);
  assert.equal(Core.zoneStatus(s, T, r1).shortBy, z0.shortBy);
});

test('the EMI on its own day is due too, until paid; a balance entered after a due date is taken to include it', () => {
  const s = base();
  const r = run(s, '2026-10-30');
  assert.deepEqual(r.dueNow.map((e) => e.name), ['Rent', 'Personal loan']);
  assert.equal(r.balanceToday, 90000);
  assert.equal(r.billsAhead, 25000);
  // Paid the EMI on the 30th: interest first, then the loan
  const tx = Core.payFixed(s, 'pl', { amount: 5000, date: '2026-10-30' });
  assert.deepEqual([tx.emiInterest, tx.emiPrincipal], [1000, 4000]);
  assert.deepEqual(run(s, '2026-10-30').dueNow.map((e) => e.name), ['Rent']);
  // Balance entered on the 29th: the rent due the 28th is taken to be in it, as before
  s.balanceCheck = { date: T, amount: 70000 };
  assert.equal(run(s).dueTotal, 0);
});

test('short of money: the shortfall is the same whether it\'s shown as gone or still to pay', () => {
  const s = base();
  s.balanceCheck = { date: '2026-10-28', amount: 22000 };
  const r = run(s);
  const z = Core.zoneStatus(s, T, r);
  assert.equal(r.balanceToday, 22000);
  assert.equal(z.zone, 'red');
  // 22,000 − 25,000 to pay = 3,000 short before any basics
  assert.ok(z.shortBy >= 3000);
  assert.equal(Core.feasibility(s, T).status, 'short');
  // 2,000 left once the rent is paid; the ₹5,000 EMI tomorrow takes it below zero
  assert.equal(r.zeroPace, '2026-10-30');
});

test('a new round starts from what was left once the due payments were paid', () => {
  const s = base();
  // Rent never recorded; on the 1st the new round carries 90,000 − 20,000 − 5,000
  const r = run(s, '2026-11-01');
  assert.equal(r.carried, 65000);
});
