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

test('a balance check from an earlier cycle is ignored', () => {
  const s = baseState();
  s.balanceCheck = { date: '2026-09-20', amount: 100 };
  const r = Core.projectRunway(s, '2026-10-05');
  assert.equal(r.anchor, null);
  assert.equal(r.balanceToday, 35000);
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

test('SMS: credits are marked, OTPs and offers are skipped', () => {
  assert.equal(Core.parseSms('Rs 55,000 credited to your a/c XX1234 on 01-10-26 by NEFT SALARY', {}, '2026-10-23').type, 'credit');
  assert.equal(Core.parseSms('123456 is your OTP for txn of Rs 500', {}, '2026-10-23'), null);
  assert.equal(Core.parseSms('Get 20% off on orders above Rs 499!', {}, '2026-10-23'), null);
});

test('SMS: learned categories win over keywords', () => {
  const p = Core.parseSms('Rs.900 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici.', { swiggy: 'Groceries' }, '2026-10-23');
  assert.equal(p.category, 'Groceries');
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
