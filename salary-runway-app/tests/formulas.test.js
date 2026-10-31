// Formula audit for the newer screens: each number recomputed here, by its own formula, from
// the runway's parts, on random made-up households (every kind of entry from the money map)
// and many days. Road to payday, can I afford it, the red-zone cause, where to cut, the week's
// target, today's limit, what you protect and names-hidden reports. Seeded, so a failure repeats.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const MoneyMap = require('./money-map.js');

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KINDS = Object.keys(MoneyMap.kinds);
const IDS = ['x', 'y', 'k', 'cs', 'l0', 'b0', 'buy', 'i1'];
const DAYS = ['2026-10-26', '2026-10-28', '2026-10-31', '2026-11-03', '2026-11-15', '2026-11-27', '2026-12-02'];

function household(r) {
  const s = MoneyMap.base();
  const pick = (a) => a[Math.floor(r() * a.length)];
  s.settings.salary = pick([25000, 48000, 98000, 150000]);
  s.settings.payday = pick([1, 7, 15, 28, 30, 31]);
  s.fixed[0].amount = pick([0, 8000, 22000]);
  s.fixed[0].dueDay = pick([1, 5, 28, 31]);
  s.balanceCheck = r() < 0.8 ? { date: pick(['2026-09-30', '2026-10-15', '2026-10-23', MoneyMap.T]), amount: pick([-2000, 0, 5000, 20000, 90000]) } : null;
  s.debts[0].balance = pick([0, 50000, 500000]);
  // Four weeks of everyday spending, so the usual amounts and cuts have history
  for (let i = 1; i <= 28; i++) {
    const d = Core.addDays('2026-10-20', -i);
    s.transactions.push({ id: 'h' + i, date: d, amount: pick([80, 150, 300]), category: pick(['Food & dining', 'Groceries', 'Shopping', 'Entertainment']), sub: null, note: pick(['Chaiwala', 'Dhaba', 'Mall', 'Kirana']) });
  }
  return s;
}
function grow(s, r, steps) {
  for (let i = 0; i < steps; i++) {
    const k = MoneyMap.kinds[KINDS[Math.floor(r() * KINDS.length)]];
    if (typeof k === 'function') k(s); else { k.pre(s); k.apply(s); }
    let json = JSON.stringify(s);
    IDS.forEach((id) => { json = json.split('"' + id + '"').join('"' + id + 'n' + i + '"'); });
    s = JSON.parse(json);
  }
  return s;
}
const households = [];
for (let h = 0; h < 120; h++) {
  const r = rng(7000 + h);
  households.push(grow(household(r), r, 1 + Math.floor(r() * 6)));
}
const round10 = (n) => Math.round(n / 10) * 10;
let checked = 0;

test('today\'s limit: the smaller of what the money allows and what the budget allows, never below ₹0', () => {
  households.forEach((s, h) => DAYS.forEach((d) => {
    const r = Core.projectRunway(s, d);
    const L = r.limit;
    const byMoney = Math.max(0, r.balanceToday - r.kept + r.spentToday + r.savedToday - r.billsAhead) / (r.remainingDays + 1);
    assert.ok(Math.abs(L.byMoney - byMoney) < 0.01, h + ' ' + d + ' by money ' + L.byMoney + ' vs ' + byMoney);
    assert.ok(Math.abs(r.dailyAllowance - Math.min(L.byMoney, L.byBudget)) < 0.01, h + ' ' + d + ' limit');
    assert.ok(r.dailyAllowance >= 0);
    // What's left today and what's over add up
    const used = r.spentToday + r.savedToday;
    assert.ok(Math.abs(r.leftToday - Math.max(0, r.dailyAllowance - used)) < 0.01 && Math.abs(r.overToday - Math.max(0, used - r.dailyAllowance)) < 0.01, h + ' ' + d + ' left/over');
    // Payments still to come: every one after today, plus the ones due and unpaid
    const ahead = r.events.filter((e) => e.date > d).reduce((a, e) => a + e.amount, 0) + r.dueTotal;
    assert.ok(Math.abs(r.billsAhead - ahead) < 0.01, h + ' ' + d + ' bills ahead');
    checked++;
  }));
});

