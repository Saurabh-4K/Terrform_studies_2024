// Making the plan practical: where to cut (with ₹ saved), a weekly target that adds up to the
// month, and a check that every rupee amount the AI writes comes from the app's numbers.
// Made-up household, payday the 1st.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-20';
function household(balance) {
  const s = {
    settings: { salary: 50000, payday: 1 },
    fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [],
    budgets: [{ id: 'b1', name: 'Food & dining', amount: 9000 }, { id: 'b2', name: 'Groceries', amount: 9000 }],
    savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
    balanceCheck: { date: T, amount: balance },
  };
  // 28 days before today (22 Sep to 19 Oct): eating out ₹200 and groceries ₹300 every day
  for (let i = 28; i >= 1; i--) {
    const d = Core.addDays(T, -i);
    s.transactions.push({ id: 'f' + i, date: d, amount: 200, category: 'Food & dining', note: '' });
    s.transactions.push({ id: 'g' + i, date: d, amount: 300, category: 'Groceries', note: '' });
  }
  s.transactions.push(
    { id: 'sh', date: '2026-10-01', amount: 2800, category: 'Shopping', note: '' },
    { id: 'en', date: '2026-10-02', amount: 140, category: 'Entertainment', note: '' },
    { id: 'fa', date: '2026-10-03', amount: 5000, category: 'Family', note: '' },
    { id: 'mi', date: '2026-10-04', amount: 1400, category: 'Misc', note: '' },
  );
  return s;
}

test('where to cut: halving what isn\'t essential, by category, with what it saves', () => {
  const c = Core.cutOptions(household(30000), T);
  // 11 days after today to payday. Eating out ₹200 a day → ₹100 saves ₹1,100 by payday, ₹3,000 a month.
  // Shopping ₹2,800 over 28 days = ₹100 a day → ₹50 saves ₹550, ₹1,500 a month.
  // Entertainment ₹5 a day is too small; groceries are essential; family and misc are never offered.
  assert.equal(c.days, 11);
  assert.deepEqual(c.cuts.map((x) => [x.category, x.daily, x.keep, x.toPayday, x.perMonth]),
    [['Food & dining', 200, 100, 1100, 3000], ['Shopping', 100, 50, 550, 1500]]);
  assert.deepEqual([c.total, c.perMonth], [1650, 4500]);
  assert.equal(c.afterCuts, c.endPace + 1650);
});

test('where to cut, when short: the cuts are listed, and the gap on essentials is said plainly', () => {
  const c = Core.cutOptions(household(2000), T);
  assert.equal(c.status, 'short');
  assert.ok(c.shortBy > 0);
  assert.equal(c.cuts.length, 2);
  const f = Core.planFacts(household(2000), T, null);
  assert.match(f, /WHERE TO CUT/);
  assert.match(f, /Food & dining from about ₹200 to ₹100 a day saves ₹1,100 by payday \(₹3,000 a month\)/);
  assert.match(f, /the cuts stop the gap growing, they do not close it/);
  // Under two weeks recorded: nothing to suggest
  const s = household(30000);
  s.transactions = s.transactions.filter((t) => t.date >= '2026-10-10');
  assert.equal(Core.cutOptions(s, T).cuts.length, 0);
});

test('the week\'s target: spent so far + today\'s limit for each day left, never below essentials', () => {
  const s = household(30000);
  // Thursday 22 Oct; this week only Monday has entries so far (₹200 eating out + ₹300 groceries)
  const t = '2026-10-22';
  const w = Core.weekTarget(s, t);
  const r = Core.projectRunway(s, t);
  const ess = Core.essentialsDaily(s, t).daily;
  assert.deepEqual([w.from, w.to, w.spent, w.days, w.daysAfter], ['2026-10-19', '2026-10-25', 500, 4, 0]);
  assert.equal(w.cap, Math.round((500 + Math.max(r.dailyAllowance, ess) * 4) / 10) * 10);
  // A week across payday: the days after it use the new round's daily budget (₹18,000 ÷ 30 days = ₹600)
  const x = Core.weekTarget(s, '2026-10-29');
  assert.deepEqual([x.days, x.daysAfter, x.nextDaily], [3, 1, 600]);
  // Short: no saving goal, only the cap
  assert.equal(Core.weekTarget(household(2000), t).save, null);
});

test('the week\'s saving share comes from the month\'s plan, only when the round is fine', () => {
  const s = household(60000);
  const t = '2026-10-22';
  const wi = Core.whatIf(s, t);
  const w = Core.weekTarget(s, t);
  assert.ok(wi.per > 0);
  assert.equal(w.save.kind, 'save');
  assert.equal(w.save.amount, Math.round((wi.per * 7) / 30 / 10) * 10);
  assert.match(Core.planFacts(s, t, null), new RegExp("THIS WEEK'S TARGET[^]*save ₹" + w.save.amount.toLocaleString('en-IN') + ' this week'));
});

