// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Demo = require('../demo.js');

function baseState(overrides) {
  return Object.assign({
    settings: { salary: 50000, payday: 1 },
    fixed: [{ id: 'f1', name: 'Rent', amount: 15000, dueDay: 5 }],
    debts: [],
    budgets: [{ id: 'b1', name: 'Food', amount: 15500 }],
    bills: [],
    savings: { emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, emergencyBalance: 0, emergencyTargetMonths: 3, investSaved: 0 },
    sinking: [],
    transactions: [],
    merchantRules: {},
    adjustment: null,
  }, overrides);
}

test('salary cycle runs from payday to the next payday', () => {
  assert.deepEqual(Core.cycleFor('2026-10-23', 1), { start: '2026-10-01', next: '2026-11-01', days: 31 });
  assert.deepEqual(Core.cycleFor('2026-10-23', 25), { start: '2026-09-25', next: '2026-10-25', days: 30 });
  // A payday of the 31st falls on the last day of short months.
  assert.deepEqual(Core.cycleFor('2027-02-28', 31), { start: '2027-02-28', next: '2027-03-31', days: 31 });
  assert.equal(Core.cycleFor('2027-02-27', 31).start, '2027-01-31');
});

test('due dates land inside the cycle', () => {
  const cycle = Core.cycleFor('2026-10-23', 25);
  assert.equal(Core.occurrenceInCycle(5, cycle), '2026-10-05');
  assert.equal(Core.occurrenceInCycle(28, cycle), '2026-09-28');
});

test('runway: no spending means the plan line ends with what is unassigned', () => {
  const s = baseState();
  const r = Core.projectRunway(s, '2026-10-01');
  assert.equal(r.zeroPlan, null);
  // 50,000 - 15,000 rent - 15,500 flexible = 19,500 left.
  assert.equal(Math.round(r.endPlan), 19500);
});

test('runway: overspending moves the zero date before payday', () => {
  const s = baseState({ settings: { salary: 30000, payday: 1 } });
  for (let d = 1; d <= 10; d++) {
    s.transactions.push({ id: 't' + d, date: '2026-10-' + String(d).padStart(2, '0'), amount: 1500, category: 'Food', note: '' });
  }
  const r = Core.projectRunway(s, '2026-10-10');
  // 30,000 - 15,000 - 15,000 spent = 0 today; spending 1,500/day after that goes negative tomorrow.
  assert.equal(r.balanceToday, 0);
  assert.equal(r.zeroPace, '2026-10-11');
  assert.equal(Math.round(r.paceRate), 1500);
});

test('emergency spending does not inflate the daily pace', () => {
  const s = baseState();
  s.transactions.push({ id: 'e', date: '2026-10-03', amount: 20000, category: 'Emergency', note: 'Medical' });
  s.transactions.push({ id: 'f', date: '2026-10-03', amount: 300, category: 'Food', note: '' });
  const r = Core.projectRunway(s, '2026-10-05');
  assert.equal(Math.round(r.paceRate), 60); // 300 over 5 days
  assert.equal(r.spentToDate, 20300);
});

test('a balance check replaces the worked-out balance from that day', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 } });
  s.balanceCheck = { date: '2026-10-20', amount: 9000 };
  s.transactions.push({ id: 'a', date: '2026-10-10', amount: 4000, category: 'Food', note: '' });
  s.transactions.push({ id: 'b', date: '2026-10-20', amount: 500, category: 'Food', note: '' });
  s.transactions.push({ id: 'c', date: '2026-10-21', amount: 700, category: 'Food', note: '' });
  const r = Core.projectRunway(s, '2026-10-22');
  // 9,000 this morning, minus 500 on the 20th and 700 on the 21st.
  assert.equal(r.balanceToday, 7800);
  assert.equal(r.points[18].actual, null);
  assert.equal(r.points[19].actual, 8500);
  // Pace counts only spending from the balance check: 1,200 over 3 days.
  assert.equal(Math.round(r.paceRate), 400);
  // Budget allows 500/day; the account allows 7,800 over 10 days.
  assert.equal(Math.round(r.dailyAllowance), 500);
});

test('safe to spend never exceeds what the account can cover', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 } });
  s.balanceCheck = { date: '2026-10-25', amount: 1400 };
  const r = Core.projectRunway(s, '2026-10-25');
  assert.equal(Math.round(r.dailyAllowance), 200); // 1,400 over 7 days
});

test('left to spend today goes down as you spend, and tomorrow adjusts', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 } });
  s.balanceCheck = { date: '2026-10-25', amount: 1400 };
  let r = Core.projectRunway(s, '2026-10-25');
  assert.equal(Math.round(r.leftToday), 200);
  s.transactions.push({ id: 'x', date: '2026-10-25', amount: 147, category: 'Food', note: '' });
  r = Core.projectRunway(s, '2026-10-25');
  assert.equal(Math.round(r.dailyAllowance), 200); // today's amount stays fixed
  assert.equal(Math.round(r.leftToday), 53);
  s.transactions.push({ id: 'y', date: '2026-10-25', amount: 253, category: 'Food', note: '' });
  r = Core.projectRunway(s, '2026-10-25');
  assert.equal(r.leftToday, 0);
  assert.equal(Math.round(r.overToday), 200);
  // 1,000 left over the 6 remaining days.
  assert.equal(Math.round(r.tomorrowAllowance), 167);
});

test('a balance check from an earlier cycle is ignored', () => {
  const s = baseState();
  s.balanceCheck = { date: '2026-09-20', amount: 100 };
  const r = Core.projectRunway(s, '2026-10-05');
  assert.equal(r.anchor, null);
  assert.equal(r.balanceToday, 35000);
});

test('money received raises the balance and today\'s amount', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 } });
  s.balanceCheck = { date: '2026-10-25', amount: 1400 };
  const before = Core.projectRunway(s, '2026-10-25');
  s.transactions.push({ id: 'in1', kind: 'in', date: '2026-10-25', amount: 3500, category: 'From family', note: 'Home' });
  const after = Core.projectRunway(s, '2026-10-25');
  assert.equal(after.balanceToday, before.balanceToday + 3500);
  assert.equal(after.spentToDate, 0, 'money in is not spending');
  // Budget was 500/day; 3,500 extra over the 7 days left adds 500/day.
  assert.equal(Math.round(after.dailyAllowance), Math.round(before.dailyAllowance) + 500);
});

