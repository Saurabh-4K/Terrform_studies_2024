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
  assert.equal(Math.round(r.paceRate), 75); // 300 over the 4 finished days
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
  // Pace counts only spending from the balance check: 1,200 over the 2 finished days.
  assert.equal(Math.round(r.paceRate), 600);
  // Budget allows 500/day; the account allows 7,800 over 10 days.
  assert.equal(Math.round(r.dailyAllowance), 500);
});

test('midnight alone doesn’t change the forecast; a day spent under pace does', () => {
  const s = baseState({ settings: { salary: 45500, payday: 1 }, budgets: [{ id: 'b1', name: 'Food', amount: 0, auto: true }] });
  for (let d = 1; d <= 20; d++) s.transactions.push({ id: 't' + d, date: '2026-10-' + String(d).padStart(2, '0'), amount: 1000, category: 'Food' });
  const at = (day) => { const r = Core.projectRunway(s, day); return { pace: Math.round(r.paceRate), end: Math.round(r.endPace), zone: Core.zoneStatus(s, day, r).zone }; };
  // 11 pm on the 20th, the usual ₹1,000 spent: ₹500 short at payday
  assert.deepEqual(at('2026-10-20'), { pace: 1000, end: -500, zone: 'amber' });
  // Just after midnight, nothing done: the same forecast (it used to turn green here)
  assert.deepEqual(at('2026-10-21'), { pace: 1000, end: -500, zone: 'amber' });
  // Spending less than usual today helps only once the day is over
  s.transactions.push({ id: 'x', date: '2026-10-21', amount: 200, category: 'Food' });
  assert.equal(at('2026-10-21').end, -500);
  assert.equal(at('2026-10-22').zone, 'green');
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
  assert.deepEqual(o.options.map((x) => x.use), ['spend', 'emergency', 'debt', 'keep', 'grow']);
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
  assert.deepEqual([f.days, Math.round(f.daily), f.badge, f.level], [10, 700, 'Building', 'amber']);
  // 20 more days (₹14,000) to 30: green
  assert.deepEqual(f.next, { days: 20, amount: 14000, target: 30, level: 'green' });
  assert.deepEqual(f.parts, { fixed: 15000, debtMin: 0, bills: 0, essentials: 6000 });
  s.savings.emergencyBalance = 0;
  f = Core.freedomDays(s, '2026-10-05');
  assert.deepEqual([f.badge, f.level, f.next.days, f.next.amount, f.next.level], ['At risk', 'red', 7, 4900, 'amber']);
  s.savings.emergencyBalance = 4800; // 6 days: still red
  assert.equal(Core.freedomDays(s, '2026-10-05').level, 'red');
  s.savings.emergencyBalance = 21000; // 30 days
  assert.deepEqual([Core.freedomDays(s, '2026-10-05').level, Core.freedomDays(s, '2026-10-05').badge], ['green', 'A month safe']);
  s.savings.emergencyBalance = 70000;
  f = Core.freedomDays(s, '2026-10-05');
  assert.deepEqual([f.badge, f.next], ['Three months safe', null]);
  // Nothing set up: no number rather than a silly one.
  assert.equal(Core.freedomDays(baseState({ fixed: [], budgets: [] }), '2026-10-05'), null);
});