test('the AI\'s weekly goal is held to the week\'s target', () => {
  const target = { cap: 4200, save: null };
  let f = Core.fitWeekGoal({ type: 'spend_cap', amount: 3000, text: 'Spend under ₹3,000' }, target);
  assert.deepEqual([f.goal.type, f.goal.amount, f.changed], ['spend_cap', 4200, true]);
  // Asked to save in a round that can't spare it: the cap instead
  f = Core.fitWeekGoal({ type: 'save', amount: 2000, text: 'Save ₹2,000' }, target);
  assert.deepEqual([f.goal.type, f.goal.amount, f.changed], ['spend_cap', 4200, true]);
  // Right amount, right words: kept as written
  f = Core.fitWeekGoal({ type: 'spend_cap', amount: 4200, text: 'Keep the week under ₹4,200' }, target);
  assert.equal(f.changed, false);
  f = Core.fitWeekGoal({ type: 'no_card', amount: 0, text: 'No card this week' }, target);
  assert.deepEqual([f.goal.amount, f.changed], [0, false]);
});

test('rupee amounts are read the Indian way, Devanagari digits too', () => {
  assert.deepEqual(Core.rupeeAmounts('₹1,20,000; Rs. 500; ₹1.2 lakh; ₹15k; ₹500 kept; ₹२,७०० आणि ₹ 3,000; INR 40'),
    [120000, 500, 120000, 15000, 500, 2700, 3000, 40]);
});

test('every amount the AI writes must come from the facts; a line with another one is left out', () => {
  const facts = 'Short by ₹15,029. Rent ₹22,000. Essentials ₹273 a day.';
  const plan = {
    headline: 'You are about ₹15,000 short this month',
    diagnosis: {
      verdict: 'Your salary of ₹50,000 does not cover it',
      causes: [{ title: 'Rent', text: 'Rent of ₹22,000 and the gap of ₹15,029 together need ₹37,029.' }],
      actions: [{ action: 'Keep to essentials', how_much: 1911, by_when: 'this week', changes: '₹273 a day is ₹1,911 a week' },
        { action: 'Save', how_much: 9999, by_when: 'next month', changes: 'more safety' }],
      checks: ['₹8,000 in the fund', 'no card spending'],
    },
    sections: [{ kind: 'save', title: 'Save', steps: [{ action: 'Cut ₹8,000 of shopping', why: 'x', amount: null, basis: 'numbers' },
      { action: 'Pay rent first', why: 'it is ₹22,000', amount: 22000, basis: 'numbers' }] },
      { kind: 'loans', title: 'Loans', steps: [{ action: 'Pay extra', why: 'y', amount: 4321, basis: 'numbers' }] }],
  };
  const { plan: out, dropped } = Core.checkAdviceNumbers(plan, facts);
  assert.equal(out.headline, 'You are about ₹15,000 short this month');
  assert.equal(out.diagnosis.verdict, '');
  assert.equal(out.diagnosis.causes.length, 1);
  assert.deepEqual(out.diagnosis.actions.map((a) => a.how_much), [1911]);
  assert.deepEqual(out.diagnosis.checks, ['no card spending']);
  assert.deepEqual(out.sections.map((s) => [s.kind, s.steps.length]), [['save', 1]]);
  // verdict, one action, one check, two steps
  assert.equal(dropped, 5);
});

test('a sum of two facts counts only when the line shows it', () => {
  const facts = 'Food ₹765. Shopping ₹7,080.';
  const step = (action) => ({ sections: [{ kind: 'save', title: 'S', steps: [{ action, why: '', amount: null, basis: 'numbers' }] }] });
  assert.equal(Core.checkAdviceNumbers(step('Save ₹7,845 this month'), facts).dropped, 1);
  assert.equal(Core.checkAdviceNumbers(step('₹765 + ₹7,080 = ₹7,845 went on food and shopping'), facts).dropped, 0);
  // About a week of a daily amount, rounded
  assert.equal(Core.checkAdviceNumbers(step('₹765 a day is about ₹5,400 a week'), facts).dropped, 0);
});

test('no usual week until three weeks are recorded: the facts don\'t call anything "above a usual ₹0"', () => {
  const s = household(30000);
  s.transactions = s.transactions.filter((t) => t.date >= '2026-10-10');
  const f = Core.planFacts(s, T, null);
  assert.match(f, /No usual week yet/);
  assert.doesNotMatch(f, /usual ₹0\)/);
  // Four weeks recorded: the usual week is there
  assert.match(Core.planFacts(household(30000), T, null), /against the usual week \(average of the [34] weeks before\)/);
});

test('extra on loans only when the app\'s plan puts money there: other loan steps are left out', () => {
  const s = household(2000);
  s.debts = [{ id: 'c', name: 'Card EMI', balance: 20000, rate: 22, minPayment: 6000, dueDay: 3 }];
  const plan = { sections: [{ kind: 'loans', title: 'Loans', steps: [
    { action: 'Pay every minimum on time', why: 'late fees', amount: null, basis: 'numbers' },
    { action: 'Pay the ₹6,000 EMI', why: 'due', amount: 6000, basis: 'numbers' },
    { action: 'Put ₹1,000 extra on the card EMI', why: 'costly', amount: 1000, basis: 'numbers' }] }] };
  const g = Core.guardExtraLoans(plan, s, T);
  assert.equal(g.dropped, 1);
  assert.deepEqual(g.plan.sections[0].steps.map((x) => x.amount), [null, 6000]);
  // A plan with only the extra step loses the section
  const only = { sections: [{ kind: 'loans', title: 'Loans', steps: [plan.sections[0].steps[2]] }] };
  assert.equal(Core.guardExtraLoans(only, s, T).plan.sections.length, 0);
});
