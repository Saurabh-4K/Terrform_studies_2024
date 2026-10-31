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
  const INCOME_CATEGORIES = ['Money received', 'Money returned', 'From family', 'Refund', 'Cashback', 'Side income', 'Gift', 'Loan or Pay Later',
    'Bonus', 'Incentive', 'Overtime', 'Arrears', 'Leave encashment', 'Interest', 'Dividend', 'Rental income', 'Pension', 'Insurance claim', 'Scholarship', 'Rewards', 'Sale of goods'];
  // Money in that has to be paid back: counted as borrowed, never as income to save or invest.
  const LOAN_CATEGORY = 'Loan or Pay Later';
  const INCOME_USE_LABELS = {
    spend: 'Kept for this month',
    fromfund: 'From my emergency fund',
    fromgrow: 'From my savings',
    emergency: 'Added to emergency fund',
    grow: 'Set aside to invest',
    debt: 'Used to pay off a loan',
    keep: 'Kept for something to buy',
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
  // HisabTestSms: a stand-in for the phone's SMS store in scripts/money-rules-app.js.
  const SmsInbox = NATIVE ? window.Capacitor.registerPlugin('SmsInbox') : (window.HisabTestSms || null);
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
  // Automatic crash reports: asked once, off until the person says yes. Where they go is set when the app is built.
  const CRASH_KEY = 'salary-runway-crash';
  const CRASH_URL = window.HISAB_CRASH_URL || '';
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
  function rewardMessage(use, amount, debtId, daily, goalId) {
    if (use === 'goal') {
      const g = (state.goals || []).find((x) => x.id === goalId);
      const st = g ? Core.goalStatus(state, g, today()) : null;
      return g ? tr(st && st.done ? 'Nice move! {name} is reached ✓' : 'Nice move! {name}: {saved} of {target}.', { name: g.name, saved: inr(st.saved), target: inr(st.target) }) : tr('Saved');
    }
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
    if (s.reimb) Core.syncReimb(s);
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
  // Family: money for a spouse, parents or children to spend. Gifts: presents, shagun.
  const EXTRA_CATEGORIES = ['Family', 'Gifts', 'Bills', 'Insurance', 'Taxes', 'Donations', 'Savings', 'Misc', 'Emergency', 'Cash'];
  const BUILT_IN_CATEGORIES = Core.DEFAULT_SPLIT.map(([name]) => name).concat(EXTRA_CATEGORIES);

  function categories() {
    const names = state.budgets.map((b) => b.name).filter(Boolean);
    EXTRA_CATEGORIES.forEach((n) => { if (names.indexOf(n) === -1) names.push(n); });
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
    try { queueCrash(message, where, stack); } catch (e) { /* a crash report never breaks the app */ }
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

  function crashCfg() {
    const none = { on: null, queue: [], seen: [], day: '', sent: 0 };
    try { return Object.assign(none, JSON.parse(localStorage.getItem(CRASH_KEY) || '{}')); } catch (e) { return none; }
  }
  function saveCrashCfg(c) {
    try { localStorage.setItem(CRASH_KEY, JSON.stringify(c)); } catch (e) { /* private mode */ }
  }
  // The app's own server (set at build), or the AI plan's server when that's the one there is.
  function crashUrl() {
    const u = CRASH_URL || aiCfg().url || '';
    return u ? u.replace(/\/+$/, '') + '/crash' : '';
  }
  function crashOf(message, where, stack) {
    return Core.crashReport({ state: state || null, build: BUILD || 'browser', day: today(), lang: I18N.getLang(), screen: window.innerWidth + 'x' + window.innerHeight,
      ua: navigator.userAgent, message, where, stack, log: logRead() });
  }

  /*
   * After an error, once the person said yes: a crash report (Core.crashReport:
   * the error, where in the code, the build, the phone and the last screens;
   * never an amount, a name, a note or a payment) waits here and goes when
   * there's a network. The same error once a day; 10 sent a day at most.
   */
  function queueCrash(message, where, stack) {
    const c = crashCfg();
    if (c.on !== true) return;
    const r = crashOf(message, where, stack);
    const id = r.day + '|' + r.where + '|' + r.message.slice(0, 80);
    if (c.seen.indexOf(id) !== -1) return;
    c.seen = c.seen.filter((x) => x.slice(0, 10) === r.day).concat(id).slice(-20);
    c.queue = c.queue.concat(r).slice(-5);
    saveCrashCfg(c);
    setTimeout(flushCrashes, 1000);
  }

  function flushCrashes() {
    const c = crashCfg();
    const url = crashUrl();
    const d = today();
    if (c.on !== true || !c.queue.length || !url || flushCrashes.busy || navigator.onLine === false) return;
    if (c.day === d && c.sent >= 10) return;
    flushCrashes.busy = true;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.queue[0]) })
      .then((res) => {
        const n = crashCfg();
        // Sent, or refused as it is (it would be refused again): it leaves the queue.
        if (res.ok || res.status === 400 || res.status === 413) n.queue = n.queue.slice(1);
        n.sent = (n.day === d ? n.sent : 0) + 1;
        n.day = d;
        saveCrashCfg(n);
        flushCrashes.busy = false;
        if (res.ok && n.queue.length) flushCrashes();
      }, () => { flushCrashes.busy = false; });
  }
  window.addEventListener('online', () => { try { flushCrashes(); } catch (e) { /* ignore */ } });

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
    reimb: ['Reimbursements', [
      'A payment your office or a client pays back (a work trip, a client lunch). It leaves your account like any payment, but the part that comes back isn’t your spending, so budgets and reports leave it out. Until it’s paid back it counts as money owed to you.',
      'When the money comes in, match it to the claims it pays. Paid back in parts: the claim waits for the rest. Closed with something still missing: what didn’t come back becomes your spending.',
      'Paid back more than you spent: the extra counts once. This month’s spending: it’s added to your budget. Side vault: it’s kept apart from daily spending but counted in your net worth.',
    ]],
    review: ['Monthly review', [
      'Each payday, where the long run is heading: your debt-free date and how it moved, net worth, the emergency fund in months, how much of your pay you saved, and your goals.',
      'The money ladder is the order money goes in, as banks and planners teach it: basics and every minimum, a starter fund, costly loans (12% a year or more), the full emergency fund, goals, then investing. The app works out your step from your numbers; advice is about that step only.',
      'With the weekly plan on, the first plan after payday adds a direction for the month ahead, written by AI from these numbers.',
      'It also adds an adviser’s view: two or three things that matter most for your step, from general money knowledge. Each says whether it comes from your numbers or is general guidance to check. It never names a bank, fund, insurer or app, never suggests new borrowing, and suggests areas to invest only on the last step.',
    ]],
    cats: ['Categories', [
      'Each category can have subcategories, for detail: Bills → Electricity, Gas, Water; Food & dining → Eating out, Food delivery. Budgets stay on the category: bills, card bills and EMIs change month to month and are already in your plan.',
      'When you choose what a payment is, the list also has choices that do something: a bill (it learns the amount), a credit card bill (counted once, not as new spending), a loan’s EMI (interest and principal), a fixed payment, savings, People (lent, borrowed, paid back), a refund, money from your own savings, a work reimbursement. They work the same in the bank-SMS pop-up.',
      'Add your own subcategories here (Gym, Maid, Tuition), or hide the ones you don’t use. A shop’s subcategory is remembered for next time.',
    ]],
    events: ['Trips & events', [
      'A trip, a wedding, a flat’s bills: add the people once, then each payment with where it was paid, who paid, and each person’s share: equal, by amounts, or by shares. Shares always add up to the rupee; the payer takes the extra rupee.',
      'You paid: the whole payment left your account, but only your share is your spending; the rest is owed to you. Someone else paid: your share is your spending now, and you owe them. Only you and each person are tracked, never what others owe each other.',
      'Settle up shows one number per person, after what you owe each other cancels out. Money paid back either way is passed on: never income, never spending. Remind sends a message you choose to send, with each payment’s date, place and share.',
      'A budget for the trip is set aside from today’s limit until it ends, and your shares are paid from it. Deleting an event keeps the payments, and anything still owed stays under People.',
    ]],
    maybe: ['Maybe expenses', [
      'Costs that may come: a wedding gift, a bike repair, a doctor’s visit. Add the amount, roughly when, and how likely it is.',
      'Likely: the money is held from today’s limit until payday, so you’re ready if it comes. Maybe: nothing changes, but you see what today’s limit would be if it comes. Unlikely: only listed, so it doesn’t surprise you.',
      'None is counted at half: a cost comes in full or not at all. When the date passes, the app asks whether it came. Link the payment and it shows in your reports, but not as daily spending, because its money was held. Over time you see how good your guesses were.',
    ]],
    people: ['People', [
      'Money between you and friends or family. No EMI and no fixed dates: paid back all at once or in parts, by a date only if one was promised.',
      'It moves your balance like any money, but it’s never counted as income or spending, so your budgets stay right.',
      'Money you promised to pay back before payday is kept aside, unless money someone promised to return to you first covers it. Money owed to you counts only once it comes back.',
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
    if (tab === 'home') { drawRunway(); animateRunway(); rollNumbers(); }
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
    people: '<path d="M8.5 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 20c0-3.6 2.9-6.5 6.5-6.5S15 16.4 15 20zm14-6.4c3.3.1 6 2.8 6 6.4h-5.2c0-2.5-.3-4.6-.8-6.4z"/>',
    info: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.1 8v7.5h2.2V10zm0-3.6V8.6h2.2V6.4z"/>',
    add: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.1 5v3.9H7v2.2h3.9V17h2.2v-3.9H17v-2.2h-3.9V7z"/>',
  };
  const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';


  // ---------- features when needed ----------

  /*
   * A page that only some people need shows once it's relevant to this
   * person (their data says so), or once they turn it on from "More
   * features" at the end of the tab. Every other page always shows. Nothing
   * is ever out of reach: "More features" lists what's not shown yet, and
   * Profile → Appearance has "Show all features". A page that appears by
   * itself carries "New" until it's opened.
   */
  const ALL_FEATURES_KEY = 'salary-runway-all-features';
  function showAllFeatures() { try { return localStorage.getItem(ALL_FEATURES_KEY) === '1'; } catch (e) { return false; } }
  const daysRecorded = () => { const first = state.transactions.reduce((m, x) => (!m || x.date < m ? x.date : m), null); return first ? Core.daysBetween(first, today()) : 0; };
  // tab:key → [is it relevant now?, what it is, in one line]
  const WHEN_NEEDED = {
    'home:bills': [() => (state.bills || []).length > 0, 'Bills that vary (electricity, phone): what’s due before payday.'],
    'home:big': [() => false, 'Check a big expense before you pay it: what it does to your month.'],
    'home:maybe': [() => (state.maybe || []).length > 0, 'Costs that may come (a wedding gift, a repair): kept aside until you know.'],
    'home:graph': [() => daysRecorded() >= 7, 'Your balance through the month, as a graph.'],
    'home:insights': [() => daysRecorded() >= 14, 'What your spending says, from your own weeks.'],
    'home:worth': [() => (state.debts || []).length > 0 || Number(state.savings.emergencyBalance) > 0 || Number(state.savings.investSaved) > 0 || (state.goals || []).length > 0, 'What you own minus what you owe, month by month.'],
    'spend:leaks': [() => Object.keys(state.leakRules || {}).length > 0 || Core.leakSuggestions(state, today()).length > 0, 'Little leaks: small habits (snacks, cigarettes, delivery) that add up.'],
    'spend:events': [() => (state.events || []).length > 0, 'Trips and events: split payments with friends, who owes whom.'],
    'spend:reimb': [() => !!(state.reimb && ((state.reimb.claims || []).length || (state.reimb.payouts || []).length)), 'Work expenses your office pays back.'],
    'spend:calendar': [() => daysRecorded() >= 14, 'Your spending day by day, on a calendar.'],
    'spend:bills': [() => (state.bills || []).length > 0, 'Bills that vary (electricity, phone): what’s due before payday.'],
    'plan:wallets': [() => (state.wallets || []).length > 0, 'Cash, a second bank or a UPI wallet, each with its own balance.'],
    'plan:yearly': [() => (state.sinking || []).length > 0, 'Costs once a year (insurance, school fees): a little set aside each month.'],
    'plan:categories': [() => !!state.subcats || daysRecorded() >= 30, 'Your own categories and subcategories.'],
    'debts:people': [() => (state.iou || []).length > 0, 'Money you lent or borrowed from friends and family.'],
    'grow:emergency': [() => !!state.adjustment || (state.emergencies || []).length > 0, 'A plan for a sudden big cost, so the month still works.'],
    'grow:invest': [() => Number(state.savings.investSaved) > 0 || (Core.monthlyPlan(state, today()).invest || 0) > 0, 'Money set aside to invest, once the basics are safe.'],
  };
  function featuresState() {
    if (!state.features) {
      // First time: what's shown already isn't "new".
      state.features = { on: {}, seen: Object.keys(WHEN_NEEDED).filter((k) => WHEN_NEEDED[k][0]()).map((k) => k) };
      setTimeout(() => save(true), 0);
    }
    return state.features;
  }
  function featureShown(tabKey, key) {
    const rule = WHEN_NEEDED[tabKey + ':' + key];
    if (!rule || state.isDemo || showAllFeatures()) return true;
    const f = featuresState();
    return !!f.on[tabKey + ':' + key] || rule[0]();
  }
  // "New" once, on a page that appeared by itself.
  function featureNew(tabKey, key) {
    const k = tabKey + ':' + key;
    if (!WHEN_NEEDED[k] || state.isDemo || showAllFeatures()) return false;
    const f = featuresState();
    return f.seen.indexOf(k) === -1 && !f.on[k];
  }
  function moreFeaturesPage(tabKey, hidden) {
    return '<section class="card more-features"><h2>' + tr('More features') + '</h2>' +
      '<p class="hint">' + tr('Not shown yet, to keep this tab simple. Each one appears by itself when you need it, or turn it on now.') + '</p>' +
      hidden.map((x) => '<div class="more-item"><span class="hub-icon"><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + (HUB_ICONS[x.icon] || '') + '</svg></span>' +
        '<div class="grow"><b>' + tr(x.label) + '</b><span class="hint">' + tr(WHEN_NEEDED[tabKey + ':' + x.key][1]) + '</span></div>' +
        '<button class="ghost small" data-action="feature-on" data-tab="' + tabKey + '" data-key="' + x.key + '">' + tr('Open') + '</button></div>').join('') +
      '<p class="hint">' + tr('Want every page all the time? Profile → Appearance → Show all features.') + '</p></section>';
  }

  /*
   * A tab: what always matters stays open on top (the limit, zones, warnings),
   * then the other cards as small icons in groups. Each icon can carry a live
   * badge ("2 due") so nothing important hides; a tap opens the card as its own
   * page, and Back (or the phone's back button) returns to the icons.
   * sections: [{ key, group, icon, label, badge: { text, tone } | null, html: () => string, hide, tone, tab, viz }]
   */
  function hub(tabKey, top, sections) {
    const all = sections.filter((x) => !x.hide);
    // Pages only some people need wait in "More features" until they're relevant (featureShown).
    const list = all.filter((x) => featureShown(tabKey, x.key));
    const hidden = all.filter((x) => list.indexOf(x) === -1);
    if (hidden.length) {
      const more = { key: 'more', group: list.length ? list[list.length - 1].group : 'More', icon: 'add', label: 'More features', tone: 'teal',
        badge: { text: '+' + hidden.length }, html: () => moreFeaturesPage(tabKey, hidden) };
      list.push(more);
      all.push(more);
    }
    list.forEach((x) => { if (featureNew(tabKey, x.key)) x.isNew = true; });
    // A link straight to a page not shown yet still opens it.
    const open = ui.page && ui.page.tab === tabKey ? all.find((x) => x.key === ui.page.key) : null;
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
      '<span class="hub-label">' + tr(x.label) + '</span>' + (x.isNew ? '<span class="hub-new">' + tr('New') + '</span>' : '') + '</button>';
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
    if (z.zone === 'red' && z.cause === 'bills') {
      // The payments alone are more than the money: say so, so a planned payment (rent) never reads as overspending.
      headline = tr('<span class="date bad">{amount} short</span> for payments due before {date}', { amount: inr(z.billsShort), date: fmtDate(cyc.next) });
      sub = tr('Even with no spending at all, the payments still due ({bills}) are more than your money ({money}). Groceries, medicine and day-to-day travel need about {daily} a day on top: {basics} until payday. Ways to close the gap:',
        { bills: inr(r.billsAhead), money: inr(z.money), daily: inr(z.essentialPerDay), basics: inr(z.basicsAhead) });
    } else if (z.zone === 'red') {
      headline = tr('Red zone: <span class="date bad">{amount} short</span> for groceries and basics', { amount: inr(z.shortBy) });
      sub = tr('Your payments until {date} are covered. What’s left doesn’t cover groceries, medicine and day-to-day travel, about {daily} a day. Here’s how to stay above ₹0:', { date: fmtDate(cyc.next), daily: inr(z.essentialPerDay) });
    } else if (z.zone === 'amber') {
      // The same number the card shows: today's limit, or tomorrow's once today is over it.
      const keep = r.overToday > 0 && r.savedToday < r.overToday ? r.tomorrowAllowance : r.dailyAllowance;
      const short = Math.ceil(-r.endPace);
      if (r.endPace < 0 && r.moved > 0 && short <= r.moved) {
        // Only what was moved to savings tips it: say so, it isn't a penalty for saving.
        headline = tr('Careful: at your usual pace you’d be <span class="date warn">{amount} short</span> by payday', { amount: inr(short) });
        sub = tr('Not because you saved: the {saved} you moved to savings is still yours. It’s your pace, about {pace} a day. Keep to <b>{safe} a day</b> and you won’t need to touch your savings.',
          { saved: inr(r.moved), pace: inr(r.paceRate), safe: inr(keep) });
      } else {
        headline = tr('Careful: at this pace, money runs out on <span class="date warn">{date}</span>', { date: fmtDate(r.zeroPace || Core.addDays(cyc.next, -1)) });
        sub = tr('You’re spending about {pace} a day. Keep to <b>{safe} a day</b> until payday and you’ll stay out of the red.', { pace: inr(r.paceRate), safe: inr(keep) });
      }
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

    // Due and not yet paid first (still in the account), then what's still to come.
    const upcoming = r.dueNow.concat(r.events.filter((e) => e.date > t));
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
      setupCard(r) +
      (z.zone === 'red' ? redOptions(z, r) : '') +
      '<button class="road-link" data-action="page-open" data-tab="home" data-key="road"><span>' + tr('See the road to payday') + '</span><small>' + tr('Every payment until {date}, and can you afford something', { date: fmtDate(cyc.next) }) + '</small></button>' +
      freedomCard() +
      '</section>' +
      setupChecklist() +
      cardHomeNotes(cyc) +
      savedCard() +
      alertsNudge() + iouDueCard() + fixedTwinCard() + dueAskCard() + maybeDueCard() + fixedMatchCard() + refundMatchCard() + passCard() + incomeCard() +
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
      crashAsk() +
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
              '<div class="grow"><div class="title">' + esc(e.name) + '</div><div class="meta">' + (e.date <= t ? '<span class="bad-text">' + (e.date < t ? tr('Due {date} · not paid yet', { date: fmtDate(e.date) }) : tr('Due now · not paid yet')) + '</span>'
                : tr(e.kind === 'debt' ? 'Minimum payment' : e.kind === 'bill' ? 'Estimate · amount varies' : e.kind === 'iou' ? 'Promised back' : 'Fixed payment')) + '</div>' +
              (e.kind === 'fixed' || (e.kind === 'debt' && Core.emiLoans(state).some((d) => d.id === e.debtId)) ? fixedPayForm(Object.assign({}, e, { fixedId: e.fixedId || e.debtId })) : '') + '</div>' +
              '<div class="amt">' + inr(e.amount) + '</div></div>').join('') + '</div>'
            : '<p class="hint">' + tr('No more fixed payments this cycle.') + '</p>') + '</section>' },
      { key: 'payday', group: 'This month', icon: 'payday', label: 'Next payday', tone: 'mint', badge: { text: fmtDate(cyc.next) }, html: () => paydayPreviewCard() },
      { key: 'review', group: 'This month', icon: 'target', label: 'Monthly review', tone: 'mint',
        badge: (() => { const L = Core.priorityLadder(state, t); return { text: tr('Step {n} of 6', { n: L.steps.find((s) => s.current).n }) }; })(), html: () => reviewCard() },
      { key: 'big', group: 'Check & plan', icon: 'big', label: 'Big expense?', tone: 'amber', badge: null, html: () => bigExpenseCard() },
      { key: 'maybe', group: 'Check & plan', icon: 'scale', label: 'Maybe expenses', tone: 'amber',
        badge: (() => { const due = Core.maybeDue(state, t).length; return due ? { text: tr('{n} to answer', { n: due }), tone: 'bad' } : r.held ? { text: shortInr(r.held) } : null; })(), html: () => maybePage() },
      { key: 'road', group: 'Check & plan', icon: 'graph', label: 'Road to payday', tone: z.zone === 'red' ? 'coral' : z.zone === 'amber' ? 'amber' : 'mint', badge: (() => { const rd = Core.roadToPayday(state, t); return rd.short && rd.short.name ? { text: tr('{amount} short', { amount: shortInr(rd.short.amount) }), tone: 'bad' } : null; })(), html: () => roadPage() },
      { key: 'graph', group: 'Check & plan', icon: 'graph', label: 'Runway graph', tone: 'amber', badge: null, html: () => chartCard() },
      { key: 'budgets', group: 'Check & plan', icon: 'budgets', label: 'Budgets', tone: 'amber', badge: overBudgets ? { text: tr('{n} over', { n: overBudgets }), tone: 'bad' } : null,
        html: () => '<section class="card"><div class="card-head"><h2>' + tr(r.anchor && r.anchorIdx > 0 ? 'You can spend until payday' : 'You can spend this cycle') + '</h2><button class="ghost" data-action="tab" data-tab="plan">' + tr('Adjust') + '</button></div>' +
          envelopeBars(env) + '</section>' },
      { key: 'insights', group: 'Check & plan', icon: 'insight', label: 'Insights', tone: 'amber', badge: warnInsights ? { text: String(warnInsights), tone: 'bad' } : null,
        html: () => '<section class="card"><h2>' + tr('What your spending says') + '</h2><div>' +
          ins.map((i) => '<div class="insight lvl-' + i.level + '"><div><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p></div></div>').join('') + '</div></section>' },
      { key: 'balance', group: 'Money', icon: 'wallet', label: 'Balance', tone: 'teal', badge: { text: shortInr(r.balanceToday) },
        html: () => reconcileCard() + (ui.balanceOpen ? balanceForm(false) : '') + accuracyCard() + '<section class="tiles">' +
          tile('Balance now', inr(r.balanceToday),
            (r.anchor ? tr('From your balance on {date}', { date: fmtDate(r.anchor.date) }) : tr('Worked out from your plan')) +
            (r.dueTotal ? ' · ' + tr('{amount} of it is due and not paid yet', { amount: inr(r.dueTotal) }) : '') +
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
    const payday = Number(state.settings.payday) || 1;
    let cyc = Core.cycleFor(p.date || today(), payday);
    // Paid a day or two early (payday on a holiday): it's next month's salary.
    if (Core.daysBetween(p.date || today(), cyc.next) <= 3 && Core.daysBetween(cyc.start, p.date || today()) > 3) cyc = Core.cycleFor(cyc.next, payday);
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
      html += '<span class="sub">' + tr(p.maybeNext ? 'After fixed payments, loan minimums, bills and likely costs ({amount}):' : 'After fixed payments, loan minimums and bills ({amount}):', { amount: inr(p.committed + (p.maybeNext || 0)) }) + ' ' +
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
      red: z.cause === 'bills'
        ? zoneBanner('red', tr('Red zone: payments ahead'), tr('What’s due before payday is more than your money. Basics only now.'))
        : zoneBanner('red', tr('Red zone: stop'), tr('Bills and basics aren’t covered. Basics only now.')),
    }[z.zone];
    return '<div class="runway-card zone-' + z.zone + '">' + banner +
      '<div class="runway-head"><span class="hero-label">' + tr('Today’s limit') + '</span></div>' +
      '<div class="limit-big"><b data-count="' + Math.round(r.dailyAllowance) + '">' + inr(r.dailyAllowance) + '</b></div>' +
      '<div class="limit-bar' + (over ? ' over' : '') + '" role="img" aria-label="' + esc(todayTileNote(r)) + '"><span id="limit-fill" style="width:' + from.toFixed(1) + '%" data-to="' + used.toFixed(1) + '"></span></div>' +
      '<div class="limit-line"><span>' + (over ? tr('{amount} over', { amount: inr(r.overToday) })
        : r.savedToday > 0 ? tr('{spent} spent · {saved} saved', { spent: inr(r.spentToday), saved: inr(r.savedToday) })
          : tr('{amount} spent', { amount: inr(r.spentToday) })) + '</span>' +
      '<span>' + (over ? tr('Tomorrow: {amount}', { amount: inr(r.tomorrowAllowance) }) : tr('{amount} left', { amount: inr(r.leftToday) })) + '</span></div>' +
      limitCoversNote() +
      '<h1>' + headline + '</h1><p class="runway-sub">' + sub + '</p>' +
      '<button class="explain-link" data-action="explain" data-explain="limit">' + tr('How is this calculated?') + '</button></div>';
  }

  // Under today's limit: it has to cover essentials too, and says so when it can't.
  function limitCoversNote() {
    const fe = Core.feasibility(state, today());
    if (!(fe.essentialsDaily > 0)) return '';
    return '<p class="limit-covers hint' + (fe.limitCovers ? '' : ' warn') + '">' + (fe.limitCovers
      ? tr('Covers groceries, medicine and day-to-day travel too: about {amount} a day of it.', { amount: inr(fe.essentialsDaily) })
      : fe.budgetsTooLow ? tr('Below a day of essentials ({amount}): your Groceries, Health or Travel budget is set too low.', { amount: inr(fe.essentialsDaily) })
        : tr('Below a day of essentials ({amount}): spend on basics only until payday.', { amount: inr(fe.essentialsDaily) })) + '</p>';
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
      (d.sooner > 0 ? '<p class="good">' + tr('{months} sooner, saving about {amount} in interest.', { months: plural(d.sooner, 'month'), amount: inr(d.saved) }) + '</p>' +
        '<p class="hint">' + (d.extra > 0
          ? tr('With {amount} extra a month, and each finished loan’s EMI moved to the next loan.', { amount: inr(d.extra) })
          : tr('From moving each finished loan’s EMI to the next loan instead of spending it. No extra needed.')) + '</p>'
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
      const fe = Core.feasibility(state, t);
      if (fe.essentialsDaily > 0) lines.push(tr(fe.source === 'history'
        ? '<b>Essentials:</b> groceries, medicine, day-to-day travel (fuel, autos, metro) and recharges cost you about {amount} a day, from your last 8 weeks. The limit has to cover them.'
        : '<b>Essentials:</b> groceries, medicine, day-to-day travel (fuel, autos, metro) and recharges: about {amount} a day, from your budgets until there are 3 weeks of history. The limit has to cover them.', { amount: inr(fe.essentialsDaily) }));
      if (r.dueTotal) lines.splice(3, 0, tr('The bills include {amount} due and not yet paid ({names}). It’s still in the account until you pay it.', { amount: inr(r.dueTotal), names: esc(r.dueNow.map((e) => e.name).join(', ')) }));
      if (r.held) lines.splice(3, 0, tr('{amount} is held for likely costs before payday (Maybe expenses), so it’s already out of the account amount.', { amount: inr(r.held) }));
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


  /*
   * The road to payday: your money from today to payday. A warning across the
   * top that can't be missed (the zone, and the first payment that falls
   * short), four numbers (balance, still to pay, lowest point, the day before
   * payday), then the graph, the timeline or "what if", and "can I afford it?".
   */
  const ROAD_ICON = { fixed: '🏠', debt: '🏦', bill: '🧾', iou: '🤝', kept: '🔒', extra: '🛍️', billpot: '🧾' };
  function roadPage() {
    const t = today();
    const r = Core.projectRunway(state, t);
    const z = Core.zoneStatus(state, t, r);
    const road = Core.roadToPayday(state, t, { rate: ui.roadRate || 'usual' });
    const view = ui.roadView || 'graph';
    const rateWords = { usual: tr('at your usual {amount} a day', { amount: inr(road.rates.usual) }), essentials: tr('on essentials only, {amount} a day', { amount: inr(road.rates.essentials) }),
      limit: tr('at today’s limit, {amount} a day', { amount: inr(road.rates.limit) }) }[road.rateKind];
    const firstNeg = road.days.find((d) => d.balance < 0);
    let title; let text;
    if (road.short && road.short.name) {
      title = tr('{name} on {date} would be {amount} short', { name: esc(road.short.name), date: fmtDate(road.short.date), amount: inr(road.short.amount) });
      text = tr('The payments still due before payday are more than your money, {rate}. See the ways to close the gap on Runway.', { rate: rateWords });
    } else if (firstNeg) {
      title = tr('Money runs out on {date}', { date: fmtDate(firstNeg.date) });
      text = tr('Your payments are covered, but {rate} the money ends {days} before payday.', { rate: rateWords, days: plural(Core.daysBetween(firstNeg.date, road.payday), 'day') });
    } else if (z.zone !== 'green') {
      title = tr('Tight until payday');
      text = tr('{rate}, you reach payday with {amount}. Little room for surprises.', { rate: rateWords.charAt(0).toUpperCase() + rateWords.slice(1), amount: inr(road.end) });
    } else {
      title = tr('On track to payday');
      text = tr('{rate}, you reach payday with {amount}.', { rate: rateWords.charAt(0).toUpperCase() + rateWords.slice(1), amount: inr(road.end) });
    }
    const zone = road.short || firstNeg ? 'red' : z.zone;
    const status = '<div class="road-status zone-' + zone + '" role="status">' + SIGNS[zone] + '<div><b>' + title + '</b><span>' + text + '</span></div></div>';
    const stat = (label, value, hint, tone) => '<div class="road-stat"><span class="road-stat-label">' + label + '</span><b class="' + (tone || '') + '">' + value + '</b><span class="hint">' + hint + '</span></div>';
    const stats = '<div class="road-stats">' +
      stat(tr('Balance now'), inr(road.start), road.kept ? tr('{amount} of it kept aside', { amount: inr(road.kept) }) : tr('In your accounts')) +
      stat(tr('Still to pay'), inr(road.payments + road.spending), tr('Payments {p} + spending {s}', { p: inr(road.payments), s: inr(road.spending) })) +
      stat(tr('Lowest point'), signedInr(road.lowest.amount), tr('On {date}', { date: fmtDate(road.lowest.date) }), road.lowest.amount < 0 ? 'bad-text' : '') +
      stat(tr('Day before payday'), signedInr(road.end), rateWords, road.end < 0 ? 'bad-text' : '') + '</div>';
    const tabs = '<div class="road-tabs" role="tablist">' + [['graph', 'Balance graph'], ['timeline', 'Timeline'], ['whatif', 'What if?']].map(([k, l]) =>
      '<button role="tab" aria-selected="' + (view === k) + '" class="' + (view === k ? 'on' : '') + '" data-action="road-view" data-view="' + k + '">' + tr(l) + '</button>').join('') + '</div>';
    let body;
    if (view === 'timeline') body = roadTimeline(road);
    else if (view === 'whatif') body = roadWhatIf(road);
    else body = '<section class="card road-graph"><h3>' + tr('Your balance to payday') + '</h3><p class="hint">' + tr('Day by day, {rate}, with each payment on its day.', { rate: rateWords }) + '</p>' + roadGraph(road) + '</section>';
    return '<section class="road">' +
      '<div class="road-head"><h2>' + tr('Road to payday') + '</h2><p class="hint">' + fmtDate(road.cycle.start) + ' – ' + fmtDate(road.payday) + ' · ' + tr('{n} days left', { n: road.daysLeft }) + '</p></div>' +
      status + stats + tabs + body + affordCard() + '</section>';
  }

  function signedInr(v) { return (v < 0 ? '−' : '') + inr(Math.abs(v)); }

  function roadGraph(road) {
    const W = 340; const H = 210; const L = 44; const R = 12; const T = 16; const B = 28;
    const pts = road.days.map((d) => ({ date: d.date, v: d.balance }));
    pts.unshift({ date: road.today, v: road.start });
    const all = pts.map((p) => p.v).concat([0, road.afterPayday]);
    const lo = Math.min.apply(null, all); const hi = Math.max.apply(null, all);
    const step = niceStep(hi - lo || 1, 4);
    const yMin = Math.floor(lo / step) * step; const yMax = Math.ceil(hi / step) * step;
    const n = road.days.length + 1;
    const x = (i) => L + (i * (W - L - R)) / Math.max(1, n);
    const y = (v) => T + ((yMax - v) * (H - T - B)) / (yMax - yMin || 1);
    let svg = '<svg class="road-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(tr('Balance to payday: lowest {amount} on {date}', { amount: signedInr(road.lowest.amount), date: fmtDate(road.lowest.date) })) + '">';
    for (let v = yMin; v <= yMax + 0.5; v += step) {
      svg += '<line class="' + (v === 0 ? 'c-zero' : 'c-grid') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="c-label" x="' + (L - 5) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + shortInr(v) + '</text>';
    }
    // Below ₹0: payments and basics can't be paid there.
    if (yMin < 0) svg += '<rect class="road-danger" x="' + L + '" y="' + y(0).toFixed(1) + '" width="' + (W - L - R) + '" height="' + (y(yMin) - y(0)).toFixed(1) + '"/>';
    let line = ''; let area = '';
    pts.forEach((p, i) => { line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); });
    area = line + 'L' + x(pts.length - 1).toFixed(1) + ' ' + y(Math.max(0, yMin)).toFixed(1) + 'L' + x(0).toFixed(1) + ' ' + y(Math.max(0, yMin)).toFixed(1) + 'Z';
    svg += '<path class="road-area" d="' + area + '"/><path class="road-line" d="' + line + '"/>';
    // Payday: the salary comes in.
    const last = pts.length - 1;
    svg += '<path class="road-payday" d="M' + x(last).toFixed(1) + ' ' + y(pts[last].v).toFixed(1) + 'L' + x(n).toFixed(1) + ' ' + y(road.afterPayday).toFixed(1) + '"/>' +
      '<circle class="road-dot good" cx="' + x(n).toFixed(1) + '" cy="' + y(road.afterPayday).toFixed(1) + '" r="4"/>';
    // The three biggest payments, marked on their day.
    road.moves.filter((m) => m.kind !== 'kept').slice().sort((a, b) => b.amount - a.amount).slice(0, 3).forEach((m) => {
      const i = Core.daysBetween(road.today, m.date) + 1;
      const v = (road.days[i - 1] || { balance: m.after }).balance;
      svg += '<circle class="road-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5"><title>' + esc(m.name) + ' −' + inr(m.amount) + ' · ' + fmtDate(m.date) + '</title></circle>' +
        '<text class="road-tag" x="' + Math.min(W - R - 2, x(i) + 5).toFixed(1) + '" y="' + Math.max(T + 8, y(v) - 7).toFixed(1) + '" text-anchor="' + (x(i) > W - 90 ? 'end' : 'start') + '">' + esc(String(m.name).length > 16 ? String(m.name).slice(0, 15) + '…' : String(m.name)) + ' −' + shortInr(m.amount) + '</text>';
    });
    const li = Core.daysBetween(road.today, road.lowest.date) + 1;
    svg += '<circle class="road-dot ' + (road.lowest.amount < 0 ? 'bad' : 'low') + '" cx="' + x(li).toFixed(1) + '" cy="' + y(road.lowest.amount).toFixed(1) + '" r="5"/>';
    svg += '<text class="c-label" x="' + L + '" y="' + (H - 8) + '">' + esc(tr('Today')) + '</text><text class="c-label" x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(tr('Payday {date}', { date: fmtDate(road.payday) })) + '</text>';
    svg += '</svg>';
    return '<div class="road-chart">' + svg + '</div><div class="legend"><span><i></i>' + tr('Your balance') + '</span><span><i class="road-sal"></i>' + tr('Salary on payday') + '</span>' +
      (yMin < 0 ? '<span><i class="red-band"></i>' + tr('Below ₹0: payments can’t be paid') + '</span>' : '') + '</div>';
  }

  function roadTimeline(road) {
    const row = (icon, date, name, sub, amount, after, tone) => '<div class="road-row' + (tone ? ' ' + tone : '') + '"><span class="road-icon" aria-hidden="true">' + icon + '</span>' +
      '<div class="grow"><span class="hint">' + date + '</span><b>' + name + '</b>' + (sub ? '<span class="hint">' + sub + '</span>' : '') + '</div>' +
      '<div class="road-amt"><b class="' + (amount < 0 ? 'bad-text' : 'good-text') + '">' + (amount < 0 ? '−' : '+') + inr(Math.abs(amount)) + '</b>' + (after != null ? '<span class="hint">' + tr('After: {amount}', { amount: signedInr(after) }) + '</span>' : '') + '</div></div>';
    const kinds = { fixed: 'Fixed payment', debt: 'EMI', bill: 'Bill · estimate', iou: 'Money you owe', kept: 'Not to spend', extra: 'This purchase' };
    // The balance after each payment counts everyday spending up to that day.
    const rows = road.moves.map((m) => {
      const isShort = road.short && road.short.name === m.name && road.short.date === m.date;
      const sub = (m.due ? tr('Due, not paid yet') : tr(kinds[m.kind] || 'Payment')) + (isShort ? ' · ' + tr('{amount} short', { amount: inr(road.short.amount) }) : '');
      return row(ROAD_ICON[m.kind] || '💸', m.date === road.today ? tr('Today') : fmtDate(m.date), m.kind === 'kept' || m.kind === 'extra' ? tr(m.name) : esc(m.name), sub, -m.amount, m.after, isShort ? 'short' : '');
    });
    return '<section class="card road-timeline"><h3>' + tr('Money in and out until payday') + '</h3>' +
      row('👛', tr('Today'), tr('Balance now'), tr('In your accounts'), road.start, null, '') + rows.join('') +
      row('🛒', fmtDate(road.today) + ' – ' + fmtDate(Core.addDays(road.payday, -1)), tr('Everyday spending'), tr('{amount} a day: groceries, travel, food and the rest', { amount: inr(road.daily) }), -road.spending, road.end, road.end < 0 ? 'short' : '') +
      row('💰', fmtDate(road.payday), tr('Salary'), tr('A new round starts'), road.salary, road.afterPayday, '') +
      '<p class="hint">' + tr('“After” counts everyday spending up to that day too.') + '</p></section>';
  }

  function roadWhatIf(road) {
    const opt = (k, label) => '<button class="road-rate' + (road.rateKind === k ? ' on' : '') + '" data-action="road-rate" data-rate="' + k + '" aria-pressed="' + (road.rateKind === k) + '"><b>' + label + '</b><span>' +
      tr('{amount} a day', { amount: inr(road.rates[k]) }) + '</span></button>';
    return '<section class="card road-whatif"><h3>' + tr('If you spend…') + '</h3><p class="hint">' + tr('Pick a daily amount: the numbers above and the graph change with it.') + '</p>' +
      '<div class="road-rates">' + opt('essentials', tr('Only essentials')) + opt('usual', tr('Your usual')) + opt('limit', tr('Today’s limit')) + '</div>' +
      '<div class="row"><button class="ghost small" data-action="page-open" data-tab="plan" data-key="fixed">' + tr('Change payment dates or amounts') + '</button>' +
      '<button class="ghost small" data-action="page-open" data-tab="plan" data-key="budgets">' + tr('Change budgets') + '</button></div></section>';
  }

  function affordCard() {
    const a = ui.afford;
    const forItem = a && ui.affordFor ? Core.protectList(state).find((x) => x.id === ui.affordFor) : null;
    let res = '';
    if (a) {
      if (a.verdict === 'yes') {
        res = '<div class="afford-res good"><b>' + tr('Yes, you can afford {amount}.', { amount: inr(a.amount) }) + '</b><span>' +
          tr('At your usual {daily} a day you’d still have {end} the day before payday. Your lowest point drops by {drop}.', { daily: inr(a.usual.daily), end: inr(a.endAfter), drop: inr(a.lowestDrop) }) + '</span></div>';
      } else if (a.verdict === 'tight') {
        res = '<div class="afford-res warn"><b>' + tr('Only if you spend on essentials until payday.', {}) + '</b><span>' +
          tr('With {amount} today, keep to about {ess} a day (groceries, medicine, travel) and you reach payday with {end}. At your usual {daily} a day, money runs short.', { amount: inr(a.amount), ess: inr(a.essentials.daily), end: inr(a.endEssentials), daily: inr(a.usual.daily) }) + '</span></div>';
      } else {
        const sh = a.essentials.short;
        res = '<div class="afford-res bad"><b>' + tr('Not now: {amount} doesn’t fit before payday.', { amount: inr(a.amount) }) + '</b><span>' +
          (sh && sh.name ? tr('Even on essentials only, {name} on {date} would be {short} short.', { name: esc(sh.name), date: fmtDate(sh.date), short: inr(sh.amount) })
            : sh ? tr('Even on essentials only, the money runs out on {date}.', { date: fmtDate(sh.date) }) : '') + ' ' +
          tr('After payday on {date} it fits better: check again then.', { date: fmtDate(a.usual.payday) }) + '</span></div>';
      }
    }
    return '<section class="card afford"><h3>' + tr('Can I afford something?') + '</h3><p class="hint">' + tr('Type what it costs: the app checks it against every payment until payday.') + '</p>' +
      '<form id="afford-form" class="row" autocomplete="off"><label class="field grow-field" for="afford-amt"><span>' + tr('Amount (₹)') + '</span><input id="afford-amt" type="number" inputmode="numeric" min="1" value="' + (a ? a.amount : '') + '"></label>' +
      (Core.protectList(state).length ? '<label class="field" for="afford-for"><span>' + tr('What is it for? (optional)') + '</span><select id="afford-for"><option value="">—</option>' +
        Core.protectList(state).map((x) => '<option value="' + esc(x.id) + '"' + (ui.affordFor === x.id ? ' selected' : '') + '>🛡 ' + esc(protectLabel(x.name)) + '</option>').join('') + '</select></label>' : '') +
      '<button class="primary" type="submit">' + tr('Check') + '</button></form>' +
      // Protected isn't unlimited: the same check, said with respect for what it's for.
      (forItem ? '<p class="protect-note">🛡 ' + (a.verdict === 'yes'
        ? tr('It’s for {name}, which you protect, and it fits.', { name: esc(protectLabel(forItem.name)) })
        : tr('It’s for {name}, which you protect. The app won’t tell you to give it up, but protected doesn’t mean any amount: here is what it does before payday.', { name: esc(protectLabel(forItem.name)) })) + '</p>' : '') +
      res + '</section>';
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
   * The logo animation (media/intro.mp4, 2.5 s) when the app opens, once a
   * day at most, so it never stands between someone and their limit. A tap
   * skips it; with Android's "remove animations" the logo shows still for a
   * moment instead.
   */
  const INTRO_KEY = 'salary-runway-intro';
  (function intro() {
    const el = document.getElementById('intro');
    const video = document.getElementById('intro-video');
    if (!el || !video || navigator.webdriver) return;
    const d = new Date();
    const day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    try {
      if (localStorage.getItem(INTRO_KEY) === day) return;
      localStorage.setItem(INTRO_KEY, day);
    } catch (e) { return; }
    el.hidden = false;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    };
    el.addEventListener('click', end);
    // Never longer than this, whatever the video does.
    setTimeout(end, REDUCE_MOTION ? 700 : 3500);
    if (REDUCE_MOTION) return;
    video.addEventListener('ended', () => setTimeout(end, 250));
    video.addEventListener('error', end);
    const playing = video.play();
    if (playing && playing.catch) playing.catch(end);
  })();

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
      // Removed by mistake or as a duplicate: the plain answer first, before any plan for the money.
      (a.removed ? '<div class="row"><button class="primary" data-action="rollover-no">' + tr('Added by mistake: ignore') + '</button>' +
        '<button data-action="rollover-no">' + tr('Not paid off yet') + '</button></div><p class="hint">' + tr('Paid off? Then choose what its money does now:') + '</p>' : '') +
      '<div class="choices">' + o.options.map((opt) =>
        '<button class="choice' + (opt.to === o.recommended ? ' suggested' : '') + '" data-action="rollover-use" data-to="' + opt.to + '">' +
        '<span class="choice-title">' + esc(opt.title) + (opt.to === o.recommended ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '') + '</span>' +
        '<span class="choice-detail">' + esc(opt.detail) + '</span></button>').join('') + '</div>' +
      '<p class="hint"><b>' + tr('Why the suggestion:') + '</b> ' + esc(o.reason) + '</p>' +
      '<div class="row">' + (a.kind === 'loan' && !a.removed ? '<button data-action="rollover-no">' + tr('It isn’t paid off') + '</button>' : '') +
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
      if (o.kind === 'askback') return '<li>' + tr('<b>Ask {name} for the {amount} they owe you.</b>', { name: esc(o.name), amount: inr(o.amount) }) + '</li>';
      if (o.kind === 'wait') return '<li>' + tr('<b>Ask {name} if the {amount} due {date} can wait until after payday.</b>', { name: esc(o.name), amount: inr(o.amount), date: fmtDate(o.date) }) + '</li>';
      if (o.kind === 'move') {
        // How to ask, said once, after the last EMI.
        const last = z.options.filter((x) => x.kind === 'move').pop() === o;
        return '<li>' + tr('<b>Ask the lender to move the {name} EMI ({amount}, due {date}) to after payday.</b>', { name: esc(o.name), amount: inr(o.amount), date: fmtDate(o.date) }) +
          (last ? ' ' + tr('Some lenders change the EMI date on request, sometimes for a small charge or a few days’ interest. Don’t just skip it: a missed EMI costs a late fee and lowers your credit score.') : '') + '</li>';
      }
      return '<li>' + tr('<b>Spend only on basics</b>, about {amount} a day for groceries, medicine and day-to-day travel, until {date}.', { amount: inr(o.amount), date: fmtDate(r.cycle.next) }) + '</li>';
    });
    items.push('<li>' + tr('<b>Avoid the credit card for daily spending.</b> It turns this month’s gap into next month’s debt.') + '</li>');
    // What the gap is made of: the biggest payments still due.
    const due = z.cause === 'bills' && z.ahead.length
      ? '<p class="hint red-due"><b>' + tr('Still to pay before {date}:', { date: fmtDate(r.cycle.next) }) + '</b> ' +
        z.ahead.slice(0, 4).map((e) => esc(e.name) + ' ' + inr(e.amount) + ' (' + fmtDate(e.date) + ')').join(' · ') +
        (z.ahead.length > 4 ? ' · ' + tr('{n} more', { n: z.ahead.length - 4 }) : '') + '</p>'
      : '';
    return due ? '<div class="red-box">' + due + '<ol class="red-options">' + items.join('') + '</ol></div>' : '<ol class="red-options">' + items.join('') + '</ol>';
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
      '<div class="summary">' + line('Money in your account and wallets', inr(n.money)) + line('Emergency fund, goals and Grow', inr(n.funds)) +
      (n.lentPeople ? line('Owed to you by people', inr(n.lentPeople)) : '') +
      (n.loans ? line('Loans', '−' + inr(n.loans)) : '') + (n.cards ? line('Card dues from before', '−' + inr(n.cards)) : '') +
      (n.owedPeople ? line('Owed to people', '−' + inr(n.owedPeople)) : '') +
      (n.newLoans ? line('Loan money not in Debts yet', '−' + inr(n.newLoans)) : '') +
      (n.dueUnpaid ? line('Payments due, not yet paid', '−' + inr(n.dueUnpaid)) : '') +
      (n.reimbOwed ? line('Owed back on work expenses', inr(n.reimbOwed)) : '') +
      (n.vault ? line('Side vault', inr(n.vault)) : '') +
      line('Net worth', signed(n.value), n.value < 0 ? 'bad' : '') + '</div>' +
      (keys.length > 1
        ? '<div class="nw-grid">' + bars + '</div><p class="viz-tip" aria-live="polite">' + tr('Tap a round to see its number.') + '</p>' +
          numbersTable([tr('Round from'), tr('Net worth')], keys.map((k, i) => [fmtDate(k, true), signed(vals[i])]))
        : '<p class="hint">' + tr('Kept each round from now on, so you can watch it climb.') + '</p>') +
      '</section>';
  }

  // Money kept for something to buy (a gift for a purchase), until it's used.
  function keptCard() {
    const list = Core.keptFor(state);
    if (!list.length) return '';
    return '<section class="card kept-card"><div class="card-head"><h2>' + tr('Kept for something to buy') + '</h2></div>' +
      '<p class="hint">' + tr('In your account, out of daily spending. Bought it? Tap Use it, and the purchase is covered.') + '</p>' +
      '<div class="list">' + list.map((k) => '<div class="list-item"><div class="grow"><div class="title">' + esc(k.name) + '</div>' +
        '<div class="meta">' + tr('From {who} · {date}', { who: esc(k.tx.note || label(k.tx.category)), date: fmtDate(k.tx.date) }) + '</div></div>' +
        '<div class="amt good">' + inr(k.left) + '</div></div>' +
        (ui.keepUse === k.tx.id ? keepUsePicker(k)
          : '<div class="row"><button class="small" data-action="keep-use-open" data-id="' + esc(k.tx.id) + '">' + tr('Use it') + '</button></div>')).join('') + '</div></section>';
  }

  // Which purchase it paid for: recent spending, newest first.
  function keepUsePicker(k) {
    const from = Core.addDays(today(), -30);
    const list = state.transactions.filter((x) => Core.isFlexible(x) && x.date >= from && Core.ownPart(x) > 0)
      .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20);
    if (!list.length) return '<p class="hint">' + tr('No purchase recorded yet. Add it in Spend, then come back to use this money for it.') + '</p>';
    return '<div class="row"><label class="field" for="keep-buy"><span>' + tr('Which purchase?') + '</span><select id="keep-buy">' +
      list.map((x) => '<option value="' + esc(x.id) + '">' + esc(txTitle(x)) + ' · ' + fmtDate(x.date) + ' · ' + inr(Core.ownPart(x)) + '</option>').join('') + '</select></label>' +
      '<button class="primary" data-action="keep-use" data-id="' + esc(k.tx.id) + '">' + tr('Use it') + '</button><button class="ghost" data-action="keep-use-cancel">' + tr('Cancel') + '</button></div>';
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
    // The accuracy meter: one check a day (a second balance the same day replaces the first).
    const t = today();
    state.accuracy = (state.accuracy || []).filter((x) => x.date !== t).concat({ date: t, since: exp.since, expected: Math.round(exp.amount), actual: Math.round(actual) }).slice(-24);
    // Small differences are rounding, interest or charges: not worth a question.
    if (Math.abs(gap) < Math.max(100, actual * 0.01)) { ui.reconcile = { ok: true, since: exp.since }; return; }
    ui.reconcile = { gap, since: exp.since, expected: exp.amount, actual };
  }

  // How close the app's count has been to the bank each time the balance was entered.
  function accuracyCard() {
    const a = Core.accuracyStats(state.accuracy, 10);
    if (!a) {
      return '<section class="card accuracy"><h2>' + tr('How accurate the app is') + '</h2>' +
        '<p class="hint">' + tr('Each time you enter your bank balance, the app compares it with what it counted and shows how close it was. Enter it a few times a month to see this.') + '</p></section>';
    }
    const tone = a.pct >= 98 ? 'good' : a.pct >= 90 ? 'warn' : 'bad';
    const row = (x) => '<div class="line"><span>' + fmtDate(x.date) + '</span><span>' +
      (Math.abs(x.gap) < 1 ? tr('exact') : tr(x.gap > 0 ? '{amount} less in the bank' : '{amount} more in the bank', { amount: inr(Math.abs(x.gap)) })) +
      (x.noted ? ' · ' + tr('noted') : '') + '</span></div>';
    return '<section class="card accuracy"><div class="card-head"><h2>' + tr('How accurate the app is') + '</h2>' +
      '<span class="chip ' + (tone === 'good' ? 'chip-freedom' : 'chip-caution') + '">' + a.pct + '%</span></div>' +
      '<p class="hint">' + tr(a.checks === 1 ? 'From your last bank balance check: the app had counted within {gap} of your bank.' : 'From your last {n} bank balance checks: on average the app was {gap} off your bank.', { n: a.checks, gap: inr(a.avgGap) }) + '</p>' +
      '<div class="summary">' + a.list.slice().reverse().slice(0, 5).map(row).join('') + '</div>' +
      (a.pct < 98 ? '<p class="hint">' + tr('A gap usually means cash, a bank charge or a payment without an SMS. Noting it when the app asks keeps budgets right.') + '</p>' : '') + '</section>';
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
        '<div class="row">' + pickerPair(Core.isIncome(x), x, null, 'data-tx-cat="' + esc(x.id) + '"') +
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
      '<label class="field">' + tr('Amount (₹)') + '<input id="sv-amount" type="number" inputmode="decimal" min="1" max="1000000000" step="any" required placeholder="58"></label>' +
      '<label class="field">' + tr('Goes to') + '<select id="sv-use">' + savingPlaces().map((p) => '<option value="' + p.use + '"' +
        (p.debtId ? ' data-debt="' + esc(p.debtId) + '"' : '') + (p.goalId ? ' data-goal="' + esc(p.goalId) + '"' : '') + '>' + esc(p.label) + '</option>').join('') + '</select></label>' +
      '<label class="field">' + tr('Date') + '<input id="sv-date" type="date" value="' + t + '" max="' + t + '" required></label>' +
      '<label class="field">' + tr('Where') + '<input id="sv-note" type="text" placeholder="Jar"></label>' +
      '<div class="wide"><button class="primary" type="submit">' + tr('Add money saved') + '</button></div></form>';
  }

  // Places a saving can go: the emergency fund, each open goal, Grow, the costliest loan.
  function savingPlaces() {
    const top = state.debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
    const t = today();
    return [{ use: 'emergency', label: tr('Emergency fund') }]
      .concat((state.goals || []).filter((g) => !Core.goalStatus(state, g, t).done).map((g) => ({ use: 'goal', goalId: g.id, label: tr('Goal: {name}', { name: g.name }) })))
      .concat([{ use: 'grow', label: tr('Grow (to invest)') }])
      .concat(top ? [{ use: 'debt', debtId: top.id, label: tr('Paid {name}', { name: top.name }) }] : []);
  }

  // Where a saving went, for its row: "Emergency fund", "Goal: Bike", "Grow", "Personal loan".
  function savedWhere(x) {
    if (x.useFor === 'emergency') return tr('Emergency fund');
    if (x.useFor === 'goal') { const g = (state.goals || []).find((y) => y.id === x.goalId); return g ? tr('Goal: {name}', { name: g.name }) : tr('a goal'); }
    if (x.useFor === 'grow') return tr('Grow (to invest)');
    if (x.useFor === 'debt') { const d = state.debts.find((y) => y.id === x.debtId); return d ? d.name : tr('a loan'); }
    return '';
  }

  // A transfer to savings (Jar, a SIP, an RD): where does it count?
  function savedCheckItem(x) {
    const top = state.debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
    const b = (use, name, extra) => '<button data-action="saved-dest" data-id="' + esc(x.id) + '" data-use="' + use + '"' + (extra || '') + '>' + name + '</button>';
    return '<div class="check-item"><div class="check-top"><div class="grow"><div class="title">' + tr('Saved to {where}', { where: esc(x.note || tr('savings')) }) + '</div>' +
      '<div class="meta">' + fmtDate(x.date) + ' · ' + tr('not spending. Where does it count?') + '</div></div><div class="amt good">' + inr(x.amount) + '</div></div>' +
      '<div class="row">' + savingPlaces().map((p) => b(p.use, esc(p.label), (p.debtId ? ' data-debt="' + esc(p.debtId) + '"' : '') + (p.goalId ? ' data-goal="' + esc(p.goalId) + '"' : ''))).join('') + '</div>' +
      '<div class="row"><button class="ghost" data-action="saved-was-spend" data-id="' + esc(x.id) + '">' + tr('It was spending') + '</button></div></div>';
  }

  // Money received that still needs a decision, newest first.
  function pendingIncome() {
    return state.transactions.filter((x) => Core.isIncome(x) && !x.useFor && !x.passedOn)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /*
   * Money in and the same amount out, close together: passed on? Then neither
   * counts. Borrowed money passed on is still owed, so it can become a loan.
   */
  function passCard() {
    const t = today();
    const f = ui.passForm;
    const pair = f ? { in: state.transactions.find((x) => x.id === f.inId), out: state.transactions.find((x) => x.id === f.outId) } : Core.passThroughPair(state, t);
    if (!pair || !pair.in || !pair.out) return '';
    const outs = pair.outs || [pair.out];
    const from = pair.in.note || tr('someone');
    const to = pair.out.note || tr('someone');
    const outTotal = outs.reduce((a, x) => a + x.amount, 0);
    const ids = ' data-in="' + esc(pair.in.id) + '" data-out="' + esc(outs.map((x) => x.id).join(',')) + '"';
    if (f) {
      const date = (id, label) => '<label class="field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="date" min="' + t + '"></label>';
      return '<section class="card income-card pass-card"><div class="card-head"><h2>' + tr('Borrowed from {from}, lent to {to}', { from: esc(from), to: esc(to) }) + '</h2></div>' +
        '<p class="hint">' + tr('Any dates promised? Leave them empty if there are none. Paying back can be all at once or in parts.') + '</p>' +
        '<div class="form-grid">' + date('pf-to', tr('{to} gives it back by', { to: esc(to) })) + date('pf-from', tr('You pay {from} back by', { from: esc(from) })) + '</div>' +
        '<div class="row"><button class="primary" data-action="pass-iou"' + ids + '>' + tr('Save') + '</button><button class="ghost" data-action="pass-form-cancel">' + tr('Cancel') + '</button></div></section>';
    }
    return '<section class="card income-card pass-card"><div class="card-head"><h2>' + tr('Money passing through?') + '</h2></div>' +
      '<p class="hint">' + (outs.length > 1
        ? tr('{amount} came from {from} on {date1}, and {paid} went to {to} in {n} payments. If you passed it on, it’s neither your income nor your spending.',
          { amount: inr(pair.in.amount), from: esc(from), paid: inr(outTotal), to: esc(to), n: outs.length, date1: fmtDate(pair.in.date) })
        : tr('{amount} came from {from} on {date1}, and {amount} went to {to} on {date2}. If you passed it on, it’s neither your income nor your spending.',
          { amount: inr(pair.in.amount), from: esc(from), to: esc(to), date1: fmtDate(pair.in.date), date2: fmtDate(pair.out.date) })) + '</p>' +
      '<div class="choices">' +
      (outs.length > 1 ? '' : '<button class="choice suggested" data-action="pass-borrow"' + ids + '><span class="choice-title">' + tr('Borrowed from {from}, lent to {to}', { from: esc(from), to: esc(to) }) + '</span>' +
        '<span class="choice-detail">' + tr('You owe {from}, {to} owes you. Kept in People, with any promised dates.', { from: esc(from), to: esc(to) }) + '</span></button>') +
      '<button class="choice" data-action="pass-yes"' + ids + '><span class="choice-title">' + tr('Just passed it on') + '</span>' +
        '<span class="choice-detail">' + tr('Nobody owes anybody: you only delivered it.') + '</span></button></div>' +
      '<div class="row"><button data-action="pass-no"' + ids + '>' + tr('No, they’re separate') + '</button></div></section>';
  }

  // ---------- people: money between you and friends or family ----------

  // Buttons on an entry: start an IOU with it, or record it as a repayment.
  function iouActions(x) {
    if (x.iouId || x.iouPay || x.passedOn) return '';
    const isIn = Core.isIncome(x);
    if (!isIn && !Core.isFlexible(x)) return '';
    const shop = Core.normalizeMerchant(x.note);
    // Repayments: money in pays back what someone owes you; money out pays back what you owe.
    const open = Core.openIous(state, isIn ? 'lent' : 'owe')
      .sort((a, b) => (Core.normalizeMerchant(b.name) === shop) - (Core.normalizeMerchant(a.name) === shop));
    return '<div class="iou-actions">' +
      open.slice(0, 3).map((i) => '<button class="ghost small" data-action="iou-pay-tx" data-id="' + esc(x.id) + '" data-iou="' + esc(i.id) + '">' +
        tr(isIn ? '{name} paying back ({left} left)' : 'Paying {name} back ({left} left)', { name: esc(i.name), left: inr(Core.iouLeft(i)) }) + '</button>').join('') +
      '<button class="ghost small" data-action="iou-start" data-id="' + esc(x.id) + '">' + tr(isIn ? 'Borrowed: I’ll pay it back' : 'I lent this') + '</button></div>';
  }

  function iouStartForm() {
    const f = ui.iouStart;
    const x = f && state.transactions.find((y) => y.id === f.txId);
    if (!x) return '';
    const isIn = Core.isIncome(x);
    return '<div class="callout iou-form"><b>' + tr(isIn ? 'Borrowed {amount}' : 'Lent {amount}', { amount: inr(x.amount) }) + '</b>' +
      '<div class="form-grid"><label class="field" for="is-name"><span>' + tr(isIn ? 'From' : 'To') + '</span><input id="is-name" type="text" value="' + esc(x.note || '') + '"></label>' +
      '<label class="field" for="is-date"><span>' + tr(isIn ? 'You pay it back by (if promised)' : 'They give it back by (if promised)') + '</span><input id="is-date" type="date" min="' + today() + '"></label></div>' +
      '<div class="row"><button class="primary" data-action="iou-start-save">' + tr('Save') + '</button><button class="ghost" data-action="iou-start-cancel">' + tr('Cancel') + '</button></div></div>';
  }

  // Promised dates that came: did the money move?
  function iouDueCard() {
    const t = today();
    const due = (state.iou || []).filter((i) => Core.iouLeft(i) > 0 && i.promised && i.promised <= t && (state.iouAsked || {})[i.id] !== t)
      .sort((a, b) => (a.promised < b.promised ? -1 : a.promised > b.promised ? 1 : a.dir === 'lent' ? -1 : 1));
    if (!due.length) return '';
    const i = due[0];
    const left = Core.iouLeft(i);
    return '<section class="card income-card iou-due"><div class="card-head"><h2>' + tr(i.dir === 'lent'
      ? '{name} promised {amount} by {date}. Did it come back?' : 'You promised {name} {amount} by {date}. Did you pay?',
      { name: esc(i.name), amount: inr(left), date: fmtDate(i.promised) }) + '</h2></div>' +
      (ui.iouPay === i.id ? iouPayForm(i) :
        '<div class="row"><button class="primary" data-action="iou-all" data-iou="' + esc(i.id) + '">' + tr('Yes, all of it') + '</button>' +
        '<button data-action="iou-pay-open" data-iou="' + esc(i.id) + '">' + tr('Part of it') + '</button>' +
        '<button class="ghost" data-action="iou-later" data-iou="' + esc(i.id) + '">' + tr('Not yet') + '</button></div>') + '</section>';
  }

  function iouPayForm(i) {
    return '<div class="form-grid"><label class="field" for="ip-amt"><span>' + tr('Amount (₹)') + '</span><input id="ip-amt" type="number" inputmode="numeric" min="1" max="' + Core.iouLeft(i) + '"></label>' +
      '<label class="field" for="ip-date"><span>' + tr('Date') + '</span><input id="ip-date" type="date" max="' + today() + '" value="' + today() + '"></label></div>' +
      '<div class="row"><button class="primary" data-action="iou-pay-save" data-iou="' + esc(i.id) + '">' + tr('Save') + '</button><button class="ghost" data-action="iou-pay-cancel">' + tr('Cancel') + '</button></div>';
  }

  /*
   * A repayment: tied to an entry already there (the bank SMS) when one
   * matches, otherwise recorded as money in or out, so the balance follows.
   */
  function recordIouPayment(i, amount, date) {
    const isIn = i.dir === 'lent';
    const shop = Core.normalizeMerchant(i.name);
    const match = state.transactions.find((x) => !x.iouId && !x.iouPay && !x.passedOn && Math.round(x.amount) === amount &&
      Math.abs(Core.daysBetween(x.date, date)) <= 5 && (isIn ? Core.isIncome(x) : Core.isFlexible(x)) &&
      !!shop && Core.normalizeMerchant(x.note) === shop);
    let tx = match;
    if (!tx) {
      tx = isIn ? { id: uid(), kind: 'in', date, amount, category: 'Money returned', note: i.name, source: 'manual', useFor: 'spend' }
        : { id: uid(), date, amount, category: 'Misc', note: i.name, source: 'manual' };
      state.transactions.push(tx);
    }
    Core.payIou(state, i.id, amount, date, tx.id);
  }

  function peopleCard() {
    const t = today();
    const sm = Core.iouSummary(state, t);
    const all = (state.iou || []).slice().sort((a, b) => (Core.iouLeft(b) > 0) - (Core.iouLeft(a) > 0) || (a.promised || '9') < (b.promised || '9') ? -1 : 1);
    const row = (i) => {
      const left = Core.iouLeft(i);
      const late = left > 0 && i.promised && i.promised < t;
      let html = '<div class="list-item iou-item"><div class="grow"><div class="title">' + esc(i.name) + '</div>' +
        '<div class="meta' + (late ? ' bad' : '') + '">' + (left === 0 ? tr('Settled') : tr(i.dir === 'lent' ? 'Owes you {amount}' : 'You owe {amount}', { amount: inr(left) }) +
          (i.promised ? ' · ' + tr(late ? 'was promised by {date}' : 'promised by {date}', { date: fmtDate(i.promised) }) : ' · ' + tr('no date'))) +
        ((i.payments || []).length ? ' · ' + tr('{n} paid back so far', { n: inr(Number(i.paid) || 0) }) : '') + '</div></div>' +
        '<div class="amt ' + (i.dir === 'lent' ? 'good' : 'bad') + '">' + (left ? (i.dir === 'lent' ? '+' : '−') + inr(left) : '✓') + '</div></div>';
      if (left > 0) {
        if (ui.iouPay === i.id) html += iouPayForm(i);
        else if (ui.iouEdit === i.id) {
          html += '<div class="form-grid"><label class="field" for="ie-name"><span>' + tr('Name') + '</span><input id="ie-name" type="text" maxlength="40" value="' + esc(i.name) + '"></label>' +
            '<label class="field" for="ie-date"><span>' + tr('Promised by') + '</span><input id="ie-date" type="date" value="' + esc(i.promised || '') + '"></label>' +
            '<label class="field" for="ie-int"><span>' + tr('Interest agreed (₹, added to it)') + '</span><input id="ie-int" type="number" inputmode="numeric" min="0" placeholder="0"></label></div>' +
            '<div class="row"><button class="primary" data-action="iou-edit-save" data-iou="' + esc(i.id) + '">' + tr('Save') + '</button><button class="ghost" data-action="iou-edit-cancel">' + tr('Cancel') + '</button>' +
            '<span class="spacer"></span><button class="danger" data-action="iou-remove" data-iou="' + esc(i.id) + '">' + tr('Remove') + '</button></div>';
        } else {
          html += '<div class="row"><button class="small" data-action="iou-pay-open" data-iou="' + esc(i.id) + '">' + tr(i.dir === 'lent' ? 'Got some back' : 'Paid some back') + '</button>' +
            '<button class="ghost small" data-action="iou-edit" data-iou="' + esc(i.id) + '">' + tr('Name, date or interest') + '</button></div>';
        }
      }
      return html;
    };
    const form = ui.iouAdd
      ? '<div class="callout iou-form"><div class="form-grid">' +
        '<label class="field" for="ia-name"><span>' + tr('Who') + '</span><input id="ia-name" type="text"></label>' +
        '<label class="field" for="ia-dir"><span>' + tr('Which way') + '</span><select id="ia-dir"><option value="owe">' + tr('I owe them') + '</option><option value="lent">' + tr('They owe me') + '</option></select></label>' +
        '<label class="field" for="ia-amt"><span>' + tr('Amount (₹)') + '</span><input id="ia-amt" type="number" inputmode="numeric" min="1"></label>' +
        '<label class="field" for="ia-date"><span>' + tr('Promised by (if any)') + '</span><input id="ia-date" type="date"></label></div>' +
        '<p class="hint">' + tr('For money that moved before you used the app. New money from SMS can be marked as borrowed or lent from its entry.') + '</p>' +
        (ui.iouError ? '<p class="bad" role="alert">' + esc(ui.iouError) + '</p>' : '') +
        '<div class="row"><button class="primary" data-action="iou-add-save">' + tr('Add') + '</button><button class="ghost" data-action="iou-add-cancel">' + tr('Cancel') + '</button></div></div>'
      : '<div><button data-action="iou-add">' + tr('Add someone') + '</button></div>';
    return '<section class="card people-card"><div class="card-head">' + titled('People', 'people') + '</div>' +
      '<p class="hint">' + tr('Money between you and friends or family: no EMI, paid back all at once or in parts, by a date only if one was promised.') + '</p>' +
      (all.length ? '<div class="summary">' + '<div class="line"><span>' + tr('You owe') + '</span><span class="bad">' + inr(sm.oweTotal) + '</span></div>' +
        '<div class="line"><span>' + tr('Owed to you') + '</span><span class="good">' + inr(sm.lentTotal) + '</span></div>' +
        '<div class="line total"><span>' + tr('Balance') + '</span><span>' + (sm.net === 0 ? tr('Even') : sm.net > 0 ? tr('{amount} to you', { amount: inr(sm.net) }) : tr('{amount} you owe', { amount: inr(-sm.net) })) + '</span></div></div>' +
        '<div class="list">' + all.map(row).join('') + '</div>' : '') + form + '</section>';
  }

  function incomeCard() {
    const pending = pendingIncome();
    if (!pending.length) return '';
    const tx = pending[0];
    if (ui.keepForm === tx.id) {
      return '<section class="card income-card"><div class="card-head"><h2>' + tr('What is the {amount} for?', { amount: inr(tx.amount) }) + '</h2></div>' +
        '<p class="hint">' + tr('It stays in your account, kept out of daily spending. When you buy it, tap Use it, and the purchase is covered by this money.') + '</p>' +
        '<label class="field" for="keep-name"><span>' + tr('For') + '</span><input id="keep-name" type="text" maxlength="40" placeholder="' + esc(tr('Diwali shopping')) + '"></label>' +
        '<div class="row"><button class="primary" data-action="keep-save" data-id="' + esc(tx.id) + '">' + tr('Keep it') + '</button><button class="ghost" data-action="keep-cancel">' + tr('Cancel') + '</button></div></section>';
    }
    const o = Core.incomeOptions(state, tx.id, today());
    return '<section class="card income-card"><div class="card-head"><h2>' + tr('What should this {amount} do?', { amount: inr(tx.amount) }) + '</h2>' +
      (pending.length > 1 ? '<span class="hint">' + tr('{n} more after this', { n: pending.length - 1 }) + '</span>' : '') + '</div>' +
      '<p class="hint">' + (tx.note ? esc(tr(tx.note)) + ' · ' : '') + esc(label(tx.category)) + ' · ' + fmtDate(tx.date) + '. ' + tr('Until you choose, it counts as money for this month.') + '</p>' +
      '<div class="choices">' + o.options.map((opt) =>
        '<button class="choice' + (opt.use === o.recommended ? ' suggested' : '') + '" data-action="income-use" data-id="' + esc(tx.id) + '" data-use="' + opt.use + '"' + (opt.debtId ? ' data-debt="' + esc(opt.debtId) + '"' : '') + '>' +
        '<span class="choice-title">' + esc(opt.title) + (opt.use === o.recommended ? ' <span class="chip chip-auto">' + tr('Suggested') + '</span>' : '') + '</span>' +
        '<span class="choice-detail">' + esc(opt.detail) + '</span>' +
        (opt.badge ? '<span class="choice-badge">' + esc(opt.badge) + '</span>' : '') + '</button>').join('') + '</div>' +
      '<p class="hint"><b>' + tr('Why the suggestion:') + '</b> ' + esc(o.reason) + ' ' + tr('The choice is yours.') + '</p>' +
      (ui.iouStart && ui.iouStart.txId === tx.id ? iouStartForm() : iouActions(tx)) + reimbMatchBox(tx) + '</section>';
  }

  // Applies a choice for money received: moves it to a fund or a loan.
  function setIncomeUse(tx, use, debtId, goalId) {
    undoIncomeUse(tx);
    const sv = state.savings;
    if (use === 'goal') {
      const g = (state.goals || []).find((x) => x.id === goalId);
      if (!g) return;
      g.saved = (Number(g.saved) || 0) + tx.amount;
      // A transfer out of the account (not money still in it): kept apart, so net worth still counts it.
      if (Core.isMove(tx)) g.savedOutside = (Number(g.savedOutside) || 0) + tx.amount;
      tx.goalId = g.id;
    }
    if (use === 'emergency') sv.emergencyBalance = (Number(sv.emergencyBalance) || 0) + tx.amount;
    if (use === 'grow') sv.investSaved = (Number(sv.investSaved) || 0) + tx.amount;
    // Taken out of your own savings: the fund goes down by what it held, at most.
    if (use === 'fromfund' || use === 'fromgrow') {
      const key = use === 'fromfund' ? 'emergencyBalance' : 'investSaved';
      tx.fromSaved = Math.min(tx.amount, Number(sv[key]) || 0);
      sv[key] = (Number(sv[key]) || 0) - tx.fromSaved;
    }
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
    // Kept for something: the purchases it paid for count on your budgets again.
    if (tx.useFor === 'keep') {
      (tx.keepUses || []).forEach((u) => {
        const x = state.transactions.find((y) => y.id === u.id);
        if (x) { x.covered = Math.max(0, (Number(x.covered) || 0) - u.amount); if (!x.covered) { delete x.covered; delete x.coveredFrom; } }
      });
      delete tx.keepUses; delete tx.keepUsed; delete tx.keepFor;
    }
    if (tx.useFor === 'goal') {
      const g = (state.goals || []).find((x) => x.id === tx.goalId);
      if (g) {
        g.saved = Math.max(0, (Number(g.saved) || 0) - tx.amount);
        if (Core.isMove(tx)) g.savedOutside = Math.max(0, (Number(g.savedOutside) || 0) - tx.amount);
      }
      delete tx.goalId;
    }
    if (tx.useFor === 'emergency') sv.emergencyBalance = Math.max(0, (Number(sv.emergencyBalance) || 0) - tx.amount);
    if (tx.useFor === 'grow') sv.investSaved = Math.max(0, (Number(sv.investSaved) || 0) - tx.amount);
    if (tx.useFor === 'fromfund' || tx.useFor === 'fromgrow') {
      const key = tx.useFor === 'fromfund' ? 'emergencyBalance' : 'investSaved';
      sv[key] = (Number(sv[key]) || 0) + (Number(tx.fromSaved) || 0);
      delete tx.fromSaved;
    }
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

  // A category's spending by subcategory, as chips above its payments (only when some have one).
  function whereSubs(payments) {
    const by = {};
    payments.forEach((x) => { const k = x.sub || ''; by[k] = (by[k] || 0) + Core.personalAmt(x); });
    const keys = Object.keys(by).filter((k) => by[k]);
    if (!keys.some((k) => k)) return '';
    return '<div class="chips where-subs">' + keys.sort((a, b) => by[b] - by[a]).map((k) => '<span class="chip">' + esc(k ? tr(k) : tr('Other')) + ' ' + inr(by[k]) + '</span>').join(' ') + '</div>';
  }

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
          ? '<div class="where-list">' + whereSubs(c.payments) + c.payments.slice(0, 12).map((x) => '<div class="where-pay"><span>' + esc(x.note || label(c.name)) + (x.sub ? ' · ' + esc(tr(x.sub)) : '') + ' · ' + fmtDate(x.date) + '</span><span class="amt">' + inr(x.amount) + '</span></div>').join('') +
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
    const spent = list.filter((x) => Core.isFlexible(x) || Core.isBillPayment(x) || Core.isFixedPayment(x)).reduce((s, x) => s + x.amount, 0);
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
      '<label class="field">' + tr('Amount (₹)') + '<input id="tx-amount" type="number" inputmode="decimal" min="1" max="1000000000" step="any" required placeholder="' + (moneyIn ? '2000' : '250') + '"></label>' +
      (moneyIn ? '' : '<p id="tx-big-warn" class="borrow-warn wide" hidden></p>') +
      '<div class="field wide"><span>' + tr('Category') + '</span>' + pickerPair(moneyIn, null, moneyIn ? 'Money received' : 'Food & dining', 'id="tx-category"') + '</div>' +
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
      alertsNudge() + iouDueCard() + fixedTwinCard() + fixedMatchCard() + refundMatchCard() + passCard() + incomeCard() + subSuggestCard() +
      addCard, [
        { key: 'viz-where', group: 'Your spending', icon: 'where', label: 'Where it went', tone: 'mint', viz: 'where', badge: null, html: () => vizCard() },
        { key: 'viz-when', group: 'Your spending', icon: 'when', label: 'When', tone: 'mint', viz: 'when', badge: null, html: () => vizCard() },
        { key: 'viz-trend', group: 'Your spending', icon: 'trend', label: 'Month by month', tone: 'mint', viz: 'trend', badge: null, html: () => vizCard() },
        { key: 'leaks', group: 'Your spending', icon: 'drop', label: 'Little leaks', tone: 'mint',
          badge: leakAsks ? { text: tr('{n} new', { n: leakAsks }), tone: 'bad' } : leaks.perMonth ? { text: shortInr(leaks.perMonth) } : null, html: () => leaksCard() },
        { key: 'events', group: 'Records', icon: 'people', label: 'Trips & events', tone: 'teal',
          badge: (() => { const o = (state.events || []).reduce((a, e) => { const v = Core.eventView(state, e.id); return a + v.owedToYou - v.youOwe; }, 0); return o ? { text: (o > 0 ? '+' : '−') + shortInr(Math.abs(o)), tone: o > 0 ? 'good' : 'bad' } : null; })(),
          html: () => eventsPage() },
        { key: 'reimb', group: 'Records', icon: 'repeat', label: 'Reimbursements', tone: 'teal',
          badge: (() => { const p = Core.reimbView(state).pendingFloat; return p ? { text: shortInr(p) } : null; })(), html: () => reimbPage() },
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
          (state.smsAuto ? alertsBox(false) : '') +
          smsPreview() + skippedPlaces() + '</section>'
        : '<section class="card"><div class="card-head">' + titled('Import from bank SMS', 'sms') + '</div>' +
          '<label class="field" for="sms-text">' + tr('Messages') + '<textarea id="sms-text" placeholder="Rs.450.00 debited from a/c **1234 on 21-10-26 to VPA swiggy@icici…">' + esc(ui.smsText) + '</textarea></label>' +
          '<div class="row"><button class="primary" data-action="sms-read">' + tr('Read messages') + '</button><button data-action="sms-sample">' + tr('Paste sample messages') + '</button></div>' +
          smsPreview() + skippedPlaces() +
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
        const cardRow = p.type === 'statement' || p.type === 'cardpayment' || p.type === 'cardemi';
        const note = r.duplicate ? tr('Already added') : r.match ? tr('Matches your entry: {note}, {date}', { note: esc(r.match.note || label(r.match.category || '')), date: fmtDate(r.match.date) }) : isIn && Core.looksLikeSalary(state, p) ? tr('Looks like your salary, which is already counted') : smsNote(p) || (isIn ? tr('Money in') : '');
        const check = '<td><input type="checkbox" data-sms-check="' + i + '" aria-label="' + tr('Add this') + '"' + (r.checked ? ' checked' : '') + '></td>';
        if (cardRow) {
          return '<tr' + (r.duplicate ? ' class="muted"' : '') + '>' + check +
            '<td><div class="cell-title">' + tr(p.type === 'statement' ? 'Card statement' : p.type === 'cardemi' ? 'Card EMI booked' : 'Card bill payment') + '</div><div class="cell-sub">' + fmtDate(p.date) + ' · ' + note + '</div></td>' +
            '<td>—</td><td class="amt">' + inr(p.amount) + '</td></tr>';
        }
        return '<tr' + (r.duplicate || (isIn && Core.looksLikeSalary(state, p)) ? ' class="muted"' : '') + '>' + check +
          '<td><div class="cell-title">' + esc(tr(p.merchant)) + '</div><div class="cell-sub">' + fmtDate(p.date) + (note ? ' · ' + note : '') +
          ' · <button class="link" data-action="sms-skip-like" data-i="' + i + '">' + tr('Skip SMS like this') + '</button></div></td>' +
          '<td>' + pickerPair(isIn, null, p.sub && !personPick(p.category) && !isSmart(p.category) ? p.category + '|' + p.sub : p.category, 'data-sms-cat="' + i + '"') + '</td>' +
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

  // Words or phrases the user chose to skip ("BluChips"), in any case.
  function smsSkipText(text) {
    const lower = String(text || '').toLowerCase();
    return (state.smsSkipText || []).some((w) => w && lower.indexOf(String(w).toLowerCase()) !== -1);
  }

  function smsRowsOf(messages, known) {
    return messages.map(({ text, day }) => {
      const parsed = smsSkipText(text) ? null : Core.parseSms(text, state.merchantRules, day);
      const key = Core.smsKey(text);
      if (parsed && parsed.type === 'credit' && parsed.salary) noteSalary(parsed);
      const duplicate = !!parsed && (known.has(key) || (parsed.type !== 'statement' && smsSkipped(parsed.merchant)) || state.transactions.some((x) => !x.kind && (
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
    // The account the SMS is about: money moved by hand from (or into) it is the same money.
    const acct = (walletForAcct(p.acct) || {}).id || 'main';
    const cash = cashWallet();
    const onCard = p.paidFrom === 'card';
    // Recorded by hand as a bill, card bill, fixed payment or EMI, or money moved: the SMS is that one, whatever the amount.
    const kept = (x) => !!x.billId || x.kind === 'cardpay' || (x.fixedNew && Core.isFixedPayment(x)) || Core.isTransfer(x);
    // Money moved between your own accounts has two sides: the debit SMS from one and the credit SMS into the other.
    const side = (x) => (Core.isTransfer(x) && p.type === 'credit' ? !x.smsKeyIn : !x.smsKey);
    const hits = state.transactions.filter((x) => side(x) && x.source !== 'sms' && x.source !== 'import' && x.source !== 'reconcile' && x.source !== 'event' &&
      Number(x.amount) === p.amount && Math.abs(Core.daysBetween(x.date, p.date)) <= 3 && !(cash && x.wallet === cash.id) &&
      (p.type === 'credit' ? (Core.isIncome(x) && !x.fromFund) || (Core.isTransfer(x) && x.to === acct && !onCard)
        : Core.isTransfer(x) ? x.from === acct && !onCard
          : Core.isFlexible(x) || ((x.iouId || x.iouPay) && !Core.isIncome(x)) || (kept(x) && !onCard && !(x.paidFrom && x.paidFrom !== 'account'))));
    if (!hits.length) return null;
    // Same place: the closest one. Otherwise only one clear candidate, and not a small everyday amount (two ₹100 teas are two payments).
    const named = hits.filter((x) => shop && Core.normalizeMerchant(x.note) === shop);
    const pool = named.length ? named : hits.length === 1 && (p.amount >= 200 || kept(hits[0])) ? hits : [];
    return pool.sort((a, b) => Math.abs(Core.daysBetween(a.date, p.date)) - Math.abs(Core.daysBetween(b.date, p.date)))[0] || null;
  }

  // Places whose bank SMS are never payments (an app's OTPs or payment requests, say).
  // Places marked "skip SMS from now on", each with a way back; and words to skip.
  function skippedPlaces() {
    return skipTextBox() + skippedShops();
  }

  function skipTextBox() {
    const words = state.smsSkipText || [];
    return '<div class="callout skip-text"><b>' + tr('Skip SMS that contain') + '</b>' +
      '<span class="hint">' + tr('Offers or alerts that aren’t payments keep coming? Add a word from them, like BluChips. Any SMS with it is left out, now and in notifications.') + '</span>' +
      (words.length ? '<div class="row">' + words.map((w) => '<button class="ghost small" data-action="sms-skip-text-remove" data-word="' + esc(w) + '" aria-label="' + esc(tr('Stop skipping {shop}', { shop: w })) + '">' + esc(w) + ' ✕</button>').join('') + '</div>' : '') +
      '<div class="row"><label class="field" for="skip-word"><span>' + tr('Word or phrase') + '</span><input id="skip-word" type="text" maxlength="40" value="' + esc(ui.skipDraft || '') + '" placeholder="BluChips"></label>' +
      '<button data-action="sms-skip-text-add">' + tr('Skip') + '</button></div></div>';
  }

  function skippedShops() {
    const list = state.smsSkip || [];
    if (!list.length) return '';
    return '<div class="callout"><b>' + tr('SMS skipped from') + '</b>' +
      '<div class="row">' + list.map((x) => {
        const name = (state.smsSkipNames || {})[x] || x;
        return '<button class="ghost small" data-action="sms-unskip" data-shop="' + esc(x) + '" aria-label="' + esc(tr('Stop skipping {shop}', { shop: name })) + '">' + esc(name) + ' ✕</button>';
      }).join('') + '</div></div>';
  }

  // Compared without spaces: one bank writes "Sukhwani Petroleum", another "sukhwanipetroleum@okaxis".
  function skipKey(merchant) { return Core.normalizeMerchant(merchant).replace(/\s+/g, ''); }
  function smsSkipped(merchant) {
    const shop = skipKey(merchant);
    return !!shop && (state.smsSkip || []).indexOf(shop) !== -1;
  }

  /*
   * An SMS-made entry that isn't a payment: taken out, with whatever it changed
   * undone, and its SMS remembered so a later scan doesn't bring it back. With
   * skipShop, SMS from that place are left out from now on.
   */
  function notPayment(tx, skipShop) {
    const before = JSON.stringify(state);
    // For a problem report: which readings were wrong, so the SMS reader can learn.
    logEvent('notpayment', { shop: logText(tx.note), amount: tx.amount, kind: tx.kind || 'spend', category: tx.category, skipShop: !!skipShop });
    if (Core.isIncome(tx) || Core.isMove(tx)) undoIncomeUse(tx);
    if (tx.claimId || tx.payoutId) Core.reimbForget(state, tx);
    Core.maybeForget(state, tx);
    Core.unlinkRefund(state, tx); Core.forgetRefunds(state, tx);
    Core.unpassOn(state, tx);
    if (tx.smsKey) state.smsIgnored = (state.smsIgnored || []).concat(tx.smsKey).slice(-500);
    const shop = skipKey(tx.note);
    if (skipShop && shop && (state.smsSkip || []).indexOf(shop) === -1) {
      state.smsSkip = (state.smsSkip || []).concat(shop).slice(-200);
      state.smsSkipNames = Object.assign({}, state.smsSkipNames, { [shop]: tx.note });
    }
    state.transactions = state.transactions.filter((x) => x !== tx);
    ui.editTx = null;
    save();
    rerenderKeepScroll();
    offerUndo(skipShop && shop ? tr('Left out. SMS from {shop} are skipped from now on.', { shop: tx.note }) : tr('Left out. It won’t come back from SMS.'), before);
  }

  // SMS keys already recorded: transactions and card statements.
  function knownSmsKeys() {
    return new Set(state.transactions.map((x) => x.smsKey).concat(state.transactions.map((x) => x.smsKeyIn))
      .concat((state.cards || []).map((c) => c.statement && c.statement.smsKey))
      .concat(state.smsIgnored || []).concat(...(state.emiOffers || []).map((x) => [x.key].concat(x.keys || []))).filter(Boolean));
  }

  /*
   * Records one parsed bank SMS. o: key, review (mark "needs your check"),
   * category and note (chosen by the user), cardId ('account' or a card,
   * chosen in the pop-up). Returns false if nothing was recorded. A category
   * from personChoices() (lent, borrowed, paid back) goes to People.
   */
  function recordSms(p, o) {
    // Marked "not a payment" before, or from a place whose SMS are skipped.
    if (o.key && (state.smsIgnored || []).indexOf(o.key) !== -1) return false;
    if (p.raw && smsSkipText(p.raw)) return false;
    if (p.type !== 'statement' && smsSkipped(p.merchant)) return false;
    const chosen = o.cardId && o.cardId !== 'account' ? (state.cards || []).find((c) => c.id === o.cardId) : null;
    const card = chosen || findCard(p.last4);
    if (p.type === 'statement') {
      if (!card) return false;
      card.statement = { date: p.date, total: p.amount, min: p.min, due: p.due, smsKey: o.key };
      return true;
    }
    const person = personPick(o.category);
    // A choice that does something (a bill, an EMI, savings, a refund, your own money) is done once the entry is in.
    const smart = !person && isSmart(o.category) ? o.category : null;
    const plain = person || smart ? null : Core.splitCat(o.category || p.category);
    const cat = person ? (p.type === 'credit' ? (person.iou ? 'Money returned' : 'Money received') : 'Misc')
      : smart ? (p.type === 'credit' ? 'Money received' : 'Misc') : plain.category;
    // The subcategory: the one chosen, or the shop's own when the category is the one read from the SMS.
    const sub = plain ? plain.sub || (plain.category === Core.splitCat(p.category).category ? p.sub : null) : null;
    // An EMI booked on a card: kept to offer on the card, never as a payment.
    if (p.type === 'cardemi') {
      if ((state.emiOffers || []).some((x) => x.key === o.key)) return false;
      // The OTP and the "processed" SMS are the same EMI: one offer, kept from the first.
      const same = (state.emiOffers || []).find((x) => x.last4 === p.last4 && x.months === p.months && Math.abs(x.amount - p.amount) <= 2 &&
        Math.abs(Core.daysBetween(x.date, p.date)) <= 7);
      if (same) { same.keys = (same.keys || []).concat(o.key); if (p.booked) same.booked = true; return true; }
      state.emiOffers = (state.emiOffers || []).concat({ key: o.key, date: p.date, amount: p.amount, months: p.months, rate: p.rate, last4: p.last4, booked: !!p.booked }).slice(-20);
      return true;
    }
    if (p.type === 'credit' && Core.looksLikeSalary(state, p)) {
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
    // Already typed in by hand? Link the SMS to that entry; the person's category and note stay.
    const mine = manualTwin(p);
    if (mine && Core.isTransfer(mine) && p.type === 'credit') {
      mine.smsKeyIn = o.key;
      mine.matchedIn = { date: p.date, merchant: p.merchant, category: cat, type: p.type, paidFrom: null, wallet: fromWallet ? fromWallet.id : null };
      return true;
    }
    if (mine) {
      mine.smsKey = o.key;
      // Kept so "Not the same payment" can add the SMS as its own entry.
      mine.matched = { date: p.date, merchant: p.merchant, category: cat, type: p.type, paidFrom: paidFrom === 'account' ? null : paidFrom, wallet: fromWallet ? fromWallet.id : null };
      if (paidFrom !== 'account' && paidFrom.indexOf('card:') !== 0 && !mine.paidFrom && !mine.wallet) mine.paidFrom = paidFrom;
      else if (fromWallet && !mine.paidFrom && !mine.wallet && !Core.isTransfer(mine)) mine.wallet = fromWallet.id;
      if (person && (Core.isFlexible(mine) || Core.isIncome(mine)) && (!Core.isIncome(mine) || !mine.useFor || mine.useFor === 'spend')) linkPerson(mine, person);
      return true;
    }
    // With a Cash wallet, cash from an ATM is moved, not spent: what's spent in cash is noted from the wallet.
    if (p.type === 'debit' && p.atm && paidFrom === 'account' && cashWallet() && cat === 'Cash') {
      state.transactions.push({ id: uid(), kind: 'transfer', date: p.date, amount: p.amount, from: fromWallet ? fromWallet.id : 'main', to: cashWallet().id,
        note: tr('ATM withdrawal'), source: o.source || 'sms', smsKey: o.key });
      return true;
    }
    const tx = { id: uid(), date: p.date, amount: p.amount, category: cat, note: o.note || p.merchant, source: 'sms', smsKey: o.key };
    if (sub && p.type !== 'credit') tx.sub = sub;
    if (paidFrom !== 'account') tx.paidFrom = paidFrom;
    else if (fromWallet) tx.wallet = fromWallet.id;
    // Cash on a credit card: borrowed, and in hand (in the Cash wallet when there is one), not spent yet.
    if (p.cashAdvance && paidFrom !== 'account' && paidFrom.indexOf('card:') !== 0) {
      tx.cashAdvance = true; tx.category = 'Cash';
      if (cashWallet()) tx.wallet = cashWallet().id;
    }
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
    // A refund to a card for something bought on it this month cancels that purchase.
    if (p.type === 'credit' && !person && paidFrom !== 'account' && paidFrom.indexOf('card:') !== 0) {
      const buy = Core.refundToPurchase(state, paidFrom, { amount: p.amount, merchant: tx.note, date: p.date, key: o.key }, today());
      if (buy) {
        if (o.key) state.smsIgnored = (state.smsIgnored || []).concat(o.key).slice(-500);
        smsNews.push(tr('{amount} refunded: {shop} now costs {left}', { amount: inr(p.amount), shop: buy.note || label(buy.category), left: inr(buy.amount) }));
        logEvent('refund', { amount: p.amount, full: buy.amount === 0 });
        return true;
      }
    }
    if (p.type === 'credit') {
      tx.kind = 'in';
      // A refund to a card lowers the card bill, so it stays as this month's money.
      tx.useFor = paidFrom !== 'account' ? 'spend' : null;
      if (paidFrom === 'account' && !person && (Core.isLoanCredit(p.raw) || tx.category === LOAN_CATEGORY)) {
        tx.category = LOAN_CATEGORY;
        tx.borrowed = true;
        tx.useFor = 'spend';
      }
    } else if (o.review || paidFrom.indexOf('card:') === 0) {
      tx.needsReview = true;
    } else if (!o.noLearn && !person) {
      const shop = Core.normalizeMerchant(tx.note);
      if (shop && tx.note !== 'Bank payment' && !smart) state.merchantRules[shop] = tx.category + (tx.sub ? '|' + tx.sub : '');
    }
    if (o.source) tx.source = o.source;
    // Lent or borrowed, noted under People in the last few days without the payment: this SMS is that money.
    const owed = !person && !smart && paidFrom === 'account' ? Core.iouTwin(state, { amount: p.amount, date: p.date, dir: p.type === 'credit' ? 'in' : 'out' }) : null;
    state.transactions.push(tx);
    if (owed) {
      tx.iouId = owed.id; tx.needsReview = false;
      if (tx.kind === 'in') tx.useFor = 'spend';
      smsNews.push(tr(owed.dir === 'lent' ? '{amount} lent to {name}: this SMS is that money, not spending.' : '{amount} borrowed from {name}: this SMS is that money, not income.', { amount: inr(p.amount), name: owed.name }));
    }
    if (person) linkPerson(tx, person);
    if (smart) { const msg = applySmart(tx, smart); if (msg) smsNews.push(msg); else tx.needsReview = true; }
    return true;
  }

  /*
   * People choices next to the categories (notification pop-up, SMS list):
   * paying back someone with an open IOU, or a new lend / borrow.
   */
  /*
   * People on a payment's list: everyone with money open that way (not a
   * guess from the SMS name, which may be a number or a UPI short form).
   * The person picked before for the same payee comes first; the rest by
   * name. Trip and event balances settle through the event; deposits and
   * advances are money you get back, like lending.
   */
  function personChoices(isIn, x) {
    const key = x && Core.normalizeMerchant(x.note);
    const known = key && (state.payeeLinks || {})[key];
    const first = (name) => (known && String(name).toLowerCase() === known ? 0 : 1);
    const open = Core.openIous(state, isIn ? 'lent' : 'owe').filter((i) => !i.eventId)
      .sort((a, b) => first(a.name) - first(b.name) || String(a.name).localeCompare(String(b.name)));
    const trips = [];
    (state.events || []).forEach((ev) => Core.eventBalances(state, ev).forEach((b) => {
      if (isIn ? b.net > 0 : b.net < 0) trips.push(['@ev:' + ev.id + ':' + b.name, tr(isIn ? '{event}: {name} paying back ({left} left)' : '{event}: paying {name} ({left} left)', { event: ev.name, name: b.name, left: inr(Math.abs(b.net)) }), first(b.name)]);
    }));
    trips.sort((a, b) => a[2] - b[2]);
    return open.map((i) => ['@iou:' + i.id, tr(i.deposit ? (isIn ? 'Deposit back: {name} ({left} left)' : 'Deposit: {name} ({left} left)')
      : isIn ? '{name} paying back ({left} left)' : 'Paying {name} back ({left} left)', { name: i.name, left: inr(Core.iouLeft(i)) })])
      .concat(trips.map((t) => [t[0], t[1]]))
      .concat([[isIn ? '@borrowed' : '@lent', tr(isIn ? 'Borrowed from someone' : 'Lent to someone')]])
      .concat(isIn ? [] : [['@deposit', tr('Deposit or advance given (you get it back)')]]);
  }

  // ---------- categories with subcategories, and choices that do something ----------

  /*
   * One list for choosing what a payment is. Money out: each category with its
   * subcategories ('Bills|Electricity'), then the choices that are more than a
   * name: a bill, a card bill, a loan's EMI, a fixed payment, savings, and
   * People. Money in: grouped (earned, friends and family, refunds, loans,
   * your own money, work, People). The same list goes to the bank-SMS pop-up.
   * Returns groups: { label, items: [[value, label]] } (label null: no group).
   */
  const EARNED_PICK = ['Bonus', 'Incentive', 'Overtime', 'Arrears', 'Leave encashment', 'Side income', 'Interest', 'Dividend', 'Rental income', 'Pension'];
  // Money in that isn't earned (a claim paid, a scholarship, rewards, selling something you owned).
  const OTHER_IN_PICK = ['Insurance claim', 'Scholarship', 'Rewards', 'Sale of goods'];
  function pickerGroups(isIn, x) {
    const linked = x && (x.iouId || x.iouPay || x.passedOn || x.covered || x.eventId || x.claimId || x.maybeId || x.refundOf || x.payoutId ||
      (Core.isIncome(x) && x.useFor && x.useFor !== 'spend'));
    const groups = [];
    if (!isIn) {
      // A subcategory with the name of one of your own payments (Bills › Rent and your fixed Rent) is that payment.
      const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
      const mine = linked ? [] : (state.fixed || []).map((f) => ['@fixed:' + f.id, f.name, tr('{name} (your fixed payment)', { name: f.name })])
        .concat((state.bills || []).filter((b) => (Number(b.estimate) || 0) > 0).map((b) => ['@bill:' + b.id, b.name, tr('{name} (your bill)', { name: b.name })]))
        .concat(Core.emiLoans(state).map((d) => ['@loan:' + d.id, d.name, tr('{name} EMI (your loan)', { name: d.name })]));
      const connect = (sub) => {
        const w = norm(sub);
        const hits = mine.filter((m) => { const n = norm(m[1]); return n === w || norm(tr(sub)) === n || (' ' + n + ' ').indexOf(' ' + w + ' ') !== -1; });
        return hits.length === 1 ? [hits[0][0], hits[0][2]] : null;
      };
      categories().forEach((c) => {
        const subs = Core.subcategories(state, c);
        if (!subs.length) { groups.push({ label: null, cat: c, items: [[c, label(c)]] }); return; }
        groups.push({ label: label(c), cat: c, items: [[c, tr('{name}: anything', { name: label(c) })]].concat(subs.map((s) => connect(s) || [c + '|' + s, tr(s)])) });
      });
      if (!linked) {
        const smart = []
          .concat((state.bills || []).filter((b) => (Number(b.estimate) || 0) > 0).map((b) => ['@bill:' + b.id, tr('{name} bill (it learns the amount)', { name: b.name })]))
          .concat((state.cards || []).map((c) => ['@card:' + c.id, tr('Credit card bill: {name}', { name: c.name })]))
          .concat(Core.emiLoans(state).map((d) => ['@loan:' + d.id, tr('EMI: {name}', { name: d.name })]))
          .concat((state.fixed || []).map((f) => ['@fixed:' + f.id, tr('Fixed payment: {name}', { name: f.name })]))
          .concat([['@newloan', tr('EMI of a loan not in the app yet (add it)')]]);
        if (smart.length) groups.push({ label: tr('Bills, cards and EMIs'), items: smart });
        const own = (state.wallets || []).filter((w) => w.kind !== 'cash').map((w) => ['@own:' + w.id, tr('To your {name}', { name: w.name })])
          .concat(cashWallet() ? [['@cash', tr('Cash taken out (to your Cash)')]] : []);
        if (own.length) groups.push({ label: tr('Your own money'), items: own });
        groups.push({ label: tr('Saved, not spent'), items: [['@save:emergency', tr('Emergency fund')], ['@save:grow', tr('SIP, RD, FD or gold')]]
          .concat((state.goals || []).filter((g) => !Core.goalStatus(state, g, today()).done).map((g) => ['@save:goal:' + g.id, tr('Goal: {name}', { name: g.name })])) });
      }
    } else {
      groups.push({ label: tr('Earned'), items: EARNED_PICK.map((c) => [c, tr(c)]) });
      groups.push({ label: tr('Friends and family'), items: ['Gift', 'From family', 'Money received', 'Money returned'].map((c) => [c, tr(c)]) });
      groups.push({ label: tr('Refunds and cashback'), items: (linked ? [] : [['@refund', tr('Refund or reversal of a payment')]]).concat([['Refund', tr('Refund')], ['Cashback', tr('Cashback')]]) });
      groups.push({ label: tr('Loans'), items: [[LOAN_CATEGORY, tr(LOAN_CATEGORY)]] });
      groups.push({ label: tr('Other money in'), items: OTHER_IN_PICK.map((c) => [c, tr(c)]) });
      if (!linked) {
        groups.push({ label: tr('Your own money'), items: [['@fromfund', tr('From your emergency fund')], ['@fromgrow', tr('From your savings, FD or investments')]]
          .concat((state.wallets || []).filter((w) => w.kind !== 'cash').map((w) => ['@own:' + w.id, tr('From your {name}', { name: w.name })]))
          .concat(cashWallet() ? [['@cashdep', tr('Cash deposited (from your Cash)')]] : []) });
        if (Core.reimbView(state).claims.some((c) => !c.closed)) groups.push({ label: tr('Work'), items: [['@reimb', tr('Reimbursement from work')]] });
      }
    }
    if (!linked) groups.push({ label: tr('People'), items: personChoices(isIn, x) });
    return groups;
  }
  /*
   * Two dropdowns, the second opening from the first: first the category or
   * group (Food & dining, Bills, cards and EMIs, People…), then what's in it.
   * A category applies as soon as it's picked (its subcategory is a detail you
   * can add); a group of things that act (a loan, a person) waits for the
   * second pick, so nothing is applied by mistake. The second dropdown keeps
   * the attributes the saving code reads (attrs), so it holds the value.
   */
  function pickerPair(isIn, x, value, attrs) {
    const groups = pickerGroups(isIn, x);
    const v = value != null ? value : x ? (x.sub ? x.category + '|' + x.sub : x.category) : '';
    let gi = groups.findIndex((g) => g.items.some((i) => i[0] === v));
    if (gi === -1 && v) {
      const c = Core.splitCat(v);
      groups.unshift({ label: null, cat: c.category, items: [[v, label(c.category) + (c.sub ? ' › ' + tr(c.sub) : '')]] });
      gi = 0;
    }
    const data = groups.map((g) => ({ l: g.label || g.items[0][1], c: g.cat ? 1 : 0, i: g.items }));
    const opt = (val, lab, on) => '<option value="' + esc(val) + '"' + (on ? ' selected' : '') + '>' + esc(lab) + '</option>';
    const items = gi === -1 ? [] : data[gi].i;
    return '<span class="pick2"><select class="pick-main" aria-label="' + esc(tr('Category')) + '" data-groups="' + esc(JSON.stringify(data)) + '">' +
      (gi === -1 ? opt('', tr('Choose…'), true) : '') + data.map((g, k) => opt(k, g.l, k === gi)).join('') + '</select>' +
      '<select ' + attrs + ' class="pick-sub" aria-label="' + esc(tr('Detail')) + '"' + (items.length <= 1 ? ' hidden' : '') + '>' +
      (gi === -1 ? opt('', '', true) : items.map(([val, lab]) => opt(val, lab, val === v)).join('')) + '</select></span>';
  }
  // The first dropdown chose a group: the second shows what's in it.
  function pickerMainChanged(m) {
    const g = JSON.parse(m.dataset.groups || '[]')[Number(m.value)];
    const sub = m.parentNode && m.parentNode.querySelector('.pick-sub');
    if (!g || !sub) return;
    const auto = g.c || g.i.length === 1;
    sub.innerHTML = (auto ? '' : '<option value="" selected>' + esc(tr('Choose…')) + '</option>') +
      g.i.map(([v, l], k) => '<option value="' + esc(v) + '"' + (auto && k === 0 ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
    sub.hidden = g.i.length === 1;
    if (auto) sub.dispatchEvent(new Event('change', { bubbles: true }));
    else sub.focus();
  }

  // For the bank-SMS pop-up: one short list, the categories without their subcategories (the shop's own comes by itself),
  // then the choices that act: [value, "Group › item"].
  function pickerFlat(isIn) {
    return [].concat(...pickerGroups(isIn, null).map((g) => (g.cat ? [[g.cat, label(g.cat)]]
      : g.items.map(([v, l]) => [v, g.label && l.indexOf(g.label) === -1 ? g.label + ' › ' + l : l]))));
  }

  // Sets a plain choice ('Bills|Electricity' or 'Bills') on an entry, and learns it for the shop.
  function setCategoryChoice(tx, value, learn) {
    const c = Core.splitCat(value);
    tx.category = c.category;
    if (c.sub) tx.sub = c.sub; else delete tx.sub;
    delete tx.subNo;
    if (learn && Core.isFlexible(tx)) {
      const key = Core.normalizeMerchant(tx.note);
      if (key && tx.note !== 'Bank payment') state.merchantRules[key] = value;
    }
  }

  /*
   * A choice that does something: done at once, as its own button would do it.
   * Returns what it did, for the Undo message, or null when it couldn't (the
   * entry is left as it was).
   */
  function isSmart(value) { return /^@(bill|card|loan|fixed|save|refund|fromfund|fromgrow|reimb|newloan|own|cash|cashdep)\b/.test(String(value || '')); }
  function applySmart(tx, value) {
    const [kind, id, more] = String(value).slice(1).split(':');
    if (kind === 'bill') {
      const b = (state.bills || []).find((y) => y.id === id);
      if (!b || !Core.isFlexible(tx)) return null;
      state.transactions = state.transactions.filter((y) => y !== tx);
      const paid = Core.payBill(state, b.id, tx.amount, b.everyMonths, tx.date);
      Object.assign(paid, { note: tx.note || b.name, source: tx.source, smsKey: tx.smsKey });
      if (tx.matched) paid.matched = tx.matched;
      if (tx.wallet) paid.wallet = tx.wallet;
      return tr('Paid {name} bill: next one expected around {amount}.', { name: b.name, amount: inr(b.estimate) });
    }
    if (kind === 'card') {
      const res = Core.spendToCardPayment(state, tx.id, id);
      return res ? tr(res.merged ? 'Counted once now: the {name} bill paid on {date}.' : 'Now a {name} bill payment on {date}, counted once.',
        { name: (state.cards.find((c) => c.id === res.tx.cardId) || {}).name || '', date: fmtDate(res.tx.date) }) : null;
    }
    if (kind === 'loan' || kind === 'fixed') {
      const p = Core.payFixed(state, id, { txId: tx.id });
      if (!p) return null;
      return p.emiFor ? tr('EMI recorded: {interest} interest, {principal} off the loan.', { interest: inr(p.emiInterest), principal: inr(p.emiPrincipal) })
        : tr('Recorded as paid. It won’t be counted again on its due date.');
    }
    if (kind === 'newloan') {
      // A loan the app didn't know: added from this EMI (amount and day), this payment as its EMI. Its balance and rate come next, in Debts.
      if (!Core.isFlexible(tx) || (tx.paidFrom && tx.paidFrom !== 'account')) return null;
      const name = tx.note && tx.note !== 'Bank payment' ? String(tx.note).slice(0, 40) : tr('Loan');
      const d = Object.assign(listDefaults('debts'), { name, minPayment: tx.amount, dueDay: Core.parseISO(tx.date).getDate(), fromEmi: tx.date });
      state.debts.push(d);
      tx.emiFor = d.id; tx.forDue = tx.date; tx.category = 'Bills'; delete tx.sub;
      return tr('{name} added from this EMI. Add what’s left to pay and its rate in Debts.', { name });
    }
    if (kind === 'own' || kind === 'cash' || kind === 'cashdep') {
      // Money between your own accounts or cash: moved, never income or spending.
      const other = kind === 'own' ? (state.wallets || []).find((w) => w.id === id) : cashWallet();
      const fits = kind === 'own' || (kind === 'cashdep' ? Core.isIncome(tx) : !Core.isIncome(tx));
      if (!other || !fits || (tx.paidFrom && tx.paidFrom !== 'account')) return null;
      const mine = tx.wallet || 'main';
      const into = Core.isIncome(tx);
      ['category', 'sub', 'useFor', 'paidFrom', 'wallet', 'borrowed'].forEach((k) => { delete tx[k]; });
      tx.kind = 'transfer';
      tx.from = into ? other.id : mine;
      tx.to = into ? mine : other.id;
      return tr('Moved between your own money: not income, not spending.');
    }
    if (kind === 'save') {
      if (!Core.isFlexible(tx)) return null;
      tx.kind = 'move'; tx.category = 'Savings'; delete tx.sub;
      setIncomeUse(tx, id, null, id === 'goal' ? more : null);
      tx.needsReview = false;
      return tr('Saved, not spent: it doesn’t count against your budgets.');
    }
    if (!Core.isIncome(tx)) return null;
    if (kind === 'refund') {
      tx.category = 'Refund';
      const m = Core.refundMatches(state, today()).find((y) => y.refund === tx);
      if (m && Core.linkRefund(state, tx.id, m.buy.id)) return tr('Refund of your {amount} payment on {date}: that purchase is smaller now, not income.', { amount: inr(m.buy.amount), date: fmtDate(m.buy.date) });
      return tr('Saved as a refund.');
    }
    if (kind === 'fromfund' || kind === 'fromgrow') {
      tx.category = 'Money received';
      setIncomeUse(tx, kind);
      return tr('From your own savings: not income.');
    }
    if (kind === 'reimb') {
      const open = Core.reimbView(state).claims.filter((c) => !c.closed).map((c) => c.id);
      tx.category = 'Money received';
      return Core.recordPayout(state, tx.id, open) ? tr('Matched to your work claims.') : null;
    }
    return null;
  }

  function personPick(category) {
    const v = String(category || '');
    if (!/^@(iou:|ev:|lent$|borrowed$|deposit$)/.test(v)) return null;
    if (v.indexOf('@ev:') === 0) { const rest = v.slice(4); const k = rest.indexOf(':'); return { ev: rest.slice(0, k), name: rest.slice(k + 1) }; }
    return { iou: v.indexOf('@iou:') === 0 ? v.slice(5) : null, deposit: v === '@deposit' };
  }

  /*
   * After something is recorded by hand: its bank SMS, already in, joins it
   * (counted once). Returns the words to say, or ''. `any`: a bill, card
   * bill, move or trip payment, where any amount is that one payment.
   */
  function joinBankSms(tx, any) {
    const x = Core.joinBankTwin(state, tx, any);
    return x ? tr('Linked to the bank SMS of {date} ({merchant}): counted once.', { date: fmtDate(x.date), merchant: x.note || '' }) : '';
  }

  // What a People choice did, said once the SMS are in.
  let smsNews = [];

  // Ties an entry from SMS to People: a repayment of that IOU, or a new one (the payee or payer is the person).
  function linkPerson(tx, pick) {
    if (tx.iouId || tx.iouPay || tx.passedOn) return;
    const isIn = Core.isIncome(tx);
    const key = Core.normalizeMerchant(tx.note);
    const remember = (name) => { if (key) state.payeeLinks = Object.assign({}, state.payeeLinks, { [key]: String(name).toLowerCase() }); };
    if (pick.ev) {
      const res = Core.settleEvent(state, pick.ev, pick.name, { amount: tx.amount, txId: tx.id, date: tx.date });
      if (!res || !res.paid) { tx.needsReview = true; smsNews.push(tr('That doesn’t fit this entry.')); return; }
      remember(pick.name);
      smsNews.push(tr('{amount} settled with {name}. Not income or spending: money passed on.', { amount: inr(res.paid), name: pick.name }));
      if (isIn) tx.useFor = tx.useFor || 'spend';
      return;
    }
    if (pick.iou) {
      const i = Core.openIous(state).find((x) => x.id === pick.iou);
      // Settled meanwhile: left for the person to check.
      if (!i) { tx.needsReview = true; return; }
      Core.payIou(state, i.id, Math.min(tx.amount, Core.iouLeft(i)), tx.date, tx.id);
      remember(i.name);
      smsNews.push(Core.iouLeft(i) ? tr('{left} still to go with {name}', { left: inr(Core.iouLeft(i)), name: i.name }) : tr('Settled with {name}', { name: i.name }));
    } else {
      const i = Core.addIou(state, { name: tx.note, dir: isIn ? 'owe' : 'lent', amount: tx.amount, txId: tx.id }, today());
      if (!i) return;
      // A deposit or advance (rent deposit, booking advance): yours, coming back; not spending.
      if (pick.deposit) { i.deposit = true; tx.category = 'Misc'; }
      smsNews.push(tr(i.dir === 'owe' ? 'In People: you owe {name} {amount}' : 'In People: {name} owes you {amount}', { name: i.name, amount: inr(i.amount) }));
    }
    if (isIn) tx.useFor = tx.useFor || 'spend';
    logEvent('sms-people', { dir: isIn ? 'in' : 'out', repay: !!pick.iou, amount: tx.amount });
  }

  // People choices on an entry's category list, unless it's already tied to someone.
  function peopleOptionsFor(x) {
    if (x.iouId || x.iouPay || x.passedOn || x.covered || (Core.isIncome(x) && x.useFor && x.useFor !== 'spend')) return '';
    return personOptions(Core.isIncome(x), null);
  }

  function personOptions(isIn, selected) {
    const list = personChoices(isIn);
    return '<optgroup label="' + esc(tr('People')) + '">' + list.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</optgroup>';
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
    const goalId = learned && learned.goalId;
    if (use === 'debt' && !state.debts.some((d) => d.id === debtId && d.balance > 0)) use = null;
    // A goal that's gone or reached: back to the usual place.
    if (use === 'goal' && !(state.goals || []).some((g) => g.id === goalId && !Core.goalStatus(state, g, today()).done)) use = null;
    if (!use) {
      const sug = Core.suggestUse(state, today(), null);
      use = sug.use === 'spend' ? 'emergency' : sug.use;
      debtId = sug.debtId;
    }
    setIncomeUse(tx, use, debtId, goalId);
    tx.autoUse = true;
    tx.needsReview = false;
    ui.autoSaved = (ui.autoSaved || []).concat(tx.id);
  }

  // Remembers where money for an app goes, so the next SMS from it is placed the same way.
  function learnSaving(tx, use, debtId, goalId) {
    const shop = Core.normalizeMerchant(tx.note);
    if (!shop || /^unspent on/.test(shop)) return;
    state.savingRules = state.savingRules || {};
    state.savingRules[shop] = { use, debtId: debtId || null, goalId: goalId || null };
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
      celebrate(tr('{amount} saved through {where} → {place}. Change it in Spend if needed.', { amount: inr(x.amount), where: x.note, place: savedWhere(x) }));
    } else {
      celebrate(tr('{amount} of savings added to your funds. Change any in Spend if needed.', { amount: inr(list.reduce((a, x) => a + x.amount, 0)) }));
    }
  }

  function smsNote(p) {
    if (p.type === 'cardemi') return tr('{months} EMIs, offered on the card to add', { months: p.months });
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

  /*
   * A loan whose EMI is billed on a credit card: picking the card makes it
   * leave on the card's due day and counts it once, not again in the card bill.
   */
  function loanViaCard(d) {
    const cards = state.cards || [];
    if (!cards.length || d.fromCard) return '';
    const id = 'via-' + d.id;
    const ask = !d.viaCard && Core.looksLikeCardBill(d.name);
    return '<div class="loan-via"><label class="field" for="' + id + '"><span>' + tr('Billed on a credit card?') + '</span><select id="' + id + '" data-via-card="' + esc(d.id) + '">' +
      '<option value="">' + tr('No, a bank EMI') + '</option>' +
      cards.map((c) => '<option value="' + esc(c.id) + '"' + (d.viaCard === c.id ? ' selected' : '') + '>' + esc(tr('Yes, on the {name} bill', { name: c.name })) + '</option>').join('') +
      '</select></label>' +
      (d.viaCard ? listField('debts', d, 'emisLeft', 'EMIs left (if you know)', 'number', ' max="120" placeholder="4"') +
        '<span class="hint">' + tr('You pay it from your account with the card bill. It comes off once a month on the card’s due date. It isn’t card spending, so it isn’t added again next month.') + '</span>' : '') +
      (ask ? '<span class="hint warn">' + tr('Does this EMI show on your credit card bill? Pick the card, so it’s counted once, not again inside the card bill.') + '</span>' : '') + '</div>';
  }

  /*
   * "Payments left" under a fixed payment or bill (an EMI kept here): the app
   * works out the last due date and stops counting it after that.
   */
  function endsField(list, item) {
    const isBill = list === 'bills';
    const t = today();
    const left = Core.paymentsLeft(item, isBill, t);
    const id = list + '-' + item.id + '-left';
    const ended = left === 0 || (isBill ? Core.billEnded(item, Core.cycleFor(t, Number(state.settings.payday) || 1)) : Core.fixedEnded(item, Core.cycleFor(t, Number(state.settings.payday) || 1)));
    const note = !item.lastDue ? tr('Blank if it doesn’t end')
      : ended ? tr('Ended {date}: not counted any more. Remove it with ✕.', { date: fmtDate(item.lastDue, true) })
      : tr('Last one {date}. Not counted after that.', { date: fmtDate(item.lastDue, true) });
    return '<div class="ends-row"><label class="field" for="' + id + '"><span>' + tr('Payments left') + '</span><input id="' + id + '" type="number" inputmode="numeric" min="0" max="360" step="1" placeholder="—"' +
      ' data-ends="' + list + '" data-id="' + esc(item.id) + '" value="' + (left ? left : '') + '"></label>' +
      '<span class="hint' + (ended ? ' good' : '') + '">' + note + '</span></div>';
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
        listField('fixed', f, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('fixed', f) + '</div>' + endsField('fixed', f)).join('') + '</div>' +
      '<div><button data-action="list-add" data-list="fixed">' + tr('Add fixed payment') + '</button></div></section>' },
        { key: 'bills', group: 'Your money', icon: 'bolt', label: 'Bills that vary', tone: 'mint', badge: (state.bills || []).length ? { text: String(state.bills.length) } : null, html: () =>
      '<section class="card"><div class="card-head">' + titled('Bills that vary', 'bills') + '<span class="hint">' + tr('Electricity, gas, water, recharges') + '</span></div>' +
      '<div class="edit-rows">' + (state.bills || []).map((b) =>
        '<div class="edit-row cols-bill">' + listField('bills', b, 'name', 'Name', 'text') + listField('bills', b, 'estimate', 'About (₹)', 'number') +
        '<label class="field" for="bills-' + esc(b.id) + '-every"><span>' + tr('Paid every') + '</span><select id="bills-' + esc(b.id) + '-every" data-list="bills" data-id="' + esc(b.id) + '" data-field="everyMonths">' + periodOptions(b.everyMonths) + '</select></label>' +
        listField('bills', b, 'nextDue', 'Next due', 'date') + removeButton('bills', b) + '</div>' + endsField('bills', b)).join('') + '</div>' +
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
        { key: 'categories', group: 'Your plan', icon: 'list', label: 'Categories', tone: 'amber', badge: null, html: () => categoriesPage() },
        { key: 'protect', group: 'Your plan', icon: 'shield', label: 'What matters most', tone: 'mint', badge: { text: tr('{n} of {max}', { n: Core.protectList(state).length, max: Core.PROTECT_MAX }) }, html: () => protectPage() },
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
    // A refund to a card stays on the card.
    const card = x && x.paidFrom ? (state.cards || []).find((c) => c.id === x.paidFrom) : null;
    return '<option value="account"' + (!cur && !card ? ' selected' : '') + '>' + esc(mainWalletName()) + '</option>' +
      (state.wallets || []).map((w) => '<option value="w:' + esc(w.id) + '"' + (cur === w.id ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') +
      (x && Core.isIncome(x) ? (state.cards || []).map((c) => '<option value="' + esc(c.id) + '"' + (card === c ? ' selected' : '') + '>' + esc(tr('Refund to {card}', { card: cardLabel(c) })) + '</option>').join('') : '');
  }

  // Applies a "paid from" or "into" choice to a payment.
  function setFrom(x, v) {
    // Cash on a credit card: its wallet is where the cash went, so it stays while the card does.
    const into = x.cashAdvance ? x.wallet : null;
    delete x.paidFrom;
    delete x.wallet;
    if (!v || v === 'account' || v.indexOf('w:') === 0) delete x.cashAdvance;
    if (!v || v === 'account') return;
    if (v.indexOf('w:') === 0) x.wallet = v.slice(2);
    else { x.paidFrom = v; if (into) x.wallet = into; }
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
    const moved = { id: uid(), kind: 'transfer', date, amount, from: id(from), to: id(to), note: tr('Moved money'), source: 'manual' };
    state.transactions.push(moved);
    const linked = joinBankSms(moved, true);
    ui.moveForm = null;
    save();
    rerenderKeepScroll();
    offerUndo(tr('{amount} moved', { amount: inr(amount) }) + (linked ? ' ' + linked : ''), before);
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
    return Core.isBillPayment(x) || Core.isCardTransfer(x) || !!x.eventId;
  }

  // From a bank SMS that wasn't really a payment: an OTP, a request, a failed payment, an offer.
  // Refunds taken off this purchase, each with a way back (it wasn't a refund for this).
  function refundsBox(x) {
    if (!(x.refunds || []).length) return '';
    return '<div class="callout"><b>' + tr('Refunded') + '</b>' + x.refunds.map((r, i) =>
      '<div class="row"><span>' + tr('{amount} on {date}', { amount: inr(r.amount), date: fmtDate(r.date) }) + '</span>' +
      '<button class="ghost small" data-action="refund-undo" data-id="' + esc(x.id) + '" data-i="' + i + '">' + tr('Not for this purchase') + '</button></div>').join('') +
      '<span class="hint">' + tr('A refund to the card makes the purchase smaller, so it isn’t counted as income.') + '</span></div>';
  }

  // ---------- fixed payments, recorded as paid ----------

  // In "Coming up": paid already (early, or a different amount)? Record it.
  function fixedPayForm(e) {
    const t = today();
    if (ui.fixedPay !== e.fixedId) return '<button class="link" data-action="fixed-pay-open" data-id="' + esc(e.fixedId) + '">' + tr('Mark paid') + '</button>';
    return '<div class="form-grid"><label class="field" for="fp-amount"><span>' + tr('Paid (₹)') + '</span><input id="fp-amount" type="number" inputmode="numeric" min="1" max="1000000000" step="any" value="' + e.amount + '"></label>' +
      '<label class="field" for="fp-date"><span>' + tr('Date') + '</span><input id="fp-date" type="date" max="' + t + '" value="' + (e.payDate || t) + '"></label></div>' +
      '<div class="row"><button class="primary" data-action="fixed-pay-save" data-id="' + esc(e.fixedId) + '">' + tr('Save') + '</button><button class="ghost" data-action="fixed-pay-cancel">' + tr('Cancel') + '</button></div>';
  }

  /*
   * A fixed payment or EMI past its due date with nothing recorded: it's
   * still in the account and counted as still to pay. Paid? Yes records it on
   * the due date; another day or amount opens the form; Not yet asks again tomorrow.
   */
  function dueAskCard() {
    const t = today();
    const asked = state.dueAsked || {};
    // A payment that looks like it is already in (the bank SMS): asked about that one instead (fixedMatchCard), never both.
    const waiting = Core.fixedMatches(state, t).map((m) => m.fixed.id + ':' + m.due);
    const due = Core.projectRunway(state, t).dueNow
      .filter((e) => (e.kind === 'fixed' || e.kind === 'debt') && e.date < t && asked[(e.fixedId || e.debtId) + ':' + e.date] !== t && waiting.indexOf((e.fixedId || e.debtId) + ':' + e.date) === -1);
    if (!due.length) return '';
    const e = due[0];
    const id = e.fixedId || e.debtId;
    return '<section class="card income-card due-ask"><div class="card-head"><h2>' + tr('{name} {amount} was due {date}. Paid?', { name: esc(e.name), amount: inr(e.amount), date: fmtDate(e.date) }) + '</h2></div>' +
      '<p class="hint">' + tr('Nothing is recorded yet, so it’s still in your balance and counted as still to pay.') +
      (due.length > 1 ? ' ' + tr('{n} more due and not recorded yet.', { n: due.length - 1 }) : '') + '</p>' +
      (ui.fixedPay === id ? fixedPayForm(Object.assign({}, e, { fixedId: id, payDate: e.date })) :
        '<div class="row"><button class="primary" data-action="due-paid" data-id="' + esc(id) + '" data-date="' + e.date + '" data-amount="' + e.amount + '">' + tr('Yes, on {date}', { date: fmtDate(e.date) }) + '</button>' +
        '<button data-action="fixed-pay-open" data-id="' + esc(id) + '">' + tr('Another day or amount') + '</button>' +
        '<button class="ghost" data-action="due-later" data-key="' + esc(id + ':' + e.date) + '">' + tr('Not yet') + '</button></div>') + '</section>';
  }

  // Marked paid by hand while the bank's entry is also there: counted twice. Keep one.
  function fixedTwinCard() {
    const tw = Core.fixedTwins(state, today())[0];
    if (!tw) return '';
    return '<section class="card income-card twin-card"><div class="card-head"><h2>' + tr('{name} counted twice?', { name: esc(tw.name) }) + '</h2></div>' +
      '<p class="hint">' + tr('{amount} on {date} ({note}) and {paid} marked as {name} paid. If it’s one payment, the bank’s entry is kept and the other goes.',
        { amount: inr(tw.extra.amount), date: fmtDate(tw.extra.date), note: esc(tw.extra.note || label(tw.extra.category)), paid: inr(tw.paid.amount), name: esc(tw.name) }) + '</p>' +
      '<div class="row"><button class="primary" data-action="twin-merge" data-paid="' + esc(tw.paid.id) + '" data-extra="' + esc(tw.extra.id) + '">' + tr('Same payment: keep one') + '</button>' +
      '<button data-action="twin-no" data-extra="' + esc(tw.extra.id) + '">' + tr('I paid twice') + '</button></div></section>';
  }

  // A payment with a fixed payment's amount near its due date: is it that one?
  function fixedMatchCard() {
    const m = Core.fixedMatches(state, today())[0];
    if (!m) return '';
    return '<section class="card income-card"><div class="card-head"><h2>' + tr(m.loan ? 'Is {amount} on {date} your “{name}” EMI?' : 'Is {amount} on {date} your “{name}” payment?', { amount: inr(m.tx.amount), date: fmtDate(m.tx.date), name: esc(m.fixed.name) }) + '</h2></div>' +
      '<p class="hint">' + tr('It’s due {date}. If this is it, it counts once: now, not again on the due date.', { date: fmtDate(m.due) }) + '</p>' +
      '<div class="row"><button class="primary" data-action="fixed-link" data-tx="' + esc(m.tx.id) + '" data-id="' + esc(m.fixed.id) + '">' + tr('Yes, it is') + '</button>' +
      '<button data-action="fixed-not" data-tx="' + esc(m.tx.id) + '">' + tr('No') + '</button></div></section>';
  }

  // Money in that looks like a refund or reversal of a payment this round: offset it?
  function refundMatchCard() {
    const m = Core.refundMatches(state, today())[0];
    if (!m) return '';
    return '<section class="card income-card"><div class="card-head"><h2>' + tr('Is {amount} from {shop} a refund of your {paid} payment on {date}?',
      { amount: inr(m.refund.amount), shop: esc(m.refund.note || tr('the bank')), paid: inr(m.buy.amount), date: fmtDate(m.buy.date) }) + '</h2></div>' +
      '<p class="hint">' + tr('If it is, it isn’t income: that payment counts {left} as spending instead.', { left: inr(m.buy.amount - (Number(m.buy.refunded) || 0) - m.refund.amount) }) + '</p>' +
      '<div class="row"><button class="primary" data-action="refund-link" data-id="' + esc(m.refund.id) + '" data-buy="' + esc(m.buy.id) + '">' + tr('Yes, it is') + '</button>' +
      '<button data-action="refund-not" data-id="' + esc(m.refund.id) + '">' + tr('No') + '</button></div></section>';
  }

  // In the edit view: a refund that offsets a payment, a payment with refunds, cash on a credit card.
  function refundTxBox(x) {
    if (x.refundOf) {
      const buy = state.transactions.find((y) => y.id === x.refundOf);
      return '<div class="callout"><b>' + tr('Refund of {shop}, {date}', { shop: esc(buy ? buy.note || label(buy.category) : tr('removed')), date: buy ? fmtDate(buy.date) : '' }) + '</b><span class="hint">' +
        tr('Not income: that payment’s spending is lower by {amount}.', { amount: inr(x.amount) }) + '</span>' +
        '<div><button class="ghost small" data-action="refund-unlink" data-id="' + esc(x.id) + '">' + tr('Not a refund of it') + '</button></div></div>';
    }
    if (x.refunded) return '<div class="callout"><b>' + tr('{amount} refunded', { amount: inr(x.refunded) }) + '</b><span class="hint">' + tr('It counts {left} as spending.', { left: inr(Core.ownPart(x)) }) + '</span></div>';
    if (x.cashAdvance) {
      return '<div class="callout warn"><b>' + tr('Cash on a credit card is a loan') + '</b><span class="hint">' +
        tr('Banks usually charge interest from the day you take it, plus a fee, and no interest-free days. Pay it back first. It counts as spending when you spend the cash.') + '</span></div>';
    }
    return '';
  }

  // In a payment's edit view: mark it as a fixed payment, or see which one it paid.
  function fixedTxBox(x) {
    if (x.emiFor) {
      const d = (state.debts || []).find((y) => y.id === x.emiFor);
      return '<div class="callout"><b>' + tr('EMI: {name}', { name: esc(d ? d.name : tr('removed')) }) + '</b><span class="hint">' +
        tr('For the one due {date}. It isn’t counted again that day.', { date: fmtDate(x.forDue) }) + ' ' +
        tr('{interest} interest, {principal} paid off the loan.', { interest: inr(x.emiInterest || 0), principal: inr(x.emiPrincipal || 0) }) + '</span>' +
        '<div><button class="ghost small" data-action="fixed-unpay" data-tx="' + esc(x.id) + '">' + tr(x.fixedNew ? 'Remove this payment' : 'Not an EMI') + '</button></div></div>';
    }
    if (x.fixedId) {
      const f = (state.fixed || []).find((y) => y.id === x.fixedId);
      return '<div class="callout"><b>' + tr('Fixed payment: {name}', { name: esc(f ? f.name : tr('removed')) }) + '</b><span class="hint">' +
        tr('For the one due {date}. It isn’t counted again that day.', { date: fmtDate(x.forDue) }) + '</span>' +
        '<div><button class="ghost small" data-action="fixed-unpay" data-tx="' + esc(x.id) + '">' + tr(x.fixedNew ? 'Remove this payment' : 'Not a fixed payment') + '</button></div></div>';
    }
    const loans = Core.emiLoans(state);
    if (!Core.isFlexible(x) || (x.paidFrom && x.paidFrom !== 'account') || x.claimId || x.maybeId || x.covered || x.iouId || x.refunded || !((state.fixed || []).length + loans.length)) return '';
    const near = (amt) => Math.abs(amt - x.amount) <= amt * 0.02;
    return '<div class="callout"><b>' + tr('Was this a fixed payment or an EMI?') + '</b>' +
      '<div class="row"><select id="fx-which" aria-label="' + tr('Fixed payment') + '">' + state.fixed.map((f) => '<option value="' + esc(f.id) + '"' + (near(Number(f.amount) || 0) ? ' selected' : '') + '>' +
        esc(f.name || tr('Unnamed')) + ' · ' + inr(Number(f.amount) || 0) + '</option>').join('') +
        loans.map((d) => '<option value="' + esc(d.id) + '"' + (near(Number(d.minPayment)) ? ' selected' : '') + '>' + esc(tr('{name} EMI', { name: d.name })) + ' · ' + inr(Number(d.minPayment)) + '</option>').join('') + '</select>' +
      '<button class="ghost small" data-action="fixed-link" data-tx="' + esc(x.id) + '">' + tr('Yes, mark it') + '</button></div></div>';
  }

  // ---------- maybe expenses ----------

  const MAYBE_LABEL = { likely: 'Likely', maybe: 'Maybe', unlikely: 'Unlikely' };
  // What a cost does now: held, shown as "if it comes", or only listed.
  function maybeNote(m, cyc) {
    if (m.date >= cyc.next) return tr('Next round');
    return tr(m.likely === 'likely' ? 'Held from today’s limit' : m.likely === 'maybe' ? 'Not held: see “if it comes”' : 'Only listed');
  }

  // Did it come? A payment that may be the one, or add it now; or it didn't.
  function maybeAnswer(m) {
    const t = today();
    if (ui.maybeAnswer !== m.id) {
      return '<div class="row"><button class="primary" data-action="maybe-yes" data-id="' + esc(m.id) + '">' + tr('Yes, it came') + '</button>' +
        '<button data-action="maybe-no" data-id="' + esc(m.id) + '">' + tr('No, it didn’t') + '</button>' +
        '<button class="ghost" data-action="maybe-later" data-id="' + esc(m.id) + '">' + tr('Not yet') + '</button></div>';
    }
    const cand = Core.maybeCandidates(state, m.id, t);
    return '<div class="callout">' + (cand.length
      ? '<b>' + tr('Which payment was it?') + '</b>' + cand.map((x, i) => '<label class="check-row"><input type="radio" name="mb-tx" value="' + esc(x.id) + '"' + (i === 0 ? ' checked' : '') + '> ' +
          esc(x.note || label(x.category)) + ' · ' + fmtDate(x.date) + ' · ' + inr(x.amount) + '</label>').join('') +
        '<div class="row"><button class="primary" data-action="maybe-link" data-id="' + esc(m.id) + '">' + tr('Link it') + '</button></div>' +
        '<span class="hint">' + tr('Not in the list? Add it as a payment:') + '</span>'
      : '<b>' + tr('Add it as a payment') + '</b>') +
      '<div class="form-grid"><label class="field" for="mb-paid"><span>' + tr('Paid (₹)') + '</span><input id="mb-paid" type="number" inputmode="numeric" min="1" max="1000000000" step="any" value="' + m.amount + '"></label>' +
      '<label class="field" for="mb-paid-date"><span>' + tr('Date') + '</span><input id="mb-paid-date" type="date" max="' + t + '" value="' + (m.date <= t ? m.date : t) + '"></label></div>' +
      '<div class="row"><button' + (cand.length ? '' : ' class="primary"') + ' data-action="maybe-new" data-id="' + esc(m.id) + '">' + tr('Add payment') + '</button>' +
      '<button class="ghost" data-action="maybe-cancel">' + tr('Cancel') + '</button></div></div>';
  }

  // Home: a cost whose date has passed. Did it come?
  function maybeDueCard() {
    const t = today();
    const due = Core.maybeDue(state, t).filter((m) => (state.maybeAsked || {})[m.id] !== t || ui.maybeAnswer === m.id);
    if (!due.length) return '';
    const m = due[0];
    return '<section class="card income-card"><div class="card-head"><h2>' + tr('Did “{name}” come? ({amount}, around {date})', { name: esc(m.name), amount: inr(m.amount), date: fmtDate(m.date) }) + '</h2></div>' +
      maybeAnswer(m) + '</section>';
  }

  // Home → Maybe expenses: what's held, what today's limit would be if the maybe ones come, and the list.
  // Plan → Categories: each category's subcategories; add your own, hide the ones you don't use.
  function categoriesPage() {
    const sc = state.subcats || {};
    const cats = categories().filter((c) => ['Emergency', 'Cash', 'Savings'].indexOf(c) === -1);
    return '<section class="card cats-card"><div class="card-head">' + titled('Categories', 'cats') + '</div>' +
      '<p class="hint">' + tr('A second level for detail in your reports: Bills → Electricity, Food & dining → Food delivery. Budgets stay on the category.') + '</p>' +
      cats.map((c, i) => {
        const subs = Core.subcategories(state, c);
        const hidden = ((sc.hide || {})[c] || []).filter((n) => (Core.SUBCATS[c] || []).indexOf(n) !== -1);
        return '<div class="cat-block"><h3>' + esc(label(c)) + '</h3><div class="chips">' +
          (subs.length ? subs.map((s) => '<span class="chip">' + esc(tr(s)) + ' <button class="link small" data-action="sub-hide" data-cat="' + esc(c) + '" data-sub="' + esc(s) + '" aria-label="' + esc(tr('Remove {name}', { name: tr(s) })) + '">✕</button></span>').join(' ')
            : '<span class="hint">' + tr('No subcategories') + '</span>') + '</div>' +
          (hidden.length ? '<p class="hint">' + tr('Hidden:') + ' ' + hidden.map((s) => '<button class="link small" data-action="sub-unhide" data-cat="' + esc(c) + '" data-sub="' + esc(s) + '">' + esc(tr(s)) + ' ↺</button>').join(' ') + '</p>' : '') +
          '<div class="row"><input type="text" id="sub-new-' + i + '" maxlength="30" placeholder="' + esc(tr('Add one, like Gym or Maid')) + '" aria-label="' + esc(tr('New subcategory under {name}', { name: label(c) })) + '">' +
          '<button class="ghost small" data-action="sub-add" data-cat="' + esc(c) + '" data-i="' + i + '">' + tr('Add') + '</button></div></div>';
      }).join('') + '</section>';
  }

  // Old payments whose shop tells the subcategory: suggested, never changed without a yes.
  function subSuggestCard() {
    if (state.subAskOff) return '';
    const list = Core.subSuggestions(state);
    if (!list.length) return '';
    const row = (x) => '<div class="list-item"><div class="grow"><div class="title">' + esc(x.tx.note || label(x.tx.category)) + ' · ' + inr(x.tx.amount) + '</div>' +
      '<div class="meta">' + fmtDate(x.tx.date) + ' · ' + esc(label(x.tx.category)) + ' → <b>' + esc(tr(x.sub)) + '</b></div></div>' +
      '<button class="ghost small" data-action="sub-yes" data-id="' + esc(x.tx.id) + '" data-sub="' + esc(x.sub) + '">' + tr('Yes') + '</button>' +
      '<button class="ghost small" data-action="sub-no" data-id="' + esc(x.tx.id) + '">' + tr('No') + '</button></div>';
    return '<section class="card income-card sub-suggest"><div class="card-head"><h2>' + tr(list.length === 1 ? 'Add detail to 1 payment?' : 'Add detail to {n} payments?', { n: list.length }) + '</h2></div>' +
      '<p class="hint">' + tr('From the shop name. Nothing changes until you say yes.') + '</p><div class="list">' + list.slice(0, 3).map(row).join('') + '</div>' +
      '<div class="row">' + (list.length > 1 ? '<button class="primary" data-action="sub-all">' + tr('Yes to all {n}', { n: list.length }) + '</button>' : '') +
      '<button class="ghost" data-action="sub-off">' + tr('Stop asking') + '</button></div></section>';
  }

  // ---------- trips and events ----------

  const dateSpan = (a, b) => (a === b ? fmtDate(a) : fmtDate(a) + ' – ' + fmtDate(b));
  const whoName = (n) => (n === 'me' ? tr('You') : n);

  // Spend → Trips & events: the list, or one event.
  function eventsPage() {
    const ev = ui.evOpen && (state.events || []).find((e) => e.id === ui.evOpen);
    if (ev) return eventPage(ev);
    const t = today();
    const list = (state.events || []).slice().sort((a, b) => (a.from < b.from ? 1 : -1));
    const form = ui.evForm
      ? '<div class="callout ev-form"><b>' + tr('A new trip or event') + '</b><div class="form-grid">' +
        '<label class="field wide" for="ev-name"><span>' + tr('Name') + '</span><input id="ev-name" type="text" maxlength="60" placeholder="' + tr('Goa trip') + '"></label>' +
        '<label class="field" for="ev-from"><span>' + tr('From') + '</span><input id="ev-from" type="date" value="' + t + '"></label>' +
        '<label class="field" for="ev-to"><span>' + tr('To') + '</span><input id="ev-to" type="date" value="' + t + '"></label>' +
        '<label class="field wide" for="ev-people"><span>' + tr('People, apart from you (commas between names)') + '</span><input id="ev-people" type="text" maxlength="400" placeholder="' + tr('Amit, Rahul, Sneha') + '"></label>' +
        '<label class="field wide" for="ev-budget"><span>' + tr('Your budget for it (₹, optional)') + '</span><input id="ev-budget" type="number" inputmode="numeric" min="0" max="1000000000" step="any"></label></div>' +
        '<p class="hint">' + tr('A budget is set aside from today’s limit until the event ends, and your shares are paid from it, so the trip doesn’t eat your daily money.') + '</p>' +
        (ui.evError ? '<p class="bad" role="alert">' + esc(ui.evError) + '</p>' : '') +
        '<div class="row"><button class="primary" data-action="ev-create">' + tr('Create') + '</button><button class="ghost" data-action="ev-form-cancel">' + tr('Cancel') + '</button></div></div>'
      : '<div><button class="primary" data-action="ev-form">' + tr('New trip or event') + '</button></div>';
    return '<section class="card events-card"><div class="card-head">' + titled('Trips & events', 'events') + '</div>' +
      '<p class="hint">' + tr('Add the people once, then every payment with who paid and each share. Only you and each person are tracked: what you owe them, and what they owe you.') + '</p>' + form +
      (list.length ? '<div class="list">' + list.map((e) => {
        const v = Core.eventView(state, e.id);
        const status = v.settled ? '<span class="good">' + tr('Settled ✓') + '</span>'
          : [v.owedToYou ? '<span class="good">' + tr('Owed to you {amount}', { amount: inr(v.owedToYou) }) + '</span>' : '', v.youOwe ? '<span class="bad">' + tr('You owe {amount}', { amount: inr(v.youOwe) }) + '</span>' : ''].filter(Boolean).join(' · ');
        return '<button class="list-item ev-row" data-action="ev-open" data-id="' + esc(e.id) + '"><div class="grow"><div class="title">' + esc(e.name) + '</div>' +
          '<div class="meta">' + dateSpan(e.from, e.to) + ' · ' + tr('{n} people', { n: e.people.length + 1 }) + (v.items.length ? ' · ' + status : '') + '</div></div>' +
          '<div class="amt">' + inr(v.myShare) + '</div></button>';
      }).join('') + '</div>' : '<p class="hint">' + tr('No trips or events yet.') + '</p>') + '</section>';
  }

  function eventPage(ev) {
    const t = today();
    const v = Core.eventView(state, ev.id);
    const line = (name, val) => '<div class="line"><span>' + name + '</span><span>' + val + '</span></div>';
    let html = '<section class="card event-card"><div class="card-head"><button class="link" data-action="ev-close">← ' + tr('All trips & events') + '</button></div>' +
      '<h2>' + esc(ev.name) + '</h2><p class="hint">' + dateSpan(ev.from, ev.to) + ' · ' + tr('You') + ', ' + ev.people.map(esc).join(', ') + '</p>';
    if (ui.evEdit) {
      html += '<div class="callout"><div class="form-grid">' +
        '<label class="field wide" for="ee-name"><span>' + tr('Name') + '</span><input id="ee-name" type="text" maxlength="60" value="' + esc(ev.name) + '"></label>' +
        '<label class="field" for="ee-from"><span>' + tr('From') + '</span><input id="ee-from" type="date" value="' + ev.from + '"></label>' +
        '<label class="field" for="ee-to"><span>' + tr('To') + '</span><input id="ee-to" type="date" value="' + ev.to + '"></label>' +
        '<label class="field wide" for="ee-people"><span>' + tr('People, apart from you (commas between names)') + '</span><input id="ee-people" type="text" maxlength="400" value="' + esc(ev.people.join(', ')) + '"></label>' +
        '<label class="field wide" for="ee-budget"><span>' + tr('Your budget for it (₹, optional)') + '</span><input id="ee-budget" type="number" inputmode="numeric" min="0" max="1000000000" step="any" value="' + (ev.budget || '') + '"></label></div>' +
        '<div class="row"><button class="primary" data-action="ev-edit-save">' + tr('Save') + '</button><button class="ghost" data-action="ev-edit-cancel">' + tr('Cancel') + '</button></div></div>';
    }
    html += '<div class="summary">' + line(tr('Spent together'), inr(v.total)) + line(tr('You paid'), inr(v.iPaid)) + line('<b>' + tr('Your share') + '</b>', '<b>' + inr(v.myShare) + '</b>') +
      (v.budget ? line(tr('From your trip budget ({amount})', { amount: inr(v.budget) }), inr(v.fromBudget) + (v.overBudget ? ' · <span class="bad">' + tr('{amount} over', { amount: inr(v.overBudget) }) + '</span>' : '')) : '') + '</div>';
    // Settle up: one line per person.
    if (v.items.length) {
      html += '<h3>' + tr('Settle up') + '</h3><div class="list">' + v.balances.map((b) => {
        const both = b.theyOwe > 0 && b.youOwe > 0;
        let row = '<div class="list-item"><div class="grow"><div class="title">' + esc(b.name) + '</div><div class="meta">' +
          (b.net > 0 ? '<span class="good">' + tr('Owes you {amount}', { amount: inr(b.net) }) + '</span>' : b.net < 0 ? '<span class="bad">' + tr('You owe {amount}', { amount: inr(-b.net) }) + '</span>' : (b.settled || both ? tr('Even') : tr('Nothing between you'))) +
          (both ? ' · ' + tr('{a} and {b} cancel out', { a: inr(b.theyOwe), b: inr(b.youOwe) }) : '') + '</div></div>';
        if (b.net !== 0 || both) {
          row += b.net === 0 ? '<button class="ghost small" data-action="ev-net" data-name="' + esc(b.name) + '">' + tr('Mark even') + '</button>'
            : '<button class="ghost small" data-action="ev-settle-open" data-name="' + esc(b.name) + '">' + tr(b.net > 0 ? 'Got it' : 'I paid') + '</button>' +
              (b.net > 0 ? '<button class="ghost small" data-action="ev-remind" data-name="' + esc(b.name) + '">' + tr('Remind') + '</button>' : '');
        }
        row += '</div>';
        if (ui.evSettle === b.name && b.net !== 0) row += settleForm(ev, b);
        return row;
      }).join('') + '</div>';
    }
    html += ui.evAdd ? eventAddForm(ev) : '<div><button class="primary" data-action="ev-add-open">' + tr('Add a payment') + '</button></div>';
    if (v.items.length) {
      html += '<h3>' + tr('Payments') + '</h3><div class="list">' + v.items.slice().reverse().map((it) => {
        const shares = Object.keys(it.shares).map((k) => whoName(k) + ' ' + inr(it.shares[k])).join(', ');
        return '<div class="list-item"><div class="grow"><div class="title">' + esc(it.place || it.note || label(it.category)) + '</div>' +
          '<div class="meta">' + fmtDate(it.date) + ' · ' + tr('paid by {who}', { who: esc(whoName(it.paidBy)) }) + ' · ' + esc(shares) + '</div></div>' +
          '<div class="amt">' + inr(it.total) + '</div><button class="ghost small" data-action="ev-item-remove" data-id="' + esc(it.id) + '" aria-label="' + esc(tr('Remove {name}', { name: it.place || it.note || '' })) + '">✕</button></div>';
      }).join('') + '</div>';
    }
    if (ui.evDelete) {
      const open = v.balances.filter((b) => b.theyOwe || b.youOwe);
      html += '<div class="callout warn"><b>' + tr('Delete “{name}”?', { name: esc(ev.name) }) + '</b><span class="hint">' +
        tr('The payments stay in your list as they are: the money really moved.') + ' ' +
        (open.length ? tr('Still open, kept under People: {list}.', { list: open.map((b) => esc(b.name) + ' ' + (b.net >= 0 ? '+' : '−') + inr(Math.abs(b.net))).join(', ') }) : '') + '</span>' +
        '<div class="row"><button class="primary" data-action="ev-delete">' + tr('Delete') + '</button><button class="ghost" data-action="ev-delete-cancel">' + tr('Cancel') + '</button></div></div>';
    } else if (!ui.evEdit) {
      html += '<div class="row"><button class="ghost small" data-action="ev-edit">' + tr('Edit') + '</button><button class="ghost small" data-action="ev-delete-ask">' + tr('Delete event') + '</button></div>';
    }
    return html + '</section>';
  }

  // Add a payment: who paid, and each share, equal, by amounts or by shares. It always adds up to the rupee.
  function eventAddForm(ev) {
    const a = ui.evAdd;
    const t = today();
    const names = ['me'].concat(ev.people);
    const payer = a.paidBy || 'me';
    return '<div class="callout ea-form"><b>' + tr(a.txId ? 'Split this payment' : 'A payment in {name}', { name: esc(ev.name) }) + '</b><div class="form-grid">' +
      '<label class="field" for="ea-total"><span>' + tr('Amount (₹)') + '</span><input id="ea-total" type="number" inputmode="numeric" min="1" max="1000000000" step="any" value="' + (a.total || '') + '"' + (a.txId ? ' readonly' : '') + '></label>' +
      '<label class="field" for="ea-date"><span>' + tr('Date') + '</span><input id="ea-date" type="date" max="' + t + '" value="' + (a.date || t) + '"' + (a.txId ? ' readonly' : '') + '></label>' +
      '<label class="field wide" for="ea-place"><span>' + tr('Place') + '</span><input id="ea-place" type="text" maxlength="60" placeholder="' + tr('Where it was paid') + '" value="' + esc(a.place || '') + '"></label>' +
      '<label class="field" for="ea-cat"><span>' + tr('Category') + '</span><select id="ea-cat">' + categoryOptions(a.category || 'Travel') + '</select></label>' +
      '<label class="field" for="ea-paidby"><span>' + tr('Paid by') + '</span><select id="ea-paidby"' + (a.txId ? ' disabled' : '') + '>' + names.map((n) => '<option value="' + esc(n) + '"' + (n === payer ? ' selected' : '') + '>' + esc(whoName(n)) + '</option>').join('') + '</select></label>' +
      '<label class="field wide" for="ea-mode"><span>' + tr('Split') + '</span><select id="ea-mode">' +
        [['equal', 'Equally, between those ticked'], ['amounts', 'By amounts (₹ each)'], ['shares', 'By shares (like 2, 1, 1)']].map((m) => '<option value="' + m[0] + '"' + (m[0] === (a.mode || 'equal') ? ' selected' : '') + '>' + tr(m[1]) + '</option>').join('') + '</select></label></div>' +
      '<div class="ea-people">' + names.map((n, i) => '<div class="row ea-person"><label class="check"><input type="checkbox" id="ea-in-' + i + '" data-ea-name="' + esc(n) + '" checked> ' + esc(whoName(n)) + '</label>' +
        '<input type="number" inputmode="numeric" min="0" max="1000000000" step="any" id="ea-val-' + i + '" aria-label="' + esc(tr('{name}’s part', { name: whoName(n) })) + '" placeholder="' + tr('amount or share') + '"></div>').join('') + '</div>' +
      '<p class="hint ea-preview" aria-live="polite"></p>' +
      (ui.evError ? '<p class="bad" role="alert">' + esc(ui.evError) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="ev-add">' + tr('Save') + '</button><button class="ghost" data-action="ev-add-cancel">' + tr('Cancel') + '</button></div></div>';
  }

  // The add form as it stands, and the shares it makes (null when they don't add up).
  function eventFormShares(ev) {
    const val = (id) => (document.getElementById(id) || {}).value;
    const total = Math.round(Number(val('ea-total')) || 0);
    const mode = val('ea-mode') || 'equal';
    const paidBy = ui.evAdd && ui.evAdd.txId ? 'me' : val('ea-paidby') || 'me';
    const names = [];
    const values = {};
    ['me'].concat(ev.people).forEach((n, i) => {
      const box = document.getElementById('ea-in-' + i);
      const v = Number(val('ea-val-' + i)) || 0;
      if (mode === 'equal' ? box && box.checked : v > 0) { names.push(n); values[n] = v; }
    });
    const shares = names.length ? Core.splitShares(total, names, mode, values, paidBy) : null;
    return { total, mode, paidBy, shares, names };
  }
  function eventPreview() {
    const ev = ui.evOpen && (state.events || []).find((e) => e.id === ui.evOpen);
    const el = document.querySelector('.ea-preview');
    if (!ev || !el) return;
    const f = eventFormShares(ev);
    if (!f.total) { el.textContent = ''; return; }
    if (!f.shares) {
      const sumIn = f.mode === 'amounts' ? f.names.reduce((s, n, i) => s + (Number((document.getElementById('ea-val-' + (['me'].concat(ev.people).indexOf(n))) || {}).value) || 0), 0) : 0;
      el.className = 'hint ea-preview bad';
      el.textContent = f.mode === 'amounts' && sumIn ? (sumIn < f.total ? tr('{amount} still to share out', { amount: inr(f.total - sumIn) }) : tr('{amount} too much', { amount: inr(sumIn - f.total) })) : tr('Tick who’s in, or fill in the parts.');
      return;
    }
    el.className = 'hint ea-preview good';
    el.textContent = Object.keys(f.shares).filter((k) => f.shares[k]).map((k) => whoName(k) + ' ' + inr(f.shares[k])).join(' · ') + ' = ' + inr(f.total) + ' ✓';
  }

  function settleForm(ev, b) {
    const t = today();
    const cands = Core.settleCandidates(state, ev.id, b.name);
    return '<div class="callout"><div class="form-grid">' +
      '<label class="field" for="es-amount"><span>' + tr('Amount (₹)') + '</span><input id="es-amount" type="number" inputmode="numeric" min="1" max="' + Math.abs(b.net) + '" step="any" value="' + Math.abs(b.net) + '"></label>' +
      '<label class="field" for="es-date"><span>' + tr('Date') + '</span><input id="es-date" type="date" max="' + t + '" value="' + t + '"></label></div>' +
      (cands.length ? '<p class="hint">' + tr(b.net > 0 ? 'Is it one of these money-in entries?' : 'Is it one of these payments?') + '</p>' + cands.map((c, i) =>
        '<label class="check"><input type="radio" name="es-tx" value="' + esc(c.id) + '"' + (i === 0 ? ' checked' : '') + '> ' + inr(c.amount) + ' · ' + fmtDate(c.date) + ' · ' + esc(c.note || '') + '</label>').join('') +
        '<label class="check"><input type="radio" name="es-tx" value=""> ' + tr('None of these: add it') + '</label>' : '') +
      (b.theyOwe && b.youOwe ? '<p class="hint">' + tr('{a} and {b} cancel out first.', { a: inr(b.theyOwe), b: inr(b.youOwe) }) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="ev-settle" data-name="' + esc(b.name) + '">' + tr('Save') + '</button><button class="ghost" data-action="ev-settle-cancel">' + tr('Cancel') + '</button></div></div>';
  }

  // A reminder the person sends themselves (WhatsApp, SMS…): each payment with date, place and share.
  function eventReminderText(ev, name) {
    const st = Core.eventStatement(state, ev.id, name);
    const lines = st.lines.map((l) => '• ' + fmtDate(l.date) + (l.place ? ', ' + l.place : '') + ': ' +
      (l.dir === 'theyOwe' ? tr('your share {amount} of {total}', { amount: inr(l.amount), total: inr(l.total) }) : tr('you paid my share {amount}', { amount: inr(l.amount) })));
    return tr('Hi {name}, for {event} ({dates}):', { name: st.name, event: ev.name, dates: dateSpan(ev.from, ev.to) }) + '\n' + lines.join('\n') + '\n' +
      tr('So it comes to {amount}. Please send it when you can. Thanks!', { amount: inr(st.net) });
  }
  function shareMessage(text) {
    if (ShareFile && ShareFile.shareText) return ShareFile.shareText({ text, title: tr('Send the reminder') }).catch(() => toast(tr('Couldn’t open sharing.')));
    if (navigator.share) return navigator.share({ text }).catch(() => {});
    if (navigator.clipboard) return navigator.clipboard.writeText(text).then(() => toast(tr('Reminder copied. Paste it in a message.')), () => toast(text));
    toast(text);
    return null;
  }

  // In a payment's edit view: part of an event, or split it with friends.
  function eventTxBox(x) {
    if (x.eventId) {
      const ev = (state.events || []).find((e) => e.id === x.eventId);
      return '<div class="callout"><b>' + tr('In {name}', { name: esc(ev ? ev.name : '') }) + '</b><span class="hint">' +
        (x.lentShare ? tr('Your share {mine}; {others} is others’ and not your spending.', { mine: inr(x.amount - x.lentShare), others: inr(x.lentShare) }) : x.paidBy ? tr('{who} paid; this is your share.', { who: esc(x.paidBy) }) : '') +
        '</span><div><button class="ghost small" data-action="ev-goto" data-id="' + esc(x.eventId) + '">' + tr('Open the event') + '</button></div></div>';
    }
    if (!Core.isFlexible(x) || x.iouId || x.splitOf || x.maybeId || x.claimId || x.covered || x.refunded) return '';
    const evs = (state.events || []).filter((e) => e.to >= Core.addDays(x.date, -30)).sort((a, b) => (a.from < b.from ? 1 : -1));
    return '<div class="callout"><b>' + tr('Shared with friends or family?') + '</b><span class="hint">' + tr('Split it in a trip or event: only your share counts as your spending, and each person owes you theirs.') + '</span>' +
      '<div class="row">' + evs.slice(0, 3).map((e) => '<button class="ghost small" data-action="ev-split-tx" data-id="' + esc(e.id) + '" data-tx="' + esc(x.id) + '">' + esc(e.name) + '</button>').join('') +
      '<button class="ghost small" data-action="ev-new-from-tx" data-tx="' + esc(x.id) + '">' + tr('New trip or event') + '</button></div></div>';
  }

  function maybePage() {
    const t = today();
    const r = Core.projectRunway(state, t);
    const cyc = r.cycle;
    const open = Core.maybeOpen(state).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const answered = (state.maybe || []).filter((m) => m.outcome).slice(-10).reverse();
    const w = Core.maybeIfHappens(state, t);
    const st = Core.maybeStats(state);
    const line = (name, val) => '<div class="line"><span>' + name + '</span><span>' + val + '</span></div>';
    const quick = (days, name) => '<button class="pill" type="button" data-action="maybe-when" data-days="' + days + '">' + tr(name) + '</button>';
    const form = ui.maybeForm
      ? '<div class="callout"><b>' + tr('A cost that may come') + '</b><div class="form-grid">' +
        '<label class="field" for="mb-name"><span>' + tr('What') + '</span><input id="mb-name" type="text" maxlength="40" placeholder="' + tr('Wedding gift') + '"></label>' +
        '<label class="field" for="mb-amount"><span>' + tr('About how much (₹)') + '</span><input id="mb-amount" type="number" inputmode="numeric" min="1" max="1000000000" step="any"></label>' +
        '<label class="field" for="mb-date"><span>' + tr('Around when') + '</span><input id="mb-date" type="date" value="' + Core.addDays(t, 7) + '"></label>' +
        '<label class="field" for="mb-likely"><span>' + tr('How likely') + '</span><select id="mb-likely">' +
          ['likely', 'maybe', 'unlikely'].map((k) => '<option value="' + k + '"' + (k === 'maybe' ? ' selected' : '') + '>' + tr(MAYBE_LABEL[k]) + '</option>').join('') + '</select></label>' +
        '<label class="field wide" for="mb-cat"><span>' + tr('Category') + '</span><select id="mb-cat">' + categoryOptions('Family') + '</select></label></div>' +
        '<div class="pills">' + quick(7, 'Next week') + quick(30, 'Next month') + '</div>' +
        (ui.maybeError ? '<p class="bad" role="alert">' + esc(ui.maybeError) + '</p>' : '') +
        '<div class="row"><button class="primary" data-action="maybe-add">' + tr('Save') + '</button><button class="ghost" data-action="maybe-form-cancel">' + tr('Cancel') + '</button></div></div>'
      : '<div><button class="primary" data-action="maybe-form">' + tr('Add a cost that may come') + '</button></div>';
    const past = ['likely', 'maybe', 'unlikely'].filter((k) => st[k].answered >= 3).map((k) =>
      tr('{kind}: came {n} of {total} times', { kind: tr(MAYBE_LABEL[k]), n: st[k].happened, total: st[k].answered }) +
      (st[k].guess ? ' · ' + tr('cost {pct}% of the guess', { pct: Math.round((st[k].actual / st[k].guess) * 100) }) : ''));
    return '<section class="card"><div class="card-head">' + titled('Maybe expenses', 'maybe') + '</div>' +
      '<div class="summary">' + line(tr('Held from today’s limit'), inr(r.held)) + line(tr('Today’s limit'), inr(r.dailyAllowance)) +
      (w ? line(tr('If the “maybe” ones come ({amount})', { amount: inr(w.amount) }), inr(w.limit)) : '') + '</div>' +
      (past.length ? '<p class="hint">' + tr('Your past guesses:') + ' ' + past.join('; ') + '</p>' : '') +
      form +
      (open.length ? '<div class="list">' + open.map((m) => '<div class="list-item"><div class="grow"><div class="title">' + esc(m.name) + ' · ' + tr(MAYBE_LABEL[m.likely]) + '</div>' +
          '<div class="meta">' + fmtDate(m.date) + ' · ' + maybeNote(m, cyc) + '</div>' +
          (m.date <= t ? maybeAnswer(m) : '') + '</div>' +
          '<div class="amt">' + inr(m.amount) + '</div><button class="ghost small" data-action="maybe-remove" data-id="' + esc(m.id) + '" aria-label="' + esc(tr('Remove {name}', { name: m.name })) + '">✕</button></div>').join('') + '</div>'
        : '<p class="hint">' + tr('Nothing added. A wedding, a repair, a doctor’s visit coming up? Add it here so it doesn’t surprise you.') + '</p>') +
      (answered.length ? '<h3>' + tr('Answered') + '</h3><div class="list">' + answered.map((m) => {
        const tx = m.outcome.happened && state.transactions.find((x) => x.id === m.outcome.txId);
        return '<div class="list-item"><div class="grow"><div class="title">' + esc(m.name) + '</div><div class="meta">' + tr(MAYBE_LABEL[m.likely]) + ' · ' +
          (m.outcome.happened ? tr('came: {amount} (guess {guess})', { amount: inr(tx ? tx.amount : 0), guess: inr(m.amount) }) : tr('didn’t come')) + '</div></div>' +
          '<button class="ghost small" data-action="maybe-reopen" data-id="' + esc(m.id) + '">' + tr('Undo') + '</button></div>'; }).join('') + '</div>' : '') +
      '</section>';
  }

  // In a payment's edit view: the expected cost it paid.
  function maybeTxBox(x) {
    if (!x.maybeId) return '';
    const m = (state.maybe || []).find((y) => y.id === x.maybeId);
    if (!m) return '';
    return '<div class="callout"><b>' + tr('Expected cost: {name}', { name: esc(m.name) }) + '</b><span class="hint">' +
      tr('Its money was held, so it’s in your reports but not your daily spending.') + '</span>' +
      '<div><button class="ghost small" data-action="maybe-reopen" data-id="' + esc(m.id) + '">' + tr('It isn’t this cost') + '</button></div></div>';
  }

  // ---------- reimbursable expenses and the side vault ----------

  const REIMB_STATUS = { PENDING: 'Waiting to be paid back', PARTIALLY_REIMBURSED: 'Partly paid back', SETTLED: 'Paid back', CLOSED: 'Closed' };

  function routeOptions(v) {
    return [['daily', 'This month’s spending'], ['vault', 'Side vault']].map(([k, l]) => '<option value="' + k + '"' + (v === k ? ' selected' : '') + '>' + tr(l) + '</option>').join('');
  }

  // On a payment: mark it as paid for work, or what its claim stands at. On money in: match it to claims.
  function reimbBox(x) {
    const flex = Core.isFlexible(x);
    if (flex && x.claimId) {
      const c = Core.reimbView(state).claims.find((y) => y.id === x.claimId);
      if (!c) return '';
      const detail = c.status === 'PENDING' ? tr('{amount} to come back', { amount: inr(c.outstanding) })
        : c.status === 'PARTIALLY_REIMBURSED' ? tr('{back} back, {left} to come', { back: inr(c.allocated), left: inr(c.outstanding) })
        : c.status === 'SETTLED' ? tr('{back} back', { back: inr(c.allocated) }) + (c.margin ? ' · ' + tr('{amount} more than paid', { amount: inr(c.margin) }) : '')
        : tr('{amount} didn’t come back: counted as your spending', { amount: inr(c.shortfall) });
      return '<div class="callout reimb"><b>' + tr('Reimbursable: {amount}', { amount: inr(c.eligible) }) + (c.who ? ' · ' + esc(c.who) : '') + '</b>' +
        '<span class="hint">' + tr(REIMB_STATUS[c.status]) + ': ' + detail + (c.ref ? ' · ' + esc(c.ref) : '') + '</span>' +
        '<label class="field" for="rt-' + esc(c.id) + '"><span>' + tr('Anything paid back beyond it goes to') + '</span><select id="rt-' + esc(c.id) + '" data-reimb-route="' + esc(c.id) + '">' + routeOptions(c.routing) + '</select></label>' +
        '<div class="row">' + (c.status === 'CLOSED'
          ? '<button class="ghost small" data-action="reimb-reopen" data-id="' + esc(c.id) + '">' + tr('Reopen') + '</button>'
          : c.status !== 'SETTLED' ? '<button class="ghost small" data-action="reimb-close" data-id="' + esc(c.id) + '">' + tr('Close: the rest is mine') + '</button>' : '') +
        '<button class="ghost small" data-action="reimb-remove" data-id="' + esc(c.id) + '">' + tr('Not reimbursable') + '</button></div></div>';
    }
    if (flex && !x.iouId && !x.passedOn && !x.splitOf) {
      if (ui.reimbForm !== x.id) return '<button class="link" data-action="reimb-open" data-id="' + esc(x.id) + '">' + tr('Paid for work? Mark it reimbursable') + '</button>';
      return '<div class="callout reimb"><b>' + tr('Paid for work') + '</b><span class="hint">' + tr('Your office or a client pays it back. It stays a payment from your account, but it isn’t your spending.') + '</span>' +
        '<div class="form-grid"><label class="field" for="rb-eligible"><span>' + tr('Paid back (₹)') + '</span><input id="rb-eligible" type="number" inputmode="numeric" min="1" max="' + x.amount + '" step="1" value="' + x.amount + '"></label>' +
        '<label class="field" for="rb-who"><span>' + tr('Who pays it (optional)') + '</span><input id="rb-who" type="text" maxlength="40"></label>' +
        '<label class="field" for="rb-ref"><span>' + tr('Claim number (optional)') + '</span><input id="rb-ref" type="text" maxlength="40"></label>' +
        '<label class="field" for="rb-route"><span>' + tr('Anything paid back beyond it goes to') + '</span><select id="rb-route">' + routeOptions(state.reimbRouting || 'daily') + '</select></label></div>' +
        (ui.reimbError ? '<p class="bad" role="alert">' + esc(ui.reimbError) + '</p>' : '') +
        '<div class="row"><button class="primary" data-action="reimb-save" data-id="' + esc(x.id) + '">' + tr('Save') + '</button><button class="ghost" data-action="reimb-cancel">' + tr('Cancel') + '</button></div></div>';
    }
    if (Core.isIncome(x) && x.payoutId) {
      const v = Core.reimbView(state);
      const p = v.payouts.find((y) => y.id === x.payoutId);
      const names = ((p && p.allocations) || []).map((a) => { const c = v.claims.find((y) => y.id === a.claimId); const t = c && state.transactions.find((y) => y.id === c.txId); return esc((t && t.note) || tr('a claim')) + ' ' + inr(a.amount); }).join(', ');
      return '<div class="callout reimb"><b>' + tr('Reimbursement') + '</b><span class="hint">' + tr('For: {claims}', { claims: names || '—' }) +
        (p && p.excess ? ' · ' + tr('{amount} not matched to a claim', { amount: inr(p.excess) }) : '') + '</span>' +
        '<div><button class="ghost small" data-action="reimb-unpay" data-id="' + esc(x.id) + '">' + tr('It isn’t a reimbursement') + '</button></div></div>';
    }
    return Core.isIncome(x) ? reimbMatchBox(x) : '';
  }

  // Money in that may be a reimbursement: pick the claims it pays.
  function reimbMatchBox(tx) {
    if (!Core.isIncome(tx) || tx.payoutId || tx.iouId || tx.iouPay || tx.passedOn || tx.borrowed) return '';
    const open = Core.reimbView(state).claims.filter((c) => c.status === 'PENDING' || c.status === 'PARTIALLY_REIMBURSED');
    if (!open.length) return '';
    return '<div class="callout reimb"><b>' + tr('Is this a reimbursement?') + '</b>' +
      open.slice(0, 6).map((c) => { const t = state.transactions.find((y) => y.id === c.txId) || {};
        return '<label class="check-row"><input type="checkbox" data-reimb-claim="' + esc(c.id) + '"' + (open.length === 1 ? ' checked' : '') + '> ' +
          esc(t.note || tr('Payment')) + ' · ' + fmtDate(c.date) + ' · ' + tr('{amount} to come', { amount: inr(c.outstanding) }) + '</label>'; }).join('') +
      '<div><button class="ghost small" data-action="reimb-match" data-id="' + esc(tx.id) + '">' + tr('Match to these claims') + '</button></div></div>';
  }

  // Spend → Reimbursements: what's owed back, the side vault, and each claim.
  function reimbPage() {
    const v = Core.reimbView(state);
    const line = (name, val) => '<div class="line"><span>' + tr(name) + '</span><span>' + val + '</span></div>';
    return '<section class="card"><div class="card-head">' + titled('Reimbursements', 'reimb') + '</div>' +
      (!v.claims.length ? '<p class="hint">' + tr('Paid for something your office or a client pays back? Open the payment and tap Paid for work. It stays out of your spending until the money comes back.') + '</p>' : '') +
      '<div class="summary">' + line('Owed back to you', inr(v.pendingFloat)) + line('Side vault', inr(v.vault)) +
      (v.unallocated ? line('Paid back, not matched to a claim', inr(v.unallocated)) : '') + '</div>' +
      '<label class="field" for="reimb-default"><span>' + tr('Extra paid back goes to, for new claims') + '</span><select id="reimb-default" data-reimb-default="1">' + routeOptions(state.reimbRouting || 'daily') + '</select></label>' +
      '<p class="hint">' + tr('Side vault: kept apart from daily spending, but counted in your net worth.') + '</p>' +
      (v.claims.length ? '<div class="list">' + v.claims.slice().reverse().map((c) => { const t = state.transactions.find((y) => y.id === c.txId) || {};
        return '<div class="list-item"><div class="grow"><div class="title">' + esc(t.note || tr('Payment')) + (c.who ? ' · ' + esc(c.who) : '') + '</div>' +
          '<div class="meta">' + fmtDate(c.date) + ' · ' + tr(REIMB_STATUS[c.status]) + (c.outstanding ? ' · ' + tr('{amount} to come', { amount: inr(c.outstanding) }) : '') + (c.margin ? ' · +' + inr(c.margin) : '') + '</div></div>' +
          '<button class="ghost small" data-action="tx-edit" data-id="' + esc(c.txId) + '">' + inr(c.eligible) + '</button></div>'; }).join('') + '</div>' : '') + '</section>';
  }

  function notPaymentBox(x, can) {
    if (!can || !(x.smsKey || x.source === 'sms')) return '';
    const shop = Core.normalizeMerchant(x.note) && x.note !== 'Bank payment' ? x.note : '';
    return '<div class="callout not-payment"><b>' + tr('Not a payment?') + '</b>' +
      '<span class="hint">' + tr('Read from a bank SMS that wasn’t one: an OTP, a payment request, a failed or reversed payment, or an offer. It comes out of your spending and won’t come back from SMS.') + '</span>' +
      (shop ? '<label class="check-row" for="np-skip"><input type="checkbox" id="np-skip"> ' + tr('Also skip SMS from {shop} from now on', { shop: esc(shop) }) + '</label>' : '') +
      '<div><button class="danger" data-action="tx-not-payment">' + tr('It’s not a payment') + '</button></div></div>';
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
      (x.matched || x.matchedIn ? '<div class="callout"><span class="hint">' + tr('Linked to a bank SMS: {merchant}, {date}.', { merchant: esc((x.matched || x.matchedIn).merchant || ''), date: fmtDate((x.matched || x.matchedIn).date) }) + '</span>' +
        '<div><button class="ghost small" data-action="tx-unlink">' + tr('Not the same payment') + '</button></div></div>' : '') +
      (state.reconciledTo && x.date <= state.reconciledTo ? '<p class="hint">' + tr('Checked against your bank on {date}. Changing it makes the app’s count differ from your bank’s.', { date: fmtDate(Core.addDays(state.reconciledTo, 1)) }) + '</p>' : '') +
      (locked ? '<p class="hint">' + tr(x.kind === 'cardpay'
        ? 'A card bill payment: its amount is tied to the bill. You can change the date the money left your account.'
        : 'This is a bill or card payment, so its amount and date are tied to the bill. To change them, delete it and record it again.') + '</p>' : '') +
      '<div class="form-grid">' +
      // A card bill payment keeps its amount, but its date can be put right (the day the money really left).
      (locked && x.kind === 'cardpay' ? field('edit-date', 'Paid on', '<input id="edit-date" type="date" max="' + t + '" value="' + esc(x.date) + '">') : '') +
      (locked ? '' : field('edit-amount', 'Amount (₹)', '<input id="edit-amount" type="number" inputmode="decimal" min="1" max="1000000000" step="any" value="' + esc(x.amount) + '">') +
        field('edit-date', 'Date', '<input id="edit-date" type="date" max="' + t + '" value="' + esc(x.date) + '">')) +
      field('edit-note', isIn ? 'From' : 'Where / what', '<input id="edit-note" type="text" value="' + esc(x.note || '') + '">') +
      (flex || isIn ? '<div class="field wide"><span>' + tr('Category') + '</span>' + pickerPair(isIn, x, null, 'id="edit-cat"') + '</div>' : '') +
      (flex && ((state.cards || []).length || (state.wallets || []).length) ? '<label class="field wide" for="edit-from"><span>' + tr('Paid from') + '</span><select id="edit-from">' + fromOptions(x) + '</select></label>' : '') +
      ((isIn || saved) && (state.wallets || []).length ? '<label class="field wide" for="edit-from"><span>' + tr(isIn ? 'Into' : 'From') + '</span><select id="edit-from">' + intoOptions(x) + '</select></label>' : '') +
      '</div>' +
      (flex && Core.protectList(state).length ? protectTxField(x) : '') +
      (flex && ui.split && ui.split.id === x.id ? splitEditor(x) : flex ? '<button class="link" data-action="split-open">' + tr('Split this payment into categories') + '</button>' : '') +
      (ui.editError ? '<p class="bad" role="alert">' + ui.editError + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="edit-save">' + tr('Save changes') + '</button><button class="ghost" data-action="edit-cancel">' + tr('Cancel') + '</button></div>' +
      (x.passedOn ? '<div class="callout"><span class="hint">' + tr('Passed on with {other}: not counted as income or spending.', { other: esc(txTitle(state.transactions.find((y) => y.id === x.passedOn) || {})) }) + '</span>' +
        '<div><button class="ghost small" data-action="pass-undo">' + tr('It wasn’t passed on') + '</button></div></div>' : '') +
      (x.iouId || x.iouPay ? '<div class="callout"><span class="hint">' + tr('Money with {name} (People): not counted as income or spending.', { name: esc(((state.iou || []).find((i) => i.id === (x.iouId || x.iouPay)) || {}).name || '') }) + '</span></div>' : '') +
      (ui.iouStart && ui.iouStart.txId === x.id ? iouStartForm() : iouActions(x)) +
      (flex && Core.ownPart(x) > 0 && Core.keptFor(state).length ? '<div class="iou-actions">' + Core.keptFor(state).slice(0, 3).map((k) =>
        '<button class="ghost small" data-action="keep-use" data-id="' + esc(k.tx.id) + '" data-buy="' + esc(x.id) + '">' + tr('Paid from {name} ({left} left)', { name: esc(k.name), left: inr(k.left) }) + '</button>').join('') + '</div>' : '') +
      (x.covered ? '<p class="hint">' + tr('{amount} of it was paid from money kept for it, so it doesn’t use your budgets.', { amount: inr(x.covered) }) + '</p>' : '') +
      refundsBox(x) +
      reimbBox(x) + maybeTxBox(x) + fixedTxBox(x) + refundTxBox(x) + eventTxBox(x) +
      notPaymentBox(x, flex || isIn || saved) +
      '</div></div>';
  }

  // "What you protect" for one payment: set on the payment itself; its category or shop may already protect it.
  function protectTxField(x) {
    const list = Core.protectList(state);
    const own = list.find((p) => (p.txIds || []).indexOf(x.id) !== -1);
    const via = own ? null : Core.protectOf(state, x);
    return '<label class="field wide" for="edit-protect"><span>' + tr('What you protect') + '</span><select id="edit-protect"><option value="">' + tr('—') + '</option>' +
      list.map((p) => '<option value="' + esc(p.id) + '"' + (own === p ? ' selected' : '') + '>🛡 ' + esc(protectLabel(p.name)) + '</option>').join('') + '</select>' +
      (via ? '<span class="hint">' + tr('Already protected as {name}, through its category or shop.', { name: esc(protectLabel(via.name)) }) + '</span>' : '') + '</label>';
  }

  // Applies the edit and keeps everything tied to the payment right: a fund or loan it went to, money taken from the fund.
  function saveEdit() {
    const x = state.transactions.find((t) => t.id === ui.editTx);
    if (!x) { ui.editTx = null; render(); return; }
    const amountBefore = x.amount;
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    const before = JSON.stringify(state);
    const note = (val('edit-note') || '').trim();
    const protectId = val('edit-protect');
    if (protectId !== null) {
      Core.protectList(state).forEach((p) => { if ((p.txIds || []).indexOf(x.id) !== -1 && p.id !== protectId) Core.linkProtect(state, p.id, { txId: x.id }, false); });
      if (protectId) Core.linkProtect(state, protectId, { txId: x.id }, true);
    }
    if (!txLocked(x)) {
      const amount = Math.round(Number(val('edit-amount')));
      const date = val('edit-date');
      if (!(amount > 0)) { ui.editError = tr('Enter an amount above ₹0.'); render(); return; }
      if (!date || date > today()) { ui.editError = tr('Pick a date up to today.'); render(); return; }
      // Money with friends follows the entry: what's owed, or what's been paid back.
      const iou = (state.iou || []).find((i) => i.id === (x.iouId || x.iouPay));
      if (iou && x.iouId) {
        if (amount < (Number(iou.paid) || 0)) { ui.editError = tr('{amount} of it is already paid back. It can’t be less.', { amount: inr(iou.paid) }); render(); return; }
        iou.amount = (Number(iou.amount) || 0) + amount - x.amount;
      }
      if (iou && x.iouPay && amount - x.amount > Core.iouLeft(iou)) {
        ui.editError = tr('Only {max} was left to pay back with {name}. Make it {max} or less, and add the rest as its own entry.', { name: iou.name, max: inr(Core.iouLeft(iou) + x.amount) });
        render(); return;
      }
      if (iou && x.iouPay) {
        iou.paid = Math.max(0, (Number(iou.paid) || 0) + amount - x.amount);
        (iou.payments || []).forEach((pm) => { if (pm.txId === x.id) pm.amount = amount; });
      }
      if (x.useFor === 'keep') {
        // Kept for a purchase: the purchases it already paid for stay paid.
        if (amount < (Number(x.keepUsed) || 0)) { ui.editError = tr('{amount} of it already paid for purchases. It can’t be less.', { amount: inr(x.keepUsed) }); render(); return; }
        x.amount = amount;
        x.date = date;
      } else if (Core.isIncome(x) || Core.isMove(x)) {
        // Take back what it did to a fund, goal or loan, change it, then do it again with the new amount.
        const use = x.useFor;
        const debtId = x.debtId;
        const goalId = x.goalId;
        // Taken back once, with the old amount (setIncomeUse would take it back again).
        if (use) { undoIncomeUse(x); x.useFor = null; }
        x.amount = amount;
        x.date = date;
        if (use) setIncomeUse(x, use, debtId, goalId);
      } else {
        if (x.fromFund) state.savings.emergencyBalance = (Number(state.savings.emergencyBalance) || 0) + x.amount - amount;
        // A purchase paid from kept money, now smaller: what it no longer needs is kept again.
        if (x.covered && amount < x.covered) {
          const k = state.transactions.find((y) => y.id === x.coveredFrom);
          const back = x.covered - amount;
          if (k) {
            k.keepUsed = Math.max(0, (Number(k.keepUsed) || 0) - back);
            (k.keepUses || []).forEach((u) => { if (u.id === x.id) u.amount = Math.max(0, u.amount - back); });
          }
          x.covered = amount;
        }
        // Now bigger: kept money still left pays more of it.
        if (x.coveredFrom && amount > x.amount) {
          const k = state.transactions.find((y) => y.id === x.coveredFrom);
          const add = k ? Math.min(Math.max(0, k.amount - (Number(k.keepUsed) || 0)), amount - (Number(x.covered) || 0)) : 0;
          if (add > 0) {
            k.keepUsed = (Number(k.keepUsed) || 0) + add;
            (k.keepUses || []).forEach((u) => { if (u.id === x.id) u.amount += add; });
            x.covered = (Number(x.covered) || 0) + add;
          }
        }
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
    const choice = val('edit-cat');
    // A choice that does something (a bill, an EMI, savings, People) is done once the rest is saved.
    const later = choice && (isSmart(choice) || personPick(choice)) ? choice : null;
    const cat = later ? null : choice;
    if (cat && cat !== (x.sub ? x.category + '|' + x.sub : x.category)) {
      setCategoryChoice(x, cat, false);
      if (Core.isIncome(x)) {
        x.borrowed = x.category === LOAN_CATEGORY;
        if (x.borrowed && !x.useFor) x.useFor = 'spend';
      } else if (x.category === 'Savings' && Core.isFlexible(x)) {
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
    // A reimbursable payment's claim, and a reimbursement's matching, follow a new amount.
    if (x.claimId) Core.reimbAmount(state, x);
    // A refund or a refunded payment with a new amount: linked again only if it still fits.
    if ((x.refundOf || x.refunded) && x.amount !== amountBefore) {
      const amountNow = x.amount;
      const pairs = x.refundOf ? [[x, x.refundOf]] : state.transactions.filter((y) => y.refundOf === x.id).map((y) => [y, x.id]);
      // Unlinked at the amounts they were linked with, then linked again at the new ones.
      x.amount = amountBefore;
      pairs.forEach(([r]) => Core.unlinkRefund(state, r));
      x.amount = amountNow;
      pairs.forEach(([r, buyId]) => Core.linkRefund(state, r.id, buyId));
    }
    if (x.payoutId && x.amount !== amountBefore) {
      const p = (state.reimb.payouts || []).find((y) => y.id === x.payoutId);
      const ids = p ? p.allocations.map((a) => a.claimId) : [];
      Core.reimbForget(state, x);
      if (ids.length) Core.recordPayout(state, x.id, ids);
    }
    let said = 'Saved';
    if (later && personPick(later)) { linkPerson(x, personPick(later)); said = smsNews.join(' · ') || said; smsNews = []; }
    else if (later) {
      const msg = applySmart(x, later);
      if (!msg) { ui.editError = tr('That doesn’t fit this entry.'); state = JSON.parse(before); render(); return; }
      said = msg;
    }
    ui.editTx = null; ui.editError = '';
    save();
    rerenderKeepScroll();
    offerUndo(said, before);
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
    family: '<path d="M8 3.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm8.5 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM2.5 20c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6zm12-.1c0-2.1-.6-4-1.6-5.4.9-.6 2-.9 3.1-.9 2.8 0 5 2.4 5 5.4v.9z"/>',
    gift: '<path d="M4 9h16v4H4zm1.5 4.5h5.7V21H5.5zm7.3 0h5.7V21h-5.7zM11.2 9V21h1.6V9zM12 8.6C9.5 4.4 6.2 5 6.6 7c.3 1.4 2.6 1.9 5.4 1.6zm0 0c2.5-4.2 5.8-3.6 5.4-1.6-.3 1.4-2.6 1.9-5.4 1.6z"/>',
  };
  const CAT_LOOK = {
    Groceries: ['cart', 'aqua'], 'Food & dining': ['food', 'magenta'], Travel: ['travel', 'blue'], Shopping: ['bag', 'violet'],
    Entertainment: ['ticket', 'green'], Health: ['heart', 'blue'], 'Personal care': ['drop', 'magenta'], Misc: ['dots', 'grey'],
    Bills: ['bolt', 'teal'], Savings: ['save', 'green'], Cash: ['cash', 'grey'], Emergency: ['alert', 'coral'],
    Family: ['family', 'magenta'], Gifts: ['gift', 'violet'],
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
      : x.emiFor ? esc(tr('Loan EMI')) : x.fixedId ? esc(tr('Fixed payment'))
      : edit && !saved && !Core.isBillPayment(x) && !Core.isCardTransfer(x)
      ? pickerPair(isIn, x, null, 'data-tx-cat="' + esc(x.id) + '"')
      : saved ? esc(x.useFor ? tr('Saved → {place}', { place: savedWhere(x) }) : tr('Saved: choose where it goes'))
        : esc(label(Core.isCardTransfer(x) ? 'Card' : Core.isBillPayment(x) ? 'Bills' : x.category || ''));
    const sub = cat + ' · ' + fmtDate(x.date) +
      (x.source === 'sms' ? ' · ' + tr('from SMS') : x.source === 'widget' ? ' · ' + tr('from widget') : '') +
      (onCard ? ' · <span class="warn">' + tr('on {card}', { card: cardLabel(onCard) }) + '</span>' : '') +
      (x.wallet && !Core.isTransfer(x) ? ' · ' + esc(walletName(x.wallet)) : '') +
      (x.splitOf ? ' · <span class="chip">' + tr('Split') + '</span>' : '') +
      (x.eventId ? ' · <span class="chip">' + esc(((state.events || []).find((e) => e.id === x.eventId) || {}).name || '') + '</span>' : '') +
      (x.passedOn ? ' · <span class="chip">' + tr('Passed on') + '</span>' : '') +
      (x.iouId || x.iouPay ? ' · <span class="chip">' + tr('People') + '</span>' : '') +
      (Core.protectOf(state, x) && Core.isFlexible(x) ? ' · <span class="chip protect-chip">🛡 ' + esc(protectLabel(Core.protectOf(state, x).name)) + '</span>' : '') +
      (x.claimId ? ' · <span class="chip">' + tr('Reimbursable') + '</span>' : '') +
      (x.maybeId ? ' · <span class="chip">' + tr('Expected cost') + '</span>' : '') +
      (x.payoutId ? ' · <span class="chip">' + tr('Reimbursement') + '</span>' : '') +
      (x.matched || x.matchedIn ? ' · <span class="chip">' + tr('Bank SMS ✓') + '</span>' : '') +
      ((x.refunds || []).length ? ' · <span class="chip">' + tr('{amount} refunded', { amount: inr(x.refunds.reduce((a, r) => a + r.amount, 0)) }) + '</span>' : '') +
      (x.refunded ? ' · <span class="chip">' + tr('{amount} refunded', { amount: inr(x.refunded) }) + '</span>' : '') +
      (x.refundOf ? ' · <span class="chip">' + tr('Refund') + '</span>' : '') +
      (x.cashAdvance ? ' · <span class="chip warn">' + tr('Cash on credit card') + '</span>' : '');
    const extra = edit && isIn
      ? ' <button class="link" data-action="income-change" data-id="' + esc(x.id) + '">' + tr(x.useFor ? INCOME_USE_LABELS[x.useFor] : 'Choose what it does') + '</button>'
      : edit && saved && x.useFor ? ' <button class="link" data-action="saved-change" data-id="' + esc(x.id) + '">' + tr('Change') + '</button>' : '';
    return '<div class="tx-row' + (x.needsReview ? ' needs-check' : '') + '">' + catIcon(x) +
      '<div class="tx-main"><button class="tx-title" data-action="tx-edit" data-id="' + esc(x.id) + '" aria-label="' + esc(tr('Edit {name}', { name: txTitle(x) })) + '">' + txTitle(x) +
      (x.needsReview ? ' <span class="chip chip-check">' + tr('Check') + '</span>' : '') + '<svg class="tx-pen" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5-4-4L4 16z"/></svg></button>' +
      '<div class="tx-sub">' + sub + extra + '</div>' +
      (saved && ui.savedChange === x.id ? '<div class="row saved-places">' + savingPlaces().map((p) => {
        const here = p.use === x.useFor && (p.use !== 'goal' || p.goalId === x.goalId) && (p.use !== 'debt' || p.debtId === x.debtId);
        return '<button class="small' + (here ? ' primary' : '') + '" data-action="saved-dest" data-id="' + esc(x.id) + '" data-use="' + p.use + '"' +
          (p.debtId ? ' data-debt="' + esc(p.debtId) + '"' : '') + (p.goalId ? ' data-goal="' + esc(p.goalId) + '"' : '') + '>' + (here ? '✓ ' : '') + esc(p.label) + '</button>';
      }).join('') + '</div>' : '') + '</div>' +
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
    const all = showAllFeatures();
    return '<section class="card"><h2>' + tr('Show all features') + '</h2>' +
      '<p class="hint">' + tr(all ? 'Every page shows on every tab.' : 'Pages only some people need (trips, wallets, work expenses…) show once you need them; the rest wait under “More features” on each tab.') + '</p>' +
      '<div><button data-action="features-all" aria-pressed="' + all + '">' + tr(all ? 'Show pages when I need them' : 'Show all features') + '</button></div></section>' +
      '<section class="card"><h2>' + tr('Appearance') + '</h2>' +
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
        else { render(); if (SmsInbox) collectNative(); }
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
  const PLAN_ICONS = { direction: 'target', advisor: 'chat', save: 'pot', loans: 'loan', fraud: 'shield', invest: 'sprout' };

  // ---------- the monthly review and the money ladder ----------

  const LADDER = {
    basics: ['Basics and every minimum, nothing new borrowed', 'Late fees and new loans cost the most. Rent, food, medicine, school fees and every EMI come first.'],
    buffer: ['A starter safety fund', 'A month of basics set aside, so a surprise doesn’t turn into a new loan.'],
    debt: ['Clear costly loans', 'Loans costing 12% a year or more: paying them off is a sure return no investment beats. Costliest first.'],
    fund: ['The full emergency fund', 'Months of basics set aside, so losing income or a big bill doesn’t undo your progress.'],
    goals: ['Your savings goals', 'Saved for, not borrowed for.'],
    invest: ['Learn about investing', 'With no costly loans and a full fund, money you won’t need for years can grow.'],
  };

  // What finishing the current step takes.
  function ladderMilestone(ms) {
    if (ms.kind === 'basics') return ms.short
      ? tr('Your salary is {amount} short of basics and minimums each month. Closing that gap comes first: see Debts → Your journey.', { amount: inr(ms.short) })
      : tr('A month with nothing new borrowed. Card spending counts until the bill is paid in full.');
    if (ms.kind === 'buffer') return tr('{amount} more in your emergency fund reaches {target} days of basics (now {days}).', { amount: inr(ms.amount), target: ms.target, days: ms.days });
    if (ms.kind === 'debt') return tr('Clear {name} first: {rate}% a year, {amount} left.', { name: esc(ms.name), rate: ms.rate, amount: inr(ms.balance) }) +
      (ms.count > 1 ? ' ' + tr('Then {n} more, costliest first.', { n: ms.count - 1 }) : '');
    if (ms.kind === 'fund') return tr('{amount} more reaches {months} months of basics.', { amount: inr(ms.amount), months: ms.months });
    if (ms.kind === 'goals') return tr('{name}: {amount} to go.', { name: esc(ms.name), amount: inr(ms.left) }) + (ms.by ? ' ' + tr('By {date}.', { date: fmtDate(ms.by, true) }) : '');
    return tr('Learn the types first (PPF, deposits, an index fund). Talk to a SEBI-registered investment adviser before investing.');
  }

  // The health check: five areas, worked out by the app, each with its number and a status in words (never colour alone).
  const HEALTH_STATUS = { good: ['✓', 'Good', 'good'], watch: ['!', 'Watch', 'warn'], bad: ['✗', 'Needs action', 'bad'], unknown: ['–', 'Not enough recorded', 'hint'] };
  function healthRows(hc) {
    const val = (a) => ({
      cash: () => tr('{pct}% of pay goes on fixed payments, EMIs and bills', { pct: a.pct === null ? '–' : a.pct }),
      debt: () => a.costliest ? tr('EMIs take {pct}% of pay; costliest {rate}% a year', { pct: a.pct === null ? '–' : a.pct, rate: a.costliest.rate }) : tr('No loans'),
      fund: () => tr('{days} days of basics', { days: a.days }),
      spend: () => a.status === 'unknown' ? tr('Under half the days have entries') : tr('{spent} of {budget}', { spent: inr(a.spent), budget: inr(a.budget) }) + (a.borrowed ? ' · ' + tr('{amount} borrowed', { amount: inr(a.borrowed) }) : ''),
      save: () => a.status === 'unknown' ? tr('Under half the days have entries') : tr('{pct}% of pay', { pct: a.pct }),
    }[a.area])();
    const NAME = { cash: 'Cash flow', debt: 'Debt', fund: 'Safety fund', spend: 'Spending last round', save: 'Saving last round' };
    return '<div class="health">' + hc.areas.map((a) => { const s = HEALTH_STATUS[a.status];
      return '<div class="health-row"><span class="health-mark ' + s[2] + '" aria-hidden="true">' + s[0] + '</span><div class="grow"><b>' + tr(NAME[a.area]) + '</b><span class="hint">' + val(a) + '</span></div>' +
        '<span class="chip ' + s[2] + '">' + tr(s[1]) + '</span></div>'; }).join('') + '</div>';
  }

  // If nothing changes, and with the plan: the app's own numbers, side by side.
  function whatIfTable(wi, fe) {
    if (!(wi.per > 0)) return (wi.room.freed || []).map((e) => '<p class="hint good">' + tr('{name} ends in {month}: {amount} a month is free after that.', { name: esc(e.name), month: monthName(Core.parseISO(e.last).getMonth()) + ' ' + Core.parseISO(e.last).getFullYear(), amount: inr(e.emi) }) + '</p>').join('');
    const rows = [];
    const months = (n) => tr(n === 1 ? 'in {n} month' : 'in {n} months', { n });
    const monthYear = (iso) => monthName(Core.parseISO(iso).getMonth()) + ' ' + Core.parseISO(iso).getFullYear();
    if (wi.fund) {
      rows.push([tr('{days} days of safety', { days: wi.fund.target }), wi.fund.months.now ? months(wi.fund.months.now) : tr('Not at this pace'), months(wi.fund.months.plan)]);
      rows.push([tr('Fund in 3 months'), tr('{days} days of basics', { days: wi.fund.daysIn3.now }), tr('{days} days of basics', { days: wi.fund.daysIn3.plan })]);
    }
    if (wi.debt && wi.debt.extra) {
      rows.push([tr('Debt-free'), wi.debt.free.now ? monthYear(wi.debt.free.now) : tr('Never'), wi.debt.free.plan ? monthYear(wi.debt.free.plan) : tr('Never')]);
      rows.push([tr('Interest still to pay'), inr(wi.debt.interest.now), inr(wi.debt.interest.plan)]);
    }
    if (!rows.length) return '';
    const to = wi.fund ? tr('into the emergency fund') : tr('extra on loans');
    return '<h3>' + tr('If nothing changes, and with the plan') + '</h3><div class="table-wrap"><table><thead><tr><th></th><th>' + tr('If nothing changes') + '</th><th>' +
      tr(fe && fe.status === 'short' ? 'With {amount} a month from next payday' : 'With {amount} a month', { amount: inr(wi.per) }) + '</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + r[0] + '</td><td class="amt">' + r[1] + '</td><td class="amt good">' + r[2] + '</td></tr>').join('') + '</tbody></table></div>' +
      (wi.room.freed || []).map((e) => '<p class="hint good">' + tr('{name} ends in {month}: {amount} a month is free after that.', { name: esc(e.name), month: monthYear(e.last), amount: inr(e.emi) }) + '</p>').join('');
  }


  // ---------- what matters most: things I protect ----------

  // A protected thing's name: the list's own names in your language, your own as you wrote them.
  function protectLabel(name) {
    const preset = Core.PROTECT_PRESETS.find((p) => p[1] === name);
    return preset ? tr(name) : name;
  }
  // Categories and subcategories to link: 'Family', 'Travel|Fuel'.
  function protectCatOptions(taken) {
    const cats = BUILT_IN_CATEGORIES.concat((state.budgets || []).map((b) => b.name)).filter((c, i, a) => a.indexOf(c) === i && c !== 'Savings' && c !== 'Cash');
    return cats.map((c) => [c].concat(Core.subcategories(state, c).map((sub) => c + '|' + sub)))
      .reduce((a, b) => a.concat(b), []).filter((v) => taken.indexOf(v) === -1)
      .map((v) => '<option value="' + esc(v) + '">' + esc(v.split('|').map(label).join(' › ')) + '</option>').join('');
  }
  // Places you paid in the last 3 months, most often first.
  function protectShopOptions(taken) {
    const from = Core.addDays(today(), -90);
    const count = {};
    const name = {};
    state.transactions.filter((t) => Core.isFlexible(t) && t.date >= from && t.note).forEach((t) => {
      const k = Core.normalizeMerchant(t.note);
      if (!k || taken.indexOf(k) !== -1) return;
      count[k] = (count[k] || 0) + 1;
      name[k] = name[k] || t.note;
    });
    return Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 40)
      .map((k) => '<option value="' + esc(name[k]) + '">' + esc(name[k]) + '</option>').join('');
  }

  function protectPage() {
    const t = today();
    const list = Core.protectList(state);
    const sum = Core.protectSummary(state, t);
    const taken = (k) => list.reduce((a, x) => a.concat(x[k] || []), []);
    const cards = list.map((x) => {
      const m = sum.find((y) => y.id === x.id) || {};
      const chip = (kind, val, text) => '<button class="chip-x" data-action="protect-unlink" data-id="' + esc(x.id) + '" data-kind="' + kind + '" data-val="' + esc(val) + '" aria-label="' + esc(tr('Remove {name}', { name: text })) + '">' + esc(text) + ' ✕</button>';
      const links = (x.cats || []).map((c) => chip('cat', c, c.split('|').map(label).join(' › ')))
        .concat((x.shops || []).map((sh) => chip('shop', sh, sh)))
        .concat((x.txIds || []).length ? ['<span class="chip">' + tr('{n} single payments', { n: x.txIds.length }) + '</span>'] : []);
      const open = ui.protectLink === x.id;
      return '<div class="protect-item">' +
        '<div class="protect-top"><b>🛡 ' + esc(protectLabel(x.name)) + '</b><button class="ghost small" data-action="protect-remove" data-id="' + esc(x.id) + '">' + tr('Remove') + '</button></div>' +
        '<span class="hint">' + (m.count ? tr('{round} this round · usually about {usual} a month', { round: inr(m.round), usual: inr(m.usual) }) : tr('Nothing linked has been spent yet.')) + '</span>' +
        (m.high ? '<div class="callout warn"><span class="hint">' + tr('Running above usual: about {pace} this round at this pace, while money is tight. It stays protected and no cut is suggested, but it’s part of why money is short. Your call.', { pace: inr(m.pace) }) + '</span></div>' : '') +
        '<div class="protect-links">' + (links.length ? links.join('') : '<span class="hint">' + tr('Nothing linked yet: add a category or a shop.') + '</span>') + '</div>' +
        (open
          ? '<div class="protect-add"><label class="field" for="pl-cat-' + esc(x.id) + '"><span>' + tr('Category') + '</span><select id="pl-cat-' + esc(x.id) + '"><option value="">—</option>' + protectCatOptions(taken('cats')) + '</select></label>' +
            '<label class="field" for="pl-shop-' + esc(x.id) + '"><span>' + tr('Shop or person you pay') + '</span><select id="pl-shop-' + esc(x.id) + '"><option value="">—</option>' + protectShopOptions(taken('shops')) + '</select></label>' +
            '<div class="row"><button class="primary small" data-action="protect-link-save" data-id="' + esc(x.id) + '">' + tr('Add') + '</button><button class="ghost small" data-action="protect-link" data-id="">' + tr('Done') + '</button></div>' +
            '<span class="hint">' + tr('A single payment: open it in Payments and choose this under “What you protect”.') + '</span></div>'
          : '<button class="link" data-action="protect-link" data-id="' + esc(x.id) + '">' + tr('Link a category, shop or payment') + '</button>') + '</div>';
    }).join('');
    const free = Core.PROTECT_MAX - list.length;
    const presets = Core.PROTECT_PRESETS.filter((p) => !list.some((x) => x.preset === p[0] || x.name === p[1]));
    return '<section class="card protect"><h2>' + tr('What matters most') + '</h2>' +
      '<p>' + tr('<b>Things I protect:</b> up to five things you won’t compromise on. Where to cut, little leaks and the AI plan leave them alone; when a cut would touch one, the app says what it would save and offers other ways first.') + '</p>' +
      '<p class="hint">' + tr('Protected doesn’t mean unlimited: today’s limit, the zones and “can I afford it?” still count every rupee, and the app tells you when one runs above usual while money is tight.') + '</p>' +
      cards +
      (free > 0
        ? '<h3>' + tr('Add one ({n} left)', { n: free }) + '</h3>' +
          '<div class="protect-presets">' + presets.map((p) => '<button class="ghost small" data-action="protect-add" data-preset="' + p[0] + '">+ ' + tr(p[1]) + '</button>').join('') + '</div>' +
          '<form id="protect-form" class="row" autocomplete="off"><label class="field grow-field" for="protect-name"><span>' + tr('Your own') + '</span><input id="protect-name" type="text" maxlength="40" placeholder="' + esc(tr('Sunday lunch with parents')) + '"></label>' +
          '<button class="primary" type="submit">' + tr('Add') + '</button></form>'
        : '<p class="hint">' + tr('Five is the most: remove one to add another.') + '</p>') +
      (ui.protectError ? '<p class="bad" role="alert">' + esc(ui.protectError) + '</p>' : '') + '</section>';
  }

  // Where to cut: halving spending that isn't essentials, by category, with what it saves by payday and where payday lands.
  function cutsBox(cu) {
    if (!cu.days) return '';
    if (!cu.cuts.length) return '<h3>' + tr('Where to cut') + '</h3><p class="hint">' + tr('Nothing to suggest yet: cuts show once two weeks of spending outside essentials are recorded.') + '</p>' + protectTradeOff(cu);
    return '<h3>' + tr('Where to cut') + '</h3><div class="summary">' +
      cu.cuts.map((c) => '<div class="line"><span>' + tr('{name}: {from} → {to} a day', { name: esc(label(c.category)), from: inr(c.daily), to: inr(c.keep) }) + '</span><span>' + tr('saves {amount}', { amount: inr(c.toPayday) }) + '</span></div>').join('') +
      '<div class="line"><span><b>' + tr('Payday at this pace → with these cuts') + '</b></span><span><b>' + inr(cu.endPace) + ' → ' + inr(cu.afterCuts) + '</b></span></div></div>' +
      '<p class="hint">' + tr('Halving each one until payday, from your last 8 weeks. In a month that’s {amount}.', { amount: inr(cu.perMonth) }) +
      (cu.status === 'short' ? ' ' + tr('Essentials alone are still short by {amount}: cuts stop the gap growing, they don’t close it.', { amount: inr(cu.shortBy) }) : '') + '</p>' +
      protectTradeOff(cu);
  }

  // What the cuts leave alone because you protect it, what halving it would save, and the other ways first when money is short.
  function protectTradeOff(cu) {
    if (!cu.protected || !cu.protected.length) return '';
    return '<div class="callout protect-note-box"><b>🛡 ' + tr('Left alone: you protect these') + '</b>' +
      '<span class="hint">' + cu.protected.map((c) => tr('{name}: about {daily} a day. Halving it would save {amount} by payday.', { name: esc(protectLabel(c.name)), daily: inr(c.daily), amount: inr(c.toPayday) })).join(' ') + '</span>' +
      (cu.gapAfterCuts > 0
        ? '<span class="hint">' + tr('Essentials alone are short by {amount}, and cuts don’t close that. Before touching what you protect: use the emergency fund, ask a lender to move a due date, or ask for money owed to you (Runway shows these). If you choose to cut a protected one, that’s your call.', { amount: inr(cu.gapAfterCuts) }) + '</span>'
        : '<span class="hint">' + tr('Your payments and essentials are covered without touching them.') + '</span>') + '</div>';
  }

  // Runway → Monthly review: the diagnosis report. The app's numbers (health check, what-ifs, ladder) always;
  // the AI's verdict, causes, plan and checks once a round, with the weekly plan on.
  function reviewCard() {
    const t = today();
    const rv = Core.monthlyReview(state, t);
    const L = rv.ladder;
    const line = (name, val) => '<div class="line"><span>' + name + '</span><span>' + val + '</span></div>';
    const monthYear = (iso) => monthName(Core.parseISO(iso).getMonth()) + ' ' + Core.parseISO(iso).getFullYear();
    // The month's AI review, kept from the plan that wrote it (older apps kept it only in the weekly plan).
    const wp = state.weeklyPlan;
    const ar = state.aiReview && state.aiReview.round === rv.round ? state.aiReview
      : wp && wp.plan && wp.made >= rv.round && wp.plan.diagnosis ? { made: wp.made, diagnosis: wp.plan.diagnosis, sections: wp.plan.sections || [] } : null;
    const dg = ar ? ar.diagnosis : null;
    const dir = ar ? (ar.sections || []).find((s) => s.kind === 'direction') : null;
    const adv = ar ? (ar.sections || []).find((s) => s.kind === 'advisor') : null;
    let html = '<section class="card review"><div class="card-head">' + titled('Monthly review', 'review') + '<span class="hint">' + tr('Since payday, {date}', { date: fmtDate(rv.round) }) + '</span></div>' +
      '<p class="hint">' + (ar ? tr('Your numbers below update every day. The AI review was written once for this month, on {date}.', { date: fmtDate(ar.made) })
        : tr('Your numbers below update every day. The AI review is written once a month, with the first plan after payday.')) + '</p>';
    if (dg && dg.verdict) html += '<p class="plan-headline">' + esc(dg.verdict) + '</p>';
    html += '<h3>' + tr('Health check') + '</h3>' + healthRows(Core.healthCheck(state, t));
    if (dg && dg.causes.length) html += '<h3>' + tr('What’s behind it') + '</h3>' + dg.causes.map((c) => '<div class="cause"><b>' + esc(c.title) + '</b><p>' + esc(c.text) + '</p></div>').join('');
    const fe = Core.feasibility(state, t);
    html += '<h3>' + tr('Until payday') + '</h3><div class="callout' + (fe.status === 'short' ? ' bad' : fe.status === 'tight' ? ' warn' : '') + '"><b>' + (fe.status === 'short'
      ? tr('Short by {amount}, even on essentials only', { amount: inr(fe.shortBy) })
      : fe.status === 'tight' ? tr('Essentials covered, with {amount} to spare', { amount: inr(fe.spare) }) : tr('Essentials covered, with {amount} to spare', { amount: inr(fe.spare) })) + '</b>' +
      '<span class="hint">' + tr('{available} after EMIs, bills and promises still due; essentials need about {essentials} ({daily} a day for {days} days).',
        { available: inr(fe.available), essentials: inr(fe.essentials), daily: inr(fe.essentialsDaily), days: fe.days }) +
      (fe.status === 'short' ? ' ' + tr('Nothing goes aside this round: closing the gap comes first.') : '') + '</span></div>';
    html += cutsBox(Core.cutOptions(state, t));
    const wi = Core.whatIf(state, t);
    const rm = wi.room;
    html += '<h3>' + tr('What your pay can spare') + '</h3><div class="summary">' +
      line(tr('Pay'), inr(rm.salary)) + line(tr('Fixed payments, EMIs and bills'), '−' + inr(rm.committed)) +
      line(tr(rm.source === 'history' ? 'Usual spending (last 8 weeks)' : 'Usual spending (your budgets)'), '−' + inr(rm.usual)) +
      line('<b>' + tr('Left each month') + '</b>', '<b>' + inr(rm.roomNow) + '</b>') +
      (rm.trim ? line(tr('Trimming a fifth of non-essential spending'), '+' + inr(rm.trim)) : '') + '</div>' +
      '<p class="hint">' + (rm.affordable > 0 ? tr('So the plan asks for {amount} a month, never more.', { amount: inr(rm.affordable) }) : tr('So the plan doesn’t ask for a monthly saving: your pay can’t spare one yet.')) +
      (rm.extra ? ' ' + tr('Extra pay this round: {amount}.', { amount: inr(rm.extra) }) : '') + '</p>';
    html += whatIfTable(wi, fe);
    if (dg && dg.actions.length) {
      html += '<h3>' + tr('The plan') + '</h3><ol class="plan-steps">' + dg.actions.map((a) => '<li><b>' + esc(a.action) + '</b>' +
        '<span class="hint">' + [a.how_much ? inr(a.how_much) : '', esc(a.by_when)].filter(Boolean).join(' · ') + '</span>' + (a.changes ? '<span>' + esc(a.changes) + '</span>' : '') + '</li>').join('') + '</ol>';
    } else if (dir) html += '<div class="plan-sec plan-direction"><h3>' + esc(dir.title) + '</h3>' + planSteps(dir) + '</div>';
    html += '<h3>' + tr('Your step on the money ladder') + '</h3><ol class="ladder">' + L.steps.map((s) => '<li class="' + (s.current ? 'current' : s.done ? 'done' : '') + '"><b>' + (s.done ? '✓ ' : '') + tr(LADDER[s.key][0]) + '</b>' +
      (s.current ? '<span class="hint">' + tr(LADDER[s.key][1]) + '</span><span>' + ladderMilestone(L.milestone) + '</span>' : '') + '</li>').join('') + '</ol>';
    if (adv) {
      html += '<div class="plan-sec plan-advisor"><h3><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + HUB_ICONS.chat + '</svg>' + tr('Adviser’s view') + '</h3>' +
        '<ol class="plan-steps">' + adv.steps.map((st) => '<li><b>' + esc(st.action) + '</b>' + (st.why ? '<span class="hint">' + esc(st.why) + '</span>' : '') +
          '<span class="chip' + (st.basis === 'general' ? ' warn' : '') + '">' + tr(st.basis === 'general' ? 'General guidance: please check' : 'From your numbers') + '</span></li>').join('') + '</ol></div>';
    }
    if (dg && dg.checks.length) html += '<h3>' + tr('Next month we’ll check') + '</h3><ul class="checks">' + dg.checks.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    if (dg || dir || adv) {
      html += '<div class="callout warn"><b>' + tr('Made by AI. It can be wrong or out of date.') + '</b><span class="hint">' +
        tr('The health check, the numbers and your step are worked out by the app. The rest is written by AI from them: general guidance, not personal financial advice. Check before acting; for investing, talk to a SEBI-registered investment adviser.') + '</span></div>';
    }
    const RATE_LABELS = { repo_rate: 'RBI repo rate', cpi_inflation: 'Retail inflation (CPI)', ppf: 'PPF', ssy: 'Sukanya Samriddhi', scss: 'Senior Citizens’ Savings Scheme', nsc: 'NSC', po_savings: 'Post office savings account' };
    const rates = state.rates && (state.rates.figures || []).filter((x) => RATE_LABELS[x.key]);
    if (rates && rates.length) {
      const site = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
      html += '<h3>' + tr('Official figures') + '</h3><div class="summary">' + rates.map((x) => line(tr(RATE_LABELS[x.key]) + '<span class="hint"> · ' + esc(x.period) + ' · <a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(site(x.url)) + '</a></span>', x.value + '%')).join('') + '</div>' +
        '<p class="hint">' + tr('Found on government sites on {date}. Rates change: check the source before you decide.', { date: fmtDate(state.rates.fetched, true) }) + '</p>';
    }
    html += '<h3>' + tr('The long run') + '</h3><div class="summary">' +
      (rv.debtFree ? line(tr('Debt-free with your plan'), rv.debtFree.plan ? monthYear(rv.debtFree.plan) : tr('Not at these payments')) +
        (rv.debtFree.moved ? line(tr('Since last payday'), '<span class="' + (rv.debtFree.moved < 0 ? 'good' : 'warn') + '">' +
          tr(rv.debtFree.moved < 0 ? '{n} months sooner' : '{n} months later', { n: Math.abs(rv.debtFree.moved) }) + '</span>') : '') : '') +
      (rv.worthChange !== null ? line(tr('Net worth over {n} rounds', { n: rv.worth.length }), '<span class="' + (rv.worthChange >= 0 ? 'good' : 'warn') + '">' + (rv.worthChange >= 0 ? '+' : '−') + inr(Math.abs(rv.worthChange)) + '</span>') : '') +
      (rv.fund ? line(tr('Emergency fund'), tr('{months} of {target} months', { months: rv.fund.months, target: rv.fund.target })) : '') +
      rv.goals.map((g) => line(esc(g.name), g.done ? tr('Reached ✓') : inr(g.saved) + ' / ' + inr(g.target))).join('') + '</div>';
    if (!dg && aiCfg().on) html += '<p class="hint">' + tr('Your first weekly plan after payday adds the diagnosis: what’s behind these numbers, a plan, and what to check next month.') + '</p>';
    else if (!aiCfg().on) html += '<p class="hint">' + tr('Turn on the weekly plan for the full diagnosis: what’s behind these numbers, a plan, and what to check next month.') + '</p>';
    return html + '</section>';
  }

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
    return '<ol class="plan-steps">' + sec.steps.map((st) => '<li><b>' + esc(st.action) + '</b>' + (st.why ? '<span class="hint">' + esc(st.why) + '</span>' : '') +
      (st.protect ? '<span class="protect-note">🛡 ' + tr('This touches {name}, which you protect. The app’s own cuts leave it alone: your call.', { name: esc(protectLabel(st.protect)) }) + '</span>' : '') + '</li>').join('') + '</ol>';
  }

  // The last 4 weeks, week by week: worked out by the app, with or without the AI.
  function weekTrendCard() {
    const tw = Core.weekTrend(state, today(), 4);
    if (!tw.weeks.some((w) => !w.quiet)) return '';
    const goalCell = (w) => !w.goal || w.goal.met === null ? '–' : w.goal.met ? '✓' : '✗';
    const vals = (x) => x.values.map(inr).join(' → ');
    return '<section class="card"><div class="card-head"><h2>' + tr('Last 4 weeks') + '</h2></div>' +
      '<div class="table-wrap"><table><thead><tr>' + [tr('Week of'), tr('Spent'), tr('Days within limit'), tr('Goal')].map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        tw.weeks.map((w) => '<tr>' + [fmtDate(w.from), w.quiet ? tr('Hardly recorded') : inr(w.spent), w.quiet || !(w.won + w.over) ? '–' : w.won + '/' + (w.won + w.over), goalCell(w)]
          .map((c, i) => '<td' + (i ? ' class="amt"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      tw.rising.map((x) => '<p class="warn">' + tr('{name} up three weeks in a row: {values}', { name: esc(label(x.name)), values: vals(x) }) + '</p>').join('') +
      tw.falling.map((x) => '<p class="good">' + tr('{name} down three weeks in a row: {values}', { name: esc(label(x.name)), values: vals(x) }) + '</p>').join('') +
      (tw.streak.count >= 2 ? '<p class="hint">' + tr(tw.streak.kind === 'met' ? 'Weekly goals met {n} weeks in a row: this week’s is a little harder.' : 'Weekly goals missed {n} weeks in a row: this week’s is easier, so you can win it.', { n: tw.streak.count }) + '</p>' : '') +
      '</section>';
  }

  function planCard() {
    return planCardInner() + weekTrendCard();
  }

  function planCardInner() {
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
      p.sections.filter((sec) => (sec.kind !== 'invest' || ready) && sec.kind !== 'direction' && sec.kind !== 'advisor').forEach((sec) => {
        html += '<div class="plan-sec plan-' + sec.kind + '"><h3><svg viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true">' + HUB_ICONS[PLAN_ICONS[sec.kind]] + '</svg>' + esc(sec.title) + '</h3>' + planSteps(sec) +
          (sec.kind === 'fraud' ? fraudBox() : '') +
          (sec.kind === 'invest' ? '<div class="callout warn"><b>' + tr('General information, not advice') + '</b><span class="hint">' + tr('Before investing, talk to a SEBI-registered investment adviser. Every investment can lose value, and the decision is yours.') + '</span></div>' : '') +
          '</div>';
      });
      if (!p.sections.some((sec) => sec.kind === 'fraud')) html += fraudBox();
      html += '<p class="hint">' + tr('Made by AI on {date} from your numbers. It can be wrong: the app’s own numbers are the ones to trust.', { date: fmtDate(wp.made) }) +
        (p.numbersDropped ? ' ' + tr(p.numbersDropped === 1 ? '1 line was left out: its amount didn’t match your numbers.' : '{n} lines were left out: their amounts didn’t match your numbers.', { n: p.numbersDropped }) : '') + '</p>';
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
      '<span class="hint">' + tr('A summary the app has already worked out: today’s limit, zone, spending by category this week and usually, budgets, bills to come, costs that may come, past rounds, your loans, cards, goals and what you protect by the names you gave them, and how many payments look unusual.') + '</span>' +
      '<b>' + tr('Never sent') + '</b><span class="hint">' + tr('SMS text, shop names, notes, account or card numbers.') + '</span>' +
      '<b>' + tr('Once a month') + '</b><span class="hint">' + tr('The server looks up official rates (RBI, inflation, PPF and small savings) on government sites. That request carries nothing about you.') + '</span>' +
      '<b>' + tr('Where it goes') + '</b><span class="hint">' + tr('To your app’s server, which keeps nothing, and on to Anthropic to write the plan. Anthropic doesn’t use it to train its models.') + '</span>' +
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

  /*
   * Official rates, once a month with the monthly review: the server searches
   * government sites only. Nothing about the person is sent. A failure just
   * means the plan goes without them.
   */
  function fetchRates(cfg) {
    const round = Core.cycleFor(today(), Number(state.settings.payday) || 1).start;
    const fresh = state.rates && state.rates.fetched && Core.daysBetween(state.rates.fetched, today()) < 25;
    if (fresh || (state.reviewDone && state.reviewDone >= round)) return Promise.resolve();
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 90000);
    return fetch(cfg.url + '/rates', { method: 'POST', headers: { 'X-Invite-Code': cfg.code }, signal: ctl ? ctl.signal : undefined })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (body && Array.isArray(body.rates) && body.rates.length) state.rates = { fetched: body.fetched || today(), figures: body.rates }; })
      .catch(() => {})
      .then(() => clearTimeout(timer));
  }

  // The week's goal in the app's words, when its amount had to be set to the week's target.
  function weekGoalText(g) {
    if (g.type === 'no_card') return tr('No credit card for daily spending this week.');
    if (g.type === 'save') return tr('Move {amount} to savings this week.', { amount: inr(g.amount) });
    if (g.type === 'extra_loan') return tr('Pay {amount} extra on loans this week.', { amount: inr(g.amount) });
    return tr('Keep this week’s spending under {amount}.', { amount: inr(g.amount) });
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
    // The monthly review is asked for at most twice a round (a server that doesn't write it isn't asked every time).
    const round = Core.cycleFor(t, Number(state.settings.payday) || 1).start;
    if (!(state.reviewDone >= round)) state.reviewAsked = { round, n: (state.reviewAsked && state.reviewAsked.round === round ? state.reviewAsked.n : 0) + 1 };
    rerenderKeepScroll();
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 120000);
    let facts = '';
    const done = (plan, error) => {
      clearTimeout(timer);
      ui.planBusy = false;
      if (plan) {
        // No bank, fund, insurer or app names in what's kept, whatever the AI wrote.
        plan = Core.cleanAdvice(plan, state);
        // Every rupee amount must come from the numbers sent; a line with another one is left out.
        const checked = Core.checkAdviceNumbers(plan, facts);
        // A step that touches something you protect says so.
        // No extra on loans when the app's plan doesn't put money there this round.
        const loans = Core.guardExtraLoans(checked.plan, state, t);
        plan = Object.assign({}, Core.markProtected(loans.plan, state), { numbersDropped: checked.dropped + loans.dropped });
        // The week's goal uses the week's target the app worked out from the month's plan.
        const fit = Core.fitWeekGoal(plan.week_goal, Core.weekTarget(state, t));
        plan.week_goal = fit.changed ? Object.assign(fit.goal, { text: weekGoalText(fit.goal) }) : fit.goal;
        // A finished week's goal is kept (8 weeks), so the trend can say how goals went.
        if (prev && prev.goal && prev.week < week) state.goalHistory = (state.goalHistory || []).filter((g) => g.week !== prev.goal.week).concat(prev.goal).slice(-8);
        // The round's diagnosis: the review is done, and its checks are followed up next month.
        const round = Core.cycleFor(t, Number(state.settings.payday) || 1).start;
        if (plan.diagnosis || (plan.sections || []).some((s) => s.kind === 'direction')) {
          state.reviewDone = round;
          // The month's review is kept on its own until next payday: next week's plan doesn't replace it.
          state.aiReview = { round, made: t, diagnosis: plan.diagnosis || null, sections: (plan.sections || []).filter((x) => x.kind === 'advisor' || x.kind === 'direction') };
        }
        if (plan.diagnosis && (plan.diagnosis.checks || []).length) state.reviewChecks = { round, checks: plan.diagnosis.checks };
        state.weeklyPlan = { week, made: t, plan, goal: Object.assign({}, plan.week_goal, { week }), lastGoal: lastGoal || null,
          lastResult: lastGoal ? Core.goalResult(state, lastGoal) : null, seen: false };
        save(true);
      } else ui.planError = error;
      rerenderKeepScroll();
    };
    fetchRates(cfg).then(() => { facts = Core.planFacts(state, t, lastGoal); }).then(() => fetch(cfg.url + '/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Invite-Code': cfg.code },
      body: JSON.stringify({ facts, language: AI_LANG[I18N.getLang()] || 'English' }),
      signal: ctl ? ctl.signal : undefined,
    })).then((res) => res.json().catch(() => ({})).then((body) => ({ status: res.status, body }))).then(({ status, body }) => {
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
    ['good', '<b>No account, no ads, no analytics.</b>'],
    ['crash', ''],
    ['good', '<b>Bank SMS</b> are read only when you tap Read bank SMS or turn on alerts. Messages from phone numbers (friends, family) are skipped before the app sees them. Only a payment’s amount, date and shop are saved, never the message.'],
    ['good', '<b>Your data stays on this phone</b>, in the app’s private storage. Android’s cloud backup is off for Hisab Se, so not even Google gets a copy.'],
    ['good', '<b>Something leaves the phone only when you choose:</b> a backup file you share, a problem report you send, crash reports if you said yes, or the weekly summary for your AI plan.'],
    ['warn', '<b>If the phone is lost, reset, or the app is uninstalled, your data goes with it,</b> unless you have a backup file.'],
  ];

  function privacyCard() {
    const crash = crashCfg().on === true;
    const item = (x) => {
      if (x[0] === 'crash') {
        return '<li class="pv-good"><span>' + tr(crash
          ? '<b>Crash reports are on.</b> When the app hits an error, the error, the screen and the phone model go to the developer. Never your amounts, payments, names or SMS, and nothing that says who you are.'
          : '<b>Crash reports are off.</b> Errors stay on this phone, in the app’s log, until you send a problem report yourself.') + '</span></li>';
      }
      if (x[0] === 'ai') {
        return aiCfg().on
          ? '<li class="pv-warn"><span>' + tr('<b>The AI weekly plan is on.</b> Once a week, a summary of your numbers goes to your app’s server and on to Anthropic (Claude) to write your plan. SMS text, shop names, notes and account numbers are never sent.') + '</span></li>'
          : crash ? '<li class="pv-good"><span>' + tr('<b>Nothing about your money is sent.</b> The AI weekly plan is off. Turn on airplane mode: everything still works.') + '</span></li>'
            : '<li class="pv-good"><span>' + tr('<b>Nothing is sent anywhere.</b> The AI weekly plan is off, so the app never connects to the internet. Turn on airplane mode: everything still works.') + '</span></li>';
      }
      return '<li class="pv-' + x[0] + '"><span>' + tr(x[1]) + '</span></li>';
    };
    let sample = '';
    if (ui.crashSample) { try { sample = JSON.stringify(crashOf('TypeError: Cannot read properties of undefined (reading \'amount\')', 'app.js:1200:15', 'TypeError: …\n    at render (app.js:1200:15)'), null, 1); } catch (e) { sample = ''; } }
    return '<section class="card privacy-card">' + titled('Your privacy', 'privacy') +
      '<ul class="privacy-list">' + PRIVACY.map(item).join('') + '</ul>' +
      '<div class="callout"><b>' + tr('Crash reports') + '</b>' +
      '<span class="hint">' + tr('Sent by themselves after an error, only if you say yes: what went wrong and where in the app, the screens you opened, the phone model, the app’s build and how many entries you have. They are kept for 90 days, then deleted, and only the developer can read them.') + '</span>' +
      '<div class="row">' + (crash
        ? '<button data-action="crash-no">' + tr('Turn off crash reports') + '</button>'
        : '<button data-action="crash-yes">' + tr('Turn on crash reports') + '</button>') +
      '<button class="link" data-action="crash-sample">' + tr(ui.crashSample ? 'Hide the example' : 'See an example report') + '</button></div>' +
      (ui.crashSample ? '<pre class="ai-facts report-preview">' + esc(sample) + '</pre>' : '') + '</div>' +
      '<p class="hint">' + tr('Questions about your data: write to the developer at the e-mail on the app’s Google Play page.') + '</p></section>';
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
  // Asked once, after setup: both answers are one tap, and either can be changed in Profile → Privacy.
  function crashAsk() {
    if (state.isDemo || !state.settings.salary || crashCfg().on !== null) return '';
    return '<div class="callout crash-ask"><b>' + tr('Help fix crashes?') + '</b>' +
      '<span class="hint">' + tr('If the app hits an error, it can send the developer what went wrong: the error, the screen and the phone model. Never your amounts, payments, names or SMS. You can change this any time in Profile → Privacy.') + '</span>' +
      '<div class="row"><button data-action="crash-yes">' + tr('Send crash reports') + '</button><button data-action="crash-no">' + tr('Don’t send') + '</button></div></div>';
  }

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
    let preview = '';
    if (f.preview) { try { preview = problemReport(f.note || '', !!f.withData); } catch (e) { preview = tr('Couldn’t make the report. Try again.'); } }
    return '<section class="card"><h2>' + tr('Report a problem') + '</h2>' +
      '<p class="hint">' + tr('Something wrong or confusing? Make a report file and send it to the developer. Nothing is sent by itself.') + '</p>' +
      '<label class="field" for="report-note"><span>' + tr('What went wrong, and what did you expect?') + '</span>' +
      '<textarea id="report-note" rows="4" placeholder="' + esc(tr('Today’s limit shows ₹0, but I have money in my account')) + '">' + esc(f.note || '') + '</textarea></label>' +
      '<span class="hint">' + tr('Please don’t write names or account numbers here.') + '</span>' +
      '<div class="callout"><b>' + tr('What the report holds') + '</b>' +
      '<span class="hint">' + tr('<b>Always:</b> the errors the app hit, where in the app, the screens you opened, the phone model and how many entries you have. Never your amounts, payments, names, notes or SMS.') + '</span>' +
      '<label class="check-row" for="report-data"><input id="report-data" type="checkbox"' + (f.withData ? ' checked' : '') + '> <span>' +
      tr('<b>Add my numbers, names hidden</b> (for a wrong amount or limit): the amounts and dates of your payments, loans and budgets, so the developer sees the same numbers you do. Every shop, person, account and note becomes a random code; no SMS text, account digits or times of day.') + '</span></label>' +
      '<div><button class="link" data-action="report-preview">' + tr(f.preview ? 'Hide what’s inside' : 'See exactly what’s inside') + '</button></div>' +
      (f.preview ? '<pre class="ai-facts report-preview">' + esc(preview) + '</pre>' : '') + '</div>' +
      (f.error ? '<p class="bad" role="alert">' + esc(f.error) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="report-save">' + tr('Save report file') + '</button>' +
      '<button data-action="report-share">' + tr('Share report') + '</button></div>' +
      (log.length ? '<div class="row"><button class="link" data-action="report-clear">' + tr('Clear the log') + '</button></div>' : '') + '</section>';
  }

  /*
   * The problem report. Always: the errors (their text cleaned of names,
   * numbers and UPI ids), the screens, the phone and how many entries of each
   * kind. withData: also the app's data and log with every name a random
   * stand-in (Core.pseudonymize), so the developer's copy works out the same
   * numbers; no SMS text, account digits or times of day.
   */
  function problemReport(note, withData) {
    const t = today();
    const log = logRead();
    const { known, words } = Core.privateWords(state);
    const clean = (e) => Object.assign({}, e, { message: Core.scrubText(e.message, words, 300), where: Core.scrubText(e.where, known, 120),
      stack: String(e.stack || '').split('\n').map((l) => Core.scrubText(l, /^\s+at\s/.test(l) ? known : words, 300)).join('\n') });
    const errors = log.filter((x) => x.kind === 'error').slice(-10);
    const last = errors[errors.length - 1] || {};
    const crash = crashOf(last.message || '', last.where || '', last.stack || '');
    const head = { kind: 'hisab-problem-report', version: 2, level: withData ? 'numbers' : 'errors', made: t, today: t, build: BUILD || 'browser',
      android: crash.android, model: crash.model, screen: crash.screen, lang: I18N.getLang(), theme: themeChoice() || 'phone', lock: !!lockCfg().on, ai: !!aiCfg().on,
      note: Core.scrubText(note, words, 1000, withData) };
    if (!withData) {
      return JSON.stringify(Object.assign(head, { errors: errors.map((e) => Object.assign({ day: String(e.at || '').slice(0, 10), tab: e.tab || null, page: e.page || null }, clean({ message: e.message, where: e.where, stack: e.stack }))),
        screens: crash.screens, counts: crash.counts }), null, 1);
    }
    let numbers;
    try {
      const r = Core.projectRunway(state, t);
      const z = Core.zoneStatus(state, t, r);
      numbers = { limit: Math.round(r.dailyAllowance), parts: r.limit, balance: r.balanceToday, zone: z.zone, endPace: Math.round(r.endPace), plan: r.plan };
    } catch (e) { numbers = { error: String(e && e.message), stack: String(e && e.stack).slice(0, 1500) }; }
    const hidden = Core.pseudonymize({ numbers, log: log.map((e) => (e.kind === 'error' ? clean(e) : e)), state },
      INCOME_CATEGORIES.concat(BUILT_IN_CATEGORIES, EARNED_PICK, OTHER_IN_PICK, LOAN_CATEGORY));
    return JSON.stringify(Object.assign(head, hidden), null, 1);
  }

  function makeReport(how) {
    const note = ((document.getElementById('report-note') || {}).value || '').trim();
    const withData = !!(document.getElementById('report-data') || {}).checked;
    ui.reportForm = { note, withData };
    const t = today();
    const name = 'HisabSe-report-' + t + '.json';
    let text;
    try { text = problemReport(note, withData); } catch (e) { ui.reportForm.error = tr('Couldn’t make the report. Try again.'); render(); return; }
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
    // Nothing changes until the backup has opened and been checked in full.
    Core.openBackup(text, pass).then((data) => {
      const fresh = emptyState();
      const next = migrate(Object.assign(fresh, data, { savings: data.savings || fresh.savings, budgets: data.budgets || fresh.budgets }));
      state = next;
      if (r.info && r.info.date) state.lastBackup = r.info.date;
      ui.restore = null;
      save();
      toast(tr('Backup restored'));
      setTab('home');
    }).catch((e) => {
      ui.restore = Object.assign({}, r, { error: e && e.message === 'password'
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

  /*
   * An EMI booking read from SMS for this card: offered once, pre-filled,
   * unless it's finished or an EMI like it is already in Debts.
   */
  function emiOfferFor(c) {
    const t = today();
    return (state.emiOffers || []).filter((x) => !x.done && x.last4 === c.last4).map((x) => ({ offer: x, plan: Core.cardEmiFromBooking(c, x, t) }))
      // Already in Debts (linked to the card, or named like a card EMI) with about this EMI: not offered again.
      .filter((x) => x.plan.left > 0 && !state.debts.some((d) => (d.viaCard === c.id || (!d.viaCard && Core.looksLikeCardBill(d.name))) && d.balance > 0 &&
        Math.abs((Number(d.minPayment) || 0) - x.plan.emi) <= x.plan.emi * 0.1))[0] || null;
  }
  function emiOfferBox(c) {
    const o = emiOfferFor(c);
    if (!o || ui.cardEmi === c.id) return '';
    return '<div class="callout"><b>' + tr('An EMI booked on {date}: {amount} in {months} EMIs', { date: fmtDate(o.offer.date), amount: inr(o.offer.amount), months: o.offer.months }) + '</b>' +
      '<span class="hint">' + tr('From your bank’s SMS. If it went through, add it so its EMIs count once a month: about {emi}, {left} left.', { emi: inr(o.plan.emi), left: o.plan.left }) + '</span>' +
      '<div class="row"><button class="primary" data-action="emi-offer-add" data-id="' + esc(c.id) + '" data-key="' + esc(o.offer.key) + '">' + tr('Check and add') + '</button>' +
      '<button class="ghost" data-action="emi-offer-no" data-key="' + esc(o.offer.key) + '">' + tr('It didn’t go through') + '</button></div></div>';
  }

  // An EMI already running on the card: a bill converted before it was added here.
  // "· last EMI Feb 2031 (52 left)", worked out from what's owed, the rate and the EMI.
  function loanEndText(d) {
    const e = Core.loanEnd(state, d, today());
    if (!e) return '';
    if (e.never) return ' · <span class="bad">' + tr('The EMI doesn’t cover the {amount} interest a month, so it never ends. Check the balance and EMI.', { amount: inr(e.interest) }) + '</span>';
    return ' · ' + tr(e.left === 1 ? 'last EMI {date}' : 'last EMI {date} ({n} left)', { date: monthYear(e.last), n: e.left });
  }

  function cardEmiForm(c) {
    const emis = state.debts.filter((d) => d.viaCard === c.id && d.balance > 0);
    const list = emis.map((d) => '<div class="line"><span>' + esc(d.name) + '</span><span>' + tr('{amount} a month', { amount: inr(d.minPayment) }) +
      loanEndText(d) + '</span></div>').join('');
    if (ui.cardEmi !== c.id) {
      return (list ? '<div class="summary">' + list + '</div>' : '') +
        '<div class="row"><button class="link" data-action="card-emi-open" data-id="' + esc(c.id) + '">' + tr('Add an EMI already on this card') + '</button></div>';
    }
    const f = (id, name, val, extra) => '<label class="field" for="' + id + '"><span>' + tr(name) + '</span><input id="' + id + '" type="number" inputmode="decimal" min="0" value="' + esc(val) + '"' + (extra || '') + '></label>';
    // Filled in from the bank's SMS: check the EMI against the card statement.
    const pre = ui.cardEmiPrefill || {};
    return (list ? '<div class="summary">' + list + '</div>' : '') +
      '<div class="callout"><b>' + tr('An EMI on {card}', { card: c.name }) + '</b>' +
      '<span class="hint">' + tr('A bill you turned into an EMI. It comes off once a month on the card’s due date, and the app ends it after the last one.') + '</span>' +
      (pre.key ? '<span class="hint">' + tr('Filled in from the SMS. Check the EMI on your card statement: banks work it out a little differently.') + '</span>' : '') +
      '<div class="form-grid">' + f('ce-emi', 'EMI each month (₹)', pre.emi || '') + f('ce-left', 'EMIs left to pay', pre.left || '', ' max="120"') + f('ce-rate', 'Interest %/yr', pre.rate !== undefined ? pre.rate : '22', ' step="any"') + '</div>' +
      (ui.cardEmiError ? '<p class="bad" role="alert">' + esc(ui.cardEmiError) + '</p>' : '') +
      '<div class="row"><button class="primary" data-action="card-emi-save" data-id="' + esc(c.id) + '">' + tr('Add EMI') + '</button>' +
      '<button class="ghost" data-action="card-emi-cancel">' + tr('Cancel') + '</button></div></div>';
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
    // Added with the bill before last: ask for the latest one, or it's missed.
    const lastSt = Core.statementOn(c, c.created || t);
    if (!st.statementDate && c.setupDueDate && c.setupDueDate <= lastSt && !c.statement) {
      html += '<div class="callout warn"><b>' + tr('What’s due on your {date} statement?', { date: fmtDate(lastSt) }) + '</b>' +
        '<span class="hint">' + tr('The bill above is the one before it. Enter the {date} bill, due {due}, so it isn’t missed. Include any EMI billed on the card.', { date: fmtDate(lastSt), due: fmtDate(Core.dueAfter(c, lastSt)) }) + '</span>' +
        '<div class="row"><label class="field" for="card-latest-' + esc(c.id) + '"><span>' + tr('Amount due (₹)') + '</span><input id="card-latest-' + esc(c.id) + '" type="number" inputmode="numeric" min="0"></label>' +
        '<button class="primary" data-action="card-latest" data-id="' + esc(c.id) + '">' + tr('Save') + '</button></div></div>';
    } else if (st.remaining && st.daysToDue <= 0 && c.answered !== st.due) {
      html += cardDueQuestion(c, st);
    } else if (st.remaining) {
      html += '<div class="row"><button class="primary" data-action="card-plan" data-id="' + esc(c.id) + '">' + tr(ui.cardPlan && ui.cardPlan.cardId === c.id ? 'Hide payment plan' : 'Plan this payment') + '</button></div>';
    }
    if (ui.cardPlan && ui.cardPlan.cardId === c.id && st.remaining) html += '<div id="card-plan">' + cardPlanPanel(c) + '</div>';
    html += emiOfferBox(c) + cardEmiForm(c);
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
        listField('debts', d, 'dueDay', 'Due day', 'number', ' max="31"') + removeButton('debts', d) + '</div>' + loanViaCard(d)).join('') + '</div>' +
      '<div><button data-action="list-add" data-list="debts">' + tr('Add loan') + '</button></div>' +
      (debts.length ? '<div class="list">' + debts.map((d) => {
        const i = (d.balance * d.rate) / 1200;
        return '<div class="list-item"><div class="grow"><div class="title">' + esc(d.name) + '</div><div class="meta">' + tr('{rate}% a year', { rate: d.rate }) + loanEndText(d) + '</div></div>' +
          '<div class="amt ' + (d.rate >= 15 ? 'bad' : '') + '">' + tr('{amount} interest/month', { amount: inr(i) }) + '</div></div>';
      }).join('') + '</div>' : '') +
      '</section>';
    const noDebts = !state.debts.some((d) => Number(d.balance) > 0) && !(state.cards || []).length;
    // Loans added from an EMI payment: what's left to pay and the rate are still needed.
    const fromEmi = (state.debts || []).filter((d) => d.fromEmi && !(Number(d.balance) > 0));
    return hub('debts',
      rolloverCard() +
      fromEmi.map((d) => '<div class="callout warn"><b>' + tr('{name}: add what’s left to pay and its rate', { name: esc(d.name) }) + '</b><span class="hint">' +
        tr('Added from its {amount} EMI on {date}. Until then it isn’t in your debt-free date. Edit it under Loans below.', { amount: inr(d.minPayment), date: fmtDate(d.fromEmi) }) + '</span></div>').join('') +
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
        { key: 'people', group: 'Your loans', icon: 'people', label: 'People', tone: 'coral',
          badge: (() => { const p = Core.iouSummary(state, t); return p.late.length ? { text: tr('{n} late', { n: p.late.length }), tone: 'bad' } : p.owe.length || p.lent.length ? { text: p.net === 0 ? tr('Even') : (p.net > 0 ? '+' : '−') + shortInr(Math.abs(p.net)) } : null; })(),
          html: () => peopleCard() },
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
      keptCard(), [
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

  document.addEventListener('input', (ev) => { if (ev.target.closest && ev.target.closest('.ea-form')) eventPreview(); });
  document.addEventListener('change', (ev) => { if (ev.target.closest && ev.target.closest('.ea-form')) eventPreview(); });

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
      case 'feature-on': {
        const f = featuresState();
        f.on[btn.dataset.tab + ':' + btn.dataset.key] = true;
        save();
        openPage(btn.dataset.tab, btn.dataset.key);
        return;
      }
      case 'features-all': {
        try { localStorage.setItem(ALL_FEATURES_KEY, showAllFeatures() ? '0' : '1'); } catch (e) { /* private mode */ }
        toast(tr(showAllFeatures() ? 'Every page shows now.' : 'Pages show when you need them.'));
        break;
      }
      case 'page-open':
        // Opened once: no longer "New".
        if (state.features && WHEN_NEEDED[(btn.dataset.tab || tab) + ':' + btn.dataset.key]) {
          const k = (btn.dataset.tab || tab) + ':' + btn.dataset.key;
          if (state.features.seen.indexOf(k) === -1) { state.features.seen.push(k); save(true); }
        }
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
        if (!x || !(x.matched || x.matchedIn)) return;
        const before = JSON.stringify(state);
        // A move joined to both banks' SMS: both go back as their own entries.
        if (x.matchedIn) {
          const m = x.matchedIn;
          state.transactions.push({ id: uid(), kind: 'in', date: m.date, amount: x.amount, category: 'Money received', note: m.merchant, source: m.source || 'sms', smsKey: x.smsKeyIn, wallet: m.wallet || undefined, useFor: null });
          delete x.smsKeyIn; delete x.matchedIn;
        }
        const m = x.matched;
        if (!m) { ui.editTx = null; save(); rerenderKeepScroll(); offerUndo(tr('Added the SMS as its own payment'), before); return; }
        const tx = { id: uid(), date: m.date, amount: x.amount, note: m.merchant, source: m.source || 'sms', smsKey: x.smsKey };
        if (m.transfer) Object.assign(tx, { kind: 'transfer', from: m.transfer.from, to: m.transfer.to });
        else if (m.type === 'credit') Object.assign(tx, { kind: 'in', category: 'Money received', useFor: null });
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
        const last = (state.accuracy || []).slice(-1)[0];
        if (last && last.date === today()) last.noted = true;
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
      case 'setup-basics': state.onboarding = { step: state.settings.salary ? 2 : 1 }; ui.onboardHidden = false; ui.onboardFocus = true; save(); break;
      case 'setup-fixed': {
        const before = Core.projectRunway(state, t).dailyAllowance;
        const rent = Math.round(Number(obValue('su-rent')) || 0);
        const day = Math.min(31, Math.max(1, Math.round(Number(obValue('su-rent-day')) || 1)));
        const other = Math.round(Number(obValue('su-other')) || 0);
        if (!(rent > 0) && !(other > 0)) { toast(tr('Enter your rent or another fixed payment, or tap “I don’t pay rent or fixed payments”.')); return; }
        if (rent > 0) state.fixed.push({ id: uid(), name: tr('Rent'), amount: rent, dueDay: day, fromSetup: true });
        if (other > 0) state.fixed.push({ id: uid(), name: tr('Other fixed payments'), amount: other, dueDay: 1, fromSetup: true });
        setupDone('fixed', before);
        break;
      }
      case 'setup-loan': {
        const before = Core.projectRunway(state, t).dailyAllowance;
        const emi = Math.round(Number(obValue('su-emi')) || 0);
        const left = Math.round(Number(obValue('su-left')) || 0);
        if (!(emi > 0) || !(left > 0)) { toast(tr('Enter the EMI and roughly what’s left to pay, or tap “No loans or EMIs”.')); return; }
        state.debts.push(Object.assign(listDefaults('debts'), { name: tr('Loan'), minPayment: emi, balance: left, rate: Number(obValue('su-rate')) || 14,
          dueDay: Math.min(31, Math.max(1, Math.round(Number(obValue('su-emi-day')) || 5))), fromSetup: true }));
        setupDone('loans', before);
        break;
      }
      case 'setup-sms': ui.setupFocus = null; readNativeSms(false); return;
      case 'setup-protect': ui.setupFocus = null; openPage('plan', 'protect'); return;
      case 'setup-none': {
        state.setup = Object.assign({}, state.setup, { none: Object.assign({}, (state.setup || {}).none, { [btn.dataset.key]: true }) });
        setupDone(btn.dataset.key, null);
        break;
      }
      case 'setup-later': state.setup = Object.assign({}, state.setup, { laterDay: t }); ui.setupFocus = null; save(); toast(tr('Okay! I’ll ask again tomorrow.')); break;
      case 'setup-off': state.setup = Object.assign({}, state.setup, { off: true }); ui.setupFocus = null; save(); toast(tr('Okay! The checklist on Runway has everything when you want it.')); break;
      case 'setup-win-next': ui.setupWin = null; break;
      case 'setup-list': state.setup = Object.assign({}, state.setup, { listOpen: !(state.setup || {}).listOpen }); save(); break;
      case 'setup-list-hide': state.setup = Object.assign({}, state.setup, { listHidden: true, listOpen: false }); save(); toast(tr('Hidden. Plan → What matters most and Debts have the rest.')); break;
      case 'setup-step': ui.setupFocus = btn.dataset.key; ui.setupWin = null; rerenderKeepScroll(); window.scrollTo(0, 0); return;
      case 'onboard-back': if (state.onboarding && state.onboarding.step > 1) { state.onboarding.step--; ui.onboardError = ''; ui.onboardFocus = true; save(); } break;
      case 'onboard-later': ui.onboardHidden = true; toast('Your setup is saved. Finish it any time from the Plan tab.'); break;
      case 'onboard-resume': ui.onboardHidden = false; ui.onboardFocus = true; break;
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
      case 'card-emi-open': ui.cardEmi = btn.dataset.id; ui.cardEmiError = ''; ui.cardEmiPrefill = null; break;
      case 'card-emi-cancel': ui.cardEmi = null; ui.cardEmiError = ''; ui.cardEmiPrefill = null; break;
      case 'emi-offer-add': {
        const c = (state.cards || []).find((x) => x.id === btn.dataset.id);
        const o = c && (state.emiOffers || []).find((x) => x.key === btn.dataset.key);
        if (!o) return;
        const plan = Core.cardEmiFromBooking(c, o, t);
        ui.cardEmi = c.id; ui.cardEmiError = '';
        ui.cardEmiPrefill = { key: o.key, emi: plan.emi, left: plan.left, rate: plan.rate };
        break;
      }
      case 'emi-offer-no': {
        const o = (state.emiOffers || []).find((x) => x.key === btn.dataset.key);
        if (o) { o.done = true; save(); toast(tr('Left out')); }
        break;
      }
      case 'card-emi-save': {
        const v = (id) => (document.getElementById(id) || {}).value || '';
        // Already in Debts with about this EMI (on this card, or named like a card EMI): not added twice.
        const emiNow = Math.round(Number(v('ce-emi')) || 0);
        const twin = emiNow > 0 && state.debts.find((x) => x.balance > 0 && (x.viaCard === btn.dataset.id || (!x.viaCard && Core.looksLikeCardBill(x.name))) &&
          Math.abs((Number(x.minPayment) || 0) - emiNow) <= emiNow * 0.1);
        if (twin) {
          ui.cardEmiError = tr('{name} ({amount} a month) is already in your loans. Set it to this card’s bill in Debts → Loans instead of adding it again.', { name: twin.name, amount: inr(twin.minPayment) });
          break;
        }
        const d = Core.addCardEmi(state, btn.dataset.id, { emi: v('ce-emi'), left: v('ce-left'), rate: v('ce-rate') }, t);
        if (!d) { ui.cardEmiError = tr('Enter the EMI amount and how many are left.'); break; }
        const offer = ui.cardEmiPrefill && (state.emiOffers || []).find((x) => x.key === ui.cardEmiPrefill.key);
        if (offer) offer.done = true;
        ui.cardEmi = null; ui.cardEmiError = ''; ui.cardEmiPrefill = null;
        save();
        toast(tr('{name} added: {amount} a month, {n} left. It’s in Debts too.', { name: d.name, amount: inr(d.minPayment), n: d.emisLeft }));
        break;
      }
      case 'card-latest': {
        const c = (state.cards || []).find((x) => x.id === btn.dataset.id);
        const el = document.getElementById('card-latest-' + btn.dataset.id);
        if (!c || !el || el.value === '') { toast(tr('Enter the amount due, or 0 if nothing is due.')); return; }
        const lastSt = Core.statementOn(c, c.created || t);
        c.setupStatement = Math.max(0, Math.round(Number(el.value) || 0));
        c.setupDueDate = Core.dueAfter(c, lastSt);
        save();
        toast(tr('{amount} due {date} on {name}', { amount: inr(c.setupStatement), date: fmtDate(c.setupDueDate), name: c.name }));
        break;
      }
      case 'sms-skip-like': {
        const r = (ui.smsRows || [])[Number(btn.dataset.i)];
        if (!r) return;
        // A suggestion to edit: the shop, or the message's first words.
        const shop = r.parsed && r.parsed.merchant && !/^(bank payment|money received)$/i.test(r.parsed.merchant) ? r.parsed.merchant : '';
        // Greetings and everyday words would skip real payments too: the first two telling words instead.
        const common = /^(dear|customer|sir|madam|hi|hello|your|you|the|and|for|with|from|has|have|been|was|is|are|our|this|that|get|now|on|of|to|in|at|by|rs|inr|a\/c|ac|account|bank|upi|ref|txn|amount|debited|credited|sent|received|spent|paid)$/i;
        const words = String(r.text).replace(/[^\p{L}\p{N}&' -]+/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !/\d/.test(w) && !common.test(w));
        ui.skipDraft = shop || words.slice(0, 2).join(' ');
        rerenderKeepScroll();
        setTimeout(() => { const el = document.getElementById('skip-word'); if (el) { el.focus(); el.select(); el.scrollIntoView({ block: 'center' }); } }, 50);
        return;
      }
      case 'sms-skip-text-add': {
        const w = ((document.getElementById('skip-word') || {}).value || '').trim();
        if (w.length < 3) { toast(tr('Use at least 3 letters, so real payments aren’t skipped.')); return; }
        state.smsSkipText = (state.smsSkipText || []).filter((x) => x.toLowerCase() !== w.toLowerCase()).concat(w).slice(-50);
        ui.skipDraft = '';
        // Offered now but matching: gone from the list.
        if (ui.smsRows) ui.smsRows = ui.smsRows.map((r) => (smsSkipText(r.text) ? Object.assign({}, r, { parsed: null, checked: false }) : r));
        save(); syncAlerts(); toast(tr('SMS with “{word}” are skipped from now on', { word: w })); break;
      }
      case 'sms-skip-text-remove':
        state.smsSkipText = (state.smsSkipText || []).filter((x) => x !== btn.dataset.word);
        save(); syncAlerts(); toast(tr('SMS with “{word}” count again', { word: btn.dataset.word })); break;
      case 'sms-unskip': {
        const name = (state.smsSkipNames || {})[btn.dataset.shop] || btn.dataset.shop;
        state.smsSkip = (state.smsSkip || []).filter((x) => x !== btn.dataset.shop);
        if (state.smsSkipNames) delete state.smsSkipNames[btn.dataset.shop];
        save(); toast(tr('SMS from {shop} count again', { shop: name })); break;
      }
      case 'pass-yes': {
        const before = JSON.stringify(state);
        if (!Core.passOn(state, btn.dataset.in, btn.dataset.out)) return;
        ui.passForm = null;
        save(); rerenderKeepScroll();
        offerUndo(tr('Passed on: not counted as income or spending'), before);
        return;
      }
      case 'pass-borrow': ui.passForm = { inId: btn.dataset.in, outId: btn.dataset.out }; break;
      case 'pass-form-cancel': ui.passForm = null; break;
      case 'pass-iou': {
        const i = state.transactions.find((x) => x.id === btn.dataset.in);
        const o = state.transactions.find((x) => x.id === btn.dataset.out);
        if (!i || !o) return;
        const v = (id) => (document.getElementById(id) || {}).value || null;
        const before = JSON.stringify(state);
        Core.addIou(state, { name: i.note, dir: 'owe', amount: i.amount, promised: v('pf-from'), txId: i.id }, t);
        Core.addIou(state, { name: o.note, dir: 'lent', amount: o.amount, promised: v('pf-to'), txId: o.id }, t);
        ui.passForm = null;
        save(); rerenderKeepScroll();
        offerUndo(tr('In People: you owe {from}, {to} owes you', { from: i.note || tr('someone'), to: o.note || tr('someone') }), before);
        return;
      }
      case 'pass-no':
        state.passNo = (state.passNo || []).concat(btn.dataset.in, String(btn.dataset.out || '').split(',')).slice(-200);
        save(); toast(tr('Kept as they are')); break;
      case 'pass-undo': {
        const x = state.transactions.find((y) => y.id === ui.editTx);
        if (!x) return;
        Core.unpassOn(state, x).forEach((y) => { state.passNo = (state.passNo || []).concat(y.id).slice(-200); });
        save(); toast(tr('Counted again as income and spending')); break;
      }
      case 'refund-undo': {
        const x = state.transactions.find((y) => y.id === btn.dataset.id);
        if (!x) return;
        const before = JSON.stringify(state);
        const r = Core.undoRefund(state, x, Number(btn.dataset.i));
        // The SMS can come in again, as money in.
        if (r && r.smsKey) state.smsIgnored = (state.smsIgnored || []).filter((k) => k !== r.smsKey);
        save(); rerenderKeepScroll(); offerUndo(tr('Refund taken off. Read your SMS again to add it as money in.'), before);
        return;
      }
      case 'refund-link': {
        const before = JSON.stringify(state);
        if (!Core.linkRefund(state, btn.dataset.id, btn.dataset.buy)) return;
        save(); rerenderKeepScroll(); offerUndo(tr('Counted as a refund: not income, and that payment costs less.'), before);
        return;
      }
      case 'refund-not': { const x = state.transactions.find((y) => y.id === btn.dataset.id); if (x) { x.notRefund = true; save(); } break; }
      case 'refund-unlink': {
        const x = state.transactions.find((y) => y.id === btn.dataset.id);
        if (!x) return;
        const before = JSON.stringify(state);
        Core.unlinkRefund(state, x); x.notRefund = true; ui.editTx = null;
        save(); rerenderKeepScroll(); offerUndo(tr('Money in again, not a refund'), before);
        return;
      }
      case 'fixed-pay-open': ui.fixedPay = btn.dataset.id; break;
      case 'fixed-pay-cancel': ui.fixedPay = null; break;
      case 'fixed-pay-save': {
        const amount = Math.round(Number((document.getElementById('fp-amount') || {}).value));
        const date = (document.getElementById('fp-date') || {}).value || t;
        if (!(amount > 0) || amount > 1e9 || date > t) { toast(tr('Enter what you paid.')); return; }
        const before = JSON.stringify(state);
        if (!Core.payFixed(state, btn.dataset.id, { amount, date })) { toast(tr('Already recorded as paid')); return; }
        ui.fixedPay = null;
        save(); rerenderKeepScroll(); offerUndo(tr('Recorded as paid. It won’t be counted again on its due date.'), before);
        return;
      }
      case 'twin-merge': {
        const before = JSON.stringify(state);
        if (!Core.mergeFixedTwin(state, btn.dataset.paid, btn.dataset.extra)) { toast(tr('That doesn’t fit this entry.')); return; }
        save(); rerenderKeepScroll(); offerUndo(tr('Counted once now.'), before); return;
      }
      case 'twin-no': {
        const x = state.transactions.find((y) => y.id === btn.dataset.extra);
        if (x) { x.notTwin = true; save(); }
        break;
      }
      case 'due-paid': {
        const before = JSON.stringify(state);
        if (!Core.payFixed(state, btn.dataset.id, { amount: Number(btn.dataset.amount), date: btn.dataset.date })) { toast(tr('Already recorded as paid')); return; }
        save(); rerenderKeepScroll(); offerUndo(tr('Recorded as paid. It won’t be counted again on its due date.'), before);
        return;
      }
      case 'due-later': {
        const asked = {};
        Object.keys(state.dueAsked || {}).forEach((k) => { if (state.dueAsked[k] >= Core.addDays(t, -40)) asked[k] = state.dueAsked[k]; });
        asked[btn.dataset.key] = t;
        state.dueAsked = asked;
        save(); toast(tr('It stays under Coming up until it’s paid.'));
        break;
      }
      case 'fixed-link': {
        const fid = btn.dataset.id || (document.getElementById('fx-which') || {}).value;
        const before = JSON.stringify(state);
        if (!Core.payFixed(state, fid, { txId: btn.dataset.tx })) { toast(tr('Already recorded as paid')); return; }
        ui.editTx = null;
        save(); rerenderKeepScroll(); offerUndo(tr('Recorded as paid. It won’t be counted again on its due date.'), before);
        return;
      }
      case 'fixed-not': {
        const x = state.transactions.find((y) => y.id === btn.dataset.tx);
        if (x) { x.notFixed = true; save(); }
        break;
      }
      case 'fixed-unpay': {
        const x = state.transactions.find((y) => y.id === btn.dataset.tx);
        if (!x) return;
        const before = JSON.stringify(state);
        Core.unpayFixed(state, x);
        ui.editTx = null;
        save(); rerenderKeepScroll(); offerUndo(tr('Not a fixed payment any more'), before);
        return;
      }
      // Subcategories
      case 'sub-add': {
        const c = btn.dataset.cat;
        const el = document.getElementById('sub-new-' + btn.dataset.i);
        const name = (el && el.value || '').trim().replace(/\|/g, '/').slice(0, 30);
        if (!name) return;
        state.subcats = state.subcats || {};
        const add = (state.subcats.add = state.subcats.add || {});
        const hide = (state.subcats.hide = state.subcats.hide || {});
        hide[c] = (hide[c] || []).filter((n) => n !== name);
        if (Core.subcategories(state, c).indexOf(name) === -1) add[c] = (add[c] || []).concat(name);
        save(); break;
      }
      case 'sub-hide': case 'sub-unhide': {
        const c = btn.dataset.cat, n = btn.dataset.sub;
        state.subcats = state.subcats || {};
        const add = (state.subcats.add = state.subcats.add || {});
        const hide = (state.subcats.hide = state.subcats.hide || {});
        if (btn.dataset.action === 'sub-unhide') hide[c] = (hide[c] || []).filter((x) => x !== n);
        else if ((add[c] || []).indexOf(n) !== -1) add[c] = add[c].filter((x) => x !== n);
        else hide[c] = (hide[c] || []).concat(n);
        save(); break;
      }
      case 'sub-yes': case 'sub-no': {
        const x = state.transactions.find((y) => y.id === btn.dataset.id);
        if (!x) return;
        if (btn.dataset.action === 'sub-yes') x.sub = btn.dataset.sub; else x.subNo = true;
        save(); break;
      }
      case 'sub-all': {
        const before = JSON.stringify(state);
        const list = Core.subSuggestions(state);
        list.forEach((y) => { y.tx.sub = y.sub; });
        save(); rerenderKeepScroll(); offerUndo(tr('{n} payments now have a subcategory', { n: list.length }), before); return;
      }
      case 'sub-off': state.subAskOff = true; save(); break;
      // Trips and events
      case 'ev-form': ui.evForm = true; ui.evError = ''; break;
      case 'ev-form-cancel': ui.evForm = false; ui.evError = ''; ui.evFromTx = null; break;
      case 'ev-create': {
        const val = (id) => (document.getElementById(id) || {}).value || '';
        const name = val('ev-name').trim();
        const people = val('ev-people').split(',');
        if (!name) { ui.evError = tr('Give it a name.'); break; }
        if (!people.some((p) => p.trim())) { ui.evError = tr('Add at least one person.'); break; }
        const before = JSON.stringify(state);
        const ev = Core.addEvent(state, { name, from: val('ev-from') || t, to: val('ev-to') || val('ev-from') || t, people, budget: Number(val('ev-budget')) || 0 }, t);
        if (!ev) { ui.evError = tr('Check the name and people.'); break; }
        ui.evForm = false; ui.evError = ''; ui.evOpen = ev.id;
        // Made from a payment: go straight to splitting it.
        const fromTx = ui.evFromTx && state.transactions.find((x) => x.id === ui.evFromTx);
        ui.evAdd = fromTx ? { txId: fromTx.id, total: fromTx.amount, date: fromTx.date, place: fromTx.note || '', category: fromTx.category, paidBy: 'me' } : null;
        ui.evFromTx = null;
        save(); rerenderKeepScroll(); offerUndo(tr('{name} added', { name }), before); return;
      }
      case 'ev-open': ui.evOpen = btn.dataset.id; ui.evAdd = null; ui.evSettle = null; ui.evEdit = false; ui.evDelete = false; ui.evError = ''; window.scrollTo(0, 0); break;
      case 'ev-close': ui.evOpen = null; ui.evAdd = null; ui.evSettle = null; ui.evEdit = false; ui.evDelete = false; break;
      case 'ev-goto': ui.editTx = null; ui.evOpen = btn.dataset.id; ui.evAdd = null; openPage('spend', 'events'); return;
      case 'ev-split-tx': case 'ev-new-from-tx': {
        const x = state.transactions.find((y) => y.id === btn.dataset.tx);
        if (!x) return;
        ui.editTx = null;
        if (btn.dataset.action === 'ev-new-from-tx') { ui.evOpen = null; ui.evForm = true; ui.evFromTx = x.id; ui.evError = ''; }
        else { ui.evOpen = btn.dataset.id; ui.evAdd = { txId: x.id, total: x.amount, date: x.date, place: x.note || '', category: x.category, paidBy: 'me' }; ui.evError = ''; }
        openPage('spend', 'events'); return;
      }
      case 'ev-add-open': ui.evAdd = { date: t, paidBy: 'me', mode: 'equal' }; ui.evError = ''; break;
      case 'ev-add-cancel': ui.evAdd = null; ui.evError = ''; break;
      case 'ev-add': {
        const ev = (state.events || []).find((e) => e.id === ui.evOpen);
        if (!ev) return;
        const f = eventFormShares(ev);
        const val = (id) => (document.getElementById(id) || {}).value || '';
        if (!(f.total > 0)) { ui.evError = tr('Enter the amount.'); break; }
        if (!f.shares) { ui.evError = tr('The parts don’t add up to {amount}.', { amount: inr(f.total) }); break; }
        const before = JSON.stringify(state);
        const it = Core.addEventExpense(state, ev.id, { date: val('ea-date') || t, total: f.total, paidBy: f.paidBy, shares: f.shares, place: val('ea-place'), category: val('ea-cat') || 'Travel', txId: ui.evAdd && ui.evAdd.txId });
        if (!it) { ui.evError = tr('That payment can’t be split here.'); break; }
        // Paid by you and its bank SMS already in: that one is this payment.
        const linked = f.paidBy === 'me' ? joinBankSms(state.transactions.find((x) => x.id === it.txIds[0] && x.eventNew), true) : '';
        ui.evAdd = null; ui.evError = '';
        save(); rerenderKeepScroll();
        offerUndo((f.paidBy === 'me' ? tr('Your share {mine} counts as spending; {others} is owed to you.', { mine: inr(f.shares.me || 0), others: inr(f.total - (f.shares.me || 0)) })
          : tr('Your share {mine} counts as spending; you owe {who}.', { mine: inr(f.shares.me || 0), who: f.paidBy })) + (linked ? ' ' + linked : ''), before);
        return;
      }
      case 'ev-item-remove': {
        const before = JSON.stringify(state);
        const res = Core.removeEventExpense(state, ui.evOpen, btn.dataset.id);
        if (!res.ok) { toast(tr('Already settled with {name} for this. Undo that first.', { name: res.name || '' })); return; }
        save(); rerenderKeepScroll(); offerUndo(tr('Payment taken out of the event'), before); return;
      }
      case 'ev-settle-open': ui.evSettle = btn.dataset.name; break;
      case 'ev-settle-cancel': ui.evSettle = null; break;
      case 'ev-net': case 'ev-settle': {
        const before = JSON.stringify(state);
        const pick = document.querySelector('input[name=es-tx]:checked');
        const amount = btn.dataset.action === 'ev-net' ? 0 : Math.round(Number((document.getElementById('es-amount') || {}).value) || 0);
        if (btn.dataset.action === 'ev-settle' && !(amount > 0)) { toast(tr('Enter the amount.')); return; }
        const res = Core.settleEvent(state, ui.evOpen, btn.dataset.name, { amount, date: (document.getElementById('es-date') || {}).value || t, txId: pick && pick.value ? pick.value : null });
        if (!res) { toast(tr('That entry doesn’t match. Pick another or add it.')); return; }
        ui.evSettle = null;
        save(); rerenderKeepScroll(); offerUndo(res.paid ? tr('{amount} settled with {name}. Not income or spending: money passed on.', { amount: inr(res.paid), name: btn.dataset.name }) : tr('Marked even with {name}.', { name: btn.dataset.name }), before);
        return;
      }
      case 'ev-remind': {
        const ev = (state.events || []).find((e) => e.id === ui.evOpen);
        if (ev) shareMessage(eventReminderText(ev, btn.dataset.name));
        return;
      }
      case 'ev-edit': ui.evEdit = true; break;
      case 'ev-edit-cancel': ui.evEdit = false; break;
      case 'ev-edit-save': {
        const val = (id) => (document.getElementById(id) || {}).value || '';
        const before = JSON.stringify(state);
        if (!Core.editEvent(state, ui.evOpen, { name: val('ee-name'), from: val('ee-from'), to: val('ee-to'), people: val('ee-people').split(','), budget: Number(val('ee-budget')) || 0 })) {
          toast(tr('Someone with a share can’t be taken out.')); return;
        }
        ui.evEdit = false; save(); rerenderKeepScroll(); offerUndo(tr('Saved'), before); return;
      }
      case 'ev-delete-ask': ui.evDelete = true; break;
      case 'ev-delete-cancel': ui.evDelete = false; break;
      case 'ev-delete': {
        const before = JSON.stringify(state);
        Core.deleteEvent(state, ui.evOpen);
        ui.evOpen = null; ui.evDelete = false;
        save(); rerenderKeepScroll(); offerUndo(tr('Event deleted'), before); return;
      }
      case 'maybe-form': ui.maybeForm = true; ui.maybeError = ''; break;
      case 'maybe-form-cancel': ui.maybeForm = false; ui.maybeError = ''; break;
      case 'maybe-when': { const d = document.getElementById('mb-date'); if (d) d.value = Core.addDays(t, Number(btn.dataset.days) || 7); return; }
      case 'maybe-add': {
        const v = (id) => (document.getElementById(id) || {}).value || '';
        const amount = Math.round(Number(v('mb-amount')));
        if (!(amount > 0) || amount > 1e9) { ui.maybeError = tr('Enter about how much it would cost.'); break; }
        if (!v('mb-date')) { ui.maybeError = tr('Choose roughly when.'); break; }
        const before = JSON.stringify(state);
        const m = Core.addMaybe(state, { name: v('mb-name').trim() || tr('Maybe expense'), amount, date: v('mb-date'), likely: v('mb-likely'), category: v('mb-cat') || 'Misc' }, new Date().toISOString());
        if (!m) return;
        ui.maybeForm = false; ui.maybeError = '';
        save(); rerenderKeepScroll();
        offerUndo(tr(m.likely === 'likely' ? 'Added. Its money is held from today’s limit.' : 'Added.'), before);
        return;
      }
      case 'maybe-yes': ui.maybeAnswer = btn.dataset.id; break;
      case 'maybe-cancel': ui.maybeAnswer = null; break;
      case 'maybe-later': state.maybeAsked = Object.assign({}, state.maybeAsked, { [btn.dataset.id]: t }); save(); break;
      case 'maybe-no': case 'maybe-reopen': case 'maybe-remove': {
        const before = JSON.stringify(state);
        const a = btn.dataset.action;
        if (a === 'maybe-no') Core.maybeDidnt(state, btn.dataset.id, new Date().toISOString());
        else if (a === 'maybe-reopen') Core.maybeReopen(state, btn.dataset.id);
        else { Core.maybeReopen(state, btn.dataset.id); state.maybe = (state.maybe || []).filter((m) => m.id !== btn.dataset.id); }
        ui.maybeAnswer = null;
        save(); rerenderKeepScroll();
        offerUndo(tr(a === 'maybe-no' ? 'Noted: it didn’t come. Its money is free again.' : a === 'maybe-reopen' ? 'Open again' : 'Removed'), before);
        return;
      }
      case 'maybe-link': case 'maybe-new': {
        const m = (state.maybe || []).find((y) => y.id === btn.dataset.id);
        if (!m) return;
        const before = JSON.stringify(state);
        let txId = null;
        if (btn.dataset.action === 'maybe-link') txId = ((document.querySelector('input[name="mb-tx"]:checked') || {}).value) || null;
        else {
          const amount = Math.round(Number((document.getElementById('mb-paid') || {}).value));
          const date = (document.getElementById('mb-paid-date') || {}).value || t;
          if (!(amount > 0) || amount > 1e9 || date > t) { toast(tr('Enter what you paid.')); return; }
          txId = uid();
          state.transactions.push({ id: txId, date, amount, category: m.category || 'Misc', note: m.name, source: 'manual' });
        }
        if (!txId || !Core.maybeHappened(state, m.id, txId, new Date().toISOString())) { toast(tr('Pick the payment')); return; }
        ui.maybeAnswer = null;
        save(); rerenderKeepScroll(); offerUndo(tr('Linked. It’s in your reports, not your daily spending.'), before);
        return;
      }
      case 'reimb-open': ui.reimbForm = btn.dataset.id; ui.reimbError = ''; break;
      case 'reimb-cancel': ui.reimbForm = null; ui.reimbError = ''; break;
      case 'reimb-save': {
        const x = state.transactions.find((y) => y.id === btn.dataset.id);
        if (!x) return;
        const eligible = Math.round(Number((document.getElementById('rb-eligible') || {}).value) || 0);
        if (!(eligible > 0) || eligible > x.amount) { ui.reimbError = tr('Enter what’s paid back: above ₹0 and up to {amount}.', { amount: inr(x.amount) }); break; }
        const before = JSON.stringify(state);
        const routing = (document.getElementById('rb-route') || {}).value === 'vault' ? 'vault' : 'daily';
        Core.addClaim(state, x.id, { eligible, routing, who: ((document.getElementById('rb-who') || {}).value || '').trim(), ref: ((document.getElementById('rb-ref') || {}).value || '').trim() }, new Date().toISOString());
        ui.reimbForm = null; ui.reimbError = '';
        save(); rerenderKeepScroll();
        offerUndo(tr('{amount} to be paid back. It’s out of your spending.', { amount: inr(eligible) }), before);
        return;
      }
      case 'reimb-match': {
        const ids = [...document.querySelectorAll('[data-reimb-claim]:checked')].map((e) => e.dataset.reimbClaim);
        if (!ids.length) { toast(tr('Pick the claims this pays back')); return; }
        const before = JSON.stringify(state);
        const p = Core.recordPayout(state, btn.dataset.id, ids);
        if (!p) return;
        const v = Core.reimbView(state);
        const pv = v.payouts.find((y) => y.id === p.id) || {};
        save(); rerenderKeepScroll();
        offerUndo(pv.excess ? tr('Matched. {amount} wasn’t for these claims.', { amount: inr(pv.excess) })
          : pv.marginVault ? tr('Matched. {amount} extra went to the side vault.', { amount: inr(pv.marginVault) })
          : pv.marginDaily ? tr('Matched. {amount} extra added to this month’s spending.', { amount: inr(pv.marginDaily) }) : tr('Matched to the claim'), before);
        return;
      }
      case 'reimb-unpay': {
        const x = state.transactions.find((y) => y.id === btn.dataset.id);
        if (!x) return;
        const before = JSON.stringify(state);
        Core.reimbForget(state, x);
        save(); rerenderKeepScroll(); offerUndo(tr('No longer a reimbursement'), before);
        return;
      }
      case 'reimb-close': case 'reimb-reopen': {
        const before = JSON.stringify(state);
        Core.claimSet(state, btn.dataset.id, { closed: btn.dataset.action === 'reimb-close' }, new Date().toISOString());
        save(); rerenderKeepScroll(); offerUndo(tr(btn.dataset.action === 'reimb-close' ? 'Closed. What didn’t come back is your spending.' : 'Reopened'), before);
        return;
      }
      case 'reimb-remove': {
        const c = ((state.reimb || {}).claims || []).find((y) => y.id === btn.dataset.id);
        const x = c && state.transactions.find((y) => y.id === c.txId);
        if (!x) return;
        const before = JSON.stringify(state);
        Core.reimbForget(state, x);
        save(); rerenderKeepScroll(); offerUndo(tr('Not reimbursable: it’s your spending again'), before);
        return;
      }
      case 'iou-start': ui.iouStart = { txId: btn.dataset.id }; break;
      case 'iou-start-cancel': ui.iouStart = null; break;
      case 'iou-start-save': {
        const x = state.transactions.find((y) => y.id === (ui.iouStart || {}).txId);
        if (!x) return;
        const name = ((document.getElementById('is-name') || {}).value || '').trim() || x.note;
        const promised = (document.getElementById('is-date') || {}).value || null;
        const before = JSON.stringify(state);
        const i = Core.addIou(state, { name, dir: Core.isIncome(x) ? 'owe' : 'lent', amount: x.amount, promised, txId: x.id }, t);
        if (Core.isIncome(x)) x.useFor = x.useFor || 'spend';
        ui.iouStart = null;
        save(); rerenderKeepScroll();
        offerUndo(tr(i.dir === 'owe' ? 'In People: you owe {name} {amount}' : 'In People: {name} owes you {amount}', { name: i.name, amount: inr(i.amount) }), before);
        return;
      }
      case 'iou-pay-tx': {
        const x = state.transactions.find((y) => y.id === btn.dataset.id);
        const i = (state.iou || []).find((y) => y.id === btn.dataset.iou);
        if (!x || !i) return;
        const before = JSON.stringify(state);
        Core.payIou(state, i.id, Math.min(x.amount, Core.iouLeft(i)), x.date, x.id);
        if (Core.isIncome(x)) x.useFor = x.useFor || 'spend';
        ui.editTx = null;
        save(); rerenderKeepScroll();
        offerUndo(Core.iouLeft(i) ? tr('{left} still to go with {name}', { left: inr(Core.iouLeft(i)), name: i.name }) : tr('Settled with {name}', { name: i.name }), before);
        return;
      }
      case 'iou-all': {
        const i = (state.iou || []).find((y) => y.id === btn.dataset.iou);
        if (!i) return;
        const before = JSON.stringify(state);
        recordIouPayment(i, Core.iouLeft(i), t);
        save(); rerenderKeepScroll(); offerUndo(tr('Settled with {name}', { name: i.name }), before);
        return;
      }
      case 'iou-pay-open': ui.iouPay = btn.dataset.iou; break;
      case 'iou-pay-cancel': ui.iouPay = null; break;
      case 'iou-pay-save': {
        const i = (state.iou || []).find((y) => y.id === btn.dataset.iou);
        const amount = Math.min(Core.iouLeft(i || {}), Math.round(Number((document.getElementById('ip-amt') || {}).value) || 0));
        if (!i || !(amount > 0)) { toast(tr('Enter the amount paid back')); return; }
        const date = (document.getElementById('ip-date') || {}).value || t;
        const before = JSON.stringify(state);
        recordIouPayment(i, amount, date > t ? t : date);
        ui.iouPay = null;
        save(); rerenderKeepScroll();
        offerUndo(Core.iouLeft(i) ? tr('{left} still to go with {name}', { left: inr(Core.iouLeft(i)), name: i.name }) : tr('Settled with {name}', { name: i.name }), before);
        return;
      }
      case 'iou-later': state.iouAsked = Object.assign({}, state.iouAsked, { [btn.dataset.iou]: t }); ui.iouEdit = btn.dataset.iou; save(); openPage('debts', 'people'); return;
      case 'iou-edit': ui.iouEdit = btn.dataset.iou; break;
      case 'iou-edit-cancel': ui.iouEdit = null; break;
      case 'iou-edit-save': {
        const i = (state.iou || []).find((y) => y.id === btn.dataset.iou);
        if (!i) return;
        // A name from the SMS ("UPI *6127") made right: the entries that moved the money follow.
        const name = ((document.getElementById('ie-name') || {}).value || '').trim();
        if (name && name !== i.name) {
          state.transactions.forEach((x) => { if ((x.iouId === i.id || x.iouPay === i.id) && x.note === i.name) x.note = name; });
          i.name = name;
        }
        i.promised = (document.getElementById('ie-date') || {}).value || null;
        const extra = Math.round(Number((document.getElementById('ie-int') || {}).value) || 0);
        if (extra > 0) i.amount += extra;
        ui.iouEdit = null; save(); toast(tr('Saved')); break;
      }
      case 'iou-remove': {
        const before = JSON.stringify(state);
        state.iou = (state.iou || []).filter((y) => y.id !== btn.dataset.iou);
        state.transactions.forEach((x) => { if (x.iouId === btn.dataset.iou) delete x.iouId; if (x.iouPay === btn.dataset.iou) delete x.iouPay; });
        ui.iouEdit = null; save(); rerenderKeepScroll(); offerUndo(tr('Removed'), before); return;
      }
      case 'iou-add': ui.iouAdd = true; ui.iouError = ''; break;
      case 'iou-add-cancel': ui.iouAdd = false; break;
      case 'iou-add-save': {
        const v = (id) => (document.getElementById(id) || {}).value || '';
        const name = v('ia-name').trim();
        if (!name) { ui.iouError = tr('Who is it with?'); break; }
        // The money already in from its bank SMS (in the last 3 days)? That payment is this one.
        const dir = v('ia-dir') === 'lent' ? 'lent' : 'owe';
        const bank = Core.bankTwin(state, { amount: v('ia-amt'), date: t, dir: dir === 'lent' ? 'out' : 'in', wallet: null, any: true });
        const i = Core.addIou(state, { name, dir, amount: v('ia-amt'), promised: v('ia-date') || null, txId: bank && bank.id }, t);
        if (!i) { ui.iouError = tr('Enter an amount above ₹0.'); break; }
        if (bank && bank.kind === 'in') bank.useFor = 'spend';
        ui.iouAdd = false; save();
        toast(tr('{name} added', { name }) + (bank ? ' ' + tr('Linked to the bank SMS of {date} ({merchant}): counted once.', { date: fmtDate(bank.date), merchant: bank.note || '' }) : '')); break;
      }
      case 'crash-yes': { const c = crashCfg(); c.on = true; saveCrashCfg(c); toast(tr('Crash reports on. Nothing about your money is in them.')); break; }
      case 'crash-no': { const c = crashCfg(); c.on = false; c.queue = []; saveCrashCfg(c); toast(tr('Crash reports off.')); break; }
      case 'crash-sample': ui.crashSample = !ui.crashSample; break;
      case 'road-view': ui.roadView = btn.dataset.view; break;
      case 'protect-add': {
        const item = Core.addProtect(state, { preset: btn.dataset.preset });
        ui.protectError = item ? '' : tr('Five is the most: remove one to add another.');
        if (item) { save(); toast(tr('{name} is protected', { name: protectLabel(item.name) })); }
        break;
      }
      case 'protect-remove': {
        const before = JSON.stringify(state);
        const x = Core.protectList(state).find((y) => y.id === btn.dataset.id);
        if (!x || !Core.removeProtect(state, x.id)) return;
        save(); rerenderKeepScroll(); offerUndo(tr('{name} is no longer protected', { name: protectLabel(x.name) }), before); return;
      }
      case 'protect-link': ui.protectLink = btn.dataset.id || null; break;
      case 'protect-link-save': {
        const id = btn.dataset.id;
        const cat = (document.getElementById('pl-cat-' + id) || {}).value;
        const shop = (document.getElementById('pl-shop-' + id) || {}).value;
        if (cat) Core.linkProtect(state, id, { cat }, true);
        if (shop) Core.linkProtect(state, id, { shop }, true);
        if (cat || shop) save();
        break;
      }
      case 'protect-unlink': {
        const k = btn.dataset.kind;
        Core.linkProtect(state, btn.dataset.id, k === 'cat' ? { cat: btn.dataset.val } : { shop: btn.dataset.val }, false);
        save(); break;
      }
      case 'road-rate': ui.roadRate = btn.dataset.rate; ui.afford = null; break;
      case 'report-preview': {
        const note = ((document.getElementById('report-note') || {}).value || '').trim();
        const withData = !!(document.getElementById('report-data') || {}).checked;
        ui.reportForm = Object.assign({}, ui.reportForm, { note, withData, preview: !(ui.reportForm && ui.reportForm.preview) });
        break;
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
        try { [KEY, LANG_KEY, CHART_KEY, VIZ_KEY, LOCK_KEY, THEME_KEY, TOUR_KEY, LOG_KEY, CRASH_KEY].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
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
        // In a trip or event: its payment comes out of the event first (refused once someone's been paid back for it).
        if (tx && tx.eventId) {
          const res = Core.eventForgetTx(state, tx);
          if (!res.ok) { toast(tr('Already settled with {name} for this. Undo that first.', { name: res.name || '' })); return; }
        }
        if (tx && (Core.isIncome(tx) || Core.isMove(tx))) undoIncomeUse(tx);
        if (tx && Core.isBillPayment(tx)) Core.undoBillPayment(state, tx);
        if (tx && tx.fromFund) state.savings.emergencyBalance = (Number(state.savings.emergencyBalance) || 0) + tx.amount;
        if (tx && tx.kind === 'cardconvert') Core.undoCardConvert(state, tx);
        if (tx && (tx.iouId || tx.iouPay)) Core.undoIouTx(state, tx);
        if (tx && (tx.claimId || tx.payoutId)) Core.reimbForget(state, tx);
        if (tx) { Core.maybeForget(state, tx); Core.unlinkRefund(state, tx); Core.forgetRefunds(state, tx); Core.unpassOn(state, tx); }
        // A purchase paid from kept money: that money is kept again.
        if (tx && tx.coveredFrom) {
          const k = state.transactions.find((y) => y.id === tx.coveredFrom);
          if (k) {
            const used = (k.keepUses || []).filter((u) => u.id === tx.id).reduce((a, u) => a + u.amount, 0);
            k.keepUsed = Math.max(0, (Number(k.keepUsed) || 0) - used);
            k.keepUses = (k.keepUses || []).filter((u) => u.id !== tx.id);
          }
        }
        // A deleted SMS entry stays deleted: the next scan doesn't bring it back.
        if (tx && tx.smsKey) state.smsIgnored = (state.smsIgnored || []).concat(tx.smsKey).slice(-500);
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
        setIncomeUse(tx, btn.dataset.use, btn.dataset.debt, btn.dataset.goal);
        ui.savedChange = null;
        tx.needsReview = false;
        tx.autoUse = false;
        learnSaving(tx, btn.dataset.use, btn.dataset.debt, btn.dataset.goal);
        save(); celebrate(rewardMessage(btn.dataset.use, tx.amount, btn.dataset.debt, false, btn.dataset.goal)); break;
      }
      // The places open right under the saving; nothing changes until one is picked.
      case 'saved-change': ui.savedChange = ui.savedChange === btn.dataset.id ? null : btn.dataset.id; break;
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
        // Its EMIs stay as loans, now on their own due day.
        state.debts.forEach((d) => { if (d.viaCard === btn.dataset.id) delete d.viaCard; });
        ui.cardRemove = null; save(); toast('Card removed'); break;
      case 'card-plan':
        ui.cardPlan = ui.cardPlan && ui.cardPlan.cardId === btn.dataset.id ? null : { cardId: btn.dataset.id, emi: { rate: 22, months: 6, fee: 0 }, emiAmount: 0 };
        break;
      case 'card-pay':
      case 'card-pay-part': {
        const id = btn.dataset.id;
        const amount = a === 'card-pay' ? Number(btn.dataset.amount) : Number(document.getElementById('card-part-' + id).value);
        if (!(amount > 0)) { toast('Enter the amount you paid'); return; }
        // Already in from the bank's or the card's SMS: that's this payment, not a second one.
        const fromSms = state.transactions.find((x) => x.kind === 'cardpay' && x.cardId === id && x.amount === Math.round(amount) && x.source !== 'manual' &&
          Math.abs(Core.daysBetween(x.date, t)) <= 3);
        const linked = fromSms ? tr('Linked to the bank SMS of {date} ({merchant}): counted once.', { date: fmtDate(fromSms.date), merchant: fromSms.note || '' })
          : joinBankSms(Core.recordCardPayment(state, id, amount, t), true);
        const st = Core.cardStatus(state, state.cards.find((c) => c.id === id), t);
        ui.cardPlan = null; save();
        toast((st.remaining ? tr('{amount} paid. {left} still to pay by {date}.', { amount: inr(amount), left: inr(st.remaining), date: fmtDate(st.due) }) : tr('Bill paid in full. No interest this month.')) + (linked ? ' ' + linked : ''));
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
        const billTx = Core.payBill(state, id, amount, months, t);
        if (!billTx) return;
        const linked = joinBankSms(billTx, true);
        ui.payBill = null; save();
        const paidBill = state.bills.find((x) => x.id === id);
        toast((Core.billEnded(paidBill, null) ? tr('{amount} paid. That was the last one.', { amount: inr(amount) })
          : tr('{amount} paid. Next due {date}', { amount: inr(amount), date: fmtDate(paidBill.nextDue, true) })) + (linked ? ' ' + linked : ''));
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
        state.bills.push(Object.assign({ id: uid(), name: f.name, estimate: Number(f.amount) || 0, everyMonths: 1, nextDue: Core.occurrenceInCycle(Number(f.dueDay) || 1, cyc) || t }, f.lastDue ? { lastDue: f.lastDue } : {}));
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
        const tx = state.transactions.find((x) => x.id === (btn.dataset.id || ui.editTx));
        if (!tx) return;
        const skip = document.getElementById('np-skip');
        notPayment(tx, !!(skip && skip.checked));
        return;
      }
      case 'alerts-on': enableAlerts(); return;
      case 'alerts-settings': if (SmsInbox && SmsInbox.openNotificationSettings) Promise.resolve().then(() => SmsInbox.openNotificationSettings()).catch(() => {}); return;
      case 'alerts-nudge-no': state.alertsNudged = true; save(); break;
      case 'alerts-test':
        Promise.resolve().then(() => SmsInbox.testNotification({ title: tr('Test from Hisab Se'), text: tr('Payment notifications reach this phone.') }))
          .then(() => toast(tr('Sent. Check your notifications.')), () => { checkAlerts(); toast(tr('Android blocked it. Allow notifications for Hisab Se.')); });
        return;
      case 'alerts-off':
        state.smsAlerts = false; save();
        if (SmsInbox) Promise.resolve().then(() => SmsInbox.disableAlerts()).catch(() => {});
        toast('Notifications off'); break;
      case 'income-use': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (tx && btn.dataset.use === 'keep') { ui.keepForm = tx.id; break; }
        if (tx) {
          setIncomeUse(tx, btn.dataset.use, btn.dataset.debt);
          save();
          if (['spend', 'fromfund', 'fromgrow'].indexOf(btn.dataset.use) !== -1) toast(tr(INCOME_USE_LABELS[btn.dataset.use]));
          else celebrate(rewardMessage(btn.dataset.use, tx.amount, btn.dataset.debt, false));
        }
        break;
      }
      case 'keep-cancel': ui.keepForm = null; break;
      case 'keep-save': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        if (!tx) return;
        setIncomeUse(tx, 'keep');
        tx.keepFor = ((document.getElementById('keep-name') || {}).value || '').trim() || tx.note || tr('Something to buy');
        tx.keepUsed = 0;
        ui.keepForm = null; save();
        toast(tr('{amount} kept for {name}. It’s in Grow until you use it.', { amount: inr(tx.amount), name: tx.keepFor }));
        break;
      }
      case 'keep-use-open': ui.keepUse = btn.dataset.id; break;
      case 'keep-use-cancel': ui.keepUse = null; break;
      case 'keep-use': {
        const tx = state.transactions.find((x) => x.id === btn.dataset.id);
        const buyId = btn.dataset.buy || (document.getElementById('keep-buy') || {}).value;
        if (!tx || !buyId) return;
        const before = JSON.stringify(state);
        const amount = Core.coverPurchase(state, tx.id, buyId);
        if (!amount) return;
        ui.keepUse = null; ui.editTx = null; save(); rerenderKeepScroll();
        offerUndo(tr('{amount} from {name} covers what you bought', { amount: inr(amount), name: tx.keepFor }), before);
        return;
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
        ui.smsRows = null; ui.smsText = ''; markSmsSeen(); save(); toast(smsNews.length ? smsNews.join(' · ') : tr('{items} added', { items: plural(added, 'item') }));
        smsNews = [];
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
    if (el.dataset.viaCard !== undefined) {
      const d = state.debts.find((x) => x.id === el.dataset.viaCard);
      const c = (state.cards || []).find((x) => x.id === el.value);
      if (!d) return;
      // The loan keeps its own due day; while linked, the card's due day is used.
      if (c) d.viaCard = c.id; else delete d.viaCard;
      save(); rerenderKeepScroll();
      if (c) toast(tr('{name} is on the {card} bill now: counted once a month, from your account.', { name: d.name, card: c.name }));
      return;
    }
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
    if (el.dataset.ends) {
      const item = (state[el.dataset.ends] || []).find((x) => x.id === el.dataset.id);
      if (!item) return;
      const last = Core.lastDueFrom(item, el.dataset.ends === 'bills', Math.min(360, Number(el.value) || 0), today());
      if (last) item.lastDue = last; else delete item.lastDue;
      save(); refreshAfterEdit();
      if (last) toast(tr('Last one {date}. Not counted after that.', { date: fmtDate(last, true) }));
      return;
    }
    if (el.dataset.list) {
      const item = state[el.dataset.list].find((x) => x.id === el.dataset.id);
      if (!item) return;
      const f = el.dataset.field;
      if (f === 'name') item.name = el.dataset.list === 'budgets' ? fromLabel(el.value.trim(), BUILT_IN_CATEGORIES) : el.value.trim();
      else if (f === 'nextDue') { item.nextDue = el.value || today(); delete item.day; }
      else {
        let v = Math.max(0, Number(el.value) || 0);
        if (f === 'dueDay') v = Math.min(31, Math.max(1, Math.round(v) || 1));
        if (f === 'emisLeft') v = Math.min(120, Math.round(v));
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
    if (el.dataset.reimbRoute) {
      Core.claimSet(state, el.dataset.reimbRoute, { routing: el.value === 'vault' ? 'vault' : 'daily' }, new Date().toISOString());
      save(); rerenderKeepScroll(); toast(tr(el.value === 'vault' ? 'Extra goes to the side vault' : 'Extra goes to this month’s spending'));
      return;
    }
    if (el.dataset.reimbDefault) { state.reimbRouting = el.value === 'vault' ? 'vault' : 'daily'; save(); return; }
    if (el.classList && el.classList.contains('pick-main')) { pickerMainChanged(el); return; }
    if (el.dataset.txCat) {
      const tx = state.transactions.find((x) => x.id === el.dataset.txCat);
      if (!tx || !el.value) return;
      const pick = personPick(el.value);
      if (pick) {
        const before = JSON.stringify(state);
        tx.category = Core.isIncome(tx) ? (pick.iou ? 'Money returned' : 'Money received') : tx.category;
        tx.needsReview = false;
        linkPerson(tx, pick);
        save(); rerenderKeepScroll();
        offerUndo(smsNews.join(' · ') || tr('Saved'), before);
        smsNews = [];
        return;
      }
      if (isSmart(el.value)) {
        const before = JSON.stringify(state);
        const msg = applySmart(tx, el.value);
        if (!msg) { state = JSON.parse(before); toast(tr('That doesn’t fit this entry.')); rerenderKeepScroll(); return; }
        tx.needsReview = false;
        save(); rerenderKeepScroll(); offerUndo(msg, before); return;
      }
      const chosen = el.value;
      setCategoryChoice(tx, chosen, false);
      if (tx.category === 'Savings' && Core.isFlexible(tx)) {
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
      if (key) state.merchantRules[key] = chosen;
      save(); toast(key ? tr('Saved. Future payments to {shop} will go to {category}.', { shop: tx.note, category: label(tx.category) + (tx.sub ? ' › ' + tr(tx.sub) : '') }) : tr('Saved')); return;
    }
    if (el.dataset.smsCheck !== undefined) { ui.smsRows[Number(el.dataset.smsCheck)].checked = el.checked; rerenderKeepScroll(); return; }
    if (el.dataset.smsCat !== undefined) { if (el.value) ui.smsRows[Number(el.dataset.smsCat)].parsed.category = el.value; return; }
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
      const goalId = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.goal;
      const date = document.getElementById('sv-date').value || today();
      // If the bank SMS for this transfer is already here, use it instead of adding a second entry.
      let tx = savedTwin(amount, date, true);
      if (tx) { tx.needsReview = false; tx.autoUse = false; }
      else {
        tx = { id: uid(), kind: 'move', date, amount, category: 'Savings', note: document.getElementById('sv-note').value.trim() || 'Savings', source: 'manual', useFor: null };
        state.transactions.push(tx);
      }
      setIncomeUse(tx, use, debtId, goalId);
      learnSaving(tx, use, debtId, goalId);
      save();
      celebrate(rewardMessage(use, amount, debtId, false, goalId));
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
    if (ev.target.id === 'protect-form') {
      ev.preventDefault();
      const name = (document.getElementById('protect-name').value || '').trim();
      if (!name) return;
      const item = Core.addProtect(state, { name });
      ui.protectError = item ? '' : Core.protectList(state).length >= Core.PROTECT_MAX ? tr('Five is the most: remove one to add another.') : tr('That one is already on your list.');
      if (item) { save(); toast(tr('{name} is protected', { name: item.name })); }
      rerenderKeepScroll();
      return;
    }
    if (ev.target.id === 'afford-form') {
      ev.preventDefault();
      const amount = Math.round(Number(document.getElementById('afford-amt').value) || 0);
      ui.afford = amount > 0 ? Core.affordCheck(state, today(), amount) : null;
      ui.affordFor = (document.getElementById('afford-for') || {}).value || null;
      logEvent('afford', { verdict: ui.afford ? ui.afford.verdict : null });
      rerenderKeepScroll();
      return;
    }
    if (ev.target.id !== 'add-tx') return;
    ev.preventDefault();
    const amount = Math.round(Number(document.getElementById('tx-amount').value) || 0);
    if (amount <= 0) return;
    const note = document.getElementById('tx-note').value.trim();
    const choice = document.getElementById('tx-category').value;
    if (!choice) { toast(tr('Choose what it was.')); return; }
    const special = isSmart(choice) || personPick(choice) ? choice : null;
    const category = special ? (ui.txKind === 'in' ? 'Money received' : 'Misc') : Core.splitCat(choice).category;
    const tx = { id: uid(), date: document.getElementById('tx-date').value || today(), amount, category, note, source: 'manual' };
    if (!special && Core.splitCat(choice).sub) tx.sub = Core.splitCat(choice).sub;
    if (ui.txKind === 'in') {
      tx.kind = 'in';
      tx.useFor = null;
      // Borrowed money is for what it was borrowed for: no "what should this do?".
      if (category === LOAN_CATEGORY) { tx.borrowed = true; tx.useFor = 'spend'; }
    }
    const from = document.getElementById(ui.txKind === 'in' ? 'tx-into' : 'tx-from');
    if (from) setFrom(tx, from.value);
    const wasOver = Core.projectRunway(state, today()).overToday > 0;
    const beforeAdd = JSON.stringify(state);
    state.transactions.push(tx);
    // Its bank SMS already in? Then it's this one, not a second payment.
    const linked = joinBankSms(tx, !!special);
    if (special) {
      if (personPick(special)) { if (tx.kind === 'in') tx.useFor = 'spend'; linkPerson(tx, personPick(special)); }
      const msg = personPick(special) ? smsNews.join(' · ') : applySmart(tx, special);
      smsNews = [];
      save(); rerenderKeepScroll();
      if (msg || linked) offerUndo([linked, msg].filter(Boolean).join(' '), beforeAdd); else toast(tr('{amount} added', { amount: inr(amount) }));
      return;
    }
    save();
    if (linked) {
      rerenderKeepScroll();
      offerUndo(linked, beforeAdd);
      return;
    }
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
    if (ev.key === 'Escape') goBack(false);
  });

  /*
   * Back, the same everywhere: Escape, the app's own back, and the phone's
   * back button (MainActivity asks here first). It closes what's open: a
   * pop-up or explanation, then a page, then Profile; with tabs, another tab
   * goes back to Runway. Returns false when there's nothing to close, and
   * the phone then leaves the app as usual.
   */
  function goBack(tabs) {
    if (locked) return false;
    if (ui.explain) { ui.explain = null; rerenderKeepScroll(); return true; }
    if (document.getElementById('onboard-card') && !ui.onboardHidden) { ui.onboardHidden = true; rerenderKeepScroll(); return true; }
    if (ui.help) { ui.helpFrom = ui.help; ui.help = null; rerenderKeepScroll(); return true; }
    if (ui.borrow) { ui.borrow = null; rerenderKeepScroll(); return true; }
    if (document.getElementById('report-card')) { ui.report = false; ui.reportHidden = true; ui.reportThenPay = false; rerenderKeepScroll(); return true; }
    if (ui.reset) { ui.reset = null; rerenderKeepScroll(); return true; }
    if (ui.editTx) { ui.editTx = null; rerenderKeepScroll(); return true; }
    if (ui.tour) { tourEnd(); return true; }
    if (ui.page) { if (history.state && history.state.page) history.back(); else closePage(); return true; }
    if (tab === 'profile') { if (history.state && history.state.profile) history.back(); else closeProfile(); return true; }
    if (tabs && tab !== 'home') { setTab('home'); return true; }
    return false;
  }
  window.hisabBack = () => goBack(true);

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
  // Salary and payday, then today's balance: the rest comes as cards on Runway (setupCard).
  const ONBOARD_STEPS = 2;

  function obValue(id) { return ((document.getElementById(id) || {}).value || '').trim(); }

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
      finishOnboarding();
      return;
    }
    ob.step++;
    ui.onboardFocus = true;
    save();
  }

  function finishOnboarding() {
    delete state.onboarding;
    state.onboarded = true;
    ui.onboardHidden = false;
    save();
    setTab('home');
    celebrate(tr('Today’s limit: {amount}. Now let’s make it exact.', { amount: inr(Core.projectRunway(state, today()).dailyAllowance) }));
  }

  function onboardModal() {
    const ob = state.onboarding;
    if (!ob || ui.onboardHidden || state.isDemo) return '';
    // Set up with the longer form before: what's left comes as cards now.
    if (ob.step > ONBOARD_STEPS) { setTimeout(finishOnboarding, 0); return ''; }
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
    }
    return '<div class="reset-modal-overlay onboard-overlay" role="presentation"><div class="reset-modal-card onboard-card" role="dialog" aria-modal="true" aria-labelledby="ob-title" id="onboard-card" tabindex="-1">' +
      '<div class="ob-progress"><span style="width:' + (((step - 1) / ONBOARD_STEPS) * 100).toFixed(0) + '%"></span></div>' +
      '<span class="eyebrow">' + tr('Step {step} of {total} · about {min} min', { step, total: ONBOARD_STEPS, min: mins }) + '</span>' +
      body + (ui.onboardError ? '<p class="bad" role="alert">' + esc(ui.onboardError) + '</p>' : '') +
      (step <= ONBOARD_STEPS ? '<div class="row"><button class="primary" data-action="onboard-next">' + next + '</button>' +
        (step > 1 ? '<button class="ghost" data-action="onboard-back">' + tr('Back') + '</button>' : '') + '</div>' : '') +
      '<div><button class="link" data-action="onboard-later">' + tr('Finish later') + '</button></div></div></div>';
  }


  // ---------- getting started: one card at a time, and a checklist ----------

  /*
   * After salary, payday and balance (the first-time screen), the rest of the
   * setup comes as one card at a time on Runway: each one question, each
   * showing what it changes in the person's own rupees. "Later" waits a day;
   * "I'll explore myself" turns the cards off. The checklist stays on Runway
   * until everything is done.
   */
  function setupSteps() {
    const none = (state.setup && state.setup.none) || {};
    return [
      { key: 'salary', label: 'Salary and payday', done: !!state.settings.salary },
      { key: 'balance', label: 'Today’s bank balance', done: !!state.balanceCheck },
      { key: 'fixed', label: 'Rent and fixed payments', done: (state.fixed || []).length > 0 || !!none.fixed },
      { key: 'loans', label: 'Loans and EMIs', done: (state.debts || []).length > 0 || (state.cards || []).length > 0 || !!none.loans },
      { key: 'sms', label: 'Bank SMS read for you', done: !!state.smsAuto || !!state.smsReadUntil || state.transactions.some((t) => t.source === 'sms') || !!none.sms, hide: !SmsInbox },
      { key: 'protect', label: 'What matters most', done: Core.protectList(state).length > 0 || !!none.protect },
    ].filter((x) => !x.hide);
  }
  function setupOn() { return !state.isDemo && !!state.settings.salary && !state.onboarding; }

  // The card for the next step, or the "there it is" moment after one.
  function setupCard(r) {
    if (!setupOn()) return '';
    const st = state.setup || {};
    const w = ui.setupWin;
    if (w) {
      const lower = w.to < w.from;
      return '<section class="setup-card setup-win" aria-live="polite"><span class="setup-emoji">🎯</span>' +
        '<b>' + (w.key === 'fixed'
          ? tr(lower ? 'There it is: your real limit.' : 'Done. Your limit stays the same.')
          : tr(lower ? 'With your EMIs in: your real limit.' : 'Done. I’ll warn you before an EMI is due.')) + '</b>' +
        '<div class="setup-roll"><span class="setup-from">' + inr(w.from) + '</span><span aria-hidden="true">→</span>' +
        '<span class="setup-to" data-roll-from="' + Math.round(w.from) + '" data-roll-to="' + Math.round(w.to) + '">' + inr(w.to) + '</span><small>' + tr('a day') + '</small></div>' +
        '<div class="row"><button class="primary" data-action="setup-win-next">' + tr('Next') + '</button></div></section>';
    }
    if (st.off && !ui.setupFocus) return '';
    if (st.laterDay === today() && !ui.setupFocus) return '';
    const steps = setupSteps();
    const step = steps.find((x) => x.key === ui.setupFocus && !x.done) || steps.find((x) => !x.done);
    if (!step) return '';
    const limit = inr(r.dailyAllowance);
    const num = (id, label, ph, extra) => '<label class="field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="number" inputmode="numeric" min="0" placeholder="' + esc(ph) + '"' + (extra || '') + '></label>';
    const foot = (noneText) => '<div class="row setup-foot">' + (noneText ? '<button class="ghost small" data-action="setup-none" data-key="' + step.key + '">' + tr(noneText) + '</button>' : '') +
      '<button class="ghost small" data-action="setup-later">' + tr('Later') + '</button></div>' +
      '<button class="link setup-off" data-action="setup-off">' + tr('I’ll explore myself') + '</button>';
    const card = (emoji, title, text, body, noneText) => '<section class="setup-card" aria-labelledby="setup-title"><span class="setup-emoji">' + emoji + '</span>' +
      '<b id="setup-title">' + title + '</b><span class="setup-dots" aria-hidden="true"><i></i><i></i><i></i></span><p class="setup-text">' + text + '</p>' + body + foot(noneText) + '</section>';
    if (step.key === 'salary' || step.key === 'balance') {
      return card('👋', tr('Let’s finish the basics'), tr('Salary, payday and today’s balance: three numbers and your limit is real.'),
        '<div class="row"><button class="primary" data-action="setup-basics">' + tr('Fill them in') + '</button></div>', '');
    }
    if (step.key === 'fixed') {
      return card('🏠', tr('Rent bhi toh dena hai na?'), tr('Right now I think you can spend {limit} a day. Rent and fixed payments will change that, a lot.', { limit: '<b>' + limit + '</b>' }),
        '<div class="form-grid">' + num('su-rent', tr('Rent or home loan (₹ a month)'), '12000') + num('su-rent-day', tr('Paid on day'), '5', ' max="31"') +
        num('su-other', tr('Other fixed payments (₹ a month)'), tr('school fees, phone, subscriptions')) + '</div>' +
        '<div class="row"><button class="primary" data-action="setup-fixed">' + tr('Add and show my real limit') + '</button></div>', 'I don’t pay rent or fixed payments');
    }
    if (step.key === 'loans') {
      return card('🏦', tr('EMIs: the guests who visit every month 😄'), tr('Add yours and I’ll warn you before one is due, and plan the month around it.'),
        '<div class="form-grid">' + num('su-emi', tr('EMI a month (₹)'), '6000') + num('su-emi-day', tr('Paid on day'), '5', ' max="31"') +
        num('su-left', tr('Left to pay (₹), roughly'), '120000') + num('su-rate', tr('Interest % a year'), '14') + '</div>' +
        '<p class="hint">' + tr('More loans or a credit card? Add them in Debts any time.') + '</p>' +
        '<div class="row"><button class="primary" data-action="setup-loan">' + tr('Add my EMI') + '</button></div>', 'No loans or EMIs');
    }
    if (step.key === 'sms') {
      return card('📩', tr('Shall I read your bank SMS?'), tr('No typing: every UPI and card payment gets added by itself. Messages from friends and family are never read, and nothing leaves your phone.'),
        '<div class="row"><button class="primary" data-action="setup-sms">' + tr('Yes, read them') + '</button></div>', 'I’ll type them myself');
    }
    return card('🛡', tr('What can’t you live without?'), tr('Family, chai, your pet? Tell me, and I’ll never ask you to cut it.'),
      '<div class="row"><button class="primary" data-action="setup-protect">' + tr('Choose') + '</button></div>', 'Skip this');
  }

  // The checklist on Runway: what's done, what's left, one tap to each.
  function setupChecklist() {
    if (!setupOn()) return '';
    const st = state.setup || {};
    const steps = setupSteps();
    const done = steps.filter((x) => x.done).length;
    const all = done === steps.length;
    // Finished outside the cards (the last thing added on its own page): done today, celebrated once.
    if (all && !st.doneAt) {
      state.setup = Object.assign({}, state.setup, { doneAt: today() });
      setTimeout(() => { save(); celebrate(tr('All set: your limit, payments and plan are yours now.')); }, 400);
    }
    if (all && st.doneAt && st.doneAt !== today()) return '';
    if (st.listHidden && !all) return '';
    const pct = Math.round((done / steps.length) * 100);
    const tick = (on, fresh) => '<svg class="setup-tick' + (fresh ? ' fresh' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/>' + (on ? '<path d="M7 12.5l3.2 3.2L17 9"/>' : '') + '</svg>';
    const open = !!st.listOpen && !all;
    return '<section class="card setup-list' + (all ? ' all' : '') + '">' +
      '<button class="setup-list-head" data-action="setup-list" aria-expanded="' + open + '"><b>' + (all ? '🎉 ' + tr('You’re all set') : tr('Getting started · {done} of {n}', { done, n: steps.length })) + '</b>' +
      '<span class="setup-bar"><span style="width:' + pct + '%"></span></span></button>' +
      (open ? '<ul>' + steps.map((x) => '<li class="' + (x.done ? 'done' : '') + '">' + tick(x.done, ui.setupJustDone === x.key) +
        (x.done ? '<span>' + tr(x.label) + '</span>' : '<button class="link" data-action="setup-step" data-key="' + x.key + '">' + tr(x.label) + '</button>') + '</li>').join('') + '</ul>' +
        '<button class="link small" data-action="setup-list-hide">' + tr('Hide the checklist') + '</button>' : '') + '</section>';
  }

  // A number that rolls from the old amount to the new one (the "real limit" moment).
  function rollNumbers() {
    document.querySelectorAll('[data-roll-to]').forEach((el) => {
      const from = Number(el.dataset.rollFrom); const to = Number(el.dataset.rollTo);
      if (REDUCE_MOTION || el.dataset.rolled || from === to) return;
      el.dataset.rolled = '1';
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1100);
        el.textContent = inr(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function setupDone(key, before) {
    const after = Core.projectRunway(state, today()).dailyAllowance;
    state.setup = Object.assign({}, state.setup);
    ui.setupFocus = null;
    ui.setupJustDone = key;
    if (before != null) ui.setupWin = { key, from: Math.round(before), to: Math.round(after) };
    const steps = setupSteps();
    if (steps.every((x) => x.done) && !state.setup.doneAt) {
      state.setup.doneAt = today();
      setTimeout(() => celebrate(tr('All set: your limit, payments and plan are yours now.')), 400);
    }
    save();
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
      const all = smsRows(msgs.map((m) => ({ text: m.body || '', day: Core.toISO(new Date(m.date)) })));
      // A card bill turned into an EMI: offered on the card, not sorted as spending.
      all.filter((r) => r.parsed && r.parsed.type === 'cardemi' && !r.duplicate).forEach((r) => recordSms(r.parsed, { key: r.key }));
      const rows = all.filter((r) => r.parsed && !r.duplicate && !queued.has(r.key) && ['credit', 'statement', 'cardpayment', 'cardemi'].indexOf(r.parsed.type) === -1);
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
      checkAlerts();
      toast(res && res.notifications === false
        ? 'On. Notifications are off for this app in Android settings, so payments will wait here.'
        : 'You’ll get a notification for each new bank SMS');
      rerenderKeepScroll();
    }, () => toast('SMS permission is needed for this. You can allow it in Android settings.'));
  }

  let alertsSent = '';

  /*
   * Whether a notification can really come for a new bank SMS: on in the app,
   * the permission for new messages given, and notifications allowed by
   * Android. Each of these fails without a sound otherwise, so the app says which.
   * ui.alerts: { enabled, receive, notifications } | null (not known yet).
   */
  function checkAlerts() {
    if (!SmsInbox || !SmsInbox.alertsStatus) return;
    Promise.resolve().then(() => SmsInbox.alertsStatus()).then((st) => {
      const before = JSON.stringify(ui.alerts);
      ui.alerts = st || null;
      // On in the data but off on the phone (a restored backup, a reinstall): the phone is right.
      if (st && state.smsAlerts && !st.enabled) { state.smsAlerts = false; save(true); }
      if (JSON.stringify(ui.alerts) !== before) rerenderKeepScroll();
    }).catch(() => {});
  }

  // What's stopping payment notifications, if anything: 'off', 'permission', 'blocked' or ''.
  function alertsProblem() {
    if (!NATIVE || !state.smsAuto) return '';
    const st = ui.alerts;
    if (!state.smsAlerts || (st && !st.enabled)) return 'off';
    if (!st) return '';
    if (!st.receive) return 'permission';
    if (!st.notifications) return 'blocked';
    return '';
  }

  // On Runway and Spend, when notifications are meant to work but can't (or were never turned on).
  function alertsNudge() {
    const box = alertsBox(true);
    return box ? '<section class="card alerts-nudge">' + box + '</section>' : '';
  }

  function alertsBox(nudge) {
    const p = alertsProblem();
    if (nudge && (!p || (p === 'off' && state.alertsNudged))) return '';
    if (!p) {
      return '<div class="callout"><b>' + tr('Notifications for new bank SMS are on') + '</b>' +
        '<span class="hint">' + tr('Each payment shows up as it happens, to sort it right away. Nothing coming? On Samsung, keep Hisab Se out of Sleeping apps (Settings → Battery).') + '</span>' +
        '<div class="row"><button data-action="alerts-test">' + tr('Send a test notification') + '</button><button class="ghost" data-action="alerts-off">' + tr('Turn off') + '</button></div></div>';
    }
    const msg = {
      off: ['Get a notification for each bank payment', 'Reading SMS when you open the app is on, but notifications are off, so payments wait until you open it. Turn them on to sort each one as it happens.', 'Turn on notifications', 'alerts-on'],
      permission: ['Notifications need the SMS permission for new messages', 'Reading old messages is allowed, but not new ones as they arrive. Allow it so each payment comes as a notification.', 'Allow', 'alerts-on'],
      blocked: ['Android is blocking Hisab Se’s notifications', 'Payment notifications are on in the app, but Android doesn’t show them. Allow notifications for Hisab Se (and its Bank SMS channel).', 'Open notification settings', 'alerts-settings'],
    }[p];
    return '<div class="callout warn"><b>' + tr(msg[0]) + '</b><span class="hint">' + tr(msg[1]) + '</span>' +
      '<div class="row"><button class="primary" data-action="' + msg[3] + '">' + tr(msg[2]) + '</button>' +
      (nudge && p === 'off' ? '<button class="ghost" data-action="alerts-nudge-no">' + tr('Not now') + '</button>' : '') + '</div></div>';
  }

  // Gives the notification pop-up the same categories and learned shops as the app.
  function syncAlerts() {
    if (!SmsInbox || !state.smsAlerts) return;
    // The same choices as in the app: subcategories, bills, card bills, EMIs, savings, your own money and People.
    const out = pickerFlat(false).filter((c) => c[0] !== 'Emergency');
    const inn = pickerFlat(true);
    const payload = {
      categories: out.map((c) => c[0]),
      categoryLabels: out.map((c) => c[1]),
      incomeCategories: inn.map((c) => c[0]),
      incomeCategoryLabels: inn.map((c) => c[1]),
      lang: I18N.getLang(),
      rules: state.merchantRules,
      cards: (state.cards || []).map((c) => ({ id: c.id, name: c.name, last4: c.last4 || '' })),
      skipText: state.smsSkipText || [],
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
        if (added) toast(smsNews.length ? smsNews.join(' · ') : tr('{sms} recorded', { sms: plural(added, 'bank SMS', 'bank SMS') }));
        smsNews = [];
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
    checkAlerts();
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
    if (SmsInbox) collectNative();
    const fromHash = (location.hash || '').replace('#', '');
    tab = TABS.indexOf(fromHash) !== -1 ? fromHash : 'home';
    // The tour opens once, the first time the app is opened (with the example numbers).
    let seen = '1';
    try { seen = localStorage.getItem(TOUR_KEY); } catch (e) { /* private mode */ }
    if (!seen && state.isDemo) { ui.tour = true; ui.tourStep = 0; }
    render();
    announceAutoSaved();
    setTimeout(flushCrashes, 5000);
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
