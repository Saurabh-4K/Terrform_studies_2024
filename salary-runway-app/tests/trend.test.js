// The last 4 weeks, week by week: what's rising, what's falling, how goals went, and how hard
// this week's goal should be. Made-up data; today is Monday 2 Nov 2026.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-11-02';
function household() {
  const s = { settings: { salary: 50000, payday: 1 }, fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [],
    budgets: [{ id: 'b', name: 'Food & dining', amount: 6000 }], savings: {}, transactions: [], merchantRules: {}, days: {} };
  const spend = (date, amount, category) => s.transactions.push({ id: date + category, date, amount, category, note: 'Shop' });
  // Week of 5 Oct: almost nothing recorded
  spend('2026-10-06', 50, 'Misc');
  // Food up, groceries down, over the next three weeks (two days recorded each week)
  [['2026-10-12', 800, 2000], ['2026-10-19', 1100, 1500], ['2026-10-26', 1400, 1000]].forEach(([mon, food, groc]) => {
    spend(mon, food, 'Food & dining');
    spend(Core.addDays(mon, 2), groc, 'Groceries');
  });
  // A limit of ₹400 on each day of the last week: within it 5 days, over on 2
  for (let i = 0; i < 7; i++) s.days[Core.addDays('2026-10-26', i)] = { allowance: 400 };
  // Two weekly goals, both missed (₹1,000 and ₹1,500 caps)
  s.goalHistory = [{ week: '2026-10-19', type: 'spend_cap', amount: 1000, text: 'Keep spending under ₹1,000' }];
  s.weeklyPlan = { week: '2026-10-26', goal: { week: '2026-10-26', type: 'spend_cap', amount: 1500, text: 'Keep spending under ₹1,500' } };
  return s;
}

test('four weeks, oldest first, with what each spent and how the days went', () => {
  const tw = Core.weekTrend(household(), T, 4);
  assert.deepEqual(tw.weeks.map((w) => [w.from, w.spent, w.quiet]), [
    ['2026-10-05', 50, true], ['2026-10-12', 2800, false], ['2026-10-19', 2600, false], ['2026-10-26', 2400, false]]);
  const last = tw.weeks[3];
  assert.deepEqual([last.won, last.over], [5, 2]);
  assert.deepEqual(last.goal, { text: 'Keep spending under ₹1,500', type: 'spend_cap', amount: 1500, met: false, value: 2400 });
});

test('food up three weeks in a row, groceries down; two goals missed, so this week\'s is easier', () => {
  const tw = Core.weekTrend(household(), T, 4);
  assert.deepEqual(tw.rising, [{ name: 'Food & dining', values: [800, 1100, 1400] }]);
  assert.deepEqual(tw.falling, [{ name: 'Groceries', values: [2000, 1500, 1000] }]);
  assert.deepEqual(tw.streak, { kind: 'missed', count: 2 });
  assert.equal(tw.difficulty, 'easier');
  // Both met: a little harder
  const s = household();
  s.goalHistory[0].amount = 5000; s.weeklyPlan.goal.amount = 5000;
  const met = Core.weekTrend(s, T, 4);
  assert.deepEqual([met.streak.kind, met.streak.count, met.difficulty], ['met', 2, 'harder']);
});

test('a quiet week stops a "three in a row" from being claimed', () => {
  const s = household();
  s.transactions = s.transactions.filter((t) => t.date !== '2026-10-21');
  const tw = Core.weekTrend(s, T, 4);
  assert.equal(tw.weeks[2].quiet, true);
  assert.deepEqual([tw.rising, tw.falling], [[], []]);
});

test('the AI summary gets the four weeks, the trends and the goal difficulty', () => {
  const f = Core.planFacts(household(), T, null);
  assert.match(f, /LAST 4 WEEKS/);
  assert.match(f, /Week of 5 Oct: hardly anything recorded, so not a guide\.\n/);
  assert.match(f, /Week of 12 Oct: spent ₹2,800; daily limit not tracked;/);
  assert.match(f, /Week of 26 Oct: spent ₹2,400; 5 of 7 days within the limit, 2 over;/);
  assert.match(f, /Up three weeks in a row: Food & dining ₹800 → ₹1,100 → ₹1,400\./);
  assert.match(f, /Down three weeks in a row: Groceries ₹2,000 → ₹1,500 → ₹1,000\./);
  assert.match(f, /Weekly goals: missed 2 weeks in a row\./);
  assert.match(f, /This week's goal should be easier/);
  // Nothing recorded at all: no section
  const empty = household(); empty.transactions = [];
  assert.doesNotMatch(Core.planFacts(empty, T, null), /LAST 4 WEEKS/);
});
