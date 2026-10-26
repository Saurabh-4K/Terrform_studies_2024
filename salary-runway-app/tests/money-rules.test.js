// The relationships between every part of the app's money, checked for each kind of entry.
// Each rule is something that must hold whatever else is in the data.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-26';

// A household like the testers': salary on the 28th, rent, loans, a card added with a bill, a goal, a balance check.
function base() {
  return {
    settings: { salary: 98000, payday: 28 },
    fixed: [{ id: 'rent', name: 'Rent', amount: 22000, dueDay: 28 }],
    debts: [
      { id: 'pl', name: 'Personal loan', balance: 500000, rate: 11, minPayment: 15000, dueDay: 7, emiThrough: '2026-10-07' },
      { id: 'cemi', name: 'Card EMI', balance: 24000, rate: 22.44, minPayment: 6010, dueDay: 3, viaCard: 'c1', emisLeft: 4, emiThrough: '2026-10-03' },
    ],
    budgets: ['Groceries', 'Food & dining', 'Travel', 'Shopping', 'Health', 'Misc'].map((name, i) => ({ id: 'b' + i, name, amount: 0, auto: true })),
    bills: [],
    savings: { auto: true, emergencyBalance: 1000, emergencyTargetMonths: 6, investSaved: 0, rollovers: [] },
    sinking: [],
    goals: [{ id: 'g1', name: 'Bike', target: 20000, by: '2027-06-01', saved: 0, created: '2026-10-01' }],
    cards: [{ id: 'c1', name: 'HDFC card', last4: '6645', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-20', setupStatement: 6010, setupDueDate: '2026-11-03' }],
    transactions: [{ id: 'food', date: '2026-10-24', amount: 300, category: 'Food & dining', note: 'Canteen' }],
    merchantRules: {},
    adjustment: null,
    balanceCheck: { date: '2026-10-23', amount: 20000 },
  };
}
const copy = (s) => JSON.parse(JSON.stringify(s));
const worth = (s) => Core.netWorth(s, T).value;
const spentAll = (s) => Core.spendWhere(s, T, 'cycle').categories.reduce((a, c) => a + c.spent, 0);
const limit = (s) => Math.round(Core.projectRunway(s, T).dailyAllowance);
const balance = (s) => Core.projectRunway(s, T).balanceToday;

// Each kind of entry, applied the way the app records it. `net` is what it does to net worth.
const kinds = {
  'spending': { net: -500, apply: (s) => s.transactions.push({ id: 'x', date: T, amount: 500, category: 'Shopping', note: 'Mall' }) },
  'card spending': { net: -500, apply: (s) => s.transactions.push({ id: 'x', date: T, amount: 500, category: 'Shopping', note: 'Mall', paidFrom: 'c1' }) },
  'money received, kept': { net: 2000, apply: (s) => s.transactions.push({ id: 'x', kind: 'in', date: T, amount: 2000, category: 'Side income', note: 'Commission', useFor: 'spend' }) },
  'money received, to emergency fund': { net: 2000, apply: (s) => { s.transactions.push({ id: 'x', kind: 'in', date: T, amount: 2000, category: 'Gift', note: 'Dad', useFor: 'emergency' }); s.savings.emergencyBalance += 2000; } },
  'money received, kept for a purchase': { net: 5000, apply: (s) => s.transactions.push({ id: 'x', kind: 'in', date: T, amount: 5000, category: 'From family', note: 'Father', useFor: 'keep', keepFor: 'Diwali', keepUsed: 0 }) },
  'saving to the emergency fund': { net: 0, apply: (s) => { s.transactions.push({ id: 'x', kind: 'move', date: T, amount: 100, category: 'Savings', note: 'Jar', useFor: 'emergency' }); s.savings.emergencyBalance += 100; } },
  'saving to Grow': { net: 0, apply: (s) => { s.transactions.push({ id: 'x', kind: 'move', date: T, amount: 100, category: 'Savings', note: 'Jar', useFor: 'grow' }); s.savings.investSaved += 100; } },
  'saving to a goal': { net: 0, apply: (s) => { s.transactions.push({ id: 'x', kind: 'move', date: T, amount: 100, category: 'Savings', note: 'Jar', useFor: 'goal', goalId: 'g1' }); s.goals[0].saved += 100; s.goals[0].savedOutside = (s.goals[0].savedOutside || 0) + 100; } },
  'borrowed from a friend': { net: 0, apply: (s) => { s.transactions.push({ id: 'x', kind: 'in', date: T, amount: 3000, category: 'Money received', note: 'Rahul', useFor: 'spend' }); Core.addIou(s, { name: 'Rahul', dir: 'owe', amount: 3000, txId: 'x' }, T); } },
  'lent to a friend': { net: 0, apply: (s) => { s.transactions.push({ id: 'x', date: T, amount: 3000, category: 'Misc', note: 'Amit' }); Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 3000, txId: 'x' }, T); } },
  'money passed on': { net: 0, apply: (s) => { s.transactions.push({ id: 'x', kind: 'in', date: T, amount: 26000, category: 'Money received', note: 'Rahul', useFor: null }, { id: 'y', date: T, amount: 26000, category: 'Misc', note: 'Amit' }); Core.passOn(s, 'x', 'y'); } },
  'card bill paid': { net: 0, apply: (s) => Core.recordCardPayment(s, 'c1', 6010, T, 'account') },
};

