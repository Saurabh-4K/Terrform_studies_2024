// Trips and events: shared payments with friends. Every number worked out by hand.
// Made-up trip: Goa, 5 to 8 Nov, with Amit, Rahul and Sneha. ₹50,000 in the account on 2 Nov, payday the 1st.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-11-08';
const base = () => ({
  settings: { salary: 60000, payday: 1 },
  fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [],
  budgets: [{ id: 'b1', name: 'Travel', amount: 10000 }, { id: 'b2', name: 'Food & dining', amount: 10000 }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  balanceCheck: { date: '2026-11-02', amount: 50000 },
});
const eq = (s, ev, total, names, payer) => Core.splitShares(total, names, 'equal', {}, payer);

// The trip: dinner ₹2,000 I paid (4 ways), hotel ₹12,000 Amit paid (4 ways),
// cab ₹1,000 I paid (me, Amit, Rahul), drinks ₹1,500 Rahul paid (not me).
function trip(budget) {
  const s = base();
  s.transactions.push({ id: 'sms1', date: '2026-11-05', amount: 2000, category: 'Misc', note: 'Fishermans Wharf', source: 'sms', smsKey: 'k1' });
  const ev = Core.addEvent(s, { name: 'Goa trip', from: '2026-11-05', to: '2026-11-08', people: ['Amit', 'Rahul', 'Sneha', 'amit', ''], budget }, '2026-11-04');
  const all = ['me', 'Amit', 'Rahul', 'Sneha'];
  const dinner = Core.addEventExpense(s, ev.id, { date: '2026-11-05', total: 2000, paidBy: 'me', shares: eq(s, ev, 2000, all, 'me'), place: 'Fishermans Wharf, Baga', category: 'Food & dining', txId: 'sms1' });
  const hotel = Core.addEventExpense(s, ev.id, { date: '2026-11-06', total: 12000, paidBy: 'Amit', shares: eq(s, ev, 12000, all, 'Amit'), place: 'Hotel, Calangute', category: 'Travel' });
  const cab = Core.addEventExpense(s, ev.id, { date: '2026-11-07', total: 1000, paidBy: 'me', shares: eq(s, ev, 1000, ['me', 'Amit', 'Rahul'], 'me'), place: 'Airport cab', category: 'Travel' });
  const drinks = Core.addEventExpense(s, ev.id, { date: '2026-11-07', total: 1500, paidBy: 'Rahul', shares: { Amit: 500, Rahul: 500, Sneha: 500 }, place: 'Tito’s' });
  return { s, ev, dinner, hotel, cab, drinks };
}

test('splitting adds up to the rupee: the payer takes the extra rupee; shares and amounts', () => {
  assert.deepEqual(Core.splitShares(1000, ['me', 'Amit', 'Rahul'], 'equal', {}, 'me'), { me: 334, Amit: 333, Rahul: 333 });
  assert.deepEqual(Core.splitShares(1000, ['me', 'Amit', 'Rahul'], 'equal', {}, 'Rahul'), { me: 333, Amit: 333, Rahul: 334 });
  assert.deepEqual(Core.splitShares(1001, ['me', 'Amit', 'Rahul'], 'shares', { me: 2, Amit: 1, Rahul: 1 }, 'Amit'), { me: 501, Amit: 250, Rahul: 250 });
  assert.deepEqual(Core.splitShares(1000, ['me', 'Amit'], 'amounts', { me: 700, Amit: 300 }), { me: 700, Amit: 300 });
  // Amounts that don't add up are refused
  assert.equal(Core.splitShares(1000, ['me', 'Amit'], 'amounts', { me: 700, Amit: 200 }), null);
});

test('the trip: who owes whom, what I spent, and the account', () => {
  const { s, ev } = trip(0);
  // People kept once, without repeats
  assert.deepEqual(ev.people, ['Amit', 'Rahul', 'Sneha']);
  const v = Core.eventView(s, ev.id);
  assert.deepEqual([v.total, v.iPaid, v.myShare], [16500, 3000, 3834]);
  // Amit: owes me 500 + 333, I owe him 3,000 → I owe him 2,167. Rahul 500 + 333. Sneha 500. Drinks: not my business.
  assert.deepEqual(v.balances.map((b) => [b.name, b.theyOwe, b.youOwe, b.net]), [['Amit', 833, 3000, -2167], ['Rahul', 833, 0, 833], ['Sneha', 500, 0, 500]]);
  assert.deepEqual([v.owedToYou, v.youOwe], [1333, 2167]);
  const r = Core.projectRunway(s, T);
  // The bank paid ₹2,000 + ₹1,000; the hotel share moved nothing yet
  assert.equal(r.balanceToday, 47000);
  // My spending is my shares only: 500 dinner + 3,000 hotel + 334 cab
  assert.equal(r.spentToDate, 3834);
  const cats = Core.spendWhere(s, T, 'cycle').categories;
  assert.deepEqual(cats.map((c) => [c.name, c.spent]).sort(), [['Food & dining', 500], ['Travel', 3334]]);
  // The SMS payment stays whole (its SMS is still known), only its others' part isn't mine
  const dinnerTx = s.transactions.find((t) => t.id === 'sms1');
  assert.deepEqual([dinnerTx.amount, dinnerTx.lentShare, dinnerTx.smsKey], [2000, 1500, 'k1']);
  // Net worth: 47,000 + 2,166 owed to me − 3,000 I owe = 50,000 − my 3,834
  const n = Core.netWorth(s, T);
  assert.deepEqual([n.money, n.lentPeople, n.owedPeople, n.value], [47000, 2166, 3000, 46166]);
});

test('settling: what each owes the other cancels first; paying back is never income or spending', () => {
  const { s, ev } = trip(0);
  const before = Core.projectRunway(s, T);
  // I pay Amit the ₹2,167 by UPI: ₹833 cancels, the rest is money
  assert.deepEqual(Core.settleEvent(s, ev.id, 'amit', { amount: 2167, date: T }), { netted: 833, paid: 2167 });
  // Rahul's ₹833 came by UPI: offered, then used
  s.transactions.push({ id: 'in1', kind: 'in', date: T, amount: 833, category: 'Money received', note: 'RAHUL', source: 'sms' });
  assert.deepEqual(Core.settleCandidates(s, ev.id, 'Rahul').map((t) => t.id), ['in1']);
  assert.deepEqual(Core.settleEvent(s, ev.id, 'Rahul', { amount: 833, txId: 'in1' }), { netted: 0, paid: 833 });
  const r = Core.projectRunway(s, T);
  assert.equal(r.balanceToday, 47000 - 2167 + 833);
  assert.equal(r.spentToDate, before.spentToDate);
  assert.equal(Core.incomeInRange(s.transactions, r.cycle).length, 0);
  const v = Core.eventView(s, ev.id);
  assert.deepEqual(v.balances.map((b) => [b.name, b.net, b.settled]), [['Amit', 0, true], ['Rahul', 0, true], ['Sneha', 500, false]]);
  // Net worth is the same before and after: money moved, nothing was earned or spent
  assert.equal(Core.netWorth(s, T).value, 46166);
});

test('the trip budget: my shares come from it, not today\'s limit; what\'s left goes back after the trip', () => {
  const plain = trip(0);
  const { s, ev } = trip(5000);
  const r = Core.projectRunway(s, T);
  // ₹3,834 of shares paid from the ₹5,000 budget: not daily spending; ₹1,166 still held today
  assert.equal(r.spentToDate, 0);
  assert.equal(Core.tripHeld(s, T), 1166);
  assert.equal(r.held, 1166);
  assert.equal(Core.eventView(s, ev.id).fromBudget, 3834);
  // Reports still show where the money went
  assert.equal(Core.spendWhere(s, T, 'cycle').total, Core.spendWhere(plain.s, T, 'cycle').total);
  // After the trip, nothing is held
  assert.equal(Core.tripHeld(s, '2026-11-09'), 0);
  // Over budget: the rest counts as usual
  Core.editEvent(s, ev.id, { budget: 3000 });
  assert.equal(Core.projectRunway(s, T).spentToDate, 834);
});

test('taking a payment out, and deleting the event: nothing owed is lost', () => {
  const { s, ev, hotel, dinner } = trip(0);
  // The hotel out: I no longer owe Amit for it, and its entries go
  assert.equal(Core.removeEventExpense(s, ev.id, hotel.id).ok, true);
  assert.deepEqual(Core.eventView(s, ev.id).balances.map((b) => b.net), [833, 833, 500]);
  assert.equal(s.transactions.filter((t) => t.source === 'event').length, 0);
  // Sneha paid me back; the dinner can't come out any more without undoing that
  Core.settleEvent(s, ev.id, 'Sneha', { amount: 500, date: T });
  assert.deepEqual(Core.removeEventExpense(s, ev.id, dinner.id), { ok: false, name: 'Sneha' });
  // Deleting the event: payments stay as they are, what's still owed stays under People
  const balance = Core.projectRunway(s, T).balanceToday;
  assert.equal(Core.deleteEvent(s, ev.id), true);
  assert.equal((s.events || []).length, 0);
  assert.equal(Core.projectRunway(s, T).balanceToday, balance);
  const people = Core.iouSummary(s, T);
  assert.deepEqual(people.lent.map((i) => [i.name, Core.iouLeft(i), i.note]), [['Amit', 833, 'Goa trip'], ['Rahul', 833, 'Goa trip']]);
});

test('a payment deleted from the list takes its event share with it; bad input is refused; backup keeps it all', () => {
  const { s, ev, cab } = trip(0);
  const tx = s.transactions.find((t) => t.eventItem === cab.id);
  assert.equal(Core.eventForgetTx(s, tx).ok, true);
  assert.equal(s.transactions.some((t) => t.id === tx.id), false);
  assert.deepEqual(Core.eventView(s, ev.id).balances.map((b) => b.net), [-2500, 500, 500]);
  // Shares that don't add up, a stranger, a negative share: refused
  assert.equal(Core.addEventExpense(s, ev.id, { date: T, total: 1000, paidBy: 'me', shares: { me: 500, Amit: 400 } }), null);
  assert.equal(Core.addEventExpense(s, ev.id, { date: T, total: 1000, paidBy: 'me', shares: { me: 500, Zoya: 500 } }), null);
  assert.equal(Core.addEventExpense(s, ev.id, { date: T, total: 1000, paidBy: 'me', shares: { me: 1500, Amit: -500 } }), null);
  // Someone with a share can't be taken out of the people
  assert.equal(Core.editEvent(s, ev.id, { people: ['Rahul', 'Sneha'] }), false);
  assert.equal(Core.editEvent(s, ev.id, { people: ['Amit', 'Rahul', 'Sneha', 'Priya'] }), true);
  const back = Core.cleanState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(Core.eventView(back, ev.id).balances, Core.eventView(s, ev.id).balances);
  assert.equal(Core.projectRunway(back, T).balanceToday, Core.projectRunway(s, T).balanceToday);
});
