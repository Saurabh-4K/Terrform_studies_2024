// Stress test: random made-up households, each given a random mix of every kind of entry
// from the money map, then checked on many days across two paydays. The money rules
// must hold every time, whatever the mix. Seeded, so a failure always repeats.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const MoneyMap = require('./money-map.js');

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KINDS = Object.keys(MoneyMap.kinds);
// The fixed ids the money map uses; renamed after each step so entries never clash.
const IDS = ['x', 'y', 'k', 'cs', 'l0', 'b0', 'buy', 'i1'];

function household(r) {
  const s = MoneyMap.base();
  const pick = (a) => a[Math.floor(r() * a.length)];
  s.settings.salary = pick([25000, 48000, 98000, 150000]);
  s.settings.payday = pick([1, 7, 15, 28, 30, 31]);
  s.fixed[0].amount = pick([0, 8000, 22000]);
  s.fixed[0].dueDay = pick([1, 5, 28, 31]);
  s.balanceCheck = r() < 0.8 ? { date: pick(['2026-09-30', '2026-10-15', '2026-10-23', MoneyMap.T]), amount: pick([-2000, 0, 5000, 20000, 90000]) } : null;
  s.debts[0].balance = pick([0, 50000, 500000]);
  if (r() < 0.3) s.reimbRouting = 'vault';
  return s;
}

function apply(s, kind, n) {
  const k = MoneyMap.kinds[kind];
  if (typeof k === 'function') k(s); else { k.pre(s); k.apply(s); }
  // A claim on a plain payment now and then
  if (r0() < 0.15) {
    const t = s.transactions.find((x) => x.id === 'x' && Core.isFlexible(x) && !x.iouId && !x.passedOn && !x.claimId);
    if (t) Core.addClaim(s, 'x', { eligible: Math.ceil(t.amount / 2) }, 'now');
  }
  let json = JSON.stringify(s);
  IDS.forEach((id) => { json = json.split('"' + id + '"').join('"' + id + n + '"'); });
  return JSON.parse(json);
}
let r0 = rng(1);

const DAYS = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-31', '2026-11-03', '2026-11-15', '2026-11-27', '2026-11-28', '2026-12-02'];
function check(s, day, where) {
  const before = JSON.stringify(s);
  const r = Core.projectRunway(s, day);
  for (const k of ['balanceToday', 'dailyAllowance', 'leftToday', 'tomorrowAllowance', 'spentToDate', 'endPace', 'kept']) {
    assert.ok(Number.isFinite(r[k]), where + ' ' + k + ' = ' + r[k]);
  }
  assert.ok(r.dailyAllowance >= 0 && r.leftToday >= 0, where + ' limit below zero');
  const n = Core.netWorth(s, day);
  assert.ok(Number.isFinite(n.value), where + ' net worth');
  assert.equal(n.value, Math.round(n.own - n.owe), where + ' net worth ≠ own − owe');
  const rep = Core.spendWhere(s, day, 'cycle').categories.reduce((a, c) => a + c.spent, 0);
  // Reports show where money went, including purchases paid from money kept for them; spending leaves those out
  const covered = Core.spendInRange(s.transactions, r.cycle).filter((t) => t.date <= day)
    .reduce((a, t) => a + (t.maybeId ? t.amount - (Number(t.reimbExcluded) || 0) : Math.min(Number(t.covered) || 0, Math.max(0, t.amount - (Number(t.reimbExcluded) || 0)))) + (Number(t.tripCovered) || 0), 0);
  assert.equal(Math.round(rep), Math.round(r.spentToDate + covered), where + ' reports ≠ spent + covered');
  const v = Core.reimbView(s);
  assert.ok(v.pendingFloat >= 0 && v.vault >= 0, where + ' claims below zero');
  assert.ok(r.held >= 0 && r.kept >= r.held, where + ' held money');
  const d = Core.debtFreeDates(s, day);
  if (d) assert.ok(d.now.never || d.now.date, where + ' debt-free date');
  // Reading the numbers never changes the data
  assert.equal(JSON.stringify(s), before, where + ' reading changed the data');
  return r;
}

test('random households: the money rules hold after every entry, on every day', () => {
  let checks = 0;
  for (let h = 0; h < 200; h++) {
    const r = rng(1000 + h);
    r0 = rng(5000 + h);
    let s = household(r);
    const steps = 1 + Math.floor(r() * 7);
    const done = [];
    for (let i = 0; i < steps; i++) {
      const kind = KINDS[Math.floor(r() * KINDS.length)];
      done.push(kind);
      s = apply(s, kind, i);
      const where = 'household ' + h + ' after [' + done.join(', ') + ']';
      check(s, MoneyMap.T, where);
      checks++;
    }
    const where = 'household ' + h + ' [' + done.join(', ') + ']';
    DAYS.forEach((day) => { check(s, day, where + ' on ' + day); checks++; });
    // A plain ₹100 payment today takes exactly ₹100 off the balance and never raises the limit
    const a = Core.projectRunway(s, MoneyMap.T);
    const t = JSON.parse(JSON.stringify(s));
    t.transactions.push({ id: 'probe', date: MoneyMap.T, amount: 100, category: 'Misc', note: 'Probe' });
    const b = Core.projectRunway(t, MoneyMap.T);
    assert.equal(b.balanceToday, a.balanceToday - 100, where + ' ₹100 payment');
    assert.ok(b.dailyAllowance <= a.dailyAllowance + 1e-9, where + ' payment raised the limit');
    // Backup and restore keep every number
    const back = Core.cleanState(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(MoneyMap.measure(back), MoneyMap.measure(s), where + ' restore changed numbers');
  }
  assert.ok(checks > 1000);
});