test('interest leak counts loans and overdue card bills, not card bills paid on time', () => {
  const s = cardState({ debts: [{ id: 'pl', name: 'Personal loan', balance: 120000, rate: 14, minPayment: 4100, dueDay: 7 }] });
  s.transactions.push({ id: 'a', date: '2026-09-20', amount: 10000, category: 'Food', note: '', paidFrom: 'hd' });
  let l = Core.interestLeak(s, '2026-10-12');
  assert.equal(Math.round(l.daily), 46); // 120,000 x 14% / 365
  assert.equal(l.high, false);
  // After the 25 Oct due date the unpaid 10,000 at 42% plus 18% GST (49.6%) starts costing: 13.59 a day.
  l = Core.interestLeak(s, '2026-10-26');
  assert.equal(Math.round(l.daily), Math.round(120000 * 14 / 36500 + 10000 * 49.6 / 36500));
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

test('month-end report card: wins and watch-outs for the cycle that just ended', () => {
  const s = baseState({
    debts: [{ id: 'd1', name: 'Card loan', balance: 40000, rate: 36, minPayment: 2000, dueDay: 7 }],
    cards: [{ id: 'c1', name: 'HDFC', last4: '1234', limit: 50000, rate: 42, statementDay: 5, dueDay: 25 }],
    transactions: [
      // October (the cycle that ended): two days on the card
      { id: 't1', date: '2026-10-03', amount: 900, category: 'Food', paidFrom: 'c1' },
      { id: 't2', date: '2026-10-09', amount: 150, category: 'Food', paidFrom: 'c1' },
      { id: 't3', date: '2026-10-09', amount: 16000, category: 'Food' },
      // small payments under ₹200 (bills don't count)
      { id: 't4', date: '2026-10-12', amount: 120, category: 'Food' },
      { id: 't5', date: '2026-10-13', amount: 199, category: 'Food' },
      { id: 't6', date: '2026-10-14', amount: 150, category: 'Bills' },
      // leftovers moved: to the fund and to the loan
      { id: 'm1', kind: 'move', date: '2026-10-20', amount: 300, category: 'Savings', useFor: 'emergency' },
      { id: 'm2', kind: 'move', date: '2026-10-21', amount: 500, category: 'Savings', useFor: 'debt', debtId: 'd1', debtPaid: 500 },
      // a payday set-aside isn't a leftover
      { id: 'm3', kind: 'move', date: '2026-10-01', amount: 2000, category: 'Savings', useFor: 'emergency', setAside: '2026-10-01' },
      // November doesn't count
      { id: 'n1', date: '2026-11-02', amount: 50, category: 'Food', paidFrom: 'c1' },
    ],
  });
  s.savings.rollovers = [{ id: 'r1', from: 'Bike EMI', amount: 3000, to: 'debt', date: '2026-10-25', kind: 'loan' }];
  const r = Core.monthReport(s, '2026-11-03');
  assert.equal(r.cycle.start, '2026-10-01');
  assert.equal(r.last, '2026-10-31');
  assert.equal(r.cardFree, 29);
  assert.deepEqual(r.swept, { emergency: 300, debt: 500, grow: 0, total: 800 });
  assert.equal(r.debtPaid, 500);
  assert.ok(r.interestSaved > 0);
  assert.deepEqual(r.cleared, ['Bike EMI']);
  // Food: 15,500 budget, 900 + 150 + 16,000 + 120 + 199 spent
  assert.deepEqual(r.overspent, { name: 'Food', budget: 15500, spent: 17369, over: 1869 });
  assert.deepEqual(r.small, { count: 3, total: 469, under: 200 });
  assert.equal(r.active, true);
  assert.equal(Core.monthReport(s, '2026-10-15').active, false);
});

test('a bill with no amount yet isn’t due and sets nothing aside', () => {
  const s = baseState({ bills: [
    { id: 'v0', name: '', estimate: 0, everyMonths: 1, nextDue: '2026-10-10' },
    { id: 'v1', name: 'Electricity', estimate: 1200, everyMonths: 1, nextDue: '2026-10-15' },
  ] });
  const events = Core.cycleEvents(s, Core.cycleFor('2026-10-10', 1), '2026-10-10');
  assert.deepEqual(events.filter((e) => e.kind === 'bill' || e.kind === 'billpot').map((e) => [e.name, e.amount]), [['Electricity', 1200]]);
});

test('spending three ways: where, when and the monthly trend', () => {
  const s = baseState({
    budgets: [{ id: 'b1', name: 'Food', amount: 1000 }, { id: 'b2', name: 'Groceries', amount: 3000 }],
    cards: [{ id: 'c1', name: 'HDFC', last4: '1234', limit: 50000, rate: 42, statementDay: 5, dueDay: 25 }],
    transactions: [
      { id: 'a', date: '2026-11-02', amount: 1500, category: 'Food', paidFrom: 'c1' }, // a Monday
      { id: 'b', date: '2026-11-03', amount: 500, category: 'Groceries' },
      { id: 'm', kind: 'move', date: '2026-11-03', amount: 300, useFor: 'emergency' },
      { id: 'l', kind: 'in', date: '2026-10-20', amount: 4000, borrowed: true, category: 'Loan' },
      { id: 'o', date: '2026-10-12', amount: 700, category: 'Food' }, // a Monday
    ],
  });
  const w = Core.spendWhere(s, '2026-11-03');
  assert.deepEqual(w.categories.map((c) => ({ name: c.name, spent: c.spent, budget: c.budget })), [{ name: 'Food', spent: 1500, budget: 1000 }, { name: 'Groceries', spent: 500, budget: 3000 }]);
  assert.deepEqual([w.total, w.basics, w.other], [2000, 500, 1500]);
  assert.deepEqual(w.categories[0].payments.map((t) => t.id), ['a']);
  // This round so far would be compared with 1–3 Oct, but records start on 12 Oct: no comparison
  assert.equal(w.comparable, false);
  assert.equal(w.before, null);
  // Last round, and three rounds with three rounds' budget
  const last = Core.spendWhere(s, '2026-11-03', 'last');
  assert.deepEqual(last.categories.map((c) => [c.name, c.spent, c.budget]), [['Food', 700, 1000]]);
  const three = Core.spendWhere(s, '2026-11-03', 3);
  assert.deepEqual(three.categories.map((c) => [c.name, c.spent, c.budget]), [['Food', 2200, 3000], ['Groceries', 500, 9000]]);
  assert.equal(three.range.from, '2026-09-01');

  const h = Core.spendWhen(s, '2026-11-03');
  assert.deepEqual(h.days, [
    { date: '2026-11-01', amount: 0, card: false },
    { date: '2026-11-02', amount: 1500, card: true },
    { date: '2026-11-03', amount: 500, card: false },
  ]);
  // Mondays from 12 Oct (the first entry) to yesterday: 12, 19, 26 Oct and 2 Nov
  assert.equal(h.weekdays[0], Math.round((700 + 1500) / 4));
  assert.equal(h.weekdays[1], 0);

  const t = Core.spendTrend(s, '2026-11-03', 2);
  assert.deepEqual(t.map((m) => [m.start, m.spent, m.saved, m.borrowed, m.current]), [
    ['2026-10-01', 700, 0, 4000, false],
    ['2026-11-01', 2000, 300, 1500, true],
  ]);
});

test('a bill added just before it’s due is paid in full from this month: the pot fills from when it was added', () => {
  const s = baseState({ bills: [{ id: 'v1', name: 'Recharge', estimate: 900, everyMonths: 3, nextDue: '2026-11-12', added: '2026-11-01' }] });
  const due = () => Core.cycleEvents(s, Core.cycleFor('2026-11-01', 1), '2026-11-01').find((e) => e.kind === 'bill').amount;
  assert.equal(due(), 900); // nothing saved yet
  s.bills[0].added = '2026-10-03';
  assert.equal(due(), 600); // one month's share saved
  s.bills[0].added = '2026-08-20';
  assert.equal(due(), 300); // the pot is full
  delete s.bills[0].added;
  assert.equal(due(), 300); // bills from before `added` count as full
  s.bills[0].added = '2026-11-01';
  assert.equal(Core.payBill(s, 'v1', 900, 3, '2026-11-12').fromPot, 0);
});

test('debt-free dates: minimums only against the plan', () => {
  const s = baseState({ debts: [{ id: 'd1', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 5 }] });
  let d = Core.debtFreeDates(s, '2026-11-01');
  assert.equal(d.extra, 0);
  assert.equal(d.sooner, 0);
  assert.equal(d.now.months, d.plan.months);
  s.savings.debtExtra = 2500;
  d = Core.debtFreeDates(s, '2026-11-01');
  assert.equal(d.minimums, 2500);
  assert.ok(d.plan.months < d.now.months && d.sooner === d.now.months - d.plan.months);
  assert.ok(d.saved > 0);
  assert.equal(d.plan.date, Core.addMonths('2026-11-01', d.plan.months));
  // A minimum below the interest never pays off
  s.debts[0].minPayment = 1000; s.savings.debtExtra = 0;
  assert.equal(Core.debtFreeDates(s, '2026-11-01').now.never, true);
  assert.equal(Core.debtFreeDates(baseState(), '2026-11-01'), null);
});

test('credit card due date: paid in full costs nothing; less moves the rest to Debts with GST, and a late fee below the minimum', () => {
  const mk = () => {
    const s = baseState({ cards: [{ id: 'c1', name: 'HDFC', last4: '1234', limit: 100000, statementDay: 5, dueDay: 25, created: '2026-09-01' }] });
    s.transactions.push({ id: 'k', date: '2026-09-20', amount: 20000, category: 'Shopping', paidFrom: 'c1' });
    return s;
  };
  // Bill of 20,000 from the 5 Oct statement, due 25 Oct
  let s = mk();
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-25').remaining, 20000);
  let r = Core.answerCardDue(s, 'c1', 'full', 0, '2026-10-25');
  assert.equal(r.kind, 'full');
  assert.equal(s.debts.length, 0);
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-26').remaining, 0);
  assert.equal(s.cards[0].answered, '2026-10-25');

  // Missed: the whole bill carried at 42% + GST = 49.6%, plus the ₹950 late fee + GST
  s = mk();
  r = Core.answerCardDue(s, 'c1', 'missed', 0, '2026-10-26');
  assert.equal(r.kind, 'carried');
  assert.equal(r.fee, Math.round(950 * 1.18));
  assert.deepEqual([s.debts[0].balance, s.debts[0].rate], [20000 + 1121, 49.6]);
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-26').remaining, 0);

  // Paid more than the minimum (₹1,000): no late fee, interest on the rest
  s = mk();
  r = Core.answerCardDue(s, 'c1', 'part', 5000, '2026-10-25');
  assert.deepEqual([r.rest, r.fee, s.debts[0].balance], [15000, 0, 15000]);
  assert.equal(r.monthly, Math.round((15000 * 49.6) / 1200));
  assert.deepEqual([Core.cardLateFee(400), Core.cardLateFee(4000), Core.cardLateFee(60000)], [0, 500, 1300]);
});

test('little leaks: tagged payees, a month of it in Days of Freedom, suggestions and a challenge', () => {
  const s = baseState({ budgets: [{ id: 'g', name: 'Groceries', amount: 6000 }, { id: 'f', name: 'Food', amount: 9500 }] });
  // Basics: rent 15,000 + groceries 6,000 = 700 a day
  s.transactions.push(
    { id: 'a', date: '2026-10-05', amount: 400, category: 'Food', note: 'Swiggy' },
    { id: 'b', date: '2026-10-20', amount: 300, category: 'Food', note: 'Zomato Ltd' },
    { id: 'c', date: '2026-11-02', amount: 500, category: 'Food', note: 'Swiggy' },
    { id: 'd', date: '2026-11-02', amount: 60, category: 'Misc', note: 'Raju Paan Shop' },
    { id: 'e', date: '2026-11-02', amount: 999, category: 'Shopping', note: 'Myntra' },
  );
  // Suggested, not tagged: nothing counts yet
  assert.deepEqual(Core.leakSuggestions(s, '2026-11-03').map((x) => [x.payee, x.leak, x.total]),
    [['swiggy', 'Food delivery', 900], ['zomato ltd', 'Food delivery', 300], ['raju paan shop', 'Cigarettes', 60]]);
  assert.equal(Core.leakSummary(s, '2026-11-03').leaks.length, 0);
  // Tag Swiggy and Zomato as food delivery
  s.leakRules = { swiggy: 'Food delivery', 'zomato ltd': 'Food delivery' };
  let L = Core.leakSummary(s, '2026-11-03');
  const fd = L.leaks.find((x) => x.name === 'Food delivery');
  // 500 in 3 days is a 5,000 pace for the 30-day round: higher than last round's 700
  assert.deepEqual([fd.thisRound, fd.count, fd.lastRound, fd.perMonth], [500, 1, 700, 5000]);
  assert.equal(fd.freedom, 7.1); // 5,000 ÷ 700 a day
  assert.deepEqual(fd.places.sort(), ['swiggy', 'zomato ltd']);
  // A self-chosen challenge: cut 20% of 700 this round
  s.leakGoals = { 'Food delivery': { cycle: '2026-11-01', pct: 20, base: 700 } };
  L = Core.leakSummary(s, '2026-11-03');
  assert.deepEqual(L.leaks[0].goal, { pct: 20, target: 560, left: 60 });
  // Started mid-round, it counts from that day: 500 already spent + 80% of 700 for the 28 days left
  s.leakGoals = { 'Food delivery': { cycle: '2026-11-01', pct: 20, base: 700, from: '2026-11-03', spentBefore: 500 } };
  assert.deepEqual(Core.leakSummary(s, '2026-11-03').leaks[0].goal, { pct: 20, target: 500 + Math.round(560 * 28 / 30), left: Math.round(560 * 28 / 30) });
  // Own leak names
  s.customLeaks = ['Gutkha'];
  assert.ok(Core.leakNames(s).indexOf('Gutkha') !== -1);
});

test('loan EMIs come off after each due date; card loans are left to the card', () => {
  const s = baseState({ debts: [
    { id: 'd1', name: 'Personal loan', balance: 100000, rate: 12, minPayment: 5000, dueDay: 5 },
    { id: 'd2', name: 'Card carried balance', balance: 20000, rate: 49.6, minPayment: 1000, dueDay: 5, fromCard: 'c1' },
    { id: 'd3', name: 'App loan', balance: 3000, rate: 0, minPayment: 5000, dueDay: 10 },
  ] });
  // First run: the typed balance already counts EMIs so far
  assert.deepEqual(Core.tickDebts(s, '2026-10-20'), []);
  assert.equal(s.debts[0].balance, 100000);
  assert.equal(s.debts[0].emiThrough, '2026-10-05');
  assert.equal(s.debts[0].startBalance, 100000);
  Core.tickDebts(s, '2026-11-04');
  assert.equal(s.debts[0].balance, 100000);
  // 5 Nov: 1,000 interest, 5,000 EMI
  Core.tickDebts(s, '2026-11-05');
  assert.equal(s.debts[0].balance, 96000);
  assert.deepEqual(s.debts[0].lastEmi, { date: '2026-11-05', off: 4000 });
  // Opened again after a gap: December's EMI too (960 interest)
  const cleared = Core.tickDebts(s, '2026-12-31');
  assert.equal(s.debts[0].balance, 91960);
  assert.equal(s.debts[0].startBalance, 100000);
  assert.equal(s.debts[1].balance, 20000);
  assert.deepEqual(cleared.map((d) => d.id), ['d3']);
  assert.equal(s.debts[2].balance, 0);
});

test('debt journey: survive, stabilize, escape, with one next move', () => {
  const s = baseState({ debts: [{ id: 'd1', name: 'Personal loan', balance: 100000, rate: 24, minPayment: 5000, dueDay: 5 }] });
  // Basics: rent 15,000 + EMI 5,000 = 20,000 a month, covered by the salary; nothing borrowed
  let j = Core.debtJourney(s, '2026-10-25');
  assert.equal(j.gap, 0);
  assert.equal(j.clean, null);
  assert.equal(j.stage, 'stabilize');
  assert.deepEqual(j.next, { kind: 'buffer', target: 1, amount: 667, days: 0 });
  s.savings.emergencyBalance = 2000;
  assert.deepEqual(Core.debtJourney(s, '2026-10-25').next, { kind: 'buffer', target: 7, amount: 2667, days: 3 });
  // 7 Days of Freedom: escape, one loan at a time
  s.savings.emergencyBalance = 5000;
  j = Core.debtJourney(s, '2026-10-25');
  assert.equal(j.stage, 'escape');
  assert.equal(j.next.kind, 'start');
  assert.equal(j.next.boss.name, 'Personal loan');
  assert.ok(j.next.sooner > 0 && j.next.saves > 0);
  s.savings.debtExtra = 2000;
  assert.deepEqual(Core.debtJourney(s, '2026-10-25').next.amount, 2000);
  // Card spending 5 days ago: back to surviving, 4 clean days so far
  s.transactions.push({ id: 't1', date: '2026-10-20', amount: 800, category: 'Shopping', paidFrom: 'c1' });
  j = Core.debtJourney(s, '2026-10-25');
  assert.equal(j.stage, 'survive');
  assert.deepEqual(j.next, { kind: 'clean', clean: 4, goal: 7 });
  assert.equal(Core.debtJourney(s, '2026-11-20').stage, 'escape'); // 30 days clean
  // Salary short of the basics: close the gap
  s.transactions = [];
  s.settings.salary = 18000;
  j = Core.debtJourney(s, '2026-10-25');
  assert.equal(j.stage, 'survive');
  assert.equal(j.gap, 2000);
  assert.equal(j.next.kind, 'gap');
  assert.equal(j.next.call.name, 'Personal loan');
  assert.ok(j.next.call.newEmi < 5000 && j.next.call.less === 5000 - j.next.call.newEmi);
  assert.equal(j.next.earn, Math.max(0, 2000 - j.next.call.less - (j.next.cut ? j.next.cut.amount : 0)));
  // Order: highest interest first, or smallest first
  s.settings.salary = 50000;
  s.debts.push({ id: 'd2', name: 'Small loan', balance: 8000, rate: 14, minPayment: 1000, dueDay: 10 });
  assert.deepEqual(Core.debtJourney(s, '2026-10-25').bosses.map((b) => b.id), ['d1', 'd2']);
  s.settings.payoffOrder = 'snowball';
  assert.deepEqual(Core.debtJourney(s, '2026-10-25').bosses.map((b) => b.id), ['d2', 'd1']);
  // A boss's bar: what's left of its highest balance
  s.debts[0].startBalance = 125000;
  assert.equal(Core.debtJourney(s, '2026-10-25').bosses[1].left, 0.8);
  // No loans: nothing to show, or debt-free once the journey started
  assert.equal(Core.debtJourney(baseState(), '2026-10-25'), null);
  assert.deepEqual(Core.debtJourney(baseState({ journey: { start: '2026-09-01' } }), '2026-10-25'), { stage: 'free' });
});

test('lender calls: list, one easy call, 60 days of numbers, then a better rate', () => {
  const s = baseState({ debts: [{ id: 'd1', name: 'Bajaj loan', balance: 100000, rate: 0, minPayment: 5000, dueDay: 20 }], journey: { start: '2026-08-01' } });
  let L = Core.lenderTasks(s, '2026-10-25');
  assert.equal(L.current.key, 'list');
  assert.deepEqual(L.current.missing, ['Bajaj loan']);
  s.debts[0].rate = 24;
  // EMI on the 20th, 19 days after payday: ask to move it to the 3rd
  L = Core.lenderTasks(s, '2026-10-25');
  assert.deepEqual(L.current, { key: 'easy', kind: 'due', done: false, debtId: 'd1', name: 'Bajaj loan', emi: 5000, day: 20, want: 3, after: 19 });
  // Call made: tomorrow asks how it went
  s.journey.calls = [{ id: 'c1', task: 'easy', debtId: 'd1', date: '2026-10-25', follow: '2026-10-26' }];
  assert.equal(Core.lenderTasks(s, '2026-10-25').follow, null);
  assert.equal(Core.lenderTasks(s, '2026-10-26').follow.id, 'c1');
  s.journey.calls[0].result = 'no';
  L = Core.lenderTasks(s, '2026-10-26');
  assert.equal(L.current.key, 'log');
  assert.equal(L.current.logged, 0);
  for (let i = 0; i < 60; i++) s.transactions.push({ id: 'x' + i, date: Core.addDays('2026-08-01', i), amount: 100, category: 'Food' });
  L = Core.lenderTasks(s, '2026-10-26');
  assert.equal(L.current.key, 'deal');
  const o = L.current.offer;
  assert.equal(o.target, 20);
  assert.ok(o.saves > 0 && o.sooner >= 0);
  assert.equal(o.tenure, undefined); // the salary covers the basics
  assert.equal(L.current.share, 10); // 5,000 of 50,000
  // Asked and answered: nothing left to ask
  s.journey.calls.push({ id: 'c2', task: 'deal', debtId: 'd1', date: '2026-10-26', follow: '2026-10-27', result: 'yes' });
  assert.equal(Core.lenderTasks(s, '2026-10-27').current, null);
});

test('round result: won without borrowing, days won and over, planned against actual, a goal', () => {
  const s = baseState({ days: {} });
  // Round of October (31 days); today is 2 Nov
  s.days['2026-10-10'] = { allowance: 500 };
  s.days['2026-10-11'] = { allowance: 500 };
  s.days['2026-10-12'] = { allowance: 500 };
  s.transactions.push(
    { id: 'a', date: '2026-10-10', amount: 300, category: 'Food' },
    { id: 'b', date: '2026-10-11', amount: 700, category: 'Food' },
    { id: 'c', date: '2026-10-12', amount: 2000, category: 'Emergency' }, // doesn't count against the day
    { id: 'd', kind: 'move', date: '2026-10-01', amount: 3000, category: 'Savings', useFor: 'emergency', setAside: '2026-10-01' },
  );
  let r = Core.roundResult(s, '2026-11-02');
  assert.equal(r.won, true);
  assert.deepEqual([r.tally.won, r.tally.over, r.tally.none, r.tally.logged, r.tally.total], [2, 1, 28, 4, 31]);
  assert.deepEqual(r.rows.map((x) => [x.key, x.planned, x.actual, x.good]), [
    ['pay', 50000, 50000, true], ['flex', 15500, 1000, true], ['saved', 0, 3000, true], ['borrowed', 0, 0, true],
  ]);
  assert.equal(r.change, null);
  assert.deepEqual(r.goal, { kind: 'save' }); // nothing moved from daily leftovers
  // A card spend: the round wasn't won, and the goal is no card for daily spending
  s.transactions.push({ id: 'e', date: '2026-10-20', amount: 1200, category: 'Shopping', paidFrom: 'c1' });
  r = Core.roundResult(s, '2026-11-02');
  assert.equal(r.won, false);
  assert.equal(r.borrowed, 1200);
  assert.deepEqual(r.goal, { kind: 'borrow' });
  // With a snapshot from the round's start: then and now
  s.rounds = { '2026-10-01': { date: '2026-10-03', freedom: 1, debt: 50000 } };
  s.savings.emergencyBalance = 2500; // basics 15,000 a month = 500 a day
  assert.deepEqual(Core.roundResult(s, '2026-11-02').change, { since: '2026-10-03', freedom: [1, 5], debt: [50000, 0] });
});

test('weekly recap: the 7 days to yesterday in small wins', () => {
  const s = baseState({ days: {}, debts: [{ id: 'd1', name: 'Loan', balance: 60000, rate: 18, minPayment: 3000, dueDay: 5 }] });
  for (let i = 18; i <= 24; i++) s.days['2026-10-' + i] = { allowance: 400 };
  s.transactions.push(
    { id: 'a', date: '2026-10-18', amount: 350, category: 'Food' },
    { id: 'b', date: '2026-10-19', amount: 900, category: 'Food' },
    { id: 'c', kind: 'move', date: '2026-10-20', amount: 600, category: 'Savings', useFor: 'debt', debtId: 'd1', debtPaid: 600 },
    { id: 'd', kind: 'move', date: '2026-10-21', amount: 1000, category: 'Savings', useFor: 'emergency' },
    { id: 'e', date: '2026-10-17', amount: 999, category: 'Food' }, // before the week
  );
  const w = Core.weekRecap(s, '2026-10-25');
  assert.equal(w.from, '2026-10-18');
  assert.equal(w.to, '2026-10-24');
  // Only the 19th is over: moving money to a loan or the fund never makes a day "over"
  assert.deepEqual([w.tally.won, w.tally.over, w.tally.logged], [6, 1, 4]);
  assert.equal(w.saved, 1000);
  assert.equal(w.debtPaid, 600);
  assert.equal(w.daysCloser, 6); // 3,000 a month on loans = 100 a day
  assert.equal(w.freedomGained, 1); // basics 18,000 a month = 600 a day
  assert.equal(w.borrowed, 0);
});

test('backup file: locked with the password, opens only with it; old plain backups still open', async () => {
  const s = baseState({ transactions: [{ id: 'a', date: '2026-10-10', amount: 300, category: 'Food', note: 'Swiggy' }] });
  const file = await Core.encryptBackup(s, 'chai-123', '2026-10-25');
  // Nothing readable inside: not the shop, not the salary
  assert.equal(/Swiggy|50000|Rent/.test(file), false);
  assert.deepEqual(Core.backupInfo(file), { locked: true, date: '2026-10-25', entries: 1 });
  const back = await Core.openBackup(file, 'chai-123');
  assert.deepEqual(back, JSON.parse(JSON.stringify(s)));
  await assert.rejects(Core.openBackup(file, 'chai-124'), /password/);
  // Two backups of the same data look different (random salt and IV)
  assert.notEqual(file, await Core.encryptBackup(s, 'chai-123', '2026-10-25'));
  // A changed byte is caught
  const o = JSON.parse(file); o.data = (o.data[0] === 'A' ? 'B' : 'A') + o.data.slice(1);
  await assert.rejects(Core.openBackup(JSON.stringify(o), 'chai-123'), /password/);
  // Older plain backups, and anything else
  assert.deepEqual(Core.backupInfo(JSON.stringify(s)), { locked: false, date: null, entries: 1 });
  assert.equal((await Core.openBackup(JSON.stringify(s))).settings.salary, 50000);
  assert.equal(Core.backupInfo('hello'), null);
  await assert.rejects(Core.openBackup('{"a":1}', 'x'), /format/);
});

test('wallets: moving money between them is never spending; each wallet has its own balance', () => {
  const s = baseState({ wallets: [{ id: 'cash', name: 'Cash', kind: 'cash', created: '2026-10-01' }] });
  const before = Core.projectRunway(s, '2026-10-20');
  // ATM: ₹2,000 from the bank into cash, then ₹500 spent in cash
  s.transactions.push({ id: 't1', kind: 'transfer', date: '2026-10-10', amount: 2000, from: 'main', to: 'cash', note: 'ATM' });
  const afterMove = Core.projectRunway(s, '2026-10-20');
  assert.equal(afterMove.balanceToday, before.balanceToday);
  assert.equal(afterMove.dailyAllowance, before.dailyAllowance);
  assert.equal(Core.daySpending(s, '2026-10-10'), 0);
  s.transactions.push({ id: 't2', date: '2026-10-12', amount: 500, category: 'Food', note: 'Chai', wallet: 'cash' });
  const r = Core.projectRunway(s, '2026-10-20');
  assert.equal(r.balanceToday, before.balanceToday - 500); // the total drops only by what was spent
  let w = Core.walletBalances(s, '2026-10-20', r.balanceToday);
  assert.equal(w.wallets[0].balance, 1500);
  assert.equal(w.main + w.wallets[0].balance, r.balanceToday); // the parts add up
  // A count of the cash ("this morning") is the new starting point
  s.wallets[0].check = { date: '2026-10-15', amount: 1200 };
  s.transactions.push({ id: 't3', date: '2026-10-16', amount: 200, category: 'Food', wallet: 'cash' });
  w = Core.walletBalances(s, '2026-10-20', 10000);
  assert.equal(w.wallets[0].balance, 1000);
  assert.equal(w.main, 9000);
  // This morning's balances leave out today's entries
  s.transactions.push({ id: 't4', date: '2026-10-20', amount: 100, category: 'Food', wallet: 'cash' });
  assert.equal(Core.walletBalances(s, '2026-10-20', 0, true).wallets[0].balance, 1000);
  assert.equal(Core.walletBalances(s, '2026-10-20', 0).wallets[0].balance, 900);
  // Card spending isn't the wallet's money
  s.transactions.push({ id: 't5', date: '2026-10-20', amount: 999, category: 'Shopping', wallet: 'cash', paidFrom: 'c1' });
  assert.equal(Core.walletBalances(s, '2026-10-20', 0).wallets[0].balance, 900);
});

test('bank SMS: an ATM withdrawal and the account it came from', () => {
  const atm = Core.parseSms('Rs.2000.00 withdrawn at ATM from A/c XX4321 on 20-10-26. Avl Bal Rs 5,000', {}, '2026-10-25');
  assert.equal(atm.atm, true);
  assert.equal(atm.acct, '4321');
  assert.equal(atm.category, 'Cash');
  const upi = Core.parseSms('INR 1,500 debited from a/c no. XXXXXX7788 on 21-Oct-26 towards UPI/swiggy@icici', {}, '2026-10-25');
  assert.equal(upi.atm, false);
  assert.equal(upi.acct, '7788');
  const credit = Core.parseSms('Your A/c XX4321 is credited with Rs.5,000 on 22-10-26 by NEFT', {}, '2026-10-25');
  assert.equal(credit.acct, '4321');
});

test('savings goals: a monthly amount to reach the target by the date', () => {
  const s = Demo.demoState('2026-10-23');
  s.settings.payday = 1;
  const g = { id: 'g1', name: 'Bike', target: 12000, saved: 0, by: '2027-03-15' };
  s.goals = [g];
  // Paydays from this cycle (Oct) up to the date: Oct, Nov, Dec, Jan, Feb, Mar
  let st = Core.goalStatus(s, g, '2026-10-23');
  assert.equal(st.paydays, 6);
  assert.equal(st.monthly, 2000);
  const plan = Core.monthlyPlan(s, '2026-10-23');
  assert.equal(plan.goals, 2000);
  // It comes out of the money for flexible budgets
  const before = Core.allocate(Object.assign({}, s, { goals: [] }), '2026-10-23').pool;
  assert.equal(Core.allocate(s, '2026-10-23').pool, before - 2000);
  // Recorded on payday: this cycle's amount stays the same
  g.saved = 2000; g.added = { cycle: '2026-10-01', amount: 2000 };
  assert.equal(Core.goalStatus(s, g, '2026-10-23').monthly, 2000);
  assert.equal(Core.goalStatus(s, g, '2026-11-02').monthly, 2000); // 10000 over Nov..Mar
  // A passed date reserves nothing and says so
  st = Core.goalStatus(s, Object.assign({}, g, { by: '2026-09-30', added: null }), '2026-10-23');
  assert.equal(st.late, true);
  assert.equal(st.monthly, 0);
  // Reached
  assert.equal(Core.goalStatus(s, Object.assign({}, g, { saved: 12000, added: null }), '2026-10-23').done, true);
  // Added after this cycle's payday: nothing comes out of this month; it starts next payday
  const late = Core.goalStatus(s, { id: 'g2', name: 'Trip', target: 10000, saved: 0, by: '2027-03-15', created: '2026-10-23' }, '2026-10-23');
  assert.equal(late.monthly, 0);
  assert.equal(late.paydays, 5);
  assert.equal(late.perPayday, 2000);
});

test('budget envelopes: covering an overspend and keeping a leftover', () => {
  const s = Demo.demoState('2026-10-23');
  s.settings.payday = 1;
  s.balanceCheck = null;
  s.transactions = s.transactions.filter((t) => t.date < '2026-09-01');
  const names = Core.monthlyPlan(s, '2026-10-23').budgets.map((b) => b.name);
  const [a, b] = names;
  const env0 = Core.budgetEnvelopes(s, '2026-10-23');
  const A = env0.list.find((x) => x.name === a);
  s.transactions.push({ id: 'x1', date: '2026-10-05', amount: A.planned + 300, category: a });
  let env = Core.budgetEnvelopes(s, '2026-10-23');
  assert.equal(env.list.find((x) => x.name === a).left, -300);
  assert.equal(env.over.length, 1);
  // Cover it from the second budget: the total stays the same
  s.budgetMoves = [{ id: 'm1', cycle: '2026-10-01', from: b, to: a, amount: 300 }];
  env = Core.budgetEnvelopes(s, '2026-10-23');
  assert.equal(env.list.find((x) => x.name === a).left, 0);
  assert.equal(env.list.find((x) => x.name === b).available, env0.list.find((x) => x.name === b).planned - 300);
  assert.equal(env.over.length, 0);
  assert.equal(env.list.reduce((t, x) => t + x.available, 0), env0.list.reduce((t, x) => t + x.available, 0));
  // Moves belong to their cycle
  assert.equal(Core.budgetEnvelopes(s, '2026-11-05').list.find((x) => x.name === b).moved, 0);
  // Keep the leftover: turned on in October, October's leftover shows in November
  const own = s.budgets.find((x) => x.name === b);
  own.carry = true; own.carryFrom = '2026-10-01';
  assert.equal(Core.budgetEnvelopes(s, '2026-10-23').list.find((x) => x.name === b).carried, 0);
  const octLeft = Core.budgetEnvelopes(s, '2026-10-31').list.find((x) => x.name === b).left;
  const nov = Core.budgetEnvelopes(s, '2026-11-05').list.find((x) => x.name === b);
  assert.equal(nov.carried, octLeft);
  assert.equal(nov.available, nov.planned + octLeft);
  // An overspent budget carries nothing
  s.transactions.push({ id: 'x2', date: '2026-10-06', amount: 999999, category: b });
  assert.equal(Core.budgetEnvelopes(s, '2026-11-05').list.find((x) => x.name === b).carried, 0);
});

test('net worth: what you own minus what you owe', () => {
  const s = Demo.demoState('2026-10-23');
  const n = Core.netWorth(s, '2026-10-23');
  assert.equal(n.value, n.money + n.funds - n.loans - n.cards);
  assert.ok(n.loans > 0);
  // A loan from family with no EMI lowers it by exactly its balance
  s.debts.push({ id: 'fam', name: 'Family', balance: 5000, rate: 0, minPayment: 0 });
  assert.equal(Core.netWorth(s, '2026-10-23').value, n.value - 5000);
});

test('quick budgets: last round and the three-round average', () => {
  const s = baseState({
    settings: { salary: 50000, payday: 1 },
    budgets: [{ id: 'g', name: 'Groceries', auto: true }, { id: 'c', name: 'Clothes', auto: true }],
    transactions: [
      { id: '1', date: '2026-10-05', amount: 6240, category: 'Groceries' },
      { id: '2', date: '2026-09-05', amount: 5000, category: 'Groceries' },
      { id: '3', date: '2026-09-09', amount: 3000, category: 'Clothes' },
      { id: '4', date: '2026-11-02', amount: 999, category: 'Groceries' }, // this round: not counted
    ],
  });
  const h = Core.budgetHistory(s, '2026-11-03');
  // Two rounds with entries (Oct, Sep); August had none, so it doesn't pull the average down
  assert.deepEqual(h.Groceries, { last: 6200, avg: 5600, rounds: 2 });
  assert.deepEqual(h.Clothes, { last: 0, avg: 1500, rounds: 2 });
});

test('a plan with nothing for daily spending: the limit is never below ₹0 and never green', () => {
  const t = '2026-10-26';
  const s = Demo.demoState(t);
  s.transactions = s.transactions.filter((x) => x.date < '2026-10-01');
  // Fixed payments and EMIs use the whole salary
  s.fixed.push({ id: 'big', name: 'Rent and EMIs', amount: Core.monthlyPlan(s, t).flexTotal + 5000, dueDay: 1 });
  assert.equal(Core.monthlyPlan(s, t).flexTotal, 0);
  s.balanceCheck = { date: t, amount: 409 };
  // Yesterday's leftover moved to savings this morning
  s.transactions.push({ id: 'mv', kind: 'move', date: t, forDate: Core.addDays(t, -1), amount: 300, category: 'Savings', useFor: null });
  const r = Core.projectRunway(s, t);
  assert.ok(r.dailyAllowance >= 0);
  assert.ok(r.tomorrowAllowance >= 0);
  const z = Core.zoneStatus(s, t, r);
  assert.notEqual(z.zone, 'green');
  // Basics come from real grocery and health spending, since the plan has none
  assert.ok(z.essentialPerDay > 0);
  assert.equal(z.zone, 'red');
});

test('AI facts: numbers and categories only, never shop names, notes or account numbers', () => {
  const t = '2026-10-26';
  const s = Demo.demoState(t);
  s.transactions.push({ id: 'p1', date: t, amount: 499, category: 'Shopping', note: 'SECRETSHOP Myntra 9876543210', source: 'sms', smsKey: 'k-secret', wallet: 'w1' });
  s.wallets = [{ id: 'w1', name: 'HDFC', kind: 'bank', last4: '4321', created: t }];
  const f = Core.aiFacts(s, t);
  assert.match(f, /Today's limit: ₹/);
  assert.match(f, /Next payday: /);
  assert.doesNotMatch(f, /SECRETSHOP|Myntra|9876543210|k-secret|4321/);
  // Every note in the data stays out
  s.transactions.filter((x) => x.note && x.note.length > 4).forEach((x) => assert.ok(!f.includes(x.note), x.note));
});

test('the app connects to the internet in exactly one place: the AI weekly plan, and only when it is turned on', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const calls = src.match(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/g) || [];
  assert.deepEqual(calls, ['fetch(']);
  const fn = src.slice(src.indexOf('function requestPlan('), src.indexOf('// ---------- privacy and backup ----------'));
  assert.ok(fn.includes('fetch('));
  assert.match(fn, /if \(!cfg\.on/);
  // Off unless turned on
  assert.match(src, /Object\.assign\(\{ on: false/);
});

test('weekly plan facts: fraud signals and loan options come from the phone, shop names never leave it', () => {
  const t = '2026-10-26';
  const s = Demo.demoState(t);
  s.transactions.push(
    { id: 'f1', date: '2026-10-24', amount: 1, category: 'Misc', note: 'PAYTMVERIFY' },
    { id: 'f2', date: '2026-10-25', amount: 18500, category: 'Shopping', note: 'NEWSHOPELECTRONICS' },
    { id: 'f3', date: '2026-10-25', amount: 640, category: 'Food & dining', note: 'Zomato' },
    { id: 'f4', date: '2026-10-25', amount: 640, category: 'Food & dining', note: 'Zomato' },
  );
  const fr = Core.fraudSignals(s, t);
  assert.deepEqual(fr.map((x) => x.kind), ['tiny', 'duplicate', 'large_new']);
  assert.deepEqual(fr.find((x) => x.kind === 'large_new').ids, ['f2']);
  const f = Core.planFacts(s, t, null);
  assert.match(f, /Payments to double-check, last 14 days: 1 × tiny/);
  assert.match(f, /Loan options worked out by the app: ₹1,000 more a month: debt-free \d+ months sooner/);
  assert.match(f, /Ready to learn about investing: no\. A loan costs 42%/);
  assert.doesNotMatch(f, /PAYTMVERIFY|NEWSHOPELECTRONICS|Zomato/);
  // Confirmed as theirs: not flagged again
  s.fraudOk = ['f2'];
  assert.ok(!Core.fraudSignals(s, t).some((x) => x.kind === 'large_new'));
});

test('weekly goals are checked from the week\'s entries', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 }, transactions: [
    { id: '1', date: '2026-10-19', amount: 1200, category: 'Food' },
    { id: '2', date: '2026-10-21', amount: 900, category: 'Food', paidFrom: 'c1' },
    { id: '3', date: '2026-10-22', kind: 'move', amount: 700, category: 'Savings', useFor: 'emergency' },
    { id: '4', date: '2026-10-26', amount: 5000, category: 'Food' }, // next week: not counted
  ] });
  assert.equal(Core.weekStart('2026-10-25'), '2026-10-19');
  assert.deepEqual(Core.goalResult(s, { week: '2026-10-19', type: 'spend_cap', amount: 2500 }), { met: true, value: 2100 });
  assert.deepEqual(Core.goalResult(s, { week: '2026-10-19', type: 'save', amount: 1000 }), { met: false, value: 700 });
  assert.deepEqual(Core.goalResult(s, { week: '2026-10-19', type: 'no_card', amount: 0 }), { met: false, value: 900 });
});

test('investing is explained only with a month of savings and no costly loan', () => {
  const s = Demo.demoState('2026-10-26');
  assert.equal(Core.investReady(s, '2026-10-26').ready, false);
  s.debts = [];
  s.savings.emergencyBalance = 10000000;
  assert.equal(Core.investReady(s, '2026-10-26').ready, true);
});

test('a card bill paid before a balance check, answered later, is not taken off the balance twice', () => {
  // ₹6,000 spent on the card in September, its bill due 3 Oct and paid that day.
  // The balance was checked on 20 Oct, so the ₹6,000 had already left the account.
  const make = () => baseState({
    settings: { salary: 50000, payday: 1 },
    cards: [{ id: 'c1', name: 'HDFC card', last4: '1234', limit: 100000, statementDay: 15, dueDay: 3, created: '2026-09-01',
      statement: { date: '2026-09-15', total: 6000, min: 300, due: '2026-10-03' } }],
    transactions: [{ id: 'sp', date: '2026-09-10', amount: 6000, category: 'Shopping', paidFrom: 'c1' }],
    balanceCheck: { date: '2026-10-20', amount: 20000 },
  });
  const t = '2026-10-25';
  // "Yes, paid" tapped on 25 Oct, with the day it was really paid: the balance stays ₹20,000
  const right = make();
  Core.answerCardDue(right, 'c1', 'full', 0, t, '2026-10-03');
  assert.equal(right.transactions.find((x) => x.kind === 'cardpay').date, '2026-10-03');
  assert.equal(Core.projectRunway(right, t).balanceToday, 20000);
  // Recorded on the day of answering (the old way), the ₹6,000 was kept aside a second time
  const wrong = make();
  Core.answerCardDue(wrong, 'c1', 'full', 0, t);
  assert.equal(Core.projectRunway(wrong, t).balanceToday, 14000);
  // Moving that payment's date back to 3 Oct (the edit screen) puts it right
  wrong.transactions.find((x) => x.kind === 'cardpay').date = '2026-10-03';
  assert.equal(Core.projectRunway(wrong, t).balanceToday, 20000);
  // A date in the future is never used
  const future = make();
  Core.answerCardDue(future, 'c1', 'full', 0, t, '2026-11-02');
  assert.equal(future.transactions.find((x) => x.kind === 'cardpay').date, t);
});

test('a card added after its bill was paid: paying on the due date shows paid, not overdue', () => {
  // Added on 25 Oct with the bill due 3 Oct; "paid on 3 Oct" is before the card was added.
  const s = baseState({
    cards: [{ id: 'c1', name: 'HDFC card', last4: '1234', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-25',
      setupStatement: 6000, setupDueDate: '2026-10-03', setupUnbilled: 0 }],
    transactions: [{ id: 'cp1', kind: 'cardpay', cardId: 'c1', date: '2026-10-03', amount: 6000 }],
  });
  const st = Core.cardStatus(s, s.cards[0], '2026-10-26');
  assert.equal(st.remaining, 0);
  assert.equal(st.overdue, false);
  // A payment for an older bill, before that statement, doesn't count toward it
  s.transactions[0].date = '2026-09-03';
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-26').overdue, true);
});

test('a card bill noted as spending becomes a card payment, merged with the one already recorded', () => {
  const make = () => baseState({
    cards: [{ id: 'c1', name: 'HDFC card', last4: '1234', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-25',
      setupStatement: 6000, setupDueDate: '2026-10-03' }],
    transactions: [
      { id: 'sp', date: '2026-10-03', amount: 6000, category: 'Bills', note: 'Credit Card', source: 'manual' },
      { id: 'cp1', kind: 'cardpay', cardId: 'c1', date: '2026-10-26', amount: 6000, source: 'account' },
    ],
  });
  assert.equal(Core.looksLikeCardBill('Credit Card'), true);
  assert.equal(Core.looksLikeCardBill('HDFC CC bill'), true);
  assert.equal(Core.looksLikeCardBill('Electricity'), false);
  // Already recorded: that payment moves to the real date; the spending goes
  const s = make();
  const r = Core.spendToCardPayment(s, 'sp', 'c1');
  assert.equal(r.merged, true);
  assert.deepEqual(s.transactions.map((t) => [t.id, t.date]), [['cp1', '2026-10-03']]);
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-10-26').overdue, false);
  // Not recorded yet: the spending itself turns into the card payment
  const n = make();
  n.transactions = n.transactions.filter((t) => t.id !== 'cp1');
  const r2 = Core.spendToCardPayment(n, 'sp', 'c1');
  assert.equal(r2.merged, false);
  assert.equal(n.transactions.length, 1);
  assert.equal(n.transactions[0].kind, 'cardpay');
  assert.equal(n.transactions[0].date, '2026-10-03');
  assert.equal(Core.spendInRange(n.transactions, { start: '2026-09-28', next: '2026-10-28' }).length, 0);
});

test('set-asides never take the money daily life needs', () => {
  // ₹98,000 salary, ₹95,137 already gone on fixed payments and EMIs: ₹2,863 left.
  const s = baseState({
    settings: { salary: 98000, payday: 28 },
    fixed: [{ id: 'f1', name: 'Rent', amount: 44350, dueDay: 28 }],
    debts: [{ id: 'd1', name: 'Card EMI', balance: 24705, rate: 22.44, minPayment: 6010, dueDay: 3 },
      { id: 'd2', name: 'Personal loan', balance: 1011703, rate: 11, minPayment: 44777, dueDay: 7 }],
    budgets: ['Groceries', 'Food & dining', 'Travel', 'Shopping', 'Entertainment', 'Health', 'Personal care', 'Misc'].map((name, i) => ({ id: 'b' + i, name, amount: 0, auto: true })),
    savings: { auto: true, emergencyBalance: 0, emergencyTargetMonths: 6 },
  });
  const sv = Core.autoSavings(s, '2026-10-26');
  assert.equal(sv.emergencyMonthly + sv.debtExtra + sv.investMonthly, 0);
  const plan = Core.monthlyPlan(s, '2026-10-26');
  assert.equal(plan.flexTotal, 2863);
  // A small pool is shared in tens, so Health isn't rounded down to nothing
  const health = plan.budgets.find((b) => b.name === 'Health');
  assert.ok(health.amount >= 100, 'Health gets ' + health.amount);
  assert.equal(plan.budgets.reduce((t, b) => t + b.amount, 0), 2863);
  // With room to spare, the usual set-aside is unchanged
  s.debts[1].minPayment = 14777;
  assert.ok(Core.autoSavings(s, '2026-10-26').emergencyMonthly > 0);
});

test('an EMI billed on a credit card is counted once, not again in the card bill', () => {
  // Card added 25 Oct; the 14 Oct statement (due 3 Nov) is just the ₹6,010 card EMI.
  const make = (via) => baseState({
    settings: { salary: 98000, payday: 28 },
    fixed: [],
    budgets: [],
    debts: [Object.assign({ id: 'emi', name: 'Credit card emi', balance: 24705, rate: 22.44, minPayment: 6010, dueDay: 3, emiThrough: '2026-10-03' }, via ? { viaCard: 'c1' } : {})],
    cards: [{ id: 'c1', name: 'HDFC card', last4: '6645', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-25',
      setupStatement: 6010, setupDueDate: '2026-11-03', setupUnbilled: 0 }],
    transactions: [{ id: 'old', kind: 'cardpay', cardId: 'c1', date: '2026-10-03', amount: 6000 }],
  });
  const cyc = Core.cycleFor('2026-10-29', 28);
  const outOn3 = (s) => Core.cycleEvents(s, cyc, '2026-10-29').filter((e) => e.date === '2026-11-03').reduce((t, e) => t + e.amount, 0);
  // Before: the EMI and the card bill holding it both came off
  assert.equal(outOn3(make(false)), 12020);
  // Paid through the card: once
  const s = make(true);
  assert.equal(outOn3(s), 6010);
  const st = Core.cardStatus(s, s.cards[0], '2026-10-29');
  assert.equal(st.total, 6010);
  assert.equal(st.remaining, 6010);
  assert.equal(st.due, '2026-11-03');
  // Paying the bill on 3 Nov, then ₹1,000 on the card on 5 Nov: that ₹1,000 is still owed, not cancelled by the EMI payment
  Core.answerCardDue(s, 'c1', 'full', 0, '2026-11-03', '2026-11-03');
  s.transactions.push({ id: 'sp', date: '2026-11-05', amount: 1000, category: 'Shopping', paidFrom: 'c1' });
  assert.equal(Core.cardStatus(s, s.cards[0], '2026-11-04').remaining, 0);
  assert.equal(Core.cardReserve(s, '2026-11-10'), 1000);
  // The 14 Nov statement: the ₹1,000 plus the next EMI
  const nov = Core.cardStatus(s, s.cards[0], '2026-11-20');
  assert.equal(nov.statementDate, '2026-11-14');
  assert.equal(nov.total, 7010);
  assert.equal(nov.due, '2026-12-03');
  // Next round only the EMI leaves on 3 Dec; the ₹1,000 was counted when it was spent
  const dec = Core.cycleEvents(s, Core.cycleFor('2026-11-29', 28), '2026-11-29').filter((e) => e.date === '2026-12-03');
  assert.deepEqual(dec.map((e) => [e.name, e.amount]), [['Credit card emi', 6010]]);
  // And the loan goes down after each EMI
  Core.tickDebts(s, '2026-11-04');
  assert.ok(s.debts[0].balance < 24705 && s.debts[0].balance > 18000, 'balance ' + s.debts[0].balance);
});

test('a card EMI with 4 left ends after the 4th, and stops being billed on the card', () => {
  // A bill turned into 6 EMIs of ₹6,010 two months ago; 4 left, the next on 3 Nov.
  const s = baseState({
    settings: { salary: 98000, payday: 28 },
    fixed: [], budgets: [],
    cards: [{ id: 'c1', name: 'HDFC card', last4: '6645', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-25',
      setupStatement: 6010, setupDueDate: '2026-11-03' }],
  });
  const d = Core.addCardEmi(s, 'c1', { emi: 6010, left: 4, rate: 22 }, '2026-10-26');
  assert.equal(d.viaCard, 'c1');
  assert.equal(d.emiThrough, '2026-10-03');
  // What's left, worked out from 4 EMIs at 22%: a bit under 4 × ₹6,010
  assert.ok(d.balance > 22000 && d.balance < 24040, 'balance ' + d.balance);
  // The payoff plan clears it in month 4, not 5
  assert.deepEqual(Core.simulateDebts([{ name: 'x', balance: 24705, rate: 22.44, minPayment: 6010, emisLeft: 4 }], 0, 'avalanche').order, [{ name: 'x', month: 4 }]);
  // 3 Nov, 3 Dec, 3 Jan, 3 Feb: then it's cleared
  let cleared = Core.tickDebts(s, '2027-01-04');
  assert.equal(d.emisLeft, 1);
  assert.ok(d.balance > 0);
  assert.equal(cleared.length, 0);
  cleared = Core.tickDebts(s, '2027-02-03');
  assert.equal(d.balance, 0);
  assert.equal(cleared.length, 1);
  // Billed on the card for the Nov, Dec and Jan statements (due Dec, Jan, Feb), and not after
  assert.equal(Core.cardOwedAt(s, s.cards[0], '2027-01-20'), 6010 + 3 * 6010);
  assert.equal(Core.cardOwedAt(s, s.cards[0], '2027-03-20'), 6010 + 3 * 6010);
  // No more EMI leaving after it's done
  const mar = Core.cycleEvents(s, Core.cycleFor('2027-03-01', 28), '2027-03-01');
  assert.equal(mar.filter((e) => e.kind === 'debt').length, 0);
});

test('a card-billed EMI paid from the account counts once: in the plan, next payday and net worth', () => {
  const s = baseState({
    settings: { salary: 98000, payday: 28 },
    fixed: [], budgets: [],
    debts: [{ id: 'emi', name: 'Credit card emi', balance: 24705, rate: 22.44, minPayment: 6010, dueDay: 3, viaCard: 'c1', emisLeft: 4 }],
    cards: [{ id: 'c1', name: 'HDFC card', last4: '6645', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-25',
      setupStatement: 6010, setupDueDate: '2026-11-03' }],
  });
  const t = '2026-10-26';
  assert.equal(Core.monthlyPlan(s, t).debtMin, 6010);
  const next = Core.nextPaydayPreview(s, t);
  assert.equal(next.fromBefore, 0);
  assert.equal(next.committed, 6010);
  // Owed once, as the loan, not again as card debt
  const w = Core.netWorth(s, t);
  assert.equal(w.cards, 0);
  assert.equal(w.loans, 24705);
});

test('HDFC SMS formats: UPI sent, card UPI "Txn", credit alerts and Smart EMI', () => {
  const t = '2026-10-26';
  const read = (text) => Core.parseSms(text, {}, t);
  // UPI from the account
  let p = read('Sent Rs.120.50\nFrom HDFC Bank A/C *4321\nTo GREEN LEAF CAFE\nOn 21/10/26\nRef 123456789012\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808');
  assert.deepEqual([p.type, p.amount, p.merchant, p.date, p.paidFrom], ['debit', 121, 'Green Leaf Cafe', '2026-10-21', 'account']);
  // UPI on a credit card: "Txn Rs…", a date with no year, the shop behind a payment gateway
  p = read('Txn Rs.540.00\nOn HDFC Bank Card 9876\nAt bluestore.payu@indus \nby UPI 123456789012\nOn 19-10\nNot You?\nCall 18002586161/SMS BLOCK CC 9876 to 7308080808');
  assert.deepEqual([p.type, p.amount, p.merchant, p.date, p.paidFrom, p.last4], ['debit', 540, 'Bluestore', '2026-10-19', 'card', '9876']);
  assert.equal(read('Txn Rs.258.00 On HDFC Bank Card 9876 At paytmqr1ab2c3@ptys by UPI 123 On 20-08').merchant, 'Paytm QR');
  // A day-month later than today is last year's
  assert.equal(read('Txn Rs.99.00 On HDFC Bank Card 9876 At shop@okaxis by UPI 1 On 30-12').date, '2025-12-30');
  // Money in, including a sender the bank masks
  p = read('Credit Alert!\nRs.2000.00 credited to HDFC Bank A/c XX4321 on 20-10-26 from VPA *7788@okaxis (UPI 629351271163)');
  assert.deepEqual([p.type, p.amount, p.merchant, p.date], ['credit', 2000, 'UPI *7788', '2026-10-20']);
  // Smart EMI: the OTP and the confirmation are an EMI to offer, never a payment
  p = read('OTP: 111222\n For: HDFC Bank SMART EMI Loan booking on Card 9876\n Details: Loan of Rs 24000, 01.50% pm, Tenure 06 months.\n Never Share OTP');
  assert.deepEqual([p.type, p.amount, p.months, p.rate, p.last4, p.booked], ['cardemi', 24000, 6, 18, '9876', false]);
  p = read('Congrats,your loan is boarded.Dear Cardmember, we have processed your Smart EMI  request for Rs.   ****23999.99 payable in  **6 EMIs *1.50000 % ROI pm on card ending 9876 hdfcbank');
  assert.deepEqual([p.type, p.amount, p.months, p.rate, p.last4, p.booked], ['cardemi', 24000, 6, 18, '9876', true]);
  // Any other OTP is still nothing
  assert.equal(read('Your OTP is 123456 for a txn of Rs 500 at Amazon'), null);
});

test('an EMI booked from SMS: how many are paid and left by today', () => {
  const card = { statementDay: 14, dueDay: 3 };
  // Booked 20 Jul: EMIs due 3 Sep and 3 Oct are paid, 4 left from 3 Nov
  const r = Core.cardEmiFromBooking(card, { date: '2026-07-20', amount: 36390, months: 6, rate: 22.44 }, '2026-10-26');
  assert.deepEqual([r.paid, r.left, r.next], [2, 4, '2026-11-03']);
  assert.ok(r.emi > 6000 && r.emi < 6600, 'emi ' + r.emi);
});

test('bank SMS with an amount that is not money moving are skipped', () => {
  const read = (text) => Core.parseSms(text, {}, '2026-11-03');
  // Read before as a ₹200 refund to the card
  assert.equal(read('Reward Points Credited: 140 To HDFC Bank Credit Card 9876 On 03/AUG/2026 Towards 2 RP per Rs.200 on CC UPI spend'), null);
  assert.equal(read('Asha M has requested Rs.500.00 from you on Google Pay. UPI collect request'), null);
  assert.equal(read('Dear Customer, Rs.6010.00 will be debited from your A/c XX4321 on 03-11-26 towards EMI.'), null);
  assert.equal(read('Your e-mandate for Rs.1499 to Netflix has been registered successfully on A/c XX4321.'), null);
  // Offers, even with "Rs.100 spent" or "credited" in them
  assert.equal(read('Get LIFETIME FREE pre-approved XYZ Bank Credit Card & enjoy up to 19 points per Rs.100 spent on flights https://x.bank.in/a T&C apply'), null);
  assert.equal(read('Congratulations! You are eligible for a pre-approved loan of Rs.2,00,000 credited instantly. Apply now'), null);
  // A bonus in a DTH or shop account isn't money in the bank
  assert.equal(read('Dear Subscriber, Thank you for joining the Flexi Plan. Bonus amount of Rs. 50.00 has been credited to your a/c 1234567890. Total balance now is Rs. 900'), null);
  // An income tax refund is money in, and says so
  const refund = read('Dear Customer, For PAN XXXXXX111A, An IT Refund amount of Rs 4500 for AY-2026-27 has been credited to your account XXXXXXXXXX4321 on 2026-06-19. -SBI');
  assert.deepEqual([refund.type, refund.amount, refund.merchant, refund.date], ['credit', 4500, 'Income tax refund', '2026-06-19']);
  // Real money still counts
  assert.equal(read('Rs.50.00 cashback credited to your A/c XX4321 on 25-10-26 from PhonePe').type, 'credit');
  assert.equal(read('Rs.6010.00 debited from A/c XX4321 on 03-11-26 towards EMI. Avl bal Rs.1200').amount, 6010);
});

test('money passed on (from a friend straight to a brother) is neither income nor spending', () => {
  const t = '2026-10-26';
  const s = baseState({
    settings: { salary: 50000, payday: 1 },
    balanceCheck: { date: '2026-10-23', amount: 1000 },
    transactions: [
      { id: 'in', kind: 'in', date: t, amount: 26000, category: 'Money received', note: 'Friend', source: 'sms', useFor: null },
      { id: 'out', date: t, amount: 26000, category: 'Misc', note: 'Brother', source: 'sms' },
    ],
  });
  const before = Core.projectRunway(s, t);
  assert.ok(before.overToday > 0, 'before: shown as over by ' + before.overToday);
  const pair = Core.passThroughPair(s, t);
  assert.deepEqual([pair.in.id, pair.out.id], ['in', 'out']);
  Core.passOn(s, 'in', 'out');
  const r = Core.projectRunway(s, t);
  const plain = Core.projectRunway(baseState({ settings: { salary: 50000, payday: 1 }, balanceCheck: { date: '2026-10-23', amount: 1000 } }), t);
  assert.equal(Math.round(r.dailyAllowance), Math.round(plain.dailyAllowance));
  assert.equal(r.spentToday, 0);
  assert.equal(r.overToday, 0);
  assert.equal(r.balanceToday, plain.balanceToday);
  assert.equal(Core.passThroughPair(s, t), null);
});

test('money with friends moves the balance: paid ₹26,000 back but got only ₹20,000, so ₹6,000 short', () => {
  const s = baseState({ settings: { salary: 50000, payday: 1 }, balanceCheck: { date: '2026-10-23', amount: 1000 },
    transactions: [
      { id: 'in', kind: 'in', date: '2026-10-26', amount: 26000, category: 'Money received', note: 'Rahul', useFor: null },
      { id: 'out', date: '2026-10-26', amount: 26000, category: 'Misc', note: 'Amit' },
    ] });
  const owe = Core.addIou(s, { name: 'Rahul', dir: 'owe', amount: 26000, promised: '2026-10-27', txId: 'in' }, '2026-10-26');
  const lent = Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 26000, promised: '2026-10-27', txId: 'out' }, '2026-10-26');
  const before = Core.projectRunway(s, '2026-10-27');
  s.transactions.push({ id: 'p1', date: '2026-10-27', amount: 26000, category: 'Misc', note: 'Rahul' });
  Core.payIou(s, owe.id, 26000, '2026-10-27', 'p1');
  s.transactions.push({ id: 'p2', kind: 'in', date: '2026-10-27', amount: 20000, category: 'Money returned', note: 'Amit', useFor: 'spend' });
  Core.payIou(s, lent.id, 20000, '2026-10-27', 'p2');
  const r = Core.projectRunway(s, '2026-10-27');
  assert.equal(r.balanceToday, before.balanceToday - 6000);
  assert.ok(r.dailyAllowance < before.dailyAllowance);
  // Still not spending, and Amit owes ₹6,000
  assert.equal(r.spentToDate, 0);
  assert.equal(Core.iouLeft(lent), 6000);
});

