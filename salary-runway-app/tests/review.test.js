// The money ladder and the monthly review. Made-up households, payday the 1st, today 2 Nov 2026.
// Basics a month = rent ₹15,000 + loan minimums, so a day of basics is that ÷ 30.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-11-02';
const house = (o) => Object.assign({
  settings: { salary: 60000, payday: 1 }, fixed: [{ id: 'rent', name: 'Rent', amount: 15000, dueDay: 5 }], debts: [], bills: [], sinking: [], goals: [], cards: [],
  budgets: [{ id: 'b', name: 'Misc', amount: 20000 }], savings: { emergencyBalance: 0, investSaved: 0, emergencyTargetMonths: 3 }, transactions: [], merchantRules: {},
}, o);
const step = (s) => Core.priorityLadder(s, T);

test('step 1: the salary doesn\'t cover basics and minimums', () => {
  const s = house({ settings: { salary: 20000, payday: 1 }, debts: [{ id: 'pl', name: 'Personal loan', balance: 200000, rate: 14, minPayment: 9000, dueDay: 7 }] });
  const L = step(s);
  assert.equal(L.key, 'basics');
  assert.deepEqual([L.milestone.kind, L.milestone.short], ['basics', 4000]);
  assert.equal(L.steps[0].current, true);
});

test('step 2: a costly card is open, but there\'s no starter fund yet; the nearest milestone is 7 days', () => {
  const s = house({ debts: [{ id: 'cc', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 20 }] });
  s.savings.emergencyBalance = 1000;
  const L = step(s);
  assert.equal(L.key, 'buffer');
  // Basics ₹17,500 a month = ₹583.33 a day; 7 days = ₹4,083.33; ₹1,000 saved → ₹3,084 more
  assert.deepEqual([L.milestone.amount, L.milestone.target, L.milestone.days], [3084, 7, 1]);
  assert.deepEqual(L.steps.map((x) => [x.key, x.done, x.current]).slice(0, 3), [['basics', true, false], ['buffer', false, true], ['debt', false, false]]);
});

test('step 3: a month of basics saved, so the costliest loan comes next; a cheap home loan isn\'t costly', () => {
  const s = house({ debts: [
    { id: 'cc', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 20 },
    { id: 'pl', name: 'Personal loan', balance: 100000, rate: 14, minPayment: 5000, dueDay: 7 },
    { id: 'hl', name: 'Home loan', balance: 2000000, rate: 8.5, minPayment: 18000, dueDay: 10 }] });
  s.savings.emergencyBalance = 41000; // basics ₹40,500 a month
  const L = step(s);
  assert.equal(L.key, 'debt');
  assert.deepEqual([L.milestone.name, L.milestone.rate, L.milestone.count], ['Card', 36, 2]);
});

test('step 4, 5, 6: the full fund, then goals, then investing', () => {
  const s = house({ debts: [{ id: 'hl', name: 'Home loan', balance: 2000000, rate: 8.5, minPayment: 18000, dueDay: 10 }] });
  s.savings.emergencyBalance = 40000; // basics ₹33,000 a month: 36 days
  let L = step(s);
  assert.equal(L.key, 'fund');
  // 3 months = 90 days × ₹1,100 = ₹99,000; ₹59,000 more
  assert.deepEqual([L.milestone.amount, L.milestone.months], [59000, 3]);
  s.savings.emergencyBalance = 99000;
  s.goals = [{ id: 'g', name: 'Bike', target: 60000, saved: 10000, by: '2027-06-01', created: '2026-01-01' }];
  L = step(s);
  assert.deepEqual([L.key, L.milestone.name, L.milestone.left], ['goals', 'Bike', 50000]);
  s.goals[0].saved = 60000;
  assert.equal(step(s).key, 'invest');
});

test('the monthly review: debt-free date moved, net worth over rounds, saved share of pay', () => {
  const s = house({ debts: [{ id: 'cc', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 20 }] });
  s.rounds = { '2026-10-01': { date: '2026-10-01', freedom: 0, debt: 52000, free: '2030-01-20' } };
  s.worthLog = { '2026-09-01': -60000, '2026-10-01': -52000, '2026-11-01': -45000 };
  s.transactions.push({ id: 'm', kind: 'move', date: '2026-10-10', amount: 6000, category: 'Savings', note: 'Jar', useFor: 'emergency' });
  const rv = Core.monthlyReview(s, T);
  const now = Core.debtFreeDates(s, T).plan.date;
  const months = (Core.parseISO(now).getFullYear() - 2030) * 12 + Core.parseISO(now).getMonth() - 0;
  assert.equal(rv.debtFree.moved, months);
  assert.equal(rv.worthChange, 15000);
  assert.deepEqual(rv.savedRate.map((m) => [m.start, m.pct]), [['2026-10-01', 10]]);
  // The AI is asked for the direction once a round
  assert.match(Core.planFacts(s, T, null), /Monthly review this time: yes/);
  s.reviewDone = '2026-11-01';
  assert.match(Core.planFacts(s, T, null), /Monthly review this time: no/);
  assert.match(Core.planFacts(s, T, null), /Now on step 2: a starter safety fund/);
});