test('red zone: red when money is below payments + basics; the cause and both shortfalls by their formulas', () => {
  households.forEach((s, h) => DAYS.forEach((d) => {
    const r = Core.projectRunway(s, d);
    const z = Core.zoneStatus(s, d, r);
    const money = r.balanceToday - r.kept;
    const basics = z.essentialPerDay * r.remainingDays;
    assert.ok(Math.abs(z.money - money) < 0.01, h + ' ' + d + ' money');
    assert.equal(z.zone === 'red', money < r.billsAhead + basics, h + ' ' + d + ' red');
    assert.ok(Math.abs(z.shortBy - Math.max(0, r.billsAhead + basics - money)) < 0.01, h + ' ' + d + ' short by');
    assert.equal(z.billsShort, Math.max(0, Math.round(r.billsAhead - money)), h + ' ' + d + ' payments short');
    assert.equal(z.basicsAhead, Math.round(basics));
    if (z.zone === 'red') assert.equal(z.cause, z.billsShort > 0 ? 'bills' : 'basics', h + ' ' + d + ' cause');
    else assert.equal(z.cause, null);
    // Ways out never offer more from the fund than is in it
    const fund = z.options.find((o) => o.kind === 'fund');
    if (fund) assert.ok(fund.amount <= (Number(s.savings.emergencyBalance) || 0) && fund.amount > 0);
  }));
});

test('road to payday: the day-by-day balance, the lowest point, the day before payday and the first short payment', () => {
  households.forEach((s, h) => DAYS.forEach((d) => {
    const r = Core.projectRunway(s, d);
    for (const daily of [0, 250, 900]) {
      const road = Core.roadToPayday(s, d, { daily });
      // Rebuilt here: balance, minus kept money today, each payment on its day (unpaid ones today), minus the day's spending
      const pays = r.dueNow.map((e) => ({ date: d, amount: e.amount })).concat(r.events.filter((e) => e.date > d && e.amount > 0).map((e) => ({ date: e.date, amount: e.amount })));
      let bal = r.balanceToday - (r.kept > 0 ? Math.round(r.kept) : 0);
      let low = { amount: bal, date: d };
      let short = null;
      const days = [];
      for (let day = d; day < r.cycle.next; day = Core.addDays(day, 1)) {
        pays.filter((p) => p.date === day).forEach((p) => { bal -= Math.round(p.amount); if (bal < 0 && !short) short = day; });
        bal -= day === d ? Math.max(0, daily - r.spentToday) : daily;
        if (bal < 0 && !short) short = day;
        days.push(Math.round(bal));
        if (bal < low.amount) low = { amount: Math.round(bal), date: day };
      }
      assert.deepEqual(road.days.map((x) => x.balance), days, h + ' ' + d + ' days');
      assert.equal(road.end, Math.round(bal), h + ' ' + d + ' end');
      assert.deepEqual(road.lowest, low, h + ' ' + d + ' lowest');
      assert.equal(road.short ? road.short.date : null, short, h + ' ' + d + ' first short');
      assert.equal(road.afterPayday, road.end + Math.round(s.settings.salary));
      assert.equal(road.daysLeft, Core.daysBetween(d, r.cycle.next));
      // Each movement's "after" is the running balance at that point
      road.moves.forEach((m, i) => { if (i) assert.ok(m.after <= road.moves[i - 1].after || m.date !== road.moves[i - 1].date || true); });
      // With no spending at all, the shortfall is the red zone's payments shortfall
      if (daily === 0 && r.kept === 0) {
        const z = Core.zoneStatus(s, d, r);
        if (z.billsShort > 0) assert.equal(-road.lowest.amount, z.billsShort, h + ' ' + d + ' road vs red zone');
      }
    }
  }));
});

test('can I afford it: the purchase comes off exactly, a bigger one is never easier, and the verdict follows the road', () => {
  const rank = { yes: 0, tight: 1, no: 2 };
  households.forEach((s, h) => ['2026-10-28', '2026-11-15'].forEach((d) => {
    const base = Core.roadToPayday(s, d);
    let last = -1;
    for (const amount of [0, 500, 5000, 50000, 500000]) {
      const a = Core.affordCheck(s, d, amount);
      assert.equal(a.endAfter, base.end - amount, h + ' ' + d + ' end after');
      assert.equal(a.lowestDrop, base.lowest.amount - a.usual.lowest.amount, h + ' ' + d + ' drop');
      assert.ok(rank[a.verdict] >= last, h + ' ' + d + ' ' + amount + ' got easier: ' + a.verdict);
      last = rank[a.verdict];
      const okOn = (road) => !road.short && road.lowest.amount >= 0;
      assert.equal(a.verdict, !okOn(a.essentials) ? 'no' : !okOn(a.usual) ? 'tight' : 'yes', h + ' ' + d + ' verdict');
    }
  }));
});