test('money between friends and family: no EMI, promised dates, chunks of any size', () => {
  const t = '2026-10-26';
  const plain = () => baseState({ settings: { salary: 50000, payday: 1 }, balanceCheck: { date: '2026-10-23', amount: 1000 },
    transactions: [
      { id: 'in', kind: 'in', date: t, amount: 26000, category: 'Money received', note: 'Rahul', source: 'sms', useFor: null },
      { id: 'out', date: t, amount: 26000, category: 'Misc', note: 'Amit', source: 'sms' },
    ] });
  const free = Core.projectRunway(baseState({ settings: { salary: 50000, payday: 1 }, balanceCheck: { date: '2026-10-23', amount: 1000 } }), t);
  // Borrowed from Rahul, lent to Amit; Amit promised it back tomorrow, Rahul gets it then
  const s = plain();
  const owe = Core.addIou(s, { name: 'Rahul', dir: 'owe', amount: 26000, promised: '2026-10-27', txId: 'in' }, t);
  const lent = Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 26000, promised: '2026-10-27', txId: 'out' }, t);
  let r = Core.projectRunway(s, t);
  // Neither the ₹26,000 in nor out is income or spending, and the two promises cancel: today is as before
  assert.equal(Math.round(r.dailyAllowance), Math.round(free.dailyAllowance));
  assert.equal(r.spentToday, 0);
  assert.equal(Core.cycleEvents(s, r.cycle, t).filter((e) => e.kind === 'iou').length, 0);
  let sum = Core.iouSummary(s, t);
  assert.deepEqual([sum.oweTotal, sum.lentTotal, sum.net], [26000, 26000, 0]);
  // Without Amit's promise, the ₹26,000 promised to Rahul tomorrow is a payment to come
  const alone = plain();
  Core.addIou(alone, { name: 'Rahul', dir: 'owe', amount: 26000, promised: '2026-10-27', txId: 'in' }, t);
  const ev = Core.cycleEvents(alone, Core.cycleFor(t, 1), t).filter((e) => e.kind === 'iou');
  assert.deepEqual(ev.map((e) => [e.date, e.amount]), [['2026-10-27', 26000]]);
  // Both promises pass with nothing back: the friend still waits on the brother, so payday isn't ₹26,000 short
  assert.equal(Core.cycleEvents(s, Core.cycleFor('2026-10-29', 1), '2026-10-29').filter((e) => e.kind === 'iou').length, 0);
  // Alone, a late ₹26,000 to Rahul is due now
  assert.deepEqual(Core.cycleEvents(alone, Core.cycleFor('2026-10-29', 1), '2026-10-29').filter((e) => e.kind === 'iou').map((e) => [e.date, e.amount]), [['2026-10-29', 26000]]);
  // No date: nothing comes out before payday, it's just owed
  const later = plain();
  Core.addIou(later, { name: 'Rahul', dir: 'owe', amount: 26000, promised: null, txId: 'in' }, t);
  assert.equal(Core.cycleEvents(later, Core.cycleFor(t, 1), t).filter((e) => e.kind === 'iou').length, 0);
  // Amit pays back ₹10,000 now and ₹16,000 later: money in, not income
  s.transactions.push({ id: 'back1', kind: 'in', date: '2026-10-27', amount: 10000, category: 'Money returned', note: 'Amit', useFor: 'spend' });
  Core.payIou(s, lent.id, 10000, '2026-10-27', 'back1');
  assert.equal(Core.iouLeft(lent), 16000);
  // The ₹10,000 back is kept for Rahul, due today (Amit's other ₹16,000 covers the rest)
  r = Core.projectRunway(s, '2026-10-27');
  assert.equal(r.balanceToday, free.balanceToday);
  assert.equal(r.spentToDate, 0);
  // Amit's money back doesn't change net worth: it moves from "owed to you" to the account, and Rahul's due today counts once
  const w0 = Core.netWorth(s, '2026-10-27').value;
  s.transactions.push({ id: 'back2', kind: 'in', date: '2026-10-27', amount: 16000, category: 'Money returned', note: 'Amit', useFor: 'spend' });
  Core.payIou(s, lent.id, 16000, '2026-10-27', 'back2');
  assert.equal(Core.netWorth(s, '2026-10-27').value, w0);
  Core.undoIouTx(s, s.transactions.find((x) => x.id === 'back2'));
  s.transactions = s.transactions.filter((x) => x.id !== 'back2');
  // With no date promised to Rahul, it's simply ₹10,000 more in the account
  owe.promised = null;
  assert.equal(Core.projectRunway(s, '2026-10-27').balanceToday, free.balanceToday + 10000);
  owe.promised = '2026-10-27';
  // Interest agreed with Rahul: ₹500 more owed
  owe.amount += 500;
  sum = Core.iouSummary(s, '2026-10-27');
  assert.deepEqual([sum.oweTotal, sum.lentTotal], [26500, 16000]);
  // Net worth counts both sides
  const w = Core.netWorth(s, '2026-10-27');
  assert.deepEqual([w.owedPeople, w.lentPeople], [26500, 16000]);
  // Deleting the repayment entry puts it back on what Amit owes
  Core.undoIouTx(s, s.transactions.find((x) => x.id === 'back1'));
  assert.equal(Core.iouLeft(lent), 26000);
  // A promise that passed is late
  assert.deepEqual(Core.iouSummary(s, '2026-10-29').late.map((i) => i.name).sort(), ['Amit', 'Rahul']);
});

