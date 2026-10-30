// What matters most: things the person protects are never suggested as cuts or leaks, the
// trade-off is said with its amount, the AI is told, and protected isn't unlimited.
// Made-up household: payday the 1st, four weeks of spending recorded.
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
  // 28 days: chai ₹100, eating out ₹200, groceries ₹300 a day; shopping ₹2,800; a pet shop ₹1,400
  for (let i = 28; i >= 1; i--) {
    const d = Core.addDays(T, -i);
    s.transactions.push({ id: 'c' + i, date: d, amount: 100, category: 'Food & dining', sub: 'Tea & snacks', note: 'Chaiwala' },
      { id: 'e' + i, date: d, amount: 200, category: 'Food & dining', sub: 'Eating out', note: 'Dhaba' },
      { id: 'g' + i, date: d, amount: 300, category: 'Groceries', note: '' });
  }
  s.transactions.push({ id: 'sh', date: '2026-10-01', amount: 2800, category: 'Shopping', note: 'Mall' },
    { id: 'pet', date: '2026-10-05', amount: 1400, category: 'Shopping', note: 'Heads Up For Tails' });
  return s;
}

test('up to five things, from the list or your own; a category belongs to one of them', () => {
  const s = household(30000);
  const fam = Core.addProtect(s, { preset: 'family' });
  assert.deepEqual([fam.name, fam.cats], ['Family', ['Family', 'Gifts']]);
  assert.equal(Core.addProtect(s, { preset: 'family' }), null);
  assert.equal(Core.addProtect(s, { name: '  ' }), null);
  ['pleasures', 'pets', 'health'].forEach((p) => Core.addProtect(s, { preset: p }));
  assert.ok(Core.addProtect(s, { name: 'Sunday lunch with parents' }));
  assert.equal(Core.addProtect(s, { name: 'Gym' }), null);
  assert.equal(s.protect.length, 5);
  // Linking a category to one takes it from another
  const own = s.protect[4];
  Core.linkProtect(s, own.id, { cat: 'Family' }, true);
  assert.deepEqual([s.protect[0].cats, own.cats], [['Gifts'], ['Family']]);
  assert.equal(Core.removeProtect(s, own.id), true);
  // Backup keeps them; broken ones are dropped
  const back = Core.cleanState(JSON.parse(JSON.stringify(Object.assign(s, { protect: s.protect.concat({ id: 'x', name: '' }) }))));
  assert.equal(back.protect.length, 4);
});

test('what a payment is part of: the payment, then its shop, then its subcategory, then its category', () => {
  const s = household(30000);
  const pleasures = Core.addProtect(s, { preset: 'pleasures' }); // Tea & snacks
  const pets = Core.addProtect(s, { preset: 'pets' });
  Core.linkProtect(s, pets.id, { shop: 'Heads Up For Tails' }, true);
  const t = (id) => s.transactions.find((x) => x.id === id);
  assert.equal(Core.protectOf(s, t('c3')), pleasures);
  assert.equal(Core.protectOf(s, t('e3')), null);
  assert.equal(Core.protectOf(s, t('pet')), pets);
  // One payment can be protected on its own
  Core.linkProtect(s, pets.id, { txId: 'sh' }, true);
  assert.equal(Core.protectOf(s, t('sh')), pets);
});

test('where to cut leaves protected spending alone and says what it would have saved', () => {
  const plain = Core.cutOptions(household(30000), T);
  // Without protection: food (₹300 a day) and shopping are offered
  assert.deepEqual(plain.cuts.map((c) => c.category), ['Food & dining', 'Shopping']);
  const s = household(30000);
  Core.addProtect(s, { preset: 'pleasures' });
  const c = Core.cutOptions(s, T);
  // Food & dining is now only eating out (₹200 a day → ₹100, saves ₹1,100 by payday); chai is protected
  assert.deepEqual(c.cuts.map((x) => [x.category, x.daily, x.toPayday]), [['Food & dining', 200, 1100], ['Shopping', 150, 830]]);
  assert.deepEqual(c.protected.map((x) => [x.name, x.daily, x.toPayday, x.perMonth]), [['Small pleasures', 100, 550, 1500]]);
  assert.ok(c.total < plain.total);
});

