// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The dictionaries register themselves on `self`, as in the browser.
global.self = global;
require('../i18n-mr.js');
require('../i18n-hi.js');
const I18N = require('../i18n.js');
const Core = require('../core.js');

const shape = (s) => (s.match(/\{\w+\}/g) || []).sort().join() + '|' + (s.match(/<\/?[a-z]+/g) || []).sort().join();

test('Marathi and Hindi have the same entries, keeping every {value} and tag', () => {
  const mr = global.I18N_DICTS.mr;
  const hi = global.I18N_DICTS.hi;
  assert.deepEqual(Object.keys(mr).sort(), Object.keys(hi).sort());
  Object.keys(mr).forEach((k) => {
    assert.equal(shape(mr[k]), shape(k), 'mr: ' + k);
    assert.equal(shape(hi[k]), shape(k), 'hi: ' + k);
  });
});

test('every tr(\'…\') text in the app has Marathi and Hindi', () => {
  const missing = [];
  ['app.js', 'core.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const re = /\btr\(\s*'((?:[^'\\]|\\.)*)'(?=\s*[,)])/g;
    let m;
    while ((m = re.exec(src))) {
      const key = m[1].replace(/\\'/g, "'");
      ['mr', 'hi'].forEach((l) => { if (!global.I18N_DICTS[l][key]) missing.push(l + ': ' + key); });
    }
  });
  assert.deepEqual(missing, []);
});

test('t() fills in values and falls back to English', () => {
  I18N.setLang('mr');
  assert.equal(I18N.t('{amount} spent', { amount: '₹500' }), '₹500 खर्च');
  assert.equal(I18N.t('Not a key {x}', { x: 1 }), 'Not a key 1');
  I18N.setLang('hi');
  assert.equal(I18N.t('{n} days', { n: 3 }), '3 दिन');
  I18N.setLang('xx');
  assert.equal(I18N.getLang(), 'en');
  assert.equal(I18N.t('{n} days', { n: 3 }), '3 days');
  assert.equal(I18N.detect('mr-IN'), 'mr');
  assert.equal(I18N.detect('hi'), 'hi');
  assert.equal(I18N.detect('ta-IN'), 'en');
});

test('calculation messages follow the language', () => {
  const s = {
    settings: { salary: 50000, payday: 1 }, fixed: [{ id: 'f1', name: 'Rent', amount: 15000, dueDay: 5 }], debts: [],
    budgets: [{ id: 'b1', name: 'Groceries', amount: 0, auto: true }], bills: [], sinking: [], transactions: [], merchantRules: {}, adjustment: null,
    savings: { emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, emergencyBalance: 0, emergencyTargetMonths: 3, investSaved: 0 },
  };
  I18N.setLang('mr');
  Core.setTranslator(I18N.t);
  assert.match(Core.suggestUse(s, '2026-10-10').reason, /आपत्कालीन निधी/);
  I18N.setLang('hi');
  assert.match(Core.suggestUse(s, '2026-10-10').reason, /इमरजेंसी फंड/);
  I18N.setLang('en');
  assert.match(Core.suggestUse(s, '2026-10-10').reason, /emergency fund/);
  Core.setTranslator(I18N.fill);
});