test('money moved to a fund leaves the spending money', () => {
  const s = baseState();
  s.transactions.push({ id: 'in1', kind: 'in', date: '2026-10-03', amount: 5000, category: 'Refund', note: '', useFor: 'emergency' });
  assert.equal(Core.projectRunway(s, '2026-10-05').balanceToday, 35000);
  s.transactions[0].useFor = 'debt';
  s.transactions[0].debtPaid = 3000;
  assert.equal(Core.projectRunway(s, '2026-10-05').balanceToday, 37000);
});

test('choices for money received come with facts and a suggestion', () => {
  const s = baseState({
    debts: [{ id: 'cc', name: 'Credit card', balance: 50000, rate: 42, minPayment: 2500, dueDay: 20 }],
    savings: { emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, emergencyBalance: 60000, emergencyTargetMonths: 3, investSaved: 0 },
  });
  s.transactions.push({ id: 'in1', kind: 'in', date: '2026-10-05', amount: 5000, category: 'Money received', note: 'Rahul' });
  const o = Core.incomeOptions(s, 'in1', '2026-10-05');
  assert.deepEqual(o.options.map((x) => x.use), ['spend', 'emergency', 'debt', 'grow']);
  assert.equal(o.recommended, 'debt');
  assert.ok(o.interestSaved > 0);
  // With little in the emergency fund, that comes first.
  s.savings.emergencyBalance = 0;
  assert.equal(Core.incomeOptions(s, 'in1', '2026-10-05').recommended, 'emergency');
});

test('when money would run out before payday, the suggestion is to keep it', () => {
  const s = baseState({ settings: { salary: 30000, payday: 1 } });
  for (let d = 1; d <= 10; d++) s.transactions.push({ id: 't' + d, date: '2026-10-' + String(d).padStart(2, '0'), amount: 1500, category: 'Food', note: '' });
  s.transactions.push({ id: 'in1', kind: 'in', date: '2026-10-10', amount: 2000, category: 'Money received', note: '' });
  const o = Core.incomeOptions(s, 'in1', '2026-10-10');
  assert.equal(o.recommended, 'spend');
  assert.match(o.reason, /run out on 11 Oct/);
});

test('a monthly bill that varies shows on its due date for its estimate', () => {
  const s = baseState({ bills: [{ id: 'el', name: 'Electricity', estimate: 1300, everyMonths: 1, nextDue: '2026-10-15' }] });
  const r = Core.projectRunway(s, '2026-10-05');
  const e = r.events.find((x) => x.billId === 'el');
  assert.equal(e.date, '2026-10-15');
  assert.equal(e.amount, 1300);
  assert.equal(Core.monthlyPlan(s, '2026-10-05').variableBills, 1300);
});

test('a 3-month recharge costs one share each month', () => {
  const s = baseState({ bills: [{ id: 'mob', name: 'Mobile', estimate: 900, everyMonths: 3, nextDue: '2026-12-10' }] });
  // Not due in October: 300 goes to the pot on payday.
  let r = Core.projectRunway(s, '2026-10-05');
  let e = r.events.find((x) => x.billId === 'mob');
  assert.deepEqual([e.kind, e.date, e.amount], ['billpot', '2026-10-01', 300]);
  // Due in December: the pot (600) covers the rest, so this month pays 300.
  r = Core.projectRunway(s, '2026-12-05');
  e = r.events.find((x) => x.billId === 'mob');
  assert.deepEqual([e.kind, e.date, e.amount], ['bill', '2026-12-10', 300]);
  assert.equal(Core.monthlyPlan(s, '2026-10-05').variableBills, 300);
});

test('paying a bill learns its amount, period and next due date, and can be undone', () => {
  const s = baseState({ bills: [{ id: 'mob', name: 'Mobile', estimate: 299, everyMonths: 1, nextDue: '2026-10-10' }] });
  const before = Core.projectRunway(s, '2026-10-12').balanceToday;
  const tx = Core.payBill(s, 'mob', 899, 3, '2026-10-12');
  const b = s.bills[0];
  assert.equal(b.everyMonths, 3);
  assert.equal(b.estimate, 899);
  assert.equal(b.nextDue, '2027-01-10');
  // Paid this cycle: no estimate event; the payment itself leaves the account.
  const r = Core.projectRunway(s, '2026-10-12');
  assert.ok(!r.events.some((x) => x.billId === 'mob'));
  assert.equal(r.balanceToday, before + 299 - 899);
  assert.equal(r.spentToDate, 0, 'bill payments are not flexible spending');
  Core.undoBillPayment(s, tx);
  assert.deepEqual([b.estimate, b.everyMonths, b.nextDue], [299, 1, '2026-10-10']);
});

test('an overdue unpaid bill is counted today', () => {
  const s = baseState({ bills: [{ id: 'gas', name: 'Gas', estimate: 1100, everyMonths: 1, nextDue: '2026-10-03' }] });
  const e = Core.projectRunway(s, '2026-10-08').events.find((x) => x.billId === 'gas');
  assert.equal(e.date, '2026-10-08');
});

test('money moved to savings leaves the account but keeps later days on plan', () => {
  const s = baseState();
  s.transactions.push({ id: 'f', date: '2026-10-05', amount: 300, category: 'Food', note: '' });
  const before = Core.projectRunway(s, '2026-10-06');
  s.transactions.push({ id: 'm', kind: 'move', date: '2026-10-06', amount: 200, useFor: 'emergency', note: 'Unspent on 5 Oct' });
  const after = Core.projectRunway(s, '2026-10-06');
  assert.equal(after.balanceToday, before.balanceToday - 200);
  assert.equal(after.spentToDate, before.spentToDate, 'a move is not spending');
  assert.equal(Math.round(after.paceRate), Math.round(before.paceRate));
});

test('zones: green, amber and red', () => {
  const s = baseState({ settings: { salary: 30000, payday: 1 }, budgets: [{ id: 'g', name: 'Groceries', amount: 6200 }, { id: 'f', name: 'Food', amount: 6200 }] });
  // No spending: plenty left.
  assert.equal(Core.zoneStatus(s, '2026-10-10').zone, 'green');
  // Heavy spending: bills and basics still covered, but this pace runs out.
  for (let d = 1; d <= 10; d++) s.transactions.push({ id: 't' + d, date: '2026-10-' + String(d).padStart(2, '0'), amount: 700, category: 'Food', note: '' });
  let z = Core.zoneStatus(s, '2026-10-10');
  assert.equal(z.zone, 'amber');
  assert.ok(z.safeDaily > 0);
  // 3,000 this morning less 700 spent today leaves 2,300; groceries need 200/day x 21 days = 4,200.
  s.balanceCheck = { date: '2026-10-10', amount: 3000 };
  z = Core.zoneStatus(s, '2026-10-10');
  assert.equal(z.zone, 'red');
  assert.equal(Math.round(z.shortBy), 1900);
  // Moving the suggested amount from the emergency fund gets out of the red.
  s.savings.emergencyBalance = 5000;
  const fund = Core.zoneStatus(s, '2026-10-10').options.find((o) => o.kind === 'fund');
  s.transactions.push({ id: 'ef', kind: 'in', date: '2026-10-10', amount: fund.amount, category: 'From emergency fund', note: '', useFor: 'spend', fromFund: true });
  assert.notEqual(Core.zoneStatus(s, '2026-10-10').zone, 'red');
});

