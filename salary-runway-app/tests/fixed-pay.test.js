// Recording a fixed payment as paid: early, on time, late or a different amount, it counts once.
// Made-up household: payday the 28th, a ₹9,000 class fee due on the 1st.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const base = () => ({
  settings: { salary: 60000, payday: 28 },
  fixed: [{ id: 'cls', name: 'Data science class', amount: 9000, dueDay: 1 }],
  debts: [], bills: [], sinking: [], goals: [], cards: [],
  budgets: [{ id: 'b1', name: 'Misc', amount: 20000 }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  balanceCheck: { date: '2026-10-28', amount: 50000 },
});
const bal = (s, d) => Core.projectRunway(s, d).balanceToday;
const sms = (s, amount, date) => s.transactions.push({ id: 'sms', date: date || '2026-10-28', amount, category: 'Misc', note: 'UPI payment', source: 'sms' });

test('paid early by SMS: counted once, on the day it was paid', () => {
  const plain = base();
  const s = base();
  sms(s, 9000);
  // As ordinary spending it counts twice: now, and again on the 1st
  assert.equal(bal(s, '2026-11-02'), bal(plain, '2026-11-02') - 9000);
  assert.deepEqual(Core.fixedMatches(s, '2026-10-28').map((m) => [m.tx.id, m.fixed.id, m.due]), [['sms', 'cls', '2026-11-01']]);
  const tx = Core.payFixed(s, 'cls', { txId: 'sms' });
  assert.equal(tx.forDue, '2026-11-01');
  const r = Core.projectRunway(s, '2026-10-28');
  assert.equal(r.balanceToday, 50000 - 9000);
  assert.equal(r.spentToDate, 0);
  assert.equal(r.billsAhead, Core.projectRunway(plain, '2026-10-28').billsAhead - 9000);
  // After the 1st, the same as if it had left on the day
  assert.equal(bal(s, '2026-11-02'), bal(plain, '2026-11-02'));
  assert.equal(Core.fixedMatches(s, '2026-10-28').length, 0);
  // Next month's is still expected
  assert.ok(Core.projectRunway(s, '2026-11-28').events.some((e) => e.kind === 'fixed' && e.date === '2026-12-01'));
});

test('a different amount, and a late payment, still count once', () => {
  const plain = base();
  const s = base();
  Core.payFixed(s, 'cls', { amount: 9500, date: '2026-10-28' });
  assert.equal(bal(s, '2026-11-02'), bal(plain, '2026-11-02') - 500);
  // Late: nothing recorded by the 1st, so it's assumed paid; recorded on the 5th, it moves there
  const late = base();
  assert.equal(bal(late, '2026-11-01'), 41000);
  Core.payFixed(late, 'cls', { amount: 9000, date: '2026-11-05' });
  assert.equal(late.transactions[0].forDue, '2026-11-01');
  assert.equal(bal(late, '2026-11-01'), 50000);
  assert.equal(bal(late, '2026-11-05'), bal(plain, '2026-11-05'));
});

test('undo: an added payment goes; an SMS payment becomes spending again; the same SMS never pays twice', () => {
  const s = base();
  const added = Core.payFixed(s, 'cls', { amount: 9000, date: '2026-10-28' });
  Core.unpayFixed(s, added);
  assert.equal(s.transactions.length, 0);
  sms(s, 9000);
  const tx = Core.payFixed(s, 'cls', { txId: 'sms' });
  assert.equal(Core.payFixed(s, 'cls', { txId: 'sms' }), null);
  Core.unpayFixed(s, tx);
  assert.equal(Core.isFlexible(s.transactions[0]), true);
  assert.equal(Core.projectRunway(s, '2026-10-28').spentToDate, 9000);
});

test('what isn\'t offered as a fixed payment: a card payment, another amount, a "no" answer', () => {
  const s = base();
  s.transactions.push({ id: 'card', date: '2026-10-28', amount: 9000, category: 'Misc', note: 'Shop', paidFrom: 'c1' });
  s.transactions.push({ id: 'other', date: '2026-10-28', amount: 7000, category: 'Misc', note: 'Shop' });
  s.transactions.push({ id: 'no', date: '2026-10-28', amount: 9100, category: 'Misc', note: 'Shop', notFixed: true });
  assert.equal(Core.fixedMatches(s, '2026-10-28').length, 0);
  assert.equal(Core.payFixed(s, 'cls', { txId: 'card' }), null);
  // Within 2%: ₹9,150 is offered
  s.transactions.push({ id: 'near', date: '2026-10-28', amount: 9150, category: 'Misc', note: 'Shop' });
  assert.deepEqual(Core.fixedMatches(s, '2026-10-28').map((m) => m.tx.id), ['near']);
});

test('one transfer, two purposes: ₹10,000 split into a ₹9,000 class fee and ₹1,000 daily money', () => {
  const plain = base();
  const s = base();
  // As the app splits it: two payments, linked by splitOf
  s.transactions.push({ id: 'p1', date: '2026-10-28', amount: 9000, category: 'Family', note: 'Wife', source: 'sms', splitOf: 'p1' });
  s.transactions.push({ id: 'p2', date: '2026-10-28', amount: 1000, category: 'Family', note: 'Wife', source: 'sms', splitOf: 'p1' });
  // The ₹9,000 part is asked about, and marked as the class fee
  assert.deepEqual(Core.fixedMatches(s, '2026-10-28').map((m) => m.tx.id), ['p1']);
  Core.payFixed(s, 'cls', { txId: 'p1' });
  const r = Core.projectRunway(s, '2026-10-28');
  // ₹10,000 left the account; ₹1,000 is daily spending; the fee isn't expected again on the 1st
  assert.equal(r.balanceToday, 40000);
  assert.equal(r.spentToDate, 1000);
  assert.equal(Core.projectRunway(s, '2026-11-02').balanceToday, Core.projectRunway(plain, '2026-11-02').balanceToday - 1000);
});