test('adviser\'s view: a step naming a bank, fund house or app is dropped; your own loan\'s name is fine', () => {
  const s = house({ debts: [{ id: 'cc', name: 'HDFC credit card EMI', balance: 50000, rate: 22, minPayment: 6000, dueDay: 3 }] });
  const plan = { headline: 'Build the fund', week_goal: {}, sections: [
    { kind: 'advisor', title: 'Adviser', steps: [
      { action: 'Ask SBI for a top-up loan to clear the card', why: 'x', basis: 'general' },
      { action: 'Ask your bank to turn the HDFC credit card EMI balance into a lower-rate EMI', why: '22% is costly', basis: 'numbers' },
      { action: 'Start a SIP on Groww', why: 'y', basis: 'general' },
      { action: 'If anyone depends on your income, term insurance comes before investing', why: 'z', basis: 'general' }] },
    { kind: 'save', title: 'Save', steps: [{ action: 'Use Paytm cashback', why: 'w', basis: 'numbers' }] }] };
  const out = Core.cleanAdvice(plan, s);
  assert.deepEqual(out.sections.map((x) => [x.kind, x.steps.length]), [['advisor', 2]]);
  assert.match(out.sections[0].steps[0].action, /HDFC credit card EMI/);
  // Ordinary words aren't names
  assert.equal(Core.namesBrand('Put a slice of your pay aside, by Bob’s advice', []), null);
  assert.equal(Core.namesBrand('Ask ICICI for a lower rate', []), '=icici');
  assert.match(Core.planFacts(s, T, null), /write the diagnosis and the advisor section/);
});

test('health check: each area\'s number and status, the bank and planner lines', () => {
  const s = house({ debts: [{ id: 'cc', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 20 }] });
  s.savings.emergencyBalance = 1000;
  const hc = Core.healthCheck(s, T);
  const by = Object.fromEntries(hc.areas.map((a) => [a.area, a]));
  // Rent ₹15,000 + EMI ₹2,500 = ₹17,500 = 29% of ₹60,000
  assert.deepEqual([by.cash.committed, by.cash.pct, by.cash.status], [17500, 29, 'good']);
  // EMIs 4% of pay, but a 36% card needs watching
  assert.deepEqual([by.debt.pct, by.debt.status], [4, 'watch']);
  assert.deepEqual([by.fund.days, by.fund.status], [1, 'bad']);
  // Nothing recorded last round: not judged
  assert.deepEqual([by.spend.status, by.save.status], ['unknown', 'unknown']);
  // EMIs over half the pay: what banks refuse
  s.debts[0].minPayment = 32000;
  assert.equal(Core.healthCheck(s, T).areas.find((a) => a.area === 'debt').status, 'bad');
});

test('what if: the plan puts what the pay can really spare on the step; the numbers come from the app', () => {
  const s = house({ debts: [{ id: 'cc', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 20 }] });
  s.savings.emergencyBalance = 1000;
  const room = Core.monthlyRoom(s, T);
  // Pay ₹60,000 − rent and EMI ₹17,500 − usual spending ₹20,000 (the budget, no history) = ₹22,500;
  // none of it is essentials (no Groceries, Health or Travel budget), so a fifth can be trimmed: ₹4,000
  assert.deepEqual([room.committed, room.usual, room.essentials, room.roomNow, room.trim, room.affordable, room.source], [17500, 20000, 0, 22500, 4000, 26500, 'budgets']);
  const wi = Core.whatIf(s, T);
  // ₹3,084 to 7 days of basics: within a month at ₹26,500; nothing put aside last round: never
  assert.deepEqual([wi.step, wi.per, wi.fund.need, wi.fund.months.plan, wi.fund.months.now], ['buffer', 26500, 3084, 1, null]);
  // On the debt step, the spare money on the costliest loan brings debt-free sooner and cuts interest
  s.savings.emergencyBalance = 20000;
  const d = Core.whatIf(s, T);
  assert.equal(d.step, 'debt');
  assert.ok(d.debt.free.plan < d.debt.free.now && d.debt.interest.plan < d.debt.interest.now);
  assert.match(Core.planFacts(s, T, null), /HEALTH CHECK/);
});