function cardState(extra) {
  return baseState(Object.assign({
    cards: [{ id: 'hd', name: 'HDFC card', last4: '1234', limit: 50000, statementDay: 5, dueDay: 25, rate: 42, created: '2026-09-01', setupStatement: 0, setupUnbilled: 0 }],
  }, extra));
}

test('card spending counts the day it happens; paying the bill changes nothing', () => {
  const s = cardState();
  const before = Core.projectRunway(s, '2026-10-12').balanceToday;
  s.transactions.push({ id: 'c1', date: '2026-10-10', amount: 1000, category: 'Food', note: 'Dinner', paidFrom: 'hd' });
  const spent = Core.projectRunway(s, '2026-10-12');
  assert.equal(spent.balanceToday, before - 1000);
  assert.equal(spent.spentToDate, 1000);
  Core.recordCardPayment(s, 'hd', 1000, '2026-10-12');
  assert.equal(Core.projectRunway(s, '2026-10-12').balanceToday, before - 1000);
});

test('card statement: amount, due date, what is left to pay, and spending since', () => {
  const s = cardState();
  s.transactions.push({ id: 'a', date: '2026-09-10', amount: 3000, category: 'Food', note: '', paidFrom: 'hd' });
  s.transactions.push({ id: 'b', date: '2026-09-20', amount: 2000, category: 'Food', note: '', paidFrom: 'hd' });
  s.transactions.push({ id: 'c', date: '2026-10-08', amount: 700, category: 'Food', note: '', paidFrom: 'hd' });
  let st = Core.cardStatus(s, s.cards[0], '2026-10-12');
  assert.deepEqual([st.statementDate, st.total, st.min, st.due, st.remaining, st.unbilled, st.owed, st.usedPct],
    ['2026-10-05', 5000, 250, '2026-10-25', 5000, 700, 5700, 11]);
  Core.recordCardPayment(s, 'hd', 2000, '2026-10-15');
  st = Core.cardStatus(s, s.cards[0], '2026-10-16');
  assert.equal(st.remaining, 3000);
  assert.equal(st.minLeft, 0);
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-26').overdue, true);
});

test('the statement SMS amount wins over the worked-out one', () => {
  const s = cardState();
  s.cards[0].statement = { date: '2026-10-05', total: 5400, min: 270, due: '2026-10-24' };
  const st = Core.cardStatus(s, s.cards[0], '2026-10-12');
  assert.deepEqual([st.total, st.min, st.due], [5400, 270, '2026-10-24']);
});

test('what was owed when the card was added shows as a bill on its due date', () => {
  const s = cardState({ cards: [{ id: 'hd', name: 'HDFC card', last4: '1234', limit: 50000, statementDay: 5, dueDay: 25, rate: 42,
    created: '2026-10-12', setupStatement: 8000, setupDueDate: '2026-10-25', setupUnbilled: 1500 }] });
  let r = Core.projectRunway(s, '2026-10-12');
  const e = r.events.filter((x) => x.kind === 'card');
  assert.deepEqual(e.map((x) => [x.date, x.amount]), [['2026-10-25', 8000]]);
  // The 1,500 spent before adding is billed on 5 Nov, due 25 Nov.
  r = Core.projectRunway(s, '2026-11-12');
  assert.deepEqual(r.events.filter((x) => x.kind === 'card').map((x) => [x.date, x.amount]), [['2026-11-12', 8000], ['2026-11-25', 1500]]);
  Core.recordCardPayment(s, 'hd', 3000, '2026-10-12');
  r = Core.projectRunway(s, '2026-10-12');
  // Added on the 12th: the 5 Oct statement is the one owed, not a new one.
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-12').total, 8000);
  assert.equal(r.events.find((x) => x.kind === 'card').amount, 5000);
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-12').remaining, 5000);
});

test('a balance check subtracts card spending not yet paid', () => {
  const s = cardState();
  s.transactions.push({ id: 'a', date: '2026-10-08', amount: 1200, category: 'Food', note: '', paidFrom: 'hd' });
  s.balanceCheck = { date: '2026-10-10', amount: 9000 };
  assert.equal(Core.projectRunway(s, '2026-10-10').balanceToday, 7800);
  Core.recordCardPayment(s, 'hd', 1200, '2026-10-09');
  assert.equal(Core.projectRunway(s, '2026-10-10').balanceToday, 9000);
});

test('EMI maths: 40,000 at 22% for 6 months', () => {
  const q = Core.emiQuote(40000, 22, 6, 0);
  // 40,000 x 0.01833 x 1.0183^6 / (1.0183^6 - 1) = 7,100.92
  assert.equal(q.emi, 7101);
  assert.equal(q.interest, 2606);
});

test('bill plan: full when the money is there, EMI only when clearly cheaper', () => {
  const s = cardState({ settings: { salary: 50000, payday: 1 } });
  s.transactions.push({ id: 'a', date: '2026-09-20', amount: 40000, category: 'Food', note: 'Phone', paidFrom: 'hd' });
  let p = Core.cardBillPlan(s, 'hd', '2026-10-12');
  assert.equal(p.due, 40000);
  assert.equal(p.suggested, 'full');
  assert.ok(p.minPlan.interestNextMonth > 1000);
  // Red: only 3,000 left this morning with groceries still to buy.
  s.budgets = [{ id: 'g', name: 'Groceries', amount: 15500 }];
  s.balanceCheck = { date: '2026-10-12', amount: 3000 };
  p = Core.cardBillPlan(s, 'hd', '2026-10-12', { rate: 22, months: 6, fee: 400 });
  assert.ok(p.short > 0);
  assert.equal(p.suggested, 'emi');
  assert.ok(p.compare.emiSaves > 0);
  assert.equal(p.payNow + p.rest, 40000);
});

