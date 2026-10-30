// One payment, counted once: something recorded by hand and its bank SMS, whichever comes first.
// Made-up household: ₹1,00,000 in the account on 18 Oct, payday the 1st.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-20';
const base = () => ({
  settings: { salary: 90000, payday: 1 },
  fixed: [], debts: [], sinking: [], goals: [], iou: [],
  bills: [{ id: 'elec', name: 'Electricity', estimate: 1200, everyMonths: 1, nextDue: '2026-10-25', history: [1200] }],
  cards: [{ id: 'c1', name: 'HDFC card', last4: '6645', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-01' }],
  wallets: [{ id: 'cash', name: 'Cash', kind: 'cash', created: '2026-10-01', check: { date: '2026-10-18', amount: 500 } },
    { id: 'sbi', name: 'SBI', kind: 'bank', last4: '9999', created: '2026-10-01', check: { date: '2026-10-18', amount: 10000 } }],
  budgets: [{ id: 'b1', name: 'Food & dining', amount: 8000 }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  balanceCheck: { date: '2026-10-18', amount: 110500 },
});
const sms = (id, amount, note, more) => Object.assign({ id, date: T, amount, category: 'Misc', note, source: 'sms', smsKey: 'k' + id }, more);
const bal = (s) => Core.projectRunway(s, T).balanceToday;

test('the bank\'s entry for a hand action: same amount, 3 days, same account, nothing tied to it', () => {
  const s = base();
  s.transactions.push(sms('a', 1200, 'MSEDCL'));
  const o = { amount: 1200, date: '2026-10-22', dir: 'out', wallet: 'main', any: true };
  assert.equal(Core.bankTwin(s, o).id, 'a');
  // Four days apart, money in, another account, a card: not it
  assert.equal(Core.bankTwin(s, Object.assign({}, o, { date: '2026-10-24' })), null);
  assert.equal(Core.bankTwin(s, Object.assign({}, o, { dir: 'in' })), null);
  assert.equal(Core.bankTwin(s, Object.assign({}, o, { wallet: 'sbi' })), null);
  assert.equal(Core.bankTwin(s, Object.assign({}, o, { paidFrom: 'c1' })), null);
  // Already tied to something (a person, a trip, a split): not it
  ['iouId', 'eventId', 'lentShare', 'splitOf', 'claimId'].forEach((k) => {
    s.transactions[0][k] = 'x';
    assert.equal(Core.bankTwin(s, o), null, k);
    delete s.transactions[0][k];
  });
  // Typed by hand, it's not the bank's
  s.transactions[0].source = 'manual'; delete s.transactions[0].smsKey;
  assert.equal(Core.bankTwin(s, o), null);
});

test('typed in: the same place, or the only one; two ₹100 teas are two payments', () => {
  const s = base();
  s.transactions.push(sms('a', 100, 'CHAAYOS'), sms('b', 850, 'DMART'), sms('c', 850, 'RELIANCE'));
  const o = (amount, note) => ({ amount, date: T, dir: 'out', wallet: 'main', note });
  assert.equal(Core.bankTwin(s, o(100, 'Tea')), null);
  assert.equal(Core.bankTwin(s, o(100, 'Chaayos')).id, 'a');
  // Two of ₹850 and the name tells: that one; it doesn't: neither
  assert.equal(Core.bankTwin(s, o(850, 'DMart')).id, 'b');
  assert.equal(Core.bankTwin(s, o(850, 'Groceries')), null);
});

test('a bill paid by hand after its SMS: one payment, with what the SMS said kept on it', () => {
  const s = base();
  s.transactions.push(sms('a', 1200, 'MSEDCL'));
  const before = bal(s);
  const paid = Core.payBill(s, 'elec', 1200, 1, T);
  assert.equal(Core.joinBankTwin(s, paid, true).id, 'a');
  assert.deepEqual(s.transactions.map((t) => t.id), [paid.id]);
  assert.deepEqual([paid.smsKey, paid.matched.merchant, paid.matched.type], ['ka', 'MSEDCL', 'debit']);
  assert.equal(bal(s), before);
  assert.equal(Core.projectRunway(s, T).spentToDate, 0);
  // Joined once only
  s.transactions.push(sms('b', 1200, 'MSEDCL'));
  assert.equal(Core.joinBankTwin(s, paid, true), null);
});

test('money moved by hand and the bank SMS: the move, not spending; an ATM SMS already moved to cash is the same move', () => {
  const s = base();
  s.transactions.push(sms('a', 5000, 'SBI a/c XX9999'));
  const before = bal(s) + 5000;
  const mv = { id: 'mv', kind: 'transfer', date: T, amount: 5000, from: 'main', to: 'sbi', note: 'Moved money', source: 'manual' };
  s.transactions.push(mv);
  assert.equal(Core.joinBankTwin(s, mv, true).id, 'a');
  assert.equal(s.transactions.length, 1);
  assert.equal(bal(s), before);
  assert.equal(Core.projectRunway(s, T).spentToDate, 0);
  const t = base();
  t.transactions.push({ id: 'atm', kind: 'transfer', date: T, amount: 2000, from: 'main', to: 'cash', note: 'ATM withdrawal', source: 'sms', smsKey: 'k1' });
  const cash = { id: 'mv', kind: 'transfer', date: T, amount: 2000, from: 'main', to: 'cash', note: 'Moved money', source: 'manual' };
  t.transactions.push(cash);
  Core.joinBankTwin(t, cash, true);
  assert.deepEqual([t.transactions.length, cash.matched.transfer], [1, { from: 'main', to: 'cash' }]);
  // Money in to SBI from the main account, seen on SBI's SMS: the same move
  const u = base();
  u.transactions.push({ id: 'in', kind: 'in', date: T, amount: 3000, category: 'Money received', note: 'SELF', wallet: 'sbi', source: 'sms', smsKey: 'k2', useFor: null });
  const back = { id: 'mv', kind: 'transfer', date: T, amount: 3000, from: 'main', to: 'sbi', note: 'Moved money', source: 'manual' };
  u.transactions.push(back);
  assert.equal(Core.joinBankTwin(u, back, true).id, 'in');
  // Both banks sent an SMS: the debit from the main account and the credit into SBI are one move
  const w = base();
  w.transactions.push(sms('out', 5000, 'SBI a/c XX9999'),
    { id: 'in', kind: 'in', date: T, amount: 5000, category: 'Money received', note: 'SELF', wallet: 'sbi', source: 'sms', smsKey: 'k3', useFor: null });
  const both = { id: 'mv', kind: 'transfer', date: T, amount: 5000, from: 'main', to: 'sbi', note: 'Moved money', source: 'manual' };
  w.transactions.push(both);
  Core.joinBankTwin(w, both, true);
  assert.deepEqual([w.transactions.length, both.smsKey, both.smsKeyIn], [1, 'kout', 'k3']);
  assert.equal(bal(w), bal(base()));
});

test('money in typed by hand after its SMS: counted once; a refund isn\'t income twice', () => {
  const s = base();
  s.transactions.push({ id: 'r', kind: 'in', date: T, amount: 500, category: 'Money received', note: 'AMAZON', source: 'sms', smsKey: 'k1', useFor: null });
  const typed = { id: 't', kind: 'in', date: T, amount: 500, category: 'Refund', note: 'Amazon', source: 'manual', useFor: null };
  s.transactions.push(typed);
  assert.equal(Core.joinBankTwin(s, typed).id, 'r');
  assert.deepEqual(s.transactions.map((t) => [t.id, t.category]), [['t', 'Refund']]);
  // Money from your own savings is never the bank's credit for something else
  const t = base();
  t.transactions.push({ id: 'f', kind: 'in', date: T, amount: 500, category: 'From emergency fund', note: 'Emergency fund', source: 'sms', smsKey: 'k', useFor: 'spend', fromFund: true });
  assert.equal(Core.bankTwin(t, { amount: 500, date: T, dir: 'in', wallet: 'main', any: true }), null);
});

test('lent or borrowed under People, then the SMS: tied to that one, only when it\'s the only one', () => {
  const s = base();
  Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 3000 }, '2026-10-19');
  assert.equal(Core.iouTwin(s, { amount: 3000, date: T, dir: 'out' }).name, 'Amit');
  // Money in isn't lending; 4 days later isn't it; another IOU of the same amount: no guessing
  assert.equal(Core.iouTwin(s, { amount: 3000, date: T, dir: 'in' }), null);
  assert.equal(Core.iouTwin(s, { amount: 3000, date: '2026-10-23', dir: 'out' }), null);
  Core.addIou(s, { name: 'Sneha', dir: 'lent', amount: 3000 }, T);
  assert.equal(Core.iouTwin(s, { amount: 3000, date: T, dir: 'out' }), null);
  // Already tied to a payment: not it
  const t = base();
  const i = Core.addIou(t, { name: 'Rahul', dir: 'owe', amount: 4000 }, T);
  assert.equal(Core.iouTwin(t, { amount: 4000, date: T, dir: 'in' }).id, i.id);
  t.transactions.push({ id: 'x', kind: 'in', date: T, amount: 4000, category: 'Money received', note: 'RAHUL', iouId: i.id, useFor: 'spend' });
  assert.equal(Core.iouTwin(t, { amount: 4000, date: T, dir: 'in' }), null);
});