test('a gift kept for a purchase stays out of daily spending, then pays for the purchase', () => {
  const t = '2026-10-26';
  const make = () => baseState({ settings: { salary: 50000, payday: 1 }, balanceCheck: { date: '2026-10-23', amount: 1000 },
    transactions: [{ id: 'g', kind: 'in', date: t, amount: 5000, category: 'From family', note: 'Father', useFor: 'keep', keepFor: 'Diwali shopping', keepUsed: 0 }] });
  const none = Core.projectRunway(baseState({ settings: { salary: 50000, payday: 1 }, balanceCheck: { date: '2026-10-23', amount: 1000 } }), t);
  const s = make();
  let r = Core.projectRunway(s, t);
  // In the account, but today's amount doesn't jump
  assert.equal(r.balanceToday, none.balanceToday + 5000);
  assert.equal(Math.round(r.dailyAllowance), Math.round(none.dailyAllowance));
  assert.deepEqual(Core.keptFor(s).map((k) => [k.name, k.left]), [['Diwali shopping', 5000]]);
  // Bought for ₹4,700 today: over today's amount, until the gift pays for it
  s.transactions.push({ id: 'buy', date: t, amount: 4700, category: 'Shopping', note: 'Croma' });
  assert.ok(Core.projectRunway(s, t).overToday > 0);
  assert.equal(Core.coverPurchase(s, 'g', 'buy'), 4700);
  r = Core.projectRunway(s, t);
  assert.equal(r.overToday, 0);
  assert.equal(r.spentToday, 0);
  assert.equal(r.balanceToday, none.balanceToday + 300);
  assert.equal(Math.round(r.dailyAllowance), Math.round(none.dailyAllowance));
  assert.deepEqual(Core.keptFor(s).map((k) => k.left), [300]);
  // Still where the money went: ₹4,700 on Shopping
  assert.equal(Core.spendWhere(s, t, 'cycle').categories.find((c) => c.name === 'Shopping').spent, 4700);
  // A second purchase takes only what's left
  s.transactions.push({ id: 'buy2', date: t, amount: 1000, category: 'Gifts', note: 'Sweets' });
  assert.equal(Core.coverPurchase(s, 'g', 'buy2'), 300);
  assert.equal(Core.keptFor(s).length, 0);
});