test('converting to an EMI moves the amount to Debts', () => {
  const s = cardState();
  s.transactions.push({ id: 'a', date: '2026-09-20', amount: 40000, category: 'Food', note: '', paidFrom: 'hd' });
  const { tx, debt } = Core.convertCardBalance(s, 'hd', 30000, { kind: 'emi', rate: 22, months: 6, fee: 500 }, '2026-10-20');
  assert.equal(debt.minPayment, Core.emiQuote(30000, 22, 6, 0).emi);
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-21').remaining, 10000);
  assert.equal(Core.simulateDebts([debt], 0, 'avalanche', false).months, 6);
  // The fee is charged on the card, and the first EMI comes with the next bill (statement 5 Nov, due 25 Nov).
  assert.ok(s.transactions.some((t) => t.paidFrom === 'hd' && t.amount === 500));
  assert.equal(debt.starts, '2026-11-25');
  assert.ok(!Core.projectRunway(s, '2026-10-21').events.some((e) => e.name === 'HDFC card EMI'));
  assert.ok(Core.projectRunway(s, '2026-11-21').events.some((e) => e.name === 'HDFC card EMI' && e.date === '2026-11-25'));
  Core.undoCardConvert(s, tx);
  assert.equal(s.debts.length, 0);
  assert.ok(!s.transactions.some((t) => t.amount === 500));
});

test('card-free days count back from yesterday', () => {
  const s = cardState();
  s.transactions.push({ id: 'a', date: '2026-10-07', amount: 100, category: 'Food', note: '', paidFrom: 'hd' });
  s.transactions.push({ id: 'b', date: '2026-10-09', amount: 100, category: 'Food', note: '', paidFrom: 'account' });
  assert.equal(Core.cardFreeDays(s, '2026-10-12'), 4);
});

test('a smaller pay this month shrinks this month only', () => {
  const s = baseState({ budgets: [{ id: 'g', name: 'Groceries', amount: 0, auto: true }] });
  const usual = Core.monthlyPlan(s, '2026-10-05');
  s.payslips = { '2026-10-01': { amount: 47000, usual: 50000, reason: 'Tax deduction' } };
  const oct = Core.monthlyPlan(s, '2026-10-05');
  assert.equal(oct.salary, 47000);
  assert.equal(oct.flexTotal, usual.flexTotal - 3000);
  assert.equal(Core.projectRunway(s, '2026-10-05').balanceToday, Core.projectRunway(Object.assign({}, s, { payslips: {} }), '2026-10-05').balanceToday - 3000);
  assert.equal(Core.monthlyPlan(s, '2026-11-05').salary, 50000);
});

test('a bigger pay keeps the plan on usual pay (the extra is decided separately)', () => {
  const s = baseState();
  s.payslips = { '2026-10-01': { amount: 70000, usual: 50000, reason: 'Bonus' } };
  assert.equal(Core.salaryFor(s, '2026-10-05'), 50000);
});

test('pay history over the year', () => {
  const s = baseState();
  s.payslips = {
    '2026-08-01': { amount: 70000, usual: 50000, reason: 'Bonus' },
    '2026-10-01': { amount: 46500, usual: 50000, reason: 'Tax deduction', note: 'Q2 TDS' },
  };
  const h = Core.salaryHistory(s, '2026-10-05', 4);
  assert.deepEqual(h.map((x) => [x.start, x.amount, x.diff, x.reason]), [
    ['2026-07-01', 50000, 0, ''], ['2026-08-01', 70000, 20000, 'Bonus'], ['2026-09-01', 50000, 0, ''], ['2026-10-01', 46500, -3500, 'Tax deduction'],
  ]);
});

test('Days of Freedom: how long the fund covers the basics', () => {
  const s = baseState({ budgets: [{ id: 'g', name: 'Groceries', amount: 6000 }, { id: 'f', name: 'Food', amount: 9500 }] });
  // Basics: rent 15,000 + groceries 6,000 = 21,000 a month = 700 a day.
  s.savings.emergencyBalance = 7000;
  let f = Core.freedomDays(s, '2026-10-05');
  assert.deepEqual([f.days, Math.round(f.daily), f.badge], [10, 700, 'Starter shield']);
  s.savings.emergencyBalance = 0;
  assert.equal(Core.freedomDays(s, '2026-10-05').badge, 'Unprotected');
  s.savings.emergencyBalance = 70000;
  assert.equal(Core.freedomDays(s, '2026-10-05').badge, 'Unshakeable');
  // Nothing set up: no number rather than a silly one.
  assert.equal(Core.freedomDays(baseState({ fixed: [], budgets: [] }), '2026-10-05'), null);
});

test('interest leak counts loans and overdue card bills, not card bills paid on time', () => {
  const s = cardState({ debts: [{ id: 'pl', name: 'Personal loan', balance: 120000, rate: 14, minPayment: 4100, dueDay: 7 }] });
  s.transactions.push({ id: 'a', date: '2026-09-20', amount: 10000, category: 'Food', note: '', paidFrom: 'hd' });
  let l = Core.interestLeak(s, '2026-10-12');
  assert.equal(Math.round(l.daily), 46); // 120,000 x 14% / 365
  assert.equal(l.high, false);
  // After the 25 Oct due date the unpaid 10,000 at 42% starts costing.
  l = Core.interestLeak(s, '2026-10-26');
  assert.equal(Math.round(l.daily), 46 + 12);
  assert.equal(l.high, true);
  // 0% EMI: no leak.
  assert.equal(Core.interestLeak(baseState({ debts: [{ id: 'z', name: 'No-cost EMI', balance: 20000, rate: 0, minPayment: 2000, dueDay: 5 }] }), '2026-10-05').daily, 0);
});

test('payday preview subtracts only what this month can’t cover', () => {
  const s = cardState({ settings: { salary: 50000, payday: 1 } });
  // Card spending this month is already counted, so it doesn't reduce next payday.
  s.transactions.push({ id: 'a', date: '2026-10-03', amount: 2000, category: 'Food', note: '', paidFrom: 'hd' });
  let p = Core.nextPaydayPreview(s, '2026-10-05');
  assert.deepEqual([p.borrowed, p.effective], [0, 50000]);
  // An EMI starting next month does.
  Core.convertCardBalance(s, 'hd', 12000, { kind: 'emi', rate: 22, months: 6, fee: 0 }, '2026-10-05');
  p = Core.nextPaydayPreview(s, '2026-10-05');
  assert.equal(p.newCardDebt, Core.emiQuote(12000, 22, 6, 0).emi);
  assert.equal(p.effective, 50000 - p.newCardDebt);
  // So does this month's shortfall at the current pace.
  for (let d = 1; d <= 5; d++) s.transactions.push({ id: 'x' + d, date: '2026-10-0' + d, amount: 9000, category: 'Food', note: '' });
  p = Core.nextPaydayPreview(s, '2026-10-05');
  assert.ok(p.shortfall > 0);
  assert.equal(p.borrowed, p.shortfall + p.newCardDebt);
});

