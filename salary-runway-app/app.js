/*
 * Hisab Se (formerly Salary Runway): user interface.
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
  // The Runway graph open or closed, remembered on this phone.
  const CHART_KEY = 'salary-runway-chart';
  // The spending view chosen on the Spend tab (Where, When or Trend).
  const VIZ_KEY = 'salary-runway-viz';
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
  const ShareFile = NATIVE ? window.Capacitor.registerPlugin('ShareFile') : null;
  // App lock (fingerprint, face or the phone's screen lock). A browser test can stand in a fake one.
  const AppLock = NATIVE ? window.Capacitor.registerPlugin('AppLock') : (window.HisabTestLock || null);
  // App lock settings, light or dark, and whether the tour was seen: kept outside the (maybe encrypted) data.
  const LOCK_KEY = 'salary-runway-lock';
  const THEME_KEY = 'salary-runway-theme';
  const TOUR_KEY = 'salary-runway-tour';
  // AI weekly plan: off unless the person turns it on. Its settings are kept apart from the money data.
  const AI_KEY = 'salary-runway-ai';
  const AI_LANG = { en: 'English', mr: 'Marathi', hi: 'Hindi' };
  // The build number, written by the Android build; absent in the browser preview.
  const BUILD = window.HISAB_BUILD || '';
  // What the app did lately (taps, messages, errors, each day's numbers), for a problem report. Never sent by itself.
  const LOG_KEY = 'salary-runway-log';
  const LOG_MAX = 500;

  // A light tap on the phone. Never allowed to break anything.
  function haptic() {
    try {
      if (Haptics) Promise.resolve().then(() => Haptics.impact({ style: 'LIGHT' })).catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(12);
    } catch (e) { /* no vibration available */ }
  }

  /*
   * Three short sounds, made on the spot (no sound files): a tick when an
   * expense is saved, a chime for a win, a low note when today goes over.
   * Quiet when sounds are off in Plan, or the phone is on silent or vibrate.
   */
  let audio = null;
  function sound(kind) {
    if (state.settings.sounds === false) return;
    const ring = SpendWidget ? Promise.resolve().then(() => SpendWidget.ringerMode()).then((r) => r.mode === 'normal', () => true) : Promise.resolve(true);
    ring.then((ok) => {
      if (!ok) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audio = audio || new Ctx();
        const notes = { tick: [[1200, 0, 0.06, 'sine']], chime: [[880, 0, 0.14, 'sine'], [1320, 0.12, 0.2, 'sine']], low: [[220, 0, 0.24, 'triangle']] }[kind] || [];
        notes.forEach(([freq, at, len, type]) => {
          const t0 = audio.currentTime + at;
          const osc = audio.createOscillator();
          const gain = audio.createGain();
          osc.type = type;
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
          osc.connect(gain).connect(audio.destination);
          osc.start(t0);
          osc.stop(t0 + len + 0.02);
        });
      } catch (e) { /* no sound available */ }
    });
  }

  // A short burst of colour for a real win. Gone in a second, never loops.
  function confetti() {
    if (REDUCE_MOTION) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    const colours = ['#79E3C3', '#F2553A', '#F5B83D', '#0C3B3D'];
    for (let i = 0; i < 16; i++) {
      const bit = document.createElement('i');
      bit.style.setProperty('--x', Math.round(Math.cos((i / 16) * 2 * Math.PI) * (90 + (i % 3) * 30)) + 'px');
      bit.style.setProperty('--y', Math.round(Math.sin((i / 16) * 2 * Math.PI) * (70 + (i % 4) * 20) - 40) + 'px');
      bit.style.background = colours[i % colours.length];
      box.appendChild(bit);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1100);
  }

  // Positive feedback for moving money to safety, with honest numbers.
  function celebrate(msg) {
    haptic();
    sound('chime');
    confetti();
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
    cardAnswer: null,
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
    limitPct: null,
    explain: null,
    counted: false,
    chartOpen: false,
    viz: 'where',
    importAsk: false,
    importMonths: 3,
    importBusy: false,
    importFound: null,
    sortAsk: null,
    leakTag: false,
    onboardHidden: false,
    onboardFocus: false,
    onboardError: '',
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

  // null when the data is encrypted: it opens after the app lock is unlocked.
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sealed) { sealedBlob = raw; return null; }
        if (parsed && parsed.settings) return migrate(Object.assign(emptyState(), parsed));
      }
    } catch (e) { /* storage unavailable: fall through to example data */ }
    return Demo.demoState(today());
  }

  // ---------- app lock: the data on this phone, encrypted ----------

  let saveCount = 0; // every save counts up, so an undo knows if anything changed since
  let dataKey = null; // AES key for the data, in memory only while unlocked
  let sealedBlob = null; // the encrypted data, before it's opened
  let locked = false; // the lock screen is showing
  let booted = false;
  let saving = Promise.resolve();

  function lockCfg() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; } catch (e) { return {}; }
  }

  function setLockCfg(c) {
    try { if (c) localStorage.setItem(LOCK_KEY, JSON.stringify(c)); else localStorage.removeItem(LOCK_KEY); } catch (e) { /* private mode */ }
  }

  function importKey(b64) {
    return crypto.subtle.importKey('raw', Core.fromB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  // The data, encrypted with AES-256-GCM and a fresh IV every time it's saved.
  function sealData(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
      .then((data) => JSON.stringify({ sealed: 1, v: 1, iv: Core.toB64(iv), data: Core.toB64(new Uint8Array(data)) }));
  }

  function openData(blob, key) {
    const o = JSON.parse(blob);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: Core.fromB64(o.iv) }, key, Core.fromB64(o.data))
      .then((plain) => JSON.parse(new TextDecoder().decode(plain)));
  }

  // Older saves had no automatic budgets: budgets left at ₹0 become automatic.
  function migrate(s) {
    s.budgets.forEach((b) => { if (b.auto === undefined) b.auto = !(Number(b.amount) > 0); });
    if (s.savings.auto === undefined) {
      s.savings.auto = !(s.savings.emergencyMonthly || s.savings.investMonthly || s.savings.debtExtra);
    }
    return s;
  }

  // quiet: the app's own bookkeeping (today's limit, loan EMIs), which shouldn't stop an undo.
  function save(quiet) {
    if (!state) return;
    if (!quiet) saveCount++;
    if (lockCfg().on) {
      // Locked: nothing to save. Unlocked: encrypt, one save after another so the newest wins.
      if (!dataKey) return;
      const text = JSON.stringify(state);
      const key = dataKey;
      saving = saving.then(() => sealData(text, key)).then((blob) => { localStorage.setItem(KEY, blob); }).catch(() => {});
      return;
    }
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

  // A day of the month as people say it: "the 3rd" in English, just the number elsewhere.
  function nth(n) {
    if (I18N.getLang() !== 'en') return String(n);
    const t = n % 100;
    return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
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
  const BUILT_IN_CATEGORIES = Core.DEFAULT_SPLIT.map(([name]) => name).concat(['Bills', 'Savings', 'Misc', 'Emergency', 'Cash']);

  function categories() {
    const names = state.budgets.map((b) => b.name).filter(Boolean);
    ['Bills', 'Savings', 'Misc', 'Emergency', 'Cash'].forEach((n) => { if (names.indexOf(n) === -1) names.push(n); });
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

  // ---------- problem log ----------

  /*
   * The last few hundred things the app did, kept on the phone apart from the
   * money data, so a problem report can show what happened before a bug. With
   * the app lock on, no text is kept: only taps, errors and their places.
   */
  let logList = null;
  function logRead() {
    if (logList) return logList;
    try { logList = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) { logList = []; }
    if (!Array.isArray(logList)) logList = [];
    return logList;
  }
  function logEvent(kind, info) {
    try {
      const list = logRead();
      list.push(Object.assign({ at: new Date().toISOString(), kind, tab: typeof tab === 'string' ? tab : null, page: ui && ui.page ? ui.page.key : null }, info));
      if (list.length > LOG_MAX) list.splice(0, list.length - LOG_MAX);
      clearTimeout(logEvent.timer);
      logEvent.timer = setTimeout(() => { try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); } catch (e) { /* full or private */ } }, 400);
    } catch (e) { /* the log never breaks the app */ }
  }
  function logText(text) { return lockCfg().on ? undefined : String(text || '').slice(0, 300); }
  let errorSeen = false;
  function logError(message, where, stack) {
    logEvent('error', { message: String(message || '').slice(0, 300), where: where || undefined, stack: stack ? String(stack).slice(0, 1500) : undefined });
    // Once a session: say where to report it.
    if (!errorSeen) {
      errorSeen = true;
      setTimeout(() => { try { toast(tr('Something went wrong. Profile → Report a problem sends the details.'), 'bad'); } catch (e) { /* ignore */ } }, 50);
    }
  }
  window.addEventListener('error', (e) => logError(e.message, (e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason || {};
    logError(r.message || String(r), 'promise', r.stack);
  });

  function toast(msg, kind) {
    logEvent('toast', { text: logText(tr(msg)), tone: kind || undefined });
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
    leaks: ['Little leaks', [
      'Small spends that repeat: a packet of cigarettes, a quarter, chai and snacks, food delivery, a fantasy team. Each one is small; together they can cost days of freedom every month.',
      '<b>Tag places</b>: pick a leak for a shop or app, and every payment there counts, now and later. Hisab Se suggests places that look like a leak, and only counts them if you say yes.',
      'A month’s worth is last round’s total, or this round’s pace if that’s higher. <b>Days of Freedom</b>: that amount ÷ what your basics cost a day.',
      'A challenge is your choice: cut 20% this round. No streaks to break, no lectures.',
    ]],
    viz: ['Your spending, 3 ways', [
      '<b>Where:</b> each category this month against its budget (coral past the budget line), and how much went on basics (groceries, health, bills) against everything else.',
      '<b>When:</b> every day this month, darker for more spending; the middle shade is your daily amount. A coral dot marks a day you used a credit card. Below it, your average for each weekday over the last three months.',
      '<b>Trend:</b> spent, saved and borrowed for each month. This month counts only the days so far.',
      'Tap a bar or a day to see its amount. <b>See the numbers</b> shows the same thing as a table.',
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
      '<b>Keep what’s left for next month:</b> for costs that come and go, like clothes or gifts. What a budget doesn’t use this month is added to it next month. An overspend doesn’t carry: it already came out of your money.',
      'Over in one budget? On Runway → Budgets, <b>Cover it from another budget</b> that has money left. The month’s total stays the same, so today’s limit doesn’t change.',
      'Under each budget, <b>Last round</b> and the <b>average</b> show what you really spent there. Tap one to use it.',
    ]],
    plan: ['Weekly plan', [
      'Every Monday (when you open the app), a plan made from your own numbers: where to save more this week, which loan to put extra on and what it saves, and payments to double-check for fraud. When your emergency fund and loans allow it, it also explains types of investment.',
      'Each plan sets one goal for the week. Next week the app checks it from your entries and tells you whether you made it.',
      'To make the plan, a summary of numbers the app has already worked out is sent once a week. It never includes SMS text, shop names, notes or account numbers. <b>See exactly what’s sent</b> in Profile → AI weekly plan shows it word for word.',
      'Fraud checks run on your phone, with the plan on or off: tiny test payments, the same amount twice on a day, a big first payment to a new place, and many new places in one day.',
      'The AI can be wrong, and the investment part is general information, not advice: talk to a SEBI-registered adviser before investing.',
    ]],
    goals: ['Savings goals', [
      'Something to save for by a date: a bike’s down payment, a trip, a rent deposit. The app works out what to put aside each payday to get there in time.',
      'That amount comes out of your salary before the flexible budgets, like yearly costs, and is added to the goal on payday. Change <b>Saved so far</b> or the date any time and the monthly amount is worked out again.',
      'If the date passes before it’s reached, nothing more is put aside until you pick a new date.',
    ]],
    worth: ['Net worth', [
      'What you own minus what you owe: the money in your account and wallets, the emergency fund and Grow savings, less your loans and card dues from before you added the card.',
      'It’s kept once per round, so you see the trend. Borrowing pulls it down even when the account looks fuller. Paying a loan off moves it up, even though your balance drops.',
    ]],
    data: ['Your data', [
      'Everything is saved on this phone only. Nothing is uploaded, unless you turn on the AI weekly plan.',
      '<b>Make a backup file</b> to move to a new phone, or in case this one is lost: the file is locked with your password. Save it to Google Drive, or email or WhatsApp it to yourself. On the new phone: <b>Restore from a backup</b>, pick the file and type the password.',
      'Forgot the password? Then the backup can’t be opened, by anyone. Make a new one with a password you’ll remember.',
      '<b>Erase everything</b> removes all of it from this phone, including the widget and SMS alerts.',
    ]],
    privacy: ['Your privacy', [
      'Hisab Se connects to the internet only for the AI weekly plan, which is off unless you turn it on. There is no account and no tracking.',
      'Check it yourself: turn on airplane mode and use the app. Everything except making a new weekly plan works.',
    ]],
    smsclean: ['Clean up SMS imports', [
      'Removes payments and money received that were added from SMS before the date you pick. Anything you added by hand stays.',
    ]],
    cards: ['Credit cards', [
      'Card spending is counted as spent the day it happens, so the money is kept aside for the bill. Paying the bill only moves it to the card.',
      'Each card shows the bill, the due date and how much of the limit you’re using.',
      '<b>Pay in full</b> whenever you can: no interest. The minimum keeps most of the interest running. EMI is suggested only when you can’t pay in full and it’s clearly cheaper.',
    ]],
    wallets: ['Wallets', [
      'Where your money sits: your main bank account, other banks, cash and UPI wallets like Paytm. Today’s limit still uses all of it together.',
      '<b>Moving money</b> between wallets (an ATM withdrawal, topping up Paytm) is never spending. With a <b>Cash</b> wallet, an ATM withdrawal moves money into it, and what you note as spent in cash comes out of it.',
      'Add the last 4 digits of a bank account and its SMS go to that wallet by themselves. <b>Update balances</b> with what your bank apps and purse show at the start of the day: together they are where the runway starts.',
    ]],
    journey: ['Your way out of debt', [
      'Three stages. <b>Survive:</b> pay the basics and every minimum without borrowing more. <b>Stabilize:</b> build a cushion of 7 Days of Freedom. <b>Escape:</b> clear the loans, one at a time.',
      'There’s always a next move, in your own numbers. When the salary is short, it’s closing the gap in small steps, never skipping rent, food, medicine, school fees or a minimum payment.',
    ]],
    bosses: ['Loans to beat', [
      'Each loan has a bar: what’s left of its highest balance. It drops after every EMI and every extra payment.',
      '<b>Highest interest first</b> pays the least interest. <b>Smallest first</b> clears a loan sooner, and that early win keeps many people going. Both are good; the best one is the one you stick to.',
      'EMIs are taken off after each due date, worked out from the rate. Correct the balance from your loan app now and then.',
    ]],
    calls: ['Calls to your lenders', [
      'One call at a time, with a script, a 5-minute prep list and what the call can change, in rupees.',
      'First an easy call: moving a due date or asking for a late fee back. After 60 days of logged spending, Hisab Se writes a request for a lower rate, backed by your real numbers.',
      'Making the call is the win, whatever the answer. The next day the app asks how it went and updates your loan if something changed.',
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
      'Hisab Se doesn’t recommend any adviser, product, bank or fund, and earns nothing from them.',
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

  // The Hisab Se logo: two pillars, the line from red (debt) up to green (freedom).
  const LOGO = '<svg class="brand-mark" viewBox="600 390 730 860" aria-hidden="true">' +
    '<rect x="628" y="410" width="227" height="815" rx="113.5" style="fill:var(--ink)"/><rect x="1078" y="410" width="227" height="815" rx="113.5" style="fill:var(--ink)"/>' +
    '<path d="M740 1037 L955 762 L978 893 L1193 602" stroke-width="110" fill="none" stroke-linejoin="round" stroke-linecap="round" style="stroke:var(--bg)"/>' +
    '<path d="M740 1037 L955 762 L978 893 L1193 602" stroke-width="46" fill="none" stroke-linejoin="round" stroke-linecap="round" style="stroke:var(--ink)"/>' +
    '<circle cx="740" cy="1037" r="66" fill="#F2553A"/><circle cx="1193" cy="602" r="66" fill="#79E3C3"/></svg>';

  function render() {
    if (locked) { renderLock(); return; }
    tickJourney();
    const app = document.getElementById('app');
    const banner = state.isDemo
      ? '<div class="banner"><span>' + tr('You are looking at <b>example numbers</b>. Explore freely, then add your own.') + '</span>' +
        '<button class="primary" data-action="start-own">' + tr('Start with my numbers') + '</button></div>'
      : '';
    const views = { home: viewHome, spend: viewSpend, plan: viewPlan, debts: viewDebts, grow: viewGrow, profile: viewProfile };
    // The field being typed in, so a redraw can give it back its focus.
    const active = document.activeElement;
    const keep = active && active.id && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) ? active.id : null;
    app.innerHTML =
      '<div class="shell">' +
      '<header class="topbar"><div class="brand">' +
      LOGO + 'Hisab Se</div><span class="privacy-chip">' + tr(aiCfg().on ? 'Data on this device · AI on' : 'Data stays on this device') + '</span>' +
      '<button class="profile-btn" data-action="profile-open" aria-label="' + tr('Profile') + '"' + (tab === 'profile' ? ' aria-current="page"' : '') + '>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6"/></svg></button></header>' +
      banner +
      '<main id="view" class="stack" style="gap:16px">' + views[tab]() + '</main>' +
      '</div>' +
      '<nav class="tabbar" aria-label="' + tr('Sections') + '"><div class="tabbar-inner">' +
      TABS.map((t) =>
        '<button data-action="tab" data-tab="' + t + '"' + (t === tab ? ' aria-current="page"' : '') + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[t] + '</svg>' + tr(TAB_LABELS[t]) + '</button>'
      ).join('') +
      '</div></nav>' +
      (tab !== 'spend' && state.settings.salary ? '<button class="fab" data-action="fab-add" aria-label="' + tr('Add an expense') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>' : '') +
      resetModal() + helpModal() + explainModal() + borrowModal() + reportModal() + onboardModal() + tourModal() + editModal();
    if (tab === 'home') { drawRunway(); animateRunway(); }
    if (document.getElementById('onboard-card') && ui.onboardFocus) {
      ui.onboardFocus = false;
      const first = document.querySelector('#onboard-card input');
      if (first) first.focus(); else document.getElementById('onboard-card').focus();
    } else if (ui.cardForm && ui.cardForm.focus && ui.cardForm.bad && document.getElementById(ui.cardForm.bad)) {
      ui.cardForm.focus = false;
      const bad = document.getElementById(ui.cardForm.bad);
      bad.scrollIntoView({ block: 'center' });
      bad.focus({ preventScroll: true });
    } else if (keep && document.getElementById(keep)) {
      try { document.getElementById(keep).focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
    }
    if (ui.reset) {
      const first = document.querySelector('#reset-card input, #reset-card button.primary');
      if (first) first.focus();
    }
    if (document.getElementById('edit-card') && ui.editFocus) {
      ui.editFocus = false;
      const first = document.querySelector('#edit-card input');
      if (first) first.focus(); else document.getElementById('edit-card').focus();
    }
    if (document.getElementById('report-card') && !ui.reportFocused) {
      ui.reportFocused = true;
      document.getElementById('report-card').focus();
      // A round won: the chime and confetti, once.
      if (Core.roundResult(state, today()).won) { sound('chime'); confetti(); }
    }
    if (ui.borrow && ui.borrow.focus) {
      ui.borrow.focus = false;
      document.getElementById('borrow-card').focus();
    }
    if (ui.explain) {
      document.querySelector('#explain-card button.primary').focus();
    } else if (ui.help) {
      document.querySelector('#help-card button.primary').focus();
    } else if (ui.helpFrom) {
      const back = document.querySelector('[data-help="' + ui.helpFrom + '"]');
      if (back) back.focus({ preventScroll: true });
      ui.helpFrom = null;
    }
    syncWidget();
    syncAlerts();
  }

  // ---------- icon grid: each tab's cards as grouped icons ----------

  // Line icons for the grid, drawn on a 24×24 grid in the tab bar's style.
  const HUB_ICONS = {
    grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm.1 4.3l1.6 1.6 3-3-.9-.9-2.1 2.1-.7-.7z"/>',
    bill: '<path d="M5 2h14v20l-2.3-1.5L14.3 22 12 20.5 9.7 22l-2.4-1.5L5 22zm3 5v1.6h8V7zm0 4v1.6h8V11zm0 4v1.6h5V15z"/>',
    upcoming: '<path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v10h14V9zm2 2h3v3H7zm5 0h3v3h-3z"/>',
    payday: '<path d="M2 6h20v12H2zm10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4.5 8.5v2a2 2 0 0 0 2-2zm15 7v-2a2 2 0 0 0-2 2z"/>',
    big: '<path d="M12 2.5l10 18H2zm-1 6.5v5h2V9zm0 7v2h2v-2z"/>',
    graph: '<path d="M3 3h2v16h16v2H3z"/><path d="M6.2 14.6l4-5 3 3 5-7 1.6 1.2-6.4 9-3-3-2.6 3.3z"/>',
    budgets: '<rect x="3.5" y="11" width="4.5" height="10" rx="1.5"/><rect x="9.75" y="3" width="4.5" height="18" rx="1.5"/><rect x="16" y="7.5" width="4.5" height="13.5" rx="1.5"/>',
    insight: '<path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2zM8.5 18.5h7V20a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z"/>',
    scale: '<path d="M11 2h2v2.2l6.2 1.5L22 12.5a3.5 3.5 0 0 1-7 0l2.4-5.9L13 5.6V20h5v2H6v-2h5V5.6L6.6 6.6 9 12.5a3.5 3.5 0 0 1-7 0l2.8-6.8zM5.5 8.6L3.9 12.5h3.2zm13 0l-1.6 3.9h3.2z"/>',
    wallet: '<path d="M4 4h13v2.5H5.5a1 1 0 0 0 0 2H20a1 1 0 0 1 1 1V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1zm12.5 10a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z"/>',
    flag: '<path d="M5 2h2v20H5z"/><path d="M8.5 3H20l-2.6 4.5L20 12H8.5z"/>',
    card: '<path d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2H2zm0 4h20v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm3 5v1.6h5V15z"/>',
    where: '<path d="M11 2.05V12l7.1 7.1A10 10 0 1 1 11 2.05z"/><path d="M13 2.05A10 10 0 0 1 21.95 11H13z"/>',
    when: '<path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v10h14V9zm2 2h2.5v2.5H7zm4 0h2.5v2.5H11zm4 0h2.5v2.5H15zm-8 4h2.5v2.5H7zm4 0h2.5v2.5H11z"/>',
    trend: '<path d="M2.6 17.2l6.4-6.4 4 4 5.2-5.2H15V7.4h7v7h-2.2v-3.3L13 17.9l-4-4-4.8 4.8z"/>',
    drop: '<path d="M12 2c3.6 4.7 6.5 8.2 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10.2 8.4 6.7 12 2z"/>',
    list: '<path d="M3 4.5h3.5V8H3zm5.5.75H21v2H8.5zM3 10.25h3.5v3.5H3zm5.5.75H21v2H8.5zM3 16h3.5v3.5H3zm5.5.75H21v2H8.5z"/>',
    sms: '<path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 4.5V5a2 2 0 0 1 1-2zm3 5v1.8h10V8zm0 3.6v1.8h6v-1.8z"/>',
    rupee: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM8 6.5V8h2.6c.9 0 1.6.4 1.9 1H8v1.5h4.5c-.3.8-1.1 1.3-2.2 1.3H8v1.4l4.2 4.8h2.1l-4-4.5c1.7-.2 2.9-1.4 3.2-3H16V9h-2.5a3 3 0 0 0-.6-1H16V6.5z"/>',
    repeat: '<path d="M17 1.5l4.5 4.5L17 10.5V7.5H8.5a3 3 0 0 0-3 3V12h-2.5v-1.5a5.5 5.5 0 0 1 5.5-5.5H17zM7 22.5L2.5 18 7 13.5v3h8.5a3 3 0 0 0 3-3V12H21v1.5a5.5 5.5 0 0 1-5.5 5.5H7z"/>',
    bolt: '<path d="M13.5 2L4 13.5h6.5L9 22l11-12.5h-6.7z"/>',
    yearly: '<path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v10h14V9zm6 1.5h2v2.5h2.5v2H13v2.5h-2V15H8.5v-2H11z"/>',
    shield: '<path d="M12 2l8.5 3.2V11c0 5.3-3.5 9.7-8.5 11.2C7 20.7 3.5 16.3 3.5 11V5.2zm-1.1 13.3l5.8-5.8-1.4-1.4-4.4 4.4-2.1-2.1-1.4 1.4z"/>',
    sliders: '<path d="M3 5.5h4a2.5 2.5 0 0 1 4.9 0H21v2h-9.1a2.5 2.5 0 0 1-4.9 0H3zm0 6.5h10a2.5 2.5 0 0 1 4.9 0H21v2h-3.1a2.5 2.5 0 0 1-4.9 0H3zm0 6.5h2.5a2.5 2.5 0 0 1 4.9 0H21v2H10.4a2.5 2.5 0 0 1-4.9 0H3z"/>',
    chat: '<path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 5v2h2V9zm4 0v2h2V9zm4 0v2h2V9z"/>',
    sparkle: '<path d="M11 2l2.1 6.1L19 10l-5.9 1.9L11 18l-2.1-6.1L3 10l5.9-1.9z"/><path d="M18.5 14l1.1 2.6 2.4 1.1-2.4 1.1-1.1 2.7-1.1-2.7-2.4-1.1 2.4-1.1z"/>',
    target: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"/>',
    loan: '<path d="M12 2l10 5v2.5H2V7zM4 11h3v7H4zm6.5 0h3v7h-3zM17 11h3v7h-3zM2 19.5h20V22H2z"/>',
    plans: '<path d="M2.5 20h19v2h-19z"/><rect x="4" y="12" width="4" height="7" rx="1.2"/><rect x="10" y="8" width="4" height="11" rx="1.2"/><rect x="16" y="3.5" width="4" height="15.5" rx="1.2"/>',
    phone: '<path d="M6.5 2.5l3.2.6 1.6 4.6-2.4 1.7a12.5 12.5 0 0 0 5.7 5.7l1.7-2.4 4.6 1.6.6 3.2a2 2 0 0 1-2 2.3A17.5 17.5 0 0 1 2.2 4.5a2 2 0 0 1 2.3-2z"/>',
    pot: '<path d="M9 2.5h6v2h-1v2.3c3.4.8 6 3.9 6 7.7a8 8 0 0 1-16 0c0-3.8 2.6-6.9 6-7.7V4.5H9zM11 11v1.6H9.5v1.6H11V16h2v-1.8h1.5v-1.6H13V11z"/>',
    sprout: '<path d="M11 21.5v-7.8C5.8 13.4 2.5 10.2 2.5 4.5c5.3 0 8.4 2.8 9.1 7C12.5 7 15.6 3.5 21.5 3.5c0 6.3-3.6 9.7-8.5 10.1v7.9z"/>',
    book: '<path d="M5 2h14v15.5H7.2a1.2 1.2 0 0 0 0 2.5H19V22H7.2A3.2 3.2 0 0 1 4 18.8V3a1 1 0 0 1 1-1zm3 4v1.8h8V6z"/>',
    theme: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
    lang: '<path d="M2.5 4h8.5v2H8.6c-.3 2-1 3.8-2 5.3.8.8 1.8 1.4 2.9 1.9l-.8 1.8c-1.3-.6-2.4-1.3-3.3-2.2-1 1-2.1 1.8-3.4 2.4l-.8-1.8c1.1-.5 2-1.2 2.8-2-.8-1.2-1.4-2.6-1.8-4.1l1.9-.5c.3 1.1.7 2.1 1.2 3 .7-1.2 1.2-2.4 1.4-3.8H2.5zm12 4h2.6l4.9 12.5h-2.3l-1.1-3h-5.6l-1.1 3h-2.3zm1.3 2.6l-2 5h4z"/>',
    lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm2 0h6V7a3 3 0 0 0-6 0zm2 4v3.5h2V14z"/>',
    data: '<path d="M12 2c4.4 0 8 1.6 8 3.5S16.4 9 12 9 4 7.4 4 5.5 7.6 2 12 2zM4 8.4c1.6 1.4 4.6 2.1 8 2.1s6.4-.7 8-2.1V12c0 1.9-3.6 3.5-8 3.5S4 13.9 4 12zm0 6.6c1.6 1.4 4.6 2.1 8 2.1s6.4-.7 8-2.1v3.5c0 1.9-3.6 3.5-8 3.5s-8-1.6-8-3.5z"/>',
    broom: '<path d="M14.6 2l1.8.9-3.6 7.1H17l2 12H5l2-12h3.4z"/>',
    flag: '<path d="M5 2h2v20H5zM8.5 3H20l-3 4.5 3 4.5H8.5z"/>',
    info: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.1 8v7.5h2.2V10zm0-3.6V8.6h2.2V6.4z"/>',
    add: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.1 5v3.9H7v2.2h3.9V17h2.2v-3.9H17v-2.2h-3.9V7z"/>',
  };
  const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /*
   * A tab: what always matters stays open on top (the limit, zones, warnings),
   * then the other cards as small icons in groups. Each icon can carry a live
   * badge ("2 due") so nothing important hides; a tap opens the card as its own
   * page, and Back (or the phone's back button) returns to the icons.
   * sections: [{ key, group, icon, label, badge: { text, tone } | null, html: () => string, hide, tone, tab, viz }]
   */
  function hub(tabKey, top, sections) {
    const list = sections.filter((x) => !x.hide);
    const open = ui.page && ui.page.tab === tabKey ? list.find((x) => x.key === ui.page.key) : null;
    if (open) {
      return '<div class="page-head"><button class="page-back" data-action="page-back">' + BACK_ICON + '<span>' + tr('Back') + '</span></button>' +
        '<span class="page-group">' + tr(open.group) + '</span></div>' +
        '<div class="page-body stack" style="gap:16px">' + open.html() + '</div>';
    }
    const groups = [];
    list.forEach((x) => {
      let g = groups.find((y) => y.name === x.group);
      if (!g) groups.push((g = { name: x.group, items: [] }));
      g.items.push(x);
    });
    // Profile: a settings list, like most apps.
    if (tabKey === 'profile') {
      return top + groups.map((g) => '<section class="card settings-group"><h2>' + tr(g.name) + '</h2><div class="settings-list">' +
        g.items.map(settingsRow).join('') + '</div></section>').join('');
    }
    return top + groups.map((g) => '<section class="card hub-group"><h2>' + tr(g.name) + '</h2><div class="hub-grid">' +
      g.items.map(hubTile).join('') + '</div></section>').join('');
  }

  function settingsRow(x) {
    return '<button class="settings-row" data-action="' + (x.action || 'page-open') + '" data-tab="profile" data-key="' + x.key + '">' +
      '<span class="settings-icon' + (x.tone === 'bad' ? ' alert' : '') + '"><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + (HUB_ICONS[x.icon] || '') + '</svg></span>' +
      '<span class="settings-label">' + tr(x.label) + '</span>' +
      (x.value ? '<span class="settings-value' + (x.tone ? ' ' + x.tone : '') + '">' + x.value + '</span>' : '') +
      '<svg class="settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
  }

  function hubTile(x) {
    const b = x.badge;
    // Calm by default; coral only when the badge is a warning, so colour always means something.
    return '<button class="hub-tile' + (b && b.tone === 'bad' ? ' alert' : '') + '" data-action="page-open" data-key="' + x.key + '"' +
      (x.tab ? ' data-tab="' + x.tab + '"' : '') + (x.viz ? ' data-viz="' + x.viz + '"' : '') + '>' +
      '<span class="hub-icon"><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + (HUB_ICONS[x.icon] || '') + '</svg>' +
      (b && b.text ? '<span class="hub-badge' + (b.tone ? ' ' + b.tone : '') + '">' + b.text + '</span>' : '') + '</span>' +
      '<span class="hub-label">' + tr(x.label) + '</span></button>';
  }

  // Opens a card as its own page; the phone's back button comes back to the icons.
  function openPage(tabKey, key) {
    ui.page = { tab: tabKey, key };
    tab = tabKey;
    try { history.pushState({ page: key }, '', '#' + tabKey); } catch (e) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }

  function closePage() {
    if (!ui.page) return;
    ui.page = null;
    render();
    window.scrollTo(0, 0);
  }

  window.addEventListener('popstate', () => {
    if (ui.page) closePage();
    else if (tab === 'profile') closeProfile();
  });

  // ---------- profile ----------

  function openProfile() {
    if (tab !== 'profile') ui.prevTab = tab;
    tab = 'profile';
    ui.page = null;
    try { history.pushState({ profile: 1 }, '', '#profile'); } catch (e) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }

  function closeProfile() {
    tab = ui.prevTab || 'home';
    ui.prevTab = null;
    ui.page = null;
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }

  function setTab(t) {
    tab = TABS.indexOf(t) === -1 ? 'home' : t;
    ui.page = null;
    ui.prevTab = null;
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
    const daysToPay = Core.daysBetween(t, cyc.next);
    const z = Core.zoneStatus(state, t, r);
    recordToday(r);
    logWorth();
    if (planDue()) setTimeout(requestPlan, 0);
    const streak = withinStreak();
    let headline, sub;
    if (z.zone === 'red') {
      headline = tr('Red zone: <span class="date bad">{amount} short</span> for bills and basics', { amount: inr(z.shortBy) });
      sub = tr('The money left doesn’t cover the bills still to pay and groceries and health until {date}. Here’s how to stay above ₹0:', { date: fmtDate(cyc.next) });
    } else if (z.zone === 'amber') {
      headline = tr('Careful: at this pace, money runs out on <span class="date warn">{date}</span>', { date: fmtDate(r.zeroPace || Core.addDays(cyc.next, -1)) });
      // The same number the card shows: today's limit, or tomorrow's once today is over it.
      const keep = r.overToday > 0 && r.savedToday < r.overToday ? r.tomorrowAllowance : r.dailyAllowance;
      sub = tr('You’re spending about {pace} a day. Keep to <b>{safe} a day</b> until payday and you’ll stay out of the red.', { pace: inr(r.paceRate), safe: inr(keep) });
    } else {
      headline = tr('You’re in the green');
      sub = tr('At this pace you reach payday on {date} with about <b>{amount}</b> left.', { date: fmtDate(cyc.next), amount: inr(r.endPace) });
    }
    // The cause, when it's the plan itself: nothing is left for daily spending after fixed payments and EMIs.
    if (z.zone !== 'green' && r.plan.flexTotal <= 0 && r.plan.salary > 0) sub = tr('Your plan leaves ₹0 for daily spending: fixed payments, EMIs and minimums take the whole salary. The Debts tab shows what clearing the costliest loan frees up.') + ' ' + sub;

    // Joined mid-cycle: budgets cover only the days from the balance check.
    const share = r.anchor ? (cyc.days - r.anchorIdx) / cyc.days : 1;
    const fromDate = r.anchor ? r.anchor.date : cyc.start;
    const env = Core.budgetEnvelopes(state, t);
    const flexSpent = Object.values(Core.byCategory(Core.spendInRange(state.transactions, cyc).filter((x) => x.date >= fromDate && x.date <= t))).reduce((a, b) => a + b, 0);

    const upcoming = r.events.filter((e) => e.date > t);
    const askBalance = !state.isDemo && !r.anchor && state.balancePromptSkipped !== cyc.start;
    const ins = Core.insights(state, t);
    const adj = r.plan.adjustment;

    const bal = askBalance && !ui.balanceOpen ? balanceForm(true) : '';
    const top =
      paydayCard() +
      staleRolloverNote() +
      rolloverCard() +
      followBanner() +
      loanDebtNote() +
      '<section class="hero">' +
      '<p class="greeting">' + greeting() + '</p>' +
      '<p class="coach-line">' + coachLine(z, r, streak, daysToPay) + '</p>' +
      limitCard(r, z, headline, sub) +
      (z.zone === 'red' ? redOptions(z, r) : '') +
      freedomCard() +
      '</section>' +
      cardHomeNotes(cyc) +
      savedCard() +
      incomeCard() +
      weekCard() +
      bal +
      (needsCheck().length
        ? '<div class="callout warn"><b>' + tr(needsCheck().length === 1 ? '1 payment from SMS needs a quick check' : '{n} payments from SMS need a quick check', { n: needsCheck().length }) + '</b>' +
          '<span class="hint">' + tr(needsCheck().length === 1 ? 'Make sure it’s in the right category.' : 'Make sure they’re in the right category.') + '</span>' +
          '<div><button class="primary" data-action="tab" data-tab="spend">' + tr('Check now') + '</button></div></div>'
        : '') +
      ((state.sortQueue || []).length
        ? '<div class="callout"><b>' + tr((state.sortQueue || []).length === 1 ? '1 imported payment waits to be sorted' : '{n} imported payments wait to be sorted', { n: (state.sortQueue || []).length }) + '</b>' +
          '<span class="hint">' + tr('They count once they have a category.') + '</span><div><button class="primary" data-action="tab" data-tab="spend">' + tr('Continue sorting') + '</button></div></div>'
        : '') +
      (adj ? '<div class="callout warn"><b>' + tr('Recovery plan active until {date}.', { date: fmtDate(adj.until, true) }) + '</b><span class="hint">' +
        [adj.flexCutPct ? tr('Flexible budgets are {pct}% lower.', { pct: adj.flexCutPct }) : '', adj.pauseInvest ? tr('The Grow budget is paused.') : '', adj.pauseDebtExtra ? tr('Extra debt payments are paused.') : '']
          .filter(Boolean).join(' ') + '</span></div>' : '') +
      backupNudge() +
      weekChart(r) +
      recentCard();

    // Live badges: what each icon would show if opened.
    const billsDue = (state.bills || []).filter((b) => (Number(b.estimate) || 0) > 0 && Core.billDue(b, cyc) && !Core.billPaidIn(state, b, cyc)).length;
    const upcomingTotal = upcoming.reduce((s, e) => s + e.amount, 0);
    const overBudgets = env.over.length;
    const warnInsights = ins.filter((i) => i.level === 'warn').length;
    const dfd = Core.debtFreeDates(state, t);
    const cardsDue = (state.cards || []).filter((c) => { const st = Core.cardStatus(state, c, t); return st.remaining > 0 && st.daysToDue <= 7; }).length;
    return hub('home', top, [
      { key: 'plan', group: 'This month', icon: 'sparkle', label: 'Weekly plan', tone: 'mint',
        badge: (() => { const n = Core.fraudSignals(state, t, 14).reduce((a, x) => a + x.ids.length, 0); return n ? { text: '!' + n, tone: 'bad' } : !aiCfg().on ? { text: tr('Off') } : state.weeklyPlan && !state.weeklyPlan.seen ? { text: tr('New'), tone: 'good' } : null; })(),
        html: () => planCard() },
      { key: 'round', group: 'This month', icon: 'grid', label: 'This round', tone: 'mint', badge: roundTiles(cyc).won ? { text: '✓ ' + roundTiles(cyc).won, tone: 'good' } : null, html: () => roundBoard(cyc, r) },
      { key: 'bills', group: 'This month', icon: 'bill', label: 'Bills to pay', tone: 'mint', badge: billsDue ? { text: tr('{n} due', { n: billsDue }), tone: 'bad' } : { text: '✓', tone: 'good' }, html: () => billsCard() || '<section class="card"><h2>' + tr('Bills to pay') + '</h2><p class="hint">' + tr('No bills due before payday.') + '</p></section>' },
      { key: 'coming', group: 'This month', icon: 'upcoming', label: 'Coming up', tone: 'mint', badge: upcomingTotal ? { text: shortInr(upcomingTotal) } : null,
        html: () => '<section class="card"><div class="card-head"><h2>' + tr('Coming up before payday') + '</h2><span class="hint">' + inr(upcomingTotal) + '</span></div>' +
          (upcoming.length
            ? '<div class="list">' + upcoming.map((e) =>
              '<div class="list-item"><div class="date-badge"><b>' + Core.parseISO(e.date).getDate() + '</b>' + monthName(Core.parseISO(e.date).getMonth()) + '</div>' +
              '<div class="grow"><div class="title">' + esc(e.name) + '</div><div class="meta">' + tr(e.kind === 'debt' ? 'Minimum payment' : e.kind === 'bill' ? 'Estimate · amount varies' : 'Fixed payment') + '</div></div>' +
              '<div class="amt">' + inr(e.amount) + '</div></div>').join('') + '</div>'
            : '<p class="hint">' + tr('No more fixed payments this cycle.') + '</p>') + '</section>' },
      { key: 'payday', group: 'This month', icon: 'payday', label: 'Next payday', tone: 'mint', badge: { text: fmtDate(cyc.next) }, html: () => paydayPreviewCard() },
      { key: 'big', group: 'Check & plan', icon: 'big', label: 'Big expense?', tone: 'amber', badge: null, html: () => bigExpenseCard() },
      { key: 'graph', group: 'Check & plan', icon: 'graph', label: 'Runway graph', tone: 'amber', badge: null, html: () => chartCard() },
      { key: 'budgets', group: 'Check & plan', icon: 'budgets', label: 'Budgets', tone: 'amber', badge: overBudgets ? { text: tr('{n} over', { n: overBudgets }), tone: 'bad' } : null,
        html: () => '<section class="card"><div class="card-head"><h2>' + tr(r.anchor && r.anchorIdx > 0 ? 'You can spend until payday' : 'You can spend this cycle') + '</h2><button class="ghost" data-action="tab" data-tab="plan">' + tr('Adjust') + '</button></div>' +
          envelopeBars(env) + '</section>' },
      { key: 'insights', group: 'Check & plan', icon: 'insight', label: 'Insights', tone: 'amber', badge: warnInsights ? { text: String(warnInsights), tone: 'bad' } : null,
        html: () => '<section class="card"><h2>' + tr('What your spending says') + '</h2><div>' +
          ins.map((i) => '<div class="insight lvl-' + i.level + '"><div><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p></div></div>').join('') + '</div></section>' },
      { key: 'balance', group: 'Money', icon: 'wallet', label: 'Balance', tone: 'teal', badge: { text: shortInr(r.balanceToday) },
        html: () => reconcileCard() + (ui.balanceOpen ? balanceForm(false) : '') + '<section class="tiles">' +
          tile('Balance now', inr(r.balanceToday),
            (r.anchor ? tr('From your balance on {date}', { date: fmtDate(r.anchor.date) }) : tr('Worked out from your plan')) +
            ' · <button class="link" data-action="balance-open">' + tr('Update') + '</button>') +
          tile('Flexible spending', inr(flexSpent), tr('of {amount} budget', { amount: inr(Math.round((r.plan.flexTotal * share) / 10) * 10) }) +
            (r.extraIn ? ' ' + tr('+ {amount} received', { amount: inr(r.extraIn) }) : '') + (r.anchor ? ' ' + tr('since {date}', { date: fmtDate(r.anchor.date) }) : '')) +
          '</section>' + ((state.wallets || []).length ? walletsCard() : '<p class="hint">' + tr('Keep cash, a second bank or Paytm apart? Add wallets in Plan → Wallets.') + '</p>') },
      { key: 'worth', group: 'Money', icon: 'scale', label: 'Net worth', tone: 'teal', badge: (() => { const n = Core.netWorth(state, t).value; return { text: (n < 0 ? '−' : '') + shortInr(Math.abs(n)), tone: n < 0 ? 'bad' : '' }; })(), html: () => netWorthCard() },
      { key: 'debtfree', group: 'Money', icon: 'flag', label: 'Debt-free date', tone: 'teal', hide: !dfd, badge: dfd ? { text: dfd.plan.never ? '!' : monthYear(dfd.plan.date), tone: dfd.plan.never ? 'bad' : '' } : null, html: () => debtFreeCard() },
      { key: 'cards', group: 'Money', icon: 'card', label: 'Credit cards', tone: 'teal', tab: 'debts', hide: !(state.cards || []).length, badge: cardsDue ? { text: tr('{n} due', { n: cardsDue }), tone: 'bad' } : (state.cards || []).length ? { text: String(state.cards.length) } : null, html: () => '' },
    ]);
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
    // Only bills with an amount: a bill just added in Plan starts at ₹0 and isn't asking to be paid.
    const due = bills.filter((b) => (Number(b.estimate) || 0) > 0 && Core.billDue(b, cyc) && !Core.billPaidIn(state, b, cyc));
    // Bills payments to link: to a bill that varies, or, for a card bill noted as spending, to the card.
    const named = bills.filter((b) => (b.name || '').trim());
    const cards = state.cards || [];
    const unlinked = state.transactions.filter((x) => Core.isFlexible(x) && x.category === 'Bills' && Core.inCycle(x.date, cyc) &&
      (named.length || (cards.length && Core.looksLikeCardBill(x.note))));
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
    const links = unlinked.map((x) => {
      const card = cards.length && Core.looksLikeCardBill(x.note);
      const opts = cards.map((c) => '<option value="card:' + esc(c.id) + '">' + esc(tr('{name} credit card bill', { name: c.name })) + '</option>').join('');
      return '<div class="bill-item"><div class="check-top"><div class="grow"><div class="title">' + esc(x.note || tr('Bill payment')) + '</div>' +
        '<div class="meta">' + fmtDate(x.date) + ' · ' + inr(x.amount) + ' · ' + tr('which bill is this?') + '</div>' +
        (card ? '<p class="hint">' + tr('Paying a card bill isn’t spending: what you bought on the card already counted. Link it to the card so it counts once.') + '</p>' : '') +
        '</div></div>' +
        '<div class="row"><select id="bill-link-' + esc(x.id) + '" aria-label="' + tr('Bill') + '">' + (card ? opts : '') +
        named.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + (card ? '' : opts) + '</select>' +
        '<button data-action="bill-link" data-id="' + esc(x.id) + '">' + tr('Link') + '</button></div></div>';
    });
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
    (state.goals || []).forEach((g) => {
      const st = Core.goalStatus(state, g, cyc.start);
      if (st.monthly > 0) { g.saved = (Number(g.saved) || 0) + st.monthly; g.added = { cycle: cyc.start, amount: st.monthly }; }
    });
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

  // ---------- the Runway card ----------

  // One friendly sentence first: what to do, before any number.
  function coachLine(z, r, streak, daysToPay) {
    if (r.overToday > 0 && r.savedToday < r.overToday) return tr('Today went over. Tomorrow is a fresh start.');
    if (z.zone === 'red') return tr('Let’s protect the basics first.');
    if (z.zone === 'amber') return tr(daysToPay <= 10 ? 'Slow down a little. You’re nearly at payday.' : 'Slow down a little and you’ll reach payday safely.');
    if (streak >= 2) return tr('{days} in a row within your daily amount. Keep going!', { days: plural(streak, 'day') });
    return tr('You’re on track. Keep it going.');
  }

  /*
   * Hero 1, today's limit: the amount, a spent/left bar, the zone and what
   * to do. Win the day by staying inside it.
   */
  // Zone signs, impossible to miss: a celebration, a warning, a stop sign.
  const SIGNS = {
    green: '<svg class="sign" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.3 6.6L21 11l-6.7 2.3L12 20l-2.3-6.7L3 11l6.7-2.4z" fill="currentColor"/><circle cx="19.5" cy="4.5" r="1.6" fill="currentColor"/><circle cx="4.5" cy="19.5" r="1.3" fill="currentColor"/><circle cx="20" cy="19" r="1" fill="currentColor"/></svg>',
    amber: '<svg class="sign" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5L23 21.5H1z" fill="currentColor"/><path class="mark" d="M11 9h2v6.5h-2z"/><circle class="mark" cx="12" cy="18.2" r="1.25"/></svg>',
    red: '<svg class="sign" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 1.5h8l6.5 6.5v8L16 22.5H8L1.5 16V8z" fill="currentColor"/><path class="mark" d="M6.5 10.8h11v2.4h-11z"/></svg>',
  };

  // The zone as a banner across the card: the first thing seen.
  function zoneBanner(zone, label, sub) {
    return '<div class="zone-banner">' + SIGNS[zone] + '<span><b>' + label + '</b><small>' + sub + '</small></span></div>';
  }

  function limitCard(r, z, headline, sub) {
    const over = r.overToday > 0 && r.savedToday < r.overToday;
    const used = r.dailyAllowance > 0 ? Math.min(100, ((r.spentToday + r.savedToday) / r.dailyAllowance) * 100) : (r.spentToday ? 100 : 0);
    const from = ui.limitPct == null ? 0 : ui.limitPct;
    const banner = {
      green: zoneBanner('green', tr('Green: on track'), tr('You’re winning this round. Keep going.')),
      amber: zoneBanner('amber', tr('Careful'), tr('At this pace the money runs out before payday.')),
      red: zoneBanner('red', tr('Red zone: stop'), tr('Bills and basics aren’t covered. Basics only now.')),
    }[z.zone];
    return '<div class="runway-card zone-' + z.zone + '">' + banner +
      '<div class="runway-head"><span class="hero-label">' + tr('Today’s limit') + '</span></div>' +
      '<div class="limit-big"><b data-count="' + Math.round(r.dailyAllowance) + '">' + inr(r.dailyAllowance) + '</b></div>' +
      '<div class="limit-bar' + (over ? ' over' : '') + '" role="img" aria-label="' + esc(todayTileNote(r)) + '"><span id="limit-fill" style="width:' + from.toFixed(1) + '%" data-to="' + used.toFixed(1) + '"></span></div>' +
      '<div class="limit-line"><span>' + (over ? tr('{amount} over', { amount: inr(r.overToday) }) : tr('{amount} spent', { amount: inr(r.spentToday + r.savedToday) })) + '</span>' +
      '<span>' + (over ? tr('Tomorrow: {amount}', { amount: inr(r.tomorrowAllowance) }) : tr('{amount} left', { amount: inr(r.leftToday) })) + '</span></div>' +
      '<h1>' + headline + '</h1><p class="runway-sub">' + sub + '</p>' +
      '<button class="explain-link" data-action="explain" data-explain="limit">' + tr('How is this calculated?') + '</button></div>';
  }

  const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" fill="currentColor"/></svg>';

  // Hero 2, Days of Freedom: how long savings cover the basics. Win the game.
  function freedomCard() {
    const f = Core.freedomDays(state, today());
    if (!f) {
      return '<div class="freedom-card"><span class="hero-label">' + tr('Days of Freedom') + '</span>' +
        '<p class="hint">' + tr('Add your fixed payments and budgets to see your Days of Freedom.') + '</p></div>';
    }
    const next = !f.next ? tr('Three months of basics covered. Keep it there.')
      : f.next.target === 90 ? tr('{n} more days ({amount}) to three months safe.', { n: f.next.days, amount: inr(f.next.amount) })
        : tr(f.next.days === 1 ? '1 more day ({amount}) turns it {level}.' : '{n} more days ({amount}) turns it {level}.', { n: f.next.days, amount: inr(f.next.amount), level: tr(f.next.level) });
    const sign = { red: SIGNS.red, amber: SIGNS.amber, green: SIGNS.green }[f.level];
    return '<div class="freedom-card lvl-' + f.level + '">' +
      '<div class="zone-banner">' + sign + '<span><b>' + tr(f.badge) + '</b><small>' + tr('Days of Freedom') + '</small></span></div>' +
      '<div class="freedom-big"><b>' + f.days + '</b><span>' + tr(f.days === 1 ? 'day your savings cover the basics' : 'days your savings cover the basics') + '</span></div>' +
      '<p class="freedom-next">' + next + '</p>' +
      '<button class="explain-link" data-action="explain" data-explain="freedom">' + tr('How is this calculated?') + '</button></div>';
  }

  /*
   * This round, day by day: won (inside the day's limit), over, today, to
   * come. Logging a bad day still counts: the next day starts fresh.
   */
  // One tile per day of a round: won, over, not tracked, today or still to come.
  function roundTiles(cyc) {
    const t = today();
    let won = 0;
    let over = 0;
    const tiles = [];
    for (let i = 0; i < cyc.days; i++) {
      const d = Core.addDays(cyc.start, i);
      let cls = 'future';
      let tip = fmtDate(d);
      if (d === t) { cls = 'today'; tip += ': ' + tr('today'); }
      else if (d < t) {
        const day = state.days && state.days[d];
        if (!day) { cls = 'none'; tip += ': ' + tr('not tracked'); }
        else if (Core.daySpending(state, d) <= day.allowance) { cls = 'won'; won++; tip += ': ' + tr('won ({spent} of {limit})', { spent: inr(Core.daySpending(state, d)), limit: inr(day.allowance) }); }
        else { cls = 'over'; over++; tip += ': ' + tr('over ({spent} of {limit})', { spent: inr(Core.daySpending(state, d)), limit: inr(day.allowance) }); }
      }
      tiles.push('<span class="round-tile ' + cls + '" title="' + esc(tip) + '">' + (cls === 'won' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '') + '</span>');
    }
    return { won, over, html: '<div class="round-grid" role="img" aria-label="' + esc(tr('{won} days won, {over} over', { won, over })) + '">' + tiles.join('') + '</div>' };
  }

  function roundBoard(cyc, r) {
    const t = today();
    const g = roundTiles(cyc);
    const won = g.won;
    const over = g.over;
    const y = Core.addDays(t, -1);
    const yDay = state.days && state.days[y];
    const recover = yDay && y >= cyc.start && Core.daySpending(state, y) > yDay.allowance
      ? '<p class="round-recover">' + tr('Yesterday went over. Today’s limit already takes it into account: keep to {amount} and you’re back on track.', { amount: inr(r.dailyAllowance) }) + '</p>' : '';
    const b = Core.borrowedThisCycle(state, t);
    return '<section class="card round-card"><div class="card-head"><h2>' + tr('This round') + '</h2><span class="hint">' + tr('{from} – {to} · day {day} of {days}', { from: fmtDate(cyc.start), to: fmtDate(Core.addDays(cyc.next, -1)), day: r.idxToday + 1, days: cyc.days }) + '</span></div>' +
      g.html +
      '<div class="viz-legend"><span><i class="round-key won"></i>' + tr('Won {n}', { n: won }) + '</span><span><i class="round-key over"></i>' + tr('Over {n}', { n: over }) + '</span><span><i class="round-key today"></i>' + tr('Today') + '</span></div>' +
      '<p class="round-borrowed ' + (b.total ? 'bad' : 'good') + '">' + tr('Borrowed this round: {amount}', { amount: inr(b.total) }) + (b.total ? '' : ' ✓') + '</p>' + recover + '</section>';
  }

  // Two debt-free dates: no change (minimums only) and with the plan.
  function debtFreeCard() {
    const d = Core.debtFreeDates(state, today());
    if (!d) return '';
    const date = (x) => (x.never ? tr('Never') : monthYear(x.date));
    return '<section class="card debtfree-card"><div class="card-head"><h2>' + tr('Debt-free date') + '</h2></div>' +
      '<div class="debtfree-cols"><div><span class="hint">' + tr('Minimums only') + '</span><b>' + date(d.now) + '</b></div>' +
      '<div class="plan"><span class="hint">' + tr('With your plan') + '</span><b>' + date(d.plan) + '</b></div></div>' +
      (d.now.never ? '<p class="hint bad">' + tr('At the minimums the interest grows faster than the payments.') + '</p>' : '') +
      (d.sooner > 0 ? '<p class="good">' + tr('{months} sooner, saving about {amount} in interest.', { months: plural(d.sooner, 'month'), amount: inr(d.saved) }) + '</p>'
        : '<p class="hint">' + tr('Set aside an extra amount for loans in Plan to bring this date closer.') + '</p>') +
      '<button class="explain-link" data-action="explain" data-explain="debtfree">' + tr('How is this calculated?') + '</button></section>';
  }

  // "How is this calculated?": the formula with the person's own numbers.
  function explainModal() {
    if (!ui.explain) return '';
    const t = today();
    let title = '';
    let lines = [];
    if (ui.explain === 'limit') {
      const r = Core.projectRunway(state, t);
      const l = r.limit;
      title = tr('Today’s limit');
      lines = [
        tr('It’s the smaller of two amounts, so you never spend money the bills still need:'),
        tr('<b>What the budget allows:</b> flexible money left this round ÷ {days} days to payday (today included) = <b>{amount}</b>.', { days: l.days, amount: inr(l.byBudget) }),
        tr('<b>What the account can cover:</b> ({money} in the account this morning − {bills} of bills still to come) ÷ {days} days = <b>{amount}</b>.', { money: inr(l.money), bills: inr(l.bills), days: l.days, amount: inr(l.byMoney) }),
        tr('Today’s limit: <b>{amount}</b>. Spending or saving today uses it up; going over lowers the days that follow.', { amount: inr(r.dailyAllowance) }),
      ];
    } else if (ui.explain === 'freedom') {
      const f = Core.freedomDays(state, t);
      title = tr('Days of Freedom');
      lines = f ? [
        tr('How many days your savings would pay for the basics if your salary stopped.'),
        tr('Basics a month: fixed payments {fixed} + loan minimums {debt} + bills {bills} + groceries and health {food} = <b>{total}</b>. A day: {total} ÷ 30 = <b>{daily}</b>.',
          { fixed: inr(f.parts.fixed), debt: inr(f.parts.debtMin), bills: inr(f.parts.bills), food: inr(f.parts.essentials), total: inr(f.needs), daily: inr(f.daily) }),
        tr('Emergency fund {fund} ÷ {daily} a day = <b>{days} days</b>.', { fund: inr(f.fund), daily: inr(f.daily), days: f.days }),
        tr('<b>Red</b> 0–6 days: at risk. <b>Amber</b> 7–29: building. <b>Green</b> 30 or more: a month safe.'),
      ] : [tr('Add your fixed payments and budgets to see your Days of Freedom.')];
    } else if (ui.explain === 'debtfree') {
      const d = Core.debtFreeDates(state, t);
      title = tr('Debt-free date');
      lines = d ? [
        tr('<b>Minimums only:</b> you keep paying {amount} a month in minimums and EMIs, interest added every month, nothing extra.', { amount: inr(d.minimums) }),
        tr('<b>With your plan:</b> the same, plus {amount} a month extra on the loan with the highest interest first. When a loan is cleared, its payment moves on to the next one.', { amount: inr(d.extra) }),
        tr('These use today’s balances and rates. Update the balances from your statements to keep the dates honest. Lenders’ actual charges can differ.'),
      ] : [];
    }
    if (ui.explain === 'journey') {
      const j = Core.debtJourney(state, t);
      title = tr('Your way out of debt');
      lines = j && j.stage !== 'free' ? [
        tr('<b>Survive</b> until your salary covers the basics and every minimum ({needs} a month against a salary of {salary}), and nothing has been borrowed for 30 days. Card spending and loans received count as borrowing.',
          { needs: inr(j.freedom ? j.freedom.needs : 0), salary: inr(Core.monthlyPlan(state, t).salary) }),
        tr('<b>Stabilize</b> until your emergency fund covers 7 Days of Freedom. You have {days}.', { days: j.fdays }),
        tr('<b>Escape:</b> loans are cleared one at a time, in the order you pick. Each bar is what’s left of the loan’s highest balance. After each due date the EMI comes off: the EMI less that month’s interest.'),
        tr('If you borrow again, you go back a step. Nothing is lost: your plan and wins stay.'),
      ] : [];
    }
    return '<div class="reset-modal-overlay help-overlay" role="presentation"><div class="reset-modal-card help-card" role="dialog" aria-modal="true" aria-labelledby="explain-title" id="explain-card">' +
      '<h2 id="explain-title">' + title + '</h2>' + lines.map((x) => '<p>' + x + '</p>').join('') +
      '<div><button class="primary" data-action="explain-close">' + tr('Got it') + '</button></div></div></div>';
  }

  // The runway graph.
  function chartCard() {
    return '<section class="card chart-card"><div class="card-head"><h2>' + tr('Your runway graph') + '</h2></div>' +
      '<div class="chart-wrap"><div id="runway-chart" role="img" aria-label="' + tr('Balance through this salary cycle') + '"></div>' +
      '<div class="legend"><span><i></i>' + tr('Balance so far') + '</span><span><i class="pace"></i>' + tr('If you keep this pace') + '</span><span><i class="plan"></i>' + tr('If you keep to budget') + '</span>' +
      '<span><i class="red-band"></i>' + tr('Red zone: bills and basics still to pay') + '</span><span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="c-event"/></svg>' + tr('Bill or EMI') + '</span></div></div></section>';
  }

  const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /*
   * Light animation, once per change: the ring moves to today's amount, and
   * on opening the app the amount counts up. Nothing loops, so it costs
   * almost no battery; the phone's "reduce animations" setting turns it off.
   */
  function animateRunway() {
    const fill = document.getElementById('limit-fill');
    if (!fill) return;
    const to = Number(fill.dataset.to) || 0;
    ui.limitPct = to;
    if (REDUCE_MOTION) { fill.style.width = to + '%'; return; }
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = to + '%'; }));
    if (ui.counted) return;
    ui.counted = true;
    const el = document.querySelector('.limit-big [data-count]');
    const end = Number(el && el.dataset.count) || 0;
    if (!el || end <= 0) return;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 700);
      el.textContent = inr(end * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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
    const rr = Core.roundResult(state, today());
    const tally = rr.tally;
    const banner = rr.won
      ? '<div class="round-result won"><span class="rr-icon" aria-hidden="true">🏆</span><div><b>' + tr('Round won') + '</b><span>' + tr('You reached payday without borrowing.') + '</span></div></div>'
      : '<div class="round-result"><span class="rr-icon" aria-hidden="true">↻</span><div><b>' + tr('Round over') + '</b><span>' + tr('{amount} borrowed this round. The next round is a fresh start.', { amount: inr(rr.borrowed) }) + '</span></div></div>';
    const days = '<p class="rr-days">' + tr('{won} days won · {over} over · {logged} of {days} days logged', { won: tally.won, over: tally.over, logged: tally.logged, days: tally.total }) + '</p>' +
      (tally.over > 0 && tally.logged > 0 ? '<p class="hint">' + tr('Logging the days that went over is what keeps your numbers true. That counts as a win too.') + '</p>' : '');
    const ch = rr.change;
    const thenNow = ch
      ? '<div class="rr-change">' +
        '<div><span class="hint">' + tr('Days of Freedom') + '</span><b class="' + (ch.freedom[1] > ch.freedom[0] ? 'good' : ch.freedom[1] < ch.freedom[0] ? 'bad' : '') + '">' + ch.freedom[0] + ' → ' + ch.freedom[1] + '</b></div>' +
        (ch.debt[0] || ch.debt[1] ? '<div><span class="hint">' + tr('Loans left') + '</span><b class="' + (ch.debt[1] < ch.debt[0] ? 'good' : ch.debt[1] > ch.debt[0] ? 'bad' : '') + '">' + shortInr(ch.debt[0]) + ' → ' + shortInr(ch.debt[1]) + '</b></div>' : '') +
        '</div><p class="hint">' + tr('Since {date}, when this round was first opened.', { date: fmtDate(ch.since) }) + '</p>'
      : '';
    const ROW = { pay: 'Pay', flex: 'Daily spending', saved: 'Saved and set aside', borrowed: 'Borrowed' };
    const table = '<table class="rr-table"><thead><tr><th scope="col"></th><th scope="col">' + tr('Planned') + '</th><th scope="col">' + tr('Actual') + '</th></tr></thead><tbody>' +
      rr.rows.map((x) => '<tr><th scope="row">' + tr(ROW[x.key]) + '</th><td>' + inr(x.planned) + '</td><td class="' + (x.good ? 'good' : 'warn') + '">' + inr(x.actual) + ' ' + (x.good ? '✓' : '!') + '</td></tr>').join('') +
      '</tbody></table>';
    const goal = rr.goal.kind === 'borrow' ? tr('No credit card for daily spending. Keep to today’s limit instead.')
      : rr.goal.kind === 'budget' ? tr('Keep {name} within {amount}.', { name: label(rr.goal.name), amount: inr(rr.goal.amount) })
        : rr.goal.kind === 'save' ? tr('Move one day’s leftover to savings or a loan.')
          : tr(rr.goal.won === 1 ? 'Win {n} day again, or one more.' : 'Win {n} days again, or one more.', { n: rr.goal.won });
    return '<div class="reset-modal-overlay report-overlay" role="presentation"><div class="reset-modal-card report-card" role="dialog" aria-modal="true" aria-labelledby="report-title" id="report-card" tabindex="-1">' +
      '<span class="eyebrow">' + tr('Round result · {from} – {to}', { from: fmtDate(r.cycle.start), to: fmtDate(r.last) }) + '</span>' +
      '<h2 id="report-title" class="visually-hidden">' + tr('How last month went') + '</h2>' +
      banner + roundTiles(r.cycle).html + days + thenNow +
      '<span class="report-section">' + tr('Planned and actual') + '</span>' + table +
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
      '<div class="rr-goal"><span class="eyebrow">' + tr('Next round') + '</span><b>' + goal + '</b></div>' +
      '<button class="primary report-go" data-action="report-done">' + tr('Start the next round') + '</button>' +
      '</div></div>';
  }

  // ---------- weekly recap ----------

  // Once a week, on the Runway tab: the last 7 days in small wins.
  function weekRecapDue() {
    if (state.isDemo || !state.settings.salary) return false;
    const t = today();
    if (state.recapSeen) return Core.daysBetween(state.recapSeen, t) >= 7;
    const first = state.transactions.reduce((m, x) => (!m || x.date < m ? x.date : m), null);
    return !!first && Core.daysBetween(first, t) >= 7;
  }

  function weekCard() {
    if (!weekRecapDue()) return '';
    const w = Core.weekRecap(state, today());
    const k = w.tally;
    const good = w.borrowed === 0 && k.won >= 5;
    const items = [
      ['won', tr('{n} of 7 days won', { n: k.won }) + (k.over ? ' · ' + tr('{n} over', { n: k.over }) : '')],
      ['log', tr('{n} of 7 days logged', { n: k.logged })],
    ];
    if (w.saved > 0) items.push(['saved', tr('{amount} saved', { amount: inr(w.saved) }) + (w.freedomGained > 0 ? ' · ' + tr(w.freedomGained === 1 ? '+{n} Day of Freedom' : '+{n} Days of Freedom', { n: w.freedomGained }) : '')]);
    if (w.debtPaid > 0) items.push(['debt', tr('{amount} extra on loans', { amount: inr(w.debtPaid) }) + (w.daysCloser > 0 ? ' · ' + tr(w.daysCloser === 1 ? 'about {n} day closer to debt-free' : 'about {n} days closer to debt-free', { n: w.daysCloser }) : '')]);
    items.push(w.borrowed ? ['borrow', tr('{amount} borrowed', { amount: inr(w.borrowed) })] : ['clean', tr('Nothing borrowed')]);
    return '<section class="card week-card' + (good ? ' good' : '') + '"><div class="card-head"><h2>' + tr(good ? 'A strong week!' : k.won > 0 ? 'Your week: small wins add up' : 'A new week starts today') + '</h2>' +
      '<span class="hint">' + tr('{from} – {to}', { from: fmtDate(w.from), to: fmtDate(w.to) }) + '</span></div>' +
      '<ul class="week-list">' + items.map((x) => '<li class="wk-' + x[0] + '">' + x[1] + '</li>').join('') + '</ul>' +
      '<div><button class="primary" data-action="week-done" data-good="' + (good ? 1 : '') + '">' + tr('On to next week') + '</button></div></section>';
  }

  // ---------- before you borrow ----------

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

  // Money kept from a loan that is still in the Debts list: most likely a removed duplicate, not a paid-off loan.
  function staleRollovers() {
    const active = new Set((state.debts || []).filter((d) => d.balance > 0).map((d) => (d.name || '').trim().toLowerCase()));
    return (state.savings.rollovers || []).filter((x) => x.kind === 'loan' && active.has((x.from || '').trim().toLowerCase()));
  }

  function staleRolloverNote() {
    return staleRollovers().map((x) => '<div class="callout warn"><b>' + tr('{amount} a month is set aside from {name}, but {name} is still in your loans', { amount: inr(x.amount), name: esc(x.from) }) + '</b>' +
      '<span class="hint">' + tr('This happens when a loan is removed (a duplicate, say) and kept as paid off. It takes {amount} a month from your daily spending.', { amount: inr(x.amount) }) + '</span>' +
      '<div><button class="primary" data-action="rollover-stop" data-id="' + esc(x.id) + '">' + tr('Stop it') + '</button></div></div>').join('');
  }

  function rolloverCard() {
    const a = state.rolloverAsk;
    if (!a || ui.rolloverHidden || state.isDemo) return '';
    const o = Core.rolloverOptions(state, a.amount, today());
    return '<section class="card income-card rollover-card"><div class="card-head">' +
      titled(a.kind === 'raise' ? tr('Your pay went up by {amount}', { amount: inr(a.raise) }) : a.removed ? tr('You removed {name}. Is it paid off?', { name: esc(a.from) }) : tr('{name} is done 🎉', { name: esc(a.from) }), 'rollover') + '</div>' +
      '<p class="hint">' + (a.kind === 'raise'
        ? tr('Send half of it, {amount} a month, to freedom before spending grows to match it.', { amount: inr(a.amount) })
        : tr(a.removed ? 'If it’s paid off, you’re used to living without {amount} a month. Keep paying it, to yourself:' : 'You’re used to living without {amount} a month. Keep paying it, to yourself:', { amount: inr(a.amount) })) + '</p>' +
      '<div class="choices">' + o.options.map((opt) =>
        '<button class="choice' + (opt.to === o.recommended ? ' suggested' : '') + '" data-action="rollover-use" data-to="' + opt.to + '">' +
        '<span class="choice-title">' + esc(opt.title) + (opt.to === o.recommended ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '') + '</span>' +
        '<span class="choice-detail">' + esc(opt.detail) + '</span></button>').join('') + '</div>' +
      '<p class="hint"><b>' + tr('Why the suggestion:') + '</b> ' + esc(o.reason) + '</p>' +
      '<div class="row">' + (a.kind === 'loan' ? '<button data-action="rollover-no">' + tr(a.removed ? 'No, it isn’t paid off' : 'It isn’t paid off') + '</button>' : '') +
      '<button class="ghost" data-action="rollover-later">' + tr('Decide later') + '</button></div></section>';
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
  // Net worth at the latest day of each round, for the chart over time. About two years.
  function logWorth() {
    const t = today();
    const c = Core.cycleFor(t, Number(state.settings.payday) || 1).start;
    const v = Core.netWorth(state, t).value;
    state.worthLog = state.worthLog || {};
    if (state.worthLog[c] === v) return;
    state.worthLog[c] = v;
    Object.keys(state.worthLog).sort().slice(0, -24).forEach((k) => { delete state.worthLog[k]; });
    save(true);
  }

  function netWorthCard() {
    const t = today();
    const n = Core.netWorth(state, t);
    const log = state.worthLog || {};
    const keys = Object.keys(log).sort().slice(-12);
    const vals = keys.map((k) => log[k]);
    const hi = Math.max(0, ...vals);
    const lo = Math.min(0, ...vals);
    const span = Math.max(1, hi - lo);
    const zero = (-lo / span) * 100;
    const prev = keys.length > 1 ? vals[vals.length - 2] : null;
    const change = prev !== null ? n.value - prev : null;
    const signed = (v) => (v < 0 ? '−' : '') + inr(Math.abs(v));
    const bars = keys.map((k, i) => {
      const v = vals[i];
      const tip = tr('Round from {date}: {amount}', { date: fmtDate(k), amount: signed(v) });
      const h = (Math.abs(v) / span) * 100;
      return '<button class="nw-col' + (i === keys.length - 1 ? ' today' : '') + '" data-action="viz-tip" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '"><span class="nw-plot">' +
        '<span class="nw-zero" style="bottom:' + zero.toFixed(1) + '%"></span>' +
        '<span class="nw-bar' + (v < 0 ? ' neg' : '') + '" style="bottom:' + (v < 0 ? zero - h : zero).toFixed(1) + '%;height:' + Math.max(v ? 2 : 0, h).toFixed(1) + '%"></span></span>' +
        '<span class="wk-day">' + monthName(Core.parseISO(k).getMonth()) + '</span></button>';
    }).join('');
    const line = (labelText, v, cls) => '<div class="line"><span>' + tr(labelText) + '</span><span' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</span></div>';
    return '<section class="card net-worth"><div class="card-head">' + titled('Net worth', 'worth') + '</div>' +
      '<p class="nw-big' + (n.value < 0 ? ' bad-text' : '') + '">' + signed(n.value) + '</p>' +
      '<p class="hint">' + (n.value < 0 ? tr('You owe more than you own. Every loan payment and every rupee saved moves this up.') : tr('What you own minus what you owe.')) +
      (change !== null ? ' ' + tr(change >= 0 ? 'Up {amount} since last round.' : 'Down {amount} since last round.', { amount: inr(Math.abs(change)) }) : '') + '</p>' +
      '<div class="summary">' + line('Money in your account and wallets', inr(n.money)) + line('Emergency fund and Grow savings', inr(n.funds)) +
      (n.loans ? line('Loans', '−' + inr(n.loans)) : '') + (n.cards ? line('Card dues from before', '−' + inr(n.cards)) : '') +
      line('Net worth', signed(n.value), n.value < 0 ? 'bad' : '') + '</div>' +
      (keys.length > 1
        ? '<div class="nw-grid">' + bars + '</div><p class="viz-tip" aria-live="polite">' + tr('Tap a round to see its number.') + '</p>' +
          numbersTable([tr('Round from'), tr('Net worth')], keys.map((k, i) => [fmtDate(k, true), signed(vals[i])]))
        : '<p class="hint">' + tr('Kept each round from now on, so you can watch it climb.') + '</p>') +
      '</section>';
  }

  // Savings goals with a date: the monthly amount comes out of the salary like yearly costs.
  function goalsCard() {
    const t = today();
    const gs = state.goals || [];
    const f = ui.goalForm;
    return '<section class="card goals-card"><div class="card-head">' + titled('Savings goals', 'goals') + '<span class="hint">' + tr('A bike, a trip, a deposit') + '</span></div>' +
      (gs.length ? '<div class="bars">' + gs.map((g) => {
        const st = Core.goalStatus(state, g, t);
        const note = st.done ? '<b class="good">' + tr('Reached ✓') + '</b>'
          : st.late ? '<b class="bad">' + tr('The date has passed with {amount} still to go. Pick a new date.', { amount: inr(st.left) }) + '</b>'
            : tr(st.fresh ? 'From next payday: {amount} a month until {date}' : '{amount} a month until {date}', { amount: inr(st.perPayday), date: fmtDate(g.by, true) });
        return '<div class="bar-row goal-row"><div class="bar-top"><span>' + esc(g.name) + '</span><span class="amt">' + tr('{amount} of {target}', { amount: inr(st.saved), target: inr(st.target) }) + '</span></div>' +
          '<div class="bar"><span class="' + (st.done ? '' : 'marigold') + '" style="width:' + st.pct.toFixed(1) + '%"></span></div>' +
          '<div class="bar-sub">' + note + '</div>' +
          '<div class="form-grid goal-edit">' +
          '<label class="field" for="goal-saved-' + esc(g.id) + '"><span>' + tr('Saved so far (₹)') + '</span><input id="goal-saved-' + esc(g.id) + '" type="number" inputmode="numeric" min="0" step="1" data-goal="' + esc(g.id) + '" data-goal-field="saved" value="' + (Number(g.saved) || 0) + '"></label>' +
          '<label class="field" for="goal-by-' + esc(g.id) + '"><span>' + tr('By') + '</span><input id="goal-by-' + esc(g.id) + '" type="date" min="' + t + '" data-goal="' + esc(g.id) + '" data-goal-field="by" value="' + esc(g.by || '') + '"></label>' +
          '</div><div class="row"><button class="ghost small" data-action="goal-remove" data-id="' + esc(g.id) + '">' + tr('Remove') + '</button></div></div>';
      }).join('') + '</div>' : '<p class="hint">' + tr('Save for something with a date, and the app puts aside what it takes each payday, before your flexible budgets.') + '</p>') +
      (f
        ? '<form id="goal-form" class="callout" autocomplete="off"><b>' + tr('New goal') + '</b><div class="form-grid">' +
          '<label class="field" for="gf-name"><span>' + tr('Name') + '</span><input id="gf-name" type="text" required maxlength="40" placeholder="' + tr('Bike down payment') + '"></label>' +
          '<label class="field" for="gf-target"><span>' + tr('Amount needed (₹)') + '</span><input id="gf-target" type="number" inputmode="numeric" min="1" step="1" required></label>' +
          '<label class="field" for="gf-by"><span>' + tr('By') + '</span><input id="gf-by" type="date" min="' + Core.addDays(t, 1) + '" required></label>' +
          '<label class="field" for="gf-saved"><span>' + tr('Saved so far (₹)') + '</span><input id="gf-saved" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></label>' +
          '</div>' + (f.error ? '<p class="bad" role="alert">' + f.error + '</p>' : '') +
          '<div class="row"><button class="primary" type="submit">' + tr('Add goal') + '</button><button type="button" class="ghost" data-action="goal-cancel">' + tr('Cancel') + '</button></div></form>'
        : '<div class="row"><button class="primary" data-action="goal-add">' + tr('Add a goal') + '</button></div>') +
      '</section>';
  }

  function addGoal(ev) {
    ev.preventDefault();
    const t = today();
    const name = document.getElementById('gf-name').value.trim().slice(0, 40);
    const target = Math.round(Number(document.getElementById('gf-target').value) || 0);
    const by = document.getElementById('gf-by').value;
    const saved = Math.max(0, Math.round(Number(document.getElementById('gf-saved').value) || 0));
    if (!name) { ui.goalForm = { error: tr('Give it a name.') }; render(); return; }
    if (!(target > 0)) { ui.goalForm = { error: tr('Enter an amount above ₹0.') }; render(); return; }
    if (!by || by <= t) { ui.goalForm = { error: tr('Pick a date after today.') }; render(); return; }
    const before = JSON.stringify(state);
    state.goals = (state.goals || []).concat({ id: uid(), name, target, by, saved, created: t });
    ui.goalForm = null;
    save();
    rerenderKeepScroll();
    offerUndo(tr('{name} added', { name }), before);
  }

  function recordToday(r) {
    const t = today();
    state.days = state.days || {};
    const day = state.days[t] || {};
    const allowance = Math.round(r.dailyAllowance);
    if (day.allowance !== allowance && !day.prompted) {
      logEvent('limit', { date: t, limit: allowance, byMoney: Math.round(r.limit.byMoney), byBudget: Math.round(r.limit.byBudget), money: Math.round(r.limit.money),
        bills: Math.round(r.limit.bills), days: r.limit.days, flex: r.plan.flexTotal, setAside: r.plan.savingsTotal });
      state.days[t] = Object.assign(day, { allowance });
      // Keep about two rounds of days, for the round board.
      Object.keys(state.days).filter((d) => d < Core.addDays(t, -70)).forEach((d) => { delete state.days[d]; });
      save(true);
    }
  }

  // Spent and saved on a day: saved money can't be spent either.
  function spentOn(date) { return Core.daySpent(state, date); }

  // Days in a row, up to yesterday, spent within the daily amount.
  function withinStreak() {
    let n = 0;
    let d = Core.addDays(today(), -1);
    while (state.days && state.days[d] && Core.daySpending(state, d) <= state.days[d].allowance) { n++; d = Core.addDays(d, -1); }
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

  /*
   * Reconcile, like comparing with a bank statement: before a new balance
   * replaces the count, see how far the app's count was from it. A gap means
   * something wasn't noted; it can be noted now so budgets and charts see it.
   */
  function expectedMorning() {
    const prev = state.balanceCheck;
    if (!prev || prev.date >= today()) return null;
    return { amount: Math.round(Core.projectRunway(state, today()).limit.money), since: prev.date };
  }

  function reconcileAfter(exp, actual) {
    if (!exp) return;
    state.reconciledTo = Core.addDays(today(), -1);
    const gap = Math.round(exp.amount - actual);
    // Small differences are rounding, interest or charges: not worth a question.
    if (Math.abs(gap) < Math.max(100, actual * 0.01)) { ui.reconcile = { ok: true, since: exp.since }; return; }
    ui.reconcile = { gap, since: exp.since, expected: exp.amount, actual };
  }

  function reconcileCard() {
    const r = ui.reconcile;
    if (!r) return '';
    if (r.ok) {
      return '<div class="callout good" role="status"><b>' + tr('Your count matches your bank ✓') + '</b><span class="hint">' + tr('Everything since {date} is accounted for.', { date: fmtDate(r.since) }) + '</span>' +
        '<div><button class="ghost" data-action="reconcile-close">' + tr('OK') + '</button></div></div>';
    }
    const less = r.gap > 0;
    return '<div class="callout warn reconcile" role="status"><b>' + tr(less ? 'Your bank has {amount} less than the app counted' : 'Your bank has {amount} more than the app counted', { amount: inr(Math.abs(r.gap)) }) + '</b>' +
      '<span class="hint">' + tr('The app counted {expected} since your last check on {date}; your bank says {actual}.', { expected: inr(r.expected), date: fmtDate(r.since), actual: inr(r.actual) }) + ' ' +
      tr(less ? 'Something was paid that wasn’t noted: cash, a charge or a missed SMS.' : 'Money came in that wasn’t noted: a refund, cashback or money from someone.') + '</span>' +
      '<div class="form-grid"><label class="field" for="rec-cat"><span>' + tr('Note it as') + '</span><select id="rec-cat">' +
      (less ? categoryOptions('Misc') : incomeCategoryOptions('Refund')) + '</select></label></div>' +
      '<div class="row"><button class="primary" data-action="reconcile-note">' + tr(less ? 'Note it as spending' : 'Note it as money received') + '</button>' +
      '<button class="ghost" data-action="reconcile-close">' + tr('Leave it') + '</button></div>' +
      '<span class="hint">' + tr('Either way, today’s limit already uses your bank’s number.') + '</span></div>';
  }

  function balanceForm(firstTime) {
    const t = today();
    const current = state.balanceCheck && state.balanceCheck.date === t ? state.balanceCheck.amount : '';
    return '<form id="balance-form" class="callout" autocomplete="off">' +
      '<b>' + tr(firstTime ? 'How much money is in your account this morning?' : 'Update your balance') + '</b>' +
      '<span class="hint">' + tr(firstTime
        ? 'The app can’t see what you spent before you started. Enter your bank balance as it was at the start of today, and the graph will start from there. Add any spending from today after this.'
        : 'Check your bank app and enter the balance from the start of today. The graph starts again from this amount, which covers cash and anything not recorded.') + '</span>' +
      '<div class="row"><label class="field grow-field" for="balance-amount"><span>' + tr((state.wallets || []).length ? 'All your money this morning, every wallet together (₹)' : 'Balance this morning (₹)') + '</span><input id="balance-amount" type="number" inputmode="numeric" min="0" step="1" required value="' + esc(current) + '" placeholder="12500"></label></div>' +
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

  // The budgets as envelopes: what's in each (with money covered in or kept from last month), and a way to cover an overspend.
  function envelopeBars(env) {
    const c = ui.cover;
    const rows = env.list.map((x) => {
      const notes = [x.carried ? tr('{amount} kept from last month', { amount: inr(x.carried) }) : '',
        x.moved > 0 ? tr('{amount} covered in', { amount: inr(x.moved) }) : x.moved < 0 ? tr('{amount} given to cover others', { amount: inr(-x.moved) }) : ''].filter(Boolean);
      let html = barRow(x.name, x.spent, x.available, notes.join(' · '));
      if (x.left < 0 && x.spent > 0) {
        const donors = env.list.filter((d) => d.name !== x.name && d.left > 0);
        if (c && c.to === x.name) {
          const first = donors[0];
          html += '<form id="cover-form" class="callout" autocomplete="off"><b>' + tr('Cover {amount} for {category}', { amount: inr(-x.left), category: label(x.name) }) + '</b>' +
            '<span class="hint">' + tr('Take it from a budget that has money left. Your total for the month stays the same.') + '</span>' +
            '<div class="form-grid"><label class="field wide" for="cover-from"><span>' + tr('From') + '</span><select id="cover-from">' +
            donors.map((d) => '<option value="' + esc(d.name) + '">' + esc(label(d.name)) + ' · ' + tr('{amount} left', { amount: inr(d.left) }) + '</option>').join('') + '</select></label>' +
            '<label class="field" for="cover-amount"><span>' + tr('Amount (₹)') + '</span><input id="cover-amount" type="number" inputmode="numeric" min="1" step="1" value="' + Math.min(-x.left, first ? first.left : 0) + '"></label></div>' +
            (c.error ? '<p class="bad" role="alert">' + c.error + '</p>' : '') +
            '<div class="row"><button class="primary" type="submit">' + tr('Cover it') + '</button><button type="button" class="ghost" data-action="cover-cancel">' + tr('Cancel') + '</button></div></form>';
        } else if (donors.length) {
          html += '<div class="cover-row"><button class="ghost small" data-action="cover-open" data-cat="' + esc(x.name) + '">' + tr('Cover it from another budget') + '</button></div>';
        } else {
          html += '<p class="hint">' + tr('No other budget has money left to cover this. It comes out of the money for the rest of the month.') + '</p>';
        }
      }
      return html;
    });
    env.others.forEach((o) => rows.push(barRow(tr('{category} (no budget)', { category: label(o.name) }), o.spent, 0)));
    return '<div class="bars">' + rows.join('') + '</div>';
  }

  function coverSave(ev) {
    ev.preventDefault();
    const env = Core.budgetEnvelopes(state, today());
    const to = env.list.find((x) => x.name === (ui.cover && ui.cover.to));
    const from = env.list.find((x) => x.name === document.getElementById('cover-from').value);
    const amount = Math.round(Number(document.getElementById('cover-amount').value) || 0);
    if (!to || !from) { ui.cover = null; render(); return; }
    if (!(amount > 0)) { ui.cover = { to: to.name, error: tr('Enter an amount above ₹0.') }; render(); return; }
    if (amount > from.left) { ui.cover = { to: to.name, error: tr('{category} has only {amount} left.', { category: label(from.name), amount: inr(from.left) }) }; render(); return; }
    const before = JSON.stringify(state);
    state.budgetMoves = (state.budgetMoves || []).filter((m) => m.cycle >= Core.addDays(env.cycle.start, -400))
      .concat({ id: uid(), cycle: env.cycle.start, from: from.name, to: to.name, amount, date: today() });
    ui.cover = null;
    save();
    rerenderKeepScroll();
    offerUndo(tr('{amount} moved from {from} to {to}', { amount: inr(amount), from: label(from.name), to: label(to.name) }), before);
  }

  function barRow(name, spent, budget, note) {
    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
    const cls = budget === 0 ? 'marigold' : spent > budget ? 'bad' : spent > budget * 0.85 ? 'warn' : '';
    const left = budget - spent;
    const right = budget > 0
      ? (left >= 0 ? tr('<b>{amount}</b> left', { amount: inr(left) }) : '<b class="bad">' + tr('{amount} over', { amount: inr(-left) }) + '</b>')
      : inr(spent);
    return '<div class="bar-row"><div class="bar-top"><span>' + esc(label(name)) + '</span><span class="amt">' + right + '</span></div>' +
      '<div class="bar"><span class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></div>' +
      (budget > 0 ? '<div class="bar-sub">' + tr('Spent {spent} of {budget}', { spent: inr(spent), budget: inr(budget) }) + (note ? ' · ' + note : '') + '</div>' : '') + '</div>';
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

  // ---------- spending, three ways ----------

  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  // A mark the reader can tap (or hover) to see its exact amount below the chart.
  function tipAttrs(text) {
    return ' data-action="viz-tip" data-tip="' + esc(text) + '" aria-label="' + esc(text) + '"';
  }

  function showVizTip(el) {
    // The tip line in the same card (the weekly chart has its own).
    const card = el.closest('.card, .viz-card');
    const tip = (card && card.querySelector('.viz-tip')) || document.getElementById('viz-tip');
    if (!tip || !el.dataset.tip) return;
    tip.textContent = el.dataset.tip;
    document.querySelectorAll('[data-tip].on').forEach((x) => x.classList.remove('on'));
    el.classList.add('on');
  }

  function numbersTable(head, rows) {
    return '<details class="viz-table"><summary>' + tr('See the numbers') + '</summary><div class="table-wrap"><table><thead><tr>' +
      head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="amt"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></details>';
  }

  // Where: categories against budget, and basics against everything else.
  const WHERE_PERIODS = [['this', 'This round'], ['last', 'Last round'], ['3', '3 rounds'], ['6', '6 rounds']];

  function vizWhere() {
    const period = ui.wherePeriod || 'this';
    const w = Core.spendWhere(state, today(), period);
    const seg = '<div class="seg where-seg" role="group" aria-label="' + tr('Period') + '">' + WHERE_PERIODS.map(([k, n]) =>
      '<button data-action="where-period" data-period="' + k + '" aria-pressed="' + (period === k) + '">' + tr(n) + '</button>').join('') + '</div>';
    const span = fmtDate(w.range.from) + ' – ' + fmtDate(Core.addDays(w.range.to, -1));
    if (!w.total) return seg + '<p class="hint">' + tr(period === 'this' ? 'Nothing spent yet this month.' : 'Nothing spent in this period.') + '</p>';
    const scale = Math.max.apply(null, w.categories.map((c) => Math.max(c.spent, c.budget)));
    const change = (now, then) => {
      if (!w.comparable || !then) return '';
      const d = now - then;
      if (Math.abs(d) < 50) return tr('about the same as before');
      return tr(d > 0 ? '{amount} more than before' : '{amount} less than before', { amount: inr(Math.abs(d)) });
    };
    const rows = w.categories.map((c) => {
      const within = c.budget ? Math.min(c.spent, c.budget) : c.spent;
      const over = c.budget ? Math.max(0, c.spent - c.budget) : 0;
      const tip = label(c.name) + ': ' + (c.budget ? tr('{spent} of {budget}', { spent: inr(c.spent), budget: inr(c.budget) }) : inr(c.spent)) +
        (over ? ' · ' + tr('{amount} over', { amount: inr(over) }) : '');
      const open = ui.whereOpen === c.name;
      const ch = change(c.spent, c.before);
      return '<button class="viz-row' + (open ? ' open' : '') + '" data-action="where-open" data-cat="' + esc(c.name) + '" data-tip="' + esc(tip) + '" aria-expanded="' + open + '"><span class="viz-row-top"><span>' + esc(label(c.name)) + '</span><span class="amt">' + inr(c.spent) +
        (over ? ' <b class="bad">' + tr('+{amount} over', { amount: inr(over) }) + '</b>' : c.budget ? ' <small>' + tr('of {amount}', { amount: inr(c.budget) }) + '</small>' : '') + '</span></span>' +
        '<span class="viz-track"><span class="viz-fill s1" style="width:' + ((within / scale) * 100).toFixed(1) + '%"></span>' +
        (over ? '<span class="viz-fill over" style="width:' + ((over / scale) * 100).toFixed(1) + '%"></span>' : '') +
        (c.budget ? '<i class="viz-budget" style="left:' + ((c.budget / scale) * 100).toFixed(1) + '%"></i>' : '') + '</span>' +
        (ch ? '<span class="viz-change">' + ch + '</span>' : '') + '</button>' +
        (open
          ? '<div class="where-list">' + c.payments.slice(0, 12).map((x) => '<div class="where-pay"><span>' + esc(x.note || label(c.name)) + ' · ' + fmtDate(x.date) + '</span><span class="amt">' + inr(x.amount) + '</span></div>').join('') +
            (c.payments.length > 12 ? '<p class="hint">' + tr('Showing the latest 12 of {n}. All of them are in Payments.', { n: c.payments.length }) + '</p>' : '') + '</div>'
          : '');
    });
    const b = pct(w.basics, w.total);
    const totalCh = change(w.total, w.before);
    return '<p class="viz-q">' + tr('Where does my money go?') + '</p>' + seg +
      '<p class="hint">' + span + ' · ' + tr('{amount} spent', { amount: inr(w.total) }) + (totalCh ? ' · ' + totalCh : '') + '</p>' +
      (period === 'this' ? '' : '<p class="hint">' + tr('Budgets here are for {n}.', { n: plural(w.range.rounds, 'round') }) + '</p>') +
      '<div class="viz-split" role="img" aria-label="' + esc(tr('Basics {a}, everything else {b}', { a: inr(w.basics), b: inr(w.other) })) + '">' +
      (w.basics ? '<span class="viz-fill s1" style="flex-grow:' + w.basics + '"' + tipAttrs(tr('Basics: {amount} ({pct}%)', { amount: inr(w.basics), pct: b })) + '></span>' : '') +
      (w.other ? '<span class="viz-fill s4" style="flex-grow:' + w.other + '"' + tipAttrs(tr('Everything else: {amount} ({pct}%)', { amount: inr(w.other), pct: 100 - b })) + '></span>' : '') + '</div>' +
      '<div class="viz-legend"><span><i class="s1"></i>' + tr('Basics {amount} ({pct}%)', { amount: inr(w.basics), pct: b }) + '</span>' +
      '<span><i class="s4"></i>' + tr('Everything else {amount} ({pct}%)', { amount: inr(w.other), pct: 100 - b }) + '</span></div>' +
      '<div class="viz-rows">' + rows.join('') + '</div>' +
      '<div class="viz-legend"><span><i class="s1"></i>' + tr('Spent') + '</span><span><i class="over"></i>' + tr('Over budget') + '</span><span><i class="tick"></i>' + tr('Budget') + '</span></div>' +
      '<p class="hint">' + tr(w.comparable ? 'Tap a category to see its payments. “Before” is the same stretch of time just before.' : 'Tap a category to see its payments.') + '</p>' +
      numbersTable([tr('Category'), tr('Spent'), tr('Budget')], w.categories.map((c) => [esc(label(c.name)), inr(c.spent), c.budget ? inr(c.budget) : '–']));
  }

  // The calendar's shade: the middle one is about your daily amount.
  function heatLevel(amount, daily) {
    if (!amount) return 0;
    const x = daily > 0 ? amount / daily : 1;
    return x < 0.5 ? 1 : x < 1 ? 2 : x < 1.5 ? 3 : x < 2.5 ? 4 : 5;
  }

  function weekdayNames() {
    // 5 Jan 2026 was a Monday.
    return [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2026, 0, 5 + i).toLocaleDateString(I18N.locale(), { weekday: 'short' }));
  }

  // When: this month day by day, and the average for each weekday.
  function vizWhen() {
    const w = Core.spendWhen(state, today());
    const names = weekdayNames();
    const lead = (Core.parseISO(w.cycle.start).getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell blank"></span>');
    w.days.forEach((d) => {
      const tip = fmtDate(d.date) + ': ' + (d.amount ? inr(d.amount) : tr('nothing spent')) + (d.card ? ' · ' + tr('card used') : '');
      cells.push('<button class="cal-cell lvl-' + heatLevel(d.amount, w.daily) + (d.date === today() ? ' today' : '') + '"' + tipAttrs(tip) + '>' +
        Core.parseISO(d.date).getDate() + (d.card ? '<i class="cal-card"></i>' : '') + '</button>');
    });
    const max = Math.max.apply(null, w.weekdays.concat([1]));
    const top = w.weekdays.indexOf(Math.max.apply(null, w.weekdays));
    const bars = w.weekdays.map((v, i) =>
      '<button class="wk-bar"' + tipAttrs(tr('{day}: about {amount} a day', { day: names[i], amount: inr(v) })) + '>' +
      (i === top && v ? '<small>' + inr(v) + '</small>' : '') +
      '<span class="wk-fill s1" style="height:' + Math.max(2, (v / max) * 100).toFixed(1) + '%"></span><span class="wk-name">' + names[i] + '</span></button>');
    const any = w.weekdays.some((v) => v > 0);
    return '<p class="viz-q">' + tr('When do I spend?') + '</p>' +
      '<div class="cal" role="group" aria-label="' + tr('Spending each day this month') + '">' +
      names.map((n) => '<span class="cal-head">' + n + '</span>').join('') + cells.join('') + '</div>' +
      '<div class="viz-legend"><span><i class="lvl-0"></i>' + tr('Nothing spent') + '</span>' +
      '<span class="ramp">' + tr('Less') + ' <i class="lvl-1"></i><i class="lvl-2"></i><i class="lvl-3"></i><i class="lvl-4"></i><i class="lvl-5"></i> ' + tr('More') + '</span>' +
      '<span><i class="cal-card-key"></i>' + tr('Card used') + '</span></div>' +
      '<p class="hint">' + tr('The middle shade is about your daily amount ({amount}).', { amount: inr(w.daily) }) + '</p>' +
      (any
        ? '<p class="viz-q small">' + tr('Your average day, last 3 months') + '</p><div class="wk">' + bars.join('') + '</div>' +
          '<p class="viz-insight">' + tr('You spend most on {day}: about {amount} a day.', { day: names[top], amount: inr(w.weekdays[top]) }) + '</p>'
        : '') +
      numbersTable([tr('Day'), tr('Average a day')], w.weekdays.map((v, i) => [names[i], inr(v)]));
  }

  // Trend: spent, saved and borrowed, month by month.
  function vizTrend() {
    let months = Core.spendTrend(state, today(), 6);
    while (months.length > 1 && !months[0].recorded) months = months.slice(1);
    const max = Math.max.apply(null, months.map((m) => Math.max(m.spent, m.saved, m.borrowed)).concat([1]));
    const step = niceStep(max, 2);
    const top = Math.ceil(max / step) * step;
    const name = (m) => monthName(Core.parseISO(m.start).getMonth());
    const series = [['spent', 's1', 'Spent'], ['saved', 's2', 'Saved'], ['borrowed', 's3', 'Borrowed']];
    const groups = months.map((m) =>
      '<div class="tr-group' + (m.current ? ' current' : '') + '"><div class="tr-bars">' +
      series.map(([k, cls, nm]) => '<button class="tr-bar ' + cls + '" style="height:' + Math.max(m[k] ? 2 : 0, (m[k] / top) * 100).toFixed(1) + '%"' +
        tipAttrs(name(m) + (m.current ? ' (' + tr('so far') + ')' : '') + ': ' + tr(nm) + ' ' + inr(m[k]) + ' · ' + tr('pay {amount}', { amount: inr(m.salary) })) + '></button>').join('') +
      '</div><span class="tr-name">' + name(m) + (m.current ? '*' : '') + '</span></div>');
    const grid = [top, top / 2, 0].map((v) => '<span class="tr-grid" style="bottom:' + ((v / top) * 100).toFixed(1) + '%"><small>' + (v >= 1000 ? '₹' + Math.round(v / 1000) + 'k' : inr(v)) + '</small></span>').join('');
    const full = months.filter((m) => !m.current);
    let insight = '';
    if (full.length >= 2) {
      const a = full[full.length - 2];
      const b = full[full.length - 1];
      const ch = a.spent ? Math.round(((b.spent - a.spent) / a.spent) * 100) : 0;
      insight = tr(ch <= 0 ? '{month} spending was {pct}% lower than the month before.' : '{month} spending was {pct}% higher than the month before.', { month: name(b), pct: Math.abs(ch) });
    }
    const cur = months[months.length - 1];
    return '<p class="viz-q">' + tr('Am I getting better?') + '</p>' +
      '<div class="tr-chart" role="img" aria-label="' + tr('Spent, saved and borrowed each month') + '">' + grid + '<div class="tr-groups">' + groups.join('') + '</div></div>' +
      '<div class="viz-legend"><span><i class="s1"></i>' + tr('Spent') + '</span><span><i class="s2"></i>' + tr('Saved') + '</span><span><i class="s3"></i>' + tr('Borrowed') + '</span></div>' +
      '<p class="hint">' + tr('* This month so far: spent {spent}, saved {saved}, borrowed {borrowed}.', { spent: inr(cur.spent), saved: inr(cur.saved), borrowed: inr(cur.borrowed) }) + '</p>' +
      (insight ? '<p class="viz-insight">' + insight + '</p>' : '') +
      numbersTable([tr('Month'), tr('Spent'), tr('Saved'), tr('Borrowed')], months.map((m) => [name(m) + (m.current ? '*' : ''), inr(m.spent), inr(m.saved), inr(m.borrowed)]));
  }

  // ---------- little leaks ----------

  // Shown with its name in the current language; own leaks as typed.
  function leakLabel(name) { return Core.LEAKS.indexOf(name) !== -1 ? tr(name) : esc(name); }

  function leaksCard() {
    if (!state.settings.salary || state.isDemo) return '';
    const t = today();
    const L = Core.leakSummary(state, t);
    const sugg = Core.leakSuggestions(state, t).slice(0, 3);
    const freedom = (x) => (x > 0 ? ' = ' + tr(x === 1 ? '1 Day of Freedom' : '{n} Days of Freedom', { n: x }) : '');
    let html = '<section class="card leaks-card"><div class="card-head">' + titled('Little leaks', 'leaks') + '</div>';
    if (!L.leaks.length) {
      html += '<p class="hint">' + tr('Small spends that add up: cigarettes, tea, food delivery, betting apps. Tag where you pay for them to see what they cost.') + '</p>';
    } else {
      html += '<p class="leak-total">' + tr('About {amount} a month', { amount: inr(L.perMonth) }) + '<b>' + freedom(L.freedom) + '</b></p>' +
        L.leaks.map((x) => {
          const g = x.goal;
          return '<div class="leak-row"><div class="leak-top"><b>' + leakLabel(x.name) + '</b><span class="amt">' + inr(x.thisRound) + '</span></div>' +
            '<span class="hint">' + tr(x.count === 1 ? '1 payment this round' : '{n} payments this round', { n: x.count }) + ' · ' +
            tr('about {amount} a month', { amount: inr(x.perMonth) }) + freedom(x.freedom) + '</span>' +
            (g
              ? '<div class="leak-goal"><div class="bar"><span class="' + (g.left < 0 ? 'bad' : '') + '" style="width:' + Math.min(100, (x.thisRound / Math.max(1, g.target)) * 100).toFixed(0) + '%"></span></div>' +
                '<span class="hint">' + (g.left >= 0 ? tr('Your challenge: cut {pct}%. {left} left of {target} this round.', { pct: g.pct, left: inr(g.left), target: inr(g.target) })
                  : tr('Your challenge: cut {pct}%. {over} past {target} this round; next round is a fresh try.', { pct: g.pct, over: inr(-g.left), target: inr(g.target) })) + '</span></div>'
              : (x.perMonth > 0 ? '<div><button class="ghost" data-action="leak-goal" data-leak="' + esc(x.name) + '">' + tr('Try cutting it by 20% this round') + '</button></div>' : '')) +
            '</div>';
        }).join('');
    }
    html += sugg.map((x) => '<div class="callout leak-sugg"><b>' + tr('{name} looks like {leak}. Count it as a little leak?', { name: esc(x.name), leak: leakLabel(x.leak).toLowerCase() }) + '</b>' +
      '<span class="hint">' + tr('{amount} in {n} payments over the last two rounds.', { amount: inr(x.total), n: x.count }) + '</span>' +
      '<div class="row"><button class="primary" data-action="leak-yes" data-payee="' + esc(x.payee) + '" data-leak="' + esc(x.leak) + '">' + tr('Yes') + '</button>' +
      '<button class="ghost" data-action="leak-no" data-payee="' + esc(x.payee) + '">' + tr('No') + '</button></div></div>').join('');
    html += ui.leakTag ? leakTagPanel() : '<div><button data-action="leak-tag">' + tr('Tag places') + '</button></div>';
    return html + '</section>';
  }

  // The places paid in the last two rounds, each with a leak to pick (or none).
  function leakTagPanel() {
    const t = today();
    const payday = Number(state.settings.payday) || 1;
    const from = Core.previousCycle(Core.cycleFor(t, payday), payday).start;
    const places = {};
    state.transactions.filter((x) => Core.isFlexible(x) && x.date >= from && x.date <= t).forEach((x) => {
      const key = Core.normalizeMerchant(x.note);
      if (!key) return;
      const p = places[key] || (places[key] = { key, name: x.note, total: 0 });
      p.total += x.amount;
    });
    const list = Object.keys(places).map((k) => places[k]).sort((a, b) => b.total - a.total).slice(0, 15);
    const rules = state.leakRules || {};
    const names = Core.leakNames(state);
    return '<div class="leak-tag"><p class="hint">' + tr('Pick a leak for a place and every payment there counts, now and later. Pick “Not a leak” to undo.') + '</p>' +
      (list.length ? list.map((p) => '<label class="field leak-place" for="leak-' + esc(p.key) + '"><span>' + esc(p.name) + ' · ' + inr(p.total) + '</span>' +
        '<select id="leak-' + esc(p.key) + '" data-leak-payee="' + esc(p.key) + '"><option value="">' + tr('Not a leak') + '</option>' +
        names.map((n) => '<option value="' + esc(n) + '"' + (rules[p.key] === n ? ' selected' : '') + '>' + leakLabel(n) + '</option>').join('') + '</select></label>').join('')
        : '<p class="hint">' + tr('No payments in the last two rounds yet.') + '</p>') +
      '<div class="row"><label class="field grow-field" for="leak-own"><span>' + tr('Your own leak') + '</span><input id="leak-own" type="text" placeholder="' + tr('Paan, gutkha, lottery…') + '"></label>' +
      '<button data-action="leak-own-add">' + tr('Add') + '</button></div>' +
      '<div><button class="primary" data-action="leak-tag">' + tr('Done') + '</button></div></div>';
  }

  function vizCard() {
    if (!state.settings.salary) return '';
    const views = [['where', 'Where'], ['when', 'When'], ['trend', 'Trend']];
    const body = ui.viz === 'when' ? vizWhen() : ui.viz === 'trend' ? vizTrend() : vizWhere();
    return '<section class="card viz-card"><div class="card-head">' + titled('Your spending, 3 ways', 'viz') + '</div>' +
      '<div class="seg viz-seg" role="group" aria-label="' + tr('View') + '">' + views.map(([k, nm]) =>
        '<button data-action="viz-view" data-view="' + k + '" aria-pressed="' + (ui.viz === k) + '">' + tr(nm) + '</button>').join('') + '</div>' +
      body + '<p class="viz-tip" id="viz-tip" aria-live="polite">' + tr('Tap a bar or a day to see its amount.') + '</p></section>';
  }

  function viewSpend() {
    const t = today();
    const cyc = Core.cycleFor(t, Number(state.settings.payday) || 1);
    const list = (ui.txFilter === 'cycle' ? state.transactions.filter((x) => Core.inCycle(x.date, cyc)) : state.transactions.slice())
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const spent = list.filter((x) => Core.isFlexible(x) || Core.isBillPayment(x)).reduce((s, x) => s + x.amount, 0);
    const received = list.filter(Core.isIncome).reduce((s, x) => s + x.amount, 0);
    const moneyIn = ui.txKind === 'in';
    const saving = ui.txKind === 'save';

    const addCard =
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
      (!moneyIn && ((state.cards || []).length || (state.wallets || []).length)
        ? '<label class="field wide" for="tx-from"><span>' + tr('Paid from') + '</span><select id="tx-from">' + fromOptions(null) + '</select></label>' +
          '<p id="tx-from-warn" class="borrow-warn wide" hidden></p>'
        : '') +
      (moneyIn && (state.wallets || []).length
        ? '<label class="field wide" for="tx-into"><span>' + tr('Into') + '</span><select id="tx-into">' + intoOptions(null) + '</select></label>'
        : '') +
      '<div class="wide"><button class="primary" type="submit">' + tr(moneyIn ? 'Add money received' : 'Add payment') + '</button></div>' +
      '</form>') + '</section>';
    const leaks = Core.leakSummary(state, t);
    const leakAsks = Core.leakSuggestions(state, t).length;
    const smsNew = (ui.smsRows || []).filter((x) => x.checked).length;
    return hub('spend',
      sortCard() +
      importCard() +
      needsCheckCard() +
      incomeCard() +
      addCard, [
        { key: 'viz-where', group: 'Your spending', icon: 'where', label: 'Where it went', tone: 'mint', viz: 'where', badge: null, html: () => vizCard() },
        { key: 'viz-when', group: 'Your spending', icon: 'when', label: 'When', tone: 'mint', viz: 'when', badge: null, html: () => vizCard() },
        { key: 'viz-trend', group: 'Your spending', icon: 'trend', label: 'Month by month', tone: 'mint', viz: 'trend', badge: null, html: () => vizCard() },
        { key: 'leaks', group: 'Your spending', icon: 'drop', label: 'Little leaks', tone: 'mint',
          badge: leakAsks ? { text: tr('{n} new', { n: leakAsks }), tone: 'bad' } : leaks.perMonth ? { text: shortInr(leaks.perMonth) } : null, html: () => leaksCard() },
        { key: 'payments', group: 'Records', icon: 'list', label: 'Payments', tone: 'teal', badge: { text: String(list.filter((x) => Core.inCycle(x.date, cyc)).length) },
          html: () => {
            // Money out / in / saved, and search by shop or category.
            const kind = ui.txShow || 'all';
            const q = (ui.txSearch || '').trim().toLowerCase();
            const rows = list.filter((x) => (kind === 'all' ||
              (kind === 'in' && Core.isIncome(x)) || (kind === 'save' && Core.isMove(x)) ||
              (kind === 'out' && !Core.isIncome(x) && !Core.isMove(x))) &&
              (!q || (String(x.note || '') + ' ' + label(x.category || '')).toLowerCase().indexOf(q) !== -1));
            const show = rows.slice(0, 200);
            return '<section class="card payments-card"><div class="card-head">' + titled('Payments', 'payments') +
              '<div class="seg" role="group" aria-label="' + tr('Show') + '"><button data-action="tx-filter" data-filter="cycle" aria-pressed="' + (ui.txFilter === 'cycle') + '">' + tr('This cycle') + '</button>' +
              '<button data-action="tx-filter" data-filter="all" aria-pressed="' + (ui.txFilter === 'all') + '">' + tr('All') + '</button></div></div>' +
              '<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' +
              '<input id="tx-search" type="search" placeholder="' + tr('Search payments…') + '" value="' + esc(ui.txSearch || '') + '" aria-label="' + tr('Search payments…') + '"></label>' +
              '<div class="pills" role="group" aria-label="' + tr('Type') + '">' + [['all', 'All'], ['out', 'Money out'], ['in', 'Money in'], ['save', 'Saved']].map((k) =>
                '<button class="pill" data-action="tx-show" data-show="' + k[0] + '" aria-pressed="' + (kind === k[0]) + '">' + tr(k[1]) + '</button>').join('') + '</div>' +
              '<p class="hint">' + tr('{amount} spent', { amount: inr(spent) }) + (received ? ' · <span class="good">' + tr('{amount} received', { amount: inr(received) }) + '</span>' : '') + '</p>' +
              (show.length ? '<div class="tx-list">' + show.map((x) => txRow(x, true)).join('') + '</div>' +
                (rows.length > show.length ? '<p class="hint">' + tr('Showing the latest 200.') + '</p>' : '')
                : '<p class="hint">' + tr(q ? 'No payments match.' : 'No payments yet.') + '</p>') +
              '</section>';
          } },
        { key: 'calendar', group: 'Records', icon: 'upcoming', label: 'Calendar', tone: 'teal', badge: null, html: () => calendarCard() },
        { key: 'bills', group: 'Records', icon: 'bill', label: 'Bills to pay', tone: 'teal',
          badge: (() => { const n = (state.bills || []).filter((b) => (Number(b.estimate) || 0) > 0 && Core.billDue(b, cyc) && !Core.billPaidIn(state, b, cyc)).length; return n ? { text: tr('{n} due', { n }), tone: 'bad' } : { text: '✓', tone: 'good' }; })(),
          html: () => billsCard() || '<section class="card"><h2>' + tr('Bills to pay') + '</h2><p class="hint">' + tr('No bills due before payday.') + '</p></section>' },
        { key: 'sms', group: 'Records', icon: 'sms', label: 'Bank SMS', tone: 'teal',
          badge: smsNew ? { text: String(smsNew), tone: 'bad' } : state.smsAuto ? { text: tr('Auto'), tone: 'good' } : null,
          html: () => importCard() +
      (NATIVE
        ? '<section class="card"><div class="card-head">' + titled('Bank SMS', 'sms') + (state.smsAuto ? modeChip(true) : '') + '</div>' +
          (state.smsAuto ? '' : '<p class="hint">' + tr('Record payments from your bank and UPI messages. Read on this phone only.') + '</p>') +
          '<div class="row"><button class="primary" data-action="sms-native"' + (ui.smsBusy ? ' disabled' : '') + '>' +
          tr(ui.smsBusy ? 'Reading…' : state.smsAuto ? 'Check for new messages' : 'Read bank SMS') + '</button>' +
          ((state.sortQueue || []).length || ui.importAsk || ui.importFound ? '' : '<button class="ghost" data-action="import-open">' + tr('Import past payments') + '</button>') + '</div>' +
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
          '</section>') },
      ]);
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
        const note = r.duplicate ? tr('Already added') : r.match ? tr('Matches your entry: {note}, {date}', { note: esc(r.match.note || label(r.match.category || '')), date: fmtDate(r.match.date) }) : isIn && p.salary ? tr('Looks like your salary, which is already counted') : smsNote(p) || (isIn ? tr('Money in') : '');
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
    const rows = smsRowsOf(messages, known);
    // Bank messages the app couldn't read, with every digit hidden: enough to see the wording that needs teaching.
    const unread = rows.filter((x) => !x.parsed);
    logEvent('sms', { messages: rows.length, read: rows.length - unread.length, duplicates: rows.filter((x) => x.duplicate).length,
      unread: lockCfg().on ? undefined : unread.slice(0, 20).map((x) => String(x.text).replace(/\d/g, '9').slice(0, 240)) });
    return rows;
  }

  function smsRowsOf(messages, known) {
    return messages.map(({ text, day }) => {
      const parsed = Core.parseSms(text, state.merchantRules, day);
      const key = Core.smsKey(text);
      if (parsed && parsed.type === 'credit' && parsed.salary) noteSalary(parsed);
      const duplicate = !!parsed && (known.has(key) || state.transactions.some((x) => !x.kind && (
        x.date === parsed.date && x.amount === parsed.amount &&
        Core.normalizeMerchant(x.note) === Core.normalizeMerchant(parsed.merchant))));
      const unknownCard = !!parsed && (parsed.type === 'statement' || parsed.type === 'cardpayment') && !findCard(parsed.last4);
      const match = parsed && !duplicate ? manualTwin(parsed) : null;
      return { text, key, parsed, duplicate, match, checked: !!parsed && !duplicate && !parsed.salary && !unknownCard };
    });
  }

  /*
   * An entry typed by hand (or from the widget) that this bank SMS is about:
   * the same amount, within 3 days, money in for money in and spending for
   * spending, not already tied to an SMS. Like matching an import to a
   * typed entry: the SMS is linked to it instead of counted again.
   */
  function manualTwin(p) {
    if (!p || (p.type !== 'debit' && p.type !== 'credit')) return null;
    const shop = Core.normalizeMerchant(p.merchant);
    const hits = state.transactions.filter((x) => !x.smsKey && x.source !== 'sms' && x.source !== 'import' && x.source !== 'reconcile' &&
      Number(x.amount) === p.amount && Math.abs(Core.daysBetween(x.date, p.date)) <= 3 &&
      (p.type === 'credit' ? Core.isIncome(x) : Core.isFlexible(x)));
    if (!hits.length) return null;
    // Same place: the closest one. Otherwise only one clear candidate, and not a small everyday amount (two ₹100 teas are two payments).
    const named = hits.filter((x) => shop && Core.normalizeMerchant(x.note) === shop);
    const pool = named.length ? named : hits.length === 1 && p.amount >= 200 ? hits : [];
    return pool.sort((a, b) => Math.abs(Core.daysBetween(a.date, p.date)) - Math.abs(Core.daysBetween(b.date, p.date)))[0] || null;
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
    const fromWallet = paidFrom === 'account' ? walletForAcct(p.acct) : null;
    // With a Cash wallet, cash from an ATM is moved, not spent: what's spent in cash is noted from the wallet.
    if (p.type === 'debit' && p.atm && paidFrom === 'account' && cashWallet() && (o.category || p.category) === 'Cash') {
      state.transactions.push({ id: uid(), kind: 'transfer', date: p.date, amount: p.amount, from: fromWallet ? fromWallet.id : 'main', to: cashWallet().id,
        note: tr('ATM withdrawal'), source: o.source || 'sms', smsKey: o.key });
      return true;
    }
    // Already typed in by hand? Link the SMS to that entry; the person's category and note stay.
    const mine = manualTwin(p);
    if (mine) {
      mine.smsKey = o.key;
      // Kept so "Not the same payment" can add the SMS as its own entry.
      mine.matched = { date: p.date, merchant: p.merchant, category: o.category || p.category, type: p.type, paidFrom: paidFrom === 'account' ? null : paidFrom, wallet: fromWallet ? fromWallet.id : null };
      if (paidFrom !== 'account' && paidFrom.indexOf('card:') !== 0 && !mine.paidFrom && !mine.wallet) mine.paidFrom = paidFrom;
      else if (fromWallet && !mine.paidFrom && !mine.wallet) mine.wallet = fromWallet.id;
      return true;
    }
    const tx = { id: uid(), date: p.date, amount: p.amount, category: o.category || p.category, note: o.note || p.merchant, source: 'sms', smsKey: o.key };
    if (paidFrom !== 'account') tx.paidFrom = paidFrom;
    else if (fromWallet) tx.wallet = fromWallet.id;
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
    } else if (!o.noLearn) {
      const shop = Core.normalizeMerchant(tx.note);
      if (shop && tx.note !== 'Bank payment') state.merchantRules[shop] = tx.category;
    }
    if (o.source) tx.source = o.source;
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
    let value = list === 'budgets' && field === 'name' ? label(item[field]) : item[field];
    // An empty number box, not a 0 to delete first: typing 14 next to a 0 made 140.
    const blank = type === 'number' && !Number(value);
    if (blank) value = '';
    return '<label class="field" for="' + id + '"><span>' + tr(name) + '</span><input id="' + id + '" type="' + type + '"' +
      (type === 'number' ? ' inputmode="numeric" min="0" step="any"' + (blank && !/placeholder=/.test(extra || '') ? ' placeholder="0"' : '') : '') +
      ' data-list="' + list + '" data-id="' + esc(item.id) + '" data-field="' + field + '" value="' + esc(value) + '"' + (extra || '') + '></label>';
  }

  function removeButton(list, item) {
    return '<button class="icon" data-action="list-remove" data-list="' + list + '" data-id="' + esc(item.id) + '" aria-label="' + esc(tr('Remove {name}', { name: item.name ? label(item.name) : tr('row') })) + '">✕</button>';
  }

  // "Last round ₹6,200 · Average ₹5,600": tap one to use it as this budget.
  function quickBudget(b, h) {
    const chip = (text, v) => '<button class="chip-btn' + (v === b.amount ? ' on' : '') + '" data-action="budget-use" data-id="' + esc(b.id) + '" data-amount="' + v + '">' + text + '</button>';
    return '<div class="quick-budget">' + chip(tr('Last round {amount}', { amount: inr(h.last) }), h.last) +
      (h.rounds > 1 ? chip(tr('Average of {n} rounds {amount}', { n: h.rounds, amount: inr(h.avg) }), h.avg) : '') + '</div>';
  }

  function viewPlan() {
    const s = state.settings;
    const budgetHist = Core.budgetHistory(state, today());
    const plan = Core.monthlyPlan(state, today());
    const alloc = Core.allocate(state, today());
    const sv = alloc.savings;
    const ro = alloc.rollover;
    const rolls = state.savings.rollovers || [];
    const edited = alloc.budgets.some((b) => !b.auto);
    const salaryCard =
      '<section class="card">' + titled('Salary', 'salary') + '<div class="form-grid">' +
      numInput('salary', 'settings.salary', s.salary || '', 'Monthly salary in hand (₹)') +
      numInput('payday', 'settings.payday', s.payday, 'Payday (day of month)', ' max="31"') +
      '<label class="field wide" for="plan-balance"><span>' + tr((state.wallets || []).length ? 'All your money this morning, every wallet together (₹)' : 'Money in your account this morning (₹)') + '</span><input id="plan-balance" type="number" inputmode="numeric" min="0" step="1" data-balance="1" value="' +
        esc(state.balanceCheck && state.balanceCheck.date === today() ? state.balanceCheck.amount : '') + '" placeholder="' +
        (state.balanceCheck ? tr('Last entered {date}: {amount}', { date: fmtDate(state.balanceCheck.date), amount: inr(state.balanceCheck.amount) }) : tr('Optional')) + '"></label>' +
      '</div>' +
      thisMonthPay() + payHistory() + '</section>';
    const sharedOut = Math.max(0, alloc.pool);
    const lastBackup = state.lastBackup;
    return hub('plan',
      staleRolloverNote() + rolloverCard() +
      (state.onboarding && ui.onboardHidden ? '<div class="callout"><b>' + tr('Finish setting up · step {step} of {total}', { step: state.onboarding.step, total: ONBOARD_STEPS }) + '</b>' +
        '<div><button class="primary" data-action="onboard-resume">' + tr('Continue') + '</button></div></div>' : '') +
      (s.salary ? '' : '<div class="callout"><b>' + tr('Start here.') + '</b><span class="hint">' + tr('Enter your salary and payday, then your fixed payments. Everything else can come later.') + '</span></div>') +
      (s.salary ? '' : salaryCard) +
      (ui.paydayOpen ? paydayCard() : '') +
      '<section class="card" id="plan-summary">' + planSummary() + '</section>', [
        { key: 'salary', group: 'Your money', icon: 'rupee', label: 'Salary', tone: 'mint', hide: !s.salary, badge: { text: shortInr(s.salary) }, html: () => salaryCard },
        { key: 'wallets', group: 'Your money', icon: 'wallet', label: 'Wallets', tone: 'mint', badge: (state.wallets || []).length ? { text: String((state.wallets || []).length + 1) } : null, html: () => walletsCard() },
        { key: 'fixed', group: 'Your money', icon: 'repeat', label: 'Fixed payments', tone: 'mint', badge: plan.fixedTotal ? { text: shortInr(plan.fixedTotal) } : null, html: () =>
      '<section class="card"><div class="card-head">' + titled('Fixed payments', 'fixed') + '<span class="hint">' + tr('Rent, EMIs, subscriptions') + '</span></div>' +
      '<div class="edit-rows">' + state.fixed.map((f) =>
        '<div class="edit-row">' + listField('fixed', f, 'name', 'Name', 'text') + listField('fixed', f, 'amount', 'Amount (₹)', 'number') +
        listField('fixed', f, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('fixed', f) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="fixed">' + tr('Add fixed payment') + '</button></div></section>' },
        { key: 'bills', group: 'Your money', icon: 'bolt', label: 'Bills that vary', tone: 'mint', badge: (state.bills || []).length ? { text: String(state.bills.length) } : null, html: () =>
      '<section class="card"><div class="card-head">' + titled('Bills that vary', 'bills') + '<span class="hint">' + tr('Electricity, gas, water, recharges') + '</span></div>' +
      '<div class="edit-rows">' + (state.bills || []).map((b) =>
        '<div class="edit-row cols-bill">' + listField('bills', b, 'name', 'Name', 'text') + listField('bills', b, 'estimate', 'About (₹)', 'number') +
        '<label class="field" for="bills-' + esc(b.id) + '-every"><span>' + tr('Paid every') + '</span><select id="bills-' + esc(b.id) + '-every" data-list="bills" data-id="' + esc(b.id) + '" data-field="everyMonths">' + periodOptions(b.everyMonths) + '</select></label>' +
        listField('bills', b, 'nextDue', 'Next due', 'date') + removeButton('bills', b) + '</div>').join('') + '</div>' +
      '<div class="row"><button data-action="list-add" data-list="bills">' + tr('Add bill') + '</button>' +
      (state.fixed.length
        ? '<select id="fixed-to-bill" aria-label="' + tr('Fixed payment to move') + '">' + state.fixed.map((f) => '<option value="' + esc(f.id) + '">' + esc(f.name || tr('Unnamed')) + '</option>').join('') + '</select>' +
          '<button class="ghost" data-action="fixed-to-bill">' + tr('Move from fixed payments') + '</button>'
        : '') + '</div></section>' },
        { key: 'yearly', group: 'Your money', icon: 'yearly', label: 'Yearly costs', tone: 'mint', badge: plan.sinking ? { text: tr('{amount}/mo', { amount: shortInr(plan.sinking) }) } : null, html: () =>
      '<section class="card"><div class="card-head">' + titled('Yearly costs', 'yearly') + '<span class="hint">' + tr('Festivals, insurance, servicing, school fees') + '</span></div>' +
      '<div class="edit-rows">' + state.sinking.map((f) =>
        '<div class="edit-row">' + listField('sinking', f, 'name', 'Name', 'text') + listField('sinking', f, 'amount', 'Per year (₹)', 'number') +
        '<label class="field" for="sinking-' + esc(f.id) + '-month"><span>' + tr('Month') + '</span><select id="sinking-' + esc(f.id) + '-month" data-list="sinking" data-id="' + esc(f.id) + '" data-field="month">' +
        MONTH_NAMES.map((m, i) => '<option value="' + (i + 1) + '"' + (Number(f.month) === i + 1 ? ' selected' : '') + '>' + monthName(i) + '</option>').join('') + '</select></label>' +
        removeButton('sinking', f) + '</div>').join('') + '</div>' +
      '<div><button data-action="list-add" data-list="sinking">' + tr('Add yearly cost') + '</button></div></section>' },
        { key: 'setaside', group: 'Your plan', icon: 'shield', label: 'Set aside', tone: 'amber', badge: plan.savingsTotal ? { text: shortInr(plan.savingsTotal) } : null, html: () =>
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
        : '<div class="row"><span class="hint">' + tr('You set these amounts.') + '</span><button class="ghost" data-action="savings-auto">' + tr('Work them out for me') + '</button></div>') + '</section>' },
        { key: 'budgets', group: 'Your plan', icon: 'sliders', label: 'Flexible budgets', tone: 'amber', badge: { text: shortInr(sharedOut) }, html: () =>
      '<section class="card"><div class="card-head">' + titled('Flexible budgets', 'flex') + '<span class="hint">' + tr('{amount} to spend this month', { amount: inr(Math.max(0, alloc.pool)) }) + '</span></div>' +
      '<div class="edit-rows">' + alloc.budgets.map((b) => {
        const item = state.budgets.find((x) => x.id === b.id);
        const hist = budgetHist;
        return '<div class="edit-row cols-2">' + listField('budgets', item, 'name', 'Category', 'text') +
          listField('budgets', Object.assign({}, item, { amount: b.amount }), 'amount', b.auto ? tr('Auto · {pct}%', { pct: b.share }) : 'Set by you', 'number', b.auto ? ' class="auto"' : '') +
          removeButton('budgets', item) +
          (hist[b.name] ? quickBudget(b, hist[b.name]) : '') +
          '<label class="check carry-check"><input type="checkbox" data-carry="' + esc(b.id) + '"' + (item.carry ? ' checked' : '') + '> ' + tr('Keep what’s left for next month') + '</label></div>';
      }).join('') + '</div>' +
      (Object.keys(budgetHist).length
        ? '<div class="row quick-all"><button class="ghost small" data-action="budget-all" data-use="last">' + tr('Set all to last round’s spending') + '</button>' +
          '<button class="ghost small" data-action="budget-all" data-use="avg">' + tr('Set all to the average') + '</button></div>'
        : '') +
      (alloc.budgets.length && alloc.autoPool === 0 && alloc.budgets.some((b) => b.auto) && alloc.pool > 0
        ? '<p class="hint warn">' + tr('Your own amounts use all of the money left, so the automatic budgets are at ₹0.') + '</p>' : '') +
      '<div class="row"><button data-action="list-add" data-list="budgets">' + tr('Add category') + '</button>' +
      (edited ? '<button class="ghost" data-action="budgets-auto">' + tr('Share everything out automatically') + '</button>' : '') + '</div></section>' },
      ]);
  }

  // ---------- wallets: where the money sits ----------

  const WALLET_KINDS = [['bank', 'Bank account'], ['cash', 'Cash'], ['upi', 'UPI wallet (Paytm, Amazon Pay…)']];

  function mainWalletName() {
    return state.settings.mainWallet || tr('Main bank account');
  }

  function walletName(id) {
    if (!id || id === 'main') return mainWalletName();
    const w = (state.wallets || []).find((x) => x.id === id);
    return w ? w.name : mainWalletName();
  }

  // The bank wallet an SMS came from, by the account's last digits (a/c XX1234).
  function walletForAcct(acct) {
    if (!acct) return null;
    return (state.wallets || []).find((w) => w.kind === 'bank' && w.last4 && acct.slice(-w.last4.length) === w.last4) || null;
  }

  function cashWallet() {
    return (state.wallets || []).find((w) => w.kind === 'cash') || null;
  }

  // "Paid from" choices: the main account, each wallet, then each credit card.
  function fromOptions(x) {
    const cur = x && x.paidFrom && x.paidFrom !== 'account' ? x.paidFrom : x && x.wallet ? 'w:' + x.wallet : 'account';
    return '<option value="account"' + (cur === 'account' ? ' selected' : '') + '>' + esc(mainWalletName()) + '</option>' +
      (state.wallets || []).map((w) => '<option value="w:' + esc(w.id) + '"' + (cur === 'w:' + w.id ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') +
      (state.cards || []).map((c) => '<option value="' + esc(c.id) + '"' + (cur === c.id ? ' selected' : '') + '>' + cardLabel(c) + ' ' +
        tr('(credit card: free only if the whole bill is paid on time)') + '</option>').join('');
  }

  function intoOptions(x) {
    const cur = x && x.wallet ? x.wallet : '';
    return '<option value="account"' + (!cur ? ' selected' : '') + '>' + esc(mainWalletName()) + '</option>' +
      (state.wallets || []).map((w) => '<option value="w:' + esc(w.id) + '"' + (cur === w.id ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('');
  }

  // Applies a "paid from" or "into" choice to a payment.
  function setFrom(x, v) {
    delete x.paidFrom;
    delete x.wallet;
    if (!v || v === 'account') return;
    if (v.indexOf('w:') === 0) x.wallet = v.slice(2);
    else x.paidFrom = v;
  }

  function walletsCard() {
    const t = today();
    const r = Core.projectRunway(state, t);
    const wb = Core.walletBalances(state, t, r.balanceToday);
    const morning = Core.walletBalances(state, t, r.limit.money, true);
    const ws = state.wallets || [];
    const row = (id, name, kind, last4, bal) => '<div class="tx-row"><span class="cat-icon c-' + (kind === 'cash' ? 'grey' : kind === 'upi' ? 'violet' : 'blue') + '">' +
      '<svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + CAT_GLYPHS[kind === 'cash' ? 'cash' : kind === 'upi' ? 'card' : 'bank'] + '</svg></span>' +
      '<div class="tx-main"><div class="tx-title">' + esc(name) + '</div><div class="tx-sub">' + tr(kind === 'cash' ? 'Cash' : kind === 'upi' ? 'UPI wallet' : 'Bank account') + (last4 ? ' · a/c …' + esc(last4) : '') + '</div></div>' +
      '<div class="tx-side"><span class="tx-amt' + (bal < 0 ? ' bad-text' : '') + '">' + inr(bal) + '</span>' +
      (id !== 'main' ? '<button class="icon tx-del" data-action="wallet-remove" data-id="' + esc(id) + '" aria-label="' + tr('Remove') + '">✕</button>' : '') + '</div></div>';
    const f = ui.walletForm;
    const m = ui.moveForm;
    const b = ui.walletBalances;
    return '<section class="card wallets-card"><div class="card-head">' + titled('Wallets', 'wallets') + '<span class="hint">' + tr('Total {amount}', { amount: inr(r.balanceToday) }) + '</span></div>' +
      '<div class="tx-list">' + row('main', mainWalletName(), 'bank', state.settings.mainLast4 || '', wb.main) +
      wb.wallets.map((w) => row(w.id, w.name, w.kind, w.last4, w.balance)).join('') + '</div>' +
      reconcileCard() +
      (cashWallet() ? '<p class="hint">' + tr('Cash is tracked: an ATM withdrawal moves money into Cash, and what you note as spent in cash comes out of it.') + '</p>'
        : '<p class="hint">' + tr('No Cash wallet, so an ATM withdrawal counts as spent. Add a Cash wallet if you note what you spend in cash.') + '</p>') +
      // Balances this morning, one per wallet: they add up to the total the runway starts from.
      (b
        ? '<form id="wallet-balance-form" class="callout" autocomplete="off"><b>' + tr('Balances this morning') + '</b><span class="hint">' + tr('From your bank app and your purse, as they were at the start of today.') + '</span>' +
          '<div class="form-grid">' + '<label class="field" for="wb-main"><span>' + esc(mainWalletName()) + '</span><input id="wb-main" type="number" inputmode="numeric" min="0" step="1" value="' + Math.max(0, morning.main) + '"></label>' +
          morning.wallets.map((w) => '<label class="field" for="wb-' + esc(w.id) + '"><span>' + esc(w.name) + '</span><input id="wb-' + esc(w.id) + '" data-wb="' + esc(w.id) + '" type="number" inputmode="numeric" min="0" step="1" value="' + Math.max(0, w.balance) + '"></label>').join('') +
          '</div><div class="row"><button class="primary" type="submit">' + tr('Save balances') + '</button><button type="button" class="ghost" data-action="wallet-balance-cancel">' + tr('Cancel') + '</button></div></form>'
        : '') +
      (f
        ? '<form id="wallet-form" class="callout" autocomplete="off"><b>' + tr('Add a wallet') + '</b><div class="form-grid">' +
          '<label class="field" for="wf-kind"><span>' + tr('Type') + '</span><select id="wf-kind">' + WALLET_KINDS.map((k) => '<option value="' + k[0] + '">' + tr(k[1]) + '</option>').join('') + '</select></label>' +
          '<label class="field" for="wf-name"><span>' + tr('Name') + '</span><input id="wf-name" type="text" required placeholder="' + tr('HDFC, Cash, Paytm') + '"></label>' +
          '<label class="field" for="wf-last4"><span>' + tr('Last 4 digits of the account (for bank SMS)') + '</span><input id="wf-last4" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{3,4}" placeholder="1234"></label>' +
          '<label class="field" for="wf-amount"><span>' + tr('Money in it this morning (₹)') + '</span><input id="wf-amount" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></label>' +
          '</div>' + (f.error ? '<p class="bad" role="alert">' + f.error + '</p>' : '') +
          '<div class="row"><button class="primary" type="submit">' + tr('Add wallet') + '</button><button type="button" class="ghost" data-action="wallet-form-cancel">' + tr('Cancel') + '</button></div></form>'
        : '') +
      (m
        ? '<form id="move-form" class="callout" autocomplete="off"><b>' + tr('Move money between wallets') + '</b><div class="form-grid">' +
          '<label class="field" for="mv-from"><span>' + tr('From') + '</span><select id="mv-from">' + intoOptions(null) + '</select></label>' +
          '<label class="field" for="mv-to"><span>' + tr('To') + '</span><select id="mv-to">' + intoOptions({ wallet: (cashWallet() || ws[0] || {}).id }) + '</select></label>' +
          '<label class="field" for="mv-amount"><span>' + tr('Amount (₹)') + '</span><input id="mv-amount" type="number" inputmode="numeric" min="1" step="1" required></label>' +
          '<label class="field" for="mv-date"><span>' + tr('Date') + '</span><input id="mv-date" type="date" max="' + t + '" value="' + t + '"></label>' +
          '</div>' + (m.error ? '<p class="bad" role="alert">' + m.error + '</p>' : '') +
          '<div class="row"><button class="primary" type="submit">' + tr('Move money') + '</button><button type="button" class="ghost" data-action="move-form-cancel">' + tr('Cancel') + '</button></div></form>'
        : '') +
      (b || f || m ? '' : '<div class="row"><button class="primary" data-action="wallet-add">' + tr('Add a wallet') + '</button>' +
        (ws.length ? '<button data-action="move-open">' + tr('Move money') + '</button><button data-action="wallet-balance-open">' + tr('Update balances') + '</button>' : '') + '</div>') +
      '</section>';
  }

  function addWallet(ev) {
    ev.preventDefault();
    const kind = document.getElementById('wf-kind').value;
    const name = document.getElementById('wf-name').value.trim().slice(0, 30);
    const last4 = (document.getElementById('wf-last4').value || '').replace(/\D/g, '').slice(-4);
    const amount = Math.max(0, Math.round(Number(document.getElementById('wf-amount').value) || 0));
    if (!name) { ui.walletForm = { error: tr('Give it a name.') }; render(); return; }
    if (kind === 'cash' && cashWallet()) { ui.walletForm = { error: tr('There’s already a Cash wallet.') }; render(); return; }
    const before = JSON.stringify(state);
    const t = today();
    state.wallets = (state.wallets || []).concat({ id: uid(), name, kind, last4: kind === 'bank' ? last4 : '', created: t, check: { date: t, amount } });
    // Money that was already in it is part of the total too.
    if (amount > 0) {
      const r = Core.projectRunway(state, t);
      state.balanceCheck = { date: t, amount: Math.round(r.limit.money + amount) };
    }
    ui.walletForm = null;
    save();
    rerenderKeepScroll();
    offerUndo(tr('{name} added', { name }), before);
  }

  function moveMoney(ev) {
    ev.preventDefault();
    const from = document.getElementById('mv-from').value;
    const to = document.getElementById('mv-to').value;
    const amount = Math.round(Number(document.getElementById('mv-amount').value) || 0);
    const date = document.getElementById('mv-date').value || today();
    if (from === to) { ui.moveForm = { error: tr('Pick two different wallets.') }; render(); return; }
    if (!(amount > 0)) { ui.moveForm = { error: tr('Enter an amount above ₹0.') }; render(); return; }
    const id = (v) => (v === 'account' ? 'main' : v.slice(2));
    const before = JSON.stringify(state);
    state.transactions.push({ id: uid(), kind: 'transfer', date, amount, from: id(from), to: id(to), note: tr('Moved money'), source: 'manual' });
    ui.moveForm = null;
    save();
    rerenderKeepScroll();
    offerUndo(tr('{amount} moved', { amount: inr(amount) }), before);
  }

  // Balances this morning for every wallet; together they are the total the runway starts from.
  function saveWalletBalances(ev) {
    ev.preventDefault();
    const t = today();
    const exp = expectedMorning();
    const main = Math.max(0, Math.round(Number(document.getElementById('wb-main').value) || 0));
    let total = main;
    (state.wallets || []).forEach((w) => {
      const el = document.getElementById('wb-' + w.id);
      const v = Math.max(0, Math.round(Number(el && el.value) || 0));
      w.check = { date: t, amount: v };
      total += v;
    });
    state.balanceCheck = { date: t, amount: total };
    reconcileAfter(exp, total);
    ui.walletBalances = false;
    save();
    if (!ui.reconcile || ui.reconcile.ok) toast(tr('Balances saved'));
    rerenderKeepScroll();
  }

  // ---------- split one payment into parts ----------

  function splitEditor(x) {
    const s = ui.split;
    const parts = s.parts;
    const used = parts.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const left = x.amount - used;
    return '<div class="split-box"><b>' + tr('Split {amount} into parts', { amount: inr(x.amount) }) + '</b>' +
      parts.map((p, i) => '<div class="split-row"><select data-split-cat="' + i + '" aria-label="' + tr('Category') + '">' + categoryOptions(p.category) + '</select>' +
        '<input data-split-amt="' + i + '" type="number" inputmode="numeric" min="0" step="1" value="' + esc(p.amount) + '" aria-label="' + tr('Amount (₹)') + '">' +
        (parts.length > 2 ? '<button class="icon tx-del" data-action="split-remove" data-i="' + i + '" aria-label="' + tr('Remove') + '">✕</button>' : '') + '</div>').join('') +
      '<div class="row"><button class="ghost" data-action="split-add">' + tr('Add a part') + '</button>' +
      '<span class="hint ' + (left === 0 ? 'good' : 'bad') + '">' + (left === 0 ? tr('Adds up ✓') : left > 0 ? tr('{amount} still to share out', { amount: inr(left) }) : tr('{amount} too much', { amount: inr(-left) })) + '</span></div>' +
      '<div class="row"><button class="primary" data-action="split-save"' + (left === 0 ? '' : ' disabled') + '>' + tr('Save the split') + '</button><button class="ghost" data-action="split-cancel">' + tr('Cancel') + '</button></div></div>';
  }

  // Each part becomes its own payment, linked by splitOf, so every budget, chart and leak counts it as it is.
  function saveSplit() {
    const x = state.transactions.find((t) => t.id === ui.editTx);
    if (!x) return;
    const parts = ui.split.parts.filter((p) => Number(p.amount) > 0);
    if (parts.reduce((a, p) => a + Number(p.amount), 0) !== x.amount || parts.length < 2) return;
    const before = JSON.stringify(state);
    const group = x.splitOf || x.id;
    x.splitOf = group;
    x.amount = Math.round(Number(parts[0].amount));
    x.category = parts[0].category;
    parts.slice(1).forEach((p) => {
      const part = { id: uid(), date: x.date, amount: Math.round(Number(p.amount)), category: p.category, note: x.note, source: x.source || 'manual', splitOf: group };
      if (x.paidFrom) part.paidFrom = x.paidFrom;
      if (x.wallet) part.wallet = x.wallet;
      state.transactions.push(part);
    });
    x.needsReview = false;
    ui.split = null; ui.editTx = null;
    save();
    rerenderKeepScroll();
    offerUndo(tr('Split into {n} parts', { n: parts.length }), before);
  }

  // ---------- edit a payment, and undo ----------

  // Bill and card payments are tied to the bill's learned amount or the card's statement: only their note can change.
  function txLocked(x) {
    return Core.isBillPayment(x) || Core.isCardTransfer(x);
  }

  function editModal() {
    const x = ui.editTx && state.transactions.find((t) => t.id === ui.editTx);
    if (!x) return '';
    const t = today();
    const isIn = Core.isIncome(x);
    const saved = Core.isMove(x);
    const locked = txLocked(x);
    const flex = !isIn && !saved && !locked && !Core.isTransfer(x);
    const field = (id, labelText, input) => '<label class="field" for="' + id + '"><span>' + tr(labelText) + '</span>' + input + '</label>';
    return '<div class="reset-modal-overlay edit-overlay" role="presentation"><div class="reset-modal-card edit-card" role="dialog" aria-modal="true" aria-labelledby="edit-title" id="edit-card" tabindex="-1">' +
      '<div class="edit-head">' + catIcon(x) + '<h2 id="edit-title">' + tr(isIn ? 'Edit money received' : saved ? 'Edit money saved' : Core.isTransfer(x) ? 'Edit money moved' : 'Edit payment') + '</h2></div>' +
      (Core.isTransfer(x) ? '<p class="hint">' + esc(walletName(x.from)) + ' → ' + esc(walletName(x.to)) + '</p>' : '') +
      (x.matched ? '<div class="callout"><span class="hint">' + tr('Linked to a bank SMS: {merchant}, {date}.', { merchant: esc(x.matched.merchant || ''), date: fmtDate(x.matched.date) }) + '</span>' +
        '<div><button class="ghost small" data-action="tx-unlink">' + tr('Not the same payment') + '</button></div></div>' : '') +
      (state.reconciledTo && x.date <= state.reconciledTo ? '<p class="hint">' + tr('Checked against your bank on {date}. Changing it makes the app’s count differ from your bank’s.', { date: fmtDate(Core.addDays(state.reconciledTo, 1)) }) + '</p>' : '') +
      (locked ? '<p class="hint">' + tr(x.kind === 'cardpay'
        ? 'A card bill payment: its amount is tied to the bill. You can change the date the money left your account.'
        : 'This is a bill or card payment, so its amount and date are tied to the bill. To change them, delete it and record it again.') + '</p>' : '') +
      '<div class="form-grid">' +
      // A card bill payment keeps its amount, but its date can be put right (the day the money really left).
      (locked && x.kind === 'cardpay' ? field('edit-date', 'Paid on', '<input id="edit-date" type="date" max="' + t + '" value="' + esc(x.date) + '">') : '') +
      (locked ? '' : field('edit-amount', 'Amount (₹)', '<input id="edit-amount" type="number" inputmode="decimal" min="1" step="1" value="' + esc(x.amount) + '">') +
        field('edit-date', 'Date', '<input id="edit-date" type="date" max="' + t + '" value="' + esc(x.date) + '">')) +
      field('edit-note', isIn ? 'From' : 'Where / what', '<input id="edit-note" type="text" value="' + esc(x.note || '') + '">') +
      (flex || isIn ? field('edit-cat', 'Category', '<select id="edit-cat">' + (isIn ? incomeCategoryOptions(x.category) : categoryOptions(x.category)) + '</select>') : '') +
      (flex && ((state.cards || []).length || (state.wallets || []).length) ? '<label class="field wide" for="edit-from"><span>' + tr('Paid from') + '</span><select id="edit-from">' + fromOptions(x) + '</select></label>' : '') +
      ((isIn || saved) && (state.wallets || []).length ? '<label class="field wide" for="edit-from"><span>' + tr(isIn ? 'Into' : 'From') + '</span><select id="edit-from">' + intoOptions(x) + '</select></label>' : '') +
      '</div>' +
      (flex && ui.split && ui.split.id === x.id ? splitEditor(x) : flex ? '<button class="link" data-action="split-open">' + tr('Split this payment into categories') + '</button>' : '') +
      (ui.editError ? '<p class="bad" role="alert">' + ui.editError + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="edit-save">' + tr('Save changes') + '</button><button class="ghost" data-action="edit-cancel">' + tr('Cancel') + '</button></div>' +
      '</div></div>';
  }

  // Applies the edit and keeps everything tied to the payment right: a fund or loan it went to, money taken from the fund.
  function saveEdit() {
    const x = state.transactions.find((t) => t.id === ui.editTx);
    if (!x) { ui.editTx = null; render(); return; }
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    const before = JSON.stringify(state);
    const note = (val('edit-note') || '').trim();
    if (!txLocked(x)) {
      const amount = Math.round(Number(val('edit-amount')));
      const date = val('edit-date');
      if (!(amount > 0)) { ui.editError = tr('Enter an amount above ₹0.'); render(); return; }
      if (!date || date > today()) { ui.editError = tr('Pick a date up to today.'); render(); return; }
      if (Core.isIncome(x) || Core.isMove(x)) {
        // Take back what it did to a fund or loan, change it, then do it again with the new amount.
        const use = x.useFor;
        const debtId = x.debtId;
        if (use) undoIncomeUse(x);
        x.amount = amount;
        x.date = date;
        if (use) setIncomeUse(x, use, debtId);
      } else {
        if (x.fromFund) state.savings.emergencyBalance = (Number(state.savings.emergencyBalance) || 0) + x.amount - amount;
        x.amount = amount;
        x.date = date;
      }
    }
    if (x.kind === 'cardpay') {
      const date = val('edit-date');
      if (!date || date > today()) { ui.editError = tr('Pick a date up to today.'); render(); return; }
      x.date = date;
    }
    x.note = note;
    const cat = val('edit-cat');
    if (cat && cat !== x.category) {
      x.category = cat;
      if (Core.isIncome(x)) {
        x.borrowed = cat === LOAN_CATEGORY;
        if (x.borrowed && !x.useFor) x.useFor = 'spend';
      } else if (cat === 'Savings' && Core.isFlexible(x)) {
        x.kind = 'move';
        x.useFor = null;
      } else {
        const key = Core.normalizeMerchant(x.note);
        if (key) state.merchantRules[key] = cat;
      }
    }
    const from = val('edit-from');
    if (from !== null) setFrom(x, from);
    x.needsReview = Core.isMove(x) && !x.useFor;
    ui.editTx = null; ui.editError = '';
    save();
    rerenderKeepScroll();
    offerUndo('Saved', before);
  }

  // Undo: the state just before a change, usable only while nothing else has changed since.
  function offerUndo(msg, before) {
    ui.undo = { snap: before, at: saveCount };
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast with-action';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(tr(msg)) + '</span><button data-action="undo">' + tr('Undo') + '</button>';
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); if (ui.undo && ui.undo.snap === before) ui.undo = null; }, 6000);
  }

  function undoLast() {
    const u = ui.undo;
    ui.undo = null;
    const old = document.querySelector('.toast');
    if (old) old.remove();
    if (!u || u.at !== saveCount) { toast(tr('Too late to undo: something else changed since.')); return; }
    state = migrate(Object.assign(emptyState(), JSON.parse(u.snap)));
    save();
    rerenderKeepScroll();
    toast(tr('Undone'));
  }

  // ---------- category icons, weekly chart, payments, calendar ----------

  // A solid glyph in a soft circle for each category. Never the warning colours (amber, coral): those stay for warnings.
  const CAT_GLYPHS = {
    cart: '<path d="M2.5 3.5h2.6l.6 2.5H21l-2 8.2a2 2 0 0 1-1.9 1.5H8.8a2 2 0 0 1-1.9-1.6L4.3 5.5H2.5z"/><circle cx="9.5" cy="19.5" r="1.7"/><circle cx="17" cy="19.5" r="1.7"/>',
    food: '<path d="M6.5 2h1.3v6h.9V2H10v6h.9V2h1.3v7.2A2.5 2.5 0 0 1 10.6 11.6V22H8.4V11.6A2.5 2.5 0 0 1 6.5 9.2z"/><path d="M15.5 2c2.3 0 3.6 2.6 3.6 6.2 0 2.1-1 3.4-2.1 3.8V22h-2.2V2z"/>',
    travel: '<path d="M5 11l1.6-4.4A2 2 0 0 1 8.5 5.3h7a2 2 0 0 1 1.9 1.3L19 11a2 2 0 0 1 2 2v4.5a1 1 0 0 1-1 1h-1.2a2.3 2.3 0 0 1-4.5 0H9.7a2.3 2.3 0 0 1-4.5 0H4a1 1 0 0 1-1-1V13a2 2 0 0 1 2-2zm2.2 0h9.6l-1.2-3.4a.8.8 0 0 0-.7-.5H9.1a.8.8 0 0 0-.7.5z"/>',
    bag: '<path d="M8 7V6a4 4 0 0 1 8 0v1h3l1 14H4L5 7zm2 0h4V6a2 2 0 0 0-4 0z"/>',
    ticket: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5zm6 1v1.8h2V8zm0 3.1v1.8h2v-1.8zm0 3.1V16h2v-1.8z"/>',
    heart: '<path d="M12 21s-8.5-5.2-8.5-11.2A4.8 4.8 0 0 1 12 6.9a4.8 4.8 0 0 1 8.5 2.9C20.5 15.8 12 21 12 21z"/>',
    drop: '<path d="M12 2c3.6 4.7 6.5 8.2 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10.2 8.4 6.7 12 2z"/>',
    dots: '<circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/>',
    bolt: '<path d="M13.5 2L4 13.5h6.5L9 22l11-12.5h-6.7z"/>',
    save: '<path d="M12 2l8.5 3.2V11c0 5.3-3.5 9.7-8.5 11.2C7 20.7 3.5 16.3 3.5 11V5.2zm-1.1 13.3l5.8-5.8-1.4-1.4-4.4 4.4-2.1-2.1-1.4 1.4z"/>',
    cash: '<path d="M2 6h20v12H2zm10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>',
    alert: '<path d="M12 2.5l10 18H2zm-1 6.5v5h2V9zm0 7v2h2v-2z"/>',
    in: '<path d="M10.9 3h2.2v9.3l3.4-3.4 1.5 1.5-6 6-6-6 1.5-1.5 3.4 3.4zM4 18.5h16V21H4z"/>',
    bank: '<path d="M12 2l10 5v2H2V7zM5 11h2.5v7H5zm5.75 0h2.5v7h-2.5zm5.75 0H19v7h-2.5zM2 20h20v2H2z"/>',
    move: '<path d="M16 3l5 4.5L16 12V8.6H4V6.4h12zM8 12v3.4h12v2.2H8V21l-5-4.5z"/>',
    card: '<path d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2H2zm0 4h20v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm3 5v1.6h5V15z"/>',
    tag: '<path d="M3 3h8.6l9.4 9.4-8.6 8.6L3 11.6zm4.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>',
  };
  const CAT_LOOK = {
    Groceries: ['cart', 'aqua'], 'Food & dining': ['food', 'magenta'], Travel: ['travel', 'blue'], Shopping: ['bag', 'violet'],
    Entertainment: ['ticket', 'green'], Health: ['heart', 'blue'], 'Personal care': ['drop', 'magenta'], Misc: ['dots', 'grey'],
    Bills: ['bolt', 'teal'], Savings: ['save', 'green'], Cash: ['cash', 'grey'], Emergency: ['alert', 'coral'],
  };

  function catIcon(x) {
    let look = CAT_LOOK[x.category] || ['tag', 'grey'];
    if (Core.isTransfer(x)) look = ['move', 'grey'];
    else if (Core.isIncome(x)) look = ['in', 'green'];
    else if (Core.isMove(x)) look = ['save', 'green'];
    else if (Core.isCardTransfer(x)) look = ['card', 'teal'];
    else if (Core.isBillPayment(x)) look = ['bolt', 'teal'];
    return '<span class="cat-icon c-' + look[1] + '"><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + CAT_GLYPHS[look[0]] + '</svg></span>';
  }

  function txTitle(x) {
    return esc(tr(x.note || (Core.isIncome(x) ? 'Money received' : x.category || 'Payment')));
  }

  // One payment as a row: icon, what and when, amount. In: green with +. Out: plain ink (red stays for warnings).
  function txRow(x, edit) {
    const isIn = Core.isIncome(x);
    const saved = Core.isMove(x);
    const onCard = x.paidFrom && x.paidFrom !== 'account' ? (state.cards || []).find((c) => c.id === x.paidFrom) : null;
    const cat = Core.isTransfer(x) ? esc(walletName(x.from)) + ' → ' + esc(walletName(x.to))
      : edit && !saved && !Core.isBillPayment(x) && !Core.isCardTransfer(x)
      ? '<select data-tx-cat="' + esc(x.id) + '" aria-label="' + tr('Category') + '">' + (isIn ? incomeCategoryOptions(x.category) : categoryOptions(x.category)) + '</select>'
      : esc(label(saved ? 'Saved' : Core.isCardTransfer(x) ? 'Card' : Core.isBillPayment(x) ? 'Bills' : x.category || ''));
    const sub = cat + ' · ' + fmtDate(x.date) +
      (x.source === 'sms' ? ' · ' + tr('from SMS') : x.source === 'widget' ? ' · ' + tr('from widget') : '') +
      (onCard ? ' · <span class="warn">' + tr('on {card}', { card: cardLabel(onCard) }) + '</span>' : '') +
      (x.wallet && !Core.isTransfer(x) ? ' · ' + esc(walletName(x.wallet)) : '') +
      (x.splitOf ? ' · <span class="chip">' + tr('Split') + '</span>' : '') +
      (x.matched ? ' · <span class="chip">' + tr('Bank SMS ✓') + '</span>' : '');
    const extra = edit && isIn
      ? ' <button class="link" data-action="income-change" data-id="' + esc(x.id) + '">' + tr(x.useFor ? INCOME_USE_LABELS[x.useFor] : 'Choose what it does') + '</button>'
      : edit && saved && x.useFor ? ' <button class="link" data-action="saved-change" data-id="' + esc(x.id) + '">' + tr('Change') + '</button>' : '';
    return '<div class="tx-row' + (x.needsReview ? ' needs-check' : '') + '">' + catIcon(x) +
      '<div class="tx-main"><button class="tx-title" data-action="tx-edit" data-id="' + esc(x.id) + '" aria-label="' + esc(tr('Edit {name}', { name: txTitle(x) })) + '">' + txTitle(x) +
      (x.needsReview ? ' <span class="chip chip-check">' + tr('Check') + '</span>' : '') + '<svg class="tx-pen" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5-4-4L4 16z"/></svg></button>' +
      '<div class="tx-sub">' + sub + extra + '</div></div>' +
      '<div class="tx-side"><span class="tx-amt' + (isIn || saved ? ' good' : Core.isTransfer(x) ? ' muted' : '') + '">' + (isIn ? '+' : '') + inr(x.amount) + '</span>' +
      (edit ? '<button class="icon tx-del" data-action="tx-delete" data-id="' + esc(x.id) + '" aria-label="' + tr('Delete') + '">✕</button>' : '') + '</div></div>';
  }

  function recentCard() {
    const latest = state.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 4);
    if (!latest.length) return '';
    return '<section class="card recent-card"><div class="card-head"><h2>' + tr('Recent payments') + '</h2>' +
      '<button class="link" data-action="page-open" data-tab="spend" data-key="payments">' + tr('See all') + '</button></div>' +
      '<div class="tx-list">' + latest.map((x) => txRow(x, false)).join('') + '</div></section>';
  }

  // This week, day by day: spent against each day's limit. Over the limit shows in coral, with "over" written on it.
  function weekChart(r) {
    const t = today();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = Core.addDays(t, -i);
      const rec = state.days && state.days[d];
      const limit = d === t ? Math.round(r.dailyAllowance) : rec ? rec.allowance : null;
      days.push({ d, spent: Math.round(Core.daySpending(state, d)), limit });
    }
    const max = Math.max(1, ...days.map((x) => Math.max(x.spent, x.limit || 0)));
    const within = days.filter((x) => x.limit !== null && x.spent <= x.limit && x.d !== t).length;
    const tracked = days.filter((x) => x.limit !== null && x.d !== t).length;
    const wd = (d) => Core.parseISO(d).toLocaleDateString(I18N.locale(), { weekday: 'short' });
    const bars = days.map((x) => {
      const over = x.limit !== null && x.spent > x.limit;
      const tip = tr(x.limit !== null ? '{day}: {spent} spent of a {limit} limit' : '{day}: {spent} spent', { day: wd(x.d) + ' ' + fmtDate(x.d), spent: inr(x.spent), limit: inr(x.limit || 0) }) +
        (over ? ' · ' + tr('{amount} over', { amount: inr(x.spent - x.limit) }) : '');
      return '<button class="wk-col' + (x.d === t ? ' today' : '') + '" data-action="viz-tip" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' +
        '<span class="wk-plot">' +
        (x.limit !== null ? '<span class="wk-limit" style="bottom:' + ((x.limit / max) * 100).toFixed(1) + '%"></span>' : '') +
        '<span class="wk-bar' + (over ? ' over' : '') + '" style="height:' + Math.max(x.spent ? 3 : 0, (x.spent / max) * 100).toFixed(1) + '%">' + (over ? '<i>' + tr('over') + '</i>' : '') + '</span></span>' +
        '<span class="wk-day">' + wd(x.d) + '</span></button>';
    }).join('');
    return '<section class="card week-chart"><div class="card-head"><h2>' + tr('This week') + '</h2>' +
      (tracked ? '<span class="hint">' + tr('{n} of {total} days within the limit', { n: within, total: tracked }) + '</span>' : '') + '</div>' +
      '<div class="wk-grid">' + bars + '</div>' +
      '<div class="viz-legend"><span><i class="wk-key"></i>' + tr('Spent') + '</span><span><i class="over"></i>' + tr('Over the limit') + '</span><span><i class="tick"></i>' + tr('That day’s limit') + '</span></div>' +
      '<p class="viz-tip" aria-live="polite">' + tr('Tap a day to see its numbers.') + '</p>' +
      numbersTable([tr('Day'), tr('Spent'), tr('Limit')], days.map((x) => [wd(x.d) + ' ' + fmtDate(x.d), inr(x.spent), x.limit !== null ? inr(x.limit) : '–'])) +
      '</section>';
  }

  // A month as a calendar: each day's spending (coral when over that day's limit) and money in; tap a day for its payments.
  function calendarCard() {
    const t = today();
    const month = ui.calMonth || t.slice(0, 7) + '-01';
    const first = Core.parseISO(month);
    const y = first.getFullYear();
    const m = first.getMonth();
    const daysIn = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday first
    const pick = ui.calDay && ui.calDay.slice(0, 7) === month.slice(0, 7) ? ui.calDay : (t.slice(0, 7) === month.slice(0, 7) ? t : month);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="mcal-cell blank"></span>');
    for (let dnum = 1; dnum <= daysIn; dnum++) {
      const d = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(dnum).padStart(2, '0');
      const spent = Math.round(Core.daySpending(state, d));
      const inAmt = state.transactions.filter((x) => Core.isIncome(x) && x.date === d).reduce((a, x) => a + x.amount, 0);
      const rec = state.days && state.days[d];
      const over = rec && spent > rec.allowance;
      cells.push('<button class="mcal-cell' + (d === pick ? ' on' : '') + (d === t ? ' today' : '') + (d > t ? ' future' : '') + '" data-action="cal-day" data-day="' + d + '">' +
        '<b>' + dnum + '</b>' +
        (inAmt ? '<small class="in">+' + shortInr(inAmt).replace('₹', '') + '</small>' : '') +
        (spent ? '<small class="' + (over ? 'over' : rec ? 'won' : '') + '">' + shortInr(spent).replace('₹', '') + '</small>' : '') + '</button>');
    }
    const heads = [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2024, 0, 1 + i).toLocaleDateString(I18N.locale(), { weekday: 'narrow' }));
    const list = state.transactions.filter((x) => x.date === pick);
    const prev = Core.addMonths(month, -1);
    const next = Core.addMonths(month, 1);
    return '<section class="card mcal-card"><div class="mcal-nav">' +
      '<button class="icon" data-action="cal-month" data-month="' + prev + '" aria-label="' + tr('Previous month') + '">‹</button>' +
      '<b>' + first.toLocaleDateString(I18N.locale(), { month: 'long', year: 'numeric' }) + '</b>' +
      '<button class="icon" data-action="cal-month" data-month="' + next + '" aria-label="' + tr('Next month') + '"' + (next > t ? ' disabled' : '') + '>›</button></div>' +
      '<div class="mcal-grid">' + heads.map((h) => '<span class="mcal-head">' + h + '</span>').join('') + cells.join('') + '</div>' +
      '<div class="viz-legend"><span><i class="wk-key"></i>' + tr('Within the limit') + '</span><span><i class="over"></i>' + tr('Over the limit') + '</span><span><i class="in-key"></i>' + tr('Money in') + '</span></div></section>' +
      '<section class="card"><div class="card-head"><h2>' + fmtDate(pick) + '</h2><span class="hint">' + plural(list.length, 'payment') + '</span></div>' +
      (list.length ? '<div class="tx-list">' + list.map((x) => txRow(x, true)).join('') + '</div>' : '<p class="hint">' + tr('Nothing recorded on this day.') + '</p>') + '</section>';
  }

  function greeting() {
    const h = new Date().getHours();
    return tr(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }

  // ---------- profile: appearance, language, lock, privacy, data, tour, about ----------

  const THEMES = [['', 'Same as phone'], ['light', 'Light'], ['dark', 'Dark']];

  function themeChoice() {
    try { return localStorage.getItem(THEME_KEY) || ''; } catch (e) { return ''; }
  }

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  function viewProfile() {
    const cfg = lockCfg();
    const theme = THEMES.find((x) => x[0] === themeChoice()) || THEMES[0];
    const langName = (I18N.LANGS.find((x) => x[0] === I18N.getLang()) || ['', ''])[1];
    const top = '<div class="page-head"><button class="page-back" data-action="profile-close">' + BACK_ICON + '<span>' + tr('Back') + '</span></button></div>' +
      '<section class="card profile-card"><span class="profile-logo">' + LOGO + '</span><div><h2>' + tr('Profile') + '</h2>' +
      '<p class="hint">' + tr('Make your salary last') + '</p></div></section>';
    return hub('profile', top, [
      { key: 'appearance', group: 'App', icon: 'theme', label: 'Appearance', value: tr(theme[1]), html: appearanceCard },
      { key: 'lang', group: 'App', icon: 'lang', label: 'Language & sounds', value: langName, html: langCard },
      { key: 'lock', group: 'Security', icon: 'lock', label: 'App lock', value: tr(cfg.on ? 'On' : 'Off'), tone: cfg.on ? 'good' : '', html: lockCard },
      { key: 'privacy', group: 'Security', icon: 'shield', label: 'Privacy & data protection', value: '', html: () => privacyCard() },
      { key: 'ai', group: 'Security', icon: 'sparkle', label: 'AI weekly plan', value: tr(aiCfg().on ? 'On' : 'Off'), html: () => aiSettingsCard() },
      { key: 'data', group: 'Your data', icon: 'data', label: 'Backup & data', value: state.lastBackup ? fmtDate(state.lastBackup) : tr('No backup yet'), tone: state.lastBackup ? '' : 'bad', html: () => dataCard() },
      { key: 'smsclean', group: 'Your data', icon: 'broom', label: 'Clean up SMS imports', value: '', hide: !smsCleanup(), html: () => smsCleanup() },
      { key: 'tour', group: 'Help', icon: 'sparkle', label: 'See the app tour', value: '', action: 'tour-open', html: () => '' },
      { key: 'report', group: 'Help', icon: 'flag', label: 'Report a problem', value: '', html: () => reportCard() },
      { key: 'about', group: 'Help', icon: 'info', label: 'About Hisab Se', value: BUILD ? tr('Build {n}', { n: BUILD }) : '', html: aboutCard },
    ]);
  }

  function appearanceCard() {
    const cur = themeChoice();
    return '<section class="card"><h2>' + tr('Appearance') + '</h2>' +
      '<div class="choices">' + THEMES.map((x) =>
        '<button class="choice' + (cur === x[0] ? ' suggested' : '') + '" data-action="set-theme" data-theme="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '">' +
        '<span class="choice-title">' + tr(x[1]) + (cur === x[0] ? ' ✓' : '') + '</span>' +
        '<span class="choice-detail">' + tr(x[0] === '' ? 'Light in the day, dark at night, as your phone is set.' : x[0] === 'light' ? 'Cream and teal, always.' : 'Easy on the eyes at night, always.') + '</span></button>').join('') +
      '</div></section>';
  }

  function langCard() {
    return '<section class="card lang-card"><div class="card-head"><h2>' + tr('Language') + '</h2>' +
      '<div class="seg" role="group" aria-label="' + tr('Language') + '">' + I18N.LANGS.map(([code, name]) =>
        '<button data-action="set-lang" data-lang="' + code + '" lang="' + code + '" aria-pressed="' + (I18N.getLang() === code) + '">' + name + '</button>').join('') + '</div></div>' +
      '<label class="check"><input id="sounds-on" type="checkbox"' + (state.settings.sounds === false ? '' : ' checked') + '> ' + tr('Sounds (quiet when the phone is on silent)') + '</label></section>';
  }

  function aboutCard() {
    return '<section class="card about-card"><span class="profile-logo big">' + LOGO + '</span><h2>Hisab Se</h2>' +
      '<p><b>' + tr('Make your salary last') + '</b></p>' +
      '<p class="hint">' + tr('Know each day how much you can spend and still reach payday without borrowing. Everything stays on your phone.') + '</p>' +
      '<p class="hint">' + tr('Hisab Se is a budgeting tool. It does not give investment advice and is not registered with SEBI or RBI.') + '</p>' +
      '<p class="hint">' + (BUILD ? tr('Build {n}', { n: BUILD }) : tr('Browser preview')) + '</p></section>';
  }

  // App lock: what it does, the honest risk, and its options.
  function lockCard() {
    const cfg = lockCfg();
    const st = ui.lockStatus;
    if (!AppLock) {
      return '<section class="card"><h2>' + tr('App lock') + '</h2><p class="hint">' + tr('App lock works in the Android app.') + '</p></section>';
    }
    if (!st) {
      Promise.resolve().then(() => AppLock.status()).then((r) => { ui.lockStatus = r; rerenderKeepScroll(); }).catch(() => { ui.lockStatus = { available: false }; rerenderKeepScroll(); });
      return '<section class="card"><h2>' + tr('App lock') + '</h2><p class="hint">' + tr('Checking your phone…') + '</p></section>';
    }
    const msg = ui.lockMsg ? '<p class="bad" role="alert">' + ui.lockMsg + '</p>' : '';
    if (!cfg.on) {
      return '<section class="card lock-card"><h2>' + tr('App lock') + '</h2>' +
        '<p>' + tr('Open Hisab Se with your fingerprint, face or your phone’s screen lock. No new password to remember.') + '</p>' +
        '<ul class="privacy-list"><li class="pv-good"><span>' + tr('<b>Your data on this phone gets encrypted</b> (AES-256). The key stays in the phone’s secure hardware and opens only after you unlock.') + '</span></li>' +
        '<li class="pv-good"><span>' + tr('<b>Amounts hidden</b> on the home-screen widget and in SMS notifications, and the app is hidden in recent apps.') + '</span></li>' +
        '<li class="pv-warn"><span>' + tr('<b>If you ever remove your phone’s screen lock,</b> Android deletes the key and this data can’t be opened again. Keep a backup file: it restores everything.') + '</span></li></ul>' +
        (st.available
          ? '<div class="row"><button class="primary" data-action="lock-on"' + (ui.lockBusy ? ' disabled' : '') + '>' + tr(ui.lockBusy ? 'Checking…' : 'Turn on app lock') + '</button>' +
            (state.lastBackup ? '' : '<button data-action="page-open" data-tab="profile" data-key="data">' + tr('Make a backup first') + '</button>') + '</div>'
          : '<div class="callout warn"><b>' + tr('Your phone has no screen lock yet') + '</b><span class="hint">' + tr('Set a PIN, pattern or password in your phone’s settings first. Fingerprint and face unlock need one too.') + '</span>' +
            '<div><button data-action="lock-settings">' + tr('Open phone settings') + '</button></div></div>') +
        msg + '</section>';
    }
    const after = Number(cfg.after);
    return '<section class="card lock-card"><div class="card-head"><h2>' + tr('App lock') + '</h2><span class="chip chip-freedom">' + tr('On') + '</span></div>' +
      '<p class="good">' + tr('Your data on this phone is encrypted. It opens with your fingerprint, face or phone’s screen lock.') + '</p>' +
      '<label class="field" for="lock-after"><span>' + tr('Lock again') + '</span><select id="lock-after">' +
      [[0, 'Every time I leave the app'], [1, 'After 1 minute away'], [5, 'After 5 minutes away'], [15, 'After 15 minutes away']].map((x) =>
        '<option value="' + x[0] + '"' + (after === x[0] ? ' selected' : '') + '>' + tr(x[1]) + '</option>').join('') + '</select></label>' +
      '<label class="check"><input id="lock-hide" type="checkbox"' + (cfg.hide !== false ? ' checked' : '') + '> ' + tr('Hide amounts on the widget and in SMS notifications') + '</label>' +
      '<label class="check"><input id="lock-secure" type="checkbox"' + (cfg.secure !== false ? ' checked' : '') + '> ' + tr('Hide Hisab Se in recent apps and screenshots') + '</label>' +
      '<div><button class="ghost" data-action="lock-off"' + (ui.lockBusy ? ' disabled' : '') + '>' + tr('Turn off app lock') + '</button></div>' + msg + '</section>';
  }

  // Turning the lock on: the native side checks the full round trip first, then the data is encrypted and checked again.
  function lockOn() {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const b64 = Core.toB64(raw);
    let nativeOn = false;
    ui.lockBusy = true; ui.lockMsg = ''; ui.unlocking = true;
    rerenderKeepScroll();
    Promise.resolve()
      .then(() => AppLock.enable({ key: b64, title: tr('Turn on app lock'), subtitle: tr('Fingerprint, face or your phone’s screen lock') }))
      .then(() => { nativeOn = true; return importKey(b64); })
      .then((key) => sealData(JSON.stringify(state), key).then((blob) => openData(blob, key).then((back) => {
        if (JSON.stringify(back) !== JSON.stringify(state)) throw new Error('check');
        localStorage.setItem(KEY, blob);
        dataKey = key;
        setLockCfg({ on: true, after: 1, hide: true, secure: true });
        // From here the data is encrypted: hiding from recent apps is a nicety and must not undo the lock.
        return Promise.resolve().then(() => AppLock.setSecure({ on: true })).catch(() => {});
      })))
      .then(() => {
        ui.lockBusy = false; ui.unlocking = false; ui.unlockedAt = Date.now();
        widgetSent = '';
        rerenderKeepScroll();
        celebrate(tr('App lock is on. Your data on this phone is encrypted.'));
      })
      .catch((e) => {
        ui.lockBusy = false; ui.unlocking = false;
        // Nothing was changed: the data stays as it was. (Once the data is encrypted, the key is never dropped here.)
        if (nativeOn && !dataKey) Promise.resolve().then(() => AppLock.disable()).catch(() => {});
        ui.lockMsg = e && e.code === 'cancel' ? '' : tr('Couldn’t turn on the lock, so nothing was changed. Your data is as it was.');
        rerenderKeepScroll();
      });
  }

  // Turning it off: unlock to prove it's you, write the data back unencrypted, then forget the key.
  function lockOff() {
    ui.lockBusy = true; ui.lockMsg = ''; ui.unlocking = true;
    rerenderKeepScroll();
    Promise.resolve()
      .then(() => AppLock.unlock({ title: tr('Turn off app lock'), subtitle: tr('Fingerprint, face or your phone’s screen lock') }))
      .then(() => {
        localStorage.setItem(KEY, JSON.stringify(state));
        setLockCfg(null);
        dataKey = null;
        return AppLock.disable();
      })
      .then(() => {
        ui.lockBusy = false; ui.unlocking = false; ui.unlockedAt = Date.now();
        widgetSent = '';
        rerenderKeepScroll();
        toast(tr('App lock is off. Your data on this phone is no longer encrypted.'));
      })
      .catch((e) => {
        ui.lockBusy = false; ui.unlocking = false;
        ui.lockMsg = e && e.code === 'cancel' ? '' : tr('Couldn’t turn off the lock. Try again.');
        rerenderKeepScroll();
      });
  }

  function renderLock() {
    const app = document.getElementById('app');
    const err = ui.lockError;
    let msg = '';
    if (err === 'lost') {
      msg = '<div class="callout bad"><b>' + tr('This phone’s screen lock was removed, so the key to your data is gone.') + '</b>' +
        '<span class="hint">' + tr('Android deletes the key when the screen lock is removed. The data on this phone can’t be opened any more. Start again and restore your backup file.') + '</span>' +
        (ui.lockReset
          ? '<div class="row"><button class="danger" data-action="lock-reset-yes">' + tr('Yes, start again') + '</button><button data-action="lock-reset-no">' + tr('Cancel') + '</button></div>'
          : '<div><button data-action="lock-reset">' + tr('Start again and restore a backup') + '</button></div>') + '</div>';
    } else if (err && err !== 'cancel') {
      msg = '<p class="bad" role="alert">' + tr('That didn’t unlock. Try again.') + '</p>';
    }
    app.innerHTML = '<div class="lock-screen"><span class="profile-logo big">' + LOGO + '</span>' +
      '<h1>' + tr('Hisab Se is locked') + '</h1>' +
      '<p class="hint">' + tr('Unlock with your fingerprint, face or your phone’s screen lock.') + '</p>' +
      (err === 'lost' ? '' : '<button class="primary" data-action="unlock"' + (ui.unlocking ? ' disabled' : '') + '>' + tr('Unlock') + '</button>') + msg + '</div>';
  }

  function unlockApp() {
    if (!AppLock || ui.unlocking) return;
    ui.unlocking = true; ui.lockError = '';
    renderLock();
    Promise.resolve()
      .then(() => AppLock.unlock({ title: tr('Unlock Hisab Se'), subtitle: tr('Fingerprint, face or your phone’s screen lock') }))
      .then((r) => importKey(r.key))
      .then((key) => {
        dataKey = key;
        return sealedBlob ? openData(sealedBlob, key) : null;
      })
      .then((data) => {
        if (data) state = migrate(Object.assign(emptyState(), data));
        sealedBlob = null;
        locked = false; ui.unlocking = false; ui.unlockedAt = Date.now();
        if (!booted) boot();
        else { render(); if (NATIVE) collectNative(); }
      })
      .catch((e) => {
        ui.unlocking = false;
        ui.lockError = (e && e.code) || 'error';
        renderLock();
      });
  }

  // Back from somewhere else: lock again after the chosen time away.
  function lockAgain() {
    const cfg = lockCfg();
    if (!cfg.on || locked || !AppLock) return false;
    if (ui.unlocking || (ui.unlockedAt && Date.now() - ui.unlockedAt < 3000)) return false;
    if (!ui.hiddenAt || Date.now() - ui.hiddenAt < (Number(cfg.after) || 0) * 60000) return false;
    locked = true;
    ui.lockError = '';
    unlockApp();
    return true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (!ui.unlocking) ui.hiddenAt = Date.now(); }
    else if (lockAgain()) ui.hiddenAt = 0;
  });

  // ---------- first-time tour ----------

  const TOUR = [
    { art: 'logo', title: 'Hisab Se: make your salary last', body: 'Know every day how much you can spend and still reach payday without borrowing.' },
    { art: 'limit', title: 'Today’s limit', body: 'Spend within it and you never touch ₹0 before payday. Went over today? Tomorrow’s limit adjusts, so you can recover.' },
    { art: 'zones', title: 'Green, careful, red', body: 'The card changes colour early, with a clear sign, so you can fix things before the money runs out.' },
    { art: 'freedom', title: 'Days of Freedom', body: 'How many days your savings would pay for the basics if pay stopped. Grow it from red to green.' },
    { art: 'round', title: 'Each month is a round', body: 'Win days by staying within the limit. Reach payday without borrowing to win the round.' },
    { art: 'debt', title: 'A way out of debt', body: 'Survive, stabilize, escape: one next move at a time, with ready scripts for calling your lenders.' },
    { art: 'private', title: 'Private by design', body: 'No account, and it works offline. Bank SMS are read on this phone only. Lock it with your fingerprint.' },
  ];

  function tourArt(kind) {
    if (kind === 'logo') return '<span class="profile-logo big">' + LOGO + '</span>';
    if (kind === 'limit') return '<div class="tour-limit"><span class="hero-label">' + tr('Today’s limit') + '</span><b>₹364</b><span class="tour-bar"><span></span></span><small>' + tr('{amount} left', { amount: '₹268' }) + '</small></div>';
    if (kind === 'zones') return '<div class="tour-zones">' + ['green', 'amber', 'red'].map((z) =>
      '<span class="tour-zone z-' + z + '">' + SIGNS[z] + '<b>' + tr(z === 'green' ? 'On track' : z === 'amber' ? 'Careful' : 'Red zone: stop') + '</b></span>').join('') + '</div>';
    if (kind === 'freedom') return '<div class="tour-freedom"><b>6</b><span>' + tr('Days of Freedom') + '</span><small>' + tr('1 more day turns it amber') + '</small></div>';
    if (kind === 'round') {
      const cells = 'wwowwnwwwowwwt'.split('');
      return '<div class="round-grid tour-round">' + cells.map((c) => '<span class="round-tile ' + ({ w: 'won', o: 'over', n: 'none', t: 'today' })[c] + '">' +
        (c === 'w' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '') + '</span>').join('') + '</div>';
    }
    if (kind === 'debt') return '<ol class="journey-steps tour-steps"><li class="done"><span class="js-dot">✓</span>' + tr('Survive') + '</li><li class="now"><span class="js-dot">2</span>' + tr('Stabilize') + '</li><li><span class="js-dot">3</span>' + tr('Escape') + '</li></ol>';
    return '<span class="hub-icon tour-lock"><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + HUB_ICONS.lock + '</svg></span>';
  }

  function tourModal() {
    if (!ui.tour) return '';
    const i = Math.min(TOUR.length - 1, Math.max(0, ui.tourStep || 0));
    const s = TOUR[i];
    const last = i === TOUR.length - 1;
    return '<div class="reset-modal-overlay tour-overlay" role="presentation"><div class="reset-modal-card tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" id="tour-card" tabindex="-1">' +
      '<div class="tour-top"><span class="eyebrow">' + tr('{n} of {total}', { n: i + 1, total: TOUR.length }) + '</span>' +
      (last ? '' : '<button class="link" data-action="tour-skip">' + tr('Skip') + '</button>') + '</div>' +
      '<div class="tour-art">' + tourArt(s.art) + '</div>' +
      '<h2 id="tour-title">' + tr(s.title) + '</h2><p>' + tr(s.body) + '</p>' +
      '<div class="tour-dots" aria-hidden="true">' + TOUR.map((x, j) => '<span' + (j === i ? ' class="on"' : '') + '></span>').join('') + '</div>' +
      '<div class="row tour-nav">' + (i > 0 ? '<button class="ghost" data-action="tour-back">' + tr('Back') + '</button>' : '<span></span>') +
      '<button class="primary" data-action="' + (last ? 'tour-done' : 'tour-next') + '">' + tr(last ? 'Start' : 'Next') + '</button></div>' +
      '</div></div>';
  }

  function tourEnd() {
    ui.tour = false;
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* private mode */ }
    render();
  }

  // Swipe left or right on the tour to move between screens.
  let tourX = null;
  document.addEventListener('touchstart', (ev) => { if (ui.tour && ev.touches.length === 1) tourX = ev.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', (ev) => {
    if (!ui.tour || tourX === null) return;
    const dx = ev.changedTouches[0].clientX - tourX;
    tourX = null;
    if (Math.abs(dx) < 50) return;
    const i = (ui.tourStep || 0) + (dx < 0 ? 1 : -1);
    if (i >= TOUR.length) { tourEnd(); return; }
    ui.tourStep = Math.max(0, i);
    render();
  }, { passive: true });

  // ---------- AI weekly plan (optional, off by default) ----------

  function aiCfg() {
    try { return Object.assign({ on: false, url: '', code: '' }, JSON.parse(localStorage.getItem(AI_KEY) || '{}')); } catch (e) { return { on: false, url: '', code: '' }; }
  }

  function saveAiCfg(c) {
    try { localStorage.setItem(AI_KEY, JSON.stringify(c)); } catch (e) { /* private mode */ }
  }

  const FRAUD_TEXT = {
    tiny: 'Tiny payments of ₹10 or less: fraudsters use these to test a card or UPI.',
    duplicate: 'The same amount to the same place twice on one day.',
    large_new: 'A big payment to a place you haven’t paid before.',
    many_new: 'Three or more new places paid on one day.',
  };
  const PLAN_ICONS = { save: 'pot', loans: 'loan', fraud: 'shield', invest: 'sprout' };

  // Payments worth a second look, worked out on this phone. Works with the AI plan off too.
  function fraudBox() {
    const fr = Core.fraudSignals(state, today(), 14);
    if (!fr.length) return '';
    const byId = {};
    state.transactions.forEach((t) => { byId[t.id] = t; });
    return '<div class="callout fraud-box"><b class="bad">' + tr('Check these payments') + '</b>' +
      fr.map((x) => '<div class="fraud-kind"><span class="hint">' + tr(FRAUD_TEXT[x.kind]) + '</span>' +
        x.ids.map((id) => byId[id]).filter(Boolean).map((t) => '<div class="fraud-pay"><span>' + esc(t.note || label(t.category)) + ' · ' + fmtDate(t.date) + '</span><span class="amt">' + inr(t.amount) + '</span>' +
          '<button class="ghost small" data-action="fraud-ok" data-id="' + esc(t.id) + '">' + tr('It’s mine') + '</button></div>').join('') + '</div>').join('') +
      '<span class="hint">' + tr('Not yours? Call your bank now to block the card or UPI, and report it on 1930 (National Cyber Crime Helpline) or cybercrime.gov.in.') + '</span></div>';
  }

  function planSteps(sec) {
    return '<ol class="plan-steps">' + sec.steps.map((st) => '<li><b>' + esc(st.action) + '</b>' + (st.why ? '<span class="hint">' + esc(st.why) + '</span>' : '') + '</li>').join('') + '</ol>';
  }

  function planCard() {
    const cfg = aiCfg();
    const t = today();
    const wp = state.weeklyPlan;
    if (!cfg.on) {
      return '<section class="card plan-card">' + titled('Weekly plan', 'plan') +
        '<p>' + tr('Every week, a concrete plan made from your own numbers: where to save more, how to clear loans sooner, and payments to double-check for fraud.') + '</p>' +
        '<p class="hint">' + tr('It’s off. Turning it on sends a summary of your numbers once a week to make the plan. Nothing else changes.') + '</p>' +
        '<div><button class="primary" data-action="ai-setup">' + tr('Set up the weekly plan') + '</button></div>' + fraudBox() + '</section>';
    }
    if (wp && !wp.seen) setTimeout(() => { if (state.weeklyPlan === wp) { wp.seen = true; save(true); } }, 0);
    let html = '<section class="card plan-card"><div class="card-head">' + titled('Your plan this week', 'plan') +
      '<span class="hint">' + tr('Week of {date}', { date: fmtDate(Core.weekStart(t)) }) + '</span></div>';
    if (ui.planBusy) html += '<p class="hint ai-busy" role="status">' + tr('Making your plan… This takes about half a minute.') + '</p>';
    if (ui.planError) html += '<p class="bad" role="alert">' + ui.planError + '</p>';
    if (wp && wp.plan) {
      const p = wp.plan;
      if (wp.lastGoal && wp.lastResult) {
        html += '<p class="' + (wp.lastResult.met ? 'good' : 'hint') + '">' + (wp.lastResult.met
          ? tr('✓ Last week’s goal met: {goal}', { goal: esc(wp.lastGoal.text) })
          : tr('Last week’s goal not met: {goal}. A new week, a fresh try.', { goal: esc(wp.lastGoal.text) })) + '</p>';
      }
      html += '<p class="plan-headline">' + esc(p.headline) + '</p>';
      if (wp.goal) {
        const now = Core.goalResult(state, wp.goal);
        const g = wp.goal;
        const progress = !now ? '' : g.type === 'spend_cap' ? tr('{spent} spent of {cap} so far', { spent: inr(now.value), cap: inr(g.amount) })
          : g.type === 'no_card' ? (now.value ? tr('{amount} on cards so far', { amount: inr(now.value) }) : tr('No card spending so far ✓'))
            : tr('{done} of {target} so far', { done: inr(now.value), target: inr(g.amount) });
        html += '<div class="callout plan-goal"><span class="eyebrow">' + tr('This week’s goal') + '</span><b>' + esc(g.text) + '</b>' + (progress ? '<span class="hint">' + progress + '</span>' : '') + '</div>';
      }
      const ready = Core.investReady(state, t).ready;
      p.sections.filter((sec) => sec.kind !== 'invest' || ready).forEach((sec) => {
        html += '<div class="plan-sec plan-' + sec.kind + '"><h3><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + HUB_ICONS[PLAN_ICONS[sec.kind]] + '</svg>' + esc(sec.title) + '</h3>' + planSteps(sec) +
          (sec.kind === 'fraud' ? fraudBox() : '') +
          (sec.kind === 'invest' ? '<div class="callout warn"><b>' + tr('General information, not advice') + '</b><span class="hint">' + tr('Before investing, talk to a SEBI-registered investment adviser. Every investment can lose value, and the decision is yours.') + '</span></div>' : '') +
          '</div>';
      });
      if (!p.sections.some((sec) => sec.kind === 'fraud')) html += fraudBox();
      html += '<p class="hint">' + tr('Made by AI on {date} from your numbers. It can be wrong: the app’s own numbers are the ones to trust.', { date: fmtDate(wp.made) }) + '</p>';
      html += wp.made === t
        ? '<p class="hint">' + tr('A new plan comes each Monday. You can remake it once a day.') + '</p>'
        : '<div><button class="ghost" data-action="plan-make"' + (ui.planBusy ? ' disabled' : '') + '>' + tr('Make a new plan') + '</button></div>';
    } else if (!ui.planBusy) {
      html += '<p>' + tr('Your first plan is ready to make.') + '</p><div><button class="primary" data-action="plan-make">' + tr('Make my plan') + '</button></div>' + fraudBox();
    }
    return html + '</section>';
  }

  function aiSettingsCard() {
    const cfg = aiCfg();
    const f = ui.aiForm || {};
    return '<section class="card ai-settings">' + titled('AI weekly plan', 'plan') +
      '<p>' + tr('A plan each week from your own numbers, written by Claude from Anthropic.') + '</p>' +
      '<div class="callout"><b>' + tr('Sent once a week, when your plan is made') + '</b>' +
      '<span class="hint">' + tr('A summary the app has already worked out: today’s limit, zone, spending by category this week and usually, budgets, bills to come, past rounds, your loans, cards and goals by the names you gave them, and how many payments look unusual.') + '</span>' +
      '<b>' + tr('Never sent') + '</b><span class="hint">' + tr('SMS text, shop names, notes, account or card numbers.') + '</span>' +
      '<b>' + tr('Where it goes') + '</b><span class="hint">' + tr('To your app’s server, which keeps nothing, and on to Anthropic to write the plan.') + '</span>' +
      '<div><button class="link" data-action="ai-show-facts">' + tr(ui.aiFacts ? 'Hide what’s sent' : 'See exactly what’s sent') + '</button></div>' +
      (ui.aiFacts ? '<pre class="ai-facts">' + esc(Core.planFacts(state, today(), state.weeklyPlan && state.weeklyPlan.goal)) + '</pre>' : '') + '</div>' +
      '<form id="ai-settings-form" class="form-grid" autocomplete="off">' +
      '<label class="field wide" for="ai-url"><span>' + tr('Server address') + '</span><input id="ai-url" type="url" inputmode="url" placeholder="https://….workers.dev" value="' + esc(f.url != null ? f.url : cfg.url) + '"></label>' +
      '<label class="field wide" for="ai-code"><span>' + tr('Invite code') + '</span><input id="ai-code" type="text" autocapitalize="off" value="' + esc(f.code != null ? f.code : cfg.code) + '"></label>' +
      (f.error ? '<p class="bad wide" role="alert">' + f.error + '</p>' : '') +
      '<div class="row wide">' + (cfg.on
        ? '<button class="primary" type="submit">' + tr('Save') + '</button><button type="button" class="danger" data-action="ai-off">' + tr('Turn off the weekly plan') + '</button>'
        : '<button class="primary" type="submit">' + tr('Turn on the weekly plan') + '</button>') + '</div></form>' +
      '<p class="hint">' + tr('Your tester invite gives you the server address and code. Turning it off stops all sending at once.') + '</p></section>';
  }

  function saveAiSettings(ev) {
    ev.preventDefault();
    const url = document.getElementById('ai-url').value.trim().replace(/\/+$/, '');
    const code = document.getElementById('ai-code').value.trim();
    // What was typed stays in the boxes when something needs fixing.
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(url)) { ui.aiForm = { url, code, error: tr('Enter the server address, starting with https://') }; render(); return; }
    if (!code) { ui.aiForm = { url, code, error: tr('Enter your invite code.') }; render(); return; }
    saveAiCfg({ on: true, url, code });
    ui.aiForm = null;
    ui.planTried = false;
    toast(tr('Weekly plan is on'));
    render();
  }

  // Due when it's on and this week has no plan yet: asked once per app start.
  function planDue() {
    return aiCfg().on && !ui.planBusy && !ui.planTried && !state.isDemo &&
      (!state.weeklyPlan || state.weeklyPlan.week < Core.weekStart(today()));
  }

  function requestPlan() {
    const cfg = aiCfg();
    if (!cfg.on || ui.planBusy) return;
    const t = today();
    const week = Core.weekStart(t);
    const prev = state.weeklyPlan;
    // Last week's goal: the current plan's when the week has moved on; kept when remaking this week's plan.
    const lastGoal = prev ? (prev.week < week ? prev.goal : prev.lastGoal) : null;
    ui.planBusy = true;
    ui.planTried = true;
    ui.planError = '';
    rerenderKeepScroll();
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 120000);
    const done = (plan, error) => {
      clearTimeout(timer);
      ui.planBusy = false;
      if (plan) {
        state.weeklyPlan = { week, made: t, plan, goal: Object.assign({}, plan.week_goal, { week }), lastGoal: lastGoal || null,
          lastResult: lastGoal ? Core.goalResult(state, lastGoal) : null, seen: false };
        save(true);
      } else ui.planError = error;
      rerenderKeepScroll();
    };
    fetch(cfg.url + '/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Invite-Code': cfg.code },
      body: JSON.stringify({ facts: Core.planFacts(state, t, lastGoal), language: AI_LANG[I18N.getLang()] || 'English' }),
      signal: ctl ? ctl.signal : undefined,
    }).then((res) => res.json().catch(() => ({})).then((body) => ({ status: res.status, body }))).then(({ status, body }) => {
      if (status === 200 && body.plan && Array.isArray(body.plan.sections) && body.plan.week_goal) done(body.plan);
      else if (status === 200 && body.declined) done(null, tr('The AI couldn’t make a plan this time. Try again later.'));
      else if (status === 401) done(null, tr('The invite code isn’t right. Check it in Profile → AI weekly plan.'));
      else if (status === 429) done(null, tr('The AI is busy. Try again in a minute.'));
      else if (body.error === 'key') done(null, tr('The AI server isn’t set up yet. Ask the app’s owner.'));
      else done(null, tr('Something went wrong on the AI server. Try again later.'));
    }, () => done(null, tr('Couldn’t reach the AI. Check your internet and try again.')));
  }

  // ---------- privacy and backup ----------

  // Every line here was checked against the app: the manifest, the native code and the web code.
  const PRIVACY = [
    ['ai', ''],
    ['good', '<b>No account, no ads, no analytics, no crash reports.</b>'],
    ['good', '<b>Bank SMS</b> are read only when you tap Read bank SMS or turn on alerts. Messages from phone numbers (friends, family) are skipped before the app sees them. Only a payment’s amount, date and shop are saved, never the message.'],
    ['good', '<b>Your data stays on this phone</b>, in the app’s private storage. Android’s cloud backup is off for Hisab Se, so not even Google gets a copy.'],
    ['good', '<b>Something leaves the phone only when you choose:</b> a backup file you share, a problem report you send, or the weekly summary for your AI plan.'],
    ['warn', '<b>If the phone is lost, reset, or the app is uninstalled, your data goes with it,</b> unless you have a backup file.'],
  ];

  function privacyCard() {
    return '<section class="card privacy-card">' + titled('Your privacy', 'privacy') +
      '<ul class="privacy-list">' + PRIVACY.map((x) => (x[0] === 'ai'
        ? (aiCfg().on
          ? '<li class="pv-warn"><span>' + tr('<b>The AI weekly plan is on.</b> Once a week, a summary of your numbers goes to your app’s server and on to Anthropic (Claude) to write your plan. SMS text, shop names, notes and account numbers are never sent.') + '</span></li>'
          : '<li class="pv-good"><span>' + tr('<b>Nothing is sent anywhere.</b> The AI weekly plan is off, so the app never connects to the internet. Turn on airplane mode: everything still works.') + '</span></li>')
        : '<li class="pv-' + x[0] + '"><span>' + tr(x[1]) + '</span></li>')).join('') + '</ul></section>';
  }

  function dataCard() {
    const last = state.lastBackup;
    const b = ui.backupForm;
    const r = ui.restore;
    let form = '';
    if (b) {
      form = '<div class="callout backup-form"><b>' + tr('Make a backup file') + '</b>' +
        '<span class="hint">' + tr('The file is locked with a password you choose (AES-256). Without the password nobody can open it, not even Hisab Se, so write it down. Then save the file off this phone: Google Drive, email or WhatsApp to yourself.') + '</span>' +
        '<label class="field" for="backup-pass"><span>' + tr('Password (6 or more characters)') + '</span><input id="backup-pass" type="password" autocomplete="new-password" minlength="6"></label>' +
        '<label class="field" for="backup-pass2"><span>' + tr('Same password again') + '</span><input id="backup-pass2" type="password" autocomplete="new-password" minlength="6"></label>' +
        (b.error ? '<p class="bad" role="alert">' + b.error + '</p>' : '') +
        (ShareFile
          ? '<div class="row"><button class="primary" data-action="backup-make" data-how="save">' + tr('Save to phone') + '</button>' +
            '<button data-action="backup-make" data-how="share">' + tr('Share to Drive or WhatsApp') + '</button>' +
            '<button class="ghost" data-action="backup-cancel">' + tr('Cancel') + '</button></div>' +
            '<span class="hint">' + tr('Save to phone opens Android’s save screen: pick Downloads, or Google Drive to keep it off the phone. The backup only counts once Android confirms it’s saved.') + '</span>'
          : '<div class="row"><button class="primary" data-action="backup-make" data-how="save">' + tr('Lock and save') + '</button><button class="ghost" data-action="backup-cancel">' + tr('Cancel') + '</button></div>') + '</div>';
    } else if (r) {
      const info = r.info;
      form = '<div class="callout restore-form"><b>' + tr('Restore from a backup') + '</b>' +
        (r.paste
          ? '<label class="field" for="restore-text"><span>' + tr('Paste the backup text') + '</span><textarea id="restore-text"></textarea></label>'
          : '<label class="field" for="restore-file"><span>' + tr('Pick the backup file') + '</span><input id="restore-file" type="file"></label>' +
            (info ? '<p class="good">' + (info.date ? tr('Backup from {date} · {entries}', { date: fmtDate(info.date, true), entries: plural(info.entries, 'entry', 'entries') }) : tr('Backup · {entries}', { entries: plural(info.entries, 'entry', 'entries') })) + '</p>' : '')) +
        ((info && info.locked) || r.paste ? '<label class="field" for="restore-pass"><span>' + tr('Backup password') + '</span><input id="restore-pass" type="password" autocomplete="current-password"></label>' : '') +
        (r.error ? '<p class="bad" role="alert">' + r.error + '</p>' : '') +
        (info || r.paste ? '<p class="hint">' + tr('This replaces everything in Hisab Se on this phone with the backup.') + '</p>' +
          '<div class="row"><button class="primary" data-action="restore-go">' + tr('Replace my data with this backup') + '</button><button class="ghost" data-action="restore-cancel">' + tr('Cancel') + '</button></div>'
          : '<div class="row"><button class="ghost" data-action="restore-cancel">' + tr('Cancel') + '</button>' + (r.paste ? '' : '<button class="link" data-action="restore-paste">' + tr('Paste backup text instead') + '</button>') + '</div>') +
        '</div>';
    }
    return '<section class="card" id="data-card">' + titled('Your data', 'data') +
      '<p class="' + (last ? 'good' : 'warn-text') + '">' + (last ? tr('Last backup: {date}.', { date: fmtDate(last, true) }) + (state.lastBackupWhere ? ' ' + tr('Saved as {name}.', { name: esc(state.lastBackupWhere) }) : '') : tr('No backup yet. If this phone is lost or reset, your data goes with it.')) + '</p>' +
      (b || r ? '' : '<div class="row"><button class="primary" data-action="backup-open">' + tr('Make a backup file') + '</button><button data-action="restore-open">' + tr('Restore from a backup') + '</button></div>') +
      form +
      '<div class="row"><button data-action="load-demo">' + tr('Load example data') + '</button>' +
      '<button class="danger" data-action="wipe">' + tr('Erase everything') + '</button></div>' +
      (ui.confirmWipe ? '<div class="callout bad"><b>' + tr('Erase all your data on this device?') + '</b><span class="hint">' + tr('Everything in Hisab Se on this phone: entries, plans, loans, the widget and SMS alerts. This cannot be undone. A backup file you saved elsewhere is not touched.') + '</span><div class="row"><button class="danger" data-action="wipe-confirm">' + tr('Yes, erase') + '</button><button data-action="wipe-cancel">' + tr('Cancel') + '</button></div></div>' : '') +
      '</section>';
  }

  // Once a month, when there's data worth keeping and no recent backup.
  function backupNudge() {
    if (state.isDemo || !state.settings.salary) return '';
    const t = today();
    if (state.lastBackup && Core.daysBetween(state.lastBackup, t) < 30) return '';
    if (state.backupNudge && Core.daysBetween(state.backupNudge, t) < 30) return '';
    const first = state.transactions.reduce((m, x) => (!m || x.date < m ? x.date : m), null);
    if (!first || Core.daysBetween(first, t) < 14) return '';
    return '<div class="callout"><b>' + tr(state.lastBackup ? 'Time for a fresh backup' : 'Keep a backup of your data') + '</b>' +
      '<span class="hint">' + tr('If this phone is lost or reset, everything in Hisab Se goes with it. A backup file locked with your password takes a minute.') + '</span>' +
      '<div class="row"><button class="primary" data-action="backup-go">' + tr('Make a backup') + '</button><button class="ghost" data-action="backup-later">' + tr('Later') + '</button></div></div>';
  }

  // how: 'save' (Android's save screen; counts only once saved) or 'share' (the share menu).
  function makeBackup(how) {
    const p1 = (document.getElementById('backup-pass') || {}).value || '';
    const p2 = (document.getElementById('backup-pass2') || {}).value || '';
    if (p1.length < 6) { ui.backupForm = { error: tr('Use at least 6 characters.') }; render(); return; }
    if (p1 !== p2) { ui.backupForm = { error: tr('The two passwords don’t match.') }; render(); return; }
    const t = today();
    Core.encryptBackup(state, p1, t).then((text) => {
      const name = 'HisabSe-backup-' + t + '.json';
      const done = (saved) => {
        state.lastBackup = t;
        state.lastBackupWhere = saved || null;
        ui.backupForm = null;
        save(); rerenderKeepScroll();
        celebrate(saved ? tr('Backup saved as {name}. Keep the password safe.', { name: saved }) : tr('Backup shared. Check that it arrived in Drive or WhatsApp, and keep the password safe.'));
      };
      if (ShareFile && how === 'share') return ShareFile.share({ name, text, title: tr('Save your backup'), mime: 'application/json' }).then(() => done(null));
      if (ShareFile) {
        return ShareFile.save({ name, text, mime: 'application/json' }).then((r) => {
          if (r && r.saved) done(r.name || name);
          else { ui.backupForm = { error: tr('Not saved yet: pick a folder and tap Save on Android’s screen.') }; render(); }
        });
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      done();
    }).catch(() => { ui.backupForm = { error: tr('Couldn’t make the backup. Try again.') }; render(); });
  }

  // ---------- problem report ----------

  function reportCard() {
    const f = ui.reportForm || {};
    const log = logRead();
    return '<section class="card"><h2>' + tr('Report a problem') + '</h2>' +
      '<p class="hint">' + tr('Something wrong or confusing? Make a report file and send it to the developer. It shows exactly what your app saw, so the bug can be found and fixed.') + '</p>' +
      '<label class="field" for="report-note"><span>' + tr('What went wrong, and what did you expect?') + '</span>' +
      '<textarea id="report-note" rows="4" placeholder="' + esc(tr('Today’s limit shows ₹0, but I have money in my account')) + '">' + esc(f.note || '') + '</textarea></label>' +
      '<div class="callout warn"><b>' + tr('The report has your money data') + '</b><span class="hint">' +
      tr('Your amounts, payments, loans and the names you typed, and the app’s log ({n} events). It isn’t locked with a password, so send it only to the developer. Nothing is sent by itself.', { n: log.length }) +
      '</span></div>' +
      (f.error ? '<p class="bad" role="alert">' + esc(f.error) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="report-save">' + tr('Save report file') + '</button>' +
      '<button data-action="report-share">' + tr('Share report') + '</button></div>' +
      (log.length ? '<div class="row"><button class="link" data-action="report-clear">' + tr('Clear the log') + '</button></div>' : '') + '</section>';
  }

  // Everything needed to see the bug: the note, the numbers the app worked out today, the log and the data.
  function problemReport(note) {
    const t = today();
    let numbers;
    try {
      const r = Core.projectRunway(state, t);
      const z = Core.zoneStatus(state, t, r);
      numbers = { limit: Math.round(r.dailyAllowance), parts: r.limit, balance: r.balanceToday, zone: z.zone, endPace: Math.round(r.endPace), plan: r.plan };
    } catch (e) { numbers = { error: String(e && e.message), stack: String(e && e.stack).slice(0, 1500) }; }
    return JSON.stringify({
      kind: 'hisab-problem-report', version: 1, made: new Date().toISOString(), today: t,
      build: BUILD || 'browser', device: navigator.userAgent, screen: window.innerWidth + 'x' + window.innerHeight,
      lang: I18N.getLang(), theme: themeChoice() || 'phone', lock: !!lockCfg().on, ai: !!aiCfg().on,
      note, numbers, log: logRead(), state,
    }, null, 1);
  }

  function makeReport(how) {
    const note = ((document.getElementById('report-note') || {}).value || '').trim();
    ui.reportForm = { note };
    const t = today();
    const name = 'HisabSe-report-' + t + '.json';
    let text;
    try { text = problemReport(note); } catch (e) { ui.reportForm.error = tr('Couldn’t make the report. Try again.'); render(); return; }
    const done = (msg) => { ui.reportForm = null; rerenderKeepScroll(); toast(msg); };
    if (ShareFile && how === 'share') {
      ShareFile.share({ name, text, title: tr('Send the report'), mime: 'application/json' })
        .then(() => done(tr('Report ready. Send it to the developer.')), () => { ui.reportForm.error = tr('Couldn’t make the report. Try again.'); render(); });
      return;
    }
    if (ShareFile) {
      ShareFile.save({ name, text, mime: 'application/json' }).then((r) => {
        if (r && r.saved) done(tr('Report saved as {name}. Send that file to the developer.', { name: r.name || name }));
        else { ui.reportForm.error = tr('Not saved yet: pick a folder and tap Save on Android’s screen.'); render(); }
      }, () => { ui.reportForm.error = tr('Couldn’t make the report. Try again.'); render(); });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    done(tr('Report saved as {name}. Send that file to the developer.', { name }));
  }

  function restoreBackup() {
    const r = ui.restore || {};
    const text = r.paste ? ((document.getElementById('restore-text') || {}).value || '') : r.text;
    const pass = (document.getElementById('restore-pass') || {}).value || '';
    Core.openBackup(text, pass).then((data) => {
      state = migrate(Object.assign(emptyState(), data));
      if (r.info && r.info.date) state.lastBackup = r.info.date;
      ui.restore = null;
      save();
      toast(tr('Backup restored'));
      setTab('home');
    }, (e) => {
      ui.restore = Object.assign({}, r, { error: e.message === 'password'
        ? tr('That password doesn’t open this backup. Check for typos: capitals count.')
        : tr('That isn’t a Hisab Se backup.') });
      render();
    });
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
      (p.goals ? line('Savings goals', minus(p.goals)) : '') +
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
      (state.cards || []).map((c) => '<option value="' + esc(c.id) + '"' + (selected === c.id ? ' selected' : '') + '>' + cardLabel(c) + ' ' +
        tr('(credit card: free only if the whole bill is paid on time)') + '</option>').join('');
  }

  // The red line under a "Paid from" choice when it's a card.
  function borrowWarning(cardId) {
    const c = (state.cards || []).find((x) => x.id === cardId);
    if (!c) return '';
    // Today's spending goes on the next statement, not the one already issued.
    const due = Core.dueAfter(c, Core.statementOn(c, Core.addMonths(today(), 1)));
    return tr('Borrowed until you pay the bill due {date}. Counted as spent today. Pay that whole bill and it’s free; pay less, even the minimum, and interest of about 3.5% a month plus GST starts.', { date: fmtDate(due) });
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
      '<div class="meta">' + tr('Statement on the {statement}, due on the {due}', { statement: ordinal(c.statementDay), due: ordinal(c.dueDay) }) + '</div></div>' +
      '<button class="ghost" data-action="card-edit" data-id="' + esc(c.id) + '">' + tr('Edit') + '</button></div>' + meter +
      '<div class="summary">' +
      '<div class="line"><span>' + (st.statementDate ? tr('Bill from {date}', { date: fmtDate(st.statementDate) }) : tr('Bill')) + '</span><span>' + inr(st.total) + '</span></div>' +
      (st.paidSince ? '<div class="line"><span>' + tr('Paid so far') + '</span><span class="good">' + inr(st.paidSince) + '</span></div>' : '') +
      '<div class="line total"><span>' + (st.remaining ? tr('To pay by {date}', { date: fmtDate(st.due) }) : tr('Bill paid')) + '</span><span' + (st.overdue ? ' class="bad"' : '') + '>' + inr(st.remaining) + '</span></div>' +
      '<div class="line"><span>' + tr('Spent since (next bill)') + '</span><span>' + inr(st.unbilled) + '</span></div></div>';
    if (st.remaining && st.daysToDue <= 0 && c.answered !== st.due) {
      html += cardDueQuestion(c, st);
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
    // What was typed stays when a field needs fixing.
    const draft = ui.cardForm.draft || {};
    const f = (id, name, type, value, extra) => '<label class="field" for="' + id + '"><span>' + tr(name) + '</span><input id="' + id + '" type="' + type + '"' +
      (type === 'number' ? ' inputmode="numeric" min="0"' : '') + ' value="' + esc(draft[id] != null ? draft[id] : value == null ? '' : value) + '"' +
      (ui.cardForm.bad === id ? ' aria-invalid="true" aria-describedby="cf-error"' : '') + (extra || '') + '></label>';
    return '<div class="card-form"><h3>' + (c.id ? tr('Edit {card}', { card: cardLabel(c) }) : tr('Add a credit card')) + '</h3>' +
      '<div class="form-grid">' +
      f('cf-name', 'Name', 'text', c.name || '', ' placeholder="' + tr('HDFC card') + '"') +
      f('cf-last4', 'Last 4 digits', 'text', c.last4 || '', ' inputmode="numeric" maxlength="4" placeholder="1234"') +
      f('cf-limit', 'Credit limit (₹)', 'number', c.limit || '') +
      f('cf-stmt', 'Statement day', 'number', c.statementDay || '', ' max="31" placeholder="5"') +
      f('cf-due', 'Due day', 'number', c.dueDay || '', ' max="31" placeholder="25"') +
      '</div><p class="hint">' + tr('Statement day and due day are on your card statement or in your bank app.') + '</p>' +
      (c.id ? '' :
        '<p class="hint">' + tr('What you owe right now, from your card app or last statement:') + '</p><div class="form-grid">' +
        f('cf-owed', 'Amount due on last statement (₹)', 'number', '') +
        f('cf-owed-due', 'Its due date', 'date', '') +
        f('cf-unbilled', 'Spent since that statement (₹)', 'number', '') + '</div>') +
      (ui.cardForm.error ? '<p class="bad" id="cf-error" role="alert">' + esc(ui.cardForm.error) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="card-save">' + tr(c.id ? 'Save' : 'Add card') + '</button>' +
      '<button class="ghost" data-action="card-cancel">' + tr('Cancel') + '</button>' +
      (c.id ? '<span class="spacer"></span><button class="danger" data-action="card-remove" data-id="' + esc(c.id) + '">' + tr('Remove card') + '</button>' : '') + '</div></div>';
  }

  function saveCard() {
    const v = (id) => (document.getElementById(id) || {}).value || '';
    const name = v('cf-name').trim();
    const last4 = v('cf-last4').replace(/\D/g, '');
    const day = (x) => Math.min(31, Math.max(1, Math.round(Number(x) || 0)));
    ui.cardForm.draft = {};
    ['cf-name', 'cf-last4', 'cf-limit', 'cf-stmt', 'cf-due', 'cf-owed', 'cf-owed-due', 'cf-unbilled'].forEach((id) => {
      if (document.getElementById(id)) ui.cardForm.draft[id] = v(id);
    });
    const fail = (id, msg) => { ui.cardForm.error = msg; ui.cardForm.bad = id; ui.cardForm.focus = true; };
    if (!name) return fail('cf-name', tr('Give the card a name, like “HDFC card”.'));
    if (last4.length !== 4) return fail('cf-last4', tr('Enter the last 4 digits of the card number, so bank SMS can be matched to it.'));
    if (!Number(v('cf-stmt'))) return fail('cf-stmt', tr('Enter the statement day and due day from your card statement.'));
    if (!Number(v('cf-due'))) return fail('cf-due', tr('Enter the statement day and due day from your card statement.'));
    if ((state.cards || []).some((c) => c.last4 === last4 && c.id !== ui.cardForm.id)) return fail('cf-last4', tr('You already have a card ending {last4}.', { last4 }));
    const fields = { name, last4, limit: Math.max(0, Number(v('cf-limit')) || 0), statementDay: day(v('cf-stmt')), dueDay: day(v('cf-due')) };
    // A due date from before the last statement is the bill before last, and the latest bill would be missed.
    const owedDue = v('cf-owed-due');
    if (!ui.cardForm.id && Number(v('cf-owed')) > 0 && owedDue) {
      const lastSt = Core.statementOn(fields, today());
      if (owedDue <= lastSt) {
        return fail('cf-owed-due', tr('Your last statement was on {date}, so that is an older bill. Enter what is due on the {date} statement (due {due}), or 0 if it is paid.',
          { date: fmtDate(lastSt), due: fmtDate(Core.dueAfter(fields, lastSt)) }));
      }
    }
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
  // On the due date (or after): did the bill get paid?
  function cardDueQuestion(c, st) {
    const v = { card: cardLabel(c), amount: inr(st.remaining), date: fmtDate(st.due), min: inr(st.minLeft), fee: inr(Math.round(Core.cardLateFee(st.total) * 1.18)) };
    const part = ui.cardAnswer === c.id;
    const t = today();
    // The day the money left: the due date unless they paid earlier or later.
    const paidOn = '<label class="field" for="card-paid-on-' + esc(c.id) + '"><span>' + tr('Paid on') + '</span><input id="card-paid-on-' + esc(c.id) + '" type="date" max="' + t + '" value="' + (st.due && st.due <= t ? st.due : t) + '"></label>';
    return '<div class="callout ' + (st.overdue ? 'bad' : 'warn') + ' card-due"><b>' + tr(st.daysToDue === 0 ? '{card} bill of {amount} is due today. Did you pay it?' : '{card} bill of {amount} was due {date}. Did you pay it?', v) + '</b>' +
      paidOn +
      (part
        ? '<div class="row"><label class="field grow-field" for="card-paid"><span>' + tr('How much did you pay? (₹)') + '</span><input id="card-paid" type="number" inputmode="numeric" min="1" max="' + st.remaining + '"></label></div>' +
          '<div class="row"><button class="primary" data-action="card-answer" data-answer="part" data-id="' + esc(c.id) + '">' + tr('Save') + '</button><button class="ghost" data-action="card-answer-back">' + tr('Back') + '</button></div>'
        : '<div class="card-due-grid"><button class="primary" data-action="card-answer" data-answer="full" data-id="' + esc(c.id) + '">' + tr('Paid in full') + '</button>' +
          '<button data-action="card-answer-part" data-id="' + esc(c.id) + '">' + tr('Paid part') + '</button>' +
          '<button data-action="card-answer" data-answer="missed" data-id="' + esc(c.id) + '">' + tr('Missed it') + '</button>' +
          '<button data-action="card-answer-emi" data-id="' + esc(c.id) + '">' + tr('Converted to EMI') + '</button></div>') +
      '<span class="hint">' + tr('Paid in full: no interest. Anything less: interest of about 3.5% a month plus GST on what’s left. Less than the minimum ({min}) also adds a late fee of about {fee}.', v) + '</span></div>';
  }

  function cardHomeNotes(cyc) {
    const t = today();
    const cards = state.cards || [];
    if (!cards.length) return '';
    let html = '';
    cards.forEach((c) => {
      const st = Core.cardStatus(state, c, t);
      if (st.remaining > 0 && st.daysToDue <= 0 && c.answered !== st.due) html += cardDueQuestion(c, st);
      else if (st.remaining > 0 && st.daysToDue <= 7 && st.daysToDue > 0) {
        const v = { card: cardLabel(c), amount: inr(st.remaining), date: fmtDate(st.due), days: plural(st.daysToDue, 'day') };
        html += '<div class="callout warn"><b>' + tr(st.daysToDue === 1 ? '{card} bill: {amount} due tomorrow' : '{card} bill: {amount} due in {days}', v) + '</b>' +
          '<span class="hint">' + tr('Pay the whole {amount} by {date} and it costs nothing. Paying less, even the minimum, starts interest of about 3.5% a month plus GST. The money was kept aside when you spent it.', v) + '</span></div>';
      }
    });
    const onCards = state.transactions.filter((x) => Core.isFlexible(x) && x.paidFrom && x.paidFrom !== 'account' && Core.inCycle(x.date, cyc))
      .reduce((a, x) => a + x.amount, 0);
    if (onCards) {
      html += '<p class="hint card-note">' + tr('{amount} spent on credit cards this month. It’s counted as spent and kept aside for the bills.', { amount: inr(onCards) }) + '</p>';
    }
    return html;
  }

  // ---------- the debt journey ----------

  // Once per render: loan EMIs after their due dates, when the journey began, and where each round started.
  function tickJourney() {
    if (state.isDemo) return;
    const t = today();
    const before = JSON.stringify([state.debts, state.journey, state.rounds]);
    if (state.settings.salary) {
      const start = Core.cycleFor(t, Number(state.settings.payday) || 1).start;
      state.rounds = state.rounds || {};
      if (!state.rounds[start]) {
        state.rounds[start] = Core.roundSnapshot(state, t);
        Object.keys(state.rounds).sort().slice(0, -13).forEach((k) => { delete state.rounds[k]; });
      }
    }
    Core.tickDebts(state, t).forEach((d) => askRollover({ from: d.name || 'Your loan', amount: Number(d.minPayment) || 0, kind: 'loan' }));
    if (state.debts.some((d) => Number(d.balance) > 0)) {
      state.journey = state.journey || { start: t, calls: [] };
      const j = Core.debtJourney(state, t);
      if (j && j.best > (Number(state.journey.best) || 0)) state.journey.best = j.best;
    }
    if (JSON.stringify([state.debts, state.journey, state.rounds]) !== before) save(true);
  }

  const STAGES = [
    ['survive', 'Survive', 'Basics and every minimum paid, nothing new borrowed.'],
    ['stabilize', 'Stabilize', 'A cushion, so a bad week doesn’t mean a new loan.'],
    ['escape', 'Escape', 'One loan at a time, until none are left.'],
  ];

  function journeyCard() {
    const j = Core.debtJourney(state, today());
    if (!j) return '';
    if (j.stage === 'free') {
      return '<section class="card journey-card free"><h2>' + tr('Debt-free 🎉') + '</h2>' +
        '<p>' + tr('No loans left. Keep paying yourself what the EMIs used to take, and keep the card for what you can pay in full.') + '</p></section>';
    }
    const at = STAGES.findIndex((s) => s[0] === j.stage);
    const steps = '<ol class="journey-steps">' + STAGES.map((s, i) =>
      '<li class="' + (i < at ? 'done' : i === at ? 'now' : '') + '"' + (i === at ? ' aria-current="step"' : '') + '>' +
      '<span class="js-dot" aria-hidden="true">' + (i < at ? '✓' : i + 1) + '</span>' + tr(s[1]) + '</li>').join('') + '</ol>';
    // The wins on the way: each milestone ticks off once reached.
    const ms = (title, list, have) => '<div class="milestones"><span class="ms-title">' + tr(title) + '</span>' + list.map((n) =>
      '<span class="ms' + (have >= n ? ' won' : '') + '">' + (have >= n ? '✓ ' : '') + plural(n, 'day') + '</span>').join('') + '</div>';
    let wins = '';
    if (j.stage === 'survive' && j.clean !== null) wins = ms('Without borrowing', j.milestones.survive, j.clean);
    if (j.stage === 'stabilize') wins = ms('Days of Freedom', j.milestones.stabilize, j.fdays);
    return '<section class="card journey-card stage-' + j.stage + '"><div class="card-head">' + titled('Your way out of debt', 'journey') + '</div>' +
      steps +
      '<p class="journey-what"><b>' + tr(STAGES[at][1]) + ':</b> ' + tr(STAGES[at][2]) + '</p>' +
      wins +
      nextMove(j) +
      '<p class="hint">' + tr('Rent, food, medicine and school fees come first, and every minimum gets paid. The plan never asks you to skip them.') + '</p>' +
      '<button class="explain-link" data-action="explain" data-explain="journey">' + tr('How is this worked out?') + '</button></section>';
  }

  // The one next move for the stage, in the person's own numbers.
  function nextMove(j) {
    const n = j.next;
    let body = '';
    if (n.kind === 'gap') {
      const items = [];
      if (n.call) items.push(tr('<b>Call {name}</b> and ask for a longer tenure: EMI {emi} → {newEmi}, {less} less a month.', { name: esc(n.call.name), emi: inr(n.call.emi), newEmi: inr(n.call.newEmi), less: inr(n.call.less) }));
      if (n.cut) items.push(n.cut.kind === 'leaks'
        ? tr('<b>Halve your little leaks:</b> {amount} a month (they cost {total} now).', { amount: inr(n.cut.amount), total: inr(n.cut.total) })
        : tr('<b>Cut {name} by a fifth:</b> {amount} a month.', { name: label(n.cut.name), amount: inr(n.cut.amount) }));
      if (n.earn > 0) items.push(tr('<b>Add {amount} a month:</b> overtime, tuition, a weekend shift or selling something you don’t use.', { amount: inr(n.earn) }));
      // Small steps can't close a big gap alone: say so, with what can.
      if (n.earn > 0.2 * (Core.monthlyPlan(state, today()).salary || 0)) items.push(tr('<b>A gap this size needs one bigger change too:</b> ask every lender for a lower EMI, not just one, or move to a cheaper home when the lease ends.'));
      body = '<b>' + tr('Your salary is {gap} a month short of the basics and minimums. Close it in small steps:', { gap: inr(n.gap) }) + '</b>' +
        '<ol class="gap-steps">' + items.map((x) => '<li>' + x + '</li>').join('') + '</ol>' +
        '<span class="hint">' + tr('Never stop a minimum payment to close the gap: missed EMIs add fees and hurt your credit score.') + '</span>';
    } else if (n.kind === 'clean') {
      const soft = j.last && j.clean !== null && j.clean < 7
        ? ' ' + tr('Borrowed on {date}. It happens: the count starts again, and your best is {best} days.', { date: fmtDate(j.last), best: j.best }) : '';
      body = '<b>' + tr('Get through today without borrowing: no card, no loan app.') + '</b>' +
        '<span>' + tr(n.clean === 1 ? '{n} day so far; {goal} is the next win.' : '{n} days so far; {goal} is the next win.', { n: n.clean, goal: n.goal }) + soft + '</span>';
    } else if (n.kind === 'buffer') {
      body = '<b>' + tr(n.target === 1 ? 'Put {amount} in your emergency fund to reach {target} Day of Freedom.' : 'Put {amount} in your emergency fund to reach {target} Days of Freedom.', { amount: inr(n.amount), target: n.target }) + '</b>' +
        '<span>' + tr('A daily leftover moved to the fund counts. With a cushion, a surprise bill doesn’t become a new loan.') + '</span>' +
        '<div><button data-action="tab" data-tab="grow">' + tr('Open emergency fund') + '</button></div>';
    } else if (n.kind === 'extra') {
      body = '<b>' + tr('This month: {amount} extra on {name}, on top of every minimum.', { amount: inr(n.amount), name: esc(n.boss.name) }) + '</b>' +
        '<span>' + tr('Pay it with the EMI, then record it in Spend as money moved to that loan.') + '</span>';
    } else {
      body = '<b>' + tr('Even {amount} extra a month on {name} finishes {months} sooner and saves {saves} in interest.', { amount: inr(n.amount), name: esc(n.boss.name), months: plural(n.sooner, 'month'), saves: inr(n.saves) }) + '</b>' +
        '<span>' + tr('Set an extra amount for loans in the Plan tab.') + '</span>';
    }
    return '<div class="next-move"><span class="eyebrow">' + tr('Your next move') + '</span>' + body + '</div>';
  }

  // Each loan as a boss with a bar: what's left of its highest balance.
  function bossCard() {
    const j = Core.debtJourney(state, today());
    if (!j || j.stage === 'free') return '';
    const p = j.plans;
    const firstWin = (sim) => (sim.order[0] ? sim.order[0].month : null);
    const seg = '<div class="seg" role="group" aria-label="' + tr('Order to clear loans') + '">' +
      [['avalanche', 'Highest interest first'], ['snowball', 'Smallest first']].map((x) =>
        '<button data-action="payoff-order" data-order="' + x[0] + '" aria-pressed="' + (j.order === x[0]) + '">' + tr(x[1]) + '</button>').join('') + '</div>';
    let why = '';
    const sameFirst = j.bosses.length > 1 && p.avalanche.order[0] && p.snowball.order[0] && p.avalanche.totalInterest === p.snowball.totalInterest;
    if (sameFirst) {
      why = tr('Here both orders give the same plan: {name} is both the costliest and the smallest.', { name: esc(j.bosses[0].name) });
    } else if (j.bosses.length > 1 && !p.avalanche.neverPaysOff && !p.snowball.neverPaysOff) {
      why = j.order === 'avalanche'
        ? tr('Saves the most: {amount} in interest in all, against {other} smallest first.', { amount: inr(p.avalanche.totalInterest), other: inr(p.snowball.totalInterest) })
        : tr('Early wins: the first loan is gone in month {month}. Costs {amount} more interest than highest interest first.', { month: firstWin(p.snowball), amount: inr(Math.max(0, p.snowball.totalInterest - p.avalanche.totalInterest)) });
    }
    return '<section class="card boss-card"><div class="card-head">' + titled('Loans to beat', 'bosses') + '</div>' +
      (j.bosses.length > 1 ? seg + (why ? '<p class="hint">' + why + '</p>' : '') : '') +
      '<div class="bosses">' + j.bosses.map((b, i) => {
        const pct = Math.max(0, Math.min(100, b.left * 100));
        return '<div class="boss' + (i === 0 ? ' target' : '') + '"><div class="boss-top"><b>' + esc(b.name || tr('Loan')) + '</b>' +
          (i === 0 ? '<span class="chip chip-target">' + tr('Next target') + '</span>' : '') + '</div>' +
          '<div class="boss-bar" role="img" aria-label="' + esc(tr('{amount} left of {start}', { amount: inr(b.balance), start: inr(b.start) })) + '"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
          '<div class="boss-meta"><span>' + tr('{amount} left of {start}', { amount: inr(b.balance), start: inr(b.start) }) + '</span><span>' + tr('{rate}% · {interest} interest a month', { rate: b.rate, interest: inr(b.interest) }) + '</span></div>' +
          (b.lastEmi && b.lastEmi.off > 0 ? '<p class="hint">' + tr('−{amount} after the {date} EMI (worked out; check your loan app now and then).', { amount: inr(b.lastEmi.off), date: fmtDate(b.lastEmi.date) }) + '</p>' : '') +
          '</div>';
      }).join('') + '</div></section>';
  }

  const PREP = [
    'Your loan or card account number (in the app or a statement)',
    'This script, open on the screen',
    'Paper to note the person’s name and a reference number',
    'Call from the mobile number the lender has',
  ];

  function scriptBox(text) {
    return '<div class="script"><span class="eyebrow">' + tr('What to say') + '</span><p>' + text + '</p></div>';
  }

  function callTask(c, L) {
    const prep = '<details class="lesson prep"><summary>' + tr('5-minute prep') + '</summary><ul>' +
      PREP.map((x) => '<li>' + tr(x) + '</li>').join('') + '</ul></details>';
    const made = (task, id, kind, want) => '<div class="row"><button class="primary" data-action="call-made" data-task="' + task + '" data-debt="' + id + '" data-kind="' + kind + '"' + (want ? ' data-want="' + want + '"' : '') + '>' + tr('I made the call') + '</button></div>' +
      '<p class="hint">' + tr('Making the call is the win, whatever they say. Tomorrow we’ll ask how it went.') + '</p>';
    const block = (what, why, change, script) => '<p class="task-what"><b>' + what + '</b></p>' +
      '<p><span class="eyebrow">' + tr('Why it works') + '</span> ' + why + '</p>' +
      '<p><span class="eyebrow">' + tr('What it changes') + '</span> ' + change + '</p>' + scriptBox(script);
    if (c.key === 'list') {
      return '<p class="task-what"><b>' + tr('Add the interest rate, EMI and due day for: {names}.', { names: c.missing.map((x) => esc(x || tr('Loan'))).join(', ') }) + '</b></p>' +
        '<p><span class="eyebrow">' + tr('Why it works') + '</span> ' + tr('You can’t plan what you can’t see. Every date and script here uses these numbers.') + '</p>' +
        '<div><button data-action="goto-loans">' + tr('Fill them in') + '</button></div>';
    }
    if (c.key === 'easy' && c.kind === 'due') {
      const want = c.want;
      c = Object.assign({}, c, { day: nth(c.day), want: nth(c.want) });
      const payday = nth(Number(state.settings.payday) || 1);
      return block(
        tr('Ask {name} to move your EMI from the {day} to the {want}.', { name: esc(c.name), day: c.day, want: c.want }),
        tr('Your salary comes on the {payday}; by the {day} your account has had {after} days of spending. Lenders often agree to move a due date, sometimes for a small fee.', { payday, day: c.day, after: c.after }),
        tr('{emi} leaves when the account is fullest, so it’s less likely to bounce (a bounce often costs ₹500 or more).', { emi: inr(c.emi) }),
        tr('“Hello, I’m calling about my loan account. My salary comes on the {payday}, and my EMI of {emi} is due on the {day}. Can you move the due date to the {want}, so it’s always paid on time? Is there any charge for this?”', { payday, emi: inr(c.emi), day: c.day, want: c.want })) +
        prep + made('easy', c.debtId, 'due', want);
    }
    if (c.key === 'easy' && c.kind === 'fee') {
      return block(
        tr('Ask {name} to waive the late fee of {fee}.', { name: esc(c.name), fee: inr(c.fee) }),
        tr('Card companies often waive a first late fee when you ask, especially if you usually pay on time.'),
        tr('{fee} off what you owe on the card.', { fee: inr(c.fee) }),
        tr('“Hello, I missed my card payment this month and was charged a late fee of {fee}. I’ve set a reminder so it won’t happen again. Can you waive this fee as a one-time courtesy?”', { fee: inr(c.fee) })) +
        prep + made('easy', c.debtId, 'fee');
    }
    if (c.key === 'log') {
      const pct = Math.min(100, (c.logged / c.goal) * 100);
      return '<p class="task-what"><b>' + tr('Log every spend for 60 days, the bad days too.') + '</b></p>' +
        '<div class="bar-row"><div class="bar-top"><span>' + tr('{n} of {goal} days logged', { n: c.logged, goal: c.goal }) + '</span></div><div class="bar"><span style="width:' + pct.toFixed(1) + '%"></span></div></div>' +
        '<p><span class="eyebrow">' + tr('Why it works') + '</span> ' + tr('After two months Hisab Se knows your real numbers, and an ask backed by numbers is harder to refuse. Then it writes your offer for each lender.') + '</p>';
    }
    if (c.key === 'deal' && c.offer) {
      const o = c.offer;
      const v = { name: esc(o.name), rate: o.rate, target: o.target, emi: inr(o.emi), share: c.share, salary: inr(c.salary), balance: inr(o.balance) };
      const change = (o.saves === null
        ? tr('At today’s payments this never gets paid off; a lower rate is how it starts to shrink.')
        : tr('Saves about {saves} in interest', { saves: inr(o.saves) }) + (o.sooner > 0 ? ' ' + tr('and finishes {months} sooner.', { months: plural(o.sooner, 'month') }) : '.')) +
        (o.tenure ? '<br>' + tr('Or, while the salary is short: a longer tenure. EMI {emi} → {newEmi}, {less} less a month, but about {extra} more interest in all. Use it only to close the gap.', { emi: inr(o.emi), newEmi: inr(o.tenure.emi), less: inr(o.tenure.less), extra: inr(o.tenure.extraInterest) }) : '');
      const html = o.kind === 'emi'
        ? block(tr('Ask {name} to turn the {balance} you owe into an EMI at about {target}%.', v),
          tr('A carried card balance costs about {rate}% a year. Card companies offer EMIs on what you owe, at much lower rates, to customers who ask.', v),
          change,
          tr('“Hello, I have {balance} outstanding on my card. I want to pay it all, in fixed monthly amounts. Can you convert it to an EMI? What rate and processing fee can you offer?”', v))
        : block(tr('Ask {name} for a lower rate: {rate}% → {target}%.', v),
          tr('Keeping a customer who pays is cheaper for a lender than finding a new one. You’re asking with your real numbers, and you can mention a balance transfer.'),
          change,
          tr('“Hello, I’m calling about my loan account. I pay {emi} a month, and my loans take {share}% of my salary of {salary}. I want to keep paying you in full and on time. Can you lower my interest rate from {rate}% to {target}%? If not, what is the best rate you can offer an existing customer?”', v) +
          (o.tenure ? '<br>' + tr('If the salary is short: “Can you extend the tenure so the EMI comes down to about {newEmi}?”', { newEmi: inr(o.tenure.emi) }) : ''));
      return html + '<p class="hint">' + tr('If they say no: thank them, and ask what it would take. You can ask again in three months, or ask another bank about a balance transfer.') + '</p>' +
        (c.more ? '<p class="hint">' + tr(c.more === 1 ? 'Then {n} more loan to ask about.' : 'Then {n} more loans to ask about.', { n: c.more }) + '</p>' : '') +
        prep + made('deal', o.debtId, o.kind);
    }
    return '';
  }

  // "How did it go?": the day after a call.
  function followUp(f) {
    const d = state.debts.find((x) => x.id === f.debtId);
    const name = esc((d && d.name) || tr('your lender'));
    if (ui.callYes === f.id && f.kind !== 'fee') {
      const field = f.kind === 'due'
        ? '<label class="field" for="call-new"><span>' + tr('New due day') + '</span><input id="call-new" type="number" inputmode="numeric" min="1" max="31" value="' + esc(f.want || (d ? d.dueDay : '')) + '"></label>'
        : f.kind === 'emi'
          ? '<label class="field" for="call-new"><span>' + tr('EMI interest % a year') + '</span><input id="call-new" type="number" inputmode="decimal" min="0" step="0.1" value=""></label>' +
            '<label class="field" for="call-emi"><span>' + tr('EMI a month (₹)') + '</span><input id="call-emi" type="number" inputmode="numeric" min="0" value=""></label>'
          : '<label class="field" for="call-new"><span>' + tr('New interest % a year') + '</span><input id="call-new" type="number" inputmode="decimal" min="0" step="0.1" value=""></label>' +
            '<label class="field" for="call-emi"><span>' + tr('New EMI a month (₹), if it changed') + '</span><input id="call-emi" type="number" inputmode="numeric" min="0" value="' + esc(d ? d.minPayment : '') + '"></label>';
      return '<div class="callout good follow"><b>' + tr('Well done! What did {name} agree to?', { name }) + '</b><div class="form-grid">' + field + '</div>' +
        '<div class="row"><button class="primary" data-action="call-save" data-id="' + f.id + '">' + tr('Update my loan') + '</button><button class="ghost" data-action="call-cancel">' + tr('Back') + '</button></div></div>';
    }
    return '<div class="callout warn follow"><b>' + tr('How did your call to {name} go?', { name }) + '</b>' +
      '<div class="choices-row">' +
      '<button class="primary" data-action="call-result" data-id="' + f.id + '" data-result="yes">' + tr('They agreed') + '</button>' +
      '<button data-action="call-result" data-id="' + f.id + '" data-result="no">' + tr('They said no') + '</button>' +
      '<button data-action="call-result" data-id="' + f.id + '" data-result="later">' + tr('Call back or no answer') + '</button></div></div>';
  }

  const TASK_TITLES = { list: 'List every loan', easy: 'One easy call', log: '60 days of real numbers', deal: 'Ask for a better deal' };

  function lenderCard() {
    const t = today();
    const L = Core.lenderTasks(state, t);
    if (!L) return '';
    const steps = '<ol class="task-steps">' + L.tasks.map((x) =>
      '<li class="' + (x.done ? 'done' : L.current && L.current.key === x.key ? 'now' : '') + '">' + (x.done ? '✓ ' : '') + tr(TASK_TITLES[x.key]) +
      (x.key === 'easy' && x.done && x.skipped ? ' <span class="hint">' + tr('(not needed)') + '</span>' : '') + '</li>').join('') + '</ol>';
    return '<section class="card lender-card" id="lender-card"><div class="card-head">' + titled('Calls to your lenders', 'calls') +
      (L.made ? '<span class="chip chip-freedom">' + tr(L.made === 1 ? '{n} call made' : '{n} calls made', { n: L.made }) + '</span>' : '') + '</div>' +
      (L.follow ? followUp(L.follow) : '') +
      steps +
      (L.pending && !L.follow ? '<div class="callout">' + tr('You called {name} on {date}. Tomorrow Hisab Se asks how it went.', { name: esc(((state.debts.find((x) => x.id === L.pending.debtId)) || {}).name || tr('your lender')), date: fmtDate(L.pending.date) }) +
        '<div><button data-action="call-now" data-id="' + L.pending.id + '">' + tr('Tell how it went now') + '</button></div></div>' : '') +
      (L.pending ? '' : L.current ? '<div class="task">' + callTask(L.current, L) + '</div>'
        : '<p class="good">' + tr('Every call on the list is done. New loans or rates of 12% and above will show up here.') + '</p>') +
      '<p class="hint">' + tr('Hisab Se gives you the plan and the honest numbers. What the lender says is up to them.') + '</p></section>';
  }

  // The day after a call, on the Runway tab too.
  function followBanner() {
    const L = state.isDemo ? null : Core.lenderTasks(state, today());
    if (!L || !L.follow) return '';
    const d = state.debts.find((x) => x.id === L.follow.debtId);
    return '<div class="callout warn"><b>' + tr('How did your call to {name} go?', { name: esc((d && d.name) || tr('your lender')) }) + '</b>' +
      '<div><button data-action="tab" data-tab="debts">' + tr('Tell Hisab Se') + '</button></div></div>';
  }

  // What if I paid more? A slider that tries amounts without changing the plan, and each loan's finish on one line.
  function whatIfMax(extra) {
    const salary = Core.salaryFor(state, today()) || 0;
    return Math.max(5000, Math.ceil(Math.max(salary * 0.3, extra * 2) / 500) * 500);
  }

  function whatIfResult(debts, extra, tryAmount) {
    const t = today();
    const how = Core.payoffOrder(state);
    const now = Core.simulateDebts(debts, extra, how, true);
    const res = Core.simulateDebts(debts, tryAmount, how, true);
    if (res.neverPaysOff) return '<p class="bad">' + tr('Never paid off: a minimum payment is smaller than the monthly interest.') + '</p>';
    const sooner = now.neverPaysOff ? null : now.months - res.months;
    const saved = now.neverPaysOff ? 0 : now.totalInterest - res.totalInterest;
    const max = Math.max(1, res.months);
    const line = tryAmount === extra ? tr('Your plan now: debt-free in {date}.', { date: monthYear(Core.addMonths(t, res.months)) })
      : sooner === null ? tr('Debt-free in {date}.', { date: monthYear(Core.addMonths(t, res.months)) })
        : sooner >= 0 ? tr('Debt-free in {date}: {n} sooner, {amount} less interest.', { date: monthYear(Core.addMonths(t, res.months)), n: plural(sooner, 'month'), amount: inr(Math.max(0, saved)) })
          : tr('Debt-free in {date}: {n} later, {amount} more interest.', { date: monthYear(Core.addMonths(t, res.months)), n: plural(-sooner, 'month'), amount: inr(Math.max(0, -saved)) });
    return '<p class="whatif-line"><b>' + line + '</b></p>' +
      '<div class="loan-lines">' + res.order.map((o) => '<div class="loan-line"><span class="loan-name">' + esc(o.name) + '</span>' +
        '<span class="loan-track"><span class="loan-fill" style="width:' + Math.max(3, (o.month / max) * 100).toFixed(1) + '%"></span></span>' +
        '<span class="loan-when">' + monthYear(Core.addMonths(t, o.month)) + '</span></div>').join('') + '</div>' +
      (tryAmount > extra ? '<p class="hint">' + tr('Your flexible budgets would get {amount} less each month.', { amount: inr(tryAmount - extra) }) + '</p>' : '') +
      (tryAmount !== extra ? '<div class="row"><button class="primary" data-action="whatif-use" data-amount="' + tryAmount + '">' + tr('Make {amount} a month my plan', { amount: inr(tryAmount) }) + '</button></div>' : '');
  }

  function whatIfBlock(debts, extra) {
    const v = ui.whatIf != null ? ui.whatIf : extra;
    return '<div class="whatif callout"><b>' + tr('What if I paid more each month?') + '</b>' +
      '<label class="field" for="debt-whatif"><span>' + tr('Extra on top of minimums') + ': <b id="whatif-amount">' + inr(v) + '</b></span>' +
      '<input id="debt-whatif" type="range" min="0" max="' + whatIfMax(extra) + '" step="500" value="' + v + '"></label>' +
      '<div id="whatif-out">' + whatIfResult(debts, extra, v) + '</div>' +
      '<span class="hint">' + tr('Trying amounts here changes nothing until you tap the button.') + '</span></div>';
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
        '</div>' + whatIfBlock(debts, extra) + '</section>';
    }

    const L = Core.lenderTasks(state, t);
    const j = Core.debtJourney(state, t);
    const cardsDue = (state.cards || []).filter((c) => { const st = Core.cardStatus(state, c, t); return st.remaining > 0 && st.daysToDue <= 7; }).length;
    const loansCard =
      '<section class="card" id="loans-card"><div class="card-head">' + titled('Loans', 'loans') + '</div>' +
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
      '</section>';
    const noDebts = !state.debts.some((d) => Number(d.balance) > 0) && !(state.cards || []).length;
    return hub('debts',
      rolloverCard() +
      (noDebts
        ? '<section class="card debt-picture"><h2>' + tr('Your debt picture') + '</h2>' +
          '<p class="good"><b>' + tr('No loans or credit cards added. Debt-free ✓') + '</b></p>' +
          '<p class="hint">' + tr('Have a loan, an EMI or a credit card? Add it, so your plan and dates count it.') + '</p>' +
          '<div class="row"><button data-action="page-open" data-key="loans">' + tr('Add a loan') + '</button><button data-action="page-open" data-key="cards">' + tr('Add a credit card') + '</button></div></section>'
        : '') +
      journeyCard() +
      leakBanner() +
      (L && L.follow ? '<section class="card">' + followUp(L.follow) + '</section>' : ''), [
        { key: 'bosses', group: 'Your loans', icon: 'target', label: 'Loans to beat', tone: 'coral', hide: !j || j.stage === 'free',
          badge: j && j.bosses ? { text: shortInr(j.bosses.reduce((a, b) => a + b.balance, 0)) } : null, html: () => bossCard() },
        { key: 'loans', group: 'Your loans', icon: 'loan', label: 'Loans', tone: 'coral',
          badge: state.debts.length ? { text: String(state.debts.filter((d) => d.balance > 0).length) } : { text: tr('Add'), tone: '' }, html: () => loansCard },
        { key: 'plans', group: 'Your loans', icon: 'plans', label: 'Debt-free plans', tone: 'coral', hide: !compare, badge: null, html: () => compare },
        { key: 'cards', group: 'Cards & calls', icon: 'card', label: 'Credit cards', tone: 'teal',
          badge: cardsDue ? { text: tr('{n} due', { n: cardsDue }), tone: 'bad' } : (state.cards || []).length ? { text: String(state.cards.length) } : null, html: () => cardsSection() },
        { key: 'calls', group: 'Cards & calls', icon: 'phone', label: 'Calls to lenders', tone: 'teal', hide: !L,
          badge: L && L.pending ? { text: '?', tone: 'bad' } : L && L.current ? { text: tr('Next') } : L ? { text: '✓', tone: 'good' } : null, html: () => lenderCard() },
      ]);
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
      ['Emergency fund', p.emergency], ['Extra toward debts', p.debtExtra], ['Grow budget', p.invest], ['Yearly costs', p.sinking], ['Savings goals', p.goals],
    ].filter((x) => x[1] > 0);

    return hub('grow',
      (movedThisCycle ? '<div class="callout good"><b>' + tr('{amount} saved from daily leftovers this month', { amount: inr(movedThisCycle) }) + '</b><span class="hint">' + tr('Every unspent day you move to savings or a loan gets you closer to a loan-free life.') + '</span></div>' : '') +
      '<section class="card">' + freedomHeader() +
      '<div class="form-grid">' + numInput('emergency-balance', 'savings.emergencyBalance', sv.emergencyBalance, 'Saved so far (₹)') +
      '<label class="field" for="emergency-target"><span>' + tr('Target') + '</span><select id="emergency-target" data-bind="savings.emergencyTargetMonths">' +
      [3, 6].map((m) => '<option value="' + m + '"' + (Number(sv.emergencyTargetMonths) === m ? ' selected' : '') + '>' + plural(m, 'month') + '</option>').join('') + '</select></label></div>' +
      '<div class="bar-row"><div class="bar-top"><span>' + tr('{amount} of {target}', { amount: inr(sv.emergencyBalance), target: inr(target) }) + '</span><span class="amt">' + Math.round(fundPct) + '%</span></div>' +
      '<div class="bar"><span style="width:' + fundPct.toFixed(1) + '%"></span></div></div>' +
      '<p class="hint">' + fundNote + '</p>' +
      '</section>' +
      '', [
        { key: 'setaside', group: 'Save', icon: 'shield', label: 'This month’s set-aside', tone: 'mint',
          badge: setAside.length ? (recorded ? { text: '✓', tone: 'good' } : { text: shortInr(setAside.reduce((a, x) => a + x[1], 0)) }) : null, html: () =>
      '<section class="card"><div class="card-head">' + titled('This month’s set-aside', 'setaside') + '<span class="hint">' + tr('Cycle starting {date}', { date: fmtDate(cyc.start) }) + '</span></div>' +
      (setAside.length
        ? '<div class="summary">' + setAside.map((x) => '<div class="line"><span>' + tr(x[0]) + '</span><span>' + inr(x[1]) + '</span></div>').join('') + '</div>' +
          (recorded
            ? '<p class="good">' + tr('Recorded for this cycle. Your balances below include it.') + '</p>'
            : '<div><button class="primary" data-action="record-savings">' + tr('I’ve moved this money aside') + '</button></div>')
        : '<p class="hint">' + tr('Nothing set aside yet. Add amounts in the Plan tab.') + '</p>') +
      '</section>' },
        { key: 'goals', group: 'Save', icon: 'target', label: 'Savings goals', tone: 'mint',
          badge: (() => { const gs = state.goals || []; const late = gs.filter((g) => Core.goalStatus(state, g, t).late).length; return late ? { text: '!', tone: 'bad' } : gs.length ? { text: String(gs.length) } : null; })(), html: () => goalsCard() },
        { key: 'yearly', group: 'Save', icon: 'pot', label: 'Yearly costs', tone: 'mint', hide: !state.sinking.length, badge: { text: String(state.sinking.length) }, html: () =>
      (state.sinking.length
        ? '<section class="card"><h2>' + tr('Yearly costs') + '</h2><div class="bars">' + state.sinking.map((f) => {
          const saved = Number(f.saved) || 0;
          const pct = f.amount > 0 ? Math.min(100, (saved / f.amount) * 100) : 0;
          return '<div class="bar-row"><div class="bar-top"><span>' + esc(f.name) + ' · ' + monthName((Number(f.month) || 1) - 1) + '</span><span class="amt">' + tr('{amount} of {target}', { amount: inr(saved), target: inr(f.amount) }) + '</span></div>' +
            '<div class="bar"><span class="marigold" style="width:' + pct.toFixed(1) + '%"></span></div></div>';
        }).join('') + '</div></section>'
        : '') },
        { key: 'emergency', group: 'Save', icon: 'big', label: 'Emergency plan', tone: 'mint', badge: state.adjustment ? { text: tr('On'), tone: 'bad' } : null, html: () => viewEmergency() },
        { key: 'invest', group: 'Grow & learn', icon: 'sprout', label: 'Grow', tone: 'teal', badge: sv.investSaved ? { text: shortInr(sv.investSaved) } : null, html: () =>
      '<section class="card"><div class="card-head">' + titled('Grow', 'grow') + '<span class="hint">' + tr('Money set aside to invest') + '</span></div>' +
      '<div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
      tile('Set aside so far', inr(sv.investSaved), 'From your Grow budget') +
      tile('Each month', inr(p.invest), p.invest ? 'Grow budget' : 'Not started yet') + '</div>' +
      '<div class="callout"><b>' + tr('Ready to invest this money?') + '</b>' +
        '<span>' + tr('Before investing, talk to a <b>SEBI-registered investment adviser</b>. All investments carry risk.') + '</span></div>' +
      '</section>' },
        { key: 'learn', group: 'Grow & learn', icon: 'book', label: 'Learn the basics', tone: 'teal', badge: null, html: () =>
      '<section class="card"><h2>' + tr('Learn the basics') + '</h2>' + LESSONS.map((l) =>
        '<details class="lesson"><summary>' + tr(l[0]) + '</summary><p>' + tr(l[1]) + '</p></details>').join('') + '</section>' },
      ]);
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
      case 'fixed': return { id: uid(), name: '', amount: 0, dueDay: '' };
      case 'debts': return { id: uid(), name: '', balance: 0, rate: 0, minPayment: 0, dueDay: '' };
      case 'sinking': return { id: uid(), name: '', amount: 0, month: 1, saved: 0 };
      case 'bills': return { id: uid(), name: '', estimate: 0, everyMonths: 1, nextDue: today(), added: today() };
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

  document.addEventListener('input', (ev) => {
    const i = ev.target.dataset && ev.target.dataset.splitAmt;
    if (i === undefined || !ui.split) return;
    ui.split.parts[Number(i)].amount = Math.max(0, Math.round(Number(ev.target.value) || 0));
    const x = state.transactions.find((t) => t.id === ui.editTx);
    const box = document.querySelector('.split-box');
    if (x && box) {
      // Only the "adds up" line and the save button change while typing.
      const left = x.amount - ui.split.parts.reduce((a, p) => a + (Number(p.amount) || 0), 0);
      const hint = box.querySelector('.row .hint');
      hint.className = 'hint ' + (left === 0 ? 'good' : 'bad');
      hint.textContent = left === 0 ? tr('Adds up ✓') : left > 0 ? tr('{amount} still to share out', { amount: inr(left) }) : tr('{amount} too much', { amount: inr(-left) });
      box.querySelector('[data-action=split-save]').disabled = left !== 0;
    }
  });

  let searchTimer;
  document.addEventListener('input', (ev) => {
    if (ev.target.id !== 'debt-whatif') return;
    ui.whatIf = Number(ev.target.value) || 0;
    const debts = state.debts.filter((d) => Number(d.balance) > 0);
    const extra = Core.allocate(state, today()).savings.debtExtra;
    document.getElementById('whatif-amount').textContent = inr(ui.whatIf);
    document.getElementById('whatif-out').innerHTML = whatIfResult(debts, extra, ui.whatIf);
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id !== 'tx-search') return;
    ui.txSearch = ev.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      rerenderKeepScroll();
      const el = document.getElementById('tx-search');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 200);
  });

  document.addEventListener('click', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('help-overlay')) {
      ui.helpFrom = ui.help; ui.help = null; rerenderKeepScroll(); return;
    }
    if (ev.target.classList && ev.target.classList.contains('borrow-overlay')) { ui.borrow = null; rerenderKeepScroll(); return; }
    if (ev.target.classList && ev.target.classList.contains('edit-overlay')) { ui.editTx = null; rerenderKeepScroll(); return; }
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    const t = today();
    logEvent('tap', { action: a, key: btn.dataset.key || undefined, to: btn.dataset.tab || undefined, id: btn.dataset.id || undefined });
    switch (a) {
      case 'tab': setTab(btn.dataset.tab); return;
      case 'page-open':
        if (btn.dataset.viz) {
          ui.viz = btn.dataset.viz;
          try { localStorage.setItem(VIZ_KEY, ui.viz); } catch (e) { /* private mode */ }
        }
        openPage(btn.dataset.tab || tab, btn.dataset.key);
        return;
      case 'tx-show': ui.txShow = btn.dataset.show; break;
      case 'wallet-add': ui.walletForm = {}; ui.moveForm = null; ui.walletBalances = false; break;
      case 'wallet-form-cancel': ui.walletForm = null; break;
      case 'move-open': ui.moveForm = {}; ui.walletForm = null; ui.walletBalances = false; break;
      case 'move-form-cancel': ui.moveForm = null; break;
      case 'wallet-balance-open': ui.walletBalances = true; ui.walletForm = null; ui.moveForm = null; break;
      case 'wallet-balance-cancel': ui.walletBalances = false; break;
      case 'wallet-remove': {
        // A wallet's payments go back to the main account, so nothing is lost.
        const before = JSON.stringify(state);
        const id = btn.dataset.id;
        const w = (state.wallets || []).find((x) => x.id === id);
        state.wallets = (state.wallets || []).filter((x) => x.id !== id);
        state.transactions.forEach((x) => { if (x.wallet === id) delete x.wallet; });
        state.transactions.forEach((x) => { if (Core.isTransfer(x)) { if (x.from === id) x.from = 'main'; if (x.to === id) x.to = 'main'; } });
        state.transactions = state.transactions.filter((x) => !(Core.isTransfer(x) && x.from === x.to));
        save();
        rerenderKeepScroll();
        offerUndo(tr('{name} removed', { name: w ? w.name : '' }), before);
        return;
      }
      case 'split-open': {
        const x = state.transactions.find((t) => t.id === ui.editTx);
        if (x) ui.split = { id: x.id, parts: [{ category: x.category, amount: x.amount }, { category: 'Misc', amount: 0 }] };
        break;
      }
      case 'goal-add': ui.goalForm = {}; break;
      case 'goal-cancel': ui.goalForm = null; break;
      case 'goal-remove': {
        const before = JSON.stringify(state);
        const g = (state.goals || []).find((x) => x.id === btn.dataset.id);
        state.goals = (state.goals || []).filter((x) => x.id !== btn.dataset.id);
        save();
        rerenderKeepScroll();
        offerUndo(tr('{name} removed', { name: g ? g.name : '' }), before);
        return;
      }
      case 'budget-use': {
        const b = state.budgets.find((x) => x.id === btn.dataset.id);
        if (!b) return;
        const before = JSON.stringify(state);
        b.amount = Number(btn.dataset.amount) || 0;
        b.auto = false;
        save(); rerenderKeepScroll();
        offerUndo(tr('{category}: {amount}', { category: label(b.name), amount: inr(b.amount) }), before);
        return;
      }
      case 'budget-all': {
        const h = Core.budgetHistory(state, today());
        const before = JSON.stringify(state);
        state.budgets.forEach((b) => { if (h[b.name]) { b.amount = btn.dataset.use === 'avg' ? h[b.name].avg : h[b.name].last; b.auto = false; } });
        save(); rerenderKeepScroll();
        const a = Core.allocate(state, today());
        offerUndo(a.pool - a.customTotal < 0 ? tr('Budgets set. They add up to {amount} more than you have.', { amount: inr(a.customTotal - a.pool) }) : tr('Budgets set from what you really spent'), before);
        return;
      }
      case 'whatif-use': {
        // The total extra includes what cleared loans pass on, so only the rest is typed in.
        const before = JSON.stringify(state);
        const a = Core.allocate(state, today());
        state.savings.emergencyMonthly = a.savings.emergencyMonthly - a.rollover.emergency;
        state.savings.investMonthly = a.savings.investMonthly - a.rollover.grow;
        state.savings.debtExtra = Math.max(0, Number(btn.dataset.amount) - a.rollover.debt);
        state.savings.auto = false;
        ui.whatIf = null;
        save(); rerenderKeepScroll();
        offerUndo(tr('{amount} a month extra to loans', { amount: inr(Number(btn.dataset.amount)) }), before);
        return;
      }
      case 'ai-setup': openProfile(); openPage('profile', 'ai'); return;
      case 'ai-off': saveAiCfg(Object.assign(aiCfg(), { on: false })); toast(tr('The weekly plan is off. Nothing is sent.')); break;
      case 'ai-show-facts': ui.aiFacts = !ui.aiFacts; break;
      case 'plan-make': requestPlan(); return;
      case 'fraud-ok': state.fraudOk = (state.fraudOk || []).concat(btn.dataset.id).slice(-300); save(); toast(tr('Marked as yours')); break;
      case 'tx-unlink': {
        const x = state.transactions.find((t) => t.id === ui.editTx);
        if (!x || !x.matched) return;
        const before = JSON.stringify(state);
        const m = x.matched;
        const tx = { id: uid(), date: m.date, amount: x.amount, note: m.merchant, source: 'sms', smsKey: x.smsKey };
        if (m.type === 'credit') Object.assign(tx, { kind: 'in', category: 'Money received', useFor: null });
        else { tx.category = m.category || 'Misc'; tx.needsReview = true; if (m.paidFrom) tx.paidFrom = m.paidFrom; else if (m.wallet) tx.wallet = m.wallet; }
        delete x.smsKey; delete x.matched;
        state.transactions.push(tx);
        ui.editTx = null;
        save(); rerenderKeepScroll();
        offerUndo(tr('Added the SMS as its own payment'), before);
        return;
      }
      case 'reconcile-close': ui.reconcile = null; break;
      case 'reconcile-note': {
        const r = ui.reconcile;
        if (!r || r.ok) return;
        const before = JSON.stringify(state);
        const cat = (document.getElementById('rec-cat') || {}).value;
        // Dated yesterday, before this morning's balance, so it never changes today's limit.
        const tx = { id: uid(), date: Core.addDays(today(), -1), amount: Math.abs(r.gap), note: tr('Found at balance check'), source: 'reconcile', gap: true };
        if (r.gap > 0) tx.category = cat || 'Misc';
        else Object.assign(tx, { kind: 'in', category: cat || 'Refund', useFor: 'spend' });
        state.transactions.push(tx);
        ui.reconcile = null;
        save(); rerenderKeepScroll();
        offerUndo(tr('{amount} noted', { amount: inr(tx.amount) }), before);
        return;
      }
      case 'where-period': ui.wherePeriod = btn.dataset.period; ui.whereOpen = null; break;
      case 'where-open': ui.whereOpen = ui.whereOpen === btn.dataset.cat ? null : btn.dataset.cat; showVizTip(btn); break;
      case 'cover-open': ui.cover = { to: btn.dataset.cat }; break;
      case 'cover-cancel': ui.cover = null; break;
      case 'split-add': if (ui.split) ui.split.parts.push({ category: 'Misc', amount: 0 }); break;
      case 'split-remove': if (ui.split) ui.split.parts.splice(Number(btn.dataset.i), 1); break;
      case 'split-cancel': ui.split = null; break;
      case 'split-save': saveSplit(); return;
      case 'cal-day': ui.calDay = btn.dataset.day; break;
      case 'cal-month': ui.calMonth = btn.dataset.month; ui.calDay = null; break;
      case 'tx-edit': ui.editTx = btn.dataset.id; ui.editError = ''; ui.editFocus = true; break;
      case 'edit-save': saveEdit(); return;
      case 'edit-cancel': ui.editTx = null; ui.editError = ''; ui.split = null; break;
      case 'undo': undoLast(); return;
      case 'page-back':
        if (history.state && history.state.page) history.back(); else closePage();
        return;
      case 'profile-open': openProfile(); return;
      case 'profile-close':
        if (history.state && history.state.profile) history.back(); else closeProfile();
        return;
      case 'set-theme':
        try { if (btn.dataset.theme) localStorage.setItem(THEME_KEY, btn.dataset.theme); else localStorage.removeItem(THEME_KEY); } catch (e) { /* private mode */ }
        applyTheme(btn.dataset.theme);
        break;
      case 'lock-on': lockOn(); return;
      case 'lock-off': lockOff(); return;
      case 'lock-settings': Promise.resolve().then(() => AppLock.openSettings()).catch(() => {}); ui.lockStatus = null; return;
      case 'unlock': unlockApp(); return;
      case 'lock-reset': ui.lockReset = true; renderLock(); return;
      case 'lock-reset-no': ui.lockReset = false; renderLock(); return;
      case 'lock-reset-yes':
        // The key is gone: clear the unreadable data and open the restore screen.
        try { [KEY, LOCK_KEY].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
        Promise.resolve().then(() => AppLock.disable()).catch(() => {});
        sealedBlob = null; dataKey = null; locked = false; ui.lockReset = false; ui.lockError = '';
        state = emptyState(); save();
        ui.restore = {};
        if (!booted) boot();
        openPage('profile', 'data');
        return;
      case 'tour-open': ui.tour = true; ui.tourStep = 0; break;
      case 'tour-next': ui.tourStep = (ui.tourStep || 0) + 1; break;
      case 'tour-back': ui.tourStep = Math.max(0, (ui.tourStep || 0) - 1); break;
      case 'tour-skip': case 'tour-done': tourEnd(); return;
      case 'start-own':
        state = emptyState();
        state.onboarding = { step: 1 };
        ui.onboardHidden = false; ui.onboardFocus = true;
        save(); setTab('home'); return;
      case 'onboard-next': onboardNext(); break;
      case 'onboard-back': if (state.onboarding && state.onboarding.step > 1) { state.onboarding.step--; ui.onboardError = ''; ui.onboardFocus = true; save(); } break;
      case 'onboard-later': ui.onboardHidden = true; toast('Your setup is saved. Finish it any time from the Plan tab.'); break;
      case 'onboard-resume': ui.onboardHidden = false; ui.onboardFocus = true; break;
      case 'onboard-add-loan': {
        onboardKeepLoans();
        state.onboarding.loans = (state.onboarding.loans || []).concat({});
        save(); break;
      }
      case 'onboard-no-debts': state.onboarding.step = 5; ui.onboardFocus = true; save(); break;
      case 'onboard-sms': {
        finishOnboarding();
        readNativeSms(false);
        return;
      }
      case 'onboard-finish': finishOnboarding(); return;
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
      case 'report-save': makeReport('save'); return;
      case 'report-share': makeReport('share'); return;
      case 'report-clear':
        logList = [];
        try { localStorage.removeItem(LOG_KEY); } catch (e) { /* private mode */ }
        toast(tr('Log cleared')); break;
      case 'wipe-cancel': ui.confirmWipe = false; break;
      case 'wipe-confirm':
        // Everything the app keeps: its storage here, and the widget, SMS alerts, notifications and shared files.
        try { [KEY, LANG_KEY, CHART_KEY, VIZ_KEY, LOCK_KEY, THEME_KEY, TOUR_KEY, LOG_KEY].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
        logList = [];
        dataKey = null;
        applyTheme('');
        if (SpendWidget) Promise.resolve().then(() => SpendWidget.eraseAll()).catch(() => {});
        state = emptyState(); ui.confirmWipe = false; ui.backupForm = null; ui.restore = null; save(); toast('All data erased'); break;
      case 'viz-view':
        ui.viz = btn.dataset.view;
        try { localStorage.setItem(VIZ_KEY, ui.viz); } catch (e) { /* private mode */ }
        break;
      case 'viz-tip': showVizTip(btn); return;
      case 'leak-tag': ui.leakTag = !ui.leakTag; break;
      case 'leak-yes':
        state.leakRules = Object.assign({}, state.leakRules, { [btn.dataset.payee]: btn.dataset.leak });
        save(); break;
      case 'leak-no':
        state.leakDeclined = (state.leakDeclined || []).concat(btn.dataset.payee).slice(-200);
        save(); break;
      case 'leak-goal': {
        const x = Core.leakSummary(state, t).leaks.find((l) => l.name === btn.dataset.leak);
        if (x) {
          state.leakGoals = Object.assign({}, state.leakGoals, { [x.name]: { cycle: Core.cycleFor(t, Number(state.settings.payday) || 1).start, pct: 20, base: x.perMonth, from: t, spentBefore: x.thisRound } });
          save();
          const g = Core.leakSummary(state, t).leaks.find((l) => l.name === x.name).goal;
          toast(tr('Challenge on: keep {leak} under {amount} this round.', { leak: leakLabel(x.name).toLowerCase(), amount: inr(g.target) }));
        }
        break;
      }
      case 'leak-own-add': {
        const name = ((document.getElementById('leak-own') || {}).value || '').trim().slice(0, 30);
        if (!name) return;
        if (Core.leakNames(state).indexOf(name) === -1) state.customLeaks = (state.customLeaks || []).concat(name);
        save(); toast(tr('{name} added. Pick it for the places where you pay for it.', { name }));
        break;
      }
      case 'explain': ui.explain = btn.dataset.explain; break;
      case 'explain-close': ui.explain = null; break;
      case 'payoff-order':
        state.settings.payoffOrder = btn.dataset.order === 'snowball' ? 'snowball' : 'avalanche';
        save(); break;
      case 'goto-loans': {
        openPage('debts', 'loans');
        const card = document.getElementById('loans-card');
        if (!card) return;
        const first = Array.from(card.querySelectorAll('input')).find((i) => !i.value || i.value === '0');
        if (first) first.focus({ preventScroll: true });
        return;
      }
      case 'call-made': {
        state.journey = state.journey || { start: t, calls: [] };
        state.journey.calls = (state.journey.calls || []).concat(Object.assign({ id: uid(), task: btn.dataset.task, debtId: btn.dataset.debt, kind: btn.dataset.kind, date: t, follow: Core.addDays(t, 1) },
          btn.dataset.want ? { want: Number(btn.dataset.want) } : {}));
        save();
        celebrate(tr('You made the call. That’s the hard part, whatever they said. Tomorrow: how did it go?'));
        break;
      }
      case 'call-result': {
        const c = ((state.journey || {}).calls || []).find((x) => x.id === btn.dataset.id);
        if (!c) return;
        const r = btn.dataset.result;
        if (r === 'yes' && c.kind === 'fee') {
          const d = state.debts.find((x) => x.id === c.debtId);
          if (d && Number(d.lateFee) > 0) {
            d.balance = Math.max(0, (Number(d.balance) || 0) - Number(d.lateFee));
            delete d.lateFee;
          }
          c.result = 'yes';
          save(); celebrate(tr('Late fee waived. That money stays with you.'));
          break;
        }
        if (r === 'yes') { ui.callYes = c.id; break; }
        c.result = r;
        save();
        toast(r === 'no'
          ? tr('Now you know, and asking was the hard part. Hisab Se moves on to the next step.')
          : tr('Try again when you can. The task stays open.'));
        break;
      }
      case 'call-cancel': ui.callYes = null; break;
      case 'week-done':
        state.recapSeen = t;
        save();
        if (btn.dataset.good) celebrate(tr('Another week closer to a loan-free life.'));
        break;
      case 'call-now': {
        const c = ((state.journey || {}).calls || []).find((x) => x.id === btn.dataset.id);
        if (c) { c.follow = t; save(); }
        break;
      }
      case 'call-save': {
        const c = ((state.journey || {}).calls || []).find((x) => x.id === btn.dataset.id);
        const d = c && state.debts.find((x) => x.id === c.debtId);
        if (!c) return;
        const val = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? Number(el.value) : null; };
        const v = val('call-new');
        const emi = val('call-emi');
        if (d && c.kind === 'due' && v >= 1 && v <= 31) {
          d.dueDay = Math.round(v);
        } else if (d && c.kind === 'emi') {
          // The card balance became an EMI: a loan at the new rate, paid through the card.
          if (v !== null && v >= 0) d.rate = v;
          if (emi > 0) d.minPayment = Math.round(emi);
          d.name = d.name.replace(/ carried balance$/, ' EMI');
        } else if (d) {
          if (v !== null && v >= 0) d.rate = v;
          if (emi > 0) d.minPayment = Math.round(emi);
        }
        c.result = 'yes';
        ui.callYes = null;
        save();
        celebrate(tr('Updated. Your dates and plan now use the new numbers.'));
        break;
      }
      case 'fab-add':
        ui.txKind = 'out';
        setTab('spend');
        { const amount = document.getElementById('tx-amount'); if (amount) { amount.scrollIntoView({ block: 'center' }); amount.focus(); } }
        return;
      case 'backup-open': ui.backupForm = {}; ui.restore = null; break;
      case 'backup-cancel': ui.backupForm = null; break;
      case 'backup-make': makeBackup(btn.dataset.how || 'save'); return;
      case 'backup-go':
        ui.backupForm = {}; ui.restore = null;
        openPage('plan', 'data');
        return;
      case 'backup-later': state.backupNudge = t; save(); break;
      case 'restore-open': ui.restore = {}; ui.backupForm = null; break;
      case 'restore-paste': ui.restore = { paste: true }; break;
      case 'restore-cancel': ui.restore = null; break;
      case 'restore-go': restoreBackup(); return;
      case 'budgets-auto': state.budgets.forEach((b) => { b.auto = true; }); save(); toast('Budgets shared out automatically'); break;
      case 'savings-auto': state.savings.auto = true; save(); toast('Set-asides worked out from your numbers'); break;
      case 'list-add':
        state[btn.dataset.list] = state[btn.dataset.list] || [];
        state[btn.dataset.list].push(listDefaults(btn.dataset.list)); save(); break;
      case 'list-remove': {
        const item = state[btn.dataset.list].find((x) => x.id === btn.dataset.id);
        // A loan or EMI that's gone frees its monthly payment.
        // Removed isn't always paid off (a duplicate, a mistake), so the question asks first.
        if (item && btn.dataset.list === 'debts' && item.balance > 0) askRollover({ from: item.name || 'Your loan', amount: Number(item.minPayment) || 0, kind: 'loan', removed: true });
        if (item && btn.dataset.list === 'fixed' && /\bemi\b|loan/i.test(item.name || '')) askRollover({ from: item.name, amount: Number(item.amount) || 0, kind: 'loan', removed: true });
        state[btn.dataset.list] = state[btn.dataset.list].filter((x) => x !== item); save(); break;
      }
      case 'tx-filter': ui.txFilter = btn.dataset.filter; break;
      case 'tx-delete': {
        const before = JSON.stringify(state);
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx && (Core.isIncome(tx) || Core.isMove(tx))) undoIncomeUse(tx);
        if (tx && Core.isBillPayment(tx)) Core.undoBillPayment(state, tx);
        if (tx && tx.fromFund) state.savings.emergencyBalance = (Number(state.savings.emergencyBalance) || 0) + tx.amount;
        if (tx && tx.kind === 'cardconvert') Core.undoCardConvert(state, tx);
        state.transactions = state.transactions.filter((x) => x.id !== btn.dataset.id); save();
        rerenderKeepScroll(); offerUndo('Deleted', before); return;
      }
      case 'tx-kind': ui.txKind = btn.dataset.kind; break;
      case 'help': ui.help = btn.dataset.help; break;
      case 'set-lang': setLang(btn.dataset.lang); widgetSent = ''; alertsSent = ''; break;
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
        openPage('grow', 'emergency');
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
      case 'rollover-no': state.rolloverAsk = null; save(); toast(tr('Nothing changed. Your plan stays as it was.')); break;
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
      case 'card-answer-part': ui.cardAnswer = btn.dataset.id; break;
      case 'card-answer-back': ui.cardAnswer = null; break;
      case 'card-answer-emi': {
        const c = state.cards.find((x) => x.id === btn.dataset.id);
        ui.cardPlan = { cardId: c.id, emi: { rate: 16, months: 6, fee: 0 }, emiAmount: 0 };
        openPage('debts', 'cards');
        const plan = document.getElementById('card-plan');
        if (plan) plan.scrollIntoView({ block: 'start' });
        return;
      }
      case 'card-answer': {
        const id = btn.dataset.id;
        const c = state.cards.find((x) => x.id === id);
        const paid = btn.dataset.answer === 'part' ? Number((document.getElementById('card-paid') || {}).value) || 0 : 0;
        if (btn.dataset.answer === 'part' && !paid) { toast('Enter how much you paid'); return; }
        const on = (document.getElementById('card-paid-on-' + id) || {}).value;
        if (on && on > t) { toast(tr('Pick a date up to today.')); return; }
        const res = Core.answerCardDue(state, id, btn.dataset.answer, paid, t, on || t);
        ui.cardAnswer = null;
        save();
        if (!res) break;
        if (res.kind === 'full') celebrate(tr('{card} bill paid in full. No interest.', { card: c.name }));
        else toast(tr('{amount} moved to Debts as {name}: about {monthly} a month in interest with GST', { amount: inr(res.rest), name: res.debt.name, monthly: inr(res.monthly) }) +
          (res.fee ? ' ' + tr('and a late fee of about {fee}.', { fee: inr(res.fee) }) : '.'));
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
        if (billId.indexOf('card:') === 0) {
          const res = Core.spendToCardPayment(state, btn.dataset.id, billId.slice(5));
          if (!res) return;
          save();
          toast(tr(res.merged ? 'Counted once now: the {name} bill paid on {date}.' : 'Now a {name} bill payment on {date}, counted once.',
            { name: (state.cards.find((c) => c.id === res.tx.cardId) || {}).name || '', date: fmtDate(res.tx.date) }));
          break;
        }
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
      case 'import-open': ui.importAsk = true; ui.importFound = null; break;
      case 'import-months': ui.importMonths = Number(btn.dataset.months) || 3; break;
      case 'import-find': findPastPayments(ui.importMonths); return;
      case 'import-cancel': ui.importAsk = false; ui.importFound = null; break;
      case 'import-start': {
        const f = ui.importFound || {};
        (f.matched || []).forEach((x) => recordSms(x.parsed, { key: x.key, source: 'import' }));
        (f.known || []).forEach((x) => recordSms(x.parsed, { key: x.key, category: state.merchantRules[Core.normalizeMerchant(x.merchant)], note: x.merchant, noLearn: true, source: 'import' }));
        if ((f.matched || []).length || (f.known || []).length) toast(tr('{a} linked to your entries, {b} sorted by themselves', { a: (f.matched || []).length, b: (f.known || []).length }));
        const items = f.items || [];
        state.sortQueue = (state.sortQueue || []).concat(items);
        state.sortTotal = (state.sortTotal || 0) + items.length;
        ui.importAsk = false; ui.importFound = null;
        save(); break;
      }
      case 'sort-pick': sortPick(btn.dataset.category); break;
      case 'sort-more': { const v = document.getElementById('sort-more').value; if (v) sortPick(v); break; }
      case 'sort-all': {
        const a = ui.sortAsk;
        ui.sortAsk = null;
        if (a) {
          (state.sortQueue || []).filter((x) => payeeOf(x) === a.key).forEach((x) => sortRecord(x, a.category, false));
          state.merchantRules[a.key] = a.category;
          toast(tr('{payee} remembered as {category}', { payee: a.payee, category: label(a.category) }));
        }
        sortSave(); break;
      }
      case 'sort-one': ui.sortAsk = null; break;
      case 'sort-unsure': {
        const q = state.sortQueue || [];
        const item = q.find((x) => !x.unsure) || q[0];
        if (item) { item.unsure = true; state.sortQueue = q.filter((x) => x !== item).concat(item); save(); }
        break;
      }
      case 'sort-drop': {
        const q = state.sortQueue || [];
        const item = q.find((x) => !x.unsure) || q[0];
        if (item) {
          state.smsIgnored = (state.smsIgnored || []).concat(item.key).slice(-500);
          state.sortQueue = q.filter((x) => x !== item);
          state.sortTotal = Math.max(0, (state.sortTotal || 1) - 1);
          sortSave();
        }
        break;
      }
      case 'sort-stop': toast('Your sorting is saved. Continue any time from the Spend tab.'); window.scrollTo(0, 0); break;
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

  /*
   * A change is handled a moment later, once the tap that caused it has
   * focused the next field, so the redraw keeps that field focused (and
   * the phone's keyboard open) instead of losing it.
   */
  document.addEventListener('change', (ev) => setTimeout(() => onChange(ev)));

  function onChange(ev) {
    const el = ev.target;
    if (el.dataset.leakPayee !== undefined) {
      const rules = Object.assign({}, state.leakRules);
      if (el.value) rules[el.dataset.leakPayee] = el.value; else delete rules[el.dataset.leakPayee];
      state.leakRules = rules;
      save(); rerenderKeepScroll(); return;
    }
    if (el.id === 'sounds-on') {
      state.settings.sounds = el.checked;
      save();
      if (el.checked) sound('chime');
      return;
    }
    if (el.dataset.goal) {
      const g = (state.goals || []).find((x) => x.id === el.dataset.goal);
      if (!g) return;
      if (el.dataset.goalField === 'saved') g.saved = Math.max(0, Math.round(Number(el.value) || 0));
      else if (el.value && el.value > today()) g.by = el.value;
      // This month's share stays as it was; the new amount or date counts from next payday.
      save(); refreshAfterEdit(); return;
    }
    if (el.dataset.carry) {
      // Turned on now: this cycle's leftover is the first one kept.
      const b = state.budgets.find((x) => x.id === el.dataset.carry);
      if (b) {
        b.carry = el.checked;
        if (el.checked) b.carryFrom = Core.cycleFor(today(), Number(state.settings.payday) || 1).start;
        else delete b.carryFrom;
        save();
        toast(el.checked ? tr('What’s left in {category} moves to next month', { category: label(b.name) }) : tr('{category} starts fresh each month', { category: label(b.name) }));
      }
      return;
    }
    if (el.dataset.balance) {
      if (el.value === '') return;
      const exp = expectedMorning();
      setBalance(el.value);
      reconcileAfter(exp, state.balanceCheck.amount);
      save(true);
      if (ui.reconcile && !ui.reconcile.ok) { openPage('home', 'balance'); return; }
      toast('Balance saved'); return;
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
    if (el.dataset.splitCat !== undefined && ui.split) { ui.split.parts[Number(el.dataset.splitCat)].category = el.value; return; }
    if (el.id === 'lock-after' || el.id === 'lock-hide' || el.id === 'lock-secure') {
      const cfg = lockCfg();
      if (!cfg.on) return;
      if (el.id === 'lock-after') cfg.after = Number(el.value) || 0;
      if (el.id === 'lock-hide') { cfg.hide = el.checked; widgetSent = ''; }
      if (el.id === 'lock-secure') { cfg.secure = el.checked; Promise.resolve().then(() => AppLock.setSecure({ on: el.checked })).catch(() => {}); }
      setLockCfg(cfg);
      rerenderKeepScroll();
      return;
    }
    if (el.id === 'restore-file') {
      const f = el.files && el.files[0];
      if (!f) return;
      f.text().then((text) => {
        const info = Core.backupInfo(text);
        ui.restore = { text, info, error: info ? '' : tr('That isn’t a Hisab Se backup.') };
        render();
      });
      return;
    }
    if (el.id === 'tx-from') {
      const warn = document.getElementById('tx-from-warn');
      const onCard = el.value !== 'account' && el.value.indexOf('w:') !== 0;
      if (warn) { warn.textContent = onCard ? borrowWarning(el.value) : ''; warn.hidden = !onCard; }
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
  }

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
    if (ev.target.id === 'wallet-form') { addWallet(ev); return; }
    if (ev.target.id === 'cover-form') { coverSave(ev); return; }
    if (ev.target.id === 'goal-form') { addGoal(ev); return; }
    if (ev.target.id === 'ai-settings-form') { saveAiSettings(ev); return; }
    if (ev.target.id === 'move-form') { moveMoney(ev); return; }
    if (ev.target.id === 'wallet-balance-form') { saveWalletBalances(ev); return; }
    if (ev.target.id === 'balance-form') {
      ev.preventDefault();
      const exp = expectedMorning();
      setBalance(document.getElementById('balance-amount').value);
      reconcileAfter(exp, state.balanceCheck.amount);
      save(true);
      ui.balanceOpen = false;
      if (!ui.reconcile || ui.reconcile.ok) toast('Balance saved');
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
    const from = document.getElementById(ui.txKind === 'in' ? 'tx-into' : 'tx-from');
    if (from) setFrom(tx, from.value);
    const wasOver = Core.projectRunway(state, today()).overToday > 0;
    state.transactions.push(tx);
    save();
    sound(ui.txKind !== 'in' && !wasOver && tx.date === today() && Core.projectRunway(state, today()).overToday > 0 ? 'low' : 'tick');
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

  // Hovering a chart mark with a mouse shows its amount too (a tap does it on a phone).
  document.addEventListener('pointerover', (ev) => {
    const el = ev.pointerType === 'mouse' && ev.target.closest ? ev.target.closest('.viz-card [data-tip]') : null;
    if (el) showVizTip(el);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ui.explain) { ui.explain = null; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && document.getElementById('onboard-card')) { ui.onboardHidden = true; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && ui.help) { ui.helpFrom = ui.help; ui.help = null; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && ui.borrow) { ui.borrow = null; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && document.getElementById('report-card')) { ui.report = false; ui.reportHidden = true; ui.reportThenPay = false; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && ui.reset) { ui.reset = null; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && ui.editTx) { ui.editTx = null; rerenderKeepScroll(); }
    else if (ev.key === 'Escape' && ui.tour) tourEnd();
    else if (ev.key === 'Escape' && ui.page) { if (history.state && history.state.page) history.back(); else closePage(); }
    else if (ev.key === 'Escape' && tab === 'profile') { if (history.state && history.state.profile) history.back(); else closeProfile(); }
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

  // ---------- first-time setup ----------

  /*
   * Five short steps, each unlocking something real: salary, payday and the
   * money in the account today give today's limit within a minute; fixed
   * payments and savings give Days of Freedom; loans give a debt-free date;
   * bank SMS (with what's read and what never happens, before any
   * permission) records payments. Everything is saved as it goes, and
   * "Finish later" keeps the place.
   */
  const ONBOARD_STEPS = 5;

  function obValue(id) { return ((document.getElementById(id) || {}).value || '').trim(); }

  function onboardKeepLoans() {
    const ob = state.onboarding;
    (ob.loans || []).forEach((l, i) => {
      ['name', 'balance', 'emi', 'rate'].forEach((k) => { const v = obValue('ob-loan-' + i + '-' + k); if (v !== '') l[k] = v; });
    });
  }

  function onboardNext() {
    const ob = state.onboarding;
    if (!ob) return;
    ui.onboardError = '';
    const t = today();
    if (ob.step === 1) {
      const salary = Math.round(Number(obValue('ob-salary')) || 0);
      const payday = Math.round(Number(obValue('ob-payday')) || 0);
      if (salary <= 0) { ui.onboardError = tr('Enter your monthly salary in hand.'); return; }
      if (payday < 1 || payday > 31) { ui.onboardError = tr('Enter the day of the month your salary comes, from 1 to 31.'); return; }
      state.settings.salary = salary;
      state.settings.payday = payday;
    } else if (ob.step === 2) {
      const v = obValue('ob-balance');
      if (v === '' || Number(v) < 0) { ui.onboardError = tr('Enter what’s in your bank account now. ₹0 is fine.'); return; }
      state.balanceCheck = { date: t, amount: Math.round(Number(v)) };
    } else if (ob.step === 3) {
      const rent = Math.round(Number(obValue('ob-rent')) || 0);
      const day = Math.min(31, Math.max(1, Math.round(Number(obValue('ob-rent-day')) || 1)));
      const other = Math.round(Number(obValue('ob-other')) || 0);
      state.fixed = state.fixed.filter((f) => !f.fromSetup);
      if (rent > 0) state.fixed.push({ id: uid(), name: tr('Rent'), amount: rent, dueDay: day, fromSetup: true });
      if (other > 0) state.fixed.push({ id: uid(), name: tr('Other fixed payments'), amount: other, dueDay: 1, fromSetup: true });
      state.savings.emergencyBalance = Math.max(0, Math.round(Number(obValue('ob-savings')) || 0));
    } else if (ob.step === 4) {
      onboardKeepLoans();
      state.debts = state.debts.filter((d) => !d.fromSetup);
      (ob.loans || []).forEach((l) => {
        const balance = Math.round(Number(l.balance) || 0);
        if (balance > 0) state.debts.push({ id: uid(), name: l.name || tr('Loan'), balance, rate: Number(l.rate) || 14, minPayment: Math.round(Number(l.emi) || 0), dueDay: 5, fromSetup: true });
      });
      ob.cards = !!(document.getElementById('ob-cards') || {}).checked;
    }
    ob.step++;
    ui.onboardFocus = true;
    save();
  }

  function finishOnboarding() {
    const cards = state.onboarding && state.onboarding.cards;
    delete state.onboarding;
    state.onboarded = true;
    ui.onboardHidden = false;
    save();
    if (cards) { ui.cardForm = {}; setTab('debts'); toast('Now add your credit card: name, last 4 digits, statement and due day.'); return; }
    setTab('home');
    celebrate(tr('You’re set. Your first round starts today.'));
  }

  // What the steps so far have unlocked, shown at the top of the next one.
  function onboardUnlocked(step) {
    const t = today();
    if (step === 3 && state.settings.salary) {
      const r = Core.projectRunway(state, t);
      return '<div class="ob-unlock"><span>' + tr('Unlocked: today’s limit') + '</span><b>' + inr(r.dailyAllowance) + '</b><small>' +
        tr('What you can spend today and still reach payday on {date}.', { date: fmtDate(r.cycle.next) }) + ' ' + tr('It gets more exact with the next steps.') + '</small></div>';
    }
    if (step === 4) {
      const f = Core.freedomDays(state, t);
      if (f) return '<div class="ob-unlock"><span>' + tr('Unlocked: Days of Freedom') + '</span><b>' + f.days + ' · ' + tr(f.badge) + '</b><small>' +
        (f.next ? tr(f.next.days === 1 ? '1 more day ({amount}) turns it {level}.' : '{n} more days ({amount}) turns it {level}.', { n: f.next.days, amount: inr(f.next.amount), level: tr(f.next.level) }) : '') + '</small></div>';
    }
    if (step === 5) {
      const d = Core.debtFreeDates(state, t);
      if (d) return '<div class="ob-unlock"><span>' + tr('Unlocked: debt-free date') + '</span><b>' + (d.now.never ? tr('Never') : monthYear(d.now.date)) + '</b><small>' +
        tr('Paying the minimums. Your plan can bring it closer.') + '</small></div>';
    }
    return '';
  }

  function onboardModal() {
    const ob = state.onboarding;
    if (!ob || ui.onboardHidden || state.isDemo) return '';
    const step = ob.step;
    const mins = Math.max(1, Math.ceil(((ONBOARD_STEPS - step + 1) * 40) / 60));
    const num = (id, label, value, extra) => '<label class="field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="number" inputmode="numeric" min="0" value="' + esc(value == null ? '' : value) + '"' + (extra || '') + '></label>';
    let body = '';
    let next = tr('Next');
    if (step === 1) {
      body = '<h2 id="ob-title">' + tr('Your salary') + '</h2><p class="hint">' + tr('Three quick answers and you’ll see today’s limit.') + '</p>' +
        '<div class="form-grid">' + num('ob-salary', tr('Monthly salary in hand (₹)'), state.settings.salary || '', ' placeholder="30000"') +
        num('ob-payday', tr('Payday (day of month)'), state.settings.salary ? state.settings.payday : '', ' max="31" placeholder="1"') + '</div>';
    } else if (step === 2) {
      body = '<h2 id="ob-title">' + tr('Money in your account now') + '</h2><p class="hint">' + tr('From your bank app. Today’s spending so far is already out of it.') + '</p>' +
        '<div class="form-grid">' + num('ob-balance', tr('Bank balance now (₹)'), state.balanceCheck ? state.balanceCheck.amount : '', ' placeholder="9000"') + '</div>';
      next = tr('Show today’s limit');
    } else if (step === 3) {
      const rent = state.fixed.find((f) => f.fromSetup && f.name === tr('Rent'));
      const other = state.fixed.find((f) => f.fromSetup && f.name !== tr('Rent'));
      body = onboardUnlocked(3) + '<h2 id="ob-title">' + tr('Fixed payments and savings') + '</h2><p class="hint">' + tr('Leave anything you don’t have at 0. Loans come next.') + '</p>' +
        '<div class="form-grid">' + num('ob-rent', tr('Rent or home loan (₹ a month)'), rent ? rent.amount : '') + num('ob-rent-day', tr('Paid on day'), rent ? rent.dueDay : '', ' max="31" placeholder="5"') +
        num('ob-other', tr('Other fixed payments (₹ a month)'), other ? other.amount : '', ' placeholder="' + tr('school fees, phone, subscriptions') + '"') +
        num('ob-savings', tr('Savings you could use in an emergency (₹)'), state.savings.emergencyBalance || '') + '</div>';
      next = tr('Show my Days of Freedom');
    } else if (step === 4) {
      if (!ob.loans) ob.loans = state.debts.filter((d) => d.fromSetup).map((d) => ({ name: d.name, balance: d.balance, emi: d.minPayment, rate: d.rate }));
      if (!ob.loans.length) ob.loans = [{}];
      body = onboardUnlocked(4) + '<h2 id="ob-title">' + tr('Loans and credit cards') + '</h2><p class="hint">' + tr('Personal loans, app loans, EMIs. Interest is in your loan app; about 14% if you’re not sure.') + '</p>' +
        ob.loans.map((l, i) => '<div class="form-grid ob-loan">' +
          '<label class="field" for="ob-loan-' + i + '-name"><span>' + tr('Loan') + '</span><input id="ob-loan-' + i + '-name" type="text" value="' + esc(l.name || '') + '" placeholder="' + tr('Personal loan') + '"></label>' +
          num('ob-loan-' + i + '-balance', tr('Left to pay (₹)'), l.balance) + num('ob-loan-' + i + '-emi', tr('EMI a month (₹)'), l.emi) +
          num('ob-loan-' + i + '-rate', tr('Interest % a year'), l.rate, ' placeholder="14"') + '</div>').join('') +
        '<div><button class="ghost" data-action="onboard-add-loan">' + tr('Add another loan') + '</button></div>' +
        '<label class="check"><input id="ob-cards" type="checkbox"' + (ob.cards ? ' checked' : '') + '> ' + tr('I have credit cards (add them right after this)') + '</label>' +
        '<div><button data-action="onboard-no-debts">' + tr('No loans or cards') + '</button></div>';
      next = tr('Save and continue');
    } else {
      body = onboardUnlocked(5) + '<h2 id="ob-title">' + tr('Bank SMS') + '</h2>' +
        (SmsInbox
          ? '<div class="ob-privacy"><p><b>' + tr('What we read:') + '</b> ' + tr('messages from banks and payment apps (senders like VM-HDFCBK), on this phone, from today on.') + '</p>' +
            '<p><b>' + tr('Why:') + '</b> ' + tr('to record your payments for you, so you don’t have to type them.') + '</p>' +
            '<p><b>' + tr('What we never do:') + '</b> ' + tr('read personal chats, keep messages that aren’t payments, or send your messages anywhere. They never leave this phone.') + '</p></div>' +
            '<p class="hint">' + tr('Android will ask for SMS permission next. You can turn it off any time in Android settings.') + '</p>' +
            '<div class="row"><button class="primary" data-action="onboard-sms">' + tr('Allow SMS reading') + '</button><button class="ghost" data-action="onboard-finish">' + tr('Not now') + '</button></div>'
          : '<p class="hint">' + tr('In the Android app, Hisab Se can record payments from your bank SMS. Here, add them on the Spend tab.') + '</p>' +
            '<div><button class="primary" data-action="onboard-finish">' + tr('Start my first round') + '</button></div>');
    }
    return '<div class="reset-modal-overlay onboard-overlay" role="presentation"><div class="reset-modal-card onboard-card" role="dialog" aria-modal="true" aria-labelledby="ob-title" id="onboard-card" tabindex="-1">' +
      '<div class="ob-progress"><span style="width:' + (((step - 1) / ONBOARD_STEPS) * 100).toFixed(0) + '%"></span></div>' +
      '<span class="eyebrow">' + tr('Step {step} of {total} · about {min} min', { step, total: ONBOARD_STEPS, min: mins }) + '</span>' +
      body + (ui.onboardError ? '<p class="bad" role="alert">' + esc(ui.onboardError) + '</p>' : '') +
      (step < ONBOARD_STEPS ? '<div class="row"><button class="primary" data-action="onboard-next">' + next + '</button>' +
        (step > 1 ? '<button class="ghost" data-action="onboard-back">' + tr('Back') + '</button>' : '') + '</div>' : '') +
      '<div><button class="link" data-action="onboard-later">' + tr('Finish later') + '</button></div></div></div>';
  }

  // ---------- importing past bank SMS (optional) ----------

  /*
   * Past payments come in only if the person has time to sort them: each
   * waits in state.sortQueue, outside budgets and graphs, until it has a
   * category. Sorting one asks before marking the same payee's other
   * payments, and only then remembers the payee for the future.
   */
  const SORT_QUICK = ['Groceries', 'Food & dining', 'Travel', 'Shopping', 'Bills'];

  function payeeOf(item) { return Core.normalizeMerchant(item.merchant) || item.merchant || ''; }

  function findPastPayments(months) {
    if (!SmsInbox || ui.importBusy) return;
    ui.importBusy = true;
    rerenderKeepScroll();
    const start = Core.parseISO(today()).getTime();
    const since = Core.parseISO(Core.addMonths(today(), -months)).getTime();
    Promise.resolve().then(() => SmsInbox.read({ since, limit: 5000 })).then((res) => {
      const msgs = (res.messages || []).filter((m) => /[A-Za-z]/.test(m.address || '') && m.date < start);
      const queued = new Set((state.sortQueue || []).map((x) => x.key));
      const rows = smsRows(msgs.map((m) => ({ text: m.body || '', day: Core.toISO(new Date(m.date)) })))
        .filter((r) => r.parsed && !r.duplicate && !queued.has(r.key) && r.parsed.type !== 'credit' && r.parsed.type !== 'statement' && r.parsed.type !== 'cardpayment');
      const toItem = (r) => ({ key: r.key, date: r.parsed.date, amount: r.parsed.amount, merchant: r.parsed.merchant, parsed: r.parsed });
      // Entries you typed yourself are linked, and places you've sorted before sort themselves: only the rest need you.
      const matched = rows.filter((r) => r.match).map(toItem);
      const known = rows.filter((r) => !r.match && state.merchantRules[Core.normalizeMerchant(r.parsed.merchant)]).map(toItem);
      const items = rows.filter((r) => !r.match && !state.merchantRules[Core.normalizeMerchant(r.parsed.merchant)]).map(toItem);
      ui.importBusy = false;
      ui.importFound = { months, items, matched, known };
      rerenderKeepScroll();
    }, (err) => {
      ui.importBusy = false;
      toast(err && err.code === 'PERMISSION_DENIED' ? 'SMS permission is off. You can turn it on in Android settings.' : 'Couldn’t read messages');
      rerenderKeepScroll();
    });
  }

  // About 6 seconds a payee: repeat payees are sorted together.
  function sortMinutes(items) {
    return Math.max(1, Math.ceil((new Set(items.map(payeeOf)).size * 6) / 60));
  }

  function importCard() {
    if (!SmsInbox || state.isDemo) return '';
    if (ui.importFound) {
      const f = ui.importFound;
      const auto = (f.matched || []).length + (f.known || []).length;
      const autoNote = auto ? '<p class="hint">' + [
        (f.matched || []).length ? tr('{n} match entries you typed yourself: they’ll be linked, not added twice.', { n: f.matched.length }) : '',
        (f.known || []).length ? tr('{n} are from places you’ve sorted before: they sort themselves.', { n: f.known.length }) : ''].filter(Boolean).join(' ') + '</p>' : '';
      if (!f.items.length && auto) {
        return '<section class="card import-card"><h2>' + tr('{n} payments found', { n: auto }) + '</h2>' + autoNote +
          '<div class="row"><button class="primary" data-action="import-start">' + tr('Add them') + '</button><button class="ghost" data-action="import-cancel">' + tr('Not now') + '</button></div></section>';
      }
      if (!f.items.length) {
        return '<section class="card"><h2>' + tr('Import past payments') + '</h2><p class="hint">' + tr('No new payments found in those messages.') + '</p>' +
          '<div><button data-action="import-cancel">' + tr('Close') + '</button></div></section>';
      }
      const first = f.items.reduce((m, x) => (x.date < m ? x.date : m), f.items[0].date);
      return '<section class="card import-card"><h2>' + tr('{n} payments found', { n: f.items.length }) + '</h2>' +
        '<p>' + tr('From {from} to yesterday. Each needs a category to count; same places sort together (about {min} min).', { from: fmtDate(first), min: sortMinutes(f.items) }) + '</p>' +
        '<p class="hint">' + tr('Until sorted they stay out of your budgets, graphs and daily limit. You can stop and continue later.') + '</p>' + autoNote +
        '<div class="row"><button class="primary" data-action="import-start">' + tr('Start sorting') + '</button><button class="ghost" data-action="import-cancel">' + tr('Not now') + '</button></div></section>';
    }
    if (!ui.importAsk) return '';
    return '<section class="card import-card"><h2>' + tr('Import past payments') + '</h2>' +
      '<p>' + tr('Reads your past bank and UPI messages on this phone, finds the payments, and asks you to sort each one into a category.') + '</p>' +
      '<p class="hint"><b>' + tr('Only if you have time to sort them.') + '</b> ' + tr('A payment without a category would land in Misc and make your budgets and limits wrong, so imported payments count only once sorted.') + '</p>' +
      '<div class="seg" role="group" aria-label="' + tr('How far back') + '">' + [1, 3, 6].map((m) =>
        '<button data-action="import-months" data-months="' + m + '" aria-pressed="' + (ui.importMonths === m) + '">' + plural(m, 'month') + '</button>').join('') + '</div>' +
      '<div class="row"><button class="primary" data-action="import-find"' + (ui.importBusy ? ' disabled' : '') + '>' + tr(ui.importBusy ? 'Reading…' : 'Find payments') + '</button>' +
      '<button class="ghost" data-action="import-cancel">' + tr('Not now') + '</button></div></section>';
  }

  // One payment at a time: "Where did it go?"
  function sortCard() {
    const q = state.sortQueue || [];
    if (!q.length) return '';
    const total = state.sortTotal || q.length;
    const done = total - q.length;
    const item = q.find((x) => !x.unsure) || q[0];
    if (ui.sortAsk) {
      const a = ui.sortAsk;
      return '<section class="card sort-card"><div class="sort-progress"><span style="width:' + ((done / total) * 100).toFixed(1) + '%"></span></div>' +
        '<h2>' + tr(a.count === 1 ? '1 more payment to {payee}' : '{n} more payments to {payee}', { n: a.count, payee: esc(a.payee) }) + '</h2>' +
        '<p>' + tr('Mark them all as {category}? Future payments there will be marked {category} too. You can change any of them later.', { category: esc(label(a.category)) }) + '</p>' +
        '<div class="row"><button class="primary" data-action="sort-all">' + tr(a.count === 1 ? 'Yes, both' : 'Yes, all {n}', { n: a.count + 1 }) + '</button>' +
        '<button data-action="sort-one">' + tr('Only this one') + '</button></div></section>';
    }
    const card = item.parsed && item.parsed.paidFrom === 'card' ? findCard(item.parsed.last4) : null;
    const guess = state.merchantRules[payeeOf(item)];
    const btn = (c) => '<button class="sort-btn' + (c === guess ? ' guess' : '') + '" data-action="sort-pick" data-category="' + esc(c) + '">' + esc(label(c)) + '</button>';
    return '<section class="card sort-card"><div class="card-head"><h2>' + tr('Sort imported payments') + '</h2><span class="hint">' +
      tr('{done} of {total} · about {min} min left', { done, total, min: sortMinutes(q) }) + '</span></div>' +
      '<div class="sort-progress"><span style="width:' + ((done / total) * 100).toFixed(1) + '%"></span></div>' +
      '<div class="sort-item"><b>' + inr(item.amount) + '</b><span>' + tr('to {payee}', { payee: esc(item.merchant || tr('Bank payment')) }) + '</span>' +
      '<small>' + fmtDate(item.date) + (card ? ' · ' + esc(card.name) + ' ' + tr('card') : '') + (item.unsure ? ' · ' + tr('marked Not sure') : '') + '</small></div>' +
      '<p class="sort-q">' + tr('Where did it go?') + '</p>' +
      '<div class="sort-grid">' + SORT_QUICK.map(btn).join('') + btn('Cash') + '</div>' +
      '<div class="row"><select id="sort-more" aria-label="' + tr('Other category') + '"><option value="">' + tr('Other category…') + '</option>' + categoryOptions('').replace(' selected', '') + '</select>' +
      '<button data-action="sort-more">' + tr('Use') + '</button></div>' +
      '<div class="row sort-skip"><button class="ghost" data-action="sort-unsure">' + tr('Not sure') + '</button><button class="ghost" data-action="sort-drop">' + tr('Not a payment') + '</button>' +
      '<button class="ghost" data-action="sort-stop">' + tr('Stop for now') + '</button></div></section>';
  }

  // Records one sorted payment; it counts from now on.
  function sortRecord(item, category, learn) {
    const p = Object.assign({}, item.parsed || { type: 'debit', amount: item.amount, merchant: item.merchant, date: item.date });
    recordSms(p, { key: item.key, category, note: item.merchant, noLearn: !learn, source: 'import' });
    state.sortQueue = (state.sortQueue || []).filter((x) => x !== item);
  }

  function sortPick(category) {
    const q = state.sortQueue || [];
    const item = q.find((x) => !x.unsure) || q[0];
    if (!item || !category) return;
    const payee = payeeOf(item);
    const same = q.filter((x) => x !== item && payeeOf(x) === payee);
    sortRecord(item, category, false);
    if (same.length && payee) ui.sortAsk = { payee: item.merchant || payee, key: payee, category, count: same.length };
    sortSave();
  }

  function sortSave() {
    if (!(state.sortQueue || []).length) {
      toast(tr('All {n} payments sorted. Your budgets and graphs now include them.', { n: state.sortTotal || 0 }), 'good');
      delete state.sortTotal;
      state.sortQueue = [];
    }
    save();
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
      // The widget's colour and sign follow the zone; with the app lock it can hide the rupees.
      zone: Core.zoneStatus(state, today(), r).zone,
      hideAmounts: !!(lockCfg().on && lockCfg().hide !== false),
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
      if (document.visibilityState === 'visible' && !locked && state) collectNative();
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
  try {
    ui.viz = ['where', 'when', 'trend'].indexOf(localStorage.getItem(VIZ_KEY)) !== -1 ? localStorage.getItem(VIZ_KEY) : 'where';
  } catch (e) { /* private mode */ }
  applyTheme(themeChoice());

  // Everything after the data is open: from the start, or after unlocking.
  function boot() {
    booted = true;
    assignWaitingSaved();
    if (NATIVE) collectNative();
    const fromHash = (location.hash || '').replace('#', '');
    tab = TABS.indexOf(fromHash) !== -1 ? fromHash : 'home';
    // The tour opens once, the first time the app is opened (with the example numbers).
    let seen = '1';
    try { seen = localStorage.getItem(TOUR_KEY); } catch (e) { /* private mode */ }
    if (!seen && state.isDemo) { ui.tour = true; ui.tourStep = 0; }
    render();
    announceAutoSaved();
  }

  state = load();
  if (lockCfg().on && AppLock) {
    // Locked: nothing shows until fingerprint, face or the screen lock.
    locked = true;
    unlockApp();
  } else {
    if (!state) state = Demo.demoState(today()); // encrypted data without a lock to open it: shouldn't happen
    boot();
  }
  // For the offline check on an emulator: the app's first screen is drawn.
  console.info('Hisab Se: ready');
})();
