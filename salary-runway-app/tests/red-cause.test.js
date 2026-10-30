// Why it's red, said plainly: when the payments still due are more than the money, that's the
// cause, not spending. Paying a planned payment (rent) never changes the limit or the zone.
// Made-up household: payday the 28th, salary ₹1,00,000, rent and two loans.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-30';
function household(balance) {
  return {
    settings: { salary: 100000, payday: 28 },
    fixed: [{ id: 'rent', name: 'Rent', amount: 22000, dueDay: 28 }, { id: 'maid', name: 'Maid', amount: 1000, dueDay: 1 }],
    debts: [{ id: 'car', name: 'Car loan', balance: 400000, rate: 9, minPayment: 20000, dueDay: 5 },
      { id: 'pl', name: 'Personal loan', balance: 300000, rate: 14, minPayment: 25000, dueDay: 7 }],
    bills: [], sinking: [], goals: [], cards: [],
    budgets: [{ id: 'g', name: 'Groceries', amount: 6000 }, { id: 'h', name: 'Health', amount: 1000 }],
    savings: { emergencyBalance: 2000, investSaved: 0 },
    iou: [{ id: 'owe1', name: 'Tanvi', dir: 'owe', amount: 5000, paid: 0, promised: '2026-11-02', created: '2026-10-20', payments: [] },
      { id: 'lent1', name: 'Rohit', dir: 'lent', amount: 3000, paid: 0, created: '2026-10-10', payments: [] }],
    transactions: [], merchantRules: {}, adjustment: null,
    // The balance on payday, before rent left
    balanceCheck: { date: '2026-10-28', amount: balance },
  };
}
const look = (s) => {
  const r = Core.projectRunway(s, T);
  const z = Core.zoneStatus(s, T, r);
  return { limit: Math.round(r.dailyAllowance), zone: z.zone, cause: z.cause, billsShort: z.billsShort, shortBy: Math.round(z.shortBy) };
};

test('payments due before payday are more than the money: the cause is the payments, even with no spending', () => {
  // ₹70,000 in the account before rent. Still due: rent 22,000 (today), maid 1,000, Tanvi 5,000, car 20,000, loan 25,000 = ₹73,000
  const s = household(70000);
  const z = Core.zoneStatus(s, T);
  assert.deepEqual([z.zone, z.cause, z.billsShort], ['red', 'bills', 3000]);
  assert.deepEqual(z.ahead.map((e) => [e.name, e.amount]).slice(0, 3), [['Personal loan', 25000], ['Rent', 22000], ['Car loan', 20000]]);
  assert.equal(z.basicsAhead, Math.round(z.essentialPerDay * Core.projectRunway(s, T).remainingDays));
  // What can close it, in order: the fund, money owed to you, money you owe that can wait, the EMI dates, then basics only
  assert.deepEqual(z.options.map((o) => [o.kind, o.name || null, o.amount]), [
    ['fund', null, 2000], ['askback', 'Rohit', 3000], ['wait', 'Tanvi', 5000], ['move', 'Personal loan', 25000], ['move', 'Car loan', 20000], ['basics', null, Math.round(z.essentialPerDay)]]);
});

test('paying rent changes nothing: the money and the payments due both go down by ₹22,000', () => {
  const before = household(70000);
  const after = household(70000);
  after.transactions.push({ id: 'p', date: T, amount: 22000, category: 'Bills', note: 'Landlord', source: 'sms', smsKey: 'k' });
  Core.payFixed(after, 'rent', { txId: 'p' });
  assert.deepEqual(look(after), look(before));
  // Recorded twice (the SMS as spending and Mark paid by hand): that's the bug the twin card repairs
  const twice = household(70000);
  twice.transactions.push({ id: 'p', date: T, amount: 22000, category: 'Bills', sub: 'Rent', note: 'Landlord', source: 'sms', smsKey: 'k' });
  twice.transactions.push({ id: 'h', date: T, amount: 22000, category: 'Bills', note: 'Rent', source: 'manual', fixedNew: true, fixedId: 'rent', forDue: '2026-10-28' });
  const tw = Core.fixedTwins(twice, T);
  assert.equal(tw.length, 1);
  Core.mergeFixedTwin(twice, tw[0].paid.id, tw[0].extra.id);
  assert.deepEqual(look(twice), look(before));
});

test('payments covered, basics not: red for basics; enough for both: not red', () => {
  // ₹75,000: the ₹73,000 of payments are covered, 29 days of basics aren't
  let z = Core.zoneStatus(household(75000), T);
  assert.deepEqual([z.zone, z.cause, z.billsShort], ['red', 'basics', 0]);
  assert.equal(z.options.some((o) => o.kind === 'move'), true);
  z = Core.zoneStatus(household(150000), T);
  assert.notEqual(z.zone, 'red');
  assert.equal(z.cause, null);
});