test('an EMI kept as a bill or fixed payment ends by itself after the last one', () => {
  // ₹6,000 a month, 4 left, the next on 3 Nov: the last is 3 Feb
  const s = baseState({ settings: { salary: 98000, payday: 28 }, fixed: [{ id: 'f1', name: 'Phone EMI', amount: 3750, dueDay: 3 }],
    bills: [{ id: 'emi', name: 'Card EMI', estimate: 6000, everyMonths: 1, nextDue: '2026-11-03', history: [6000] }] });
  const t = '2026-10-27';
  const bill = s.bills[0];
  bill.lastDue = Core.lastDueFrom(bill, true, 4, t);
  assert.equal(bill.lastDue, '2027-02-03');
  assert.equal(Core.paymentsLeft(bill, true, t), 4);
  // Fixed: 2 left from today, the next on 3 Nov: the last is 3 Dec
  const phone = s.fixed[0];
  phone.lastDue = Core.lastDueFrom(phone, false, 2, t);
  assert.equal(phone.lastDue, '2026-12-03');
  assert.equal(Core.paymentsLeft(phone, false, '2026-11-10'), 1);
  const due = (iso) => {
    const c = Core.cycleFor(iso, 28);
    const ev = Core.cycleEvents(s, c, iso);
    const p = Core.monthlyPlan(s, iso);
    return [ev.filter((e) => e.kind === 'bill').map((e) => e.amount), ev.filter((e) => e.kind === 'fixed').map((e) => e.amount), p.variableBills, p.fixedTotal];
  };
  // Counted each round up to the last one, never after (without paying it in the app)
  assert.deepEqual(due('2026-10-28'), [[6000], [3750], 6000, 3750]);
  assert.deepEqual(due('2026-11-28'), [[6000], [3750], 6000, 3750]);
  assert.deepEqual(due('2026-12-28'), [[6000], [], 6000, 0]);
  assert.deepEqual(due('2027-01-28'), [[6000], [], 6000, 0]);
  assert.deepEqual(due('2027-02-28'), [[], [], 0, 0]);
  // Paying the last one ends it at once
  bill.nextDue = '2027-02-03';
  Core.payBill(s, 'emi', 6000, 1, '2027-02-03');
  assert.equal(Core.billEnded(bill, null), true);
  assert.equal(Core.billDue(bill, Core.cycleFor('2027-02-03', 28)), false);
  // Blank: no end
  assert.equal(Core.lastDueFrom(bill, true, '', t), null);
});

