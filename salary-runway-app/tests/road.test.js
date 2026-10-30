// The road to payday: the balance day by day, the lowest point, the first payment that falls
// short, and "can I afford it?". Every number worked out by hand.
// Made-up household: payday the 28th, ₹70,000 on 28 Oct, groceries and health budgets only.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-30';
function household(balance) {
  return {
    settings: { salary: 100000, payday: 28 },
    fixed: [{ id: 'rent', name: 'Rent', amount: 22000, dueDay: 28 }, { id: 'maid', name: 'Maid', amount: 1000, dueDay: 1 }],
    debts: [{ id: 'car', name: 'Car loan', balance: 400000, rate: 9, minPayment: 20000, dueDay: 5 }],
    bills: [], sinking: [], goals: [], cards: [], iou: [],
    budgets: [{ id: 'g', name: 'Groceries', amount: 6000 }, { id: 'h', name: 'Health', amount: 3000 }],
    savings: { emergencyBalance: 0, investSaved: 0 },
    transactions: [], merchantRules: {}, adjustment: null,
    balanceCheck: { date: '2026-10-28', amount: balance },
  };
}

test('the road: each payment on its day with the balance after it; spending every day to payday', () => {
  const s = household(70000);
  const road = Core.roadToPayday(s, T, { daily: 300 });
  // Rent (due 28 Oct, not paid) comes out today; maid on 1 Nov; car loan on 5 Nov
  assert.deepEqual(road.moves.map((m) => [m.date, m.name, m.amount, m.after]),
    [['2026-10-30', 'Rent', 22000, 48000], ['2026-11-01', 'Maid', 1000, 46400], ['2026-11-05', 'Car loan', 20000, 25200]]);
  // 30 Oct to 27 Nov is 29 days of ₹300
  assert.deepEqual([road.daysLeft, road.days.length, road.spending, road.payments], [29, 29, 8700, 43000]);
  assert.equal(road.end, 70000 - 43000 - 8700);
  assert.deepEqual(road.lowest, { amount: road.end, date: '2026-11-27' });
  assert.equal(road.short, null);
  assert.equal(road.afterPayday, road.end + 100000);
});

test('not enough: the first payment that can\'t be paid in full, and by how much', () => {
  const s = household(40000);
  const road = Core.roadToPayday(s, T, { daily: 300 });
  // 40,000 − rent 22,000 − 300 = 17,700; − 300 − 1,000 = 16,400 on 1 Nov; then 4 more days: 15,200; − 20,000 = −4,800 on 5 Nov
  assert.deepEqual(road.short, { name: 'Car loan', date: '2026-11-05', amount: 4800 });
  assert.equal(road.lowest.date, '2026-11-27');
});

test('the daily amount: usual, essentials only, today\'s limit, or your own', () => {
  const s = household(70000);
  const ess = Math.round(Core.essentialsDaily(s, T).daily);
  assert.equal(Core.roadToPayday(s, T, { rate: 'essentials' }).daily, ess);
  assert.equal(Core.roadToPayday(s, T, { rate: 'limit' }).daily, Math.round(Core.projectRunway(s, T).dailyAllowance));
  assert.equal(Core.roadToPayday(s, T, { daily: 777 }).rateKind, 'own');
  // Usual: the last 28 days once two weeks are recorded (₹400 a day here, a ₹2,000 emergency left out)
  for (let i = 1; i <= 28; i++) s.transactions.push({ id: 'u' + i, date: Core.addDays(T, -i), amount: 400, category: 'Groceries', note: '' });
  s.transactions.push({ id: 'em', date: Core.addDays(T, -3), amount: 2000, category: 'Emergency', note: '' });
  assert.equal(Core.usualDaily(s, T), 400);
});

test('can I afford it: yes, only on essentials, or no (with the payment it would put short)', () => {
  const s = household(70000);
  // Four weeks of ₹200 groceries and ₹200 shopping a day: usual ₹400 a day, essentials less
  for (let i = 1; i <= 28; i++) {
    s.transactions.push({ id: 'g' + i, date: Core.addDays(T, -i), amount: 200, category: 'Groceries', note: '' },
      { id: 's' + i, date: Core.addDays(T, -i), amount: 200, category: 'Shopping', note: '' });
  }
  const ess = Math.round(Core.essentialsDaily(s, T).daily);
  assert.equal(Core.usualDaily(s, T), 400);
  assert.ok(ess < 400);
  // What's left the day before payday: today's balance (₹70,000 less the ₹800 spent on 28 and 29 Oct) − payments 43,000 − 29 days of spending
  assert.equal(Core.projectRunway(s, T).balanceToday, 69200);
  const room = (rate) => 69200 - 43000 - rate * 29;
  let a = Core.affordCheck(s, T, 1000);
  assert.equal(a.verdict, 'yes');
  assert.equal(a.endAfter, room(400) - 1000);
  assert.equal(a.lowestDrop, 1000);
  // More than fits at ₹400 a day, less than on essentials only
  a = Core.affordCheck(s, T, room(400) + 500);
  assert.equal(a.verdict, 'tight');
  assert.equal(a.endEssentials, room(ess) - room(400) - 500);
  // Doesn't fit at all: the car loan is short
  a = Core.affordCheck(s, T, 30000);
  assert.equal(a.verdict, 'no');
  assert.equal(a.essentials.short.name, 'Car loan');
  // The purchase is on the road as its own movement, today
  assert.ok(a.usual.moves.some((m) => m.kind === 'extra' && m.amount === 30000 && m.date === T));
});

test('the road agrees with the red-zone check: payments short means a payment short on the road', () => {
  const s = household(40000);
  const z = Core.zoneStatus(s, T);
  assert.equal(z.cause, 'bills');
  const road = Core.roadToPayday(s, T, { daily: 0 });
  // With no spending at all, the shortfall on the road is exactly the red zone's payments shortfall
  assert.equal(-road.lowest.amount, z.billsShort);
});
