// Bank and accounting rules, one case per distinct treatment. Each case checks every
// number on its own: cash, spending, reports, money in, earned income, net worth, funds,
// loans, money with friends, what the card is owed, and cash in hand.
// Treatments covered elsewhere: friends and family (money-map), work claims
// (reimbursement), fixed payments (fixed-pay), card bills and EMIs (money-map, core).
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const { base, measure, T } = require('./money-map.js');

const KEYS = ['bank', 'spentCycle', 'reports', 'income', 'earned', 'worth', 'fund', 'grow', 'loans', 'people', 'cardOwed', 'cash'];
const X = (s, t) => { s.transactions.push(Object.assign({ id: 'x' + s.transactions.length, date: T, source: 'sms' }, t)); return s.transactions[s.transactions.length - 1]; };
function effect(pre, apply) {
  const s = base();
  if (pre) pre(s);
  const m = (st) => Object.assign(measure(st), { earned: Core.earnedIn(st, Core.cycleFor(T, 28).start, T) });
  const a = m(s);
  apply(s);
  const b = m(s);
  const out = {};
  KEYS.forEach((k) => { if (b[k] !== a[k]) out[k] = b[k] - a[k]; });
  return out;
}

test('earned income: cash, income, earned and net worth all go up', () => {
  assert.deepEqual(effect(null, (s) => X(s, { kind: 'in', amount: 2000, category: 'Side income', note: 'Client', useFor: 'spend' })),
    { bank: 2000, income: 2000, earned: 2000, worth: 2000 });
  assert.deepEqual(effect(null, (s) => X(s, { kind: 'in', amount: 300, category: 'Interest', note: 'Savings interest', useFor: 'spend' })),
    { bank: 300, income: 300, earned: 300, worth: 300 });
});

test('a gift or money of unknown kind: money in and net worth, never earned', () => {
  assert.deepEqual(effect(null, (s) => X(s, { kind: 'in', amount: 2000, category: 'Gift', note: 'Dad', useFor: 'spend' })),
    { bank: 2000, income: 2000, worth: 2000 });
  assert.deepEqual(effect(null, (s) => X(s, { kind: 'in', amount: 2000, category: 'Money received', note: 'NEFT', useFor: null })),
    { bank: 2000, income: 2000, worth: 2000 });
});

test('a bank loan credited: cash up, owed up, net worth and earned income unchanged', () => {
  assert.deepEqual(effect(null, (s) => X(s, { kind: 'in', amount: 10000, category: 'Loan or Pay Later', note: 'Bank', useFor: 'spend', borrowed: true })),
    { bank: 10000, income: 10000 });
});

test('cash from an ATM on a credit card: borrowed, in hand, not spending', () => {
  assert.deepEqual(effect(null, (s) => X(s, { amount: 5000, category: 'Cash', note: 'ATM', paidFrom: 'c1', cashAdvance: true, wallet: 'cash' })),
    { cardOwed: 5000, cash: 5000 });
  // Then spent in cash: that is the spending
  assert.deepEqual(effect((s) => X(s, { amount: 5000, category: 'Cash', note: 'ATM', paidFrom: 'c1', cashAdvance: true, wallet: 'cash' }),
    (s) => X(s, { amount: 1200, category: 'Groceries', note: 'Market', wallet: 'cash' })),
    { bank: -1200, spentCycle: 1200, reports: 1200, worth: -1200, cash: -1200 });
  const p = Core.parseSms('Rs 5000 withdrawn at ATM using your HDFC Credit Card XX6645', {}, T);
  assert.deepEqual([p.cashAdvance, p.paidFrom, p.category], [true, 'card', 'Cash']);
  assert.equal(Core.parseSms('Rs 5000 withdrawn at ATM from A/c XX1234', {}, T).cashAdvance, false);
});

test('a refund to the account for this round\'s purchase offsets it: not income', () => {
  const buy = (s) => X(s, { id: 'buy', date: '2026-10-21', amount: 1500, category: 'Shopping', note: 'Amazon' });
  assert.deepEqual(effect(buy, (s) => {
    const r = X(s, { kind: 'in', amount: 500, category: 'Refund', note: 'Amazon', useFor: null });
    assert.deepEqual(Core.refundMatches(s, T).map((m) => [m.refund.id, m.buy.id]), [[r.id, 'buy']]);
    assert.equal(Core.linkRefund(s, r.id, 'buy'), true);
  }), { bank: 500, spentCycle: -500, reports: -500, worth: 500 });
  // More than is left of the purchase, or a card purchase: not linked
  const s = base(); buy(s);
  const big = X(s, { kind: 'in', amount: 2000, category: 'Refund', note: 'Amazon' });
  assert.equal(Core.linkRefund(s, big.id, 'buy'), false);
  const card = X(s, { id: 'cb', date: '2026-10-21', amount: 900, category: 'Shopping', note: 'Myntra', paidFrom: 'c1' });
  const r2 = X(s, { kind: 'in', amount: 900, category: 'Refund', note: 'Myntra' });
  assert.equal(Core.linkRefund(s, r2.id, card.id), false);
});