test('each loan’s last EMI, from what is owed, the rate and the EMI', () => {
  const s = baseState({ settings: { salary: 98000, payday: 28 } });
  const t = '2026-10-27';
  // ₹1,00,000 at 12% with ₹10,000 a month: 11 EMIs (the bank's own schedule), the next on 7 Nov
  const d = { id: 'd', name: 'Loan', balance: 100000, rate: 12, minPayment: 10000, dueDay: 7, emiThrough: '2026-10-07' };
  assert.deepEqual(Core.loanEnd(s, d, t), { left: 11, next: '2026-11-07', last: '2027-09-07' });
  // It agrees with paying it month by month
  let b = 100000, n = 0;
  while (b > 0) { b = Math.max(0, Math.round(b * 1.01 - 10000)); n++; }
  assert.equal(n, 11);
  // No interest: owed ÷ EMI
  assert.equal(Core.loanEnd(s, Object.assign({}, d, { rate: 0 }), t).left, 10);
  // An EMI below the month's interest never ends
  assert.deepEqual(Core.loanEnd(s, Object.assign({}, d, { minPayment: 900 }), t), { never: true, interest: 1000 });
  // A card EMI with 4 left: 4, on the card's due day
  s.cards = [{ id: 'c', name: 'HDFC', dueDay: 3, statementDay: 14 }];
  const emi = { id: 'e', name: 'HDFC EMI', balance: 23000, rate: 22.44, minPayment: 6010, viaCard: 'c', emisLeft: 4, emiThrough: '2026-10-03' };
  assert.deepEqual(Core.loanEnd(s, emi, t), { left: 4, next: '2026-11-03', last: '2027-02-03' });
});

