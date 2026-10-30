// Reports without personal data: a crash report with no money data at all, and a "wrong number"
// report whose names are stand-ins while every number the app works out stays the same.
// Made-up household with made-up names.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const T = '2026-10-20';
function household() {
  const s = {
    settings: { salary: 72000, payday: 1, name: 'Priya Deshmukh', mainLast4: '4417' },
    fixed: [{ id: 'f1abc9', name: 'Rent to Kulkarni kaka', amount: 18000, dueDay: 5 }],
    debts: [{ id: 'd1abc9', name: 'Bajaj bike loan', balance: 60000, rate: 14, minPayment: 3100, dueDay: 10 }],
    bills: [{ id: 'b1abc9', name: 'MSEDCL', estimate: 900, everyMonths: 1, nextDue: '2026-10-25', history: [900] }],
    cards: [{ id: 'c1abc9', name: 'Axis Ace', last4: '8812', limit: 50000, statementDay: 14, dueDay: 3, created: '2026-09-01' }],
    wallets: [{ id: 'w1abc9', name: 'Paytm wallet', kind: 'bank', last4: '3301', created: '2026-09-01', check: { date: '2026-10-18', amount: 900 } }],
    budgets: [{ id: 'g1', name: 'Groceries', amount: 7000 }, { id: 'g2', name: 'Chai tapri', amount: 600 }],
    goals: [{ id: 'gl1abc', name: 'Goa with Rohan', target: 30000, saved: 4000 }], sinking: [],
    savings: { emergencyBalance: 5000, investSaved: 0 },
    iou: [{ id: 'iou1abc', name: 'Sameer Patil', dir: 'lent', amount: 2500, paid: 0, created: '2026-10-12', payments: [] }],
    events: [{ id: 'ev1abc', name: 'Lonavala trip', from: '2026-10-10', to: '2026-10-11', people: ['Sameer Patil', 'Neha'], budget: 0,
      items: [{ id: 'ei1abc', date: '2026-10-10', total: 1500, paidBy: 'Neha', shares: { me: 500, 'Sameer Patil': 500, Neha: 500 }, place: 'Maganlal chikki', category: 'Food & dining', txIds: [] }] }],
    transactions: [
      { id: 't1abc9', date: '2026-10-03', amount: 640, category: 'Groceries', sub: 'Vegetables & fruit', note: 'RAJU SABZIWALA', source: 'sms', smsKey: 's9f8e7d6' },
      { id: 't2abc9', date: '2026-10-05', amount: 18000, category: 'Bills', note: 'kulkarni.r@okhdfcbank', source: 'sms', smsKey: 's1a2b3c4', fixedId: 'f1abc9', forDue: '2026-10-05' },
      { id: 't3abc9', date: '2026-10-08', amount: 2500, category: 'Misc', note: '9876543210@ybl', source: 'sms', smsKey: 's5e6f7a8', iouId: 'iou1abc' },
      { id: 't4abc9', date: '2026-10-09', amount: 1200, category: 'Shopping', note: 'Myntra', paidFrom: 'c1abc9' },
      { id: 't5abc9', date: '2026-10-11', amount: 300, category: 'Chai tapri', note: 'Chai with Neha', wallet: 'w1abc9' },
      { id: 't6abc9', kind: 'in', date: '2026-10-12', amount: 5000, category: 'Side income', note: 'Tuition fees Aarav', source: 'manual', useFor: 'spend' },
    ],
    merchantRules: { 'raju sabziwala': 'Groceries|Vegetables & fruit', myntra: 'Shopping' },
    payeeLinks: { '9876543210': 'sameer patil' },
    smsSkipText: ['BluChips'], smsSkip: ['dream11'], smsSkipNames: { dream11: 'Dream11' }, smsIgnored: ['s0000aaa'],
    adjustment: null, balanceCheck: { date: '2026-10-18', amount: 41000 }, smsReadUntil: Date.UTC(2026, 9, 19, 14, 37),
  };
  return s;
}
// Everything in the household that tells who someone is.
const PRIVATE = ['Priya', 'Deshmukh', '4417', 'Kulkarni', 'Bajaj', 'MSEDCL', 'Axis Ace', '8812', 'Paytm wallet', '3301', 'Chai tapri', 'Rohan',
  'Sameer', 'Patil', 'Neha', 'Lonavala', 'Maganlal', 'RAJU', 'SABZIWALA', 'okhdfcbank', '9876543210', 'Myntra', 'Aarav', 'Tuition', 'BluChips',
  'dream11', 's9f8e7d6', 's1a2b3c4', 's5e6f7a8', 's0000aaa'];
const leaks = (obj) => { const text = JSON.stringify(obj).toLowerCase(); return PRIVATE.filter((w) => text.includes(w.toLowerCase())); };
const numbers = (s) => {
  const c = Core.cleanState(JSON.parse(JSON.stringify(s)));
  const r = Core.projectRunway(c, T);
  const n = Core.netWorth(c, T);
  return { balance: r.balanceToday, limit: Math.round(r.dailyAllowance), spent: r.spentToDate, held: r.held, billsAhead: r.billsAhead, worth: n.value,
    lent: n.lentPeople, owed: n.owedPeople, events: Core.eventView(c, 'ev1abc').balances.map((b) => b.net), where: Core.spendWhere(c, T, 'cycle').total };
};