test('suggestion order: this month, a 30-day shield, expensive loans, full fund, invest', () => {
  const s = baseState({ budgets: [{ id: 'g', name: 'Groceries', amount: 6000 }], debts: [{ id: 'cc', name: 'Card balance', balance: 50000, rate: 42, minPayment: 2500, dueDay: 20 }] });
  assert.equal(Core.suggestUse(s, '2026-10-05', 'runs out').use, 'spend');
  // Basics 15,000 + 2,500 + 6,000 = 23,500 a month: 20 days is 15,667.
  s.savings.emergencyBalance = 15000;
  assert.equal(Core.suggestUse(s, '2026-10-05').use, 'emergency');
  s.savings.emergencyBalance = 25000;
  assert.equal(Core.suggestUse(s, '2026-10-05').use, 'debt');
  s.debts = [];
  assert.equal(Core.suggestUse(s, '2026-10-05').use, 'emergency');
  s.savings.emergencyBalance = 500000;
  assert.equal(Core.suggestUse(s, '2026-10-05').use, 'grow');
});

test('saving today comes off today’s amount in full; a moved leftover does not', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 } });
  s.balanceCheck = { date: '2026-10-25', amount: 1400 };
  let r = Core.projectRunway(s, '2026-10-25');
  assert.equal(Math.round(r.leftToday), 200);
  // ₹58 to Jar today: today's left drops by 58, but it isn't spending.
  s.transactions.push({ id: 'j', kind: 'move', date: '2026-10-25', amount: 58, category: 'Savings', note: 'Jar', useFor: 'emergency' });
  r = Core.projectRunway(s, '2026-10-25');
  assert.equal(Math.round(r.dailyAllowance), 200);
  assert.equal(Math.round(r.leftToday), 142);
  assert.equal(r.spentToday, 0);
  assert.equal(r.savedToday, 58);
  // Saving more than today's amount shows as over, and lowers tomorrow.
  s.transactions.push({ id: 'k', kind: 'move', date: '2026-10-25', amount: 300, category: 'Savings', note: 'RD', useFor: 'grow' });
  r = Core.projectRunway(s, '2026-10-25');
  assert.equal(r.leftToday, 0);
  assert.equal(Math.round(r.overToday), 158);
  assert.equal(Math.round(r.tomorrowAllowance), Math.round((1400 - 358) / 6));
});

test('yesterday’s leftover moved today belongs to yesterday', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 } });
  s.balanceCheck = { date: '2026-10-24', amount: 1600 };
  s.transactions.push({ id: 'y', date: '2026-10-24', amount: 142, category: 'Food', note: '' });
  const before = Core.projectRunway(s, '2026-10-25');
  s.transactions.push({ id: 'm', kind: 'move', date: '2026-10-25', forDate: '2026-10-24', amount: 58, category: 'Savings', note: 'Unspent on 24 Oct', useFor: 'emergency' });
  const after = Core.projectRunway(s, '2026-10-25');
  assert.equal(after.savedToday, 0);
  // Today's amount loses only the leftover that had rolled into it, not the full 58.
  assert.ok(after.leftToday < before.leftToday && before.leftToday - after.leftToday < 58);
});

test('payday reset: committed, set aside first, and the daily amount', () => {
  const s = baseState({
    debts: [{ id: 'pl', name: 'Personal loan', balance: 100000, rate: 14, minPayment: 4000, dueDay: 7 }],
    budgets: [{ id: 'g', name: 'Groceries', amount: 0, auto: true }],
    savings: { auto: false, emergencyMonthly: 3000, investMonthly: 0, debtExtra: 1000, emergencyBalance: 0, emergencyTargetMonths: 3 },
  });
  const r = Core.paydayReset(s, '2026-10-01');
  assert.equal(r.committedTotal, 15000 + 4000);
  assert.equal(r.free, 50000 - 19000);
  assert.equal(r.setAsideTotal, 4000);
  assert.equal(r.flexible, 31000 - 4000);
  assert.equal(Math.round(r.daily), Math.round(27000 / 31));
  // Editing this month's set-aside changes this month only.
  const e = Core.paydayReset(s, '2026-10-01', { emergency: 5000, debtExtra: 1000, invest: 0 });
  assert.equal(e.flexible, 25000);
  s.payslips = { '2026-10-01': { amount: 50000, usual: 50000, setAside: { emergency: 5000, debtExtra: 1000, invest: 0 } } };
  assert.equal(Core.monthlyPlan(s, '2026-10-05').emergency, 5000);
  assert.equal(Core.monthlyPlan(s, '2026-11-05').emergency, 3000);
});

test('locked-in set-asides are not taken off the balance twice', () => {
  const s = baseState({ savings: { auto: false, emergencyMonthly: 3000, investMonthly: 0, debtExtra: 0, emergencyBalance: 0 } });
  const before = Core.projectRunway(s, '2026-10-05');
  s.transactions.push({ id: 'sa', kind: 'move', date: '2026-10-01', amount: 3000, category: 'Savings', note: 'Emergency fund', useFor: 'emergency', setAside: '2026-10-01' });
  const after = Core.projectRunway(s, '2026-10-05');
  assert.equal(after.balanceToday, before.balanceToday);
  assert.equal(Math.round(after.dailyAllowance), Math.round(before.dailyAllowance));
});

test('debt plans: extra payments finish sooner and save interest', () => {
  const debts = [
    { name: 'Card', balance: 85000, rate: 42, minPayment: 4250 },
    { name: 'Loan', balance: 120000, rate: 14, minPayment: 4100 },
  ];
  const c = Core.compareDebtPlans(debts, 2000);
  assert.ok(c.avalanche.months < c.minimum.months);
  assert.ok(c.avalanche.totalInterest < c.minimum.totalInterest);
  assert.equal(c.avalanche.order[0].name, 'Card');
  assert.equal(c.snowball.order.length, 2);
});

test('debt plans: a minimum below the interest never pays off', () => {
  const res = Core.simulateDebts([{ name: 'Card', balance: 100000, rate: 42, minPayment: 2000 }], 0, 'avalanche', false);
  assert.equal(res.neverPaysOff, true);
});

test('snowball clears the smallest balance first', () => {
  const debts = [
    { name: 'Big expensive', balance: 90000, rate: 40, minPayment: 4000 },
    { name: 'Small cheap', balance: 10000, rate: 12, minPayment: 1000 },
  ];
  assert.equal(Core.simulateDebts(debts, 3000, 'snowball', true).order[0].name, 'Small cheap');
  assert.equal(Core.simulateDebts(debts, 3000, 'avalanche', true).order[1].name, 'Big expensive');
});

