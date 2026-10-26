// The money map, as a test: what each kind of entry does to every number the app shows.
// A change anywhere in the app that moves one of these is either a fix (update the row, say why) or a bug.
const test = require('node:test');
const assert = require('node:assert/strict');
const { base, kinds, measure } = require('./money-map.js');

const KEYS = ['bank', 'spentCycle', 'reports', 'income', 'worth', 'fund', 'grow', 'goal', 'loans', 'people', 'cardOwed', 'kept', 'cash'];

// What changes (anything not listed stays the same). bank: the money shown today (card spending is kept aside at once);
// worth: net worth; people: what friends owe you less what you owe them; cardOwed: what the card is owed in all.
const MAP = {
  'spend (account)': { bank: -500, spentCycle: 500, reports: 500, worth: -500 },
  'spend Family': { bank: -500, spentCycle: 500, reports: 500, worth: -500 },
  'spend on card': { bank: -500, spentCycle: 500, reports: 500, worth: -500, cardOwed: 500 },
  'spend from cash wallet': { bank: -500, spentCycle: 500, reports: 500, worth: -500, cash: -500 },
  'ATM cash to wallet': { cash: 500 },
  'refund to card': { bank: 500, income: 500, worth: 500, cardOwed: -500 },
  'money in, undecided': { bank: 2000, income: 2000, worth: 2000 },
  'money in → spend': { bank: 2000, income: 2000, worth: 2000 },
  'money in → emergency': { worth: 2000, fund: 2000 },
  'money in → grow': { worth: 2000, grow: 2000 },
  'money in → goal': { worth: 2000, goal: 2000 },
  'money in → loan': { worth: 2000, loans: -2000 },
  'money in → keep': { bank: 2000, worth: 2000, kept: 2000 },
  'bank loan credit': { bank: 10000, income: 10000, worth: 10000 },
  'save → emergency': { bank: -100, fund: 100 },
  'save → grow': { bank: -100, grow: 100 },
  'save → goal': { bank: -100, goal: 100 },
  'save → loan prepay': { bank: -100, loans: -100 },
  'save, undecided': { bank: -100 },
  'bill paid (electricity)': { bank: -1200, worth: -1200 },
  'card bill paid (its EMI part)': { cardOwed: -6010 },
  'old card bill paid early': { cardOwed: -3000 },
  'old card bill paid in full': { bank: -3000, cardOwed: -9010 },
  'borrowed from friend': { bank: 3000, people: -3000 },
  'lent to friend': { bank: -3000, people: 3000 },
  'friend pays back': { bank: 3000, people: -3000 },
  'you pay friend back': { bank: -3000, people: 3000 },
  'passed on (in+out)': {},
  'purchase covered by kept': { bank: -1500, reports: 1500, worth: -1500, kept: -1500 },
  'card spend → EMI (6 months)': { bank: 12000, loans: 12000, cardOwed: -12000 },
  'spend Emergency': { bank: -500, spentCycle: 500, reports: 500, worth: -500 },
  'salary lower (90k)': {},
  'balance check (−1000)': { bank: -1000, worth: -1000 },
};

test('the money map covers every kind of entry', () => {
  assert.deepEqual(Object.keys(MAP).sort(), Object.keys(kinds).sort());
});

for (const [name, k] of Object.entries(kinds)) {
  test('money map: ' + name, () => {
    const s = base();
    if (k.pre) k.pre(s);
    const before = measure(s);
    (typeof k === 'function' ? k : k.apply)(s);
    const after = measure(s);
    const got = {};
    KEYS.forEach((key) => { const v = after[key] - before[key]; if (v) got[key] = v; });
    assert.deepEqual(got, MAP[name]);
    // Every number stays a number.
    Object.entries(after).forEach(([key, v]) => assert.ok(typeof v !== 'string' || !/^ERR/.test(v), key + ': ' + v));
    Object.entries(after).forEach(([key, v]) => assert.ok(typeof v !== 'number' || Number.isFinite(v), key + ' is ' + v));
  });
}

test('money map: moving your own money never changes net worth', () => {
  const own = ['ATM cash to wallet', 'save → emergency', 'save → grow', 'save → goal', 'save → loan prepay', 'save, undecided', 'card bill paid (its EMI part)',
    'old card bill paid early', 'old card bill paid in full', 'borrowed from friend', 'lent to friend', 'friend pays back', 'you pay friend back', 'passed on (in+out)', 'card spend → EMI (6 months)'];
  own.forEach((name) => assert.equal(MAP[name].worth, undefined, name));
});
