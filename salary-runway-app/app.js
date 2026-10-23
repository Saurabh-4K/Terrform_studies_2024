/*
 * Salary Runway: user interface.
 * Everything is stored in this browser's localStorage. Nothing is sent anywhere.
 */
(function () {
  'use strict';

  const Core = window.Core;
  const Demo = window.Demo;
  const KEY = 'salary-runway-v1';
  const TABS = ['home', 'spend', 'plan', 'debts', 'grow'];
  const EMERGENCY_TYPES = [
    'Medical', 'Vehicle repair', 'Family function', 'Death in family', 'Tax payment',
    'Penalty or fine', 'Home repair', 'Job loss', 'Other',
  ];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SAMPLE_SMS = [
    'Rs.450.00 debited from a/c **1234 on {d1} to VPA swiggy@icici. Not you? Call 18001234.',
    'Sent Rs.250.00 From HDFC Bank A/C *1234 To ZOMATO On {d1} Ref 612345678901',
    'Spent Rs 1,299 on your SBI Credit Card ending 1234 at AMAZON on {d2}.',
    'Your a/c XX1234 debited for INR 320.00 on {d2}. Info: UPI/P2M/629912/UBER INDIA. Avl bal Rs 12,000',
    'Rs 2,000 credited to your a/c XX1234 on {d2} by UPI from RAHUL',
    '482913 is your OTP for a transaction of Rs 899. Do not share it with anyone.',
  ].join('\n\n');

  // Inside the Android app, Capacitor provides a bridge to the SMS inbox.
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const SmsInbox = NATIVE ? window.Capacitor.registerPlugin('SmsInbox') : null;
  const SMS_FIRST_READ_DAYS = 45;

  let state;
  let tab = 'home';
  const ui = {
    txFilter: 'cycle',
    smsText: '',
    smsRows: null,
    confirmWipe: false,
    backup: null,
    restoreOpen: false,
    restoreError: '',
    emergency: { type: 'Medical', amount: '', cut: 20 },
    balanceOpen: false,
    smsMaxDate: 0,
    smsBusy: false,
  };

  // ---------- storage ----------

  function today() { return Core.toISO(new Date()); }

  function emptyState() {
    return {
      version: 1,
      isDemo: false,
      settings: { salary: 0, payday: 1, name: '' },
      fixed: [],
      debts: [],
      budgets: Core.DEFAULT_SPLIT.map(([name]) => ({ id: uid(), name, amount: 0, auto: true })),
      savings: { auto: true, emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, emergencyBalance: 0, emergencyTargetMonths: 3, investSaved: 0 },
      sinking: [],
      transactions: [],
      merchantRules: {},
      emergencies: [],
      adjustment: null,
      savingsRecorded: [],
      balanceCheck: null,
      balancePromptSkipped: null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.settings) return migrate(Object.assign(emptyState(), parsed));
      }
    } catch (e) { /* storage unavailable: fall through to example data */ }
    return Demo.demoState(today());
  }

  // Older saves had no automatic budgets: budgets left at ₹0 become automatic.
  function migrate(s) {
    s.budgets.forEach((b) => { if (b.auto === undefined) b.auto = !(Number(b.amount) > 0); });
    if (s.savings.auto === undefined) {
      s.savings.auto = !(s.savings.emergencyMonthly || s.savings.investMonthly || s.savings.debtExtra);
    }
    return s;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- formatting ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function inr(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN');
  }

  function shortInr(n) {
    const v = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (v >= 100000) return sign + '₹' + (v / 100000).toFixed(v % 100000 ? 1 : 0) + 'L';
    if (v >= 1000) return sign + '₹' + Math.round(v / 1000) + 'k';
    return sign + '₹' + Math.round(v);
  }

  function fmtDate(iso, withYear) {
    const opts = { day: 'numeric', month: 'short' };
    if (withYear) opts.year = 'numeric';
    return Core.parseISO(iso).toLocaleDateString('en-IN', opts);
  }

  function monthYear(iso) {
    return Core.parseISO(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function categories() {
    const names = state.budgets.map((b) => b.name).filter(Boolean);
    ['Misc', 'Emergency'].forEach((n) => { if (names.indexOf(n) === -1) names.push(n); });
    return names;
  }

  function categoryOptions(selected) {
    const list = categories();
    if (selected && list.indexOf(selected) === -1) list.push(selected);
    return list.map((c) => '<option' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  }

  function toast(msg) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---------- shell ----------

  const ICONS = {
    home: '<path d="M4 18 L9 12 L13 15 L20 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 21h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    spend: '<rect x="3" y="6" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/><path d="M7 15h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    plan: '<path d="M5 4h14v16H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    debts: '<path d="M12 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    grow: '<path d="M12 21V11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12c0-4 3-7 8-7 0 5-3 7-8 7zM12 15c0-3-2.5-5.5-7-5.5 0 4 2.5 5.5 7 5.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  };
  const TAB_LABELS = { home: 'Runway', spend: 'Spend', plan: 'Plan', debts: 'Debts', grow: 'Grow' };

  function render() {
    const app = document.getElementById('app');
    const banner = state.isDemo
      ? '<div class="banner"><span>You are looking at <b>example numbers</b>. Explore freely, then add your own.</span>' +
        '<button class="primary" data-action="start-own">Start with my numbers</button></div>'
      : '';
    const views = { home: viewHome, spend: viewSpend, plan: viewPlan, debts: viewDebts, grow: viewGrow };
    app.innerHTML =
      '<div class="shell">' +
      '<header class="topbar"><div class="brand">' +
      '<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5 L21 19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/><circle cx="21" cy="19" r="2.5" fill="var(--bad)"/><circle cx="3" cy="5" r="2.5" fill="var(--accent)"/></svg>' +
      'Salary Runway</div><span class="privacy-chip">Data stays on this device</span></header>' +
      banner +
      '<main id="view" class="stack" style="gap:16px">' + views[tab]() + '</main>' +
      '<p class="disclaimer">Salary Runway is a budgeting tool. It does not give investment advice and is not registered with SEBI or RBI.</p>' +
      '</div>' +
      '<nav class="tabbar" aria-label="Sections"><div class="tabbar-inner">' +
      TABS.map((t) =>
        '<button data-action="tab" data-tab="' + t + '"' + (t === tab ? ' aria-current="page"' : '') + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[t] + '</svg>' + TAB_LABELS[t] + '</button>'
      ).join('') +
      '</div></nav>';
    if (tab === 'home') drawRunway();
  }

  function setTab(t) {
    tab = TABS.indexOf(t) === -1 ? 'home' : t;
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }

  // ---------- home ----------

  function viewHome() {
    const t = today();
    if (!state.settings.salary) {
      return '<section class="card"><h2>Add your salary to see your runway</h2>' +
        '<p class="hint">Enter your monthly salary, payday and fixed payments. The graph will show the date your money runs out.</p>' +
        '<div><button class="primary" data-action="tab" data-tab="plan">Set up my plan</button></div></section>';
    }
    const r = Core.projectRunway(state, t);
    const cyc = r.cycle;
    const lastDay = Core.addDays(cyc.next, -1);
    const daysToPay = Core.daysBetween(t, cyc.next);
    let headline, sub;
    if (r.zeroPace) {
      const short = Core.daysBetween(r.zeroPace, cyc.next);
      headline = 'At this pace, your money runs out on <span class="date bad">' + fmtDate(r.zeroPace) + '</span>';
      sub = plural(short, 'day') + ' before your next salary on ' + fmtDate(cyc.next) + '. ' +
        (r.zeroPlan
          ? 'Even the budget can’t stretch this month: fixed payments and savings need more than what is left.'
          : 'Keeping to ' + inr(r.planRate) + ' a day from tomorrow gets you to payday with ' + inr(r.endPlan) + ' left.');
    } else {
      headline = 'Your salary lasts until payday';
      sub = 'At this pace you reach ' + fmtDate(cyc.next) + ' with about <b>' + inr(r.endPace) + '</b> left.';
    }

    // Joined mid-cycle: budgets cover only the days from the balance check.
    const share = r.anchor ? (cyc.days - r.anchorIdx) / cyc.days : 1;
    const fromDate = r.anchor ? r.anchor.date : cyc.start;
    const spentByCat = Core.byCategory(Core.spendInRange(state.transactions, cyc).filter((x) => x.date >= fromDate && x.date <= t));
    const bars = r.plan.budgets.map((b) => {
      const spent = spentByCat[b.name] || 0;
      delete spentByCat[b.name];
      return barRow(b.name, spent, Math.round((b.amount * share) / 10) * 10);
    });
    const flexSpent = Object.values(Core.byCategory(Core.spendInRange(state.transactions, cyc).filter((x) => x.date >= fromDate && x.date <= t))).reduce((a, b) => a + b, 0);
    Object.keys(spentByCat).forEach((cat) => bars.push(barRow(cat + ' (no budget)', spentByCat[cat], 0)));

    const upcoming = r.events.filter((e) => e.date > t);
    const askBalance = !state.isDemo && !r.anchor && state.balancePromptSkipped !== cyc.start;
    const ins = Core.insights(state, t);
    const adj = r.plan.adjustment;

    return (
      '<section class="hero">' +
      '<p class="eyebrow">Salary cycle · ' + fmtDate(cyc.start) + ' – ' + fmtDate(lastDay) + ' · day ' + (r.idxToday + 1) + ' of ' + cyc.days + '</p>' +
      '<h1>' + headline + '</h1><p class="sub">' + sub + '</p>' +
      '<div class="chart-wrap"><div id="runway-chart" role="img" aria-label="Balance through this salary cycle"></div>' +
      '<div class="legend"><span><i></i>Balance so far</span><span><i class="pace"></i>If you keep this pace</span><span><i class="plan"></i>If you keep to budget</span><span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="c-event"/></svg>Bill or EMI</span></div></div>' +
      '</section>' +
      (askBalance || ui.balanceOpen ? balanceForm(askBalance && !ui.balanceOpen) : '') +
      (adj ? '<div class="callout warn"><b>Emergency plan active until ' + fmtDate(adj.until, true) + '.</b><span class="hint">Flexible budgets are ' + adj.flexCutPct + '% lower' + (adj.pauseInvest ? ', the Grow budget is paused' : '') + (adj.pauseDebtExtra ? ' and extra debt payments are paused' : '') + '.</span></div>' : '') +
      '<section class="tiles">' +
      tile('Left to spend today', inr(r.leftToday),
        r.overToday > 0
          ? inr(r.overToday) + ' over today’s ' + inr(r.dailyAllowance) + '. Tomorrow: ' + inr(r.tomorrowAllowance)
          : r.spentToday ? 'Spent ' + inr(r.spentToday) + ' of ' + inr(r.dailyAllowance) + ' today' : 'Today’s share of your budget', true) +
      tile('Balance now', inr(r.balanceToday),
        (r.anchor ? 'From your balance on ' + fmtDate(r.anchor.date) : 'Worked out from your plan') +
        ' · <button class="link" data-action="balance-open">Update</button>') +
      tile('Next salary', plural(daysToPay, 'day'), fmtDate(cyc.next)) +
      tile('Flexible spending', inr(flexSpent), 'of ' + inr(Math.round((r.plan.flexTotal * share) / 10) * 10) + ' budget' + (r.anchor ? ' since ' + fmtDate(r.anchor.date) : '')) +
      '</section>' +
      '<section class="card"><div class="card-head"><h2>' + (r.anchor && r.anchorIdx > 0 ? 'You can spend until payday' : 'You can spend this cycle') + '</h2><button class="ghost" data-action="tab" data-tab="plan">Adjust</button></div>' +
      '<div class="bars">' + bars.join('') + '</div></section>' +
      '<section class="card"><div class="card-head"><h2>Coming up before payday</h2><span class="hint">' + inr(upcoming.reduce((s, e) => s + e.amount, 0)) + '</span></div>' +
      (upcoming.length
        ? '<div class="list">' + upcoming.map((e) =>
          '<div class="list-item"><div class="date-badge"><b>' + Core.parseISO(e.date).getDate() + '</b>' + MONTH_NAMES[Core.parseISO(e.date).getMonth()] + '</div>' +
          '<div class="grow"><div class="title">' + esc(e.name) + '</div><div class="meta">' + (e.kind === 'debt' ? 'Minimum payment' : 'Fixed payment') + '</div></div>' +
          '<div class="amt">' + inr(e.amount) + '</div></div>').join('') + '</div>'
        : '<p class="hint">No more fixed payments this cycle.</p>') +
      '</section>' +
      '<section class="card"><h2>What your spending says</h2><div>' +
      ins.map((i) => '<div class="insight lvl-' + i.level + '"><div><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p></div></div>').join('') +
      '</div></section>'
    );
  }

  function balanceForm(firstTime) {
    const t = today();
    const current = state.balanceCheck && state.balanceCheck.date === t ? state.balanceCheck.amount : '';
    return '<form id="balance-form" class="callout" autocomplete="off">' +
      '<b>' + (firstTime ? 'How much money is in your account this morning?' : 'Update your balance') + '</b>' +
      '<span class="hint">' + (firstTime
        ? 'The app can’t see what you spent before you started. Enter your bank balance as it was at the start of today, and the graph will start from there. Add any spending from today after this.'
        : 'Check your bank app and enter the balance from the start of today. The graph starts again from this amount, which covers cash and anything not recorded.') + '</span>' +
      '<div class="row"><label class="field grow-field" for="balance-amount"><span>Balance this morning (₹)</span><input id="balance-amount" type="number" inputmode="numeric" min="0" step="1" required value="' + esc(current) + '" placeholder="12500"></label></div>' +
      '<div class="row"><button class="primary" type="submit">Save balance</button>' +
      '<button type="button" class="ghost" data-action="balance-skip">' + (firstTime ? 'Not now' : 'Cancel') + '</button></div></form>';
  }

  function tile(label, value, sub, feature) {
    return '<div class="tile' + (feature ? ' feature' : '') + '"><span class="tile-label">' + label + '</span>' +
      '<span class="tile-value">' + value + '</span><span class="tile-sub">' + sub + '</span></div>';
  }

  function barRow(name, spent, budget) {
    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
    const cls = budget === 0 ? 'marigold' : spent > budget ? 'bad' : spent > budget * 0.85 ? 'warn' : '';
    const left = budget - spent;
    const right = budget > 0
      ? (left >= 0 ? '<b>' + inr(left) + '</b> left' : '<b class="bad">' + inr(-left) + ' over</b>')
      : inr(spent);
    return '<div class="bar-row"><div class="bar-top"><span>' + esc(name) + '</span><span class="amt">' + right + '</span></div>' +
      '<div class="bar"><span class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></div>' +
      (budget > 0 ? '<div class="bar-sub">Spent ' + inr(spent) + ' of ' + inr(budget) + '</div>' : '') + '</div>';
  }

  function niceStep(range, count) {
    const raw = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  function drawRunway() {
    const el = document.getElementById('runway-chart');
    if (!el) return;
    const r = Core.projectRunway(state, today());
    const W = Math.max(280, el.clientWidth || 600);
    const H = W < 480 ? 210 : 250;
    const L = 46, R = 14, T = 16, B = 30;
    const pts = r.points;
    const N = pts.length;
    const vals = [];
    pts.forEach((p) => ['actual', 'pace', 'plan'].forEach((k) => { if (p[k] !== null) vals.push(p[k]); }));
    const start = state.settings.salary - r.plan.savingsTotal;
    if (!r.anchor) vals.push(start);
    vals.push(0);
    const lo = Math.min.apply(null, vals);
    const hi = Math.max.apply(null, vals);
    const step = niceStep(hi - lo || 1, 4);
    const yMin = Math.floor(lo / step) * step;
    const yMax = Math.ceil(hi / step) * step;
    const x = (i) => L + (i * (W - L - R)) / Math.max(1, N - 1);
    const y = (v) => T + ((yMax - v) * (H - T - B)) / (yMax - yMin || 1);
    const path = (key, from) => {
      let d = '';
      for (let i = from; i < N; i++) {
        const v = pts[i][key];
        if (v === null) continue;
        d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      }
      return d;
    };

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">';
    for (let v = yMin; v <= yMax + 0.5; v += step) {
      svg += '<line class="' + (v === 0 ? 'c-zero' : 'c-grid') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      svg += '<text class="c-label" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + shortInr(v) + '</text>';
    }

    const actual = path('actual', 0);
    const ti = r.idxToday;
    if (actual) {
      const first = r.anchorIdx || 0;
      svg += '<path class="c-area" d="' + actual + 'L' + x(ti).toFixed(1) + ' ' + y(Math.max(0, yMin)).toFixed(1) + 'L' + x(first).toFixed(1) + ' ' + y(Math.max(0, yMin)).toFixed(1) + 'Z"/>';
    }
    svg += '<path class="c-plan" d="' + path('plan', ti) + '"/>';
    svg += '<path class="c-pace" d="' + path('pace', ti) + '"/>';
    svg += '<path class="c-actual" d="' + actual + '"/>';

    r.events.forEach((e) => {
      const i = Core.daysBetween(r.cycle.start, e.date);
      svg += '<circle class="c-event" cx="' + x(i).toFixed(1) + '" cy="' + (H - B + 7) + '" r="3.5"><title>' + esc(e.name) + ' ' + inr(e.amount) + ' on ' + fmtDate(e.date) + '</title></circle>';
    });

    svg += '<line class="c-today" x1="' + x(ti) + '" x2="' + x(ti) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
    svg += '<circle class="c-dot" cx="' + x(ti) + '" cy="' + y(pts[ti].actual) + '" r="5"/>';

    if (r.zeroPace) {
      const zi = Core.daysBetween(r.cycle.start, r.zeroPace);
      const anchor = zi > N - 5 ? 'end' : 'middle';
      svg += '<circle class="c-zero-dot" cx="' + x(zi) + '" cy="' + y(0) + '" r="5"/>';
      svg += '<text class="c-label-strong" x="' + x(zi) + '" y="' + (y(0) - 10) + '" text-anchor="' + anchor + '">₹0 on ' + fmtDate(r.zeroPace) + '</text>';
    }

    const ly = H - 4;
    svg += '<text class="c-label" x="' + x(0) + '" y="' + ly + '" text-anchor="start">' + fmtDate(r.cycle.start) + '</text>';
    svg += '<text class="c-label" x="' + x(N - 1) + '" y="' + ly + '" text-anchor="end">' + fmtDate(Core.addDays(r.cycle.next, -1)) + '</text>';
    if (ti > 3 && ti < N - 4) svg += '<text class="c-label-strong" x="' + x(ti) + '" y="' + ly + '" text-anchor="middle">Today</text>';
    svg += '</svg>';
    el.innerHTML = svg;
  }

  // ---------- spend ----------

  function viewSpend() {
    const t = today();
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    const list = (ui.txFilter === 'cycle' ? Core.spendInRange(state.transactions, cyc) : state.transactions.slice())
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const total = list.reduce((s, x) => s + x.amount, 0);
    const shown = list.slice(0, 200);

    return (
      '<section class="card"><h2>Add a payment</h2>' +
      '<form id="add-tx" class="form-grid" autocomplete="off">' +
      '<label class="field">Amount (₹)<input id="tx-amount" type="number" inputmode="decimal" min="1" step="1" required placeholder="250"></label>' +
      '<label class="field">Category<select id="tx-category">' + categoryOptions('Food & dining') + '</select></label>' +
      '<label class="field">Date<input id="tx-date" type="date" value="' + t + '" max="' + t + '" required></label>' +
      '<label class="field">Where / what<input id="tx-note" type="text" placeholder="Swiggy"></label>' +
      '<div class="wide"><button class="primary" type="submit">Add payment</button></div>' +
      '</form></section>' +

      (NATIVE
        ? '<section class="card"><div class="card-head"><h2>Bank SMS</h2>' + (state.smsAuto ? modeChip(true) : '') + '</div>' +
          '<p class="hint">' + (state.smsAuto
            ? 'New bank and UPI messages are checked each time you open the app. Review them below before they are added.'
            : 'Let the app read your bank and UPI messages to record payments for you. Messages are read on this phone and never leave it. You review every payment before it is added.') + '</p>' +
          '<div class="row"><button class="primary" data-action="sms-native"' + (ui.smsBusy ? ' disabled' : '') + '>' +
          (ui.smsBusy ? 'Reading…' : state.smsAuto ? 'Check for new messages' : 'Read bank SMS') + '</button></div>' +
          smsPreview() + '</section>'
        : '<section class="card"><div class="card-head"><h2>Import from bank SMS</h2></div>' +
          '<p class="hint">Paste one or more bank or UPI messages. The Android app reads them from your inbox automatically. Here you paste them, and they are read right here on your device.</p>' +
          '<label class="field" for="sms-text">Messages<textarea id="sms-text" placeholder="Rs.450.00 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici…">' + esc(ui.smsText) + '</textarea></label>' +
          '<div class="row"><button class="primary" data-action="sms-read">Read messages</button><button data-action="sms-sample">Paste sample messages</button></div>' +
          smsPreview() +
          '</section>') +

      '<section class="card"><div class="card-head"><h2>Payments</h2>' +
      '<div class="seg" role="group" aria-label="Show"><button data-action="tx-filter" data-filter="cycle" aria-pressed="' + (ui.txFilter === 'cycle') + '">This cycle</button>' +
      '<button data-action="tx-filter" data-filter="all" aria-pressed="' + (ui.txFilter === 'all') + '">All</button></div></div>' +
      '<p class="hint">' + plural(list.length, 'payment') + ' · ' + inr(total) + '. Change a category and the app remembers it for that shop next time.</p>' +
      (shown.length
        ? '<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Category</th><th class="amt">Amount</th><th><span class="sr">Delete</span></th></tr></thead><tbody>' +
          shown.map((x) =>
            '<tr><td><div class="cell-title">' + esc(x.note || 'Payment') + '</div><div class="cell-sub">' + fmtDate(x.date) + (x.source === 'sms' ? ' · from SMS' : '') + '</div></td>' +
            '<td><select data-tx-cat="' + esc(x.id) + '" aria-label="Category">' + categoryOptions(x.category) + '</select></td>' +
            '<td class="amt">' + inr(x.amount) + '</td>' +
            '<td><button class="icon" data-action="tx-delete" data-id="' + esc(x.id) + '" aria-label="Delete payment">✕</button></td></tr>'
          ).join('') + '</tbody></table></div>' +
          (list.length > shown.length ? '<p class="hint">Showing the latest 200.</p>' : '')
        : '<p class="hint">No payments yet.</p>') +
      '</section>'
    );
  }

  function smsPreview() {
    if (!ui.smsRows) return '';
    if (!ui.smsRows.length) return '<p class="hint">No messages found.</p>';
    const selected = ui.smsRows.filter((r) => r.checked).length;
    return '<div class="table-wrap"><table><thead><tr><th><span class="sr">Import</span></th><th>Payment</th><th>Category</th><th class="amt">Amount</th></tr></thead><tbody>' +
      ui.smsRows.map((r, i) => {
        if (!r.parsed) {
          return '<tr class="muted"><td></td><td colspan="3">Skipped, not a payment: ' + esc(r.text.slice(0, 60)) + '…</td></tr>';
        }
        const p = r.parsed;
        const note = p.type === 'credit' ? 'Money in, not counted as spending' : r.duplicate ? 'Already added' : '';
        return '<tr' + (p.type === 'credit' || r.duplicate ? ' class="muted"' : '') + '>' +
          '<td><input type="checkbox" data-sms-check="' + i + '" aria-label="Import this payment"' + (r.checked ? ' checked' : '') + (p.type === 'credit' ? ' disabled' : '') + '></td>' +
          '<td><div class="cell-title">' + esc(p.merchant) + '</div><div class="cell-sub">' + fmtDate(p.date) + (note ? ' · ' + note : '') + '</div></td>' +
          '<td>' + (p.type === 'credit' ? '—' : '<select data-sms-cat="' + i + '" aria-label="Category">' + categoryOptions(p.category) + '</select>') + '</td>' +
          '<td class="amt">' + (p.type === 'credit' ? '+' : '') + inr(p.amount) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="row"><button class="primary" data-action="sms-import"' + (selected ? '' : ' disabled') + '>Add ' + plural(selected, 'payment') + '</button>' +
      '<button class="ghost" data-action="sms-clear">Clear</button></div>';
  }

  function readSms() {
    const t = today();
    ui.smsRows = smsRows(Core.splitSmsBatch(ui.smsText).map((text) => ({ text, day: t })));
  }

  // Rows for the review table. `day` is the date the message arrived; text
  // without a date of its own gets that date.
  function smsRows(messages) {
    return messages.map(({ text, day }) => {
      const parsed = Core.parseSms(text, state.merchantRules, day);
      const duplicate = !!parsed && state.transactions.some((x) =>
        x.date === parsed.date && x.amount === parsed.amount &&
        Core.normalizeMerchant(x.note) === Core.normalizeMerchant(parsed.merchant));
      return { text, parsed, duplicate, checked: !!parsed && parsed.type === 'debit' && !duplicate };
    });
  }

  // ---------- plan ----------

  function numInput(id, bind, value, label, extra) {
    return '<label class="field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="number" inputmode="numeric" min="0" step="1" data-bind="' + bind + '" value="' + esc(value) + '"' + (extra || '') + '></label>';
  }

  function listField(list, item, field, label, type, extra) {
    const id = list + '-' + item.id + '-' + field;
    return '<label class="field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="' + type + '"' +
      (type === 'number' ? ' inputmode="numeric" min="0" step="any"' : '') +
      ' data-list="' + list + '" data-id="' + esc(item.id) + '" data-field="' + field + '" value="' + esc(item[field]) + '"' + (extra || '') + '></label>';
  }

  function removeButton(list, item) {
    return '<button class="icon" data-action="list-remove" data-list="' + list + '" data-id="' + esc(item.id) + '" aria-label="Remove ' + esc(item.name || 'row') + '">✕</button>';
  }

  function viewPlan() {
    const s = state.settings;
    const plan = Core.monthlyPlan(state, today());
    const alloc = Core.allocate(state);
    const sv = alloc.savings;
    const edited = alloc.budgets.some((b) => !b.auto);
    return (
      (s.salary ? '' : '<div class="callout"><b>Start here.</b><span class="hint">Enter your salary and payday, then your fixed payments. Everything else can come later.</span></div>') +
      '<section class="card"><h2>Salary</h2><div class="form-grid">' +
      numInput('salary', 'settings.salary', s.salary || '', 'Monthly salary in hand (₹)') +
      numInput('payday', 'settings.payday', s.payday, 'Payday (day of month)', ' max="31"') +
      '<label class="field wide" for="plan-balance"><span>Money in your account this morning (₹)</span><input id="plan-balance" type="number" inputmode="numeric" min="0" step="1" data-balance="1" value="' +
        esc(state.balanceCheck && state.balanceCheck.date === today() ? state.balanceCheck.amount : '') + '" placeholder="' +
        (state.balanceCheck ? 'Last entered ' + fmtDate(state.balanceCheck.date) + ': ' + inr(state.balanceCheck.amount) : 'Optional') + '"></label>' +
      '</div><p class="hint">Starting in the middle of the month? Your balance lets the graph start from the right amount, since the app can’t see earlier spending.</p></section>' +

      '<section class="card"><div class="card-head"><h2>Fixed payments</h2><span class="hint">Rent, EMIs, bills, subscriptions</span></div>' +
      '<div class="edit-rows">' + state.fixed.map((f) =>
        '<div class="edit-row">' + listField('fixed', f, 'name', 'Name', 'text') + listField('fixed', f, 'amount', 'Amount (₹)', 'number') +
        listField('fixed', f, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('fixed', f) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="fixed">Add fixed payment</button></div>' +
      '<p class="hint">Credit cards and loans with a balance go in the Debts tab. Their minimum payments are counted automatically.</p></section>' +

      '<section class="card"><div class="card-head"><h2>Set aside each month</h2>' + modeChip(state.savings.auto) + '</div>' +
      '<div class="form-grid">' +
      numInput('emergency-monthly', 'savings.emergencyMonthly', sv.emergencyMonthly, 'Emergency fund (₹)') +
      numInput('debt-extra', 'savings.debtExtra', sv.debtExtra, 'Extra toward debts (₹)') +
      numInput('invest-monthly', 'savings.investMonthly', sv.investMonthly, 'Grow budget (₹)') +
      '</div>' +
      (state.savings.auto
        ? sv.notes.map((n) => '<p class="hint">' + esc(n) + '</p>').join('')
        : '<div class="row"><span class="hint">You set these amounts.</span><button class="ghost" data-action="savings-auto">Work them out for me</button></div>') +
      '<p class="hint">Taken out on payday. The Grow budget is money you plan to invest; talk to a SEBI-registered investment adviser about where. This app only helps you set the amount aside.</p></section>' +

      '<section class="card"><div class="card-head"><h2>Yearly costs</h2><span class="hint">Festivals, insurance, servicing, school fees</span></div>' +
      '<p class="hint">Costs you know are coming. Saving a little each month means they don’t become emergencies.</p>' +
      '<div class="edit-rows">' + state.sinking.map((f) =>
        '<div class="edit-row">' + listField('sinking', f, 'name', 'Name', 'text') + listField('sinking', f, 'amount', 'Per year (₹)', 'number') +
        '<label class="field" for="sinking-' + esc(f.id) + '-month"><span>Month</span><select id="sinking-' + esc(f.id) + '-month" data-list="sinking" data-id="' + esc(f.id) + '" data-field="month">' +
        MONTH_NAMES.map((m, i) => '<option value="' + (i + 1) + '"' + (Number(f.month) === i + 1 ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label>' +
        removeButton('sinking', f) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="sinking">Add yearly cost</button></div></section>' +

      '<section class="card"><div class="card-head"><h2>Flexible budgets</h2><span class="hint">' + inr(Math.max(0, alloc.pool)) + ' to spend this month</span></div>' +
      '<p class="hint">What is left of your salary is shared out across these automatically. Change any amount and the automatic ones adjust to fit.</p>' +
      '<div class="edit-rows">' + alloc.budgets.map((b) => {
        const item = state.budgets.find((x) => x.id === b.id);
        return '<div class="edit-row cols-2">' + listField('budgets', item, 'name', 'Category', 'text') +
          listField('budgets', Object.assign({}, item, { amount: b.amount }), 'amount', b.auto ? 'Auto · ' + b.share + '%' : 'Set by you', 'number', b.auto ? ' class="auto"' : '') +
          removeButton('budgets', item) + '</div>';
      }).join('') + '</div>' +
      (alloc.budgets.length && alloc.autoPool === 0 && alloc.budgets.some((b) => b.auto) && alloc.pool > 0
        ? '<p class="hint warn">Your own amounts use all of the money left, so the automatic budgets are at ₹0.</p>' : '') +
      '<div class="row"><button data-action="list-add" data-list="budgets">Add category</button>' +
      (edited ? '<button class="ghost" data-action="budgets-auto">Share everything out automatically</button>' : '') + '</div></section>' +

      '<section class="card" id="plan-summary">' + planSummary() + '</section>' +

      '<section class="card"><h2>Your data</h2>' +
      '<p class="hint">Everything is saved in this browser on this device only. Nothing is uploaded. Copy a backup if you want to move it to another device.</p>' +
      '<div class="row"><button data-action="backup">' + (ui.backup ? 'Hide backup' : 'Show backup') + '</button>' +
      '<button data-action="restore-toggle">Restore from backup</button>' +
      '<button data-action="load-demo">Load example data</button>' +
      '<button class="danger" data-action="wipe">Erase everything</button></div>' +
      (ui.confirmWipe ? '<div class="callout bad"><b>Erase all your data on this device?</b><span class="hint">This cannot be undone.</span><div class="row"><button class="danger" data-action="wipe-confirm">Yes, erase</button><button data-action="wipe-cancel">Cancel</button></div></div>' : '') +
      (ui.backup ? '<label class="field" for="backup-text">Backup (copy and keep it somewhere safe)<textarea id="backup-text" readonly>' + esc(ui.backup) + '</textarea></label><div><button data-action="backup-copy">Copy backup</button></div>' : '') +
      (ui.restoreOpen ? '<label class="field" for="restore-text">Paste a backup<textarea id="restore-text"></textarea></label>' +
        (ui.restoreError ? '<p class="bad">' + esc(ui.restoreError) + '</p>' : '') +
        '<div><button class="primary" data-action="restore">Restore</button></div>' : '') +
      '</section>'
    );
  }

  function modeChip(auto) {
    return '<span class="chip' + (auto ? ' chip-auto' : '') + '">' + (auto ? 'Automatic' : 'Set by you') + '</span>';
  }

  function minus(n) { return n ? '−' + inr(n) : inr(0); }

  function planSummary() {
    const p = Core.monthlyPlan(state, today());
    const line = (label, v, cls) => '<div class="line' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><span>' + v + '</span></div>';
    const left = p.unallocated;
    let html = '<div class="card-head"><h2>Where the salary goes</h2></div>' +
      '<div class="summary">' +
      line('Salary', inr(p.salary)) +
      line('Fixed payments', minus(p.fixedTotal)) +
      line('Debt minimums', minus(p.debtMin)) +
      line('Emergency fund', minus(p.emergency)) +
      line('Extra toward debts', minus(p.debtExtra)) +
      line('Grow budget', minus(p.invest)) +
      line('Yearly costs (monthly share)', minus(p.sinking)) +
      line('Flexible budgets', minus(p.flexTotal)) +
      line(left >= 0 ? 'Not yet assigned' : 'Over-planned by', '<span class="' + (left >= 0 ? 'good' : 'bad') + '">' + inr(Math.abs(left)) + '</span>', 'total') +
      '</div>';
    if (left < 0) html += '<p class="hint bad">Your plan uses more than your salary. Lower a flexible budget or the amounts set aside.</p>';
    return html;
  }

  // ---------- debts ----------

  function viewDebts() {
    const t = today();
    const debts = state.debts.filter((d) => Number(d.balance) > 0);
    const extra = Core.allocate(state).savings.debtExtra;
    let compare = '';
    if (debts.length) {
      const c = Core.compareDebtPlans(debts, extra);
      const card = (title, res, base, best) => {
        if (res.neverPaysOff) {
          return '<div class="plan-card"><span class="eyebrow">' + title + '</span><span class="big bad">Never paid off</span><span class="hint">A minimum payment is smaller than the monthly interest.</span></div>';
        }
        return '<div class="plan-card' + (best ? ' best' : '') + '"><span class="eyebrow">' + title + '</span>' +
          '<span class="big">' + monthYear(Core.addMonths(t, res.months)) + '</span>' +
          '<span class="hint">' + plural(res.months, 'month') + ' · ' + inr(res.totalInterest) + ' interest</span>' +
          (base && !base.neverPaysOff && base.totalInterest > res.totalInterest ? '<span class="good">Saves ' + inr(base.totalInterest - res.totalInterest) + '</span>' : '') +
          (res.order.length > 1 ? '<ol>' + res.order.map((o) => '<li>' + esc(o.name) + ' cleared in month ' + o.month + '</li>').join('') + '</ol>' : '') +
          '</div>';
      };
      const bestKey = c.avalanche.totalInterest <= c.snowball.totalInterest ? 'avalanche' : 'snowball';
      compare =
        '<section class="card"><h2>When will you be debt-free?</h2>' +
        '<div class="form-grid">' + numInput('debt-extra-2', 'savings.debtExtra', extra, 'Extra per month on top of minimums (₹)') + '</div>' +
        '<div class="plans">' +
        card('Minimums only', c.minimum, null, false) +
        (extra > 0
          ? card('Highest interest first', c.avalanche, c.minimum, bestKey === 'avalanche') + card('Smallest balance first', c.snowball, c.minimum, bestKey === 'snowball' && c.snowball.totalInterest < c.avalanche.totalInterest)
          : '<div class="plan-card"><span class="eyebrow">With an extra payment</span><span class="hint">Add an extra amount above to see how much sooner you could finish and how much interest you would save.</span></div>') +
        '</div>' +
        '<p class="hint"><b>Highest interest first</b> pays the least interest. <b>Smallest balance first</b> clears a loan sooner, which many people find motivating. When a loan is cleared, its payment moves to the next one.</p>' +
        '</section>';
    }

    return (
      '<section class="card"><div class="card-head"><h2>Loans and credit cards</h2><span class="hint">Update balances from each statement</span></div>' +
      (state.debts.length ? '' : '<p class="hint">No debts added. If you have a credit card balance or a loan, add it to see what it costs.</p>') +
      '<div class="edit-rows">' + state.debts.map((d) =>
        '<div class="edit-row cols-debt">' + listField('debts', d, 'name', 'Name', 'text') + listField('debts', d, 'balance', 'Balance (₹)', 'number') +
        listField('debts', d, 'rate', 'Interest %/yr', 'number') + listField('debts', d, 'minPayment', 'Monthly min (₹)', 'number') +
        listField('debts', d, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('debts', d) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="debts">Add loan or card</button></div>' +
      (debts.length ? '<div class="list">' + debts.map((d) => {
        const i = (d.balance * d.rate) / 1200;
        return '<div class="list-item"><div class="grow"><div class="title">' + esc(d.name) + '</div><div class="meta">' + d.rate + '% a year</div></div>' +
          '<div class="amt ' + (d.rate >= 15 ? 'bad' : '') + '">' + inr(i) + ' interest/month</div></div>';
      }).join('') + '</div>' : '') +
      '<p class="hint">Credit cards usually charge 36–45% a year on unpaid balances. Paying only the minimum keeps most of that cost running.</p>' +
      '</section>' + compare
    );
  }

  // ---------- grow & safety ----------

  function viewGrow() {
    const t = today();
    const sv = state.savings;
    const p = Core.monthlyPlan(state, t);
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    const recorded = state.savingsRecorded.indexOf(cyc.start) !== -1;
    const needs = p.fixedTotal + p.debtMin + Core.monthlyPlan(Object.assign({}, state, { adjustment: null }), t).flexTotal;
    const target = (Number(sv.emergencyTargetMonths) || 3) * needs;
    const fundPct = target > 0 ? Math.min(100, (sv.emergencyBalance / target) * 100) : 0;
    const monthsToTarget = sv.emergencyBalance >= target ? 0 : p.emergency > 0 ? Math.ceil((target - sv.emergencyBalance) / p.emergency) : null;
    // A full fund can take years; one month of needs is the first milestone.
    const starter = needs;
    const monthsToStarter = sv.emergencyBalance >= starter ? 0 : p.emergency > 0 ? Math.ceil((starter - sv.emergencyBalance) / p.emergency) : null;
    let fundNote;
    if (monthsToTarget === 0) fundNote = 'Target reached.';
    else if (monthsToStarter) fundNote = '<b>First milestone: one month of needs (' + inr(starter) + ')</b>. At ' + inr(p.emergency) + ' a month you get there in ' + plural(monthsToStarter, 'month') + '. Clearing expensive debt first speeds up the rest.';
    else if (monthsToTarget) fundNote = 'One month of needs is covered. At ' + inr(p.emergency) + ' a month you reach the full target in ' + plural(monthsToTarget, 'month') + '.';
    else fundNote = 'Set a monthly amount in the Plan tab to start building it.';

    const setAside = [
      ['Emergency fund', p.emergency], ['Extra toward debts', p.debtExtra], ['Grow budget', p.invest], ['Yearly costs', p.sinking],
    ].filter((x) => x[1] > 0);

    return (
      '<section class="card"><div class="card-head"><h2>This month’s set-aside</h2><span class="hint">Cycle starting ' + fmtDate(cyc.start) + '</span></div>' +
      (setAside.length
        ? '<div class="summary">' + setAside.map((x) => '<div class="line"><span>' + x[0] + '</span><span>' + inr(x[1]) + '</span></div>').join('') + '</div>' +
          (recorded
            ? '<p class="good">Recorded for this cycle. Your balances below include it.</p>'
            : '<div><button class="primary" data-action="record-savings">I’ve moved this money aside</button></div>')
        : '<p class="hint">Nothing set aside yet. Add amounts in the Plan tab.</p>') +
      '</section>' +

      '<section class="card"><div class="card-head"><h2>Emergency fund</h2><span class="hint">Your buffer against the next surprise</span></div>' +
      '<div class="form-grid">' + numInput('emergency-balance', 'savings.emergencyBalance', sv.emergencyBalance, 'Saved so far (₹)') +
      '<label class="field" for="emergency-target"><span>Target</span><select id="emergency-target" data-bind="savings.emergencyTargetMonths">' +
      [3, 6].map((m) => '<option value="' + m + '"' + (Number(sv.emergencyTargetMonths) === m ? ' selected' : '') + '>' + m + ' months</option>').join('') + '</select></label></div>' +
      '<div class="bar-row"><div class="bar-top"><span>' + inr(sv.emergencyBalance) + ' of ' + inr(target) + '</span><span class="amt">' + Math.round(fundPct) + '%</span></div>' +
      '<div class="bar"><span style="width:' + fundPct.toFixed(1) + '%"></span></div></div>' +
      '<p class="hint">' + fundNote + ' Keep this money somewhere you can reach within a day.</p></section>' +

      (state.sinking.length
        ? '<section class="card"><h2>Yearly costs</h2><div class="bars">' + state.sinking.map((f) => {
          const saved = Number(f.saved) || 0;
          const pct = f.amount > 0 ? Math.min(100, (saved / f.amount) * 100) : 0;
          return '<div class="bar-row"><div class="bar-top"><span>' + esc(f.name) + ' · ' + MONTH_NAMES[(Number(f.month) || 1) - 1] + '</span><span class="amt">' + inr(saved) + ' of ' + inr(f.amount) + '</span></div>' +
            '<div class="bar"><span class="marigold" style="width:' + pct.toFixed(1) + '%"></span></div></div>';
        }).join('') + '</div></section>'
        : '') +

      viewEmergency() +

      '<section class="card"><div class="card-head"><h2>Grow</h2><span class="hint">Money set aside to invest</span></div>' +
      '<div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
      tile('Set aside so far', inr(sv.investSaved), 'From your Grow budget') +
      tile('Each month', inr(p.invest), p.invest ? 'Grow budget' : 'Not started yet') + '</div>' +
      '<div class="callout"><b>Ready to invest this money?</b>' +
      '<span>Talk to a <b>SEBI-registered investment adviser</b> before investing. They can look at your goals and suggest options that suit you. All investments carry risk, and the decision is yours.</span>' +
      '<span class="hint">Check that an adviser is registered on SEBI’s website: <a href="https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&amp;intmId=13" target="_blank" rel="noopener">sebi.gov.in → Intermediaries → Investment Advisers</a>. Salary Runway doesn’t recommend any adviser, product, bank or fund, and earns nothing from them.</span></div>' +
      '</section>' +

      '<section class="card"><h2>Learn the basics</h2>' + LESSONS.map((l) =>
        '<details class="lesson"><summary>' + l[0] + '</summary><p>' + l[1] + '</p></details>').join('') + '</section>'
    );
  }

  const LESSONS = [
    ['Why an emergency fund comes first', 'Most debt cycles start with one surprise bill paid by credit card. A few months of needs kept aside turns a medical bill or a car repair into an inconvenience instead of a new loan.'],
    ['How credit card interest works', 'If you pay less than the full bill, interest (often 3–3.5% a month, or 36–45% a year) is charged on the whole balance, and new purchases may lose their interest-free days. On ₹85,000, that is about ₹3,000 a month for nothing.'],
    ['The minimum payment trap', 'The minimum due is set so the card stays current, not so you get out of debt. Paying only the minimum can take years and cost more in interest than the original purchases.'],
    ['What inflation does to savings', 'Prices rise every year. Money that sits in a savings account earning less than inflation buys a little less each year. That is why people invest money they won’t need for several years.'],
    ['Compounding, for and against you', 'Interest earned on interest makes savings grow faster over time. The same maths works against you on debt: unpaid interest is added to what you owe, and then charged interest too.'],
    ['Questions to ask an adviser', 'Are you SEBI-registered, and what is your registration number? How are you paid: a fee from me, or commission from products? What could I lose in a bad year? When can I take my money out, and what does that cost?'],
    ['Spotting an investment scam', 'Be careful with guaranteed high returns, pressure to decide today, tips on WhatsApp or Telegram groups, requests to send money to a personal account, or anyone who isn’t registered and won’t share a registration number.'],
  ];

  function viewEmergency() {
    const t = today();
    const e = ui.emergency;
    const adj = state.adjustment && t < state.adjustment.until ? state.adjustment : null;
    let html = '<section class="card"><div class="card-head"><h2>Something unexpected happened?</h2></div>';
    if (adj) {
      html += '<div class="callout warn"><b>Recovery plan active until ' + fmtDate(adj.until, true) + ' (' + esc(adj.reason) + ')</b>' +
        '<span class="hint">Flexible budgets −' + adj.flexCutPct + '%' + (adj.pauseInvest ? ', Grow paused' : '') + (adj.pauseDebtExtra ? ', extra debt payments paused' : '') + '.</span>' +
        '<div><button data-action="adjust-end">End recovery plan now</button></div></div>';
    }
    html += '<p class="hint">Medical bills, a car repair, a family function or a tax bill. Enter the cost and see how to absorb it without new debt.</p>' +
      '<div class="form-grid">' +
      '<label class="field" for="em-type"><span>What happened</span><select id="em-type" data-em="type">' +
      EMERGENCY_TYPES.map((x) => '<option' + (x === e.type ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
      '<label class="field" for="em-amount"><span>Cost (₹)</span><input id="em-amount" type="number" inputmode="numeric" min="0" data-em="amount" value="' + esc(e.amount) + '" placeholder="25000"></label>' +
      '<label class="field wide" for="em-cut"><span>Cut flexible budgets by <b id="em-cut-label">' + e.cut + '%</b> while recovering</span><input id="em-cut" type="range" min="0" max="50" step="5" data-em="cut" value="' + e.cut + '"></label>' +
      '</div><div id="em-preview">' + emergencyPreview() + '</div></section>';
    return html;
  }

  function emergencyPreview() {
    const e = ui.emergency;
    const amount = Number(e.amount) || 0;
    if (amount <= 0) return '';
    const t = today();
    const p = Core.emergencyPlan(state, amount, Number(e.cut), t);
    const steps = [];
    if (p.fromFund > 0) steps.push('Use <b>' + inr(p.fromFund) + '</b> from your emergency fund.');
    if (p.shortfall > 0) {
      steps.push('The remaining <b>' + inr(p.shortfall) + '</b> comes out of this month’s money. The runway graph will show the effect.');
      const freed = [];
      if (p.pausedInvest) freed.push('pause the Grow budget (' + inr(p.pausedInvest) + ')');
      if (p.pausedDebtExtra) freed.push('pause extra debt payments (' + inr(p.pausedDebtExtra) + ')');
      if (p.flexCut) freed.push('spend ' + inr(p.flexCut) + ' less on flexible budgets');
      if (freed.length) steps.push('Each month, ' + freed.join(', ') + '. That frees <b>' + inr(p.freed) + '</b> a month.');
      steps.push('Keep paying all EMIs and card minimums. Missing them adds penalties and hurts your credit score.');
    }
    let outcome;
    if (p.shortfall > 0 && !isFinite(p.recoverMonths)) {
      outcome = '<div class="callout bad"><b>Nothing is freed up yet.</b><span class="hint">Raise the budget cut or add a Grow or extra debt amount in the Plan tab to see a recovery date.</span></div>';
    } else {
      outcome = '<div class="callout good"><b>' +
        (p.shortfall > 0 ? 'Back on your normal plan by ' + fmtDate(p.backOnTrack, true) : 'Your emergency fund covers it.') + '</b>' +
        (p.fromFund > 0 ? '<span class="hint">' + (isFinite(p.refillMonths) ? 'Emergency fund refilled by ' + fmtDate(p.fundRefilled, true) + ' at your usual monthly amount.' : 'Set an emergency fund amount in the Plan tab to refill it.') + '</span>' : '') +
        '</div>';
    }
    return '<ol class="stack" style="padding-left:20px;margin:0">' + steps.map((s) => '<li>' + s + '</li>').join('') + '</ol>' + outcome +
      '<div><button class="primary" data-action="em-apply">Apply this plan</button></div>';
  }

  function applyEmergency() {
    const t = today();
    const e = ui.emergency;
    const amount = Number(e.amount) || 0;
    if (amount <= 0) return;
    const p = Core.emergencyPlan(state, amount, Number(e.cut), t);
    state.savings.emergencyBalance = Math.max(0, (Number(state.savings.emergencyBalance) || 0) - p.fromFund);
    if (p.shortfall > 0) {
      state.transactions.push({ id: uid(), date: t, amount: p.shortfall, category: 'Emergency', note: e.type, source: 'manual' });
      if (isFinite(p.recoverMonths)) {
        state.adjustment = {
          until: Core.addMonths(t, p.recoverMonths),
          flexCutPct: Number(e.cut),
          pauseInvest: p.pausedInvest > 0,
          pauseDebtExtra: p.pausedDebtExtra > 0,
          reason: e.type,
        };
      }
    }
    state.emergencies.push({ id: uid(), date: t, type: e.type, amount, fromFund: p.fromFund, shortfall: p.shortfall });
    ui.emergency = { type: 'Medical', amount: '', cut: 20 };
    save();
    toast('Recovery plan applied');
    setTab('home');
  }

  // ---------- events ----------

  function setPath(path, value) {
    const [a, b] = path.split('.');
    state[a][b] = value;
  }

  function listDefaults(list) {
    switch (list) {
      case 'fixed': return { id: uid(), name: '', amount: 0, dueDay: 1 };
      case 'debts': return { id: uid(), name: '', balance: 0, rate: 0, minPayment: 0, dueDay: 1 };
      case 'sinking': return { id: uid(), name: '', amount: 0, month: 1, saved: 0 };
      default: return { id: uid(), name: '', amount: 0, auto: true };
    }
  }

  function refreshAfterEdit() {
    const y = window.scrollY;
    const active = document.activeElement && document.activeElement.id;
    render();
    window.scrollTo(0, y);
    const el = active && document.getElementById(active);
    if (el) el.focus();
  }

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    const t = today();
    switch (a) {
      case 'tab': setTab(btn.dataset.tab); return;
      case 'start-own':
        state = emptyState(); save(); setTab('plan'); toast('Example data cleared. Add your salary to begin.'); return;
      case 'load-demo':
        state = Demo.demoState(t); save(); setTab('home'); return;
      case 'wipe': ui.confirmWipe = true; break;
      case 'wipe-cancel': ui.confirmWipe = false; break;
      case 'wipe-confirm':
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        state = emptyState(); ui.confirmWipe = false; ui.backup = null; save(); toast('All data erased'); break;
      case 'backup': ui.backup = ui.backup ? null : JSON.stringify(state); break;
      case 'backup-copy': {
        const area = document.getElementById('backup-text');
        const done = () => toast('Backup copied');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ui.backup).then(done, () => { area.select(); toast('Press copy to finish'); });
        } else { area.select(); }
        return;
      }
      case 'restore-toggle': ui.restoreOpen = !ui.restoreOpen; ui.restoreError = ''; break;
      case 'restore': {
        const text = document.getElementById('restore-text').value;
        try {
          const parsed = JSON.parse(text);
          if (!parsed || !parsed.settings || !Array.isArray(parsed.transactions)) throw new Error('shape');
          state = migrate(Object.assign(emptyState(), parsed));
          ui.restoreOpen = false; ui.restoreError = '';
          save(); toast('Backup restored');
        } catch (e) {
          ui.restoreError = 'That doesn’t look like a Salary Runway backup. Paste the full text from “Show backup”.';
        }
        break;
      }
      case 'budgets-auto': state.budgets.forEach((b) => { b.auto = true; }); save(); toast('Budgets shared out automatically'); break;
      case 'savings-auto': state.savings.auto = true; save(); toast('Set-asides worked out from your numbers'); break;
      case 'list-add': state[btn.dataset.list].push(listDefaults(btn.dataset.list)); save(); break;
      case 'list-remove':
        state[btn.dataset.list] = state[btn.dataset.list].filter((x) => x.id !== btn.dataset.id); save(); break;
      case 'tx-filter': ui.txFilter = btn.dataset.filter; break;
      case 'tx-delete': state.transactions = state.transactions.filter((x) => x.id !== btn.dataset.id); save(); toast('Payment deleted'); break;
      case 'sms-sample':
        ui.smsText = SAMPLE_SMS.replace(/\{d1\}/g, fmtSmsDate(Core.addDays(t, -1))).replace(/\{d2\}/g, fmtSmsDate(t));
        ui.smsRows = null; break;
      case 'sms-read': ui.smsText = document.getElementById('sms-text').value; readSms(); break;
      case 'sms-clear': ui.smsText = ''; ui.smsRows = null; markSmsSeen(); save(); break;
      case 'sms-native': readNativeSms(false); break;
      case 'sms-import': {
        let added = 0;
        ui.smsRows.forEach((r) => {
          if (!r.checked || !r.parsed || r.parsed.type !== 'debit') return;
          state.transactions.push({ id: uid(), date: r.parsed.date, amount: r.parsed.amount, category: r.parsed.category, note: r.parsed.merchant, source: 'sms' });
          const key = Core.normalizeMerchant(r.parsed.merchant);
          if (key && r.parsed.merchant !== 'Bank payment') state.merchantRules[key] = r.parsed.category;
          added++;
        });
        ui.smsRows = null; ui.smsText = ''; markSmsSeen(); save(); toast(plural(added, 'payment') + ' added'); break;
      }
      case 'record-savings': {
        const p = Core.monthlyPlan(state, t);
        const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
        state.savings.emergencyBalance = (Number(state.savings.emergencyBalance) || 0) + p.emergency;
        state.savings.investSaved = (Number(state.savings.investSaved) || 0) + p.invest;
        state.sinking.forEach((f) => { f.saved = (Number(f.saved) || 0) + Core.sinkingMonthly(f); });
        state.savingsRecorded.push(cyc.start);
        save(); toast('Savings recorded'); break;
      }
      case 'em-apply': applyEmergency(); return;
      case 'balance-open': ui.balanceOpen = true; break;
      case 'balance-skip':
        if (!ui.balanceOpen) { state.balancePromptSkipped = Core.cycleFor(t, Number(state.settings.payday) || 1).start; save(); }
        ui.balanceOpen = false; break;
      case 'adjust-end': state.adjustment = null; save(); toast('Back to your normal plan'); break;
      default: return;
    }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });

  function fmtSmsDate(iso) {
    const [y, m, d] = iso.split('-');
    return d + '-' + m + '-' + y.slice(2);
  }

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.balance) {
      if (el.value === '') return;
      setBalance(el.value); toast('Balance saved'); return;
    }
    if (el.dataset.bind) {
      const v = Number(el.value);
      let val = isFinite(v) && v >= 0 ? v : 0;
      if (el.dataset.bind === 'settings.payday') val = Math.min(31, Math.max(1, Math.round(val) || 1));
      if (state.savings.auto && /^savings\.(emergencyMonthly|investMonthly|debtExtra)$/.test(el.dataset.bind)) {
        // Keep the other two at their worked-out amounts.
        const sv = Core.allocate(state).savings;
        state.savings.emergencyMonthly = sv.emergencyMonthly;
        state.savings.investMonthly = sv.investMonthly;
        state.savings.debtExtra = sv.debtExtra;
        state.savings.auto = false;
      }
      setPath(el.dataset.bind, val);
      save(); refreshAfterEdit(); return;
    }
    if (el.dataset.list) {
      const item = state[el.dataset.list].find((x) => x.id === el.dataset.id);
      if (!item) return;
      const f = el.dataset.field;
      if (f === 'name') item.name = el.value.trim();
      else {
        let v = Math.max(0, Number(el.value) || 0);
        if (f === 'dueDay') v = Math.min(31, Math.max(1, Math.round(v) || 1));
        item[f] = v;
        if (el.dataset.list === 'budgets' && f === 'amount') item.auto = false;
      }
      save(); refreshAfterEdit(); return;
    }
    if (el.dataset.txCat) {
      const tx = state.transactions.find((x) => x.id === el.dataset.txCat);
      if (!tx) return;
      tx.category = el.value;
      const key = Core.normalizeMerchant(tx.note);
      if (key) state.merchantRules[key] = el.value;
      save(); toast('Saved. ' + (key ? 'Future payments to ' + tx.note + ' will go to ' + el.value + '.' : '')); return;
    }
    if (el.dataset.smsCheck !== undefined) { ui.smsRows[Number(el.dataset.smsCheck)].checked = el.checked; rerenderKeepScroll(); return; }
    if (el.dataset.smsCat !== undefined) { ui.smsRows[Number(el.dataset.smsCat)].parsed.category = el.value; return; }
    if (el.dataset.em === 'type') { ui.emergency.type = el.value; }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'sms-text') { ui.smsText = el.value; return; }
    if (el.dataset.em === 'amount' || el.dataset.em === 'cut') {
      ui.emergency[el.dataset.em] = el.value;
      const label = document.getElementById('em-cut-label');
      if (label) label.textContent = ui.emergency.cut + '%';
      const preview = document.getElementById('em-preview');
      if (preview) preview.innerHTML = emergencyPreview();
    }
  });

  function setBalance(value) {
    state.balanceCheck = { date: today(), amount: Math.max(0, Math.round(Number(value) || 0)) };
    save();
  }

  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'balance-form') {
      ev.preventDefault();
      setBalance(document.getElementById('balance-amount').value);
      ui.balanceOpen = false;
      toast('Balance saved');
      rerenderKeepScroll();
      return;
    }
    if (ev.target.id !== 'add-tx') return;
    ev.preventDefault();
    const amount = Math.round(Number(document.getElementById('tx-amount').value) || 0);
    if (amount <= 0) return;
    const note = document.getElementById('tx-note').value.trim();
    let category = document.getElementById('tx-category').value;
    state.transactions.push({
      id: uid(),
      date: document.getElementById('tx-date').value || today(),
      amount, category, note, source: 'manual',
    });
    save();
    toast(inr(amount) + ' added to ' + category);
    rerenderKeepScroll();
  });

  function rerenderKeepScroll() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (tab === 'home') drawRunway(); }, 150);
  });

  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace('#', '');
    if (h !== tab && TABS.indexOf(h) !== -1) setTab(h);
  });

  // ---------- start ----------

  // ---------- SMS inbox (Android app only) ----------

  function markSmsSeen() {
    if (ui.smsMaxDate > (state.smsReadUntil || 0)) state.smsReadUntil = ui.smsMaxDate;
    ui.smsMaxDate = 0;
  }

  /*
   * Reads messages newer than the last review. Bank and UPI alerts come from
   * named senders (VM-HDFCBK, JD-SBIUPI), so messages from phone numbers are
   * skipped. `quiet` is the check on opening the app: no messages, no fuss.
   */
  function readNativeSms(quiet) {
    if (!SmsInbox || ui.smsBusy) return;
    ui.smsBusy = true;
    if (!quiet) rerenderKeepScroll();
    const since = state.smsReadUntil || Date.now() - SMS_FIRST_READ_DAYS * 86400000;
    SmsInbox.read({ since, limit: 500 }).then((res) => {
      const msgs = (res.messages || []).filter((m) => /[A-Za-z]/.test(m.address || ''));
      ui.smsMaxDate = (res.messages || []).reduce((mx, m) => Math.max(mx, m.date), since);
      const rows = smsRows(msgs.map((m) => ({ text: m.body || '', day: Core.toISO(new Date(m.date)) })))
        .filter((r) => r.parsed && r.parsed.type === 'debit' && !r.duplicate);
      state.smsAuto = true;
      ui.smsBusy = false;
      if (rows.length) {
        ui.smsRows = rows;
        if (quiet) toast(plural(rows.length, 'new bank payment') + ' to review in Spend');
      } else {
        ui.smsRows = null;
        markSmsSeen();
        if (!quiet) toast('No new bank payments found');
      }
      save();
      rerenderKeepScroll();
    }, (err) => {
      ui.smsBusy = false;
      if (err && err.code === 'PERMISSION_DENIED') state.smsAuto = false;
      save();
      if (!quiet) toast(err && err.code === 'PERMISSION_DENIED' ? 'SMS permission is off. You can turn it on in Android settings.' : 'Couldn’t read messages');
      rerenderKeepScroll();
    });
  }

  if (NATIVE) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.smsAuto && !ui.smsRows) readNativeSms(true);
    });
  }

  state = load();
  if (NATIVE && state.smsAuto) readNativeSms(true);
  const fromHash = (location.hash || '').replace('#', '');
  tab = TABS.indexOf(fromHash) !== -1 ? fromHash : 'home';
  render();
})();
