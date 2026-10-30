// Subcategories: a second level under a category, for detail. Budgets stay on the category.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-20';
const base = () => ({
  settings: { salary: 50000, payday: 1 },
  fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [],
  budgets: [{ id: 'b1', name: 'Food & dining', amount: 6000 }, { id: 'b2', name: 'Bills', amount: 4000 }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
});

test('the list: defaults, your own added, hidden ones gone', () => {
  const s = base();
  assert.deepEqual(Core.subcategories(s, 'Food & dining'), ['Eating out', 'Food delivery', 'Tea & snacks']);
  s.subcats = { add: { Bills: ['Maid'] }, hide: { Bills: ['Bank charges', 'Rent'] } };
  assert.deepEqual(Core.subcategories(s, 'Bills'), ['Electricity', 'Water', 'Gas', 'Mobile recharge', 'Internet & DTH', 'Society maintenance', 'Maid']);
  assert.deepEqual(Core.subcategories(s, 'Misc'), []);
  assert.deepEqual(Core.splitCat('Bills|Electricity'), { category: 'Bills', sub: 'Electricity' });
  assert.deepEqual(Core.splitCat('Bills'), { category: 'Bills', sub: null });
});

test('a bank SMS gets the subcategory from the shop, or from what you chose before', () => {
  const p = Core.parseSms('Rs.350.00 debited from a/c **1234 on 18-10-26 to VPA swiggy@icici. Ref 123', {}, T);
  assert.deepEqual([p.category, p.sub], ['Food & dining', 'Food delivery']);
  const e = Core.parseSms('Rs.1,240 debited from a/c **1234 on 18-10-26 to MSEDCL bill. Ref 9', {}, T);
  assert.deepEqual([e.category, e.sub], ['Bills', 'Electricity']);
  // A shop name that doesn't tell: no subcategory
  assert.equal(Core.parseSms('Rs.320 debited from a/c **1234 to VPA rajaranisweets@ybl on 18-10-26', {}, T).sub, null);
  // Learned: the rule carries the subcategory; the category stays a plain category
  const rules = { [Core.normalizeMerchant('Sharma Uncle')]: 'Bills|Society maintenance' };
  const r = Core.parseSms('Rs.2,000 debited from a/c **1234 on 18-10-26 to Sharma Uncle. Ref 7', rules, T);
  assert.deepEqual([r.category, r.sub], ['Bills', 'Society maintenance']);
  assert.equal(Core.categorize('Sharma Uncle', rules), 'Bills');
});

test('old payments: suggested from the shop, never changed by themselves; a no is remembered', () => {
  const s = base();
  s.transactions.push(
    { id: 'a', date: '2026-10-05', amount: 350, category: 'Food & dining', note: 'Swiggy' },
    { id: 'b', date: '2026-10-06', amount: 120, category: 'Food & dining', note: 'Chaayos' },
    { id: 'c', date: '2026-10-07', amount: 500, category: 'Shopping', note: 'Swiggy' }, // wrong category for a food word: not offered
    { id: 'd', date: '2026-10-08', amount: 900, category: 'Food & dining', note: 'Dosa Corner', sub: 'Eating out' },
  );
  assert.deepEqual(Core.subSuggestions(s).map((x) => [x.tx.id, x.sub]), [['b', 'Tea & snacks'], ['a', 'Food delivery']]);
  assert.equal(s.transactions[0].sub, undefined);
  s.transactions[1].subNo = true;
  assert.deepEqual(Core.subSuggestions(s).map((x) => x.tx.id), ['a']);
  // A hidden subcategory isn't offered
  s.subcats = { hide: { 'Food & dining': ['Food delivery'] } };
  assert.equal(Core.subSuggestions(s).length, 0);
});

test('reports split a category by subcategory; budgets and spending don\'t change', () => {
  const s = base();
  s.transactions.push(
    { id: 'a', date: '2026-10-05', amount: 350, category: 'Food & dining', note: 'Swiggy', sub: 'Food delivery' },
    { id: 'b', date: '2026-10-06', amount: 650, category: 'Food & dining', note: 'Swiggy', sub: 'Food delivery' },
    { id: 'c', date: '2026-10-07', amount: 400, category: 'Food & dining', note: 'Dhaba', sub: 'Eating out' },
    { id: 'd', date: '2026-10-08', amount: 100, category: 'Food & dining', note: 'Snacks' },
  );
  assert.deepEqual(Core.subBreakdown(s, T, 'Food & dining'), [{ sub: 'Food delivery', spent: 1000 }, { sub: 'Eating out', spent: 400 }, { sub: null, spent: 100 }]);
  const plain = JSON.parse(JSON.stringify(s));
  plain.transactions.forEach((t) => { delete t.sub; });
  assert.deepEqual(Core.budgetEnvelopes(s, T), Core.budgetEnvelopes(plain, T));
  assert.equal(Core.projectRunway(s, T).spentToDate, Core.projectRunway(plain, T).spentToDate);
  // Backup keeps your own subcategories; a broken value is dropped
  s.subcats = { add: { Bills: ['Maid'] } };
  assert.deepEqual(Core.cleanState(JSON.parse(JSON.stringify(s))).subcats, { add: { Bills: ['Maid'] } });
  assert.equal(Core.cleanState(Object.assign(base(), { subcats: 'x' })).subcats, undefined);
});
