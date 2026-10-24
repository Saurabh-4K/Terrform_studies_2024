/*
 * Salary Runway: user interface.
 * Everything is stored in this browser's localStorage. Nothing is sent anywhere.
 */
(function () {
  'use strict';

  const Core = window.Core;
  const Demo = window.Demo;
  const I18N = window.I18N;
  // Translate: the English text is the key (see i18n.js).
  const tr = I18N.t;
  Core.setTranslator(tr, (iso) => fmtDate(iso));
  const KEY = 'salary-runway-v1';
  const LANG_KEY = 'salary-runway-lang';
  const TABS = ['home', 'spend', 'plan', 'debts', 'grow'];
  const EMERGENCY_TYPES = [
    'Medical', 'Vehicle repair', 'Family function', 'Death in family', 'Tax payment',
    'Penalty or fine', 'Home repair', 'Job loss', 'Other',
  ];
  const INCOME_CATEGORIES = ['Money received', 'Money returned', 'From family', 'Refund', 'Cashback', 'Side income', 'Gift', 'Loan or Pay Later'];
  // Money in that has to be paid back: counted as borrowed, never as income to save or invest.
  const LOAN_CATEGORY = 'Loan or Pay Later';
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
  // Twelve months, for lists; names come from monthName().
  const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => i);
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
        ? tr(now - was === 1 ? 'Nice move! +{n} day of freedom ({now} now).' : 'Nice move! +{n} days of freedom ({now} now).', { n: now - was, now })
        : tr('Nice move! {amount} closer to your next day of freedom.', { amount: inr(amount) });
    }
    if (use === 'debt') {
      const d = state.debts.find((x) => x.id === debtId);
      const saved = d ? (amount * (Number(d.rate) || 0)) / 100 : 0;
      return tr('Nice move! Saves about {amount} in interest a year.', { amount: inr(saved) }) +
        (daily ? ' ' + tr('Do this daily and it’s {amount} a month.', { amount: inr(amount * 30) }) : '');
    }
    if (use === 'grow') return tr('Nice move! {amount} set aside to invest.', { amount: inr(amount) });
    return tr(INCOME_USE_LABELS[use] || 'Saved');
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
    help: null,
    helpFrom: null,
    borrow: null,
    rolloverHidden: false,
    report: false,
    reportHidden: false,
    reportFocused: false,
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
    return Core.parseISO(iso).toLocaleDateString(I18N.locale(), opts);
  }

  function monthYear(iso) {
    return Core.parseISO(iso).toLocaleDateString(I18N.locale(), { month: 'short', year: 'numeric' });
  }

  // Short month name in the current language; i is 0–11.
  function monthName(i) {
    return new Date(2026, i, 1).toLocaleDateString(I18N.locale(), { month: 'short' });
  }

  // "1 day", "3 days": the dictionaries hold "{n} day" and "{n} days".
  function plural(n, word, many) { return tr('{n} ' + (n === 1 ? word : many || word + 's'), { n }); }

  // Built-in category and type names are stored in English and shown translated.
  function label(name) { return tr(name); }
  // Typed into a name field: a translated built-in name goes back to its English key.
  function fromLabel(v, known) {
    const hit = (known || []).find((k) => tr(k) === v);
    return hit || v;
  }

  // Category names the app ships with: stored in English, shown translated.
  const BUILT_IN_CATEGORIES = Core.DEFAULT_SPLIT.map(([name]) => name).concat(['Bills', 'Savings', 'Misc', 'Emergency']);

  function categories() {
    const names = state.budgets.map((b) => b.name).filter(Boolean);
    ['Bills', 'Savings', 'Misc', 'Emergency'].forEach((n) => { if (names.indexOf(n) === -1) names.push(n); });
    return names;
  }

  function incomeCategoryOptions(selected) {
    const list = INCOME_CATEGORIES.slice();
    if (selected && list.indexOf(selected) === -1) list.push(selected);
    return list.map((c) => '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(label(c)) + '</option>').join('');
  }

  function categoryOptions(selected) {
    const list = categories();
    if (selected && list.indexOf(selected) === -1) list.push(selected);
    return list.map((c) => '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(label(c)) + '</option>').join('');
  }

  function toast(msg, kind) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.setAttribute('role', 'status');
    el.textContent = tr(msg);
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

  // How-to text, kept behind an (i) button so the screens show numbers, not instructions.
  const HELP = {
    runway: ['How the Runway works', [
      'The graph shows your balance from payday to payday. <b>If you keep this pace</b> follows how you’ve spent so far; <b>If you keep to budget</b> follows your plan.',
      '<b>Green:</b> at this pace, your money lasts until payday. <b>Careful:</b> bills and basics are covered, but this pace runs out early. <b>Red:</b> the money left doesn’t cover the bills and basics still to come (the red band on the graph).',
      '<b>Left to spend today</b> is what you can spend today and still reach payday. Money you move to savings today counts against it, since you can’t spend it any more.',
    ]],
    payday: ['Payday check-in', [
      'Pay isn’t the same every month. Record what came in and why it changed: a bonus, tax, leave or a deduction. This month’s budgets are planned on what actually came in.',
      'A lasting change, like a raise or a new tax slab? Tick <b>This is my new usual pay</b>.',
      'Your pay over the year is on the Plan tab.',
    ]],
    add: ['Money out, in and saved', [
      '<b>Money out:</b> anything you paid. If you paid by credit card, pick the card in <b>Paid from</b>; it counts as spent today.',
      '<b>Money in:</b> money returned to you, money from home, a refund, cashback or side income. Your salary is already counted. The app asks what each amount should do.',
      '<b>Saved:</b> money you moved to Jar, a recurring deposit, a SIP or gold. It leaves your account but isn’t spending. It counts against today’s amount, since you can’t spend it any more.',
    ]],
    sms: ['Bank SMS', [
      'The app reads bank and UPI messages on this phone to record payments. Messages never leave the phone, and you review every payment before it is added.',
      'Only today’s messages are read. Each time you open the app, today’s new messages are checked; earlier days are never added.',
      '<b>Notifications:</b> each new payment is recorded as it arrives and a notification asks you to check its category. Payments you don’t check wait under <b>Needs your check</b>.',
      'In the browser version, paste the messages instead. They are read right here on your device.',
    ]],
    payments: ['Payments', [
      'Change a category and the app remembers it for that shop next time.',
      'Delete a payment with ✕. Money in and saved entries can be changed from here too.',
    ]],
    salary: ['Salary and balance', [
      'Enter your monthly salary in hand and the day it arrives.',
      'Starting in the middle of the month? Enter the money in your account this morning, so the graph starts from the right amount. The app can’t see earlier spending.',
    ]],
    fixed: ['Fixed payments', [
      'Payments that are the same every month: rent, EMIs, subscriptions. They leave on their due day.',
      'Credit cards and loans with a balance go in the Debts tab. Their minimum payments are counted automatically.',
    ]],
    bills: ['Bills that vary', [
      'For bills whose amount changes, or that you sometimes pay for several months at once.',
      'A share is set aside every month, so a 3-month recharge doesn’t hit one month hard.',
      'When you pay, enter what you actually paid and how long it covers. The app learns the usual amount from your last three payments.',
    ]],
    setaside: ['Set aside each month', [
      'Taken out on payday, before spending: emergency fund first, then extra toward costly loans, then the Grow budget.',
      'The Grow budget is money you plan to invest. Talk to a SEBI-registered investment adviser about where. This app only helps you set the amount aside.',
      'Moved it? Tap <b>I’ve moved this money aside</b> on the Grow tab, or lock it in at the payday reset. A Jar or savings SMS for the same amount joins it instead of counting twice.',
    ]],
    yearly: ['Yearly costs', [
      'Costs you know are coming: festivals, insurance, servicing, school fees.',
      'Saving a little each month means they don’t become emergencies or loans.',
    ]],
    flex: ['Flexible budgets', [
      'What is left of your salary is shared out across these automatically.',
      'Type your own amount and that category is marked <b>Set by you</b>. The automatic ones adjust to fit. <b>Share everything out automatically</b> undoes your edits.',
    ]],
    data: ['Your data', [
      'Everything is saved on this device only. Nothing is uploaded.',
      'Copy a backup to move to another phone, or before uninstalling: uninstalling deletes the app’s data.',
    ]],
    smsclean: ['Clean up SMS imports', [
      'Removes payments and money received that were added from SMS before the date you pick. Anything you added by hand stays.',
    ]],
    cards: ['Credit cards', [
      'Card spending is counted as spent the day it happens, so the money is kept aside for the bill. Paying the bill only moves it to the card.',
      'Each card shows the bill, the due date and how much of the limit you’re using.',
      '<b>Pay in full</b> whenever you can: no interest. The minimum keeps most of the interest running. EMI is suggested only when you can’t pay in full and it’s clearly cheaper.',
    ]],
    loans: ['Loans', [
      'Add personal loans, EMIs or other debts to see what they cost. Update balances from each statement.',
      'Credit cards usually charge 36–45% a year on unpaid balances. Paying only the minimum keeps most of that cost running.',
    ]],
    payoff: ['When will you be debt-free?', [
      '<b>Highest interest first</b> pays the least interest.',
      '<b>Smallest balance first</b> clears a loan sooner, which many people find motivating.',
      'When a loan is cleared, its payment moves to the next one.',
    ]],
    fund: ['Emergency fund', [
      '<b>Days of Freedom:</b> how many days your fund covers the basics (fixed payments, loan minimums, bills, groceries and health) with no salary.',
      'Keep this money somewhere you can reach within a day.',
      'Most debt cycles start with one surprise bill paid by credit card. This fund turns it into an inconvenience instead of a loan.',
    ]],
    emergency: ['Something unexpected', [
      'Medical bills, a car repair, a family function or a tax bill. Enter the cost and see how to absorb it without new debt.',
      'The emergency fund is used first, then this month’s money. Grow and extra debt payments pause and flexible budgets are cut until the gap is made back.',
    ]],
    invest: ['Where to invest', [
      '<b>Freedom first:</b> a 30-day emergency shield, then loans at 15%+ interest, then investing alongside the emergency fund until it reaches its target.',
      '<b>By when you need the money:</b> within a year: savings account, FD or liquid fund. 1–3 years: FD, RD or a short-duration debt fund. 3–5 years: a mix, or a balanced advantage fund. 5+ years: the split shown here.',
      '<b>The split:</b> equity is 100 minus your age (60% if you leave age empty), lower for low risk comfort and higher for high, plus 10% gold. The rest goes to safe debt like PPF.',
      '<b>Tax:</b> in the new tax regime (the default), PPF and ELSS give no 80C deduction, so choose them for returns and safety. In the old regime, up to ₹1.5 lakh a year in 80C lowers your tax.',
      'The projection assumes equity 11%, debt 7% and gold 8% a year. Nothing is guaranteed, and PPF and FD rates change: check before you invest.',
      'These are general rules of thumb for your own use, not personalised advice. Turn off Personal mode in the Plan tab before sharing the app.',
    ]],
    borrow: ['Before you borrow', [
      'Enter a big expense to see how to pay it without a loan.',
      '<b>Needed now</b> (a repair, a hospital bill): your emergency fund goes first, since that’s what it’s for. Then this month’s Grow and extra loan payment, then this month’s money down to bills and basics.',
      '<b>Can wait</b> (a purchase): whether it fits this month, what your next salary leaves free, and what saving for it costs next to an EMI.',
      'If you still have to borrow, borrow only the shortfall, and see what it costs first.',
      '<b>Borrowed this month</b> (under the Runway headline) counts credit card spending, which is borrowed until the bill is paid, and loan money received. A card bill paid in full by its due date costs no interest.',
    ]],
    rollover: ['Keep paying yourself', [
      'When a loan ends, you’re already used to living without its EMI. Sending that money to your next loan, your emergency fund or savings speeds up your freedom without changing how you live.',
      'The same works for a raise: send half to freedom before spending grows to match it.',
      'Kept amounts are added to your set-asides every payday. Stop any of them from the Plan tab.',
    ]],
    grow: ['Grow', [
      'Check that an adviser is registered on SEBI’s website: <a href="https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&amp;intmId=13" target="_blank" rel="noopener">sebi.gov.in → Intermediaries → Investment Advisers</a>.',
      'Salary Runway doesn’t recommend any adviser, product, bank or fund, and earns nothing from them.',
    ]],
  };

  function info(key) {
    return '<button class="info-btn" data-action="help" data-help="' + key + '" aria-label="' + esc(tr('Help: {topic}', { topic: tr(HELP[key][0]) })) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.25" fill="currentColor"/></svg></button>';
  }

  // A card title with its (i) button.
  function titled(title, key) {
    return '<div class="title-i"><h2>' + tr(title) + '</h2>' + info(key) + '</div>';
  }

  function helpModal() {
    const h = ui.help && HELP[ui.help];
    if (!h) return '';
    return '<div class="reset-modal-overlay help-overlay" role="presentation"><div class="reset-modal-card help-card" role="dialog" aria-modal="true" aria-labelledby="help-title" id="help-card">' +
      '<h2 id="help-title">' + tr(h[0]) + '</h2>' + h[1].map((x) => '<p>' + tr(x) + '</p>').join('') +
      '<div><button class="primary" data-action="help-close">' + tr('Got it') + '</button></div></div></div>';
  }

  function render() {
    const app = document.getElementById('app');
    const banner = state.isDemo
      ? '<div class="banner"><span>' + tr('You are looking at <b>example numbers</b>. Explore freely, then add your own.') + '</span>' +
        '<button class="primary" data-action="start-own">' + tr('Start with my numbers') + '</button></div>'
      : '';
    const views = { home: viewHome, spend: viewSpend, plan: viewPlan, debts: viewDebts, grow: viewGrow };
    app.innerHTML =
      '<div class="shell">' +
      '<header class="topbar"><div class="brand">' +
      '<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5 L21 19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/><circle cx="21" cy="19" r="2.5" fill="var(--bad)"/><circle cx="3" cy="5" r="2.5" fill="var(--accent)"/></svg>' +
      'Salary Runway</div><span class="privacy-chip">' + tr('Data stays on this device') + '</span></header>' +
      banner +
      '<main id="view" class="stack" style="gap:16px">' + views[tab]() + '</main>' +
      '<p class="disclaimer">' + tr(Core.personal(state)
        ? 'Personal mode: investment guidance here is general rules of thumb for your own use, not personalised advice.'
        : 'Salary Runway is a budgeting tool. It does not give investment advice and is not registered with SEBI or RBI.') + '</p>' +
      '</div>' +
      '<nav class="tabbar" aria-label="' + tr('Sections') + '"><div class="tabbar-inner">' +
      TABS.map((t) =>
        '<button data-action="tab" data-tab="' + t + '"' + (t === tab ? ' aria-current="page"' : '') + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[t] + '</svg>' + tr(TAB_LABELS[t]) + '</button>'
      ).join('') +
      '</div></nav>' + resetModal() + helpModal() + borrowModal() + reportModal();
    if (tab === 'home') drawRunway();
    if (ui.reset) {
      const first = document.querySelector('#reset-card input, #reset-card button.primary');
      if (first) first.focus();
    }
    if (document.getElementById('report-card') && !ui.reportFocused) {
      ui.reportFocused = true;
      document.getElementById('report-card').focus();
    }
    if (ui.borrow && ui.borrow.focus) {
      ui.borrow.focus = false;
      document.getElementById('borrow-card').focus();
    }
    if (ui.help) {
      document.querySelector('#help-card button.primary').focus();
    } else if (ui.helpFrom) {
      const back = document.querySelector('[data-help="' + ui.helpFrom + '"]');
      if (back) back.focus({ preventScroll: true });
      ui.helpFrom = null;
    }
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
      return '<section class="card"><h2>' + tr('Add your salary to see your runway') + '</h2>' +
        '<p class="hint">' + tr('Enter your monthly salary, payday and fixed payments. The graph will show the date your money runs out.') + '</p>' +
        '<div><button class="primary" data-action="tab" data-tab="plan">' + tr('Set up my plan') + '</button></div></section>';
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
      headline = tr('Red zone: <span class="date bad">{amount} short</span> for bills and basics', { amount: inr(z.shortBy) });
      sub = tr('The money left doesn’t cover the bills still to pay and groceries and health until {date}. Here’s how to stay above ₹0:', { date: fmtDate(cyc.next) });
    } else if (z.zone === 'amber') {
      headline = tr('Careful: at this pace, money runs out on <span class="date warn">{date}</span>', { date: fmtDate(r.zeroPace || Core.addDays(cyc.next, -1)) });
      sub = tr('You’re spending about {pace} a day. Keep to <b>{safe} a day</b> until payday and you’ll stay out of the red.', { pace: inr(r.paceRate), safe: inr(z.safeDaily) });
    } else {
      headline = tr('You’re in the green');
      sub = tr('At this pace you reach payday on {date} with about <b>{amount}</b> left.', { date: fmtDate(cyc.next), amount: inr(r.endPace) }) +
        (streak >= 2 ? ' ' + tr('{days} in a row within your daily amount. Keep it going.', { days: plural(streak, 'day') }) : '') +
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
    Object.keys(spentByCat).forEach((cat) => bars.push(barRow(tr('{category} (no budget)', { category: label(cat) }), spentByCat[cat], 0)));

    const upcoming = r.events.filter((e) => e.date > t);
    const askBalance = !state.isDemo && !r.anchor && state.balancePromptSkipped !== cyc.start;
    const ins = Core.insights(state, t);
    const adj = r.plan.adjustment;

    return (
      paydayCard() +
      rolloverCard() +
      loanDebtNote() +
      '<section class="hero">' +
      '<div class="hero-top"><p class="eyebrow">' + tr('Salary cycle · {from} – {to} · day {day} of {days}', { from: fmtDate(cyc.start), to: fmtDate(lastDay), day: r.idxToday + 1, days: cyc.days }) + '</p>' + info('runway') + '</div>' +
      zoneMeter(z.zone) +
      '<h1>' + headline + '</h1><p class="sub">' + sub + '</p>' + borrowedLine() +
      (z.zone === 'red' ? redOptions(z, r) : '') +
      '<div class="chart-wrap"><div id="runway-chart" role="img" aria-label="' + tr('Balance through this salary cycle') + '"></div>' +
      '<div class="legend"><span><i></i>' + tr('Balance so far') + '</span><span><i class="pace"></i>' + tr('If you keep this pace') + '</span><span><i class="plan"></i>' + tr('If you keep to budget') + '</span>' +
      '<span><i class="red-band"></i>' + tr('Red zone: bills and basics still to pay') + '</span><span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="c-event"/></svg>' + tr('Bill or EMI') + '</span></div></div>' +
      '</section>' +
      savedCard() +
      cardHomeNotes(cyc) +
      (askBalance || ui.balanceOpen ? balanceForm(askBalance && !ui.balanceOpen) : '') +
      (needsCheck().length
        ? '<div class="callout warn"><b>' + tr(needsCheck().length === 1 ? '1 payment from SMS needs a quick check' : '{n} payments from SMS need a quick check', { n: needsCheck().length }) + '</b>' +
          '<span class="hint">' + tr(needsCheck().length === 1 ? 'Make sure it’s in the right category.' : 'Make sure they’re in the right category.') + '</span>' +
          '<div><button class="primary" data-action="tab" data-tab="spend">' + tr('Check now') + '</button></div></div>'
        : '') +
      incomeCard() +
      (adj ? '<div class="callout warn"><b>' + tr('Recovery plan active until {date}.', { date: fmtDate(adj.until, true) }) + '</b><span class="hint">' +
        [adj.flexCutPct ? tr('Flexible budgets are {pct}% lower.', { pct: adj.flexCutPct }) : '', adj.pauseInvest ? tr('The Grow budget is paused.') : '', adj.pauseDebtExtra ? tr('Extra debt payments are paused.') : '']
          .filter(Boolean).join(' ') + '</span></div>' : '') +
      '<section class="tiles">' +
      tile('Left to spend today', inr(r.leftToday), todayTileNote(r), true) +
      tile('Balance now', inr(r.balanceToday),
        (r.anchor ? tr('From your balance on {date}', { date: fmtDate(r.anchor.date) }) : tr('Worked out from your plan')) +
        ' · <button class="link" data-action="balance-open">' + tr('Update') + '</button>') +
      tile('Next salary', plural(daysToPay, 'day'), fmtDate(cyc.next)) +
      tile('Flexible spending', inr(flexSpent), tr('of {amount} budget', { amount: inr(Math.round((r.plan.flexTotal * share) / 10) * 10) }) +
        (r.extraIn ? ' ' + tr('+ {amount} received', { amount: inr(r.extraIn) }) : '') + (r.anchor ? ' ' + tr('since {date}', { date: fmtDate(r.anchor.date) }) : '')) +
      '</section>' +
      bigExpenseCard() +
      paydayPreviewCard() +
      '<section class="card"><div class="card-head"><h2>' + tr(r.anchor && r.anchorIdx > 0 ? 'You can spend until payday' : 'You can spend this cycle') + '</h2><button class="ghost" data-action="tab" data-tab="plan">' + tr('Adjust') + '</button></div>' +
      '<div class="bars">' + bars.join('') + '</div></section>' +
      billsCard() +
      '<section class="card"><div class="card-head"><h2>' + tr('Coming up before payday') + '</h2><span class="hint">' + inr(upcoming.reduce((s, e) => s + e.amount, 0)) + '</span></div>' +
      (upcoming.length
        ? '<div class="list">' + upcoming.map((e) =>
          '<div class="list-item"><div class="date-badge"><b>' + Core.parseISO(e.date).getDate() + '</b>' + monthName(Core.parseISO(e.date).getMonth()) + '</div>' +
          '<div class="grow"><div class="title">' + esc(e.name) + '</div><div class="meta">' + tr(e.kind === 'debt' ? 'Minimum payment' : e.kind === 'bill' ? 'Estimate · amount varies' : 'Fixed payment') + '</div></div>' +
          '<div class="amt">' + inr(e.amount) + '</div></div>').join('') + '</div>'
        : '<p class="hint">' + tr('No more fixed payments this cycle.') + '</p>') +
      '</section>' +
      '<section class="card"><h2>' + tr('What your spending says') + '</h2><div>' +
      ins.map((i) => '<div class="insight lvl-' + i.level + '"><div><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p></div></div>').join('') +
      '</div></section>'
    );
  }

  const BILL_PERIODS = [1, 2, 3, 6, 12];

  function periodOptions(selected) {
    return BILL_PERIODS.map((m) => '<option value="' + m + '"' + (Number(selected) === m ? ' selected' : '') + '>' +
      plural(m, 'month') + '</option>').join('');
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
        '<div class="meta' + (late ? ' bad' : '') + '">' + tr(late ? 'Was due {date} · about {amount}' : 'Due {date} · about {amount}', { date: fmtDate(b.nextDue), amount: inr(b.estimate) }) +
        (b.everyMonths > 1 ? ' ' + tr('for {months}', { months: plural(b.everyMonths, 'month') }) : '') + '</div></div>';
      if (ui.payBill === b.id) {
        html += '</div><div class="form-grid">' +
          '<label class="field" for="bill-amt-' + esc(b.id) + '"><span>' + tr('Amount paid (₹)') + '</span><input id="bill-amt-' + esc(b.id) + '" type="number" inputmode="numeric" min="1" value="' + esc(b.estimate) + '"></label>' +
          '<label class="field" for="bill-months-' + esc(b.id) + '"><span>' + tr('Covers') + '</span><select id="bill-months-' + esc(b.id) + '">' + periodOptions(b.everyMonths) + '</select></label>' +
          '</div><div class="row"><button class="primary" data-action="bill-pay-save" data-id="' + esc(b.id) + '">' + tr('Save payment') + '</button>' +
          '<button class="ghost" data-action="bill-pay-cancel">' + tr('Cancel') + '</button></div></div>';
      } else {
        html += '<button data-action="bill-pay-open" data-id="' + esc(b.id) + '">' + tr('Paid') + '</button></div></div>';
      }
      return html;
    });
    const links = unlinked.map((x) =>
      '<div class="bill-item"><div class="check-top"><div class="grow"><div class="title">' + esc(x.note || tr('Bill payment')) + '</div>' +
      '<div class="meta">' + fmtDate(x.date) + ' · ' + inr(x.amount) + ' · ' + tr('which bill is this?') + '</div></div></div>' +
      '<div class="row"><select id="bill-link-' + esc(x.id) + '" aria-label="' + tr('Bill') + '">' + bills.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + '</select>' +
      '<button data-action="bill-link" data-id="' + esc(x.id) + '">' + tr('Link') + '</button></div></div>');
    return '<section class="card bills-card"><div class="card-head">' + titled('Bills to pay', 'bills') + '<span class="hint">' + tr('Amounts vary') + '</span></div>' +
      rows.join('') + links.join('') + '</section>';
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
    return '<section class="card payday-card"><div class="card-head">' + titled(slip ? 'This month’s pay' : 'Payday! How much came in this month?', 'payday') + '</div>' +
      (seen && !slip ? '<p class="hint">' + tr('Your bank’s salary SMS on {date} said {amount}.', { date: fmtDate(seen.date), amount: inr(seen.amount) }) + '</p>' : '') +
      '<p class="hint">' + tr('Your usual pay is {amount}.', { amount: inr(usual) }) + '</p>' +
      '<div class="row"><label class="field grow-field" for="pay-amount"><span>' + tr('In hand this month (₹)') + '</span><input id="pay-amount" type="number" inputmode="numeric" min="0" value="' + esc(start) + '"></label></div>' +
      '<div id="pay-reason">' + paydayReason(start, slip) + '</div>' +
      '<div class="row"><button class="primary" data-action="payday-save">' + tr('Save') + '</button>' +
      (start !== usual ? '<button data-action="payday-same">' + tr('It was my usual {amount}', { amount: inr(usual) }) + '</button>' : '') +
      (ui.paydayOpen ? '<button class="ghost" data-action="payday-close">' + tr('Close') + '</button>' : '') + '</div></section>';
  }

  function paydayReason(amount, slip) {
    const usual = Number(state.settings.salary) || 0;
    const diff = Math.round(Number(amount) || 0) - usual;
    if (!diff) return '';
    const list = diff > 0 ? PAY_MORE : PAY_LESS;
    const chosen = slip && slip.reason;
    return '<div class="callout' + (diff > 0 ? ' good' : ' warn') + '"><b>' + tr(diff > 0 ? '{amount} more than usual. What was it?' : '{amount} less than usual. Why?', { amount: inr(Math.abs(diff)) }) + '</b>' +
      '<div class="form-grid"><label class="field" for="pay-why"><span>' + tr('Reason') + '</span><select id="pay-why">' +
      list.map((x) => '<option value="' + esc(x) + '"' + (x === chosen ? ' selected' : '') + '>' + esc(label(x)) + '</option>').join('') + '</select></label>' +
      '<label class="field" for="pay-note"><span>' + tr('Note (optional)') + '</span><input id="pay-note" type="text" value="' + esc((slip && slip.note) || '') + '" placeholder="' + tr(diff > 0 ? 'Diwali bonus' : 'TDS for Q2') + '"></label></div>' +
      '<label class="check"><input id="pay-new-usual" type="checkbox"> ' + tr('This is my new usual pay from now on') + '</label>' +
      '<span class="hint">' + (diff > 0
        ? tr('Next, choose what the extra {amount} should do: save it, clear a loan, invest, or keep it.', { amount: inr(diff) })
        : tr('This month’s budgets will be planned on {amount}.', { amount: inr(amount) })) + '</span></div>';
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
      toast(tr('Usual pay updated to {amount}', { amount: inr(amount) }));
      if (amount > usual) askRollover({ from: 'Half your raise', amount: Math.round((amount - usual) / 200) * 100, kind: 'raise', raise: amount - usual });
    } else if (amount > usual) {
      const extra = { id: uid(), kind: 'in', date: cyc.start, amount: amount - usual, category: slip.reason, note: 'Extra in this month’s pay', source: 'manual', useFor: null };
      state.transactions.push(extra);
      slip.extraTx = extra.id;
      toast(tr('{amount} extra this month. Choose what it should do.', { amount: inr(amount - usual) }));
    } else {
      toast(amount < usual ? tr('Planned this month on {amount}', { amount: inr(amount) }) : tr('Usual pay recorded'));
    }
    if (old && old.setAside) slip.setAside = old.setAside;
    if (old && old.locked) slip.locked = old.locked;
    state.payslips[cyc.start] = slip;
    ui.paydayOpen = false;
    save();
    if (!slip.locked) openReset();
  }

  // ---------- payday reset (3 steps) ----------

  function openReset() {
    const r = Core.paydayReset(state, today());
    ui.reset = { step: 1, edit: Object.assign({}, r.parts) };
  }

  /*
   * Records this cycle's set-asides as done: the emergency fund and Grow
   * savings go up, yearly-cost pots fill. These entries are flagged setAside:
   * the money already left on payday, so they don't lower the balance again,
   * and a matching Jar SMS later joins them instead of counting twice.
   */
  function lockInSetAside(parts) {
    const t = today();
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    if (state.savingsRecorded.indexOf(cyc.start) !== -1) return;
    [['emergency', parts.emergency, 'Emergency fund'], ['grow', parts.invest, 'Savings / investing']].forEach(([use, amount, note]) => {
      if (!(amount > 0)) return;
      const tx = { id: uid(), kind: 'move', date: cyc.start, amount: Math.round(amount), category: 'Savings', note, source: 'manual', useFor: null, setAside: cyc.start };
      state.transactions.push(tx);
      setIncomeUse(tx, use);
    });
    state.sinking.forEach((f) => { f.saved = (Number(f.saved) || 0) + Core.sinkingMonthly(f); });
    state.savingsRecorded.push(cyc.start);
    const slip = (state.payslips || {})[cyc.start];
    if (slip) slip.locked = true;
  }

  function resetModal() {
    if (!ui.reset) return '';
    const t = today();
    const p = ui.reset.step === 1 ? Core.paydayReset(state, t) : Core.paydayReset(state, t, ui.reset.edit);
    let body;
    if (ui.reset.step === 1) {
      body = '<span class="eyebrow">' + tr('Step 1 of 3 · What’s already spoken for') + '</span>' +
        '<h2 id="reset-title">' + tr('Payday check-in ({amount})', { amount: inr(p.salary) }) + '</h2>' +
        '<div class="summary">' + p.committed.map((x) => '<div class="line"><span>' + tr(x[0]) + '</span><span>−' + inr(x[1]) + '</span></div>').join('') +
        '<div class="line total"><span>' + tr('Money free for your month') + '</span><span class="good">' + inr(p.free) + '</span></div></div>' +
        '<p class="reset-step-subtext">' + tr('These leave on their due dates, so they’re set aside first.') + '</p>' +
        '<div class="row"><button class="primary" data-action="reset-next">' + tr('Next: protect savings') + '</button><button class="ghost" data-action="reset-later">' + tr('Later') + '</button></div>';
    } else if (ui.reset.step === 2) {
      const f = Core.freedomDays(state, t);
      const gain = f ? Math.floor((f.fund + (Number(ui.reset.edit.emergency) || 0)) / f.daily) - f.days : 0;
      const top = state.debts.filter((d) => d.balance > 0 && !d.fromCard).concat(state.debts.filter((d) => d.balance > 0 && d.fromCard)).sort((a, b) => b.rate - a.rate)[0];
      const field = (key, label, hint) => '<label class="field" for="reset-' + key + '"><span>' + label + '</span>' +
        '<input id="reset-' + key + '" type="number" inputmode="numeric" min="0" step="100" data-reset="' + key + '" value="' + esc(Math.round(ui.reset.edit[key] || 0)) + '"></label>' +
        (hint ? '<span class="hint">' + hint + '</span>' : '');
      body = '<span class="eyebrow">' + tr('Step 2 of 3 · Pay yourself first') + '</span>' +
        '<h2 id="reset-title">' + tr('Set aside before spending') + '</h2>' +
        '<p class="reset-step-subtext">' + tr('From your plan, safety first. Change any amount for this month.') + '</p>' +
        '<div class="stack">' +
        field('emergency', tr('Emergency fund') + (gain > 0 ? ' · ' + tr(gain === 1 ? '+{n} Day of Freedom' : '+{n} Days of Freedom', { n: gain }) + ' 🛡️' : ''), '') +
        (top || ui.reset.edit.debtExtra ? field('debtExtra', top ? tr('Extra toward {name}', { name: esc(top.name) }) : tr('Extra toward your loans'), tr('Pay it along with the EMI to clear the loan sooner.')) : '') +
        field('invest', tr('Savings / investing'), '') + '</div>' +
        '<div class="summary"><div class="line total"><span>' + tr('Set aside this month') + '</span><span>' + inr(p.setAsideTotal) + '</span></div>' +
        '<div class="line"><span>' + tr('Left for flexible spending') + '</span><span>' + inr(p.flexible) + '</span></div></div>' +
        '<div class="row"><button class="primary" data-action="reset-lock">' + tr('Lock in & set daily budget') + '</button><button class="ghost" data-action="reset-back">' + tr('Back') + '</button></div>';
    } else {
      body = '<span class="eyebrow">' + tr('Step 3 of 3 · Your month') + '</span>' +
        '<h2 id="reset-title">' + tr('Your safe daily runway') + '</h2>' +
        '<div class="reset-highlight-number">' + tr('{amount} / day', { amount: inr(p.daily) }) + '</div>' +
        '<p class="reset-step-subtext">' + tr('Covering groceries, dining, travel and shopping for {days}, until payday on {date}. Stay at or under it and you never touch ₹0.', { days: plural(p.days, 'day'), date: fmtDate(p.cycle.next) }) + '</p>' +
        (p.setAsideTotal ? '<p class="reset-step-subtext good">' + tr('{amount} set aside first. If you move it to Jar or a savings account, that SMS won’t be counted again.', { amount: inr(p.setAsideTotal) }) + '</p>' : '') +
        '<div class="row"><button class="primary" data-action="reset-start">' + tr('Start my month') + '</button></div>';
    }
    return '<div class="reset-modal-overlay" role="presentation"><div class="reset-modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-title" id="reset-card">' + body + '</div></div>';
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
    return '<div class="row pay-line"><span><b>' + tr('This month:') + '</b> ' + (slip
      ? tr('{amount} in hand', { amount: inr(slip.amount) }) + (diff ? ' (' + (diff > 0 ? '+' : '−') + inr(Math.abs(diff)) + ', ' + esc(label(slip.reason)) + ')' : '')
      : tr('not recorded yet')) + '</span><button class="link" data-action="payday-open">' + tr(slip ? 'Change' : 'Record') + '</button></div>' +
      (state.transactions.some((x) => Core.inCycle(x.date, Core.previousCycle(cyc, Number(state.settings.payday) || 1)))
        ? '<div><button class="link" data-action="report-open">' + tr('Last month’s report card') + '</button></div>' : '');
  }

  // Days of Freedom: the emergency fund as time, not just money.
  function freedomHeader() {
    const f = Core.freedomDays(state, today());
    if (!f) {
      return '<div class="card-head">' + titled('Emergency fund', 'fund') + '</div>' +
        '<p class="hint">' + tr('Add your fixed payments and budgets to see your Days of Freedom.') + '</p>';
    }
    const chip = f.days === 0 ? 'chip-caution' : 'chip-freedom';
    return '<div class="freedom' + (f.days === 0 ? ' none' : '') + '">' + titled(tr(f.days === 1 ? '{n} Day of Freedom' : '{n} Days of Freedom', { n: f.days }) + (f.days ? ' 🛡️' : ''), 'fund') +
      '<span class="chip ' + chip + '">' + tr(f.badge) + '</span></div>' +
      '<p class="hint">' + (f.days === 0
        ? tr('Every {amount} saved buys one day of complete financial security.', { amount: inr(f.daily) })
        : tr('{fund} saved · basics cost {daily} a day', { fund: inr(f.fund), daily: inr(f.daily) })) + '</p>';
  }

  // Pay over the last 12 months: bars, the months that differed, and totals.
  function payHistory() {
    const h = Core.salaryHistory(state, today(), 12);
    if (!h.some((x) => x.recorded)) return '';
    const max = Math.max.apply(null, h.map((x) => Math.max(x.amount, x.usual))) || 1;
    const bars = h.map((x) => {
      const cls = !x.recorded ? 'none' : x.diff > 0 ? 'up' : x.diff < 0 ? 'down' : 'same';
      const m = Core.parseISO(x.start);
      return '<div class="pay-col" title="' + esc(monthName(m.getMonth()) + ': ' + inr(x.amount) + (x.reason ? ' · ' + label(x.reason) : '')) + '">' +
        '<div class="pay-bar ' + cls + '" style="height:' + Math.max(4, (x.amount / max) * 100).toFixed(1) + '%"></div>' +
        '<span>' + monthName(m.getMonth()).slice(0, 1) + '</span></div>';
    }).join('');
    const odd = h.filter((x) => x.recorded && x.diff);
    const more = odd.filter((x) => x.diff > 0).reduce((a, x) => a + x.diff, 0);
    const less = odd.filter((x) => x.diff < 0).reduce((a, x) => a - x.diff, 0);
    const total = h.reduce((a, x) => a + x.amount, 0);
    return '<div class="pay-history"><h3>' + tr('Your pay over the year') + '</h3>' +
      '<div class="pay-chart" role="img" aria-label="' + tr('Pay for the last 12 months') + '">' + bars + '</div>' +
      '<div class="legend"><span><i class="pay-key"></i>' + tr('Usual pay') + '</span><span><i class="pay-key up"></i>' + tr('More than usual') + '</span><span><i class="pay-key down"></i>' + tr('Less than usual') + '</span><span><i class="pay-key none"></i>' + tr('Not recorded') + '</span></div>' +
      '<div class="summary"><div class="line"><span>' + tr('In hand, last 12 months') + '</span><span>' + inr(total) + '</span></div>' +
      (h.some((x) => !x.recorded) ? '<span class="hint">' + tr('Months not recorded are counted at your usual pay.') + '</span>' : '') +
      (more ? '<div class="line"><span>' + tr('Extra (bonuses and more)') + '</span><span class="good">+' + inr(more) + '</span></div>' : '') +
      (less ? '<div class="line"><span>' + tr('Less (deductions and more)') + '</span><span class="bad">−' + inr(less) + '</span></div>' : '') + '</div>' +
      (odd.length ? '<div class="list">' + odd.slice().reverse().map((x) =>
        '<div class="list-item"><div class="grow"><div class="title">' + monthName(Core.parseISO(x.start).getMonth()) + ' ' + Core.parseISO(x.start).getFullYear() + ' · ' + esc(label(x.reason || 'Different')) + '</div>' +
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
    if (p.shortfall) parts.push(['Short before payday at this pace (not borrowed yet)', p.shortfall]);
    if (p.fromBefore) parts.push(['Card bills from before you added the card', p.fromBefore]);
    if (p.newCardDebt) parts.push(['Card EMIs and balances starting next month', p.newCardDebt]);
    let html = '<section class="card preview"><span class="eyebrow">' + tr('Next payday · {date}', { date: fmtDate(p.date) }) + '</span>';
    if (p.depleted) {
      html += '<span class="big bad">' + tr('Next paycheck fully used up: ₹0 in hand') + '</span>' +
        '<div class="callout bad"><b>' + tr('Your card spending has used up your next salary before payday.') + '</b><span class="hint">' + tr('Every rupee you don’t spend now goes straight to the shortfall. See the Debts tab for the card bills.') + '</span></div>';
    } else if (!p.borrowed) {
      html += '<span class="big">' + tr('Effective payday: {amount}', { amount: inr(p.effective) }) + '</span>' +
        '<span class="sub">' + tr('Nothing borrowed against your next salary. Keep it that way.') + '</span>';
    } else {
      html += '<span class="big">' + tr('Effective payday: {amount}', { amount: inr(p.effective) }) + '</span>' +
        '<span class="sub ' + tone + '">' + (p.borrowed === p.shortfall
          // Only a forecast: at this pace the money runs out before payday.
          ? tr('(Usual pay {pay} − {amount} you’re on track to run short before payday)', { pay: inr(p.nominal), amount: inr(p.shortfall) })
          : tr(p.shortfall ? '(Usual pay {pay} − {borrowed}: card bills already owed, plus the shortfall at this pace)' : '(Usual pay {pay} − {borrowed} already borrowed against it)', { pay: inr(p.nominal), borrowed: inr(p.borrowed) })) + '</span>';
    }
    if (parts.length) {
      html += '<div class="summary">' + parts.map((x) => '<div class="line"><span>' + tr(x[0]) + '</span><span class="' + (tone || 'warn') + '">−' + inr(x[1]) + '</span></div>').join('') + '</div>';
    }
    if (p.shortfall && !p.depleted) {
      const safe = Core.zoneStatus(state, today(), Core.projectRunway(state, today())).safeDaily;
      html += '<span class="hint">' + (safe >= 1
        ? tr('Nothing is borrowed yet. Keep to {amount} a day until payday and this disappears.', { amount: inr(safe) })
        : tr('Nothing is borrowed yet. Spend only on basics until payday to shrink it.')) + '</span>';
    }
    if (!p.depleted) {
      html += '<span class="sub">' + tr('After fixed payments, loan minimums and bills ({amount}):', { amount: inr(p.committed) }) + ' ' +
        (p.freeAfter >= 0 ? tr('{amount} left for everything else.', { amount: inr(p.freeAfter) }) : '<span class="bad">' + tr('{amount} short', { amount: inr(-p.freeAfter) }) + '</span>.') + '</span>';
    }
    return html + '</section>';
  }

  function zoneMeter(zone) {
    const seg = (key, name) => '<span class="zone-seg zone-' + key + (zone === key ? ' on' : '') + '">' + tr(name) + '</span>';
    return '<div class="zone-meter" role="img" aria-label="' + tr('Zone: {zone}', { zone: tr(zone === 'amber' ? 'Careful' : zone === 'red' ? 'Red' : 'Green') }) + '">' +
      seg('green', 'Green') + seg('amber', 'Careful') + seg('red', 'Red') + '</div>';
  }

  // Ways out of the red, each with its amount.
  // ---------- month-end report card ----------

  // A cycle with something recorded in it, not yet reviewed.
  function reportPending() {
    if (state.isDemo || !state.settings.salary) return false;
    const payday = Number(state.settings.payday) || 1;
    const prev = Core.previousCycle(Core.cycleFor(today(), payday), payday);
    return state.reportSeen !== prev.start && state.transactions.some((x) => Core.inCycle(x.date, prev));
  }

  // Opens by itself when the payday check-in is due, before it.
  function reportDue() {
    if (ui.reportHidden || !reportPending()) return false;
    const t = today();
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    const seen = state.salarySeen && state.salarySeen.cycle === cyc.start;
    return !(state.payslips || {})[cyc.start] && (Core.daysBetween(cyc.start, t) <= 7 || !!seen);
  }

  function reportModal() {
    if (!ui.report && !reportDue()) return '';
    const r = Core.monthReport(state, today());
    const stat = (tone, name, value, sub) => '<div class="report-stat ' + tone + '"><span class="report-label">' + name + '</span>' +
      '<span class="report-value">' + value + '</span>' + (sub ? '<span class="report-sub">' + sub + '</span>' : '') + '</div>';
    const swept = [['emergency', '{amount} to your emergency fund'], ['debt', '{amount} to loans'], ['grow', '{amount} to savings']]
      .filter((x) => r.swept[x[0]] > 0).map((x) => tr(x[1], { amount: inr(r.swept[x[0]]) })).join(' · ');
    const hasDebts = state.debts.some((d) => d.balance > 0);
    let loans;
    if (r.debtPaid > 0) {
      loans = stat('good', tr('Extra paid on loans'), inr(r.debtPaid),
        (r.interestSaved > 0 ? tr('Saves about {amount} in interest.', { amount: inr(r.interestSaved) }) : '') +
        (r.cleared.length ? ' ' + tr('{names} cleared 🎉', { names: esc(r.cleared.join(', ')) }) : ''));
    } else if (r.cleared.length) {
      loans = stat('good', tr('Loans cleared'), esc(r.cleared.join(', ')), tr('Its EMI now keeps paying you.'));
    } else if (!hasDebts) {
      loans = stat('good', tr('Loans'), tr('Debt-free'), tr('No loans to pay off.'));
    } else {
      loans = stat('quiet', tr('Extra paid on loans'), inr(0), tr('Move a day’s leftover to a loan to cut its interest.'));
    }
    const o = r.overspent;
    return '<div class="reset-modal-overlay report-overlay" role="presentation"><div class="reset-modal-card report-card" role="dialog" aria-modal="true" aria-labelledby="report-title" id="report-card" tabindex="-1">' +
      '<span class="eyebrow">' + tr('Month-end report card · {from} – {to}', { from: fmtDate(r.cycle.start), to: fmtDate(r.last) }) + '</span>' +
      '<h2 id="report-title">' + tr('How last month went') + '</h2>' +
      '<span class="report-section good">' + tr('Wins') + '</span>' +
      stat(r.cardFree > 0 ? 'good' : 'quiet', tr('Card-free days'), tr('{n} of {days}', { n: r.cardFree, days: r.days }),
        tr(r.cardFree === r.days ? 'Not a rupee borrowed on a credit card.' : 'Days with no credit card spending.')) +
      stat(r.swept.total > 0 ? 'good' : 'quiet', tr('Saved from daily leftovers'), inr(r.swept.total),
        swept || tr('Move a day’s leftover to savings to see it here.')) +
      loans +
      '<span class="report-section warn">' + tr('Watch-outs') + '</span>' +
      (o
        ? stat('warn', tr('Most over budget'), esc(label(o.name)) + ' <span class="report-over">+' + inr(o.over) + '</span>',
          tr('{spent} spent of a {budget} budget.', { spent: inr(o.spent), budget: inr(o.budget) }))
        : stat('good', tr('Most over budget'), tr('None'), tr('Every category stayed within its budget.'))) +
      (r.small.count
        ? stat('warn', tr('Small payment leaks'), inr(r.small.total),
          tr(r.small.count === 1 ? '1 small payment under ₹{under} added up to {amount}.' : '{n} small payments under ₹{under} added up to {amount}.', { n: r.small.count, under: r.small.under, amount: inr(r.small.total) }))
        : stat('good', tr('Small payment leaks'), tr('None'), tr('No payments under ₹{under}.', { under: r.small.under }))) +
      '<button class="primary report-go" data-action="report-done">' + tr('Take lessons into next month') + '</button>' +
      '</div></div>';
  }

  // ---------- before you borrow ----------

  function borrowedLine() {
    const b = Core.borrowedThisCycle(state, today());
    let detail = ' ✓';
    if (b.card && b.loans) detail = ' (' + tr('{card} on cards, {loans} in loans', { card: inr(b.card), loans: inr(b.loans) }) + ')';
    else if (b.total) detail = ' ' + tr(b.card ? 'on cards' : 'in loans');
    return '<p class="borrowed-line ' + (b.total ? 'bad' : 'good') + '">' + tr('Borrowed this month:') + ' <b>' + inr(b.total) + '</b>' + detail + '</p>';
  }

  function bigExpenseCard() {
    return '<section class="card"><div class="card-head">' + titled('Big expense coming?', 'borrow') + '</div>' +
      '<form id="borrow-form" class="row" autocomplete="off"><label class="field grow-field" for="borrow-amount"><span>' + tr('How much (₹)') + '</span>' +
      '<input id="borrow-amount" type="number" inputmode="numeric" min="1" step="1" required placeholder="15000"></label>' +
      '<button class="primary" type="submit">' + tr('Check before you borrow') + '</button></form></section>';
  }

  // A loan received that isn't in Debts yet: its cost should be planned.
  function loanDebtNote() {
    const tx = state.transactions.filter((x) => Core.isIncome(x) && x.borrowed && !x.debtId)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!tx) return '';
    return '<div class="callout warn"><b>' + (tx.note && tx.note !== 'Money received'
      ? tr('{amount} from {from} is borrowed money', { amount: inr(tx.amount), from: esc(tx.note) })
      : tr('{amount} is borrowed money', { amount: inr(tx.amount) })) + '</b>' +
      '<span class="hint">' + tr('Add it to Debts so its interest and EMI are part of your plan.') + '</span>' +
      '<div class="row"><button class="primary" data-action="loan-add" data-id="' + esc(tx.id) + '">' + tr('Add to Debts') + '</button>' +
      '<button class="ghost" data-action="loan-known" data-id="' + esc(tx.id) + '">' + tr('It’s already there') + '</button></div></div>';
  }

  // Shown while adding a payment that this month can't spare.
  function bigSpendWarning(amount) {
    if (!state.settings.salary || amount <= 0) return '';
    const t = today();
    const r = Core.projectRunway(state, t);
    const z = Core.zoneStatus(state, t, r);
    const spare = Math.max(0, Math.floor(z.money - z.needs));
    if (amount <= Math.max(spare, 3 * r.dailyAllowance)) return '';
    return tr('{amount} is more than this month can spare ({spare}).', { amount: inr(amount), spare: inr(spare) }) + ' ' +
      '<button type="button" class="link" data-action="borrow-open" data-amount="' + amount + '">' + tr('Check before you borrow') + '</button>';
  }

  function borrowModal() {
    const b = ui.borrow;
    if (!b) return '';
    return '<div class="reset-modal-overlay borrow-overlay" role="presentation"><div class="reset-modal-card borrow-card" role="dialog" aria-modal="true" aria-labelledby="borrow-title" id="borrow-card" tabindex="-1">' +
      borrowBody() + '</div></div>';
  }

  function borrowBody() {
    const b = ui.borrow;
    const c = Core.borrowCheck(state, b.amount, today());
    const line = (name, amount, sub, cls) => amount > 0
      ? '<div class="line"><span>' + name + (sub ? '<span class="hint line-sub">' + sub + '</span>' : '') + '</span><span' + (cls ? ' class="' + cls + '"' : '') + '>' + inr(amount) + '</span></div>' : '';
    const close = '<button class="ghost" data-action="borrow-close">' + tr('Close') + '</button>';
    const cost = (q) => '<div class="summary"><span class="eyebrow">' + tr('If you borrow {amount}', { amount: inr(q.amount) }) + '</span>' +
      '<div class="line"><span>' + tr('Credit card at {rate}%, paying {amount} a month', { rate: q.cardRate, amount: inr(q.cardMonthly) }) +
      '<span class="hint line-sub">' + (q.card.neverPaysOff ? tr('Never paid off at this amount') : tr('{months} to clear', { months: plural(q.card.months, 'month') })) + '</span></span><span class="bad">+' + inr(q.card.interest) + '</span></div>' +
      '<div class="line"><span>' + tr('A bank loan at 16% for 12 months') + '<span class="hint line-sub">' + tr('{amount} a month', { amount: inr(q.loan.emi) }) + '</span></span><span class="bad">+' + inr(q.loan.interest) + '</span></div>' +
      '<span class="hint">' + tr('Loan apps and Pay Later often charge far more. Check the yearly rate and fees before you agree.') + '</span></div>';
    let html = '<span class="eyebrow">' + tr('Before you borrow') + '</span>' +
      '<h2 id="borrow-title">' + tr('{amount} without a loan', { amount: inr(c.amount) }) + '</h2>' +
      '<label class="field" for="bc-amount"><span>' + tr('Amount (₹)') + '</span><input id="bc-amount" type="number" inputmode="numeric" min="1" step="1" data-borrow="amount" value="' + esc(c.amount || '') + '"></label>' +
      '<div class="seg" role="group" aria-label="' + tr('How soon is it needed') + '"><button data-action="borrow-mode" data-urgent="1" aria-pressed="' + !!b.urgent + '">' + tr('Needed now') + '</button>' +
      '<button data-action="borrow-mode" data-urgent="0" aria-pressed="' + !b.urgent + '">' + tr('Can wait') + '</button></div>';
    if (!c.amount) return html + '<div class="row">' + close + '</div>';
    const fromTomorrow = (after) => tr('From tomorrow: {amount} a day until payday (now {now})', { amount: inr(after), now: inr(c.daily) });
    if (b.urgent) {
      const u = c.urgent;
      const daily = u.shortfall > 0 ? '' : fromTomorrow(u.dailyAfter);
      html += '<div class="summary">' +
        line(tr('From your emergency fund'), u.fromFund, tr('That’s what it’s for.') + (u.freedomBefore !== null ? ' ' + tr('Days of Freedom {before} → {after}.', { before: u.freedomBefore, after: u.freedomAfter }) : '')) +
        line(tr('Pause this month’s Grow and extra loan payment'), u.pause, tr('If you haven’t moved that money yet.')) +
        line(tr('From this month’s money'), u.fromMonth, daily || tr('Bills and basics stay covered.')) +
        (u.shortfall > 0
          ? '<div class="line total"><span>' + tr('Still short') + '</span><span class="bad">' + inr(u.shortfall) + '</span></div>'
          : '<div class="line total"><span>' + tr('Covered without a loan') + '</span><span class="good">✓</span></div>' +
            (u.fromFund || u.pause ? '' : '<span class="hint">' + daily + '</span>')) +
        '</div>';
      if (u.shortfall > 0) {
        html += '<div class="callout warn"><b>' + tr('If it can’t wait, borrow only {short}, not {amount}.', { short: inr(u.shortfall), amount: inr(c.amount) }) + '</b>' +
          (c.wait.nextFree >= u.shortfall ? '<span class="hint">' + tr('Your next salary on {date} has {amount} free after bills: clear it from there.', { date: fmtDate(c.nextPayday), amount: inr(c.wait.nextFree) }) + '</span>' : '') + '</div>' +
          cost(u.borrow);
      }
      html += '<div class="row">' +
        (u.fromFund || u.pause ? '<button class="primary" data-action="borrow-use">' + tr('Use this plan') + '</button>' : '') +
        (u.shortfall > 0 ? '<button data-action="borrow-recover">' + tr('Plan the recovery') + '</button>' : '') +
        close + '</div>';
      return html;
    }
    const w = c.wait;
    const sp = w.save.find((x) => x.months === b.months) || w.save[2];
    html += '<div class="summary">' +
      (w.fits
        ? '<div class="line"><span>' + tr('It fits this month') + '<span class="hint line-sub">' + fromTomorrow(w.dailyAfter) + '</span></span><span class="good">✓</span></div>'
        : '<div class="line"><span>' + tr('This month can spare') + '</span><span>' + inr(c.spare) + '</span></div>') +
      '<div class="line"><span>' + tr('Wait for payday on {date}', { date: fmtDate(c.nextPayday) }) + '<span class="hint line-sub">' + tr('Free after bills, before your budgets') + '</span></span><span>' + inr(w.nextFree) + '</span></div></div>' +
      '<span class="eyebrow">' + tr('Save first, or pay in EMIs?') + '</span>' +
      '<div class="seg" role="group" aria-label="' + tr('Months') + '">' + w.save.map((x) =>
        '<button data-action="borrow-months" data-months="' + x.months + '" aria-pressed="' + (x === sp) + '">' + plural(x.months, 'month') + '</button>').join('') + '</div>' +
      '<div class="summary">' +
      '<div class="line"><span>' + tr('Save {amount} a month', { amount: inr(sp.monthly) }) + '<span class="hint line-sub">' + tr('Ready by {date}', { date: monthYear(sp.ready) }) + '</span></span><span class="good">' + inr(c.amount) + '</span></div>' +
      '<div class="line"><span>' + tr('EMI at 16%: {amount} a month', { amount: inr(sp.emi.emi) }) + '<span class="hint line-sub">' + tr('Yours today, paid for {months}', { months: plural(sp.months, 'month') }) + '</span></span><span class="bad">' + inr(c.amount + sp.emi.interest) + '</span></div>' +
      '<div class="line total"><span>' + tr('Saving first keeps') + '</span><span class="good">' + inr(sp.emi.interest) + '</span></div></div>' +
      '<p class="hint">' + tr('Keep your emergency fund for emergencies.') + '</p>' +
      '<div class="row">' + close + '</div>';
    return html;
  }

  // ---------- keep paying yourself (rollover) ----------

  const ROLL_TO = { debt: 'extra toward loans', emergency: 'emergency fund', grow: 'savings / investing' };

  function askRollover(a) {
    if (!(a.amount > 0)) return;
    state.rolloverAsk = Object.assign({ date: today() }, a);
    ui.rolloverHidden = false;
  }

  function rolloverCard() {
    const a = state.rolloverAsk;
    if (!a || ui.rolloverHidden || state.isDemo) return '';
    const o = Core.rolloverOptions(state, a.amount, today());
    return '<section class="card income-card rollover-card"><div class="card-head">' +
      titled(a.kind === 'raise' ? tr('Your pay went up by {amount}', { amount: inr(a.raise) }) : tr('{name} is done 🎉', { name: esc(a.from) }), 'rollover') + '</div>' +
      '<p class="hint">' + (a.kind === 'raise'
        ? tr('Send half of it, {amount} a month, to freedom before spending grows to match it.', { amount: inr(a.amount) })
        : tr('You’re used to living without {amount} a month. Keep paying it, to yourself:', { amount: inr(a.amount) })) + '</p>' +
      '<div class="choices">' + o.options.map((opt) =>
        '<button class="choice' + (opt.to === o.recommended ? ' suggested' : '') + '" data-action="rollover-use" data-to="' + opt.to + '">' +
        '<span class="choice-title">' + esc(opt.title) + (opt.to === o.recommended ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '') + '</span>' +
        '<span class="choice-detail">' + esc(opt.detail) + '</span></button>').join('') + '</div>' +
      '<p class="hint"><b>' + tr('Why the suggestion:') + '</b> ' + esc(o.reason) + '</p>' +
      '<div><button class="ghost" data-action="rollover-later">' + tr('Decide later') + '</button></div></section>';
  }

  function redOptions(z, r) {
    const items = z.options.map((o) => {
      if (o.kind === 'fund') {
        return '<li>' + tr('<b>Use {amount} from your emergency fund.</b> That’s what it’s for.', { amount: inr(o.amount) }) + ' ' +
          '<button class="link" data-action="zone-fund" data-amount="' + Math.round(o.amount) + '">' + tr('Move it to this month') + '</button></li>';
      }
      if (o.kind === 'pause') {
        return '<li>' + tr('<b>Pause this month’s Grow and extra debt payments</b> ({amount}), if you haven’t moved that money yet.', { amount: inr(o.amount) }) + ' ' +
          '<button class="link" data-action="zone-pause">' + tr('Pause until payday') + '</button></li>';
      }
      return '<li>' + tr('<b>Spend only on basics</b>, about {amount} a day for groceries and health, until {date}.', { amount: inr(o.amount), date: fmtDate(r.cycle.next) }) + '</li>';
    });
    items.push('<li>' + tr('<b>Avoid the credit card for daily spending.</b> It turns this month’s gap into next month’s debt.') + '</li>');
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

  // Spent and saved on a day: saved money can't be spent either.
  function spentOn(date) {
    return state.transactions
      .filter((x) => (Core.isFlexible(x) && x.date === date && x.category !== 'Emergency') ||
        (Core.isMove(x) && (x.forDate || x.date) === date))
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
    const when = isToday ? 'today' : day.date === Core.addDays(today(), -1) ? 'yesterday' : 'on';
    const fund = Number(state.savings.emergencyBalance) || 0;
    const top = state.debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
    const zone = Core.zoneStatus(state, today()).zone;
    const sug = Core.suggestUse(state, today(), zone !== 'green' ? tr('You’re not in the green this month, so keeping it helps you reach payday.') : null);
    const suggested = sug.use;
    const opt = (use, title, detail, extra) =>
      '<button class="choice' + (use === suggested ? ' suggested' : '') + '" data-action="save-day" data-date="' + day.date + '" data-amount="' + day.left + '" data-use="' + use + '"' + (extra || '') + '>' +
      '<span class="choice-title">' + title + (use === suggested ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '') + '</span>' +
      '<span class="choice-detail">' + detail + '</span></button>';
    const heading = when === 'on'
      ? tr('You saved {amount} on {date}', { amount: inr(day.left), date: fmtDate(day.date) })
      : tr(when === 'today' ? 'You saved {amount} today' : 'You saved {amount} yesterday', { amount: inr(day.left) });
    return '<section class="card saved-card"><div class="card-head"><h2>' + heading + '</h2></div>' +
      '<p class="hint">' + tr('You spent {spent} of your {allowance}. Saving that much every day adds up to {month} a month. Put it to work:', { spent: inr(day.spent), allowance: inr(day.allowance), month: inr(day.left * 30) }) + '</p>' +
      '<div class="choices">' +
      opt('emergency', tr('Add to emergency fund'), tr('Fund goes from {from} to {to}.', { from: inr(fund), to: inr(fund + day.left) })) +
      (top ? opt('debt', tr('Pay off {name}', { name: esc(top.name) }), tr('At {rate}% a year, that saves about {amount} a year in interest.', { rate: top.rate, amount: inr((day.left * top.rate) / 100) }), ' data-debt="' + esc(top.id) + '"') : '') +
      opt('grow', tr('Set aside to invest'), tr('Adds to the money you’ve set aside to invest.')) +
      '<button class="choice' + (suggested === 'spend' ? ' suggested' : '') + '" data-action="save-day-keep" data-date="' + day.date + '"><span class="choice-title">' + tr('Keep it for this month') + (suggested === 'spend' ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '') + '</span>' +
      '<span class="choice-detail">' + tr('It stays in this month’s money and slightly raises the days ahead.') + '</span>' +
      (top && top.rate >= 15 ? '<span class="choice-badge">' + tr('Extends this month’s budget, but delays your debt-free date') + '</span>' : '') + '</button>' +
      '</div><p class="hint"><b>' + tr('Why the suggestion:') + '</b> ' + esc(sug.reason) + '</p></section>';
  }

  function balanceForm(firstTime) {
    const t = today();
    const current = state.balanceCheck && state.balanceCheck.date === t ? state.balanceCheck.amount : '';
    return '<form id="balance-form" class="callout" autocomplete="off">' +
      '<b>' + tr(firstTime ? 'How much money is in your account this morning?' : 'Update your balance') + '</b>' +
      '<span class="hint">' + tr(firstTime
        ? 'The app can’t see what you spent before you started. Enter your bank balance as it was at the start of today, and the graph will start from there. Add any spending from today after this.'
        : 'Check your bank app and enter the balance from the start of today. The graph starts again from this amount, which covers cash and anything not recorded.') + '</span>' +
      '<div class="row"><label class="field grow-field" for="balance-amount"><span>' + tr('Balance this morning (₹)') + '</span><input id="balance-amount" type="number" inputmode="numeric" min="0" step="1" required value="' + esc(current) + '" placeholder="12500"></label></div>' +
      '<div class="row"><button class="primary" type="submit">' + tr('Save balance') + '</button>' +
      '<button type="button" class="ghost" data-action="balance-skip">' + tr(firstTime ? 'Not now' : 'Cancel') + '</button></div></form>';
  }

  // Payments recorded from SMS that the user hasn't checked yet.
  function needsCheck() {
    return state.transactions.filter((x) => x.needsReview).sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function needsCheckCard() {
    const list = needsCheck();
    if (!list.length) return '';
    return '<section class="card check-card"><div class="card-head"><h2>' + tr('Needs your check') + '</h2><span class="chip chip-check">' + list.length + '</span></div>' +
      '<p class="hint">' + tr('Recorded from bank SMS. Is each one right?') + '</p>' +
      '<div class="list">' + list.map((x) => Core.isMove(x) ? savedCheckItem(x) :
        '<div class="check-item"><div class="check-top"><div class="grow"><div class="title">' + esc(tr(x.note || 'Bank payment')) + '</div>' +
        '<div class="meta">' + fmtDate(x.date) + '</div></div><div class="amt">' + inr(x.amount) + '</div></div>' +
        '<div class="row"><select data-tx-cat="' + esc(x.id) + '" aria-label="' + tr('Category') + '">' + categoryOptions(x.category) + '</select>' +
        ((state.cards || []).length || x.paidFrom
          ? '<select data-tx-from="' + esc(x.id) + '" aria-label="' + tr('Paid from') + '">' + paidFromOptions(x.paidFrom) +
            (x.paidFrom && x.paidFrom.indexOf('card:') === 0 ? '<option value="' + esc(x.paidFrom) + '" selected>' + tr('Card ending {last4} (not added)', { last4: esc(x.paidFrom.slice(5)) }) + '</option>' : '') + '</select>'
          : '') + '</div>' +
        '<div class="row"><button class="primary" data-action="tx-confirm" data-id="' + esc(x.id) + '">' + tr('Looks right') + '</button>' +
        '<button class="ghost" data-action="tx-not-payment" data-id="' + esc(x.id) + '">' + tr('Not a payment') + '</button></div></div>'
      ).join('') + '</div></section>';
  }

  // Money moved to Jar, an RD, a SIP: leaves the account, but isn't spending.
  function savedForm() {
    const t = today();
    const top = state.debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
    return '<form id="save-tx" class="form-grid" autocomplete="off">' +
      '<label class="field">' + tr('Amount (₹)') + '<input id="sv-amount" type="number" inputmode="decimal" min="1" step="1" required placeholder="58"></label>' +
      '<label class="field">' + tr('Counts as') + '<select id="sv-use"><option value="emergency">' + tr('Emergency fund') + '</option><option value="grow">' + tr('Savings / investing') + '</option>' +
      (top ? '<option value="debt" data-debt="' + esc(top.id) + '">' + tr('Paid {name}', { name: esc(top.name) }) + '</option>' : '') + '</select></label>' +
      '<label class="field">' + tr('Date') + '<input id="sv-date" type="date" value="' + t + '" max="' + t + '" required></label>' +
      '<label class="field">' + tr('Where') + '<input id="sv-note" type="text" placeholder="Jar"></label>' +
      '<div class="wide"><button class="primary" type="submit">' + tr('Add money saved') + '</button></div></form>';
  }

  // A transfer to savings (Jar, a SIP, an RD): where does it count?
  function savedCheckItem(x) {
    const top = state.debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
    const b = (use, name, extra) => '<button data-action="saved-dest" data-id="' + esc(x.id) + '" data-use="' + use + '"' + (extra || '') + '>' + name + '</button>';
    return '<div class="check-item"><div class="check-top"><div class="grow"><div class="title">' + tr('Saved to {where}', { where: esc(x.note || tr('savings')) }) + '</div>' +
      '<div class="meta">' + fmtDate(x.date) + ' · ' + tr('not spending. Where does it count?') + '</div></div><div class="amt good">' + inr(x.amount) + '</div></div>' +
      '<div class="row">' + b('emergency', tr('Emergency fund')) + b('grow', tr('Savings / investing')) +
      (top ? b('debt', tr('Paid {name}', { name: esc(top.name) }), ' data-debt="' + esc(top.id) + '"') : '') + '</div>' +
      '<div class="row"><button class="ghost" data-action="saved-was-spend" data-id="' + esc(x.id) + '">' + tr('It was spending') + '</button></div></div>';
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
    return '<section class="card income-card"><div class="card-head"><h2>' + tr('What should this {amount} do?', { amount: inr(tx.amount) }) + '</h2>' +
      (pending.length > 1 ? '<span class="hint">' + tr('{n} more after this', { n: pending.length - 1 }) + '</span>' : '') + '</div>' +
      '<p class="hint">' + (tx.note ? esc(tr(tx.note)) + ' · ' : '') + esc(label(tx.category)) + ' · ' + fmtDate(tx.date) + '. ' + tr('Until you choose, it counts as money for this month.') + '</p>' +
      '<div class="choices">' + o.options.map((opt) =>
        '<button class="choice' + (opt.use === o.recommended ? ' suggested' : '') + '" data-action="income-use" data-id="' + esc(tx.id) + '" data-use="' + opt.use + '"' + (opt.debtId ? ' data-debt="' + esc(opt.debtId) + '"' : '') + '>' +
        '<span class="choice-title">' + esc(opt.title) + (opt.use === o.recommended ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '') + '</span>' +
        '<span class="choice-detail">' + esc(opt.detail) + '</span>' +
        (opt.badge ? '<span class="choice-badge">' + esc(opt.badge) + '</span>' : '') + '</button>').join('') + '</div>' +
      '<p class="hint"><b>' + tr('Why the suggestion:') + '</b> ' + esc(o.reason) + ' ' + tr('The choice is yours.') + '</p></section>';
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

  function todayTileNote(r) {
    if (r.overToday > 0) {
      // Going over because of saving is good news, said differently.
      return tr(r.savedToday >= r.overToday ? 'Saved {over} more than today’s {daily}. Tomorrow: {tomorrow}' : '{over} over today’s {daily}. Tomorrow: {tomorrow}',
        { over: inr(r.overToday), daily: inr(r.dailyAllowance), tomorrow: inr(r.tomorrowAllowance) });
    }
    const v = { spent: inr(r.spentToday), saved: inr(r.savedToday), daily: inr(r.dailyAllowance) };
    if (r.spentToday && r.savedToday) return tr('Spent {spent} + saved {saved} of {daily} today', v);
    if (r.spentToday) return tr('Spent {spent} of {daily} today', v);
    if (r.savedToday) return tr('Saved {saved} of {daily} today', v);
    return tr('Today’s share of your budget');
  }

  function tile(label, value, sub, feature) {
    return '<div class="tile' + (feature ? ' feature' : '') + '"><span class="tile-label">' + tr(label) + '</span>' +
      '<span class="tile-value">' + value + '</span><span class="tile-sub">' + tr(sub) + '</span></div>';
  }

  function barRow(name, spent, budget) {
    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
    const cls = budget === 0 ? 'marigold' : spent > budget ? 'bad' : spent > budget * 0.85 ? 'warn' : '';
    const left = budget - spent;
    const right = budget > 0
      ? (left >= 0 ? tr('<b>{amount}</b> left', { amount: inr(left) }) : '<b class="bad">' + tr('{amount} over', { amount: inr(-left) }) + '</b>')
      : inr(spent);
    return '<div class="bar-row"><div class="bar-top"><span>' + esc(label(name)) + '</span><span class="amt">' + right + '</span></div>' +
      '<div class="bar"><span class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></div>' +
      (budget > 0 ? '<div class="bar-sub">' + tr('Spent {spent} of {budget}', { spent: inr(spent), budget: inr(budget) }) + '</div>' : '') + '</div>';
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
      svg += '<circle class="c-event" cx="' + x(i).toFixed(1) + '" cy="' + (H - B + 7) + '" r="3.5"><title>' + esc(e.name) + ' ' + inr(e.amount) + ' · ' + fmtDate(e.date) + '</title></circle>';
    });

    svg += '<line class="c-today" x1="' + x(ti) + '" x2="' + x(ti) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
    svg += '<circle class="c-dot" cx="' + x(ti) + '" cy="' + y(pts[ti].actual) + '" r="5"/>';

    if (r.zeroPace) {
      const zi = Core.daysBetween(r.cycle.start, r.zeroPace);
      const anchor = zi > N - 5 ? 'end' : 'middle';
      svg += '<circle class="c-zero-dot" cx="' + x(zi) + '" cy="' + y(0) + '" r="5"/>';
      svg += '<text class="c-label-strong" x="' + x(zi) + '" y="' + (y(0) - 10) + '" text-anchor="' + anchor + '">' + tr('₹0 on {date}', { date: fmtDate(r.zeroPace) }) + '</text>';
    }

    const ly = H - 4;
    svg += '<text class="c-label" x="' + x(0) + '" y="' + ly + '" text-anchor="start">' + fmtDate(r.cycle.start) + '</text>';
    svg += '<text class="c-label" x="' + x(N - 1) + '" y="' + ly + '" text-anchor="end">' + fmtDate(Core.addDays(r.cycle.next, -1)) + '</text>';
    if (ti > 3 && ti < N - 4) svg += '<text class="c-label-strong" x="' + x(ti) + '" y="' + ly + '" text-anchor="middle">' + tr('Today') + '</text>';
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
    const saving = ui.txKind === 'save';

    return (
      needsCheckCard() +
      billsCard() +
      incomeCard() +
      '<section class="card"><div class="card-head">' + titled(saving ? 'Add money saved' : moneyIn ? 'Add money received' : 'Add a payment', 'add') +
      '<div class="seg" role="group" aria-label="' + tr('Type') + '"><button data-action="tx-kind" data-kind="out" aria-pressed="' + (!moneyIn && !saving) + '">' + tr('Money out') + '</button>' +
      '<button data-action="tx-kind" data-kind="in" aria-pressed="' + moneyIn + '">' + tr('Money in') + '</button>' +
      '<button data-action="tx-kind" data-kind="save" aria-pressed="' + saving + '">' + tr('Saved') + '</button></div></div>' +
      (saving ? savedForm() :
      '<form id="add-tx" class="form-grid" autocomplete="off">' +
      '<label class="field">' + tr('Amount (₹)') + '<input id="tx-amount" type="number" inputmode="decimal" min="1" step="1" required placeholder="' + (moneyIn ? '2000' : '250') + '"></label>' +
      (moneyIn ? '' : '<p id="tx-big-warn" class="borrow-warn wide" hidden></p>') +
      '<label class="field">' + tr('Category') + '<select id="tx-category">' + (moneyIn ? incomeCategoryOptions('Money received') : categoryOptions('Food & dining')) + '</select></label>' +
      '<label class="field">' + tr('Date') + '<input id="tx-date" type="date" value="' + t + '" max="' + t + '" required></label>' +
      '<label class="field">' + tr(moneyIn ? 'From' : 'Where / what') + '<input id="tx-note" type="text" placeholder="' + (moneyIn ? 'Rahul' : 'Swiggy') + '"></label>' +
      (!moneyIn && (state.cards || []).length
        ? '<label class="field wide" for="tx-from"><span>' + tr('Paid from') + '</span><select id="tx-from">' + paidFromOptions('account') + '</select></label>' +
          '<p id="tx-from-warn" class="borrow-warn wide" hidden></p>'
        : '') +
      '<div class="wide"><button class="primary" type="submit">' + tr(moneyIn ? 'Add money received' : 'Add payment') + '</button></div>' +
      '</form>') + '</section>' +

      (NATIVE
        ? '<section class="card"><div class="card-head">' + titled('Bank SMS', 'sms') + (state.smsAuto ? modeChip(true) : '') + '</div>' +
          (state.smsAuto ? '' : '<p class="hint">' + tr('Record payments from your bank and UPI messages. Read on this phone only.') + '</p>') +
          '<div class="row"><button class="primary" data-action="sms-native"' + (ui.smsBusy ? ' disabled' : '') + '>' +
          tr(ui.smsBusy ? 'Reading…' : state.smsAuto ? 'Check for new messages' : 'Read bank SMS') + '</button></div>' +
          (state.smsAuto
            ? '<div class="callout"><b>' + tr(state.smsAlerts ? 'Notifications for new bank SMS are on' : 'Get a notification when a bank SMS arrives') + '</b>' +
              '<div>' + (state.smsAlerts
                ? '<button class="ghost" data-action="alerts-off">' + tr('Turn off') + '</button>'
                : '<button class="primary" data-action="alerts-on">' + tr('Turn on notifications') + '</button>') + '</div></div>'
            : '') +
          smsPreview() + '</section>'
        : '<section class="card"><div class="card-head">' + titled('Import from bank SMS', 'sms') + '</div>' +
          '<label class="field" for="sms-text">' + tr('Messages') + '<textarea id="sms-text" placeholder="Rs.450.00 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici…">' + esc(ui.smsText) + '</textarea></label>' +
          '<div class="row"><button class="primary" data-action="sms-read">' + tr('Read messages') + '</button><button data-action="sms-sample">' + tr('Paste sample messages') + '</button></div>' +
          smsPreview() +
          '</section>') +

      '<section class="card"><div class="card-head">' + titled('Payments', 'payments') +
      '<div class="seg" role="group" aria-label="' + tr('Show') + '"><button data-action="tx-filter" data-filter="cycle" aria-pressed="' + (ui.txFilter === 'cycle') + '">' + tr('This cycle') + '</button>' +
      '<button data-action="tx-filter" data-filter="all" aria-pressed="' + (ui.txFilter === 'all') + '">' + tr('All') + '</button></div></div>' +
      '<p class="hint">' + tr('{amount} spent', { amount: inr(spent) }) + (received ? ' · <span class="good">' + tr('{amount} received', { amount: inr(received) }) + '</span>' : '') + '</p>' +
      (shown.length
        ? '<div class="table-wrap"><table><thead><tr><th>' + tr('Payment') + '</th><th>' + tr('Category') + '</th><th class="amt">' + tr('Amount') + '</th><th><span class="sr">' + tr('Delete') + '</span></th></tr></thead><tbody>' +
          shown.map((x) => {
            const isIn = Core.isIncome(x);
            if (Core.isMove(x) || Core.isBillPayment(x) || Core.isCardTransfer(x)) {
              const kindLabel = tr(Core.isMove(x) ? INCOME_USE_LABELS[x.useFor] || 'Saved · choose where it counts' : x.kind === 'cardpay' ? 'Card bill paid from your account' : x.kind === 'cardconvert' ? 'Moved off the card to your loans' : 'Bill payment');
              const change = Core.isMove(x) && x.useFor ? ' <button class="link" data-action="saved-change" data-id="' + esc(x.id) + '">' + tr('Change') + '</button>' : '';
              return '<tr><td><div class="cell-title">' + esc(tr(x.note)) + '</div><div class="cell-sub">' + fmtDate(x.date) + ' · ' + kindLabel + change + '</div></td>' +
                '<td>' + tr(Core.isMove(x) ? 'Saved' : Core.isCardTransfer(x) ? 'Card' : 'Bills') + '</td><td class="amt' + (Core.isMove(x) ? ' good' : '') + '">' + inr(x.amount) + '</td>' +
                '<td><button class="icon" data-action="tx-delete" data-id="' + esc(x.id) + '" aria-label="' + tr('Delete') + '">✕</button></td></tr>';
            }
            const onCard = x.paidFrom && x.paidFrom !== 'account' ? (state.cards || []).find((c) => c.id === x.paidFrom) : null;
            const sub = fmtDate(x.date) + (x.source === 'sms' ? ' · ' + tr('from SMS') : x.source === 'widget' ? ' · ' + tr('from widget') : '') +
              (onCard ? ' · <span class="warn">' + tr('on {card}', { card: cardLabel(onCard) }) + '</span>' : x.paidFrom && x.paidFrom.indexOf('card:') === 0 ? ' · <span class="warn">' + tr('on a card') + '</span>' : '') +
              (isIn ? ' · ' + (x.useFor ? tr(INCOME_USE_LABELS[x.useFor]) + ' <button class="link" data-action="income-change" data-id="' + esc(x.id) + '">' + tr('Change') + '</button>' : '<button class="link" data-action="income-change" data-id="' + esc(x.id) + '">' + tr('Choose what it does') + '</button>') : '');
            return '<tr' + (x.needsReview ? ' class="needs-check"' : '') + '><td><div class="cell-title">' + esc(tr(x.note || (isIn ? 'Money received' : 'Payment'))) +
              (x.needsReview ? ' <span class="chip chip-check">' + tr('Check') + '</span>' : '') + '</div><div class="cell-sub">' + sub + '</div></td>' +
              '<td><select data-tx-cat="' + esc(x.id) + '" aria-label="' + tr('Category') + '">' + (isIn ? incomeCategoryOptions(x.category) : categoryOptions(x.category)) + '</select></td>' +
              '<td class="amt' + (isIn ? ' good' : '') + '">' + (isIn ? '+' : '') + inr(x.amount) + '</td>' +
              '<td><button class="icon" data-action="tx-delete" data-id="' + esc(x.id) + '" aria-label="' + tr('Delete') + '">✕</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
          (list.length > shown.length ? '<p class="hint">' + tr('Showing the latest 200.') + '</p>' : '')
        : '<p class="hint">' + tr('No payments yet.') + '</p>') +
      '</section>'
    );
  }

  function smsPreview() {
    if (!ui.smsRows) return '';
    if (!ui.smsRows.length) return '<p class="hint">' + tr('No messages found.') + '</p>';
    const selected = ui.smsRows.filter((r) => r.checked).length;
    return '<div class="table-wrap"><table><thead><tr><th><span class="sr">' + tr('Import') + '</span></th><th>' + tr('Payment') + '</th><th>' + tr('Category') + '</th><th class="amt">' + tr('Amount') + '</th></tr></thead><tbody>' +
      ui.smsRows.map((r, i) => {
        if (!r.parsed) {
          return '<tr class="muted"><td></td><td colspan="3">' + tr('Skipped, not a payment:') + ' ' + esc(r.text.slice(0, 60)) + '…</td></tr>';
        }
        const p = r.parsed;
        const isIn = p.type === 'credit';
        const cardRow = p.type === 'statement' || p.type === 'cardpayment';
        const note = r.duplicate ? tr('Already added') : isIn && p.salary ? tr('Looks like your salary, which is already counted') : smsNote(p) || (isIn ? tr('Money in') : '');
        const check = '<td><input type="checkbox" data-sms-check="' + i + '" aria-label="' + tr('Add this') + '"' + (r.checked ? ' checked' : '') + '></td>';
        if (cardRow) {
          return '<tr' + (r.duplicate ? ' class="muted"' : '') + '>' + check +
            '<td><div class="cell-title">' + tr(p.type === 'statement' ? 'Card statement' : 'Card bill payment') + '</div><div class="cell-sub">' + fmtDate(p.date) + ' · ' + note + '</div></td>' +
            '<td>—</td><td class="amt">' + inr(p.amount) + '</td></tr>';
        }
        return '<tr' + (r.duplicate || (isIn && p.salary) ? ' class="muted"' : '') + '>' + check +
          '<td><div class="cell-title">' + esc(tr(p.merchant)) + '</div><div class="cell-sub">' + fmtDate(p.date) + (note ? ' · ' + note : '') + '</div></td>' +
          '<td><select data-sms-cat="' + i + '" aria-label="' + tr('Category') + '">' + (isIn ? incomeCategoryOptions(p.category) : categoryOptions(p.category)) + '</select></td>' +
          '<td class="amt' + (isIn ? ' good' : '') + '">' + (isIn ? '+' : '') + inr(p.amount) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="row"><button class="primary" data-action="sms-import"' + (selected ? '' : ' disabled') + '>' + tr(selected === 1 ? 'Add 1 item' : 'Add {n} items', { n: selected }) + '</button>' +
      '<button class="ghost" data-action="sms-clear">' + tr('Clear') + '</button></div>';
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
    if (p.type !== 'credit' && tx.category === 'Savings') {
      // A locked-in set-aside of this amount this cycle? This SMS is that transfer.
      const cycStart = Core.cycleFor(p.date, Number(state.settings.payday) || 1).start;
      const locked = state.transactions.find((x) => x.setAside === cycStart && !x.smsKey && x.amount === p.amount);
      if (locked) { locked.smsKey = o.key; return true; }
      // Already recorded as saved (e.g. "You saved ₹58 → emergency fund")? Join them.
      const twin = savedTwin(p.amount, p.date);
      if (twin) { twin.smsKey = o.key; twin.note = twin.note || tx.note; return true; }
      tx.kind = 'move';
      tx.useFor = null;
      state.transactions.push(tx);
      autoAssignSaved(tx);
      return true;
    }
    if (p.type === 'credit') {
      tx.kind = 'in';
      // A refund to a card lowers the card bill, so it stays as this month's money.
      tx.useFor = paidFrom !== 'account' ? 'spend' : null;
      if (paidFrom === 'account' && Core.isLoanCredit(p.raw)) {
        tx.category = LOAN_CATEGORY;
        tx.borrowed = true;
        tx.useFor = 'spend';
      }
    } else if (o.review || paidFrom.indexOf('card:') === 0) {
      tx.needsReview = true;
    } else {
      const shop = Core.normalizeMerchant(tx.note);
      if (shop && tx.note !== 'Bank payment') state.merchantRules[shop] = tx.category;
    }
    state.transactions.push(tx);
    return true;
  }

  /*
   * A saved entry of the same amount within two days that the other side
   * hasn't matched yet: a manual one without an SMS, or an SMS one without a
   * decision. Stops one transfer to Jar being counted twice.
   */
  function savedTwin(amount, date, fromSms) {
    return state.transactions.find((x) => Core.isMove(x) && !x.setAside && x.amount === amount &&
      Math.abs(Core.daysBetween(x.date, date)) <= 2 &&
      (fromSms ? x.smsKey && (!x.useFor || x.autoUse) : !x.smsKey)) || null;
  }

  /*
   * Puts a saved entry from SMS straight into a fund: where you put money
   * for that app last time (Jar -> emergency fund), else the safety-first
   * suggestion. You can change it from the payments list.
   */
  function autoAssignSaved(tx) {
    const learned = (state.savingRules || {})[Core.normalizeMerchant(tx.note)];
    let use = learned && learned.use;
    let debtId = learned && learned.debtId;
    if (use === 'debt' && !state.debts.some((d) => d.id === debtId && d.balance > 0)) use = null;
    if (!use) {
      const sug = Core.suggestUse(state, today(), null);
      use = sug.use === 'spend' ? 'emergency' : sug.use;
      debtId = sug.debtId;
    }
    setIncomeUse(tx, use, debtId);
    tx.autoUse = true;
    tx.needsReview = false;
    ui.autoSaved = (ui.autoSaved || []).concat(tx.id);
  }

  // Remembers where money for an app goes, so the next SMS from it is placed the same way.
  function learnSaving(tx, use, debtId) {
    const shop = Core.normalizeMerchant(tx.note);
    if (!shop || /^unspent on/.test(shop)) return;
    state.savingRules = state.savingRules || {};
    state.savingRules[shop] = { use, debtId: debtId || null };
  }

  // Savings SMS waiting for a decision (from before this was automatic): place them now.
  function assignWaitingSaved() {
    let n = 0;
    state.transactions.forEach((x) => {
      if (Core.isMove(x) && !x.useFor && x.smsKey) { autoAssignSaved(x); n++; }
    });
    if (n) save();
  }

  // A toast for savings placed automatically, once they're recorded.
  function announceAutoSaved() {
    const ids = ui.autoSaved || [];
    ui.autoSaved = [];
    const list = state.transactions.filter((x) => ids.indexOf(x.id) !== -1);
    if (!list.length) return;
    if (list.length === 1) {
      const x = list[0];
      celebrate(tr(x.useFor === 'emergency' ? '{amount} to {where} added to your emergency fund. Change it in Spend if needed.'
        : x.useFor === 'debt' ? '{amount} to {where} added to your loan payoff. Change it in Spend if needed.'
          : '{amount} to {where} added to your savings. Change it in Spend if needed.', { amount: inr(x.amount), where: x.note }));
    } else {
      celebrate(tr('{amount} of savings added to your funds. Change any in Spend if needed.', { amount: inr(list.reduce((a, x) => a + x.amount, 0)) }));
    }
  }

  function smsNote(p) {
    if (p.type === 'statement') {
      const c = findCard(p.last4);
      if (!c) return tr('Card statement for a card not added yet (••{last4})', { last4: esc(p.last4 || '?') });
      return tr('{card} statement: {amount}', { card: cardLabel(c), amount: inr(p.amount) }) + (p.due ? ' ' + tr('due {date}', { date: fmtDate(p.due) }) : '');
    }
    if (p.type === 'cardpayment') {
      const c = findCard(p.last4);
      return c ? tr('{card} bill paid', { card: cardLabel(c) }) : tr('Card bill paid, for a card not added yet');
    }
    if (p.paidFrom === 'card') {
      const c = findCard(p.last4);
      return c ? tr('On {card}', { card: cardLabel(c) }) : tr('On a card ending {last4} (add it under Debts)', { last4: esc(p.last4 || '?') });
    }
    return '';
  }

  // ---------- plan ----------

  function numInput(id, bind, value, label, extra) {
    return '<label class="field" for="' + id + '"><span>' + tr(label) + '</span><input id="' + id + '" type="number" inputmode="numeric" min="0" step="1" data-bind="' + bind + '" value="' + esc(value) + '"' + (extra || '') + '></label>';
  }

  function listField(list, item, field, name, type, extra) {
    const id = list + '-' + item.id + '-' + field;
    // Built-in category names are shown in the current language.
    const value = list === 'budgets' && field === 'name' ? label(item[field]) : item[field];
    return '<label class="field" for="' + id + '"><span>' + tr(name) + '</span><input id="' + id + '" type="' + type + '"' +
      (type === 'number' ? ' inputmode="numeric" min="0" step="any"' : '') +
      ' data-list="' + list + '" data-id="' + esc(item.id) + '" data-field="' + field + '" value="' + esc(value) + '"' + (extra || '') + '></label>';
  }

  function removeButton(list, item) {
    return '<button class="icon" data-action="list-remove" data-list="' + list + '" data-id="' + esc(item.id) + '" aria-label="' + esc(tr('Remove {name}', { name: item.name ? label(item.name) : tr('row') })) + '">✕</button>';
  }

  function viewPlan() {
    const s = state.settings;
    const plan = Core.monthlyPlan(state, today());
    const alloc = Core.allocate(state, today());
    const sv = alloc.savings;
    const ro = alloc.rollover;
    const rolls = state.savings.rollovers || [];
    const edited = alloc.budgets.some((b) => !b.auto);
    return (
      rolloverCard() +
      '<section class="card lang-card"><div class="card-head"><h2>' + tr('Language') + '</h2>' +
      '<div class="seg" role="group" aria-label="' + tr('Language') + '">' + I18N.LANGS.map(([code, name]) =>
        '<button data-action="set-lang" data-lang="' + code + '" lang="' + code + '" aria-pressed="' + (I18N.getLang() === code) + '">' + name + '</button>').join('') + '</div></div></section>' +
      (s.salary ? '' : '<div class="callout"><b>' + tr('Start here.') + '</b><span class="hint">' + tr('Enter your salary and payday, then your fixed payments. Everything else can come later.') + '</span></div>') +
      '<section class="card">' + titled('Salary', 'salary') + '<div class="form-grid">' +
      numInput('salary', 'settings.salary', s.salary || '', 'Monthly salary in hand (₹)') +
      numInput('payday', 'settings.payday', s.payday, 'Payday (day of month)', ' max="31"') +
      '<label class="field wide" for="plan-balance"><span>' + tr('Money in your account this morning (₹)') + '</span><input id="plan-balance" type="number" inputmode="numeric" min="0" step="1" data-balance="1" value="' +
        esc(state.balanceCheck && state.balanceCheck.date === today() ? state.balanceCheck.amount : '') + '" placeholder="' +
        (state.balanceCheck ? tr('Last entered {date}: {amount}', { date: fmtDate(state.balanceCheck.date), amount: inr(state.balanceCheck.amount) }) : tr('Optional')) + '"></label>' +
      '</div>' +
      thisMonthPay() + payHistory() + '</section>' +
      (ui.paydayOpen ? paydayCard() : '') +

      '<section class="card"><div class="card-head">' + titled('Fixed payments', 'fixed') + '<span class="hint">' + tr('Rent, EMIs, subscriptions') + '</span></div>' +
      '<div class="edit-rows">' + state.fixed.map((f) =>
        '<div class="edit-row">' + listField('fixed', f, 'name', 'Name', 'text') + listField('fixed', f, 'amount', 'Amount (₹)', 'number') +
        listField('fixed', f, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('fixed', f) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="fixed">' + tr('Add fixed payment') + '</button></div></section>' +

      '<section class="card"><div class="card-head">' + titled('Bills that vary', 'bills') + '<span class="hint">' + tr('Electricity, gas, water, recharges') + '</span></div>' +
      '<div class="edit-rows">' + (state.bills || []).map((b) =>
        '<div class="edit-row cols-bill">' + listField('bills', b, 'name', 'Name', 'text') + listField('bills', b, 'estimate', 'About (₹)', 'number') +
        '<label class="field" for="bills-' + esc(b.id) + '-every"><span>' + tr('Paid every') + '</span><select id="bills-' + esc(b.id) + '-every" data-list="bills" data-id="' + esc(b.id) + '" data-field="everyMonths">' + periodOptions(b.everyMonths) + '</select></label>' +
        listField('bills', b, 'nextDue', 'Next due', 'date') + removeButton('bills', b) + '</div>').join('') + '</div>' +
      '<div class="row"><button data-action="list-add" data-list="bills">' + tr('Add bill') + '</button>' +
      (state.fixed.length
        ? '<select id="fixed-to-bill" aria-label="' + tr('Fixed payment to move') + '">' + state.fixed.map((f) => '<option value="' + esc(f.id) + '">' + esc(f.name || tr('Unnamed')) + '</option>').join('') + '</select>' +
          '<button class="ghost" data-action="fixed-to-bill">' + tr('Move from fixed payments') + '</button>'
        : '') + '</div></section>' +

      '<section class="card"><div class="card-head">' + titled('Set aside each month', 'setaside') + modeChip(state.savings.auto) + '</div>' +
      '<div class="form-grid">' +
      numInput('emergency-monthly', 'savings.emergencyMonthly', sv.emergencyMonthly - ro.emergency, 'Emergency fund (₹)') +
      numInput('debt-extra', 'savings.debtExtra', sv.debtExtra - ro.debt, 'Extra toward debts (₹)') +
      numInput('invest-monthly', 'savings.investMonthly', sv.investMonthly - ro.grow, 'Grow budget (₹)') +
      '</div>' +
      (rolls.length
        ? '<div class="summary"><span class="eyebrow">' + tr('Kept paying yourself') + '</span>' + rolls.map((x) =>
          '<div class="line"><span>' + esc(tr(x.from)) + ' → ' + tr(ROLL_TO[x.to]) + '</span><span>' + inr(x.amount) +
          ' <button class="link" data-action="rollover-stop" data-id="' + esc(x.id) + '">' + tr('Stop') + '</button></span></div>').join('') + '</div>'
        : '') +
      (state.savings.auto
        ? sv.notes.map((n) => '<p class="hint">' + esc(n) + '</p>').join('')
        : '<div class="row"><span class="hint">' + tr('You set these amounts.') + '</span><button class="ghost" data-action="savings-auto">' + tr('Work them out for me') + '</button></div>') + '</section>' +

      '<section class="card"><div class="card-head">' + titled('Yearly costs', 'yearly') + '<span class="hint">' + tr('Festivals, insurance, servicing, school fees') + '</span></div>' +
      '<div class="edit-rows">' + state.sinking.map((f) =>
        '<div class="edit-row">' + listField('sinking', f, 'name', 'Name', 'text') + listField('sinking', f, 'amount', 'Per year (₹)', 'number') +
        '<label class="field" for="sinking-' + esc(f.id) + '-month"><span>' + tr('Month') + '</span><select id="sinking-' + esc(f.id) + '-month" data-list="sinking" data-id="' + esc(f.id) + '" data-field="month">' +
        MONTH_NAMES.map((m, i) => '<option value="' + (i + 1) + '"' + (Number(f.month) === i + 1 ? ' selected' : '') + '>' + monthName(i) + '</option>').join('') + '</select></label>' +
        removeButton('sinking', f) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="sinking">' + tr('Add yearly cost') + '</button></div></section>' +

      '<section class="card"><div class="card-head">' + titled('Flexible budgets', 'flex') + '<span class="hint">' + tr('{amount} to spend this month', { amount: inr(Math.max(0, alloc.pool)) }) + '</span></div>' +
      '<div class="edit-rows">' + alloc.budgets.map((b) => {
        const item = state.budgets.find((x) => x.id === b.id);
        return '<div class="edit-row cols-2">' + listField('budgets', item, 'name', 'Category', 'text') +
          listField('budgets', Object.assign({}, item, { amount: b.amount }), 'amount', b.auto ? tr('Auto · {pct}%', { pct: b.share }) : 'Set by you', 'number', b.auto ? ' class="auto"' : '') +
          removeButton('budgets', item) + '</div>';
      }).join('') + '</div>' +
      (alloc.budgets.length && alloc.autoPool === 0 && alloc.budgets.some((b) => b.auto) && alloc.pool > 0
        ? '<p class="hint warn">' + tr('Your own amounts use all of the money left, so the automatic budgets are at ₹0.') + '</p>' : '') +
      '<div class="row"><button data-action="list-add" data-list="budgets">' + tr('Add category') + '</button>' +
      (edited ? '<button class="ghost" data-action="budgets-auto">' + tr('Share everything out automatically') + '</button>' : '') + '</div></section>' +

      '<section class="card" id="plan-summary">' + planSummary() + '</section>' +

      '<section class="card">' + titled('Your data', 'data') +
      '<label class="check"><input id="personal-mode" type="checkbox"' + (Core.personal(state) ? ' checked' : '') + '> ' + tr('Personal mode: show where to invest (for my own use)') + '</label>' +
      '<div class="row"><button data-action="backup">' + tr(ui.backup ? 'Hide backup' : 'Show backup') + '</button>' +
      '<button data-action="restore-toggle">' + tr('Restore from backup') + '</button>' +
      '<button data-action="load-demo">' + tr('Load example data') + '</button>' +
      '<button class="danger" data-action="wipe">' + tr('Erase everything') + '</button></div>' +
      (ui.confirmWipe ? '<div class="callout bad"><b>' + tr('Erase all your data on this device?') + '</b><span class="hint">' + tr('This cannot be undone.') + '</span><div class="row"><button class="danger" data-action="wipe-confirm">' + tr('Yes, erase') + '</button><button data-action="wipe-cancel">' + tr('Cancel') + '</button></div></div>' : '') +
      (ui.backup ? '<label class="field" for="backup-text">' + tr('Backup (copy and keep it somewhere safe)') + '<textarea id="backup-text" readonly>' + esc(ui.backup) + '</textarea></label><div><button data-action="backup-copy">' + tr('Copy backup') + '</button></div>' : '') +
      (ui.restoreOpen ? '<label class="field" for="restore-text">' + tr('Paste a backup') + '<textarea id="restore-text"></textarea></label>' +
        (ui.restoreError ? '<p class="bad">' + esc(ui.restoreError) + '</p>' : '') +
        '<div><button class="primary" data-action="restore">' + tr('Restore') + '</button></div>' : '') +
      '</section>' +
      smsCleanup()
    );
  }

  // Removes payments imported from SMS before a date, for clearing out a
  // large first import. Payments added by hand are kept.
  function smsCleanup() {
    if (!state.transactions.some((x) => x.source === 'sms')) return '';
    const c = ui.smsClean;
    return '<section class="card">' + titled('Clean up SMS imports', 'smsclean') +
      '<div class="row"><label class="field grow-field" for="sms-clean-date"><span>' + tr('Remove SMS imports dated before') + '</span><input id="sms-clean-date" type="date" value="' + (c ? c.date : today()) + '" max="' + today() + '"></label></div>' +
      (c
        ? (c.count
          ? '<div class="callout bad"><b>' + tr('Remove {entries} imported from SMS before {date}?', { entries: plural(c.count, 'entry', 'entries'), date: fmtDate(c.date, true) }) + '</b>' +
            '<span class="hint">' + tr('This can’t be undone. Copy a backup first if you might want them back.') + '</span>' +
            '<div class="row"><button class="danger" data-action="sms-clean-confirm">' + tr('Yes, remove them') + '</button><button data-action="sms-clean-cancel">' + tr('Cancel') + '</button></div></div>'
          : '<p class="hint">' + tr('No SMS imports before {date}.', { date: fmtDate(c.date, true) }) + '</p>')
        : '') +
      '<div><button data-action="sms-clean">' + tr('Find SMS imports') + '</button></div></section>';
  }

  function modeChip(auto) {
    return '<span class="chip' + (auto ? ' chip-auto' : '') + '">' + tr(auto ? 'Automatic' : 'Set by you') + '</span>';
  }

  function minus(n) { return n ? '−' + inr(n) : inr(0); }

  function planSummary() {
    const p = Core.monthlyPlan(state, today());
    const line = (name, v, cls) => '<div class="line' + (cls ? ' ' + cls : '') + '"><span>' + tr(name) + '</span><span>' + v + '</span></div>';
    const left = p.unallocated;
    let html = '<div class="card-head"><h2>' + tr('Where the salary goes') + '</h2></div>' +
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
    if (left < 0) html += '<p class="hint bad">' + tr('Your plan uses more than your salary. Lower a flexible budget or the amounts set aside.') + '</p>';
    return html;
  }

  // ---------- debts ----------

  const MAX_CARDS = 10;

  function cardLabel(c) { return esc(c.name) + (c.last4 ? ' ••' + esc(c.last4) : ''); }

  function findCard(last4) {
    return (state.cards || []).find((c) => last4 && c.last4 === last4) || null;
  }

  function paidFromOptions(selected) {
    return '<option value="account"' + (!selected || selected === 'account' ? ' selected' : '') + '>' + tr('Bank account / UPI / debit card (paid from my money)') + '</option>' +
      (state.cards || []).map((c) => {
        const rate = Number(c.rate) || 42;
        return '<option value="' + esc(c.id) + '"' + (selected === c.id ? ' selected' : '') + '>' + cardLabel(c) + ' ' +
          tr(rate >= 15 ? '(borrows from next paycheck @ {rate}%)' : '(credit card @ {rate}%)', { rate }) + '</option>';
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
      ? tr('Borrowed money at {rate}% a year. Counted as spent today; it’s on the bill due {date}.', { rate, date: fmtDate(due) })
      : tr('On {card} at {rate}% a year. Counted as spent today.', { card: esc(c.name), rate });
  }

  function cardsSection() {
    const cards = state.cards || [];
    let html = '<section class="card"><div class="card-head">' + titled('Credit cards', 'cards') + '<span class="hint">' + tr('{n} of {max}', { n: cards.length, max: MAX_CARDS }) + '</span></div>';
    html += cards.map(cardBlock).join('');
    if (ui.cardForm) html += cardForm();
    else if (cards.length < MAX_CARDS) html += '<div><button data-action="card-add">' + tr('Add credit card') + '</button></div>';
    return html + '</section>';
  }

  function cardBlock(c) {
    const t = today();
    const st = Core.cardStatus(state, c, t);
    const pct = st.usedPct === null ? 0 : Math.min(100, st.usedPct);
    const meter = st.usedPct === null ? '' :
      '<div class="bar-row"><div class="bar-top"><span>' + tr('Using {owed} of {limit}', { owed: inr(st.owed), limit: inr(c.limit) }) + '</span><span class="amt' + (st.usedPct > 30 ? ' warn' : '') + '">' + st.usedPct + '%</span></div>' +
      '<div class="bar"><span class="' + (st.usedPct > 50 ? 'bad' : st.usedPct > 30 ? 'warn' : '') + '" style="width:' + pct + '%"></span></div>' +
      (st.usedPct > 30 ? '<span class="hint">' + tr('Keeping this under 30% of the limit helps your credit score.') + '</span>' : '') + '</div>';
    let html = '<div class="card-item"><div class="check-top"><div class="grow"><div class="title">' + cardLabel(c) + '</div>' +
      '<div class="meta">' + tr('Statement on the {statement}, due on the {due} · {rate}% a year', { statement: ordinal(c.statementDay), due: ordinal(c.dueDay), rate: c.rate || 42 }) + '</div></div>' +
      '<button class="ghost" data-action="card-edit" data-id="' + esc(c.id) + '">' + tr('Edit') + '</button></div>' + meter +
      '<div class="summary">' +
      '<div class="line"><span>' + (st.statementDate ? tr('Bill from {date}', { date: fmtDate(st.statementDate) }) : tr('Bill')) + '</span><span>' + inr(st.total) + '</span></div>' +
      (st.paidSince ? '<div class="line"><span>' + tr('Paid so far') + '</span><span class="good">' + inr(st.paidSince) + '</span></div>' : '') +
      '<div class="line total"><span>' + (st.remaining ? tr('To pay by {date}', { date: fmtDate(st.due) }) : tr('Bill paid')) + '</span><span' + (st.overdue ? ' class="bad"' : '') + '>' + inr(st.remaining) + '</span></div>' +
      '<div class="line"><span>' + tr('Spent since (next bill)') + '</span><span>' + inr(st.unbilled) + '</span></div></div>';
    if (st.overdue) {
      const interest = Math.round((st.remaining * (Number(c.rate) || 42)) / 1200);
      html += '<div class="callout bad"><b>' + tr('{amount} wasn’t paid by {date}.', { amount: inr(st.remaining), date: fmtDate(st.due) }) + '</b>' +
        '<span class="hint">' + tr('It now costs about {amount} interest a month, and new spending stops being interest-free. Pay it now, or move it to your loans so the payoff plan tracks it.', { amount: inr(interest) }) + '</span>' +
        '<div class="row"><button class="primary" data-action="card-plan" data-id="' + esc(c.id) + '">' + tr('Plan payment') + '</button>' +
        '<button data-action="card-revolve" data-id="' + esc(c.id) + '">' + tr('Move to loans') + '</button></div></div>';
    } else if (st.remaining) {
      html += '<div class="row"><button class="primary" data-action="card-plan" data-id="' + esc(c.id) + '">' + tr(ui.cardPlan && ui.cardPlan.cardId === c.id ? 'Hide payment plan' : 'Plan this payment') + '</button></div>';
    }
    if (ui.cardPlan && ui.cardPlan.cardId === c.id && st.remaining) html += '<div id="card-plan">' + cardPlanPanel(c) + '</div>';
    if (ui.cardRemove === c.id) {
      html += '<div class="callout bad"><b>' + tr('Remove {card}?', { card: cardLabel(c) }) + '</b><span class="hint">' + tr('Payments made with it stay in your records.') + '</span>' +
        '<div class="row"><button class="danger" data-action="card-remove-confirm" data-id="' + esc(c.id) + '">' + tr('Remove') + '</button><button data-action="card-remove-cancel">' + tr('Cancel') + '</button></div></div>';
    }
    return html + '</div>';
  }

  function ordinal(n) {
    n = Number(n) || 1;
    if (I18N.getLang() !== 'en') return String(n);
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
    const sug = (k) => (p.suggested === k ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '');
    const minPayoff = p.minPlan.payoff;
    const emiAmount = ui.cardPlan.emiAmount || p.rest || st.remaining;
    const q = Core.emiQuote(emiAmount, ui.cardPlan.emi.rate, ui.cardPlan.emi.months, ui.cardPlan.emi.fee);
    const rq = Core.revolveQuote(emiAmount, p.rate, q.emi);
    const diff = rq.cost - q.cost;
    return '<div class="callout' + (p.short ? ' warn' : '') + '"><b>' + (p.suggested === 'full' ? tr('Pay this bill in full') : tr(p.suggested === 'emi' ? 'Pay {amount} now, EMI for the rest' : 'Pay {amount} now', { amount: inr(p.payNow) })) + '</b><span class="hint">' + esc(p.reason) + '</span></div>' +
      '<div class="choices">' +
      '<div class="choice' + (p.suggested === 'full' ? ' suggested' : '') + '"><span class="choice-title">' + tr('Pay in full: {amount}', { amount: inr(st.remaining) }) + sug('full') + '</span>' +
      '<span class="choice-detail">' + tr('No interest, and new spending stays interest-free.') + '</span>' +
      '<div><button class="primary" data-action="card-pay" data-id="' + esc(c.id) + '" data-amount="' + st.remaining + '">' + tr('I paid {amount}', { amount: inr(st.remaining) }) + '</button></div></div>' +

      (st.minLeft > 0 && st.minLeft < st.remaining
        ? '<div class="choice"><span class="choice-title">' + tr('Minimum only: {amount}', { amount: inr(st.minLeft) }) + '</span>' +
          '<span class="choice-detail bad">' + tr('{amount} stays on the card at {rate}% a year: about {interest} interest next month, and new spending stops being interest-free.', { amount: inr(st.remaining - st.minLeft), rate: p.rate, interest: inr(p.minPlan.interestNextMonth) }) +
          (minPayoff && !minPayoff.neverPaysOff ? ' ' + tr('Paying only this much each month, it takes {months} and {interest} in interest to clear.', { months: plural(minPayoff.months, 'month'), interest: inr(minPayoff.interest) }) : '') + ' ' + tr('This is how the card trap starts.') + '</span>' +
          '<div><button data-action="card-pay" data-id="' + esc(c.id) + '" data-amount="' + st.minLeft + '">' + tr('I paid the minimum') + '</button></div></div>'
        : '') +

      '<div class="choice' + (p.suggested === 'part' ? ' suggested' : '') + '"><span class="choice-title">' + tr('Pay part') + sug('part') + '</span>' +
      '<span class="choice-detail">' + tr('Pay as much as you can now; the rest costs {rate}% a year until it’s paid.', { rate: p.rate }) + '</span>' +
      '<div class="row"><label class="field grow-field" for="card-part-' + esc(c.id) + '"><span>' + tr('Amount (₹)') + '</span><input id="card-part-' + esc(c.id) + '" type="number" inputmode="numeric" min="1" value="' + p.payNow + '"></label>' +
      '<button data-action="card-pay-part" data-id="' + esc(c.id) + '">' + tr('I paid this') + '</button></div></div>' +

      '<div class="choice' + (p.suggested === 'emi' ? ' suggested' : '') + '"><span class="choice-title">' + tr('Convert to EMI') + sug('emi') + '</span>' +
      '<span class="choice-detail">' + tr('Check the bank’s offer: rate, months and processing fee.') + '</span>' +
      '<div class="form-grid">' +
      '<label class="field" for="emi-amount"><span>' + tr('Amount (₹)') + '</span><input id="emi-amount" data-emi="emiAmount" type="number" inputmode="numeric" min="1" value="' + emiAmount + '"></label>' +
      '<label class="field" for="emi-rate"><span>' + tr('Interest (% a year)') + '</span><input id="emi-rate" data-emi="rate" type="number" inputmode="decimal" min="0" value="' + ui.cardPlan.emi.rate + '"></label>' +
      '<label class="field" for="emi-months"><span>' + tr('Months') + '</span><select id="emi-months" data-emi="months">' + [3, 6, 9, 12, 18, 24].map((m) => '<option value="' + m + '"' + (Number(ui.cardPlan.emi.months) === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label>' +
      '<label class="field" for="emi-fee"><span>' + tr('Processing fee (₹)') + '</span><input id="emi-fee" data-emi="fee" type="number" inputmode="numeric" min="0" value="' + ui.cardPlan.emi.fee + '"></label>' +
      '</div>' +
      '<div class="summary">' +
      '<div class="line"><span>' + tr('EMI') + '</span><span>' + q.months + ' × ' + inr(q.emi) + '</span></div>' +
      '<div class="line"><span>' + tr('Interest + fee') + '</span><span>' + inr(q.cost) + '</span></div>' +
      '<div class="line"><span>' + tr('Same payments, left on the card') + '</span><span>' + (rq.neverPaysOff ? tr('never cleared') : tr('{amount} interest', { amount: inr(rq.cost) })) + '</span></div>' +
      '<div class="line total"><span>' + tr(diff >= 0 ? 'EMI saves' : 'EMI costs more by') + '</span><span class="' + (diff >= 0 ? 'good' : 'bad') + '">' + inr(Math.abs(diff)) + '</span></div></div>' +
      '<span class="choice-detail">' + tr('An EMI is still a loan: {n} payments of {amount} are added to every month’s plan until it’s cleared.', { n: q.months, amount: inr(q.emi) }) + '</span>' +
      '<div><button data-action="card-emi" data-id="' + esc(c.id) + '">' + tr('Convert {amount} to EMI', { amount: inr(emiAmount) }) + '</button></div></div>' +
      '</div>';
  }

  function cardForm() {
    const c = ui.cardForm.id ? state.cards.find((x) => x.id === ui.cardForm.id) : {};
    const f = (id, name, type, value, extra) => '<label class="field" for="' + id + '"><span>' + tr(name) + '</span><input id="' + id + '" type="' + type + '"' +
      (type === 'number' ? ' inputmode="numeric" min="0"' : '') + ' value="' + esc(value == null ? '' : value) + '"' + (extra || '') + '></label>';
    return '<div class="card-form"><h3>' + (c.id ? tr('Edit {card}', { card: cardLabel(c) }) : tr('Add a credit card')) + '</h3>' +
      '<div class="form-grid">' +
      f('cf-name', 'Name', 'text', c.name || '', ' placeholder="' + tr('HDFC card') + '"') +
      f('cf-last4', 'Last 4 digits', 'text', c.last4 || '', ' inputmode="numeric" maxlength="4" placeholder="1234"') +
      f('cf-limit', 'Credit limit (₹)', 'number', c.limit || '') +
      f('cf-rate', 'Interest (% a year)', 'number', c.rate || 42) +
      f('cf-stmt', 'Statement day', 'number', c.statementDay || '', ' max="31" placeholder="5"') +
      f('cf-due', 'Due day', 'number', c.dueDay || '', ' max="31" placeholder="25"') +
      '</div>' +
      (c.id ? '' :
        '<p class="hint">' + tr('What you owe right now, from your card app or last statement:') + '</p><div class="form-grid">' +
        f('cf-owed', 'Amount due on last statement (₹)', 'number', '') +
        f('cf-owed-due', 'Its due date', 'date', '') +
        f('cf-unbilled', 'Spent since that statement (₹)', 'number', '') + '</div>') +
      (ui.cardForm.error ? '<p class="bad">' + esc(ui.cardForm.error) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="card-save">' + tr(c.id ? 'Save' : 'Add card') + '</button>' +
      '<button class="ghost" data-action="card-cancel">' + tr('Cancel') + '</button>' +
      (c.id ? '<span class="spacer"></span><button class="danger" data-action="card-remove" data-id="' + esc(c.id) + '">' + tr('Remove card') + '</button>' : '') + '</div></div>';
  }

  function saveCard() {
    const v = (id) => (document.getElementById(id) || {}).value || '';
    const name = v('cf-name').trim();
    const last4 = v('cf-last4').replace(/\D/g, '');
    const day = (x) => Math.min(31, Math.max(1, Math.round(Number(x) || 0)));
    if (!name) { ui.cardForm.error = tr('Give the card a name, like “HDFC card”.'); return; }
    if (last4.length !== 4) { ui.cardForm.error = tr('Enter the last 4 digits of the card number, so bank SMS can be matched to it.'); return; }
    if (!Number(v('cf-stmt')) || !Number(v('cf-due'))) { ui.cardForm.error = tr('Enter the statement day and due day from your card statement.'); return; }
    if ((state.cards || []).some((c) => c.last4 === last4 && c.id !== ui.cardForm.id)) { ui.cardForm.error = tr('You already have a card ending {last4}.', { last4 }); return; }
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
    toast(tr('{name} saved', { name: card.name }));
  }

  // Interest leaking out every day, at the top of the Debts tab.
  function leakBanner() {
    const l = Core.interestLeak(state, today());
    if (l.daily < 1) return '';
    const worst = l.items.filter((x) => x.daily > 0).sort((a, b) => b.daily - a.daily);
    return '<section class="leak-banner' + (l.high ? '' : ' amber') + '"><h2>' + tr('You are losing {amount}/day to bank interest', { amount: inr(l.daily) }) + '</h2>' +
      '<span class="hint">' + tr('That’s {amount} a month. Biggest: {list}.', { amount: inr(l.monthly), list: worst.slice(0, 2).map((x) => tr('{name} ({daily}/day at {rate}%)', { name: esc(x.name), daily: inr(x.daily), rate: x.rate })).join(', ') }) + '</span></section>';
  }

  // Shown when a card payment is added: it's borrowed money.
  function cardSpendWarning(tx) {
    const c = (state.cards || []).find((x) => x.id === tx.paidFrom);
    if (!c) return tr('{amount} added', { amount: inr(tx.amount) });
    const st = Core.cardStatus(state, c, today());
    const z = Core.zoneStatus(state, today());
    return tr('Borrowed {amount} on {card}. Counted as spent today; next bill so far {bill}.', { amount: inr(tx.amount), card: c.name, bill: inr(st.unbilled) }) +
      (z.zone !== 'green' ? ' ' + tr('You’re not in the green: this lands on next month’s salary.') : '');
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
        const v = { card: cardLabel(c), amount: inr(st.remaining), date: fmtDate(st.due), days: plural(st.daysToDue, 'day') };
        html += '<div class="callout ' + (st.overdue ? 'bad' : 'warn') + '"><b>' + tr(st.overdue ? '{card} bill: {amount} was due {date}'
          : st.daysToDue === 0 ? '{card} bill: {amount} due today' : st.daysToDue === 1 ? '{card} bill: {amount} due tomorrow' : '{card} bill: {amount} due in {days}', v) + '</b>' +
          '<span class="hint">' + tr('Pay it in full to avoid interest. The money was kept aside when you spent it.') + '</span>' +
          '<div><button class="primary" data-action="tab" data-tab="debts">' + tr('Plan payment') + '</button></div></div>';
      }
    });
    const onCards = state.transactions.filter((x) => Core.isFlexible(x) && x.paidFrom && x.paidFrom !== 'account' && Core.inCycle(x.date, cyc))
      .reduce((a, x) => a + x.amount, 0);
    if (onCards) {
      html += '<p class="hint card-note">' + tr('{amount} spent on credit cards this month. It’s counted as spent and kept aside for the bills.', { amount: inr(onCards) }) + '</p>';
    }
    return html;
  }

  function viewDebts() {
    const t = today();
    const debts = state.debts.filter((d) => Number(d.balance) > 0);
    const alloc = Core.allocate(state, t);
    const extra = alloc.savings.debtExtra;
    let compare = '';
    if (debts.length) {
      const c = Core.compareDebtPlans(debts, extra);
      const card = (title, res, base, best) => {
        if (res.neverPaysOff) {
          return '<div class="plan-card"><span class="eyebrow">' + tr(title) + '</span><span class="big bad">' + tr('Never paid off') + '</span><span class="hint">' + tr('A minimum payment is smaller than the monthly interest.') + '</span></div>';
        }
        return '<div class="plan-card' + (best ? ' best' : '') + '"><span class="eyebrow">' + tr(title) + '</span>' +
          '<span class="big">' + monthYear(Core.addMonths(t, res.months)) + '</span>' +
          '<span class="hint">' + plural(res.months, 'month') + ' · ' + tr('{amount} interest', { amount: inr(res.totalInterest) }) + '</span>' +
          (base && !base.neverPaysOff && base.totalInterest > res.totalInterest ? '<span class="good">' + tr('Saves {amount}', { amount: inr(base.totalInterest - res.totalInterest) }) + '</span>' : '') +
          (res.order.length > 1 ? '<ol>' + res.order.map((o) => '<li>' + tr('{name} cleared in month {month}', { name: esc(o.name), month: o.month }) + '</li>').join('') + '</ol>' : '') +
          '</div>';
      };
      const bestKey = c.avalanche.totalInterest <= c.snowball.totalInterest ? 'avalanche' : 'snowball';
      compare =
        '<section class="card">' + titled('When will you be debt-free?', 'payoff') +
        '<div class="form-grid">' + numInput('debt-extra-2', 'savings.debtExtra', extra - alloc.rollover.debt, 'Extra per month on top of minimums (₹)') + '</div>' +
        (alloc.rollover.debt ? '<p class="hint">' + tr('Plus {amount} a month kept from cleared loans.', { amount: inr(alloc.rollover.debt) }) + '</p>' : '') +
        '<div class="plans">' +
        card('Minimums only', c.minimum, null, false) +
        (extra > 0
          ? card('Highest interest first', c.avalanche, c.minimum, bestKey === 'avalanche') + card('Smallest balance first', c.snowball, c.minimum, bestKey === 'snowball' && c.snowball.totalInterest < c.avalanche.totalInterest)
          : '<div class="plan-card"><span class="eyebrow">' + tr('With an extra payment') + '</span><span class="hint">' + tr('Add an extra amount above to see how much sooner you could finish and how much interest you would save.') + '</span></div>') +
        '</div></section>';
    }

    return (
      rolloverCard() +
      leakBanner() +
      cardsSection() +
      '<section class="card"><div class="card-head">' + titled('Loans', 'loans') + '</div>' +
      (state.debts.length ? '' : '<p class="hint">' + tr('No loans added.') + '</p>') +
      '<div class="edit-rows">' + state.debts.map((d) =>
        '<div class="edit-row cols-debt">' + listField('debts', d, 'name', 'Name', 'text') + listField('debts', d, 'balance', 'Balance (₹)', 'number') +
        listField('debts', d, 'rate', 'Interest %/yr', 'number') + listField('debts', d, 'minPayment', 'Monthly min (₹)', 'number') +
        listField('debts', d, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('debts', d) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="debts">' + tr('Add loan') + '</button></div>' +
      (debts.length ? '<div class="list">' + debts.map((d) => {
        const i = (d.balance * d.rate) / 1200;
        return '<div class="list-item"><div class="grow"><div class="title">' + esc(d.name) + '</div><div class="meta">' + tr('{rate}% a year', { rate: d.rate }) + '</div></div>' +
          '<div class="amt ' + (d.rate >= 15 ? 'bad' : '') + '">' + tr('{amount} interest/month', { amount: inr(i) }) + '</div></div>';
      }).join('') + '</div>' : '') +
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
    if (monthsToTarget === 0) fundNote = tr('Target reached.');
    else if (monthsToStarter) fundNote = tr('<b>First milestone: one month of needs ({amount})</b>. At {monthly} a month you get there in {months}. Clearing expensive debt first speeds up the rest.', { amount: inr(starter), monthly: inr(p.emergency), months: plural(monthsToStarter, 'month') });
    else if (monthsToTarget) fundNote = tr('One month of needs is covered. At {monthly} a month you reach the full target in {months}.', { monthly: inr(p.emergency), months: plural(monthsToTarget, 'month') });
    else fundNote = tr('Set a monthly amount in the Plan tab to start building it.');

    const movedThisCycle = state.transactions.filter((x) => Core.isMove(x) && Core.inCycle(x.date, cyc)).reduce((a, x) => a + x.amount, 0);
    const setAside = [
      ['Emergency fund', p.emergency], ['Extra toward debts', p.debtExtra], ['Grow budget', p.invest], ['Yearly costs', p.sinking],
    ].filter((x) => x[1] > 0);

    return (
      (movedThisCycle ? '<div class="callout good"><b>' + tr('{amount} saved from daily leftovers this month', { amount: inr(movedThisCycle) }) + '</b><span class="hint">' + tr('Every unspent day you move to savings or a loan gets you closer to a loan-free life.') + '</span></div>' : '') +
      '<section class="card"><div class="card-head">' + titled('This month’s set-aside', 'setaside') + '<span class="hint">' + tr('Cycle starting {date}', { date: fmtDate(cyc.start) }) + '</span></div>' +
      (setAside.length
        ? '<div class="summary">' + setAside.map((x) => '<div class="line"><span>' + tr(x[0]) + '</span><span>' + inr(x[1]) + '</span></div>').join('') + '</div>' +
          (recorded
            ? '<p class="good">' + tr('Recorded for this cycle. Your balances below include it.') + '</p>'
            : '<div><button class="primary" data-action="record-savings">' + tr('I’ve moved this money aside') + '</button></div>')
        : '<p class="hint">' + tr('Nothing set aside yet. Add amounts in the Plan tab.') + '</p>') +
      '</section>' +

      '<section class="card">' + freedomHeader() +
      '<div class="form-grid">' + numInput('emergency-balance', 'savings.emergencyBalance', sv.emergencyBalance, 'Saved so far (₹)') +
      '<label class="field" for="emergency-target"><span>' + tr('Target') + '</span><select id="emergency-target" data-bind="savings.emergencyTargetMonths">' +
      [3, 6].map((m) => '<option value="' + m + '"' + (Number(sv.emergencyTargetMonths) === m ? ' selected' : '') + '>' + plural(m, 'month') + '</option>').join('') + '</select></label></div>' +
      '<div class="bar-row"><div class="bar-top"><span>' + tr('{amount} of {target}', { amount: inr(sv.emergencyBalance), target: inr(target) }) + '</span><span class="amt">' + Math.round(fundPct) + '%</span></div>' +
      '<div class="bar"><span style="width:' + fundPct.toFixed(1) + '%"></span></div></div>' +
      '<p class="hint">' + fundNote + '</p>' +
      (Core.personal(state) ? '<p class="hint">' + tr('<b>Where to keep it:</b> one month of needs in your savings account, the rest in a sweep-in FD or a liquid fund. Both pay more and give money back within about a day.') + '</p>' : '') +
      '</section>' +

      (state.sinking.length
        ? '<section class="card"><h2>' + tr('Yearly costs') + '</h2><div class="bars">' + state.sinking.map((f) => {
          const saved = Number(f.saved) || 0;
          const pct = f.amount > 0 ? Math.min(100, (saved / f.amount) * 100) : 0;
          return '<div class="bar-row"><div class="bar-top"><span>' + esc(f.name) + ' · ' + monthName((Number(f.month) || 1) - 1) + '</span><span class="amt">' + tr('{amount} of {target}', { amount: inr(saved), target: inr(f.amount) }) + '</span></div>' +
            '<div class="bar"><span class="marigold" style="width:' + pct.toFixed(1) + '%"></span></div></div>';
        }).join('') + '</div></section>'
        : '') +

      viewEmergency() +

      '<section class="card"><div class="card-head">' + titled('Grow', Core.personal(state) ? 'invest' : 'grow') + '<span class="hint">' + tr('Money set aside to invest') + '</span></div>' +
      '<div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
      tile('Set aside so far', inr(sv.investSaved), 'From your Grow budget') +
      tile('Each month', inr(p.invest), p.invest ? 'Grow budget' : 'Not started yet') + '</div>' +
      (Core.personal(state)
        ? investGuide()
        : '<div class="callout"><b>' + tr('Ready to invest this money?') + '</b>' +
          '<span>' + tr('Talk to a <b>SEBI-registered investment adviser</b> before investing. They can look at your goals and suggest options that suit you. All investments carry risk, and the decision is yours.') + '</span></div>') +
      '</section>' +

      '<section class="card"><h2>' + tr('Learn the basics') + '</h2>' + LESSONS.map((l) =>
        '<details class="lesson"><summary>' + tr(l[0]) + '</summary><p>' + tr(l[1]) + '</p></details>').join('') + '</section>'
    );
  }

  const STAGE_TITLES = {
    shield: 'Not yet: build your 30-day shield first',
    debt: 'Not yet: clear costly loans first',
    fund: 'Start investing, alongside your fund',
    invest: 'Ready to invest',
  };

  // Personal mode: where the Grow budget goes, freedom first.
  function investGuide() {
    const g = Core.investPlan(state, today());
    const ready = g.stage === 'fund' || g.stage === 'invest';
    return '<div class="callout ' + (ready ? 'good' : 'warn') + '"><b>' + tr(STAGE_TITLES[g.stage]) + '</b><span class="hint">' + esc(g.reason) + '</span></div>' +
      '<div class="form-grid">' + numInput('age', 'settings.age', state.settings.age || '', 'Your age', ' max="100" placeholder="' + tr('Optional') + '"') +
      '<div class="field wide"><span>' + tr('Risk comfort') + '</span><div class="seg" role="group" aria-label="' + tr('Risk comfort') + '">' +
      [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map((x) =>
        '<button data-action="set-risk" data-risk="' + x[0] + '" aria-pressed="' + (g.risk === x[0]) + '">' + tr(x[1]) + '</button>').join('') + '</div></div></div>' +
      '<span class="eyebrow">' + tr(ready ? 'Split for money you won’t need for 5+ years' : 'When you’re ready: split for money you won’t need for 5+ years') + '</span>' +
      '<div class="bars">' + g.lines.map((l) =>
        '<div class="bar-row invest-line"><div class="bar-top"><span><b>' + l.pct + '%</b> ' + l.title + '</span><span class="amt">' + (g.monthly ? tr('{amount}/mo', { amount: inr(l.amount) }) : '') + '</span></div>' +
        '<div class="bar"><span class="k-' + l.key + '" style="width:' + l.pct + '%"></span></div>' +
        '<p class="hint">' + l.detail + '</p></div>').join('') + '</div>' +
      (g.projection.length
        ? '<div class="summary"><span class="eyebrow">' + tr('{amount} a month at an assumed {rate}% a year', { amount: inr(g.monthly), rate: g.blended }) + '</span>' +
          g.projection.map((x) => '<div class="line"><span>' + tr('In {years} years', { years: x.years }) + '<span class="hint line-sub">' + tr('{amount} put in', { amount: inr(x.invested) }) + '</span></span><span class="good">' + inr(x.value) + '</span></div>').join('') +
          '<span class="hint">' + tr('Assumed, not guaranteed. Markets fall as well as rise.') + '</span></div>'
        : '<p class="hint">' + tr('Set a Grow budget in the Plan tab to see monthly amounts.') + '</p>');
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
    let html = '<section class="card"><div class="card-head">' + titled('Something unexpected happened?', 'emergency') + '</div>';
    if (adj) {
      html += '<div class="callout warn"><b>' + tr('Recovery plan active until {date} ({reason})', { date: fmtDate(adj.until, true), reason: esc(label(adj.reason)) }) + '</b>' +
        '<span class="hint">' + [tr('Flexible budgets −{pct}%', { pct: adj.flexCutPct }), adj.pauseInvest ? tr('Grow paused') : '', adj.pauseDebtExtra ? tr('extra debt payments paused') : ''].filter(Boolean).join(', ') + '.</span>' +
        '<div><button data-action="adjust-end">' + tr('End recovery plan now') + '</button></div></div>';
    }
    html += '<div class="form-grid">' +
      '<label class="field" for="em-type"><span>' + tr('What happened') + '</span><select id="em-type" data-em="type">' +
      EMERGENCY_TYPES.map((x) => '<option value="' + esc(x) + '"' + (x === e.type ? ' selected' : '') + '>' + esc(label(x)) + '</option>').join('') + '</select></label>' +
      '<label class="field" for="em-amount"><span>' + tr('Cost (₹)') + '</span><input id="em-amount" type="number" inputmode="numeric" min="0" data-em="amount" value="' + esc(e.amount) + '" placeholder="25000"></label>' +
      '<label class="field wide" for="em-cut"><span>' + tr('Cut flexible budgets by <b id="em-cut-label">{pct}%</b> while recovering', { pct: e.cut }) + '</span><input id="em-cut" type="range" min="0" max="50" step="5" data-em="cut" value="' + e.cut + '"></label>' +
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
    if (p.fromFund > 0) steps.push(tr('Use <b>{amount}</b> from your emergency fund.', { amount: inr(p.fromFund) }));
    if (p.shortfall > 0) {
      steps.push(tr('The remaining <b>{amount}</b> comes out of this month’s money. The runway graph will show the effect.', { amount: inr(p.shortfall) }));
      const freed = [];
      if (p.pausedInvest) freed.push(tr('pause the Grow budget ({amount})', { amount: inr(p.pausedInvest) }));
      if (p.pausedDebtExtra) freed.push(tr('pause extra debt payments ({amount})', { amount: inr(p.pausedDebtExtra) }));
      if (p.flexCut) freed.push(tr('spend {amount} less on flexible budgets', { amount: inr(p.flexCut) }));
      if (freed.length) steps.push(tr('Each month: {list}. That frees <b>{amount}</b> a month.', { list: freed.join(', '), amount: inr(p.freed) }));
      steps.push(tr('Keep paying all EMIs and card minimums. Missing them adds penalties and hurts your credit score.'));
    }
    let outcome;
    if (p.shortfall > 0 && !isFinite(p.recoverMonths)) {
      outcome = '<div class="callout bad"><b>' + tr('Nothing is freed up yet.') + '</b><span class="hint">' + tr('Raise the budget cut or add a Grow or extra debt amount in the Plan tab to see a recovery date.') + '</span></div>';
    } else {
      outcome = '<div class="callout good"><b>' +
        (p.shortfall > 0 ? tr('Back on your normal plan by {date}', { date: fmtDate(p.backOnTrack, true) }) : tr('Your emergency fund covers it.')) + '</b>' +
        (p.fromFund > 0 ? '<span class="hint">' + (isFinite(p.refillMonths) ? tr('Emergency fund refilled by {date} at your usual monthly amount.', { date: fmtDate(p.fundRefilled, true) }) : tr('Set an emergency fund amount in the Plan tab to refill it.')) + '</span>' : '') +
        '</div>';
    }
    return '<ol class="stack" style="padding-left:20px;margin:0">' + steps.map((s) => '<li>' + s + '</li>').join('') + '</ol>' + outcome +
      '<div><button class="primary" data-action="em-apply">' + tr('Apply this plan') + '</button></div>';
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
    toast(tr('Recovery plan applied'));
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
    if (ev.target.classList && ev.target.classList.contains('help-overlay')) {
      ui.helpFrom = ui.help; ui.help = null; rerenderKeepScroll(); return;
    }
    if (ev.target.classList && ev.target.classList.contains('borrow-overlay')) { ui.borrow = null; rerenderKeepScroll(); return; }
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
        ui.smsClean = null; save(); toast(tr('{entries} removed', { entries: plural(removed.length, 'entry', 'entries') })); break;
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
          ui.restoreError = tr('That doesn’t look like a Salary Runway backup. Paste the full text from “Show backup”.');
        }
        break;
      }
      case 'budgets-auto': state.budgets.forEach((b) => { b.auto = true; }); save(); toast('Budgets shared out automatically'); break;
      case 'savings-auto': state.savings.auto = true; save(); toast('Set-asides worked out from your numbers'); break;
      case 'list-add':
        state[btn.dataset.list] = state[btn.dataset.list] || [];
        state[btn.dataset.list].push(listDefaults(btn.dataset.list)); save(); break;
      case 'list-remove': {
        const item = state[btn.dataset.list].find((x) => x.id === btn.dataset.id);
        // A loan or EMI that's gone frees its monthly payment.
        if (item && btn.dataset.list === 'debts' && item.balance > 0) askRollover({ from: item.name || 'Your loan', amount: Number(item.minPayment) || 0, kind: 'loan' });
        if (item && btn.dataset.list === 'fixed' && /\bemi\b|loan/i.test(item.name || '')) askRollover({ from: item.name, amount: Number(item.amount) || 0, kind: 'loan' });
        state[btn.dataset.list] = state[btn.dataset.list].filter((x) => x !== item); save(); break;
      }
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
      case 'help': ui.help = btn.dataset.help; break;
      case 'set-lang': setLang(btn.dataset.lang); widgetSent = ''; alertsSent = ''; break;
      case 'set-risk': state.settings.risk = btn.dataset.risk; save(); break;
      case 'borrow-open': ui.borrow = { amount: Number(btn.dataset.amount) || 0, urgent: true, months: 12, focus: true }; break;
      case 'borrow-mode': ui.borrow.urgent = btn.dataset.urgent === '1'; break;
      case 'borrow-months': ui.borrow.months = Number(btn.dataset.months) || 12; break;
      case 'borrow-close': ui.borrow = null; break;
      case 'borrow-use': {
        const u = Core.borrowCheck(state, ui.borrow.amount, t).urgent;
        if (u.fromFund > 0) {
          state.transactions.push({ id: uid(), kind: 'in', date: t, amount: u.fromFund, category: 'From emergency fund', note: 'Emergency fund', source: 'manual', useFor: 'spend', fromFund: true });
          state.savings.emergencyBalance = Math.max(0, (Number(state.savings.emergencyBalance) || 0) - u.fromFund);
        }
        if (u.pause > 0) {
          const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
          state.adjustment = { until: cyc.next, flexCutPct: 0, pauseInvest: true, pauseDebtExtra: true, reason: 'Big expense' };
        }
        ui.borrow = null;
        save(); toast((u.fromFund ? tr('{amount} moved from your emergency fund.', { amount: inr(u.fromFund) }) : tr('Grow and extra payments paused until payday.')) + ' ' + tr('Record the payment when you pay.')); break;
      }
      case 'borrow-recover':
        ui.emergency.amount = String(ui.borrow.amount);
        ui.borrow = null;
        setTab('grow');
        setTimeout(() => { const el = document.getElementById('em-amount'); if (el) el.scrollIntoView({ block: 'center' }); }, 0);
        return;
      case 'rollover-use': {
        const a = state.rolloverAsk;
        if (!a) break;
        const opt = Core.rolloverOptions(state, a.amount, t).options.find((x) => x.to === btn.dataset.to);
        state.rolloverAsk = null;
        if (btn.dataset.to === 'spend') { save(); toast('Added to your flexible budgets'); break; }
        state.savings.rollovers = (state.savings.rollovers || []).concat({ id: uid(), from: a.from, amount: a.amount, to: btn.dataset.to, date: t, kind: a.kind });
        save(); celebrate(tr('Nice move!') + ' ' + (opt ? opt.detail : tr('{amount} a month kept for you.', { amount: inr(a.amount) }))); break;
      }
      case 'rollover-later': ui.rolloverHidden = true; break;
      case 'rollover-stop':
        state.savings.rollovers = (state.savings.rollovers || []).filter((x) => x.id !== btn.dataset.id);
        save(); toast('Stopped. That money goes back to your budgets.'); break;
      case 'loan-add': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (!tx) break;
        const d = Object.assign(listDefaults('debts'), { name: tx.note && tx.note !== 'Money received' ? tx.note : 'Loan', balance: tx.amount });
        state.debts.push(d);
        tx.debtId = d.id;
        save(); setTab('debts'); toast('Added. Enter its interest rate and monthly EMI.'); return;
      }
      case 'loan-known': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx) tx.debtId = 'known';
        save(); break;
      }
      case 'help-close': ui.helpFrom = ui.help; ui.help = null; break;
      case 'reset-next': ui.reset.step = 2; break;
      case 'reset-back': ui.reset.step = 1; break;
      case 'reset-later': ui.reset = null; toast('You can set aside your savings from the Grow tab.'); break;
      case 'reset-lock': {
        const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
        const plan = Core.paydayReset(state, t).parts;
        const e = ui.reset.edit;
        const changed = ['emergency', 'debtExtra', 'invest'].some((k) => Math.round(e[k] || 0) !== Math.round(plan[k] || 0));
        state.payslips = state.payslips || {};
        state.payslips[cyc.start] = state.payslips[cyc.start] || { amount: Number(state.settings.salary) || 0, usual: Number(state.settings.salary) || 0, reason: '', note: '' };
        // Only an edit becomes this month's own set-aside; otherwise the plan stays in charge.
        if (changed) state.payslips[cyc.start].setAside = { emergency: Math.round(e.emergency || 0), debtExtra: Math.round(e.debtExtra || 0), invest: Math.round(e.invest || 0) };
        lockInSetAside(Core.paydayReset(state, t).parts);
        ui.reset.step = 3;
        save(); haptic(); break;
      }
      case 'reset-start': ui.reset = null; celebrate('Your month has started. Stay at or under your daily amount.'); break;
      case 'saved-dest': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (!tx) return;
        setIncomeUse(tx, btn.dataset.use, btn.dataset.debt);
        tx.needsReview = false;
        tx.autoUse = false;
        learnSaving(tx, btn.dataset.use, btn.dataset.debt);
        save(); celebrate(rewardMessage(btn.dataset.use, tx.amount, btn.dataset.debt, false)); break;
      }
      case 'saved-change': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (!tx) return;
        undoIncomeUse(tx);
        tx.useFor = null;
        tx.autoUse = false;
        tx.needsReview = true;
        save(); window.scrollTo(0, 0); render(); toast('Choose where it counts, at the top.'); return;
      }
      case 'saved-was-spend': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (!tx) return;
        undoIncomeUse(tx);
        delete tx.kind; delete tx.useFor;
        tx.category = 'Misc';
        tx.needsReview = true;
        save(); toast('Recorded as spending. Pick its category.'); break;
      }
      case 'payday-save': savePayday(document.getElementById('pay-amount').value); break;
      case 'payday-same': savePayday(state.settings.salary); break;
      case 'payday-open':
        // Last month's report card comes first, once.
        if (reportPending()) { ui.report = true; ui.reportFocused = false; ui.reportThenPay = true; } else ui.paydayOpen = true;
        break;
      case 'report-open': ui.report = true; ui.reportFocused = false; ui.reportThenPay = false; break;
      case 'report-done': {
        const r = Core.monthReport(state, t);
        state.reportSeen = r.cycle.start;
        ui.report = false;
        save();
        const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
        // On to this month's payday check-in: when it's still to do, or it's what was tapped.
        const thenPay = ui.reportThenPay;
        ui.reportThenPay = false;
        if ((state.payslips || {})[cyc.start] && !thenPay) break;
        ui.paydayOpen = true;
        if (tab !== 'plan') { setTab('home'); return; }
        rerenderKeepScroll();
        const card = document.querySelector('.payday-card');
        if (card) card.scrollIntoView({ block: 'start' });
        return;
      }
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
        toast(st.remaining ? tr('{amount} paid. {left} still to pay by {date}.', { amount: inr(amount), left: inr(st.remaining), date: fmtDate(st.due) }) : tr('Bill paid in full. No interest this month.'));
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
        toast(tr('{amount} moved to an EMI: {n} × {emi} a month, in your plan from next month.', { amount: inr(amount), n: res.debt.months, emi: inr(res.debt.minPayment) }));
        break;
      }
      case 'card-revolve': {
        const c = state.cards.find((x) => x.id === btn.dataset.id);
        const st = Core.cardStatus(state, c, t);
        const res = Core.convertCardBalance(state, c.id, st.remaining, { kind: 'revolve' }, t);
        if (!res) return;
        save(); toast(tr('{amount} moved to your loans. See the payoff plan below.', { amount: inr(st.remaining) }));
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
        toast(tr('{amount} paid. Next due {date}', { amount: inr(amount), date: fmtDate(state.bills.find((x) => x.id === id).nextDue, true) }));
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
        save(); toast(tr('Linked to {name}', { name: b.name })); break;
      }
      case 'fixed-to-bill': {
        const f = state.fixed.find((x) => x.id === document.getElementById('fixed-to-bill').value);
        if (!f) return;
        const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
        state.bills = state.bills || [];
        state.bills.push({ id: uid(), name: f.name, estimate: Number(f.amount) || 0, everyMonths: 1, nextDue: Core.occurrenceInCycle(Number(f.dueDay) || 1, cyc) || t });
        state.fixed = state.fixed.filter((x) => x !== f);
        save(); toast(tr('{name} moved to bills that vary', { name: f.name })); break;
      }
      case 'zone-fund': {
        const amount = Number(btn.dataset.amount) || 0;
        state.transactions.push({ id: uid(), kind: 'in', date: t, amount, category: 'From emergency fund', note: 'Emergency fund', source: 'manual', useFor: 'spend', fromFund: true });
        state.savings.emergencyBalance = Math.max(0, (Number(state.savings.emergencyBalance) || 0) - amount);
        save(); toast(tr('{amount} moved from your emergency fund.', { amount: inr(amount) })); break;
      }
      case 'zone-pause': {
        const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
        state.adjustment = { until: cyc.next, flexCutPct: 0, pauseInvest: true, pauseDebtExtra: true, reason: 'Short this month' };
        save(); toast('Paused until payday'); break;
      }
      case 'save-day': {
        const amount = Number(btn.dataset.amount) || 0;
        // The Jar (or similar) SMS for this may already be here.
        let tx = savedTwin(amount, t, true);
        if (tx) { tx.needsReview = false; tx.autoUse = false; learnSaving(tx, btn.dataset.use, btn.dataset.debt); }
        else {
          tx = { id: uid(), kind: 'move', date: t, amount, category: 'Savings', note: 'Unspent on ' + fmtDate(btn.dataset.date), source: 'manual', useFor: null };
          state.transactions.push(tx);
        }
        // It's that day's leftover, so it doesn't come off today's amount.
        tx.forDate = btn.dataset.date;
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
        ui.smsRows = null; ui.smsText = ''; markSmsSeen(); save(); toast(tr('{items} added', { items: plural(added, 'item') }));
        announceAutoSaved(); break;
      }
      case 'record-savings': {
        // Same as the payday reset's lock-in, so a matching Jar SMS joins it instead of counting twice.
        lockInSetAside(Core.paydayReset(state, t).parts);
        save(); celebrate('Savings recorded for this month'); break;
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
    if (el.id === 'personal-mode') {
      state.settings.personal = el.checked;
      save(); toast(el.checked ? 'Personal mode on: the Grow tab shows where to invest' : 'Personal mode off'); rerenderKeepScroll(); return;
    }
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
        const a = Core.allocate(state, today());
        state.savings.emergencyMonthly = a.savings.emergencyMonthly - a.rollover.emergency;
        state.savings.investMonthly = a.savings.investMonthly - a.rollover.grow;
        state.savings.debtExtra = a.savings.debtExtra - a.rollover.debt;
        state.savings.auto = false;
      }
      setPath(el.dataset.bind, val);
      save(); refreshAfterEdit(); return;
    }
    if (el.dataset.list) {
      const item = state[el.dataset.list].find((x) => x.id === el.dataset.id);
      if (!item) return;
      const f = el.dataset.field;
      if (f === 'name') item.name = el.dataset.list === 'budgets' ? fromLabel(el.value.trim(), BUILT_IN_CATEGORIES) : el.value.trim();
      else if (f === 'nextDue') item.nextDue = el.value || today();
      else {
        let v = Math.max(0, Number(el.value) || 0);
        if (f === 'dueDay') v = Math.min(31, Math.max(1, Math.round(v) || 1));
        if (el.dataset.list === 'debts' && f === 'balance' && item.balance > 0 && v === 0) {
          askRollover({ from: item.name || 'Your loan', amount: Number(item.minPayment) || 0, kind: 'loan' });
        }
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
      if (el.value === 'Savings' && Core.isFlexible(tx)) {
        tx.kind = 'move';
        tx.useFor = null;
        tx.needsReview = true;
        save(); toast('Marked as saved. Choose where it counts.'); rerenderKeepScroll(); return;
      }
      if (tx.needsReview) { tx.needsReview = false; rerenderKeepScroll(); }
      if (Core.isIncome(tx)) {
        tx.borrowed = el.value === LOAN_CATEGORY;
        if (tx.borrowed && !tx.useFor) tx.useFor = 'spend';
        save(); rerenderKeepScroll(); return;
      }
      const key = Core.normalizeMerchant(tx.note);
      if (key) state.merchantRules[key] = el.value;
      save(); toast(key ? tr('Saved. Future payments to {shop} will go to {category}.', { shop: tx.note, category: label(el.value) }) : tr('Saved')); return;
    }
    if (el.dataset.smsCheck !== undefined) { ui.smsRows[Number(el.dataset.smsCheck)].checked = el.checked; rerenderKeepScroll(); return; }
    if (el.dataset.smsCat !== undefined) { ui.smsRows[Number(el.dataset.smsCat)].parsed.category = el.value; return; }
    if (el.dataset.em === 'type') { ui.emergency.type = el.value; }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.reset && ui.reset) {
      ui.reset.edit[el.dataset.reset] = Math.max(0, Number(el.value) || 0);
      const card = document.getElementById('reset-card');
      const pos = el.selectionStart;
      if (card) {
        const fresh = document.createElement('div');
        fresh.innerHTML = resetModal();
        card.innerHTML = fresh.querySelector('#reset-card').innerHTML;
        const again = document.getElementById(el.id);
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* number inputs */ } }
      }
      return;
    }
    if (el.id === 'pay-amount') {
      const box = document.getElementById('pay-reason');
      const cyc = Core.cycleFor(today(), Number(state.settings.payday) || 1);
      if (box) box.innerHTML = paydayReason(el.value, (state.payslips || {})[cyc.start]);
      return;
    }
    if (el.id === 'sms-text') { ui.smsText = el.value; return; }
    if (el.dataset.borrow && ui.borrow) {
      ui.borrow.amount = Math.max(0, Math.round(Number(el.value) || 0));
      const card = document.getElementById('borrow-card');
      const pos = el.selectionStart;
      if (card) {
        card.innerHTML = borrowBody();
        const again = document.getElementById(el.id);
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* number inputs */ } }
      }
      return;
    }
    if (el.id === 'tx-amount') {
      const warn = document.getElementById('tx-big-warn');
      if (warn) {
        const msg = bigSpendWarning(Math.round(Number(el.value) || 0));
        warn.innerHTML = msg;
        warn.hidden = !msg;
      }
      return;
    }
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
    if (ev.target.id === 'save-tx') {
      ev.preventDefault();
      const amount = Math.round(Number(document.getElementById('sv-amount').value) || 0);
      if (amount <= 0) return;
      const sel = document.getElementById('sv-use');
      const use = sel.value;
      const debtId = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.debt;
      const date = document.getElementById('sv-date').value || today();
      // If the bank SMS for this transfer is already here, use it instead of adding a second entry.
      let tx = savedTwin(amount, date, true);
      if (tx) { tx.needsReview = false; tx.autoUse = false; }
      else {
        tx = { id: uid(), kind: 'move', date, amount, category: 'Savings', note: document.getElementById('sv-note').value.trim() || 'Savings', source: 'manual', useFor: null };
        state.transactions.push(tx);
      }
      setIncomeUse(tx, use, debtId);
      learnSaving(tx, use, debtId);
      save();
      celebrate(rewardMessage(use, amount, debtId, false));
      rerenderKeepScroll();
      return;
    }
    if (ev.target.id === 'balance-form') {
      ev.preventDefault();
      setBalance(document.getElementById('balance-amount').value);
      ui.balanceOpen = false;
      toast('Balance saved');
      rerenderKeepScroll();
      return;
    }
    if (ev.target.id === 'borrow-form') {
      ev.preventDefault();
      const amount = Math.round(Number(document.getElementById('borrow-amount').value) || 0);
      if (amount > 0) { ui.borrow = { amount, urgent: true, months: 12, focus: true }; rerenderKeepScroll(); }
      return;
    }
    if (ev.target.id !== 'add-tx') return;
    ev.preventDefault();
    const amount = Math.round(Number(document.getElementById('tx-amount').value) || 0);
    if (amount <= 0) return;
    const note = document.getElementById('tx-note').value.trim();
    const category = document.getElementById('tx-category').value;
    const tx = { id: uid(), date: document.getElementById('tx-date').value || today(), amount, category, note, source: 'manual' };
    if (ui.txKind === 'in') {
      tx.kind = 'in';
      tx.useFor = null;
      // Borrowed money is for what it was borrowed for: no "what should this do?".
      if (category === LOAN_CATEGORY) { tx.borrowed = true; tx.useFor = 'spend'; }
    }
    const from = document.getElementById('tx-from');
    if (ui.txKind !== 'in' && from && from.value !== 'account') tx.paidFrom = from.value;
    state.transactions.push(tx);
    save();
    toast(ui.txKind === 'in' ? (tx.borrowed ? tr('{amount} added as borrowed money', { amount: inr(amount) }) : tr('{amount} received. Choose what it should do.', { amount: inr(amount) }))
      : tx.paidFrom ? cardSpendWarning(tx) : tr('{amount} added to {category}', { amount: inr(amount), category: label(category) }));
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

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ui.help) { ui.helpFrom = ui.help; ui.help = null; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && ui.borrow) { ui.borrow = null; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && document.getElementById('report-card')) { ui.report = false; ui.reportHidden = true; ui.reportThenPay = false; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && ui.reset) { ui.reset = null; rerenderKeepScroll(); }
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
    // Only today's messages: never earlier days, even ones not reviewed yet,
    // so old spending is never added.
    const t = today();
    const since = Math.max(state.smsReadUntil || 0, Core.parseISO(t).getTime());
    SmsInbox.read({ since, limit: 500 }).then((res) => {
      const msgs = (res.messages || []).filter((m) => /[A-Za-z]/.test(m.address || ''));
      ui.smsMaxDate = (res.messages || []).reduce((mx, m) => Math.max(mx, m.date), since);
      // A message today about an older payment (its own date is earlier) is left out too.
      const rows = smsRows(msgs.map((m) => ({ text: m.body || '', day: Core.toISO(new Date(m.date)) })))
        .filter((r) => r.parsed && !r.duplicate && !r.parsed.salary && r.parsed.date >= t);
      state.smsAuto = true;
      ui.smsBusy = false;
      if (rows.length) {
        ui.smsRows = rows;
        if (quiet) toast(tr('{messages} to review in Spend', { messages: plural(rows.length, 'new bank message') }));
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
      allowance: Math.round(r.dailyAllowance),
      date: today(),
      categories: categories().filter((c) => c !== 'Emergency'),
      categoryLabels: categories().filter((c) => c !== 'Emergency').map(label),
      lang: I18N.getLang(),
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
        toast(tr('{expenses} added from the widget', { expenses: plural(entries.length, 'expense') }));
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
      categoryLabels: categories().filter((c) => c !== 'Emergency').map(label),
      incomeCategories: INCOME_CATEGORIES,
      incomeCategoryLabels: INCOME_CATEGORIES.map(label),
      lang: I18N.getLang(),
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
        if (added) toast(tr('{sms} recorded', { sms: plural(added, 'bank SMS', 'bank SMS') }));
        announceAutoSaved();
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

  // The language: chosen in the Plan tab, or the phone's language the first time.
  function loadLang() {
    try { return localStorage.getItem(LANG_KEY) || I18N.detect(navigator.language); } catch (e) { return I18N.detect(navigator.language); }
  }

  function setLang(l) {
    I18N.setLang(l);
    document.documentElement.lang = I18N.getLang();
    try { localStorage.setItem(LANG_KEY, I18N.getLang()); } catch (e) { /* private mode */ }
  }

  setLang(loadLang());
  state = load();
  assignWaitingSaved();
  if (NATIVE) collectNative();
  const fromHash = (location.hash || '').replace('#', '');
  tab = TABS.indexOf(fromHash) !== -1 ? fromHash : 'home';
  render();
  announceAutoSaved();
})();