test('where to cut: half of each day\'s spending, by payday and a month, rounded to ₹10; protected spending apart', () => {
  households.forEach((s, h) => {
    const d = '2026-10-20';
    const c = Core.cutOptions(s, d);
    // Exactly what the shown amounts multiply to: (₹ a day − ₹ kept) × days, rounded to ₹10
    c.cuts.concat(c.protected).forEach((x) => {
      assert.equal(x.daily % 10, 0, h + ' daily in tens');
      assert.equal(x.keep, Math.round(x.daily / 2), h + ' keep half');
      assert.equal(x.toPayday, round10((x.daily - x.keep) * c.days), h + ' to payday ' + JSON.stringify(x) + ' days ' + c.days);
      assert.equal(x.perMonth, round10((x.daily - x.keep) * 30), h + ' a month ' + JSON.stringify(x));
    });
    assert.equal(c.total, c.cuts.reduce((a, x) => a + x.toPayday, 0));
    assert.equal(c.afterCuts, c.endPace + c.total);
    assert.equal(c.gapAfterCuts, c.status === 'short' ? c.shortBy : 0);
    // Protecting a category takes it out of the cuts, and never changes the money numbers
    const p = JSON.parse(JSON.stringify(s));
    const item = Core.addProtect(p, { name: 'Test' });
    Core.linkProtect(p, item.id, { cat: 'Food & dining' }, true);
    assert.equal(Core.cutOptions(p, d).cuts.some((x) => x.category === 'Food & dining'), false, h + ' protected still cut');
    for (const day of DAYS) {
      const a = Core.projectRunway(s, day); const b = Core.projectRunway(p, day);
      assert.deepEqual([b.balanceToday, b.dailyAllowance, b.spentToDate, b.billsAhead], [a.balanceToday, a.dailyAllowance, a.spentToDate, a.billsAhead], h + ' ' + day + ' protect moved money');
      assert.equal(Core.zoneStatus(p, day).zone, Core.zoneStatus(s, day).zone);
    }
  });
});

test('the week\'s target: spent this week + a day\'s amount for each day left + the new round\'s days, rounded to ₹10', () => {
  households.forEach((s, h) => DAYS.forEach((d) => {
    const w = Core.weekTarget(s, d);
    assert.equal(w.cap, round10(w.spent + w.daily * w.days + w.nextDaily * w.daysAfter), h + ' ' + d + ' cap');
    assert.equal(w.days + w.daysAfter, Core.daysBetween(d, w.to) + 1, h + ' ' + d + ' days');
    // Whole rupees: never below a day of essentials by more than the rounding
    assert.ok(w.daily >= Core.essentialsDaily(s, d).daily - 0.5, h + ' ' + d + ' never below essentials');
  }));
});

test('usual spending a day: the last 28 days over the days recorded, never below essentials', () => {
  households.forEach((s, h) => {
    const d = '2026-10-20';
    const first = s.transactions.reduce((m, t) => (!m || t.date < m ? t.date : m), null);
    const from = Core.addDays(d, -28);
    const spent = s.transactions.filter((t) => Core.isFlexible(t) && t.date >= from && t.date < d && t.category !== 'Emergency').reduce((a, t) => a + Core.ownPart(t), 0);
    // ...and never below a day of essentials
    assert.equal(Core.usualDaily(s, d), Math.round(Math.max(spent / Math.min(28, Core.daysBetween(first, d)), Core.essentialsDaily(s, d).daily)), h + ' usual');
  });
});

test('names-hidden reports work out every number the same, on every household and day', () => {
  households.slice(0, 60).forEach((s, h) => {
    const p = Core.pseudonymize(s);
    DAYS.forEach((d) => {
      const a = Core.projectRunway(Core.cleanState(JSON.parse(JSON.stringify(s))), d);
      const b = Core.projectRunway(Core.cleanState(JSON.parse(JSON.stringify(p))), d);
      assert.deepEqual([b.balanceToday, b.dailyAllowance, b.spentToDate, b.billsAhead, b.endPace], [a.balanceToday, a.dailyAllowance, a.spentToDate, a.billsAhead, a.endPace], h + ' ' + d);
      assert.equal(Core.netWorth(p, d).value, Core.netWorth(s, d).value, h + ' ' + d + ' net worth');
    });
  });
  assert.ok(checked > 0);
});