test('emergency plan uses the fund first, then frees monthly money', () => {
  const s = baseState({ savings: { emergencyMonthly: 2000, investMonthly: 3000, debtExtra: 0, emergencyBalance: 10000, emergencyTargetMonths: 3 } });
  const p = Core.emergencyPlan(s, 25000, 20, '2026-10-23');
  assert.equal(p.fromFund, 10000);
  assert.equal(p.shortfall, 15000);
  assert.equal(p.freed, 3000 + 3100); // Grow paused + 20% of 15,500
  assert.equal(p.recoverMonths, 3);
  assert.equal(p.refillMonths, 5);
  assert.equal(p.backOnTrack, '2027-01-23');
});

test('active adjustment lowers budgets and pauses Grow', () => {
  const s = baseState({
    savings: { emergencyMonthly: 1000, investMonthly: 3000, debtExtra: 500, emergencyBalance: 0, emergencyTargetMonths: 3 },
    adjustment: { until: '2026-12-01', flexCutPct: 20, pauseInvest: true, pauseDebtExtra: true, reason: 'Medical' },
  });
  const p = Core.monthlyPlan(s, '2026-10-23');
  assert.equal(p.invest, 0);
  assert.equal(p.debtExtra, 0);
  assert.equal(p.flexTotal, 12400);
  assert.equal(Core.monthlyPlan(s, '2026-12-01').invest, 3000);
});

test('set-asides send extra money to expensive debt, never to Grow', () => {
  const s = baseState({ debts: [{ name: 'Credit card', balance: 50000, rate: 40, minPayment: 2500, dueDay: 20 }] });
  const sv = Core.autoSavings(s);
  assert.equal(sv.investMonthly, 0);
  assert.ok(sv.debtExtra > 0);
  assert.ok(sv.emergencyMonthly > 0);
  assert.equal(Core.autoSavings(baseState()).debtExtra, 0);
  assert.ok(Core.autoSavings(baseState()).investMonthly > 0);
});

function autoState(extra) {
  return baseState(Object.assign({
    budgets: [
      { id: 'g', name: 'Groceries', amount: 0, auto: true },
      { id: 't', name: 'Travel', amount: 0, auto: true },
      { id: 'h', name: 'Health', amount: 0, auto: true },
    ],
  }, extra));
}

test('automatic budgets share out everything left of the salary', () => {
  // 50,000 - 15,000 rent = 35,000, split 30 : 15 : 5.
  const a = Core.allocate(autoState());
  const by = Object.fromEntries(a.budgets.map((b) => [b.id, b.amount]));
  assert.equal(a.pool, 35000);
  assert.equal(by.g + by.t + by.h, 35000);
  assert.equal(by.t, 10500);
  assert.equal(by.h, 3500);
  assert.equal(by.g, 21000);
  assert.equal(Core.monthlyPlan(autoState(), '2026-10-23').unallocated, 0);
});

test('editing one budget makes the automatic ones adjust', () => {
  const s = autoState();
  s.budgets[0].auto = false;
  s.budgets[0].amount = 5000;
  const by = Object.fromEntries(Core.allocate(s).budgets.map((b) => [b.id, b.amount]));
  assert.equal(by.g, 5000);
  assert.equal(by.t + by.h, 30000);
  assert.equal(by.t, 22500);
});

test('automatic set-asides come out before budgets are shared', () => {
  const s = autoState({ savings: { auto: true, emergencyBalance: 0, emergencyTargetMonths: 3 } });
  const a = Core.allocate(s);
  const set = a.savings.emergencyMonthly + a.savings.investMonthly + a.savings.debtExtra;
  assert.ok(set > 0);
  assert.equal(a.pool, 35000 - set);
  assert.equal(a.budgets.reduce((t, b) => t + b.amount, 0), a.pool);
});

test('when own amounts use everything, automatic budgets drop to zero', () => {
  const s = autoState();
  s.budgets[0].auto = false;
  s.budgets[0].amount = 40000;
  const a = Core.allocate(s);
  assert.equal(a.autoPool, 0);
  assert.ok(a.budgets.filter((b) => b.auto).every((b) => b.amount === 0));
  assert.equal(Core.monthlyPlan(s, '2026-10-23').unallocated, -5000);
});

test('SMS: reads common bank and UPI formats', () => {
  const t = '2026-10-23';
  const cases = [
    ['Rs.450.00 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici. Not you?', 450, 'Swiggy', 'Food & dining', '2026-10-21'],
    ['Sent Rs.250.00 From HDFC Bank A/C *1234 To ZOMATO On 21/10/26 Ref 123456', 250, 'Zomato', 'Food & dining', '2026-10-21'],
    ['Spent Rs 1,299 on your SBI Credit Card ending 1234 at AMAZON on 21/10/26.', 1299, 'Amazon', 'Shopping', '2026-10-21'],
    ['INR 649.00 spent on ICICI Bank Card XX1234 on 21-Oct-26 on NETFLIX. Avl Limit: INR 50,000', 649, 'Netflix', 'Entertainment', '2026-10-21'],
    ['Your a/c XX1234 debited for INR 320.00 on 22Oct26. Info: UPI/P2M/629912/UBER INDIA. Avl bal Rs 12,000', 320, 'Uber India', 'Travel', '2026-10-22'],
  ];
  for (const [sms, amount, merchant, category, date] of cases) {
    const p = Core.parseSms(sms, {}, t);
    assert.equal(p.type, 'debit', sms);
    assert.equal(p.amount, amount, sms);
    assert.equal(p.merchant, merchant, sms);
    assert.equal(p.category, category, sms);
    assert.equal(p.date, date, sms);
  }
});

test('SMS: money received gets the sender, and salary is recognised', () => {
  const p = Core.parseSms('Rs 2,000 credited to your a/c XX1234 on 23-10-26 by UPI from RAHUL SHARMA. Avl bal Rs 5,000', {}, '2026-10-23');
  assert.equal(p.type, 'credit');
  assert.equal(p.merchant, 'Rahul Sharma');
  assert.equal(p.category, 'Money received');
  assert.equal(p.salary, false);
  assert.equal(Core.parseSms('Rs 55,000 credited to your a/c XX1234 on 01-10-26 by NEFT SALARY', {}, '2026-10-23').salary, true);
  assert.equal(Core.parseSms('Refund of Rs 499 credited to your a/c from AMAZON on 20-10-26', {}, '2026-10-23').category, 'Refund');
});

test('SMS: credits are marked, OTPs and offers are skipped', () => {
  assert.equal(Core.parseSms('Rs 55,000 credited to your a/c XX1234 on 01-10-26 by NEFT SALARY', {}, '2026-10-23').type, 'credit');
  assert.equal(Core.parseSms('123456 is your OTP for txn of Rs 500', {}, '2026-10-23'), null);
  assert.equal(Core.parseSms('Get 20% off on orders above Rs 499!', {}, '2026-10-23'), null);
});