test('a salary SMS without the word salary is still the salary', () => {
  const s = baseState({ settings: { salary: 98000, payday: 28 } });
  const credit = (amount, date, raw) => ({ type: 'credit', amount, date, raw: raw || 'Rs.' + amount + ' credited to a/c XX1234 by NEFT ACME TECH PVT LTD' });
  // Payday, close to the usual pay (overtime included)
  assert.equal(Core.looksLikeSalary(s, credit(107689, '2026-10-28')), true);
  // Two days early (payday on a Sunday)
  assert.equal(Core.looksLikeSalary(s, credit(98000, '2026-10-26')), true);
  // A friend's ₹26,000, or a big amount mid-month: not salary
  assert.equal(Core.looksLikeSalary(s, credit(26000, '2026-10-28')), false);
  assert.equal(Core.looksLikeSalary(s, credit(98000, '2026-10-15')), false);
  // A loan credit never is
  assert.equal(Core.looksLikeSalary(s, credit(100000, '2026-10-28', 'Loan amount Rs.100000 disbursed to a/c XX1234')), false);
  // Only the first one this month
  s.salarySeen = { cycle: '2026-10-28', amount: 107689, date: '2026-10-28' };
  assert.equal(Core.looksLikeSalary(s, credit(98000, '2026-10-29')), false);
  // The word itself always counts
  assert.equal(Core.looksLikeSalary(s, Object.assign(credit(5000, '2026-10-10'), { salary: true })), true);
});