test('names hidden: nobody can be told from the copy, and the app works it out the same', () => {
  const s = household();
  const out = Core.pseudonymize(s);
  assert.deepEqual(leaks(out), []);
  assert.deepEqual(numbers(out), numbers(s));
  // Amounts, dates, links and built-in categories stay
  const t = out.transactions;
  assert.deepEqual(t.map((x) => [x.id, x.date, x.amount, x.category]).slice(0, 4), s.transactions.map((x) => [x.id, x.date, x.amount, x.category]).slice(0, 4));
  assert.deepEqual([t[0].sub, t[1].fixedId, t[2].iouId, t[3].paidFrom, t[4].wallet], ['Vegetables & fruit', 'f1abc9', 'iou1abc', 'c1abc9', 'w1abc9']);
  // Your own category is a stand-in, the same one on the budget and the payment
  assert.equal(t[4].category, out.budgets[1].name);
  assert.notEqual(t[4].category, 'Chai tapri');
  // One person, one stand-in, wherever the name is written (People, the trip, its shares)
  const sameer = out.iou[0].name;
  assert.ok(out.events[0].people.includes(sameer));
  assert.ok(sameer in out.events[0].items[0].shares && 'me' in out.events[0].items[0].shares);
  assert.equal(out.payeeLinks[Object.keys(out.payeeLinks)[0]], sameer);
  // Card and account digits are other digits; the SMS keys aren't the SMS's
  assert.match(out.cards[0].last4, /^\d{4}$/);
  assert.notEqual(out.cards[0].last4, '8812');
  assert.notEqual(t[0].smsKey, 's9f8e7d6');
  // No time of day
  assert.equal(out.smsReadUntil % 86400000, 0);
});

test('stand-ins are new each time: the same shop isn\'t the same stand-in in two reports', () => {
  const tries = new Set();
  for (let i = 0; i < 8; i++) tries.add(Core.pseudonymize(household()).transactions[3].note);
  assert.ok(tries.size > 1);
});

test('the log in a report: dates without times, what was typed hidden', () => {
  const log = [
    { at: '2026-10-19T14:37:02.120Z', kind: 'tap', tab: 'spend', page: 'sms', action: 'sms-read' },
    { at: '2026-10-19T14:37:05.000Z', kind: 'sms', messages: 3, unread: ['Rs.999 debited to RAJU SABZIWALA 9876543210@ybl'] },
    { at: '2026-10-19T14:38:00.000Z', kind: 'add', category: 'Chai tapri', note: 'Chai with Neha', amount: 300 },
  ];
  const out = Core.pseudonymize(log);
  assert.deepEqual(leaks(out), []);
  assert.deepEqual(out.map((e) => e.at), ['2026-10-19', '2026-10-19', '2026-10-19']);
  assert.deepEqual([out[0].kind, out[0].tab, out[0].page, out[0].action, out[1].messages, out[2].amount], ['tap', 'spend', 'sms', 'sms-read', 3, 300]);
});

test('a crash report: the error and the screens, never an amount, a name or a date of a payment', () => {
  const s = household();
  const r = Core.crashReport({
    state: s, build: '76', day: T, lang: 'mr', screen: '393x851',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-A146B Build/UP1A.231005.007; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
    message: 'Cannot read properties of undefined (reading \'Sameer Patil\') for RAJU SABZIWALA ₹18,000 9876543210@ybl a/c 123456789012 kulkarni',
    where: 'app.js:3145:22',
    stack: 'TypeError: Neha has no Kulkarni\n    at recordSms (https://localhost/app.js:3145:22)\n    at payFixed (https://localhost/core.js:2995:7)',
    log: [{ at: '2026-10-19T14:37:02Z', kind: 'tap', tab: 'spend', page: 'sms', action: 'sms-read', note: 'Chai with Neha', amount: 300 }],
  });
  assert.deepEqual(leaks(r), []);
  assert.equal(JSON.stringify(r).includes('18,000'), false);
  assert.equal(JSON.stringify(r).includes('300'), false);
  assert.match(r.stack, /recordSms \(https:\/\/localhost\/app\.js:3145:22\)\n {4}at payFixed/);
  assert.match(r.message, /reading '…'/);
  assert.deepEqual([r.android, r.model, r.build, r.lang], ['14', 'SM-A146B', '76', 'mr']);
  assert.deepEqual(r.screens, [{ kind: 'tap', tab: 'spend', page: 'sms', action: 'sms-read' }]);
  assert.deepEqual([r.counts.transactions, r.counts.fromSms, r.counts.iou], [6, 3, 1]);
  // Only these fields, nothing else from the data
  assert.deepEqual(Object.keys(r).sort(), ['android', 'build', 'counts', 'day', 'lang', 'message', 'model', 'screen', 'screens', 'stack', 'v', 'where']);
});

test('scrubbing text: UPI ids, e-mails, long numbers and rupee amounts go; code positions stay', () => {
  assert.equal(Core.scrubText('paid ₹1,250 to raju@okaxis, call 98765 43210, a/c 001234567890 at app.js:88:12'), 'paid ₹# to <id>, call #, a/c # at app.js:88:12');
  assert.equal(Core.scrubText('Neha owes Rs. 500', ['Neha']), '… owes ₹#');
});