test('SMS: learned categories win over keywords', () => {
  const p = Core.parseSms('Rs.900 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici.', { swiggy: 'Groceries' }, '2026-10-23');
  assert.equal(p.category, 'Groceries');
});

test('SMS key matches the Android app (SmsParser.key)', () => {
  // Values printed by the Java SmsParser for the same text.
  assert.equal(Core.smsKey('Rs.450.00 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici. Not you? Call 18001234.'), 's1c0a7a35');
  assert.equal(Core.smsKey('Rs 55,000 credited to your a/c XX1234 on 01-10-26 by NEFT SALARY'), 'sd45634e8');
  // Line breaks and spacing don't change the key.
  assert.equal(Core.smsKey('Rs 55,000 credited to your a/c\nXX1234 on 01-10-26 by NEFT  SALARY'), 'sd45634e8');
});

test('SMS: card or account, and which card', () => {
  const t = '2026-10-23';
  let p = Core.parseSms('Spent Rs 1,299 on your SBI Credit Card ending 1234 at AMAZON on 21/10/26.', {}, t);
  assert.deepEqual([p.type, p.paidFrom, p.last4], ['debit', 'card', '1234']);
  p = Core.parseSms('INR 649.00 spent on ICICI Bank Card XX5566 on 21-Oct-26 on NETFLIX. Avl Limit: INR 50,000', {}, t);
  assert.deepEqual([p.paidFrom, p.last4], ['card', '5566']);
  p = Core.parseSms('Rs 500 spent on your Debit Card XX9876 at DMART on 21-10-26. Avl Bal Rs 2,000', {}, t);
  assert.deepEqual([p.paidFrom, p.last4], ['account', null]);
  p = Core.parseSms('Rs.450.00 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici.', {}, t);
  assert.equal(p.paidFrom, 'account');
});

test('SMS: card statement with total, minimum and due date', () => {
  const p = Core.parseSms('Your HDFC Bank Credit Card XX1234 statement is ready. Total Amount Due: Rs 8,400.50, Minimum Amount Due: Rs 420. Due date: 05-Nov-26.', {}, '2026-10-23');
  // 8,400.50 rounds up to 8,401: paying that clears the bill.
  assert.deepEqual([p.type, p.amount, p.min, p.due, p.last4], ['statement', 8401, 420, '2026-11-05', '1234']);
});

test('SMS: a card bill payment is not income or spending', () => {
  let p = Core.parseSms('Payment of Rs 8,400.00 received on your HDFC Credit Card XX1234 on 23-10-26. Thank you.', {}, '2026-10-23');
  assert.deepEqual([p.type, p.amount, p.last4], ['cardpayment', 8400, '1234']);
  p = Core.parseSms('Rs 8,400 debited from A/c XX5678 on 23-10-26 towards HDFC Credit Card XX1234 bill payment.', {}, '2026-10-23');
  assert.deepEqual([p.type, p.last4], ['cardpayment', '1234']);
  // A loan EMI "payment received" without a card stays as before.
  assert.equal(Core.parseSms('Payment of Rs 3,200.00 to BAJAJ FINANCE received for loan EMI.', {}, '2026-10-23').type, 'debit');
});

test('SMS: transfers to savings apps are recognised, look-alike names are not', () => {
  const t = '2026-10-23';
  assert.equal(Core.parseSms('Rs.58.00 debited from a/c **1234 on 23-10-26 to VPA jar@axisbank. Ref 991', {}, t).category, 'Savings');
  assert.equal(Core.parseSms('Rs.5,000 debited from a/c **1234 to VPA groww.sip@hdfcbank on 05-10-26', {}, t).category, 'Savings');
  assert.equal(Core.parseSms('Rs.320 debited from a/c **1234 to VPA rajaranisweets@ybl on 21-10-26', {}, t).category, 'Misc');
  // A saved entry leaves the account but isn't spending.
  const s = baseState();
  s.transactions.push({ id: 'm', kind: 'move', date: '2026-10-05', amount: 200, category: 'Savings', note: 'Jar', useFor: null });
  const r = Core.projectRunway(s, '2026-10-05');
  assert.equal(r.balanceToday, 35000 - 200);
  assert.equal(r.spentToDate, 0);
});

test('SMS batch splits on blank lines or one message per line', () => {
  assert.equal(Core.splitSmsBatch('Rs 10 debited\n\nRs 20 debited').length, 2);
  assert.equal(Core.splitSmsBatch('Rs 10 debited to A\nRs 20 debited to B\nRs 30 debited to C').length, 3);
});

test('example data produces a runway and insights', () => {
  const s = Demo.demoState('2026-10-23');
  const r = Core.projectRunway(s, '2026-10-23');
  assert.equal(r.points.length, 31);
  assert.ok(r.zeroPace, 'example overspends so the pace line crosses zero');
  const ins = Core.insights(s, '2026-10-23');
  assert.ok(ins.some((i) => i.level === 'warn'));
  assert.ok(ins.some((i) => /subscription/.test(i.title)));
});

test('before you borrow: the emergency fund goes first for an urgent cost', () => {
  const s = baseState();
  s.savings.emergencyBalance = 20000;
  const c = Core.borrowCheck(s, 5000, '2026-10-10');
  assert.deepEqual([c.urgent.fromFund, c.urgent.pause, c.urgent.fromMonth, c.urgent.shortfall], [5000, 0, 0, 0]);
  // Basics: 15,000 rent a month = 500 a day.
  assert.equal(c.urgent.freedomBefore, 40);
  assert.equal(c.urgent.freedomAfter, 30);
  // The fund pays for it, so the daily amount doesn't change.
  assert.equal(Math.round(c.urgent.dailyAfter), Math.round(c.daily));
  assert.equal(c.urgent.borrow, null);
});

test('before you borrow: only the shortfall is borrowed, and its cost is shown', () => {
  const s = baseState();
  // 50,000 salary less 15,000 rent (paid on the 5th): 35,000 can be spared.
  const c = Core.borrowCheck(s, 40000, '2026-10-10');
  assert.equal(c.spare, 35000);
  assert.deepEqual([c.urgent.fromFund, c.urgent.fromMonth, c.urgent.shortfall], [0, 35000, 5000]);
  assert.equal(c.urgent.borrow.amount, 5000);
  assert.equal(c.urgent.borrow.cardRate, 42);
  assert.equal(c.urgent.borrow.loan.emi, Core.emiQuote(5000, 16, 12, 0).emi);
  assert.ok(c.urgent.borrow.card.interest > c.urgent.borrow.loan.interest);
});