test('the extra in this month\'s pay is counted once', () => {
  const t = '2026-10-28';
  const s = baseState({ settings: { salary: 98000, payday: 28 }, fixed: [] });
  // Paid ₹1,07,689 against a usual ₹98,000: ₹9,689 extra, recorded as money in
  s.transactions.push({ id: 'extra', kind: 'in', date: t, amount: 9689, category: 'Overtime', note: 'Extra in this month’s pay', useFor: 'spend' });
  s.payslips = { [t]: { amount: 107689, usual: 98000, reason: 'Overtime', extraTx: 'extra' } };
  const plain = Core.projectRunway(s, t).balanceToday;
  // Without a balance entered, the extra adds to the usual pay
  assert.equal(plain, 98000 + 9689);
  // The balance entered on payday already holds all of it: not added again
  s.balanceCheck = { date: t, amount: 107857 };
  assert.equal(Core.projectRunway(s, t).balanceToday, 107857);
  // Usual pay raised to cover it (and no balance): counted once
  delete s.balanceCheck;
  s.settings.salary = 107689;
  assert.equal(Core.projectRunway(s, t).balanceToday, 107689);
  // Given to the emergency fund: it comes off what's shown
  s.balanceCheck = { date: t, amount: 107857 };
  s.transactions[0].useFor = 'emergency';
  assert.equal(Core.projectRunway(s, t).balanceToday, 107857 - 9689);
});

test('debt-free dates: what makes the plan sooner is said, never assumed', () => {
  const t = '2026-10-27';
  const one = baseState({ debts: [{ id: 'a', name: 'Car', balance: 100000, rate: 9, minPayment: 5000, dueDay: 5 }] });
  // One loan, nothing extra: the same date, no saving claimed
  let d = Core.debtFreeDates(one, t);
  assert.equal(d.sooner, 0);
  assert.equal(d.saved, 0);
  // Two loans, nothing extra: sooner only by moving the first one's EMI to the second, and it says so
  const two = baseState({ debts: [{ id: 'a', name: 'Car', balance: 50000, rate: 9, minPayment: 5000, dueDay: 5 },
    { id: 'b', name: 'Personal', balance: 300000, rate: 14, minPayment: 7000, dueDay: 7 }] });
  d = Core.debtFreeDates(two, t);
  assert.equal(d.extra, 0);
  assert.equal(d.rollover, true);
  assert.ok(d.sooner > 0 && d.saved > 0);
  // A loan the minimum can't clear: never, and no saving claimed
  const never = baseState({ debts: [{ id: 'a', name: 'Card loan', balance: 100000, rate: 36, minPayment: 2000, dueDay: 5 }] });
  d = Core.debtFreeDates(never, t);
  assert.equal(d.now.never, true);
  assert.equal(d.saved, 0);
});

test('loan money received counts as owed until it is in Debts', () => {
  const t = '2026-10-26';
  const s = baseState({ settings: { salary: 50000, payday: 1 }, balanceCheck: { date: '2026-10-23', amount: 1000 } });
  const before = Core.netWorth(s, t).value;
  s.transactions.push({ id: 'l', kind: 'in', date: t, amount: 10000, category: 'Loan or Pay Later', note: 'KreditBee', useFor: 'spend', borrowed: true });
  assert.equal(Core.netWorth(s, t).value, before);
  assert.equal(Core.netWorth(s, t).newLoans, 10000);
  // Added to Debts: it's counted there instead, once
  s.debts.push({ id: 'd', name: 'KreditBee', balance: 10000, rate: 30, minPayment: 1000, dueDay: 5 });
  s.transactions[0].debtId = 'd';
  assert.equal(Core.netWorth(s, t).value, before);
  assert.equal(Core.netWorth(s, t).newLoans, 0);
});