test('a failed payment reversed: in and out cancel; nothing spent, nothing earned', () => {
  assert.deepEqual(effect(null, (s) => {
    const out = X(s, { amount: 500, category: 'Shopping', note: 'Flipkart' });
    const back = X(s, { kind: 'in', amount: 500, category: 'Refund', note: 'Flipkart', useFor: null });
    Core.linkRefund(s, back.id, out.id);
  }), {});
});

test('undo: unlinking or deleting brings the numbers back', () => {
  const s = base();
  const before = measure(s);
  const out = X(s, { amount: 500, category: 'Shopping', note: 'Flipkart' });
  const back = X(s, { kind: 'in', amount: 500, category: 'Refund', note: 'Flipkart', useFor: 'spend' });
  const plain = measure(s);
  Core.linkRefund(s, back.id, out.id);
  Core.unlinkRefund(s, back);
  assert.deepEqual(measure(s), plain);
  Core.linkRefund(s, back.id, out.id);
  // The purchase deleted: the refund is ordinary money in again, and both gone: as before
  Core.forgetRefunds(s, out);
  s.transactions = s.transactions.filter((t) => t !== out && t !== back);
  assert.deepEqual(measure(s), before);
});

test('money from your own savings: cash up, fund down, net worth unchanged, not earned', () => {
  assert.deepEqual(effect(null, (s) => { X(s, { kind: 'in', amount: 1000, category: 'Money received', note: 'Own account', useFor: 'fromfund' }); s.savings.emergencyBalance -= 1000; }),
    { bank: 1000, income: 1000, fund: -1000 });
});

test('a loan EMI paid by SMS: counted once; interest and principal by the bank\'s rule', () => {
  const s = base();
  const plain = base();
  // Personal loan: ₹5,00,000 at 11%, EMI ₹15,000 due on the 7th
  X(s, { id: 'emi', date: '2026-11-06', amount: 15000, category: 'Misc', note: 'Loan Emi' });
  const bal = (st) => Core.projectRunway(st, '2026-11-08').balanceToday;
  assert.equal(bal(s), bal(plain) - 15000);
  const m = Core.fixedMatches(s, '2026-11-08').find((x) => x.tx.id === 'emi');
  assert.deepEqual([m.fixed.id, m.due, m.loan], ['pl', '2026-11-07', true]);
  const tx = Core.payFixed(s, 'pl', { txId: 'emi' });
  // 5,00,000 × 11% ÷ 12 = ₹4,583 interest; ₹10,417 pays the loan down
  assert.deepEqual([tx.emiInterest, tx.emiPrincipal, tx.forDue], [4583, 10417, '2026-11-07']);
  assert.equal(bal(s), bal(plain));
  assert.equal(Core.projectRunway(s, '2026-11-08').spentToDate, Core.projectRunway(plain, '2026-11-08').spentToDate);
  // A card EMI is paid through the card bill, never offered here
  assert.equal(Core.payFixed(s, 'cemi', { amount: 6010, date: T }), null);
  Core.unpayFixed(s, tx);
  assert.equal(bal(s), bal(plain) - 15000);
});

test('money passed on in parts: ₹5,000 received, ₹3,325 + ₹1,674 paid on; neither income nor spending', () => {
  const s = base();
  const before = measure(s);
  X(s, { id: 't1', amount: 3325, category: 'Family', note: 'Irctc Ticketing' });
  X(s, { id: 't2', amount: 1674, category: 'Family', note: 'Irctc Ticketing' });
  X(s, { id: 'f', kind: 'in', amount: 5000, category: 'Money received', note: 'UPI *Anav', useFor: 'spend' });
  const p = Core.passThroughPair(s, T);
  assert.deepEqual([p.in.id, p.outs.map((o) => o.id)], ['f', ['t1', 't2']]);
  assert.equal(Core.passOn(s, 'f', 't1,t2'), true);
  const after = measure(s);
  // ₹1 more in the bank (₹5,000 in, ₹4,999 out), nothing else
  const diff = {};
  ['bank', 'spentCycle', 'reports', 'income', 'worth'].forEach((k) => { if (after[k] !== before[k]) diff[k] = after[k] - before[k]; });
  assert.deepEqual(diff, { bank: 1, worth: 1 });
  // Undo from any part frees all three; deleting one part frees the rest
  assert.equal(Core.unpassOn(s, s.transactions.find((t) => t.id === 't2')).length, 3);
  assert.ok(s.transactions.every((t) => !t.passedOn));
  Core.passOn(s, 'f', 't1,t2');
  const t1 = s.transactions.find((t) => t.id === 't1');
  Core.unpassOn(s, t1);
  s.transactions = s.transactions.filter((t) => t !== t1);
  assert.ok(s.transactions.every((t) => !t.passedOn));
  // Parts that don't add up aren't offered
  const s2 = base();
  X(s2, { amount: 3000, category: 'Family', note: 'A' }); X(s2, { amount: 1000, category: 'Family', note: 'B' });
  X(s2, { kind: 'in', amount: 5000, category: 'Money received', note: 'C', useFor: 'spend' });
  assert.equal(Core.passThroughPair(s2, T), null);
});