test('before you borrow: a purchase that can wait', () => {
  const s = baseState();
  const small = Core.borrowCheck(s, 3000, '2026-10-10');
  assert.equal(small.wait.fits, true);
  assert.ok(small.wait.dailyAfter < small.daily);
  const big = Core.borrowCheck(s, 120000, '2026-10-10');
  assert.equal(big.wait.fits, false);
  assert.deepEqual(big.wait.save.map((x) => [x.months, x.monthly, x.ready]),
    [[3, 40000, '2027-01-01'], [6, 20000, '2027-04-01'], [12, 10000, '2027-10-01']]);
  assert.ok(big.wait.save.every((x) => x.emi.interest > 0));
});

test('borrowed this month: card spending and loans, not refunds', () => {
  const s = baseState({ transactions: [
    { id: 't1', date: '2026-10-03', amount: 1000, category: 'Food', paidFrom: 'c1' },
    { id: 't2', date: '2026-10-03', amount: 500, category: 'Food' },
    { id: 't3', kind: 'in', date: '2026-10-04', amount: 20000, category: 'Loan or Pay Later', borrowed: true, useFor: 'spend' },
    { id: 't4', kind: 'in', date: '2026-10-05', amount: 200, category: 'Refund', paidFrom: 'c1', useFor: 'spend' },
    { id: 't5', date: '2026-09-20', amount: 900, category: 'Food', paidFrom: 'c1' },
  ] });
  assert.deepEqual(Core.borrowedThisCycle(s, '2026-10-10'), { total: 21000, card: 1000, loans: 20000 });
});

test('loan payouts in bank SMS are recognised', () => {
  assert.equal(Core.isLoanCredit('Rs 20,000 credited to a/c XX12. Loan disbursed by KreditBee'), true);
  assert.equal(Core.isLoanCredit('INR 5,000 credited to your a/c from NAVI'), true);
  assert.equal(Core.isLoanCredit('Your personal loan amount Rs.50000 has been credited'), true);
  assert.equal(Core.isLoanCredit('INR 5,000 credited by NEFT from RAHUL SHARMA'), false);
  assert.equal(Core.isLoanCredit('Rs 500 credited. Navigate to the app to see it'), false);
});

test('rollover: a cleared loan keeps paying into savings', () => {
  const s = baseState({ debts: [{ id: 'd1', name: 'Card loan', balance: 50000, rate: 36, minPayment: 2500, dueDay: 7 }] });
  const before = Core.allocate(s, '2026-10-10');
  s.savings.rollovers = [{ id: 'r1', from: 'Bike EMI', amount: 3000, to: 'debt' }, { id: 'r2', from: 'Half your raise', amount: 1000, to: 'grow' }];
  const a = Core.allocate(s, '2026-10-10');
  assert.equal(a.savings.debtExtra, 3000);
  assert.equal(a.savings.investMonthly, 1000);
  assert.deepEqual(a.rollover, { emergency: 0, debt: 3000, grow: 1000, total: 4000 });
  assert.equal(a.pool, before.pool - 4000);
  // With no loans left, money meant for loans builds the emergency fund.
  s.debts[0].balance = 0;
  assert.equal(Core.allocate(s, '2026-10-10').savings.emergencyMonthly, 3000);
  // The payday reset includes it, and its own amounts replace it once saved.
  assert.equal(Core.paydayReset(s, '2026-10-10').parts.emergency, 3000);
  s.payslips = { '2026-10-01': { amount: 50000, usual: 50000, setAside: { emergency: 500, invest: 0, debtExtra: 0 } } };
  assert.equal(Core.allocate(s, '2026-10-10').savings.emergencyMonthly, 500);
});

test('rollover: choices and the safety-first suggestion', () => {
  const s = baseState({ debts: [{ id: 'd1', name: 'Card loan', balance: 50000, rate: 36, minPayment: 2500, dueDay: 7 }] });
  const o = Core.rolloverOptions(s, 3000, '2026-10-10');
  assert.deepEqual(o.options.map((x) => x.to), ['debt', 'emergency', 'grow', 'spend']);
  assert.match(o.options[0].detail, /sooner/);
  // No emergency fund yet: a 30-day shield comes first.
  assert.equal(o.recommended, 'emergency');
  s.savings.emergencyBalance = 40000;
  assert.equal(Core.rolloverOptions(s, 3000, '2026-10-10').recommended, 'debt');
});

test('where to invest: freedom first, then a split by age and risk comfort', () => {
  const s = baseState({ debts: [{ id: 'd1', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 7 }] });
  s.savings.investMonthly = 3000;
  assert.equal(Core.investPlan(s, '2026-10-10').stage, 'shield');
  s.savings.emergencyBalance = 30000;
  const d = Core.investPlan(s, '2026-10-10');
  assert.equal(d.stage, 'debt');
  assert.match(d.reason, /Card at 36%/);
  s.debts[0].balance = 0;
  assert.equal(Core.investPlan(s, '2026-10-10').stage, 'fund');
  s.savings.emergencyBalance = 500000;
  const g = Core.investPlan(s, '2026-10-10');
  assert.equal(g.stage, 'invest');
  // No age, medium risk: 60% equity, 30% debt, 10% gold, in whole hundreds.
  assert.deepEqual([g.equity, g.debt, g.gold], [60, 30, 10]);
  assert.deepEqual(g.lines.map((l) => l.amount), [1800, 900, 300]);
  s.settings.age = 40; s.settings.risk = 'low';
  const low = Core.investPlan(s, '2026-10-10');
  assert.deepEqual([low.equity, low.debt], [45, 45]);
  s.settings.age = 25; s.settings.risk = 'high';
  assert.equal(Core.investPlan(s, '2026-10-10').equity, 85);
});

test('SIP projection grows monthly investments at the assumed rate', () => {
  assert.equal(Core.sipValue(1000, 0, 10), 120000);
  // ₹1,000 a month for 10 years at 12% a year: about ₹2.32 lakh.
  assert.equal(Math.round(Core.sipValue(1000, 12, 10)), 232339);
  const s = baseState();
  s.savings.investMonthly = 2000;
  s.settings.personal = false;
  assert.equal(Core.personal(s), false);
  assert.match(Core.rolloverOptions(s, 1000, '2026-10-10').options.find((o) => o.to === 'grow').detail, /SEBI-registered/);
  s.settings.personal = true;
  assert.match(Core.rolloverOptions(s, 1000, '2026-10-10').options.find((o) => o.to === 'grow').detail, /Grow tab/);
});