test('short even after the cuts: the gap left is said, and the AI is told what is protected and why', () => {
  const s = household(2000);
  Core.addProtect(s, { preset: 'pleasures' });
  const c = Core.cutOptions(s, T);
  assert.equal(c.status, 'short');
  assert.equal(c.gapAfterCuts, c.shortBy);
  const f = Core.planFacts(s, T, null);
  assert.match(f, /Not suggested because they protect it: Small pleasures about ₹100 a day \(halving it would save ₹550 by payday\)/);
  assert.match(f, /WHAT MATTERS MOST[^\n]*never suggest cutting/);
  assert.match(f, /Small pleasures: ₹[\d,]+ this round so far/);
});

test('protected is never called a little leak', () => {
  const s = household(30000);
  // Chaiwala looks like a tea-and-snacks leak until tea and snacks are protected
  assert.ok(Core.leakSuggestions(s, T).some((x) => x.payee === 'chaiwala'));
  Core.addProtect(s, { preset: 'pleasures' });
  assert.equal(Core.leakSuggestions(s, T).some((x) => x.payee === 'chaiwala'), false);
  // A shop protected on its own counts too
  const t = household(30000);
  const own = Core.addProtect(t, { name: 'Evening chai' });
  Core.linkProtect(t, own.id, { shop: 'Chaiwala' }, true);
  assert.equal(Core.leakSuggestions(t, T).some((x) => x.payee === 'chaiwala'), false);
});

test('protected isn\'t unlimited: running above usual while money is short is flagged', () => {
  const s = household(2000);
  const p = Core.addProtect(s, { preset: 'pleasures' });
  // This round (from 1 Oct): chai ₹100 a day, plus ₹3,000 of tea and snacks this week
  s.transactions.push({ id: 'big', date: '2026-10-18', amount: 3000, category: 'Food & dining', sub: 'Tea & snacks', note: 'Cafe' });
  const x = Core.protectSummary(s, T).find((y) => y.id === p.id);
  assert.equal(x.round, 100 * 19 + 3000);
  // Usual: ₹100 a day over the 9 days recorded before this round (22 to 30 Sep), as a month
  assert.equal(x.usual, 3000);
  assert.equal(x.high, true);
  // Without the ₹3,000, chai at ₹100 a day is just usual: not flagged
  s.transactions = s.transactions.filter((t) => t.id !== 'big');
  assert.equal(Core.protectSummary(s, T).find((y) => y.id === p.id).high, false);
  s.transactions.push({ id: 'big', date: '2026-10-18', amount: 3000, category: 'Food & dining', sub: 'Tea & snacks', note: 'Cafe' });
  // The money checks still count it: today's limit is the same with or without protection
  const plain = household(2000);
  plain.transactions.push(Object.assign({}, s.transactions[s.transactions.length - 1]));
  assert.equal(Core.projectRunway(s, T).dailyAllowance, Core.projectRunway(plain, T).dailyAllowance);
});

test('an AI step that touches something protected is marked, not hidden', () => {
  const s = household(30000);
  Core.addProtect(s, { preset: 'pleasures' });
  const plan = { sections: [{ kind: 'save', title: 'Save', steps: [
    { action: 'Skip tea & snacks this week', why: 'saves ₹550', amount: 550, basis: 'numbers' },
    { action: 'Eat out twice less', why: 'saves ₹1,100', amount: 1100, basis: 'numbers' }] }],
  diagnosis: { verdict: '', causes: [], actions: [{ action: 'Stop streaming & apps', how_much: 300, by_when: 'now', changes: 'x' }], checks: [] } };
  const out = Core.markProtected(plan, s);
  assert.deepEqual(out.sections[0].steps.map((x) => x.protect || null), ['Small pleasures', null]);
  assert.equal(out.diagnosis.actions[0].protect, 'Small pleasures');
  assert.equal(plan.sections[0].steps[0].protect, undefined);
});