for (const [name, k] of Object.entries(kinds)) {
  test('money rules: ' + name, () => {
    const before = base();
    const after = copy(before);
    k.apply(after);
    // Net worth changes by exactly what was earned or spent; moving your own money changes nothing.
    assert.equal(worth(after) - worth(before), k.net, 'net worth');
    // Only spending shows as spending.
    const spends = /spending/.test(name) ? 500 : 0;
    assert.equal(spentAll(after) - spentAll(before), spends, 'spending reports');
    // The numbers stay numbers.
    const r = Core.projectRunway(after, T);
    ['dailyAllowance', 'balanceToday', 'endPace'].forEach((f) => assert.ok(Number.isFinite(r[f]), f + ' is ' + r[f]));
  });
}

test('money rules: what isn\'t income or spending doesn\'t move today\'s limit', () => {
  const plain = limit(base());
  for (const name of ['money passed on', 'borrowed from a friend', 'lent to a friend', 'money received, kept for a purchase', 'card bill paid']) {
    const s = base();
    kinds[name].apply(s);
    if (name === 'borrowed from a friend' || name === 'lent to a friend') continue;
    assert.equal(limit(s), plain, name);
  }
  // Borrowed and lent together (passed through as loans): as if nothing happened
  const s = base();
  s.transactions.push({ id: 'in', kind: 'in', date: T, amount: 26000, category: 'Money received', note: 'Rahul', useFor: null }, { id: 'out', date: T, amount: 26000, category: 'Misc', note: 'Amit' });
  Core.addIou(s, { name: 'Rahul', dir: 'owe', amount: 26000, txId: 'in' }, T);
  Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 26000, txId: 'out' }, T);
  assert.equal(limit(s), plain, 'borrowed and lent');
  assert.equal(balance(s), balance(base()), 'balance');
});

test('money rules: a covered purchase uses the kept money, not the budgets', () => {
  const s = base();
  kinds['money received, kept for a purchase'].apply(s);
  const kept = limit(s);
  s.transactions.push({ id: 'buy', date: T, amount: 4700, category: 'Shopping', note: 'Croma' });
  Core.coverPurchase(s, 'x', 'buy');
  assert.equal(limit(s), kept);
  assert.equal(Core.projectRunway(s, T).spentToday, 0);
  // Net worth: ₹5,000 in, ₹4,700 spent
  assert.equal(worth(s) - worth(base()), 300);
});