test('nothing to spare: the plan is honest about it, and points to extra pay and EMIs that end', () => {
  // Pay ₹40,000; rent ₹15,000; EMIs ₹18,000; budgets ₹7,000 (groceries ₹4,000, health ₹500, travel ₹1,000, misc ₹1,500)
  const s = house({ settings: { salary: 40000, payday: 1 },
    debts: [{ id: 'pl', name: 'Personal loan', balance: 300000, rate: 14, minPayment: 12000, dueDay: 7 },
      { id: 'ce', name: 'Card EMI', balance: 17000, rate: 18, minPayment: 6000, dueDay: 3, emisLeft: 3, emiThrough: '2026-11-03' }],
    budgets: [{ id: 'g', name: 'Groceries', amount: 4000 }, { id: 'h', name: 'Health', amount: 500 }, { id: 't', name: 'Travel', amount: 1000 }, { id: 'm', name: 'Misc', amount: 1500 }] });
  s.transactions.push({ id: 'ot', kind: 'in', date: '2026-11-02', amount: 4000, category: 'Overtime', note: 'Extra pay', useFor: 'spend' });
  const room = Core.monthlyRoom(s, T);
  // ₹40,000 − ₹33,000 − ₹7,000 = ₹0 now; trimming a fifth of the ₹1,500 that isn't essentials: ₹300
  assert.deepEqual([room.roomNow, room.other, room.trim, room.affordable, room.extra], [0, 1500, 300, 300, 4000]);
  assert.deepEqual(room.freed.map((x) => [x.name, x.emi, x.last]), [['Card EMI', 6000, '2027-02-03']]);
  // Today: ₹40,000 on payday less ₹33,000 still to pay leaves ₹7,000 + ₹4,000 extra = ₹11,000 for 28 days of essentials
  const f = Core.feasibility(s, T);
  assert.equal(f.essentialsDaily, Math.round(5500 / 30));
  assert.equal(f.status, f.spare < 0 ? 'short' : f.spare < f.essentials * 0.25 ? 'tight' : 'ok');
  const facts = Core.planFacts(s, T, null);
  assert.match(facts, /REALISM CHECK/);
  assert.match(facts, /Extra pay this round: ₹4,000/);
  assert.match(facts, /Card EMI ₹6,000 a month ends after Feb 2027/);
});

test('the diagnosis passes the name check too', () => {
  const s = house({ debts: [{ id: 'cc', name: 'Card', balance: 50000, rate: 36, minPayment: 2500, dueDay: 20 }] });
  const out = Core.cleanAdvice({ headline: 'h', sections: [], diagnosis: { verdict: 'No cushion yet.',
    causes: [{ title: 'Bills first', text: 'Rent and EMIs take 29% of pay.' }, { title: 'Bank', text: 'Your Axis account pays little.' }],
    actions: [{ action: 'Move ₹3,000 a month to the fund', how_much: 3000, by_when: 'from this payday', changes: '7 days in 2 months' }, { action: 'Open an RD with SBI', how_much: 3000, by_when: 'now', changes: 'x' }],
    checks: ['₹3,000 in the fund', 'Use Paytm less'] } }, s);
  assert.deepEqual([out.diagnosis.causes.length, out.diagnosis.actions.length, out.diagnosis.checks], [1, 1, ['₹3,000 in the fund']]);
});

test('official figures reach the plan with their period and source; none, no section', () => {
  const s = house({});
  assert.doesNotMatch(Core.planFacts(s, T, null), /OFFICIAL FIGURES/);
  s.rates = { fetched: '2026-11-02', figures: [
    { key: 'cpi_inflation', value: 4.8, period: 'Sep 2026', url: 'https://www.mospi.gov.in/cpi' },
    { key: 'ppf', value: 7.1, period: 'Oct-Dec 2026 quarter', url: 'https://www.nsiindia.gov.in/x' }] };
  const f = Core.planFacts(s, T, null);
  assert.match(f, /OFFICIAL FIGURES \(found on government sites on 2 Nov/);
  assert.match(f, /Retail inflation \(CPI, year on year\): 4\.8% \(Sep 2026; mospi\.gov\.in\)\./);
  assert.match(f, /PPF: 7\.1% \(Oct-Dec 2026 quarter; nsiindia\.gov\.in\)\./);
});
