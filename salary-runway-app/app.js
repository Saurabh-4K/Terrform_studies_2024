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
  const INCOME_CATEGORIES = ['Money received', 'Money returned', 'From family', 'Refund', 'Cashback', 'Side income', 'Gift'];
  const INCOME_USE_LABELS = {
    spend: 'Kept for this month',
    emergency: 'Added to emergency fund',
    grow: 'Set aside to invest',
    debt: 'Used to pay off a loan',
  };
  const MOVE_LABELS = {
    emergency: 'moved to your emergency fund',
    grow: 'set aside to invest',
    debt: 'paid off your loan',
  };
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
  const SpendWidget = NATIVE ? window.Capacitor.registerPlugin('SpendWidget') : null;
  const Haptics = NATIVE ? window.Capacitor.registerPlugin('Haptics') : null;

  // A light tap on the phone. Never allowed to break anything.
  function haptic() {
    try {
      if (Haptics) Promise.resolve().then(() => Haptics.impact({ style: 'LIGHT' })).catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(12);
    } catch (e) { /* no vibration available */ }
  }

  // Positive feedback for moving money to safety, with honest numbers.
  function celebrate(msg) {
    haptic();
    toast(msg, 'good');
  }

  /*
   * What a move to safety buys, in true numbers: days of freedom for the
   * emergency fund, interest saved a year for a loan.
   */
  function rewardMessage(use, amount, debtId, daily) {
    if (use === 'emergency') {
      const before = Core.freedomDays(state, today());
      // The move has already been applied: compare with the fund before it.
      const now = before ? before.days : 0;
      const was = before ? Math.floor((before.fund - amount) / before.daily) : 0;
      return now > was
        ? 'Nice move! +' + plural(now - was, 'day') + ' of freedom (' + now + ' now).'
        : 'Nice move! ' + inr(amount) + ' closer to your next day of freedom.';
    }
    if (use === 'debt') {
      const d = state.debts.find((x) => x.id === debtId);
      const saved = d ? (amount * (Number(d.rate) || 0)) / 100 : 0;
      return 'Nice move! Saves about ' + inr(saved) + ' in interest a year.' + (daily ? ' Do this daily and it’s ' + inr(amount * 30) + ' a month.' : '');
    }
    if (use === 'grow') return 'Nice move! ' + inr(amount) + ' set aside to invest.';
    return INCOME_USE_LABELS[use] || 'Saved';
  }

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
    txKind: 'out',
    payBill: null,
    cardForm: null,
    cardPlan: null,
    cardRemove: null,
    paydayOpen: false,
    smsBusy: false,
    smsClean: null,
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
      bills: [],
      days: {},
      cards: [],
      payslips: {},
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

  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : many || word + 's'); }

  function categories() {
    const names = state.budgets.map((b) => b.name).filter(Boolean);
    ['Bills', 'Misc', 'Emergency'].forEach((n) => { if (names.indexOf(n) === -1) names.push(n); });
    return names;
  }

  function incomeCategoryOptions(selected) {
    const list = INCOME_CATEGORIES.slice();
    if (selected && list.indexOf(selected) === -1) list.push(selected);
    return list.map((c) => '<option' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  }

  function categoryOptions(selected) {
    const list = categories();
    if (selected && list.indexOf(selected) === -1) list.push(selected);
    return list.map((c) => '<option' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  }

  function toast(msg, kind) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
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
    syncWidget();
    syncAlerts();
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
    const z = Core.zoneStatus(state, t, r);
    recordToday(r);
    const streak = withinStreak();
    let headline, sub;
    if (z.zone === 'red') {
      headline = 'Red zone: <span class="date bad">' + inr(z.shortBy) + ' short</span> for bills and basics';
      sub = 'The money left doesn’t cover the bills still to pay and groceries and health until ' + fmtDate(cyc.next) + '. Here’s how to stay above ₹0:';
    } else if (z.zone === 'amber') {
      headline = 'Careful: at this pace, money runs out on <span class="date warn">' + fmtDate(r.zeroPace || Core.addDays(cyc.next, -1)) + '</span>';
      sub = 'You’re spending about ' + inr(r.paceRate) + ' a day. Keep to <b>' + inr(z.safeDaily) + ' a day</b> until payday and you’ll stay out of the red.';
    } else {
      headline = 'You’re in the green';
      sub = 'At this pace you reach payday on ' + fmtDate(cyc.next) + ' with about <b>' + inr(r.endPace) + '</b> left.' +
        (streak >= 2 ? ' ' + plural(streak, 'day') + ' in a row within your daily amount. Keep it going.' : '') +
        (Core.cardFreeDays(state, t) >= 3 ? ' ' + plural(Core.cardFreeDays(state, t), 'card-free day') + '.' : '');
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
      paydayCard() +
      '<section class="hero">' +
      '<p class="eyebrow">Salary cycle · ' + fmtDate(cyc.start) + ' – ' + fmtDate(lastDay) + ' · day ' + (r.idxToday + 1) + ' of ' + cyc.days + '</p>' +
      zoneMeter(z.zone) +
      '<h1>' + headline + '</h1><p class="sub">' + sub + '</p>' +
      (z.zone === 'red' ? redOptions(z, r) : '') +
      '<div class="chart-wrap"><div id="runway-chart" role="img" aria-label="Balance through this salary cycle"></div>' +
      '<div class="legend"><span><i></i>Balance so far</span><span><i class="pace"></i>If you keep this pace</span><span><i class="plan"></i>If you keep to budget</span>' +
      '<span><i class="red-band"></i>Red zone: bills and basics still to pay</span><span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="c-event"/></svg>Bill or EMI</span></div></div>' +
      '</section>' +
      savedCard() +
      cardHomeNotes(cyc) +
      (askBalance || ui.balanceOpen ? balanceForm(askBalance && !ui.balanceOpen) : '') +
      (needsCheck().length
        ? '<div class="callout warn"><b>' + plural(needsCheck().length, 'payment') + ' from SMS ' + (needsCheck().length === 1 ? 'needs' : 'need') + ' a quick check</b>' +
          '<span class="hint">Make sure ' + (needsCheck().length === 1 ? 'it’s' : 'they’re') + ' in the right category.</span>' +
          '<div><button class="primary" data-action="tab" data-tab="spend">Check now</button></div></div>'
        : '') +
      incomeCard() +
      (adj ? '<div class="callout warn"><b>Recovery plan active until ' + fmtDate(adj.until, true) + '.</b><span class="hint">' +
        [adj.flexCutPct ? 'Flexible budgets are ' + adj.flexCutPct + '% lower' : '', adj.pauseInvest ? 'the Grow budget is paused' : '', adj.pauseDebtExtra ? 'extra debt payments are paused' : '']
          .filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) + '.</span></div>' : '') +
      '<section class="tiles">' +
      tile('Left to spend today', inr(r.leftToday),
        r.overToday > 0
          ? inr(r.overToday) + ' over today’s ' + inr(r.dailyAllowance) + '. Tomorrow: ' + inr(r.tomorrowAllowance)
          : r.spentToday ? 'Spent ' + inr(r.spentToday) + ' of ' + inr(r.dailyAllowance) + ' today' : 'Today’s share of your budget', true) +
      tile('Balance now', inr(r.balanceToday),
        (r.anchor ? 'From your balance on ' + fmtDate(r.anchor.date) : 'Worked out from your plan') +
        ' · <button class="link" data-action="balance-open">Update</button>') +
      tile('Next salary', plural(daysToPay, 'day'), fmtDate(cyc.next)) +
      tile('Flexible spending', inr(flexSpent), 'of ' + inr(Math.round((r.plan.flexTotal * share) / 10) * 10) + ' budget' + (r.extraIn ? ' + ' + inr(r.extraIn) + ' received' : '') + (r.anchor ? ' since ' + fmtDate(r.anchor.date) : '')) +
      '</section>' +
      paydayPreviewCard() +
      '<section class="card"><div class="card-head"><h2>' + (r.anchor && r.anchorIdx > 0 ? 'You can spend until payday' : 'You can spend this cycle') + '</h2><button class="ghost" data-action="tab" data-tab="plan">Adjust</button></div>' +
      '<div class="bars">' + bars.join('') + '</div></section>' +
      billsCard() +
      '<section class="card"><div class="card-head"><h2>Coming up before payday</h2><span class="hint">' + inr(upcoming.reduce((s, e) => s + e.amount, 0)) + '</span></div>' +
      (upcoming.length
        ? '<div class="list">' + upcoming.map((e) =>
          '<div class="list-item"><div class="date-badge"><b>' + Core.parseISO(e.date).getDate() + '</b>' + MONTH_NAMES[Core.parseISO(e.date).getMonth()] + '</div>' +
          '<div class="grow"><div class="title">' + esc(e.name) + '</div><div class="meta">' + (e.kind === 'debt' ? 'Minimum payment' : e.kind === 'bill' ? 'Estimate · amount varies' : 'Fixed payment') + '</div></div>' +
          '<div class="amt">' + inr(e.amount) + '</div></div>').join('') + '</div>'
        : '<p class="hint">No more fixed payments this cycle.</p>') +
      '</section>' +
      '<section class="card"><h2>What your spending says</h2><div>' +
      ins.map((i) => '<div class="insight lvl-' + i.level + '"><div><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p></div></div>').join('') +
      '</div></section>'
    );
  }

  const BILL_PERIODS = [1, 2, 3, 6, 12];

  function periodOptions(selected) {
    return BILL_PERIODS.map((m) => '<option value="' + m + '"' + (Number(selected) === m ? ' selected' : '') + '>' +
      (m === 1 ? '1 month' : m + ' months') + '</option>').join('');
  }

  /*
   * Bills that vary and are due before payday, with a "Paid" form, plus bill
   * payments from SMS that aren't linked to a bill yet.
   */
  function billsCard() {
    const t = today();
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    const bills = state.bills || [];
    const due = bills.filter((b) => Core.billDue(b, cyc) && !Core.billPaidIn(state, b, cyc));
    const unlinked = bills.length
      ? state.transactions.filter((x) => Core.isFlexible(x) && x.category === 'Bills' && Core.inCycle(x.date, cyc))
      : [];
    if (!due.length && !unlinked.length) return '';
    const rows = due.map((b) => {
      const late = b.nextDue < t;
      let html = '<div class="bill-item"><div class="check-top"><div class="grow"><div class="title">' + esc(b.name) + '</div>' +
        '<div class="meta' + (late ? ' bad' : '') + '">' + (late ? 'Was due ' : 'Due ') + fmtDate(b.nextDue) + ' · about ' + inr(b.estimate) +
        (b.everyMonths > 1 ? ' for ' + b.everyMonths + ' months' : '') + '</div></div>';
      if (ui.payBill === b.id) {
        html += '</div><div class="form-grid">' +
          '<label class="field" for="bill-amt-' + esc(b.id) + '"><span>Amount paid (₹)</span><input id="bill-amt-' + esc(b.id) + '" type="number" inputmode="numeric" min="1" value="' + esc(b.estimate) + '"></label>' +
          '<label class="field" for="bill-months-' + esc(b.id) + '"><span>Covers</span><select id="bill-months-' + esc(b.id) + '">' + periodOptions(b.everyMonths) + '</select></label>' +
          '</div><div class="row"><button class="primary" data-action="bill-pay-save" data-id="' + esc(b.id) + '">Save payment</button>' +
          '<button class="ghost" data-action="bill-pay-cancel">Cancel</button></div></div>';
      } else {
        html += '<button data-action="bill-pay-open" data-id="' + esc(b.id) + '">Paid</button></div></div>';
      }
      return html;
    });
    const links = unlinked.map((x) =>
      '<div class="bill-item"><div class="check-top"><div class="grow"><div class="title">' + esc(x.note || 'Bill payment') + '</div>' +
      '<div class="meta">' + fmtDate(x.date) + ' · ' + inr(x.amount) + ' · which bill is this?</div></div></div>' +
      '<div class="row"><select id="bill-link-' + esc(x.id) + '" aria-label="Bill">' + bills.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + '</select>' +
      '<button data-action="bill-link" data-id="' + esc(x.id) + '">Link</button></div></div>');
    return '<section class="card bills-card"><div class="card-head"><h2>Bills to pay</h2><span class="hint">Amounts vary</span></div>' +
      rows.join('') + links.join('') +
      '<p class="hint">Enter what you actually paid and how long it covers. The app learns the usual amount from your last three payments.</p></section>';
  }

  const PAY_MORE = ['Bonus', 'Incentive or commission', 'Overtime', 'Arrears or hike arrears', 'Reimbursement', 'Other'];
  const PAY_LESS = ['Tax deduction (TDS)', 'PF or other deduction', 'Unpaid leave', 'Advance or loan recovery', 'Paid in part / late', 'Other'];

  /*
   * Asked once a cycle, in its first week (or when the bank's salary SMS
   * arrives): what came in this month, and if it differs, why.
   */
  function paydayCard() {
    const t = today();
    if (state.isDemo || !state.settings.salary) return '';
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    const slips = state.payslips || {};
    const seen = state.salarySeen && state.salarySeen.cycle === cyc.start ? state.salarySeen : null;
    const due = !slips[cyc.start] && (Core.daysBetween(cyc.start, t) <= 7 || seen);
    if (!due && !ui.paydayOpen) return '';
    const usual = Number(state.settings.salary) || 0;
    const slip = slips[cyc.start];
    const start = slip ? slip.amount : seen ? seen.amount : usual;
    return '<section class="card payday-card"><div class="card-head"><h2>' + (slip ? 'This month’s pay' : 'Payday! How much came in this month?') + '</h2></div>' +
      (seen && !slip ? '<p class="hint">Your bank’s salary SMS on ' + fmtDate(seen.date) + ' said ' + inr(seen.amount) + '.</p>' : '') +
      '<p class="hint">Your usual pay is ' + inr(usual) + '. Recording each month’s pay, and why it changed, shows your year at a glance.</p>' +
      '<div class="row"><label class="field grow-field" for="pay-amount"><span>In hand this month (₹)</span><input id="pay-amount" type="number" inputmode="numeric" min="0" value="' + esc(start) + '"></label></div>' +
      '<div id="pay-reason">' + paydayReason(start, slip) + '</div>' +
      '<div class="row"><button class="primary" data-action="payday-save">Save</button>' +
      (start !== usual ? '<button data-action="payday-same">It was my usual ' + inr(usual) + '</button>' : '') +
      (ui.paydayOpen ? '<button class="ghost" data-action="payday-close">Close</button>' : '') + '</div></section>';
  }

  function paydayReason(amount, slip) {
    const usual = Number(state.settings.salary) || 0;
    const diff = Math.round(Number(amount) || 0) - usual;
    if (!diff) return '';
    const list = diff > 0 ? PAY_MORE : PAY_LESS;
    const chosen = slip && slip.reason;
    return '<div class="callout' + (diff > 0 ? ' good' : ' warn') + '"><b>' + inr(Math.abs(diff)) + (diff > 0 ? ' more than usual. What was it?' : ' less than usual. Why?') + '</b>' +
      '<div class="form-grid"><label class="field" for="pay-why"><span>Reason</span><select id="pay-why">' +
      list.map((x) => '<option' + (x === chosen ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
      '<label class="field" for="pay-note"><span>Note (optional)</span><input id="pay-note" type="text" value="' + esc((slip && slip.note) || '') + '" placeholder="' + (diff > 0 ? 'Diwali bonus' : 'TDS for Q2') + '"></label></div>' +
      '<label class="check"><input id="pay-new-usual" type="checkbox"> This is my new usual pay from now on</label>' +
      '<span class="hint">' + (diff > 0
        ? 'Next, choose what the extra ' + inr(diff) + ' should do: save it, clear a loan, invest, or keep it.'
        : 'This month’s budgets will be planned on ' + inr(amount) + '.') + '</span></div>';
  }

  // Records this cycle's pay. Extra above usual pay becomes money received to decide on.
  function savePayday(amount) {
    const t = today();
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    state.payslips = state.payslips || {};
    const usual = Number(state.settings.salary) || 0;
    const old = state.payslips[cyc.start];
    if (old && old.extraTx) {
      const tx = state.transactions.find((x) => x.id === old.extraTx);
      if (tx) { undoIncomeUse(tx); state.transactions = state.transactions.filter((x) => x !== tx); }
    }
    amount = Math.round(Number(amount) || 0);
    const why = document.getElementById('pay-why');
    const note = document.getElementById('pay-note');
    const newUsual = document.getElementById('pay-new-usual');
    const slip = { amount, usual, reason: amount !== usual && why ? why.value : '', note: amount !== usual && note ? note.value.trim() : '' };
    if (amount !== usual && newUsual && newUsual.checked) {
      slip.usual = amount;
      slip.previousUsual = usual;
      state.settings.salary = amount;
      toast('Usual pay updated to ' + inr(amount));
    } else if (amount > usual) {
      const extra = { id: uid(), kind: 'in', date: cyc.start, amount: amount - usual, category: slip.reason, note: 'Extra in this month’s pay', source: 'manual', useFor: null };
      state.transactions.push(extra);
      slip.extraTx = extra.id;
      toast(inr(amount - usual) + ' extra this month. Choose what it should do.');
    } else {
      toast(amount < usual ? 'Planned this month on ' + inr(amount) : 'Usual pay recorded');
    }
    state.payslips[cyc.start] = slip;
    ui.paydayOpen = false;
    save();
  }

  // The bank's salary SMS: remembered so payday can ask with the right amount.
  function noteSalary(p) {
    const cyc = Core.cycleFor(p.date || today(), Number(state.settings.payday) || 1);
    state.salarySeen = { cycle: cyc.start, amount: p.amount, date: p.date || today() };
  }

  function thisMonthPay() {
    if (!state.settings.salary) return '';
    const cyc = Core.cycleFor(today(), Number(state.settings.payday) || 1);
    const slip = (state.payslips || {})[cyc.start];
    const diff = slip ? slip.amount - slip.usual : 0;
    return '<div class="row pay-line"><span><b>This month:</b> ' + (slip
      ? inr(slip.amount) + ' in hand' + (diff ? ' (' + (diff > 0 ? '+' : '−') + inr(Math.abs(diff)) + ', ' + esc(slip.reason) + ')' : '')
      : 'not recorded yet') + '</span><button class="link" data-action="payday-open">' + (slip ? 'Change' : 'Record') + '</button></div>';
  }

  // Days of Freedom: the emergency fund as time, not just money.
  function freedomHeader() {
    const f = Core.freedomDays(state, today());
    if (!f) {
      return '<div class="card-head"><h2>Emergency fund</h2></div>' +
        '<p class="hint">Add your fixed payments and budgets to see your Days of Freedom.</p>';
    }
    const chip = f.days === 0 ? 'chip-caution' : 'chip-freedom';
    return '<div class="freedom' + (f.days === 0 ? ' none' : '') + '"><h2>' + plural(f.days, 'Day', 'Days') + ' of Freedom' + (f.days ? ' 🛡️' : '') + '</h2>' +
      '<span class="chip ' + chip + '">' + f.badge + '</span></div>' +
      '<p class="hint">' + (f.days === 0
        ? 'Every ' + inr(f.daily) + ' saved buys one day of complete financial security.'
        : '(' + inr(f.fund) + ' saved toward basics of ' + inr(f.daily) + ' a day: fixed payments, loan minimums, bills, groceries and health)') + '</p>';
  }

  // Pay over the last 12 months: bars, the months that differed, and totals.
  function payHistory() {
    const h = Core.salaryHistory(state, today(), 12);
    if (!h.some((x) => x.recorded)) return '';
    const max = Math.max.apply(null, h.map((x) => Math.max(x.amount, x.usual))) || 1;
    const bars = h.map((x) => {
      const cls = !x.recorded ? 'none' : x.diff > 0 ? 'up' : x.diff < 0 ? 'down' : 'same';
      const m = Core.parseISO(x.start);
      return '<div class="pay-col" title="' + esc(MONTH_NAMES[m.getMonth()] + ': ' + inr(x.amount) + (x.reason ? ' · ' + x.reason : '')) + '">' +
        '<div class="pay-bar ' + cls + '" style="height:' + Math.max(4, (x.amount / max) * 100).toFixed(1) + '%"></div>' +
        '<span>' + MONTH_NAMES[m.getMonth()].slice(0, 1) + '</span></div>';
    }).join('');
    const odd = h.filter((x) => x.recorded && x.diff);
    const more = odd.filter((x) => x.diff > 0).reduce((a, x) => a + x.diff, 0);
    const less = odd.filter((x) => x.diff < 0).reduce((a, x) => a - x.diff, 0);
    const total = h.reduce((a, x) => a + x.amount, 0);
    return '<div class="pay-history"><h3>Your pay over the year</h3>' +
      '<div class="pay-chart" role="img" aria-label="Pay for the last 12 months">' + bars + '</div>' +
      '<div class="legend"><span><i class="pay-key"></i>Usual pay</span><span><i class="pay-key up"></i>More than usual</span><span><i class="pay-key down"></i>Less than usual</span><span><i class="pay-key none"></i>Not recorded</span></div>' +
      '<div class="summary"><div class="line"><span>In hand, last 12 months</span><span>' + inr(total) + '</span></div>' +
      (h.some((x) => !x.recorded) ? '<span class="hint">Months not recorded are counted at your usual pay.</span>' : '') +
      (more ? '<div class="line"><span>Extra (bonuses and more)</span><span class="good">+' + inr(more) + '</span></div>' : '') +
      (less ? '<div class="line"><span>Less (deductions and more)</span><span class="bad">−' + inr(less) + '</span></div>' : '') + '</div>' +
      (odd.length ? '<div class="list">' + odd.slice().reverse().map((x) =>
        '<div class="list-item"><div class="grow"><div class="title">' + MONTH_NAMES[Core.parseISO(x.start).getMonth()] + ' ' + Core.parseISO(x.start).getFullYear() + ' · ' + esc(x.reason || 'Different') + '</div>' +
        (x.note ? '<div class="meta">' + esc(x.note) + '</div>' : '') + '</div>' +
        '<div class="amt ' + (x.diff > 0 ? 'good' : 'bad') + '">' + (x.diff > 0 ? '+' : '−') + inr(Math.abs(x.diff)) + '</div></div>').join('') + '</div>' : '') +
      '</div>';
  }

  /*
   * Next payday after what this month's money can't cover (card spending
   * this month is already counted, so it isn't subtracted again).
   */
  function paydayPreviewCard() {
    const p = Core.nextPaydayPreview(state, today());
    if (!p.nominal) return '';
    const tone = p.percent > 50 ? 'bad' : p.percent > 20 ? 'warn' : '';
    const parts = [];
    if (p.shortfall) parts.push(['This month’s shortfall at your pace (ends up borrowed)', p.shortfall]);
    if (p.fromBefore) parts.push(['Card bills from before you added the card', p.fromBefore]);
    if (p.newCardDebt) parts.push(['Card EMIs and balances starting next month', p.newCardDebt]);
    let html = '<section class="card preview"><span class="eyebrow">Next payday · ' + fmtDate(p.date) + '</span>';
    if (p.depleted) {
      html += '<span class="big bad">Next paycheck fully used up: ₹0 in hand</span>' +
        '<div class="callout bad"><b>Your card spending has used up your next salary before payday.</b><span class="hint">Every rupee you don’t spend now goes straight to the shortfall. See the Debts tab for the card bills.</span></div>';
    } else if (!p.borrowed) {
      html += '<span class="big">Effective payday: ' + inr(p.effective) + '</span>' +
        '<span class="sub">Nothing borrowed against your next salary. Keep it that way.</span>';
    } else {
      html += '<span class="big">Effective payday: ' + inr(p.effective) + '</span>' +
        '<span class="sub ' + tone + '">(Usual pay ' + inr(p.nominal) + ' − ' + inr(p.borrowed) + ' already borrowed against it)</span>';
    }
    if (parts.length) {
      html += '<div class="summary">' + parts.map((x) => '<div class="line"><span>' + x[0] + '</span><span class="' + (tone || 'warn') + '">−' + inr(x[1]) + '</span></div>').join('') + '</div>';
    }
    if (!p.depleted) {
      html += '<span class="sub">After fixed payments, loan minimums and bills (' + inr(p.committed) + '): ' +
        (p.freeAfter >= 0 ? inr(p.freeAfter) + ' left for everything else.' : '<span class="bad">' + inr(-p.freeAfter) + ' short</span>.') + '</span>';
    }
    return html + '</section>';
  }

  function zoneMeter(zone) {
    const seg = (key, label) => '<span class="zone-seg zone-' + key + (zone === key ? ' on' : '') + '">' + label + '</span>';
    return '<div class="zone-meter" role="img" aria-label="Zone: ' + zone + '">' +
      seg('green', 'Green') + seg('amber', 'Careful') + seg('red', 'Red') + '</div>';
  }

  // Ways out of the red, each with its amount.
  function redOptions(z, r) {
    const items = z.options.map((o) => {
      if (o.kind === 'fund') {
        return '<li><b>Use ' + inr(o.amount) + ' from your emergency fund.</b> That’s what it’s for. ' +
          '<button class="link" data-action="zone-fund" data-amount="' + Math.round(o.amount) + '">Move it to this month</button></li>';
      }
      if (o.kind === 'pause') {
        return '<li><b>Pause this month’s Grow and extra debt payments</b> (' + inr(o.amount) + '), if you haven’t moved that money yet. ' +
          '<button class="link" data-action="zone-pause">Pause until payday</button></li>';
      }
      return '<li><b>Spend only on basics</b>, about ' + inr(o.amount) + ' a day for groceries and health, until ' + fmtDate(r.cycle.next) + '.</li>';
    });
    items.push('<li><b>Avoid the credit card for daily spending.</b> It turns this month’s gap into next month’s debt.</li>');
    return '<ol class="red-options">' + items.join('') + '</ol>';
  }

  // Remembers today's amount so tomorrow the app can say what was saved.
  function recordToday(r) {
    const t = today();
    state.days = state.days || {};
    const day = state.days[t] || {};
    const allowance = Math.round(r.dailyAllowance);
    if (day.allowance !== allowance && !day.prompted) {
      state.days[t] = Object.assign(day, { allowance });
      // Keep two weeks of days.
      Object.keys(state.days).filter((d) => d < Core.addDays(t, -14)).forEach((d) => { delete state.days[d]; });
      save();
    }
  }

  function spentOn(date) {
    return state.transactions
      .filter((x) => Core.isFlexible(x) && x.date === date && x.category !== 'Emergency')
      .reduce((s, x) => s + x.amount, 0);
  }

  // Days in a row, up to yesterday, spent within the daily amount.
  function withinStreak() {
    let n = 0;
    let d = Core.addDays(today(), -1);
    while (state.days && state.days[d] && spentOn(d) <= state.days[d].allowance) { n++; d = Core.addDays(d, -1); }
    return n;
  }

  /*
   * A day that ended under its amount, waiting for "what should the
   * leftover do?": the latest of the last three days, or today after 8 PM.
   */
  function savedDay() {
    const t = today();
    const days = state.days || {};
    const candidates = [];
    if (new Date().getHours() >= 20) candidates.push(t);
    for (let i = 1; i <= 3; i++) candidates.push(Core.addDays(t, -i));
    for (const d of candidates) {
      const rec = days[d];
      if (!rec || rec.prompted) continue;
      const left = rec.allowance - spentOn(d);
      if (left >= 10) return { date: d, allowance: rec.allowance, spent: spentOn(d), left: Math.round(left) };
    }
    return null;
  }

  function savedCard() {
    const day = savedDay();
    if (!day) return '';
    const isToday = day.date === today();
    const when = isToday ? 'today' : day.date === Core.addDays(today(), -1) ? 'yesterday' : 'on ' + fmtDate(day.date);
    const fund = Number(state.savings.emergencyBalance) || 0;
    const top = state.debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
    const zone = Core.zoneStatus(state, today()).zone;
    const sug = Core.suggestUse(state, today(), zone !== 'green' ? 'You’re not in the green this month, so keeping it helps you reach payday.' : null);
    const suggested = sug.use;
    const opt = (use, title, detail, extra) =>
      '<button class="choice' + (use === suggested ? ' suggested' : '') + '" data-action="save-day" data-date="' + day.date + '" data-amount="' + day.left + '" data-use="' + use + '"' + (extra || '') + '>' +
      '<span class="choice-title">' + title + (use === suggested ? ' <span class="chip chip-auto">Suggested</span>' : '') + '</span>' +
      '<span class="choice-detail">' + detail + '</span></button>';
    return '<section class="card saved-card"><div class="card-head"><h2>You saved ' + inr(day.left) + ' ' + when + '</h2></div>' +
      '<p class="hint">You spent ' + inr(day.spent) + ' of your ' + inr(day.allowance) + '. Saving that much every day adds up to ' + inr(day.left * 30) + ' a month. Put it to work:</p>' +
      '<div class="choices">' +
      opt('emergency', 'Add to emergency fund', 'Fund goes from ' + inr(fund) + ' to ' + inr(fund + day.left) + '.') +
      (top ? opt('debt', 'Pay off ' + esc(top.name), 'At ' + top.rate + '% a year, that saves about ' + inr((day.left * top.rate) / 100) + ' a year in interest.', ' data-debt="' + esc(top.id) + '"') : '') +
      opt('grow', 'Set aside to invest', 'Adds to the money you’ve set aside to invest.') +
      '<button class="choice' + (suggested === 'spend' ? ' suggested' : '') + '" data-action="save-day-keep" data-date="' + day.date + '"><span class="choice-title">Keep it for this month' + (suggested === 'spend' ? ' <span class="chip chip-auto">Suggested</span>' : '') + '</span>' +
      '<span class="choice-detail">It stays in this month’s money and slightly raises the days ahead.</span>' +
      (top && top.rate >= 15 ? '<span class="choice-badge">Extends this month’s budget, but delays your debt-free date</span>' : '') + '</button>' +
      '</div><p class="hint"><b>Why the suggestion:</b> ' + esc(sug.reason) + '</p></section>';
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

  // Payments recorded from SMS that the user hasn't checked yet.
  function needsCheck() {
    return state.transactions.filter((x) => x.needsReview).sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function needsCheckCard() {
    const list = needsCheck();
    if (!list.length) return '';
    return '<section class="card check-card"><div class="card-head"><h2>Needs your check</h2><span class="chip chip-check">' + list.length + '</span></div>' +
      '<p class="hint">Recorded from bank SMS. Is the category right?</p>' +
      '<div class="list">' + list.map((x) =>
        '<div class="check-item"><div class="check-top"><div class="grow"><div class="title">' + esc(x.note || 'Bank payment') + '</div>' +
        '<div class="meta">' + fmtDate(x.date) + '</div></div><div class="amt">' + inr(x.amount) + '</div></div>' +
        '<div class="row"><select data-tx-cat="' + esc(x.id) + '" aria-label="Category">' + categoryOptions(x.category) + '</select>' +
        ((state.cards || []).length || x.paidFrom
          ? '<select data-tx-from="' + esc(x.id) + '" aria-label="Paid from">' + paidFromOptions(x.paidFrom) +
            (x.paidFrom && x.paidFrom.indexOf('card:') === 0 ? '<option value="' + esc(x.paidFrom) + '" selected>Card ending ' + esc(x.paidFrom.slice(5)) + ' (not added)</option>' : '') + '</select>'
          : '') + '</div>' +
        '<div class="row"><button class="primary" data-action="tx-confirm" data-id="' + esc(x.id) + '">Looks right</button>' +
        '<button class="ghost" data-action="tx-not-payment" data-id="' + esc(x.id) + '">Not a payment</button></div></div>'
      ).join('') + '</div></section>';
  }

  // Money received that still needs a decision, newest first.
  function pendingIncome() {
    return state.transactions.filter((x) => Core.isIncome(x) && !x.useFor)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function incomeCard() {
    const pending = pendingIncome();
    if (!pending.length) return '';
    const tx = pending[0];
    const o = Core.incomeOptions(state, tx.id, today());
    return '<section class="card income-card"><div class="card-head"><h2>What should this ' + inr(tx.amount) + ' do?</h2>' +
      (pending.length > 1 ? '<span class="hint">' + (pending.length - 1) + ' more after this</span>' : '') + '</div>' +
      '<p class="hint">' + (tx.note ? esc(tx.note) + ' · ' : '') + esc(tx.category) + ' · ' + fmtDate(tx.date) + '. Until you choose, it counts as money for this month.</p>' +
      '<div class="choices">' + o.options.map((opt) =>
        '<button class="choice' + (opt.use === o.recommended ? ' suggested' : '') + '" data-action="income-use" data-id="' + esc(tx.id) + '" data-use="' + opt.use + '"' + (opt.debtId ? ' data-debt="' + esc(opt.debtId) + '"' : '') + '>' +
        '<span class="choice-title">' + esc(opt.title) + (opt.use === o.recommended ? ' <span class="chip chip-auto">Suggested</span>' : '') + '</span>' +
        '<span class="choice-detail">' + esc(opt.detail) + '</span>' +
        (opt.badge ? '<span class="choice-badge">' + esc(opt.badge) + '</span>' : '') + '</button>').join('') + '</div>' +
      '<p class="hint"><b>Why the suggestion:</b> ' + esc(o.reason) + ' The choice is yours.</p></section>';
  }

  // Applies a choice for money received: moves it to a fund or a loan.
  function setIncomeUse(tx, use, debtId) {
    undoIncomeUse(tx);
    const sv = state.savings;
    if (use === 'emergency') sv.emergencyBalance = (Number(sv.emergencyBalance) || 0) + tx.amount;
    if (use === 'grow') sv.investSaved = (Number(sv.investSaved) || 0) + tx.amount;
    if (use === 'debt') {
      const debt = state.debts.find((d) => d.id === debtId);
      if (!debt) return;
      const paid = Math.min(tx.amount, Number(debt.balance) || 0);
      debt.balance = (Number(debt.balance) || 0) - paid;
      tx.debtId = debt.id;
      tx.debtPaid = paid;
    }
    tx.useFor = use;
  }

  function undoIncomeUse(tx) {
    const sv = state.savings;
    if (tx.useFor === 'emergency') sv.emergencyBalance = Math.max(0, (Number(sv.emergencyBalance) || 0) - tx.amount);
    if (tx.useFor === 'grow') sv.investSaved = Math.max(0, (Number(sv.investSaved) || 0) - tx.amount);
    if (tx.useFor === 'debt') {
      const debt = state.debts.find((d) => d.id === tx.debtId);
      if (debt) debt.balance = (Number(debt.balance) || 0) + (Number(tx.debtPaid) || 0);
      delete tx.debtId;
      delete tx.debtPaid;
    }
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
    Core.zoneStatus(state, today(), r).needsLine.forEach((v) => { if (v !== null) vals.push(v); });
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
    const z = Core.zoneStatus(state, today(), r);
    let band = '';
    z.needsLine.forEach((v, i) => { if (v !== null) band += (band ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Math.max(v, yMin)).toFixed(1); });
    if (band) {
      svg += '<path class="c-red-band" d="' + band + 'L' + x(N - 1).toFixed(1) + ' ' + y(0).toFixed(1) + 'L' + x(ti).toFixed(1) + ' ' + y(0).toFixed(1) + 'Z"/>';
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
    const list = (ui.txFilter === 'cycle' ? state.transactions.filter((x) => Core.inCycle(x.date, cyc)) : state.transactions.slice())
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const spent = list.filter((x) => Core.isFlexible(x) || Core.isBillPayment(x)).reduce((s, x) => s + x.amount, 0);
    const received = list.filter(Core.isIncome).reduce((s, x) => s + x.amount, 0);
    const shown = list.slice(0, 200);
    const moneyIn = ui.txKind === 'in';

    return (
      needsCheckCard() +
      billsCard() +
      incomeCard() +
      '<section class="card"><div class="card-head"><h2>' + (moneyIn ? 'Add money received' : 'Add a payment') + '</h2>' +
      '<div class="seg" role="group" aria-label="Type"><button data-action="tx-kind" data-kind="out" aria-pressed="' + !moneyIn + '">Money out</button>' +
      '<button data-action="tx-kind" data-kind="in" aria-pressed="' + moneyIn + '">Money in</button></div></div>' +
      (moneyIn ? '<p class="hint">Money returned to you, money from home, a refund, cashback or side income. Your salary is already counted.</p>' : '') +
      '<form id="add-tx" class="form-grid" autocomplete="off">' +
      '<label class="field">Amount (₹)<input id="tx-amount" type="number" inputmode="decimal" min="1" step="1" required placeholder="' + (moneyIn ? '2000' : '250') + '"></label>' +
      '<label class="field">Category<select id="tx-category">' + (moneyIn ? incomeCategoryOptions('Money received') : categoryOptions('Food & dining')) + '</select></label>' +
      '<label class="field">Date<input id="tx-date" type="date" value="' + t + '" max="' + t + '" required></label>' +
      '<label class="field">' + (moneyIn ? 'From' : 'Where / what') + '<input id="tx-note" type="text" placeholder="' + (moneyIn ? 'Rahul' : 'Swiggy') + '"></label>' +
      (!moneyIn && (state.cards || []).length
        ? '<label class="field wide" for="tx-from"><span>Paid from</span><select id="tx-from">' + paidFromOptions('account') + '</select></label>' +
          '<p id="tx-from-warn" class="borrow-warn wide" hidden></p>'
        : '') +
      '<div class="wide"><button class="primary" type="submit">' + (moneyIn ? 'Add money received' : 'Add payment') + '</button></div>' +
      '</form></section>' +

      (NATIVE
        ? '<section class="card"><div class="card-head"><h2>Bank SMS</h2>' + (state.smsAuto ? modeChip(true) : '') + '</div>' +
          '<p class="hint">' + (state.smsAuto
            ? 'New bank and UPI messages are checked each time you open the app. Review them below before they are added.'
            : 'Let the app read your bank and UPI messages to record payments for you. Messages are read on this phone and never leave it. You review every payment before it is added.') + '</p>' +
          '<div class="row"><button class="primary" data-action="sms-native"' + (ui.smsBusy ? ' disabled' : '') + '>' +
          (ui.smsBusy ? 'Reading…' : state.smsAuto ? 'Check for new messages' : 'Read bank SMS') + '</button></div>' +
          (state.smsAuto
            ? '<div class="callout"><b>' + (state.smsAlerts ? 'Notifications for new bank SMS are on' : 'Get a notification when a bank SMS arrives') + '</b>' +
              '<span class="hint">' + (state.smsAlerts
                ? 'Each new payment is recorded as it arrives and you get a notification to check its category. Payments you don’t check wait here, highlighted.'
                : 'Check each payment’s category the moment it happens, from a small pop-up. Android will ask to allow receiving SMS and notifications.') + '</span>' +
              '<div>' + (state.smsAlerts
                ? '<button class="ghost" data-action="alerts-off">Turn off</button>'
                : '<button class="primary" data-action="alerts-on">Turn on notifications</button>') + '</div></div>'
            : '') +
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
      '<p class="hint">' + inr(spent) + ' spent' + (received ? ' · <span class="good">' + inr(received) + ' received</span>' : '') + '. Change a category and the app remembers it for that shop next time.</p>' +
      (shown.length
        ? '<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Category</th><th class="amt">Amount</th><th><span class="sr">Delete</span></th></tr></thead><tbody>' +
          shown.map((x) => {
            const isIn = Core.isIncome(x);
            if (Core.isMove(x) || Core.isBillPayment(x) || Core.isCardTransfer(x)) {
              const label = Core.isMove(x) ? INCOME_USE_LABELS[x.useFor] || 'Moved' : x.kind === 'cardpay' ? 'Card bill paid from your account' : x.kind === 'cardconvert' ? 'Moved off the card to your loans' : 'Bill payment';
              return '<tr><td><div class="cell-title">' + esc(x.note) + '</div><div class="cell-sub">' + fmtDate(x.date) + ' · ' + label + '</div></td>' +
                '<td>' + (Core.isMove(x) ? 'Saved' : Core.isCardTransfer(x) ? 'Card' : 'Bills') + '</td><td class="amt' + (Core.isMove(x) ? ' good' : '') + '">' + inr(x.amount) + '</td>' +
                '<td><button class="icon" data-action="tx-delete" data-id="' + esc(x.id) + '" aria-label="Delete">✕</button></td></tr>';
            }
            const onCard = x.paidFrom && x.paidFrom !== 'account' ? (state.cards || []).find((c) => c.id === x.paidFrom) : null;
            const sub = fmtDate(x.date) + (x.source === 'sms' ? ' · from SMS' : x.source === 'widget' ? ' · from widget' : '') +
              (onCard ? ' · <span class="warn">on ' + cardLabel(onCard) + '</span>' : x.paidFrom && x.paidFrom.indexOf('card:') === 0 ? ' · <span class="warn">on a card</span>' : '') +
              (isIn ? ' · ' + (x.useFor ? INCOME_USE_LABELS[x.useFor] + ' <button class="link" data-action="income-change" data-id="' + esc(x.id) + '">Change</button>' : '<button class="link" data-action="income-change" data-id="' + esc(x.id) + '">Choose what it does</button>') : '');
            return '<tr' + (x.needsReview ? ' class="needs-check"' : '') + '><td><div class="cell-title">' + esc(x.note || (isIn ? 'Money received' : 'Payment')) +
              (x.needsReview ? ' <span class="chip chip-check">Check</span>' : '') + '</div><div class="cell-sub">' + sub + '</div></td>' +
              '<td><select data-tx-cat="' + esc(x.id) + '" aria-label="Category">' + (isIn ? incomeCategoryOptions(x.category) : categoryOptions(x.category)) + '</select></td>' +
              '<td class="amt' + (isIn ? ' good' : '') + '">' + (isIn ? '+' : '') + inr(x.amount) + '</td>' +
              '<td><button class="icon" data-action="tx-delete" data-id="' + esc(x.id) + '" aria-label="Delete">✕</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
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
        const isIn = p.type === 'credit';
        const cardRow = p.type === 'statement' || p.type === 'cardpayment';
        const note = r.duplicate ? 'Already added' : isIn && p.salary ? 'Looks like your salary, which is already counted' : smsNote(p) || (isIn ? 'Money in' : '');
        if (cardRow) {
          return '<tr' + (r.duplicate ? ' class="muted"' : '') + '><td><input type="checkbox" data-sms-check="' + i + '" aria-label="Add this"' + (r.checked ? ' checked' : '') + '></td>' +
            '<td><div class="cell-title">' + (p.type === 'statement' ? 'Card statement' : 'Card bill payment') + '</div><div class="cell-sub">' + fmtDate(p.date) + ' · ' + note + '</div></td>' +
            '<td>—</td><td class="amt">' + inr(p.amount) + '</td></tr>';
        }
        return '<tr' + (r.duplicate || (isIn && p.salary) ? ' class="muted"' : '') + '>' +
          '<td><input type="checkbox" data-sms-check="' + i + '" aria-label="Add this"' + (r.checked ? ' checked' : '') + '></td>' +
          '<td><div class="cell-title">' + esc(p.merchant) + '</div><div class="cell-sub">' + fmtDate(p.date) + (note ? ' · ' + note : '') + '</div></td>' +
          '<td><select data-sms-cat="' + i + '" aria-label="Category">' + (isIn ? incomeCategoryOptions(p.category) : categoryOptions(p.category)) + '</select></td>' +
          '<td class="amt' + (isIn ? ' good' : '') + '">' + (isIn ? '+' : '') + inr(p.amount) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="row"><button class="primary" data-action="sms-import"' + (selected ? '' : ' disabled') + '>Add ' + plural(selected, 'item') + '</button>' +
      '<button class="ghost" data-action="sms-clear">Clear</button></div>';
  }

  function readSms() {
    const t = today();
    ui.smsRows = smsRows(Core.splitSmsBatch(ui.smsText).map((text) => ({ text, day: t })));
  }

  // Rows for the review table. `day` is the date the message arrived; text
  // without a date of its own gets that date.
  function smsRows(messages) {
    const known = knownSmsKeys();
    return messages.map(({ text, day }) => {
      const parsed = Core.parseSms(text, state.merchantRules, day);
      const key = Core.smsKey(text);
      if (parsed && parsed.type === 'credit' && parsed.salary) noteSalary(parsed);
      const duplicate = !!parsed && (known.has(key) || state.transactions.some((x) => !x.kind && (
        x.date === parsed.date && x.amount === parsed.amount &&
        Core.normalizeMerchant(x.note) === Core.normalizeMerchant(parsed.merchant))));
      const unknownCard = !!parsed && (parsed.type === 'statement' || parsed.type === 'cardpayment') && !findCard(parsed.last4);
      return { text, key, parsed, duplicate, checked: !!parsed && !duplicate && !parsed.salary && !unknownCard };
    });
  }

  // SMS keys already recorded: transactions and card statements.
  function knownSmsKeys() {
    return new Set(state.transactions.map((x) => x.smsKey)
      .concat((state.cards || []).map((c) => c.statement && c.statement.smsKey))
      .concat(state.smsIgnored || []).filter(Boolean));
  }

  /*
   * Records one parsed bank SMS. o: key, review (mark "needs your check"),
   * category and note (chosen by the user), cardId ('account' or a card,
   * chosen in the pop-up). Returns false if nothing was recorded.
   */
  function recordSms(p, o) {
    const chosen = o.cardId && o.cardId !== 'account' ? (state.cards || []).find((c) => c.id === o.cardId) : null;
    const card = chosen || findCard(p.last4);
    if (p.type === 'statement') {
      if (!card) return false;
      card.statement = { date: p.date, total: p.amount, min: p.min, due: p.due, smsKey: o.key };
      return true;
    }
    if (p.type === 'credit' && p.salary) {
      noteSalary(p);
      return false;
    }
    if (p.type === 'cardpayment') {
      if (!card) return false;
      // The bank and the card often both send an SMS for one payment.
      const twin = state.transactions.some((x) => x.kind === 'cardpay' && x.cardId === card.id && x.amount === p.amount &&
        Math.abs(Core.daysBetween(x.date, p.date)) <= 3);
      if (twin) return false;
      Core.recordCardPayment(state, card.id, p.amount, p.date, 'sms').smsKey = o.key;
      return true;
    }
    let paidFrom = 'account';
    if (o.cardId) paidFrom = o.cardId;
    else if (p.paidFrom === 'card') paidFrom = card ? card.id : 'card:' + (p.last4 || '');
    const tx = { id: uid(), date: p.date, amount: p.amount, category: o.category || p.category, note: o.note || p.merchant, source: 'sms', smsKey: o.key };
    if (paidFrom !== 'account') tx.paidFrom = paidFrom;
    if (p.type === 'credit') {
      tx.kind = 'in';
      // A refund to a card lowers the card bill, so it stays as this month's money.
      tx.useFor = paidFrom !== 'account' ? 'spend' : null;
    } else if (o.review || paidFrom.indexOf('card:') === 0) {
      tx.needsReview = true;
    } else {
      const shop = Core.normalizeMerchant(tx.note);
      if (shop && tx.note !== 'Bank payment') state.merchantRules[shop] = tx.category;
    }
    state.transactions.push(tx);
    return true;
  }

  function smsNote(p) {
    if (p.type === 'statement') {
      const c = findCard(p.last4);
      return c ? cardLabel(c) + ' statement: ' + inr(p.amount) + (p.due ? ' due ' + fmtDate(p.due) : '') : 'Card statement for a card not added yet (••' + esc(p.last4 || '?') + ')';
    }
    if (p.type === 'cardpayment') {
      const c = findCard(p.last4);
      return c ? cardLabel(c) + ' bill paid' : 'Card bill paid, for a card not added yet';
    }
    if (p.paidFrom === 'card') {
      const c = findCard(p.last4);
      return c ? 'On ' + cardLabel(c) : 'On a card ending ' + esc(p.last4 || '?') + ' (add it under Debts)';
    }
    return '';
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
    const alloc = Core.allocate(state, today());
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
      '</div><p class="hint">Starting in the middle of the month? Your balance lets the graph start from the right amount, since the app can’t see earlier spending.</p>' +
      thisMonthPay() + payHistory() + '</section>' +
      (ui.paydayOpen ? paydayCard() : '') +

      '<section class="card"><div class="card-head"><h2>Fixed payments</h2><span class="hint">Rent, EMIs, bills, subscriptions</span></div>' +
      '<div class="edit-rows">' + state.fixed.map((f) =>
        '<div class="edit-row">' + listField('fixed', f, 'name', 'Name', 'text') + listField('fixed', f, 'amount', 'Amount (₹)', 'number') +
        listField('fixed', f, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('fixed', f) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="fixed">Add fixed payment</button></div>' +
      '<p class="hint">Credit cards and loans with a balance go in the Debts tab. Their minimum payments are counted automatically.</p></section>' +

      '<section class="card"><div class="card-head"><h2>Bills that vary</h2><span class="hint">Electricity, gas, water, recharges</span></div>' +
      '<p class="hint">For bills whose amount changes, or that you sometimes pay for several months at once. A share is set aside every month, so a 3-month recharge doesn’t hit one month hard.</p>' +
      '<div class="edit-rows">' + (state.bills || []).map((b) =>
        '<div class="edit-row cols-bill">' + listField('bills', b, 'name', 'Name', 'text') + listField('bills', b, 'estimate', 'About (₹)', 'number') +
        '<label class="field" for="bills-' + esc(b.id) + '-every"><span>Paid every</span><select id="bills-' + esc(b.id) + '-every" data-list="bills" data-id="' + esc(b.id) + '" data-field="everyMonths">' + periodOptions(b.everyMonths) + '</select></label>' +
        listField('bills', b, 'nextDue', 'Next due', 'date') + removeButton('bills', b) + '</div>').join('') + '</div>' +
      '<div class="row"><button data-action="list-add" data-list="bills">Add bill</button>' +
      (state.fixed.length
        ? '<select id="fixed-to-bill" aria-label="Fixed payment to move">' + state.fixed.map((f) => '<option value="' + esc(f.id) + '">' + esc(f.name || 'Unnamed') + '</option>').join('') + '</select>' +
          '<button class="ghost" data-action="fixed-to-bill">Move from fixed payments</button>'
        : '') + '</div></section>' +

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
      '</section>' +
      smsCleanup()
    );
  }

  // Removes payments imported from SMS before a date, for clearing out a
  // large first import. Payments added by hand are kept.
  function smsCleanup() {
    if (!state.transactions.some((x) => x.source === 'sms')) return '';
    const c = ui.smsClean;
    return '<section class="card"><h2>Clean up SMS imports</h2>' +
      '<p class="hint">Removes payments and money received that were added from SMS before the date you pick. Anything you added by hand stays.</p>' +
      '<div class="row"><label class="field grow-field" for="sms-clean-date"><span>Remove SMS imports dated before</span><input id="sms-clean-date" type="date" value="' + (c ? c.date : today()) + '" max="' + today() + '"></label></div>' +
      (c
        ? (c.count
          ? '<div class="callout bad"><b>Remove ' + plural(c.count, 'entry', 'entries') + ' imported from SMS before ' + fmtDate(c.date, true) + '?</b>' +
            '<span class="hint">This can’t be undone. Copy a backup first if you might want them back.</span>' +
            '<div class="row"><button class="danger" data-action="sms-clean-confirm">Yes, remove them</button><button data-action="sms-clean-cancel">Cancel</button></div></div>'
          : '<p class="hint">No SMS imports before ' + fmtDate(c.date, true) + '.</p>')
        : '') +
      '<div><button data-action="sms-clean">Find SMS imports</button></div></section>';
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
      line('Bills that vary (monthly share)', minus(p.variableBills)) +
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

  const MAX_CARDS = 10;

  function cardLabel(c) { return esc(c.name) + (c.last4 ? ' ••' + esc(c.last4) : ''); }

  function findCard(last4) {
    return (state.cards || []).find((c) => last4 && c.last4 === last4) || null;
  }

  function paidFromOptions(selected) {
    return '<option value="account"' + (!selected || selected === 'account' ? ' selected' : '') + '>Bank account / UPI / debit card (paid from my money)</option>' +
      (state.cards || []).map((c) => {
        const rate = Number(c.rate) || 42;
        return '<option value="' + esc(c.id) + '"' + (selected === c.id ? ' selected' : '') + '>' + cardLabel(c) +
          (rate >= 15 ? ' (borrows from next paycheck @ ' + rate + '%)' : ' (credit card @ ' + rate + '%)') + '</option>';
      }).join('');
  }

  // The red line under a "Paid from" choice when it's a card.
  function borrowWarning(cardId) {
    const c = (state.cards || []).find((x) => x.id === cardId);
    if (!c) return '';
    const rate = Number(c.rate) || 42;
    // Today's spending goes on the next statement, not the one already issued.
    const due = Core.dueAfter(c, Core.statementOn(c, Core.addMonths(today(), 1)));
    return rate >= 15
      ? 'Borrowed money at ' + rate + '% a year. Counted as spent today; it’s on the bill due ' + fmtDate(due) + '.'
      : 'On ' + esc(c.name) + ' at ' + rate + '% a year. Counted as spent today.';
  }

  function cardsSection() {
    const cards = state.cards || [];
    let html = '<section class="card"><div class="card-head"><h2>Credit cards</h2><span class="hint">' + cards.length + ' of ' + MAX_CARDS + '</span></div>' +
      '<p class="hint">Card spending is counted as spent the day it happens, so the money is kept aside for the bill. The app tracks each card’s statement, due date and how much of the limit you’re using.</p>';
    html += cards.map(cardBlock).join('');
    if (ui.cardForm) html += cardForm();
    else if (cards.length < MAX_CARDS) html += '<div><button data-action="card-add">Add credit card</button></div>';
    return html + '</section>';
  }

  function cardBlock(c) {
    const t = today();
    const st = Core.cardStatus(state, c, t);
    const pct = st.usedPct === null ? 0 : Math.min(100, st.usedPct);
    const meter = st.usedPct === null ? '' :
      '<div class="bar-row"><div class="bar-top"><span>Using ' + inr(st.owed) + ' of ' + inr(c.limit) + '</span><span class="amt' + (st.usedPct > 30 ? ' warn' : '') + '">' + st.usedPct + '%</span></div>' +
      '<div class="bar"><span class="' + (st.usedPct > 50 ? 'bad' : st.usedPct > 30 ? 'warn' : '') + '" style="width:' + pct + '%"></span></div>' +
      (st.usedPct > 30 ? '<span class="hint">Keeping this under 30% of the limit helps your credit score.</span>' : '') + '</div>';
    let html = '<div class="card-item"><div class="check-top"><div class="grow"><div class="title">' + cardLabel(c) + '</div>' +
      '<div class="meta">Statement on the ' + ordinal(c.statementDay) + ', due on the ' + ordinal(c.dueDay) + ' · ' + (c.rate || 42) + '% a year</div></div>' +
      '<button class="ghost" data-action="card-edit" data-id="' + esc(c.id) + '">Edit</button></div>' + meter +
      '<div class="summary">' +
      '<div class="line"><span>Bill' + (st.statementDate ? ' from ' + fmtDate(st.statementDate) : '') + '</span><span>' + inr(st.total) + '</span></div>' +
      (st.paidSince ? '<div class="line"><span>Paid so far</span><span class="good">' + inr(st.paidSince) + '</span></div>' : '') +
      '<div class="line total"><span>' + (st.remaining ? 'To pay by ' + fmtDate(st.due) : 'Bill paid') + '</span><span' + (st.overdue ? ' class="bad"' : '') + '>' + inr(st.remaining) + '</span></div>' +
      '<div class="line"><span>Spent since (next bill)</span><span>' + inr(st.unbilled) + '</span></div></div>';
    if (st.overdue) {
      const interest = Math.round((st.remaining * (Number(c.rate) || 42)) / 1200);
      html += '<div class="callout bad"><b>' + inr(st.remaining) + ' wasn’t paid by ' + fmtDate(st.due) + '.</b>' +
        '<span class="hint">It now costs about ' + inr(interest) + ' interest a month, and new spending stops being interest-free. Pay it now, or move it to your loans so the payoff plan tracks it.</span>' +
        '<div class="row"><button class="primary" data-action="card-plan" data-id="' + esc(c.id) + '">Plan payment</button>' +
        '<button data-action="card-revolve" data-id="' + esc(c.id) + '">Move to loans</button></div></div>';
    } else if (st.remaining) {
      html += '<div class="row"><button class="primary" data-action="card-plan" data-id="' + esc(c.id) + '">' + (ui.cardPlan && ui.cardPlan.cardId === c.id ? 'Hide payment plan' : 'Plan this payment') + '</button></div>';
    }
    if (ui.cardPlan && ui.cardPlan.cardId === c.id && st.remaining) html += '<div id="card-plan">' + cardPlanPanel(c) + '</div>';
    if (ui.cardRemove === c.id) {
      html += '<div class="callout bad"><b>Remove ' + cardLabel(c) + '?</b><span class="hint">Payments made with it stay in your records.</span>' +
        '<div class="row"><button class="danger" data-action="card-remove-confirm" data-id="' + esc(c.id) + '">Remove</button><button data-action="card-remove-cancel">Cancel</button></div></div>';
    }
    return html + '</div>';
  }

  function ordinal(n) {
    n = Number(n) || 1;
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /*
   * Full, minimum, part or EMI, each with its cost. The suggestion comes
   * from Core.cardBillPlan; an EMI is suggested only when clearly cheaper.
   */
  function cardPlanPanel(c) {
    const p = Core.cardBillPlan(state, c.id, today(), ui.cardPlan.emi);
    const st = p.status;
    const sug = (k) => (p.suggested === k ? ' <span class="chip chip-auto">Suggested</span>' : '');
    const minPayoff = p.minPlan.payoff;
    const emiAmount = ui.cardPlan.emiAmount || p.rest || st.remaining;
    const q = Core.emiQuote(emiAmount, ui.cardPlan.emi.rate, ui.cardPlan.emi.months, ui.cardPlan.emi.fee);
    const rq = Core.revolveQuote(emiAmount, p.rate, q.emi);
    const diff = rq.cost - q.cost;
    return '<div class="callout' + (p.short ? ' warn' : '') + '"><b>' + (p.suggested === 'full' ? 'Pay this bill in full' : p.suggested === 'emi' ? 'Pay ' + inr(p.payNow) + ' now, EMI for the rest' : 'Pay ' + inr(p.payNow) + ' now') + '</b><span class="hint">' + esc(p.reason) + '</span></div>' +
      '<div class="choices">' +
      '<div class="choice' + (p.suggested === 'full' ? ' suggested' : '') + '"><span class="choice-title">Pay in full: ' + inr(st.remaining) + sug('full') + '</span>' +
      '<span class="choice-detail">No interest, and new spending stays interest-free.</span>' +
      '<div><button class="primary" data-action="card-pay" data-id="' + esc(c.id) + '" data-amount="' + st.remaining + '">I paid ' + inr(st.remaining) + '</button></div></div>' +

      (st.minLeft > 0 && st.minLeft < st.remaining
        ? '<div class="choice"><span class="choice-title">Minimum only: ' + inr(st.minLeft) + '</span>' +
          '<span class="choice-detail bad">' + inr(st.remaining - st.minLeft) + ' stays on the card at ' + p.rate + '% a year: about ' + inr(p.minPlan.interestNextMonth) + ' interest next month, and new spending stops being interest-free.' +
          (minPayoff && !minPayoff.neverPaysOff ? ' Paying only this much each month, it takes ' + plural(minPayoff.months, 'month') + ' and ' + inr(minPayoff.interest) + ' in interest to clear.' : '') + ' This is how the card trap starts.</span>' +
          '<div><button data-action="card-pay" data-id="' + esc(c.id) + '" data-amount="' + st.minLeft + '">I paid the minimum</button></div></div>'
        : '') +

      '<div class="choice' + (p.suggested === 'part' ? ' suggested' : '') + '"><span class="choice-title">Pay part' + sug('part') + '</span>' +
      '<span class="choice-detail">Pay as much as you can now; the rest costs ' + p.rate + '% a year until it’s paid.</span>' +
      '<div class="row"><label class="field grow-field" for="card-part-' + esc(c.id) + '"><span>Amount (₹)</span><input id="card-part-' + esc(c.id) + '" type="number" inputmode="numeric" min="1" value="' + p.payNow + '"></label>' +
      '<button data-action="card-pay-part" data-id="' + esc(c.id) + '">I paid this</button></div></div>' +

      '<div class="choice' + (p.suggested === 'emi' ? ' suggested' : '') + '"><span class="choice-title">Convert to EMI' + sug('emi') + '</span>' +
      '<span class="choice-detail">Check the bank’s offer: rate, months and processing fee.</span>' +
      '<div class="form-grid">' +
      '<label class="field" for="emi-amount"><span>Amount (₹)</span><input id="emi-amount" data-emi="emiAmount" type="number" inputmode="numeric" min="1" value="' + emiAmount + '"></label>' +
      '<label class="field" for="emi-rate"><span>Interest (% a year)</span><input id="emi-rate" data-emi="rate" type="number" inputmode="decimal" min="0" value="' + ui.cardPlan.emi.rate + '"></label>' +
      '<label class="field" for="emi-months"><span>Months</span><select id="emi-months" data-emi="months">' + [3, 6, 9, 12, 18, 24].map((m) => '<option' + (Number(ui.cardPlan.emi.months) === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label>' +
      '<label class="field" for="emi-fee"><span>Processing fee (₹)</span><input id="emi-fee" data-emi="fee" type="number" inputmode="numeric" min="0" value="' + ui.cardPlan.emi.fee + '"></label>' +
      '</div>' +
      '<div class="summary">' +
      '<div class="line"><span>EMI</span><span>' + q.months + ' × ' + inr(q.emi) + '</span></div>' +
      '<div class="line"><span>Interest + fee</span><span>' + inr(q.cost) + '</span></div>' +
      '<div class="line"><span>Same payments, left on the card</span><span>' + (rq.neverPaysOff ? 'never cleared' : inr(rq.cost) + ' interest') + '</span></div>' +
      '<div class="line total"><span>' + (diff >= 0 ? 'EMI saves' : 'EMI costs more by') + '</span><span class="' + (diff >= 0 ? 'good' : 'bad') + '">' + inr(Math.abs(diff)) + '</span></div></div>' +
      '<span class="choice-detail">An EMI is still a loan: ' + q.months + ' payments of ' + inr(q.emi) + ' are added to every month’s plan until it’s cleared.</span>' +
      '<div><button data-action="card-emi" data-id="' + esc(c.id) + '">Convert ' + inr(emiAmount) + ' to EMI</button></div></div>' +
      '</div>';
  }

  function cardForm() {
    const c = ui.cardForm.id ? state.cards.find((x) => x.id === ui.cardForm.id) : {};
    const f = (id, label, type, value, extra) => '<label class="field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="' + type + '"' +
      (type === 'number' ? ' inputmode="numeric" min="0"' : '') + ' value="' + esc(value == null ? '' : value) + '"' + (extra || '') + '></label>';
    return '<div class="card-form"><h3>' + (c.id ? 'Edit ' + cardLabel(c) : 'Add a credit card') + '</h3>' +
      '<div class="form-grid">' +
      f('cf-name', 'Name', 'text', c.name || '', ' placeholder="HDFC card"') +
      f('cf-last4', 'Last 4 digits', 'text', c.last4 || '', ' inputmode="numeric" maxlength="4" placeholder="1234"') +
      f('cf-limit', 'Credit limit (₹)', 'number', c.limit || '') +
      f('cf-rate', 'Interest (% a year)', 'number', c.rate || 42) +
      f('cf-stmt', 'Statement day', 'number', c.statementDay || '', ' max="31" placeholder="5"') +
      f('cf-due', 'Due day', 'number', c.dueDay || '', ' max="31" placeholder="25"') +
      '</div>' +
      (c.id ? '' :
        '<p class="hint">What you owe right now, from your card app or last statement:</p><div class="form-grid">' +
        f('cf-owed', 'Amount due on last statement (₹)', 'number', '') +
        f('cf-owed-due', 'Its due date', 'date', '') +
        f('cf-unbilled', 'Spent since that statement (₹)', 'number', '') + '</div>') +
      (ui.cardForm.error ? '<p class="bad">' + esc(ui.cardForm.error) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="card-save">' + (c.id ? 'Save' : 'Add card') + '</button>' +
      '<button class="ghost" data-action="card-cancel">Cancel</button>' +
      (c.id ? '<span class="spacer"></span><button class="danger" data-action="card-remove" data-id="' + esc(c.id) + '">Remove card</button>' : '') + '</div></div>';
  }

  function saveCard() {
    const v = (id) => (document.getElementById(id) || {}).value || '';
    const name = v('cf-name').trim();
    const last4 = v('cf-last4').replace(/\D/g, '');
    const day = (x) => Math.min(31, Math.max(1, Math.round(Number(x) || 0)));
    if (!name) { ui.cardForm.error = 'Give the card a name, like “HDFC card”.'; return; }
    if (last4.length !== 4) { ui.cardForm.error = 'Enter the last 4 digits of the card number, so bank SMS can be matched to it.'; return; }
    if (!Number(v('cf-stmt')) || !Number(v('cf-due'))) { ui.cardForm.error = 'Enter the statement day and due day from your card statement.'; return; }
    if ((state.cards || []).some((c) => c.last4 === last4 && c.id !== ui.cardForm.id)) { ui.cardForm.error = 'You already have a card ending ' + last4 + '.'; return; }
    const fields = { name, last4, limit: Math.max(0, Number(v('cf-limit')) || 0), rate: Number(v('cf-rate')) || 42, statementDay: day(v('cf-stmt')), dueDay: day(v('cf-due')) };
    state.cards = state.cards || [];
    let card = ui.cardForm.id ? state.cards.find((c) => c.id === ui.cardForm.id) : null;
    if (card) Object.assign(card, fields);
    else {
      card = Object.assign({ id: uid(), created: today(), setupStatement: Math.max(0, Number(v('cf-owed')) || 0), setupDueDate: v('cf-owed-due') || null, setupUnbilled: Math.max(0, Number(v('cf-unbilled')) || 0) }, fields);
      state.cards.push(card);
    }
    // SMS recorded before the card was added: link them now.
    state.transactions.forEach((x) => { if (x.paidFrom === 'card:' + last4) { x.paidFrom = card.id; } });
    ui.cardForm = null;
    save();
    toast(card.name + ' saved');
  }

  // Interest leaking out every day, at the top of the Debts tab.
  function leakBanner() {
    const l = Core.interestLeak(state, today());
    if (l.daily < 1) return '';
    const worst = l.items.filter((x) => x.daily > 0).sort((a, b) => b.daily - a.daily);
    return '<section class="leak-banner' + (l.high ? '' : ' amber') + '"><h2>You are losing ' + inr(l.daily) + '/day to bank interest</h2>' +
      '<span class="hint">That’s ' + inr(l.monthly) + ' a month. Biggest: ' + worst.slice(0, 2).map((x) => esc(x.name) + ' (' + inr(x.daily) + '/day at ' + x.rate + '%)').join(', ') + '.</span></section>';
  }

  // Shown when a card payment is added: it's borrowed money.
  function cardSpendWarning(tx) {
    const c = (state.cards || []).find((x) => x.id === tx.paidFrom);
    if (!c) return inr(tx.amount) + ' added';
    const st = Core.cardStatus(state, c, today());
    const z = Core.zoneStatus(state, today());
    return 'Borrowed ' + inr(tx.amount) + ' on ' + c.name + '. Counted as spent today; next bill so far ' + inr(st.unbilled) + '.' +
      (z.zone !== 'green' ? ' You’re not in the green: this lands on next month’s salary.' : '');
  }

  // Card bills due within a week, or overdue, and this cycle's card spending.
  function cardHomeNotes(cyc) {
    const t = today();
    const cards = state.cards || [];
    if (!cards.length) return '';
    let html = '';
    cards.forEach((c) => {
      const st = Core.cardStatus(state, c, t);
      if (st.remaining > 0 && (st.overdue || st.daysToDue <= 7)) {
        html += '<div class="callout ' + (st.overdue ? 'bad' : 'warn') + '"><b>' + cardLabel(c) + ' bill: ' + inr(st.remaining) +
          (st.overdue ? ' was due ' + fmtDate(st.due) : ' due ' + (st.daysToDue === 0 ? 'today' : st.daysToDue === 1 ? 'tomorrow' : 'in ' + plural(st.daysToDue, 'day'))) + '</b>' +
          '<span class="hint">Pay it in full to avoid interest. The money was kept aside when you spent it.</span>' +
          '<div><button class="primary" data-action="tab" data-tab="debts">Plan payment</button></div></div>';
      }
    });
    const onCards = state.transactions.filter((x) => Core.isFlexible(x) && x.paidFrom && x.paidFrom !== 'account' && Core.inCycle(x.date, cyc))
      .reduce((a, x) => a + x.amount, 0);
    if (onCards) {
      html += '<p class="hint card-note">' + inr(onCards) + ' spent on credit cards this month. It’s counted as spent and kept aside for the bills.</p>';
    }
    return html;
  }

  function viewDebts() {
    const t = today();
    const debts = state.debts.filter((d) => Number(d.balance) > 0);
    const extra = Core.allocate(state, t).savings.debtExtra;
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
      leakBanner() +
      cardsSection() +
      '<section class="card"><div class="card-head"><h2>Loans</h2><span class="hint">Update balances from each statement</span></div>' +
      (state.debts.length ? '' : '<p class="hint">No loans added. Add personal loans, EMIs or other debts to see what they cost. Credit cards go in the section above.</p>') +
      '<div class="edit-rows">' + state.debts.map((d) =>
        '<div class="edit-row cols-debt">' + listField('debts', d, 'name', 'Name', 'text') + listField('debts', d, 'balance', 'Balance (₹)', 'number') +
        listField('debts', d, 'rate', 'Interest %/yr', 'number') + listField('debts', d, 'minPayment', 'Monthly min (₹)', 'number') +
        listField('debts', d, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('debts', d) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="debts">Add loan</button></div>' +
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

    const movedThisCycle = state.transactions.filter((x) => Core.isMove(x) && Core.inCycle(x.date, cyc)).reduce((a, x) => a + x.amount, 0);
    const setAside = [
      ['Emergency fund', p.emergency], ['Extra toward debts', p.debtExtra], ['Grow budget', p.invest], ['Yearly costs', p.sinking],
    ].filter((x) => x[1] > 0);

    return (
      (movedThisCycle ? '<div class="callout good"><b>' + inr(movedThisCycle) + ' saved from daily leftovers this month</b><span class="hint">Every unspent day you move to savings or a loan gets you closer to a loan-free life.</span></div>' : '') +
      '<section class="card"><div class="card-head"><h2>This month’s set-aside</h2><span class="hint">Cycle starting ' + fmtDate(cyc.start) + '</span></div>' +
      (setAside.length
        ? '<div class="summary">' + setAside.map((x) => '<div class="line"><span>' + x[0] + '</span><span>' + inr(x[1]) + '</span></div>').join('') + '</div>' +
          (recorded
            ? '<p class="good">Recorded for this cycle. Your balances below include it.</p>'
            : '<div><button class="primary" data-action="record-savings">I’ve moved this money aside</button></div>')
        : '<p class="hint">Nothing set aside yet. Add amounts in the Plan tab.</p>') +
      '</section>' +

      '<section class="card">' + freedomHeader() +
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
      case 'bills': return { id: uid(), name: '', estimate: 0, everyMonths: 1, nextDue: today() };
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
      case 'sms-clean': {
        const date = document.getElementById('sms-clean-date').value || t;
        ui.smsClean = { date, count: state.transactions.filter((x) => x.source === 'sms' && x.date < date).length };
        break;
      }
      case 'sms-clean-cancel': ui.smsClean = null; break;
      case 'sms-clean-confirm': {
        const date = ui.smsClean.date;
        const removed = state.transactions.filter((x) => x.source === 'sms' && x.date < date);
        removed.forEach((x) => { if (Core.isIncome(x)) undoIncomeUse(x); });
        state.transactions = state.transactions.filter((x) => !(x.source === 'sms' && x.date < date));
        ui.smsClean = null; save(); toast(plural(removed.length, 'entry', 'entries') + ' removed'); break;
      }
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
      case 'list-add':
        state[btn.dataset.list] = state[btn.dataset.list] || [];
        state[btn.dataset.list].push(listDefaults(btn.dataset.list)); save(); break;
      case 'list-remove':
        state[btn.dataset.list] = state[btn.dataset.list].filter((x) => x.id !== btn.dataset.id); save(); break;
      case 'tx-filter': ui.txFilter = btn.dataset.filter; break;
      case 'tx-delete': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx && (Core.isIncome(tx) || Core.isMove(tx))) undoIncomeUse(tx);
        if (tx && Core.isBillPayment(tx)) Core.undoBillPayment(state, tx);
        if (tx && tx.fromFund) state.savings.emergencyBalance = (Number(state.savings.emergencyBalance) || 0) + tx.amount;
        if (tx && tx.kind === 'cardconvert') Core.undoCardConvert(state, tx);
        state.transactions = state.transactions.filter((x) => x.id !== btn.dataset.id); save(); toast('Deleted'); break;
      }
      case 'tx-kind': ui.txKind = btn.dataset.kind; break;
      case 'payday-save': savePayday(document.getElementById('pay-amount').value); break;
      case 'payday-same': savePayday(state.settings.salary); break;
      case 'payday-open': ui.paydayOpen = true; break;
      case 'payday-close': ui.paydayOpen = false; break;
      case 'card-add': ui.cardForm = {}; break;
      case 'card-edit': ui.cardForm = { id: btn.dataset.id }; break;
      case 'card-cancel': ui.cardForm = null; break;
      case 'card-save': saveCard(); break;
      case 'card-remove': ui.cardRemove = btn.dataset.id; ui.cardForm = null; break;
      case 'card-remove-cancel': ui.cardRemove = null; break;
      case 'card-remove-confirm':
        state.cards = state.cards.filter((c) => c.id !== btn.dataset.id);
        ui.cardRemove = null; save(); toast('Card removed'); break;
      case 'card-plan':
        ui.cardPlan = ui.cardPlan && ui.cardPlan.cardId === btn.dataset.id ? null : { cardId: btn.dataset.id, emi: { rate: 22, months: 6, fee: 0 }, emiAmount: 0 };
        break;
      case 'card-pay':
      case 'card-pay-part': {
        const id = btn.dataset.id;
        const amount = a === 'card-pay' ? Number(btn.dataset.amount) : Number(document.getElementById('card-part-' + id).value);
        if (!(amount > 0)) { toast('Enter the amount you paid'); return; }
        Core.recordCardPayment(state, id, amount, t);
        const st = Core.cardStatus(state, state.cards.find((c) => c.id === id), t);
        ui.cardPlan = null; save();
        toast(st.remaining ? inr(amount) + ' paid. ' + inr(st.remaining) + ' still to pay by ' + fmtDate(st.due) + '.' : 'Bill paid in full. No interest this month.');
        break;
      }
      case 'card-emi': {
        const id = btn.dataset.id;
        const c = state.cards.find((x) => x.id === id);
        const st = Core.cardStatus(state, c, t);
        const amount = Math.min(st.remaining, ui.cardPlan.emiAmount || Core.cardBillPlan(state, id, t, ui.cardPlan.emi).rest || st.remaining);
        const res = Core.convertCardBalance(state, id, amount, Object.assign({ kind: 'emi' }, ui.cardPlan.emi), t);
        if (!res) return;
        ui.cardPlan = null; save();
        toast(inr(amount) + ' moved to an EMI: ' + res.debt.months + ' × ' + inr(res.debt.minPayment) + ' a month, in your plan from next month.');
        break;
      }
      case 'card-revolve': {
        const c = state.cards.find((x) => x.id === btn.dataset.id);
        const st = Core.cardStatus(state, c, t);
        const res = Core.convertCardBalance(state, c.id, st.remaining, { kind: 'revolve' }, t);
        if (!res) return;
        save(); toast(inr(st.remaining) + ' moved to your loans. See the payoff plan below.');
        break;
      }
      case 'bill-pay-open': ui.payBill = btn.dataset.id; break;
      case 'bill-pay-cancel': ui.payBill = null; break;
      case 'bill-pay-save': {
        const id = btn.dataset.id;
        const amount = Number(document.getElementById('bill-amt-' + id).value) || 0;
        const months = Number(document.getElementById('bill-months-' + id).value) || 1;
        if (amount <= 0) { toast('Enter the amount you paid'); return; }
        if (!Core.payBill(state, id, amount, months, t)) return;
        ui.payBill = null; save();
        toast(inr(amount) + ' paid. Next due ' + fmtDate(state.bills.find((x) => x.id === id).nextDue, true));
        break;
      }
      case 'bill-link': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        const billId = document.getElementById('bill-link-' + btn.dataset.id).value;
        const b = (state.bills || []).find((x) => x.id === billId);
        if (!tx || !b) return;
        state.transactions = state.transactions.filter((x) => x !== tx);
        const paid = Core.payBill(state, billId, tx.amount, b.everyMonths, tx.date);
        Object.assign(paid, { note: tx.note || b.name, source: tx.source, smsKey: tx.smsKey });
        save(); toast('Linked to ' + b.name); break;
      }
      case 'fixed-to-bill': {
        const f = state.fixed.find((x) => x.id === document.getElementById('fixed-to-bill').value);
        if (!f) return;
        const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
        state.bills = state.bills || [];
        state.bills.push({ id: uid(), name: f.name, estimate: Number(f.amount) || 0, everyMonths: 1, nextDue: Core.occurrenceInCycle(Number(f.dueDay) || 1, cyc) || t });
        state.fixed = state.fixed.filter((x) => x !== f);
        save(); toast(f.name + ' moved to bills that vary'); break;
      }
      case 'zone-fund': {
        const amount = Number(btn.dataset.amount) || 0;
        state.transactions.push({ id: uid(), kind: 'in', date: t, amount, category: 'From emergency fund', note: 'Emergency fund', source: 'manual', useFor: 'spend', fromFund: true });
        state.savings.emergencyBalance = Math.max(0, (Number(state.savings.emergencyBalance) || 0) - amount);
        save(); toast(inr(amount) + ' moved from your emergency fund'); break;
      }
      case 'zone-pause': {
        const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
        state.adjustment = { until: cyc.next, flexCutPct: 0, pauseInvest: true, pauseDebtExtra: true, reason: 'Short this month' };
        save(); toast('Paused until payday'); break;
      }
      case 'save-day': {
        const tx = { id: uid(), kind: 'move', date: t, amount: Number(btn.dataset.amount) || 0, category: 'Saved', note: 'Unspent on ' + fmtDate(btn.dataset.date), source: 'manual', useFor: null };
        state.transactions.push(tx);
        setIncomeUse(tx, btn.dataset.use, btn.dataset.debt);
        state.days[btn.dataset.date].prompted = true;
        save(); celebrate(rewardMessage(btn.dataset.use, tx.amount, btn.dataset.debt, true)); break;
      }
      case 'save-day-keep': state.days[btn.dataset.date].prompted = true; save(); break;
      case 'tx-confirm': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx) {
          tx.needsReview = false;
          const key = Core.normalizeMerchant(tx.note);
          if (key && tx.note !== 'Bank payment') state.merchantRules[key] = tx.category;
          save(); toast('Saved');
        }
        break;
      }
      case 'tx-not-payment': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx) {
          if (tx.smsKey) state.smsIgnored = (state.smsIgnored || []).concat(tx.smsKey).slice(-500);
          state.transactions = state.transactions.filter((x) => x !== tx);
          save(); toast('Left out');
        }
        break;
      }
      case 'alerts-on': enableAlerts(); return;
      case 'alerts-off':
        state.smsAlerts = false; save();
        if (SmsInbox) Promise.resolve().then(() => SmsInbox.disableAlerts()).catch(() => {});
        toast('Notifications off'); break;
      case 'income-use': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx) {
          setIncomeUse(tx, btn.dataset.use, btn.dataset.debt);
          save();
          if (btn.dataset.use === 'spend') toast(INCOME_USE_LABELS.spend);
          else celebrate(rewardMessage(btn.dataset.use, tx.amount, btn.dataset.debt, false));
        }
        break;
      }
      case 'income-change': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx) { undoIncomeUse(tx); tx.useFor = null; save(); window.scrollTo(0, 0); render(); }
        return;
      }
      case 'sms-sample':
        ui.smsText = SAMPLE_SMS.replace(/\{d1\}/g, fmtSmsDate(Core.addDays(t, -1))).replace(/\{d2\}/g, fmtSmsDate(t));
        ui.smsRows = null; break;
      case 'sms-read': ui.smsText = document.getElementById('sms-text').value; readSms(); break;
      case 'sms-clear': ui.smsText = ''; ui.smsRows = null; markSmsSeen(); save(); break;
      case 'sms-native': readNativeSms(false); break;
      case 'sms-import': {
        let added = 0;
        const recorded = knownSmsKeys();
        ui.smsRows.forEach((r) => {
          if (!r.checked || !r.parsed || recorded.has(r.key)) return;
          if (recordSms(r.parsed, { key: r.key, category: r.parsed.category })) added++;
        });
        ui.smsRows = null; ui.smsText = ''; markSmsSeen(); save(); toast(plural(added, 'item') + ' added'); break;
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
        const sv = Core.allocate(state, today()).savings;
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
      else if (f === 'nextDue') item.nextDue = el.value || today();
      else {
        let v = Math.max(0, Number(el.value) || 0);
        if (f === 'dueDay') v = Math.min(31, Math.max(1, Math.round(v) || 1));
        item[f] = v;
        if (el.dataset.list === 'budgets' && f === 'amount') item.auto = false;
      }
      save(); refreshAfterEdit(); return;
    }
    if (el.id === 'tx-from') {
      const warn = document.getElementById('tx-from-warn');
      if (warn) { warn.textContent = borrowWarning(el.value); warn.hidden = el.value === 'account'; }
      return;
    }
    if (el.dataset.txFrom) {
      const tx = state.transactions.find((x) => x.id === el.dataset.txFrom);
      if (!tx) return;
      if (el.value === 'account') delete tx.paidFrom; else tx.paidFrom = el.value;
      save(); rerenderKeepScroll(); return;
    }
    if (el.dataset.emi) {
      ui.cardPlan[el.dataset.emi === 'emiAmount' ? 'emiAmount' : 'emi'] = el.dataset.emi === 'emiAmount'
        ? Number(el.value) || 0
        : Object.assign({}, ui.cardPlan.emi, { [el.dataset.emi]: Number(el.value) || 0 });
      const panel = document.getElementById('card-plan');
      const c = state.cards.find((x) => x.id === ui.cardPlan.cardId);
      if (panel && c) panel.innerHTML = cardPlanPanel(c);
      return;
    }
    if (el.dataset.txCat) {
      const tx = state.transactions.find((x) => x.id === el.dataset.txCat);
      if (!tx) return;
      tx.category = el.value;
      if (tx.needsReview) { tx.needsReview = false; rerenderKeepScroll(); }
      if (Core.isIncome(tx)) { save(); return; }
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
    if (el.id === 'pay-amount') {
      const box = document.getElementById('pay-reason');
      const cyc = Core.cycleFor(today(), Number(state.settings.payday) || 1);
      if (box) box.innerHTML = paydayReason(el.value, (state.payslips || {})[cyc.start]);
      return;
    }
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
    const category = document.getElementById('tx-category').value;
    const tx = { id: uid(), date: document.getElementById('tx-date').value || today(), amount, category, note, source: 'manual' };
    if (ui.txKind === 'in') { tx.kind = 'in'; tx.useFor = null; }
    const from = document.getElementById('tx-from');
    if (ui.txKind !== 'in' && from && from.value !== 'account') tx.paidFrom = from.value;
    state.transactions.push(tx);
    save();
    toast(ui.txKind === 'in' ? inr(amount) + ' received. Choose what it should do.' : tx.paidFrom ? cardSpendWarning(tx) : inr(amount) + ' added to ' + category);
    if (ui.txKind === 'in') window.scrollTo(0, 0);
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
   * Reads messages newer than the last review (on first use, from the start
   * of today). Bank and UPI alerts come from
   * named senders (VM-HDFCBK, JD-SBIUPI), so messages from phone numbers are
   * skipped. `quiet` is the check on opening the app: no messages, no fuss.
   */
  function readNativeSms(quiet) {
    if (!SmsInbox || ui.smsBusy) return;
    ui.smsBusy = true;
    if (!quiet) rerenderKeepScroll();
    // The first read starts at midnight today, so only messages from the day
    // SMS access was given are offered, while they're easy to categorise.
    const since = state.smsReadUntil || Core.parseISO(today()).getTime();
    SmsInbox.read({ since, limit: 500 }).then((res) => {
      const msgs = (res.messages || []).filter((m) => /[A-Za-z]/.test(m.address || ''));
      ui.smsMaxDate = (res.messages || []).reduce((mx, m) => Math.max(mx, m.date), since);
      const rows = smsRows(msgs.map((m) => ({ text: m.body || '', day: Core.toISO(new Date(m.date)) })))
        .filter((r) => r.parsed && !r.duplicate && !r.parsed.salary);
      state.smsAuto = true;
      ui.smsBusy = false;
      if (rows.length) {
        ui.smsRows = rows;
        if (quiet) toast(plural(rows.length, 'new bank message') + ' to review in Spend');
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

  // ---------- home-screen widget (Android app only) ----------

  let widgetSent = '';

  // Tells the widget what is left today and which categories to offer.
  function syncWidget() {
    if (!SpendWidget || !state.settings.salary) return;
    const r = Core.projectRunway(state, today());
    const payload = {
      left: Math.round(r.leftToday - r.overToday),
      date: today(),
      categories: categories().filter((c) => c !== 'Emergency'),
      // Tomorrow's safe amount = pool / daysAfter; the widget lowers the pool as you overspend.
      tomorrowPool: Math.round(r.tomorrowAllowance * r.remainingDays),
      daysAfter: r.remainingDays,
    };
    const key = JSON.stringify(payload);
    if (key === widgetSent) return;
    widgetSent = key;
    // A widget problem must never stop the app, so errors are swallowed.
    Promise.resolve().then(() => SpendWidget.update(payload)).catch(() => { widgetSent = ''; });
  }

  /*
   * Saves expenses added from the widget, then clears them from the widget's
   * queue. Ids stop an entry being added twice if the app closes in between.
   */
  function collectWidgetExpenses() {
    if (!SpendWidget) return Promise.resolve();
    return Promise.resolve().then(() => SpendWidget.getQueued()).then((res) => {
      const entries = res.entries || [];
      if (!entries.length) return null;
      const have = new Set(state.transactions.map((x) => x.id));
      entries.forEach((e) => {
        if (have.has(e.id)) return;
        state.transactions.push({
          id: e.id, date: e.date, amount: Math.round(Number(e.amount) || 0),
          category: e.category || 'Misc', note: e.note || '', source: 'widget',
        });
      });
      save();
      return SpendWidget.removeQueued({ ids: entries.map((e) => e.id) }).then(() => {
        toast(plural(entries.length, 'expense') + ' added from the widget');
        rerenderKeepScroll();
      });
    }).catch(() => {});
  }

  // ---------- alerts for new bank SMS (Android app only) ----------

  function enableAlerts() {
    if (!SmsInbox) return;
    Promise.resolve().then(() => SmsInbox.enableAlerts()).then((res) => {
      state.smsAlerts = true;
      alertsSent = '';
      save();
      toast(res && res.notifications === false
        ? 'On. Notifications are off for this app in Android settings, so payments will wait here.'
        : 'You’ll get a notification for each new bank SMS');
      rerenderKeepScroll();
    }, () => toast('SMS permission is needed for this. You can allow it in Android settings.'));
  }

  let alertsSent = '';

  // Gives the notification pop-up the same categories and learned shops as the app.
  function syncAlerts() {
    if (!SmsInbox || !state.smsAlerts) return;
    const payload = {
      categories: categories().filter((c) => c !== 'Emergency'),
      incomeCategories: INCOME_CATEGORIES,
      rules: state.merchantRules,
      cards: (state.cards || []).map((c) => ({ id: c.id, name: c.name, last4: c.last4 || '' })),
    };
    const key = JSON.stringify(payload);
    if (key === alertsSent) return;
    alertsSent = key;
    Promise.resolve().then(() => SmsInbox.syncAlerts(payload)).catch(() => { alertsSent = ''; });
  }

  /*
   * Saves bank SMS caught while the app was closed. Ones checked in the
   * pop-up are saved as they are; unchecked payments are saved and marked
   * "needs your check"; ones marked "not a payment" are remembered so the
   * inbox reader doesn't offer them again.
   */
  function collectAlerts() {
    if (!SmsInbox) return Promise.resolve();
    return Promise.resolve().then(() => SmsInbox.getAlerts()).then((res) => {
      const items = (res && res.items) || [];
      if (!items.length) return null;
      const known = new Set(state.transactions.map((x) => x.smsKey).filter(Boolean));
      let added = 0;
      items.forEach((it) => {
        if (known.has(it.key)) return;
        if (it.status === 'ignored') {
          state.smsIgnored = (state.smsIgnored || []).concat(it.key).slice(-500);
          return;
        }
        // The app's own reader is the reference: it re-reads the text for card details.
        const parsed = Core.parseSms(it.body || '', state.merchantRules, it.date) ||
          { type: it.type, amount: Math.round(Number(it.amount) || 0), merchant: it.merchant, category: it.category, date: it.date, paidFrom: it.paidFrom, last4: it.last4 };
        parsed.date = it.date;
        const confirmed = it.status === 'confirmed';
        if (recordSms(parsed, {
          key: it.key,
          review: !confirmed,
          category: confirmed ? it.category : null,
          note: it.note || null,
          cardId: confirmed ? it.cardId || null : null,
        })) added++;
      });
      save();
      return SmsInbox.removeAlerts({ keys: items.map((it) => it.key) }).then(() => {
        if (added) toast(plural(added, 'bank SMS', 'bank SMS') + ' recorded');
      });
    }).catch(() => {});
  }

  // Drops review rows for messages already recorded another way (e.g. from a notification).
  function pruneSmsRows() {
    if (!ui.smsRows) return;
    const known = new Set(state.transactions.map((x) => x.smsKey).filter(Boolean).concat(state.smsIgnored || []));
    ui.smsRows = ui.smsRows.filter((r) => !known.has(r.key));
    if (!ui.smsRows.length) ui.smsRows = null;
  }

  // Everything to pick up when the app opens or comes back to the front.
  function collectNative() {
    return collectWidgetExpenses().then(collectAlerts).then(() => {
      pruneSmsRows();
      if (state.smsAuto && !ui.smsRows) readNativeSms(true);
      else rerenderKeepScroll();
    });
  }

  if (NATIVE) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') collectNative();
    });
  }

  state = load();
  if (NATIVE) collectNative();
  const fromHash = (location.hash || '').replace('#', '');
  tab = TABS.indexOf(fromHash) !== -1 ? fromHash : 'home';
  render();
})();
