/*
 * Hisab Se (formerly Salary Runway): core calculations.
 *
 * Pure functions only (no DOM, no storage) so they can run in the browser
 * and be tested with Node. Dates are local calendar dates as 'YYYY-MM-DD'.
 */
(function (root) {
  'use strict';

  /*
   * Messages are written in English with {named} values. The app sets a
   * translator (see i18n.js) and a date format; tests use these defaults.
   */
  let tr = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(v, k) ? v[k] : m)) : s);
  let dateLabel = null;
  function setTranslator(fn, dateFn) { tr = fn; dateLabel = dateFn || null; }

  // ---------- dates ----------

  function pad(n) { return String(n).padStart(2, '0'); }

  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function toISO(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  // Day `day` of month m, clamped so "31st" means the last day of short months.
  function clampedDate(y, m, day) {
    const first = new Date(y, m, 1);
    const yy = first.getFullYear();
    const mm = first.getMonth();
    return new Date(yy, mm, Math.min(day, daysInMonth(yy, mm)));
  }

  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  function addMonths(iso, n) {
    const d = parseISO(iso);
    return toISO(clampedDate(d.getFullYear(), d.getMonth() + n, d.getDate()));
  }

  function daysBetween(aIso, bIso) {
    const a = parseISO(aIso);
    const b = parseISO(bIso);
    return Math.round(
      (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
        Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000
    );
  }

  // The salary cycle containing `todayIso`: from the last payday up to (not including) the next.
  function cycleFor(todayIso, payday) {
    const t = parseISO(todayIso);
    let start = clampedDate(t.getFullYear(), t.getMonth(), payday);
    if (start > t) start = clampedDate(t.getFullYear(), t.getMonth() - 1, payday);
    const next = clampedDate(start.getFullYear(), start.getMonth() + 1, payday);
    const s = toISO(start);
    const n = toISO(next);
    return { start: s, next: n, days: daysBetween(s, n) };
  }

  function previousCycle(cycle, payday) {
    return cycleFor(addDays(cycle.start, -1), payday);
  }

  // Date a monthly payment due on `dueDay` falls on inside the cycle (or null).
  function occurrenceInCycle(dueDay, cycle) {
    const s = parseISO(cycle.start);
    let d = clampedDate(s.getFullYear(), s.getMonth(), dueDay);
    if (d < s) d = clampedDate(s.getFullYear(), s.getMonth() + 1, dueDay);
    const iso = toISO(d);
    return iso < cycle.next ? iso : null;
  }

  function inCycle(iso, cycle) { return iso >= cycle.start && iso < cycle.next; }

  // ---------- plan ----------

  const NON_PACE_CATEGORIES = ['Emergency'];

  function sum(list, fn) { return list.reduce((t, x) => t + (fn ? fn(x) : x), 0); }

  function round100(n) { return Math.round(n / 100) * 100; }

  function activeAdjustment(state, todayIso) {
    const a = state.adjustment;
    return a && todayIso < a.until ? a : null;
  }

  function sinkingMonthly(fund) { return Math.round((Number(fund.amount) || 0) / 12); }

  /*
   * Savings goals with a date (a bike's down payment by March): what to put
   * aside each payday to get there in time. Like yearly costs, it comes out of
   * the salary before the flexible budgets. The amount recorded on a payday
   * stays this cycle's amount, so the plan doesn't shift mid-cycle, and a
   * goal added after payday starts on the next one.
   * A date that has passed reserves nothing: the goal asks for a new date.
   */
  function goalStatus(state, g, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const cyc = cycleFor(todayIso, payday);
    const target = Number(g.target) || 0;
    const saved = Number(g.saved) || 0;
    const left = Math.max(0, target - saved);
    const late = !!g.by && g.by < todayIso && left > 0;
    // This cycle's amount already added on payday, or a goal added after payday: it starts next payday.
    const handled = !!(g.added && g.added.cycle === cyc.start);
    const fresh = !handled && !!g.created && g.created > cyc.start;
    let paydays = 0;
    for (let c = handled || fresh ? cycleFor(cyc.next, payday) : cyc; g.by && c.start <= g.by && paydays < 600; c = cycleFor(c.next, payday)) paydays++;
    const perPayday = left > 0 && !late && paydays > 0 ? Math.ceil(left / paydays) : 0;
    const monthly = handled ? Number(g.added.amount) || 0 : fresh ? 0 : perPayday;
    return { target, saved, left, late, fresh, done: target > 0 && left === 0, paydays, perPayday, monthly, pct: target > 0 ? Math.min(100, (saved / target) * 100) : 0 };
  }

  function goalsMonthly(state, todayIso) {
    return sum(state.goals || [], (g) => goalStatus(state, g, todayIso || toISO(new Date())).monthly);
  }

  /*
   * Bills that vary (electricity, gas, water, recharges). Each has an
   * estimate, how many months one payment covers (everyMonths) and the next
   * due date. A share is set aside every month so a 3-month recharge costs
   * the same each month: in months it isn't due the share goes to a pot on
   * payday, and in the month it's due the pot pays the rest.
   */
  function billShare(b) {
    return Math.round((Number(b.estimate) || 0) / Math.max(1, Number(b.everyMonths) || 1));
  }

  /*
   * What the pot holds when the bill is due: a share for each month since
   * the bill was added, up to what one payment needs. A bill added just
   * before it's due has nothing saved yet, so it's paid in full from this
   * month's money. Bills from before `added` was kept count as full.
   */
  function billPot(b, state, iso) {
    const full = billShare(b) * (Math.max(1, Number(b.everyMonths) || 1) - 1);
    if (!b.added || !state || !iso) return full;
    const payday = Number(state.settings.payday) || 1;
    const now = cycleFor(iso, payday).start;
    let months = 0;
    for (let c = cycleFor(b.added, payday); c.start < now && months < 24; c = cycleFor(c.next, payday)) months++;
    return Math.min(full, billShare(b) * months);
  }

  function billsMonthly(state, iso) {
    return sum(billsFor(state, iso), billShare);
  }

  /*
   * Payments that end: an EMI kept as a fixed payment or a bill, with a last
   * due date (lastDue) worked out from how many payments are left. After the
   * last one it's no longer counted, without having to remember to delete it.
   * A bill also ends once the last one is paid (its next due date moves past
   * the last).
   */
  function cycleOf(state, iso) { return iso ? cycleFor(iso, Number(state.settings.payday) || 1) : null; }
  function billEnded(b, cycle) {
    if (!b.lastDue) return false;
    return (!!b.nextDue && b.nextDue > b.lastDue) || (!!cycle && b.lastDue < cycle.start);
  }
  function fixedEnded(f, cycle) { return !!f.lastDue && !!cycle && f.lastDue < cycle.start; }
  function billsFor(state, iso) { const c = cycleOf(state, iso); return (state.bills || []).filter((b) => !billEnded(b, c)); }
  function fixedFor(state, iso) { const c = cycleOf(state, iso); return (state.fixed || []).filter((f) => !fixedEnded(f, c)); }
  function fixedTotal(state, iso) { return sum(fixedFor(state, iso), (f) => Number(f.amount) || 0); }

  /*
   * Recording a fixed payment as paid. The payment covers one due date
   * (forDue): the first one not yet paid, from the month of the payment on, so
   * paying early (the 28th for the 1st) or late (the 5th for the 1st) both
   * work. That due date's assumed payment is then dropped, and the money
   * leaves on the day it really did, at the amount really paid.
   */
  function fixedPaidFor(state, f, due) {
    return state.transactions.some((t) => (t.fixedId === f.id || t.emiFor === f.id) && t.forDue === due);
  }
  // Loans whose EMI leaves the account (not through a card bill).
  function emiLoans(state) {
    return (state.debts || []).filter((d) => d.balance > 0 && Number(d.minPayment) > 0 && !d.viaCard && !d.fromCard);
  }
  // The due date a payment on iso covers: the nearest one not yet recorded as paid (a later one on a tie).
  function fixedDueFor(state, f, iso) {
    const payday = Number(state.settings.payday) || 1;
    const here = cycleFor(iso, payday);
    const dues = [previousCycle(here, payday), here, cycleFor(here.next, payday)]
      .map((c) => occurrenceInCycle(Number(f.dueDay) || 1, c))
      .filter((due) => due && !(f.lastDue && due > f.lastDue) && !fixedPaidFor(state, f, due) && !(f.starts && due < f.starts));
    dues.sort((a, b) => Math.abs(daysBetween(iso, a)) - Math.abs(daysBetween(iso, b)) || (a < b ? 1 : -1));
    return dues[0] || null;
  }
  // txId: an entry already recorded (an SMS, say) becomes this payment; otherwise a new one is added.
  function payFixed(state, fixedId, opts) {
    const loan = emiLoans(state).find((x) => x.id === fixedId);
    const f = loan || (state.fixed || []).find((x) => x.id === fixedId);
    if (!f) return null;
    const o = opts || {};
    let tx = o.txId ? state.transactions.find((x) => x.id === o.txId) : null;
    if (o.txId && (!tx || !isFlexible(tx) || (tx.paidFrom && tx.paidFrom !== 'account') || tx.claimId || tx.maybeId || tx.covered || tx.iouId)) return null;
    const due = fixedDueFor(state, f, tx ? tx.date : o.date);
    if (!due) return null;
    if (!tx) {
      const amount = Math.round(Number(o.amount));
      if (!(amount > 0) || amount > 1e9 || !o.date) return null;
      tx = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: o.date, amount, category: 'Bills', note: f.name, source: 'manual', fixedNew: true };
      state.transactions.push(tx);
    }
    if (loan) {
      // Bank rule: each EMI first pays the month's interest on what's owed; the rest pays the loan down.
      tx.emiFor = loan.id;
      tx.emiInterest = Math.min(tx.amount, Math.round(((Number(loan.balance) || 0) * (Number(loan.rate) || 0)) / 1200));
      tx.emiPrincipal = tx.amount - tx.emiInterest;
    } else tx.fixedId = f.id;
    tx.forDue = due;
    return tx;
  }
  // Not a fixed payment after all: an added one goes, a recorded one is ordinary spending again.
  function unpayFixed(state, tx) {
    if (!tx || !isFixedPayment(tx)) return;
    if (tx.fixedNew) { state.transactions = state.transactions.filter((x) => x !== tx); return; }
    delete tx.fixedId; delete tx.emiFor; delete tx.emiInterest; delete tx.emiPrincipal; delete tx.forDue;
  }
  /*
   * Payments that look like a fixed payment not yet recorded: the same amount
   * (within 2%), from the account, in the 10 days before its due date or up
   * to 15 days after.
   */
  function fixedMatches(state, todayIso) {
    const out = [];
    state.transactions.forEach((t) => {
      if (!isFlexible(t) || t.notFixed || (t.paidFrom && t.paidFrom !== 'account') || t.claimId || t.maybeId || t.covered || t.iouId) return;
      if (t.date > todayIso || t.date < addDays(todayIso, -20)) return;
      (state.fixed || []).concat(emiLoans(state)).forEach((f) => {
        const amt = Number(f.minPayment != null ? f.minPayment : f.amount) || 0;
        if (!(amt > 0) || Math.abs(t.amount - amt) > amt * 0.02) return;
        const due = fixedDueFor(state, f, t.date);
        if (due && daysBetween(t.date, due) <= 10 && daysBetween(due, t.date) <= 15) out.push({ tx: t, fixed: f, due, loan: f.minPayment != null });
      });
    });
    return out;
  }

  // The next due date of a fixed payment on or after iso.
  function nextFixedDue(f, iso) {
    const d = parseISO(iso);
    let due = toISO(clampedDate(d.getFullYear(), d.getMonth(), Number(f.dueDay) || 1));
    if (due < iso) due = toISO(clampedDate(d.getFullYear(), d.getMonth() + 1, Number(f.dueDay) || 1));
    return due;
  }

  // How many payments are left, the next one included (null: no end set).
  function paymentsLeft(item, isBill, iso) {
    if (!item.lastDue) return null;
    const first = isBill ? item.nextDue : nextFixedDue(item, iso);
    if (!first || first > item.lastDue) return 0;
    const every = isBill ? Math.max(1, Number(item.everyMonths) || 1) : 1;
    const a = parseISO(first); const b = parseISO(item.lastDue);
    return Math.floor(((b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()) / every) + 1;
  }

  // The last due date from how many are left (the next one included); 0 or blank: no end.
  function lastDueFrom(item, isBill, left, iso) {
    const n = Math.round(Number(left) || 0);
    if (!(n > 0)) return null;
    const first = isBill ? item.nextDue || iso : nextFixedDue(item, iso);
    return addMonths(first, (n - 1) * (isBill ? Math.max(1, Number(item.everyMonths) || 1) : 1));
  }

  function billPaidIn(state, b, cycle) {
    return state.transactions.find((t) => t.billId === b.id && inCycle(t.date, cycle)) || null;
  }

  // A bill is due this cycle if its next due date is before the next payday (overdue included).
  function billDue(b, cycle) {
    return !billEnded(b, cycle) && !!b.nextDue && b.nextDue < cycle.next;
  }

  /*
   * Records a bill payment. `months` is how long it covers (a recharge can be
   * 1 month one time and 3 the next). The bill learns its typical monthly
   * cost from the last three payments, and the next due date moves on from
   * the due date (or from the payment date if paid far from it). Returns the
   * transaction, which keeps what it changed so a delete can undo it.
   */
  function payBill(state, billId, amount, months, dateIso) {
    const b = (state.bills || []).find((x) => x.id === billId);
    if (!b) return null;
    months = Math.max(1, Number(months) || 1);
    amount = Math.round(Number(amount) || 0);
    const tx = {
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: dateIso, amount, category: 'Bills', note: b.name, billId: b.id, source: 'manual',
      fromPot: Math.min(amount, billPot(b, state, dateIso)),
      undo: { estimate: b.estimate, everyMonths: b.everyMonths, nextDue: b.nextDue, history: (b.history || []).slice() },
    };
    const perMonth = amount / months;
    b.history = (b.history || []).concat(perMonth).slice(-3);
    b.everyMonths = months;
    b.estimate = Math.round((sum(b.history) / b.history.length) * months);
    const near = b.nextDue && Math.abs(daysBetween(b.nextDue, dateIso)) <= 15;
    // The bill's own day (the 31st), so a short month doesn't move it for good.
    if (!b.day && b.nextDue) b.day = parseISO(b.nextDue).getDate();
    const from = parseISO(near ? b.nextDue : dateIso);
    b.nextDue = toISO(clampedDate(from.getFullYear(), from.getMonth() + months, near && b.day ? b.day : from.getDate()));
    state.transactions.push(tx);
    return tx;
  }

  function undoBillPayment(state, tx) {
    const b = (state.bills || []).find((x) => x.id === tx.billId);
    if (b && tx.undo) Object.assign(b, tx.undo);
  }

  // ---------- pay ----------

  /*
   * What came in this cycle. On payday the user records the in-hand amount
   * (state.payslips[cycle start] = { amount, usual, reason, note }). A smaller
   * amount is what the month is planned on; anything above the usual pay is
   * recorded as money received, so the user decides what it does.
   */
  /*
   * A credit that is the salary even without the word in the SMS ("NEFT
   * credited by ACME PVT LTD"): close to the usual pay (80% to 150% of it),
   * within 3 days of payday (early when payday falls on a holiday), and the
   * first one this month. A loan credit never is.
   */
  function looksLikeSalary(state, p) {
    if (!p || p.type !== 'credit') return false;
    if (p.salary) return true;
    const usual = Number(state.settings.salary) || 0;
    const amount = Number(p.amount) || 0;
    if (!(usual > 0) || amount < usual * 0.8 || amount > usual * 1.5 || isLoanCredit(p.raw || '')) return false;
    const payday = Number(state.settings.payday) || 1;
    const cyc = cycleFor(p.date, payday);
    const near = daysBetween(cyc.start, p.date) <= 3 ? cyc : daysBetween(p.date, cyc.next) <= 3 ? cycleFor(cyc.next, payday) : null;
    if (!near) return false;
    return !(state.salarySeen && state.salarySeen.cycle === near.start);
  }

  function salaryFor(state, todayIso) {
    const usual = Number(state.settings.salary) || 0;
    if (!todayIso) return usual;
    const slip = (state.payslips || {})[cycleFor(todayIso, Number(state.settings.payday) || 1).start];
    return slip && Number(slip.amount) < usual ? Number(slip.amount) : usual;
  }

  /*
   * Pay over the last `n` cycles, oldest first: amount, usual pay, the
   * difference and its reason. Cycles without a record count as usual pay.
   */
  function salaryHistory(state, todayIso, n) {
    const payday = Number(state.settings.payday) || 1;
    const out = [];
    let c = cycleFor(todayIso, payday);
    for (let i = 0; i < (n || 12); i++) {
      const slip = (state.payslips || {})[c.start];
      const usual = slip ? Number(slip.usual) || 0 : Number(state.settings.salary) || 0;
      const amount = slip ? Number(slip.amount) || 0 : usual;
      out.unshift({ start: c.start, amount, usual, diff: amount - usual, reason: slip ? slip.reason || '' : '', note: slip ? slip.note || '' : '', recorded: !!slip });
      c = previousCycle(c, payday);
    }
    return out;
  }

  // The month's money, line by line, with any emergency adjustments applied.
  // Loans paid this round: one whose first payment is next round (just borrowed, or a card EMI starting with the next bill) waits.
  function debtsThisRound(state, todayIso) {
    const next = todayIso ? cycleFor(todayIso, Number(state.settings.payday) || 1).next : null;
    return state.debts.filter((d) => d.balance > 0 && !(next && d.starts && d.starts >= next));
  }

  function monthlyPlan(state, todayIso) {
    const adj = activeAdjustment(state, todayIso);
    const alloc = allocate(state, todayIso);
    const sv = alloc.savings;
    const salary = salaryFor(state, todayIso);
    const fixedSum = fixedTotal(state, todayIso);
    const debtMin = sum(debtsThisRound(state, todayIso), (d) => Number(d.minPayment) || 0);
    const emergency = sv.emergencyMonthly;
    const invest = adj && adj.pauseInvest ? 0 : sv.investMonthly;
    const debtExtra = adj && adj.pauseDebtExtra ? 0 : sv.debtExtra;
    const sinking = sum(state.sinking, sinkingMonthly);
    const goals = goalsMonthly(state, todayIso);
    const variableBills = billsMonthly(state, todayIso);
    const cut = adj ? adj.flexCutPct : 0;
    const budgets = alloc.budgets.map((b) => ({
      name: b.name,
      auto: b.auto,
      base: b.amount,
      amount: Math.round(b.amount * (1 - cut / 100)),
    }));
    const flexTotal = sum(budgets, (b) => b.amount);
    const savingsTotal = emergency + invest + debtExtra + sinking + goals;
    const allocated = fixedSum + debtMin + variableBills + savingsTotal + flexTotal;
    return {
      salary, fixedTotal: fixedSum, debtMin, variableBills, emergency, invest, debtExtra, sinking, goals,
      budgets, flexTotal, savingsTotal, allocated,
      unallocated: salary - allocated,
      adjustment: adj,
      notes: sv.notes,
    };
  }

  /*
   * Money leaving on set dates inside the cycle: fixed payments, debt
   * minimums and bills that vary. An unpaid bill that is due shows on its due
   * date (or today if overdue) for its estimate less the pot; a bill not due
   * this cycle puts its monthly share in the pot on payday.
   */
  function cycleEvents(state, cycle, todayIso) {
    const events = [];
    (state.cards || []).forEach((c) => {
      cardLegacyEvents(state, c, todayIso || cycle.start).forEach((e) => {
        let date = e.date < cycle.start ? cycle.start : e.date;
        if (todayIso && date < todayIso) date = todayIso;
        if (date < cycle.next) events.push(Object.assign({}, e, { date }));
      });
    });
    (state.bills || []).forEach((b) => {
      // A bill with no amount yet (just added, ₹0) has nothing to pay or set aside.
      if (!((Number(b.estimate) || 0) > 0) || billPaidIn(state, b, cycle) || billEnded(b, cycle)) return;
      if (billDue(b, cycle)) {
        let date = b.nextDue < cycle.start ? cycle.start : b.nextDue;
        if (todayIso && date < todayIso) date = todayIso;
        events.push({ date, name: b.name, amount: Math.max(0, (Number(b.estimate) || 0) - billPot(b, state, cycle.start)), kind: 'bill', billId: b.id });
      } else if (billShare(b) > 0 && !(b.lastDue && b.lastDue < cycle.next)) {
        events.push({ date: cycle.start, name: tr('Set aside for {name}', { name: b.name }), amount: billShare(b), kind: 'billpot', billId: b.id });
      }
    });
    state.fixed.forEach((f) => {
      const date = occurrenceInCycle(Number(f.dueDay) || 1, cycle);
      if (date && !(f.lastDue && date > f.lastDue) && !fixedPaidFor(state, f, date)) events.push({ date, name: f.name, amount: Number(f.amount) || 0, kind: 'fixed', fixedId: f.id });
    });
    state.debts.filter((d) => d.balance > 0).forEach((d) => {
      // Paid through a card bill: it leaves on the card's due day.
      const card = d.viaCard && (state.cards || []).find((c) => c.id === d.viaCard);
      const date = occurrenceInCycle(Number(card ? card.dueDay : d.dueDay) || 1, cycle);
      // A card EMI starts with the card's next bill.
      if (date && (!d.starts || date >= d.starts) && !fixedPaidFor(state, d, date)) events.push({ date, name: d.name, amount: Number(d.minPayment) || 0, kind: 'debt', debtId: d.id });
    });
    // Money promised back to a friend before payday, unless what's promised to you covers it.
    if (todayIso) iouEvents(state, cycle, todayIso).forEach((e) => events.push(e));
    return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /*
   * Transaction kinds: spending (no kind), 'in' (money received), 'move'
   * (unspent money moved to savings or a loan), and bill payments (billId).
   * Flexible spending, the kind budgets and the pace are about, is only the first.
   */
  function isIncome(t) { return t.kind === 'in'; }
  function isMove(t) { return t.kind === 'move'; }
  function isBillPayment(t) { return !!t.billId; }
  // A fixed payment recorded as paid (rent, a class fee): it leaves on its own day, and that month's assumed payment is dropped.
  // A loan EMI recorded as paid (emiFor) is the same kind: that month's assumed EMI is dropped.
  function isFixedPayment(t) { return !!t.fixedId || !!t.emiFor; }
  // Paying a card bill, or moving a card balance to a loan, only moves money
  // between your account and the card: the spending was counted when it happened.
  function isCardTransfer(t) { return t.kind === 'cardpay' || t.kind === 'cardconvert'; }
  // Money moved between your own wallets (bank to cash at an ATM, bank to Paytm): neither spending nor income.
  function isTransfer(t) { return t.kind === 'transfer'; }
  // Money passed on (₹26,000 from a friend straight to a brother): neither income nor spending.
  function isPassedOn(t) { return !!t.passedOn || !!t.iouId || !!t.iouPay; }
  // Cash taken on a credit card: borrowed on the card and now in hand, not spent yet.
  function isCashAdvance(t) { return !!t.cashAdvance; }
  function isFlexible(t) { return !isIncome(t) && !isMove(t) && !isBillPayment(t) && !isFixedPayment(t) && !isCashAdvance(t) && !isCardTransfer(t) && !isTransfer(t) && !isPassedOn(t); }

  function spendInRange(transactions, cycle) {
    return transactions.filter((t) => isFlexible(t) && inCycle(t.date, cycle));
  }

  function incomeInRange(transactions, cycle) {
    return transactions.filter((t) => isIncome(t) && !isPassedOn(t) && inCycle(t.date, cycle));
  }

  /*
   * Money in and the same amount out within 3 days (₹26,000 from a friend,
   * ₹26,000 to a brother): probably passed on. Returns the newest such pair
   * not yet answered, or null. Salary and small amounts aren't asked about.
   */
  function passThroughPair(state, todayIso) {
    const no = state.passNo || [];
    const from = addDays(todayIso, -10);
    const ins = state.transactions.filter((t) => isIncome(t) && !isPassedOn(t) && t.date >= from && t.date <= todayIso &&
      t.amount >= 1000 && !t.salary && t.category !== 'Salary' && no.indexOf(t.id) === -1)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const near = (i, x) => Math.abs(x - i.amount) <= Math.max(1, i.amount * 0.01);
    for (const i of ins) {
      const close = state.transactions.filter((t) => isFlexible(t) && !t.splitOf && no.indexOf(t.id) === -1 && Math.abs(daysBetween(i.date, t.date)) <= 3)
        .sort((a, b) => Math.abs(daysBetween(i.date, a.date)) - Math.abs(daysBetween(i.date, b.date)));
      const one = close.find((t) => near(i, t.amount));
      if (one) return { in: i, out: one, outs: [one] };
      // Paid on in parts (two train tickets for ₹5,000 received): 2 or 3 payments adding up to it.
      const parts = close.filter((t) => t.amount < i.amount).slice(0, 12);
      for (let a = 0; a < parts.length; a++) {
        for (let b = a + 1; b < parts.length; b++) {
          if (near(i, parts[a].amount + parts[b].amount)) return { in: i, out: parts[a], outs: [parts[a], parts[b]] };
          for (let c = b + 1; c < parts.length; c++) {
            if (near(i, parts[a].amount + parts[b].amount + parts[c].amount)) return { in: i, out: parts[a], outs: [parts[a], parts[b], parts[c]] };
          }
        }
      }
    }
    return null;
  }

  // Marks the pair as passed on; undone by clearing passedOn on both.
  // outIds: one id, or several ("a,b") when it was paid on in parts. Each part points at the money in.
  function passOn(state, inId, outIds) {
    const i = state.transactions.find((t) => t.id === inId);
    const outs = String(outIds || '').split(',').map((id) => state.transactions.find((t) => t.id === id)).filter(Boolean);
    if (!i || !outs.length) return false;
    i.passedOn = outs[0].id;
    outs.forEach((o) => { o.passedOn = i.id; o.needsReview = false; });
    i.useFor = i.useFor || 'spend';
    i.needsReview = false;
    return true;
  }
  // Undoes a pass-through from any of its entries; returns the entries it freed.
  function unpassOn(state, x) {
    if (!x || !x.passedOn) return [];
    const i = isIncome(x) ? x : state.transactions.find((t) => t.id === x.passedOn);
    const all = state.transactions.filter((t) => t === i || (i && t.passedOn === i.id) || t === x);
    all.forEach((t) => { delete t.passedOn; });
    return all;
  }

  // ---------- money between you and people you know ----------

  /*
   * An IOU: money borrowed from or lent to a friend or family member. No EMI,
   * no fixed schedule: paid back all at once or in chunks of any size, maybe
   * by a promised date, rarely with interest (added as a rupee amount).
   *   { id, name, dir: 'owe' (you owe them) | 'lent' (they owe you), amount,
   *     paid, promised: iso | null, created, payments: [{ date, amount, txId }] }
   * The money itself moves in ordinary entries tagged with iouId, which are
   * neither income nor spending.
   */
  function iouLeft(i) { return Math.max(0, Math.round((Number(i.amount) || 0) - (Number(i.paid) || 0))); }
  function openIous(state, dir) {
    return (state.iou || []).filter((i) => iouLeft(i) > 0 && (!dir || i.dir === dir));
  }

  function addIou(state, o, todayIso) {
    const i = { id: newId('iou'), name: String(o.name || '').trim() || 'Someone', dir: o.dir === 'lent' ? 'lent' : 'owe',
      amount: Math.round(Number(o.amount) || 0), paid: 0, promised: o.promised || null, created: todayIso, payments: [] };
    if (!(i.amount > 0)) return null;
    state.iou = (state.iou || []).concat(i);
    if (o.txId) {
      const tx = state.transactions.find((t) => t.id === o.txId);
      if (tx) { tx.iouId = i.id; tx.needsReview = false; }
    }
    return i;
  }

  // A repayment, of any size: ties the entry that moved the money (if any) to the IOU.
  function payIou(state, iouId, amount, dateIso, txId) {
    const i = (state.iou || []).find((x) => x.id === iouId);
    if (!i) return null;
    const a = Math.min(Math.round(Number(amount) || 0), iouLeft(i));
    if (!(a > 0)) return null;
    i.paid = (Number(i.paid) || 0) + a;
    i.payments = (i.payments || []).concat({ date: dateIso, amount: a, txId: txId || null });
    if (txId) {
      const tx = state.transactions.find((t) => t.id === txId);
      if (tx) { tx.iouPay = i.id; tx.needsReview = false; }
    }
    return i;
  }

  // Undoes what a deleted entry did to an IOU: a repayment comes off; the entry that started one ends it.
  function undoIouTx(state, tx) {
    if (tx.iouPay) {
      const i = (state.iou || []).find((x) => x.id === tx.iouPay);
      if (i) {
        i.paid = Math.max(0, (Number(i.paid) || 0) - (Number(tx.amount) || 0));
        i.payments = (i.payments || []).filter((p) => p.txId !== tx.id);
      }
    }
    if (tx.iouId) state.iou = (state.iou || []).filter((x) => x.id !== tx.iouId);
  }

  /*
   * What you owe people and what they owe you. Money you owe with a promised
   * date before payday is a payment to come, unless what someone promised to
   * give back first covers it (the brother returns ₹26,000 tomorrow, the
   * friend gets it the same day). What they owe you is never counted until
   * it comes back.
   */
  function iouSummary(state, todayIso) {
    const owe = openIous(state, 'owe');
    const lent = openIous(state, 'lent');
    const oweTotal = sum(owe, iouLeft);
    const lentTotal = sum(lent, iouLeft);
    return { owe, lent, oweTotal, lentTotal, net: lentTotal - oweTotal,
      late: (state.iou || []).filter((i) => iouLeft(i) > 0 && i.promised && i.promised < todayIso) };
  }
  function iouEvents(state, cycle, todayIso) {
    // A promise back that's late still covers: what you owe waits on it (the brother is late, so the friend waits),
    // until you record the money or change the date ("Not yet" asks for a new one).
    const lentBy = (date) => sum(openIous(state, 'lent').filter((i) => i.promised && i.promised <= date), iouLeft);
    let covered = 0;
    return openIous(state, 'owe').filter((i) => i.promised && i.promised < cycle.next)
      .sort((a, b) => (a.promised < b.promised ? -1 : 1))
      .map((i) => {
        // Covered first by what's promised back by then.
        const cover = Math.max(0, Math.min(iouLeft(i), lentBy(i.promised) - covered));
        covered += cover;
        const date = i.promised < todayIso ? todayIso : i.promised;
        return { date, name: i.name, amount: iouLeft(i) - cover, kind: 'iou', iouId: i.id };
      })
      .filter((e) => e.amount > 0);
  }

  /*
   * A refund to a card for something bought on it this month (same shop,
   * not more than was paid): the purchase gets smaller, so it cancels the
   * spending in its budget, the reports and the card bill instead of
   * counting as income. Returns the purchase, or null when there's none
   * (bought last month or before the app): then it's money in, as before.
   */
  function refundToPurchase(state, cardId, refund, todayIso) {
    const amount = Math.round(Number(refund.amount) || 0);
    const shop = normalizeMerchant(refund.merchant || '');
    if (!cardId || !(amount > 0) || !shop) return null;
    const cyc = cycleFor(refund.date || todayIso, Number(state.settings.payday) || 1);
    const buy = state.transactions
      .filter((t) => isFlexible(t) && t.paidFrom === cardId && inCycle(t.date, cyc) && t.date <= (refund.date || todayIso) &&
        normalizeMerchant(t.note || '') === shop && t.amount >= amount && !(t.covered > 0))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
    if (!buy) return null;
    buy.refunds = (buy.refunds || []).concat({ date: refund.date || todayIso, amount, smsKey: refund.key || null });
    buy.amount -= amount;
    return buy;
  }

  // Takes a refund back off a purchase (the purchase costs what it did again).
  function undoRefund(state, buy, i) {
    const r = (buy.refunds || [])[i];
    if (!r) return null;
    buy.amount += r.amount;
    buy.refunds = buy.refunds.filter((x, j) => j !== i);
    if (!buy.refunds.length) delete buy.refunds;
    return r;
  }

  /*
   * Money received and given to the emergency fund, a goal or Grow stays in
   * the account (it isn't moved anywhere): a bank balance entered later holds
   * it, so it's taken out of that balance, as far as the fund still has it.
   * Savings moved out (Jar, a SIP) aren't in the account and don't count.
   */
  function earmarkedIn(state, iso) {
    const ins = state.transactions.filter((t) => isIncome(t) && t.date <= iso && !isPassedOn(t));
    const of = (use, id) => sum(ins.filter((t) => t.useFor === use && (!id || t.goalId === id)), (t) => t.amount);
    const sv = state.savings || {};
    return Math.min(of('emergency'), Number(sv.emergencyBalance) || 0) + Math.min(of('grow'), Number(sv.investSaved) || 0) +
      sum(state.goals || [], (g) => Math.min(of('goal', g.id), Number(g.saved) || 0));
  }

  /*
   * The accuracy meter: each time the bank balance is entered, what the app
   * had counted against what the bank says. Accuracy over the last checks is
   * 100% less the gaps as a share of the money: (1 − Σ|gap| ÷ Σ bank balance).
   * { pct, checks, avgGap, list } or null with no checks yet.
   */
  function accuracyStats(log, n) {
    const list = (log || []).filter((x) => Number.isFinite(Number(x.expected)) && Number.isFinite(Number(x.actual))).slice(-(n || 10));
    if (!list.length) return null;
    const gaps = sum(list, (x) => Math.abs(Number(x.expected) - Number(x.actual)));
    const money = sum(list, (x) => Math.max(Math.abs(Number(x.actual)), Math.abs(Number(x.expected))));
    const pct = money > 0 ? Math.max(0, Math.min(100, Math.round((1 - gaps / money) * 1000) / 10)) : 100;
    return { pct, checks: list.length, avgGap: Math.round(gaps / list.length), list: list.map((x) => Object.assign({}, x, { gap: Math.round(Number(x.expected) - Number(x.actual)) })) };
  }

  // What a spending entry costs your own budgets: less what a gift kept for it paid.
  // Spending that's yours in reports: less what's claimed back from work (a gift-kept purchase is still shown).
  function personalAmt(t) { return (Number(t.amount) || 0) - (Number(t.reimbExcluded) || 0) - (Number(t.refunded) || 0); }
  // A payment for a maybe expense (t.maybeId) was paid from money held for it: not daily spending.
  function ownPart(t) { return t.maybeId ? 0 : Math.max(0, (Number(t.amount) || 0) - (Number(t.covered) || 0) - (Number(t.reimbExcluded) || 0) - (Number(t.refunded) || 0)); }

  /*
   * A refund or a reversal into the account, for a purchase from the account
   * this round, offsets that purchase (bank rule: it isn't income). The money
   * comes back on its own day, so the balance stays right; the purchase's
   * spending (budgets, reports) drops by it. A refund for an earlier round's
   * purchase stays money in for this round, never earned income.
   */
  function refundable(state, buy) {
    return isFlexible(buy) && !(buy.paidFrom && buy.paidFrom !== 'account') && !buy.maybeId && !buy.claimId &&
      buy.amount - (Number(buy.covered) || 0) - (Number(buy.refunded) || 0) > 0;
  }
  function linkRefund(state, inId, buyId) {
    const r = state.transactions.find((t) => t.id === inId);
    const buy = state.transactions.find((t) => t.id === buyId);
    if (!r || !buy || !isIncome(r) || r.refundOf || r.payoutId || r.iouId || r.iouPay || r.passedOn || r.borrowed || (r.paidFrom && r.paidFrom !== 'account')) return false;
    if (!refundable(state, buy) || r.date < buy.date) return false;
    const payday = Number(state.settings.payday) || 1;
    if (cycleFor(r.date, payday).start !== cycleFor(buy.date, payday).start) return false;
    const room = buy.amount - (Number(buy.covered) || 0) - (Number(buy.refunded) || 0);
    if (r.amount > room) return false;
    buy.refunded = (Number(buy.refunded) || 0) + r.amount;
    r.refundOf = buy.id;
    r.useFor = 'spend';
    r.needsReview = false;
    return true;
  }
  function unlinkRefund(state, r) {
    if (!r || !r.refundOf) return;
    const buy = state.transactions.find((t) => t.id === r.refundOf);
    if (buy) { buy.refunded = Math.max(0, (Number(buy.refunded) || 0) - r.amount); if (!buy.refunded) delete buy.refunded; }
    delete r.refundOf;
  }
  // A purchase deleted: its refunds are money in again.
  function forgetRefunds(state, buy) {
    if (buy && buy.refunded) state.transactions.forEach((t) => { if (t.refundOf === buy.id) delete t.refundOf; });
  }
  /*
   * Money in that looks like a refund or reversal of a purchase this round:
   * named a refund or reversal, the same shop (or the same amount within 7
   * days), no more than is left of the purchase. Asked, never assumed.
   */
  function refundMatches(state, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const out = [];
    state.transactions.forEach((r) => {
      if (!isIncome(r) || r.refundOf || r.notRefund || r.payoutId || r.iouId || r.iouPay || r.passedOn || r.borrowed || (r.paidFrom && r.paidFrom !== 'account')) return;
      if (r.category !== 'Refund' || r.date > todayIso || r.date < addDays(todayIso, -30)) return;
      const cyc = cycleFor(r.date, payday);
      const shop = normalizeMerchant(r.note || '');
      const buy = state.transactions.filter((b) => refundable(state, b) && inCycle(b.date, cyc) && b.date <= r.date &&
        b.amount - (Number(b.covered) || 0) - (Number(b.refunded) || 0) >= r.amount &&
        ((shop && normalizeMerchant(b.note || '') === shop) || (b.amount === r.amount && daysBetween(b.date, r.date) <= 7)))
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (buy) out.push({ refund: r, buy });
    });
    return out;
  }

  // ---------- money in: earned or not ----------

  /*
   * Earned income: pay and what you earn (salary, overtime, side income,
   * interest). Only these count: loans and borrowing, money back from
   * friends, reimbursements, refunds, reversals and cashback, money from your
   * own accounts or savings, gifts, and money of unknown kind are money in,
   * never earned (bank rule: cash in isn't income by itself).
   */
  const EARNED = ['Side income', 'Overtime', 'Salary', 'Bonus', 'Interest'];
  function isEarned(t) {
    return isIncome(t) && EARNED.indexOf(t.category) !== -1 && !t.borrowed && !t.refundOf && !t.payoutId && !t.iouId && !t.iouPay && !t.passedOn &&
      t.useFor !== 'fromfund' && t.useFor !== 'fromgrow' && t.note !== 'Own account';
  }
  function earnedIn(state, from, to) {
    return sum(state.transactions.filter((t) => isEarned(t) && t.date >= from && t.date <= to), (t) => t.amount);
  }

  // ---------- maybe expenses ----------

  /*
   * Costs that may come: a wedding gift, a bike repair, a doctor's visit.
   * { id, name, amount, date, likely: 'likely' | 'maybe' | 'unlikely', category, created,
   *   outcome: null | { happened, txId, date } }.
   * - Likely ones due this round (or overdue) are held, like money kept aside,
   *   so today's limit is already safe if they come.
   * - Maybe ones change nothing; the app shows today's limit if they happen.
   * - Unlikely ones are only listed.
   * A cost either comes in full or not at all, so none is counted at half.
   * When its date has passed, the app asks whether it happened: a payment
   * linked to it shows in reports but isn't daily spending (its money was held).
   */
  const MAYBE_LIKELY = ['likely', 'maybe', 'unlikely'];
  function maybeOpen(state) {
    return (state.maybe || []).filter((m) => m && !m.outcome && Number(m.amount) > 0 && MAYBE_LIKELY.indexOf(m.likely) !== -1);
  }
  // Held today: likely costs open and due before payday, overdue ones included.
  function maybeHeld(state, todayIso) {
    const cyc = cycleFor(todayIso, Number(state.settings.payday) || 1);
    return sum(maybeOpen(state).filter((m) => m.likely === 'likely' && m.date < cyc.next), (m) => Math.round(Number(m.amount)));
  }
  // Due or past its date: time to ask whether it happened.
  function maybeDue(state, todayIso) {
    return maybeOpen(state).filter((m) => m.date <= todayIso).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // Today's limit if the 'maybe' costs due before payday all come (null when there are none).
  function maybeIfHappens(state, todayIso) {
    const cyc = cycleFor(todayIso, Number(state.settings.payday) || 1);
    const these = maybeOpen(state).filter((m) => m.likely === 'maybe' && m.date < cyc.next);
    if (!these.length) return null;
    const ids = these.map((m) => m.id);
    const what = Object.assign({}, state, { maybe: (state.maybe || []).map((m) => (ids.indexOf(m.id) !== -1 ? Object.assign({}, m, { likely: 'likely' }) : m)) });
    return { amount: sum(these, (m) => Math.round(Number(m.amount))), count: these.length, limit: projectRunway(what, todayIso).dailyAllowance };
  }
  function addMaybe(state, m, nowIso) {
    const amount = Math.round(Number(m.amount));
    if (!(amount > 0) || amount > 1e9 || !m.date || MAYBE_LIKELY.indexOf(m.likely) === -1) return null;
    const x = { id: 'm' + Math.random().toString(36).slice(2, 10), name: String(m.name || '').trim().slice(0, 40) || 'Maybe expense', amount, date: m.date,
      likely: m.likely, category: m.category || 'Misc', created: nowIso, outcome: null };
    state.maybe = (state.maybe || []).concat(x);
    return x;
  }
  // It happened: linked to the payment that paid it.
  function maybeHappened(state, id, txId, nowIso) {
    const m = (state.maybe || []).find((x) => x.id === id);
    const tx = state.transactions.find((x) => x.id === txId);
    if (!m || !tx || !isFlexible(tx) || tx.maybeId || tx.claimId || tx.covered || tx.iouId || tx.passedOn) return false;
    tx.maybeId = m.id;
    m.outcome = { happened: true, txId, date: nowIso };
    return true;
  }
  function maybeDidnt(state, id, nowIso) {
    const m = (state.maybe || []).find((x) => x.id === id);
    if (!m) return false;
    m.outcome = { happened: false, date: nowIso };
    return true;
  }
  // Open again (undo an answer); its payment, if any, becomes daily spending again.
  function maybeReopen(state, id) {
    const m = (state.maybe || []).find((x) => x.id === id);
    if (!m) return false;
    state.transactions.forEach((t) => { if (t.maybeId === id) delete t.maybeId; });
    m.outcome = null;
    return true;
  }
  // A payment deleted: the cost it paid is open again.
  function maybeForget(state, tx) {
    if (tx && tx.maybeId) { const m = (state.maybe || []).find((x) => x.id === tx.maybeId); if (m) m.outcome = null; }
  }
  // Payments that may be the one: near its date and amount, not already linked to something else.
  function maybeCandidates(state, id, todayIso) {
    const m = (state.maybe || []).find((x) => x.id === id);
    if (!m) return [];
    const from = addDays(m.date < todayIso ? m.date : todayIso, -14);
    return state.transactions.filter((t) => isFlexible(t) && !t.maybeId && !t.claimId && !t.covered && !t.iouId && !t.passedOn &&
      t.date >= from && t.date <= todayIso && t.amount >= m.amount * 0.5 && t.amount <= m.amount * 2)
      .sort((a, b) => Math.abs(a.amount - m.amount) - Math.abs(b.amount - m.amount)).slice(0, 5);
  }
  /*
   * How good the guesses were, per likelihood: how many came, and what they
   * cost against the guess. { likely: { answered, happened, rate, guess, actual } … }
   */
  function maybeStats(state) {
    const out = {};
    MAYBE_LIKELY.forEach((k) => {
      const done = (state.maybe || []).filter((m) => m.likely === k && m.outcome);
      const came = done.filter((m) => m.outcome.happened);
      const paid = came.map((m) => ({ m, t: state.transactions.find((x) => x.id === m.outcome.txId) })).filter((x) => x.t);
      out[k] = { answered: done.length, happened: came.length, rate: done.length ? came.length / done.length : null,
        guess: sum(paid, (x) => Number(x.m.amount) || 0), actual: sum(paid, (x) => Number(x.t.amount) || 0) };
    });
    return out;
  }

  // ---------- reimbursable expenses and the side vault ----------

  /*
   * Paid for work (a bus ticket the office pays back): the payment is real
   * cash out, but the eligible part isn't your spending. It's owed back to you
   * (pending float, an asset) until a payout comes in. No second ledger: a
   * claim points at the spending entry, a payout at the money-in entry, and
   * everything else is worked out from those links (reimbView), then written
   * onto the two entries by syncReimb so every number reads it the same way:
   *   spending entry: reimbExcluded = what isn't your spending
   *   payout entry:   reimbDaily = the margin it adds to this month's budget
   * state.reimb = { version: 1, claims: [{ id, txId, actual, eligible, date, who, ref,
   *   closed, routing: 'daily' | 'vault', created, updated }],
   *   payouts: [{ id, txId, amount, date, allocations: [{ claimId, amount }] }] }
   * Status: PENDING (nothing back), PARTIALLY_REIMBURSED, SETTLED (all of the
   * eligible amount back), CLOSED (closed by hand: what didn't come back is yours).
   * Margin = paid back beyond the eligible amount, counted once, by the payout
   * that crosses it; daily: added to the month's budget; vault: kept apart.
   */
  function reimbOf(state) {
    if (!state.reimb || typeof state.reimb !== 'object') state.reimb = { version: 1, claims: [], payouts: [] };
    state.reimb.claims = state.reimb.claims || [];
    state.reimb.payouts = state.reimb.payouts || [];
    return state.reimb;
  }

  function reimbView(state) {
    // Reading never writes: no claims yet is an empty view, not a new record.
    const R = state.reimb && typeof state.reimb === 'object' ? { claims: state.reimb.claims || [], payouts: state.reimb.payouts || [] } : { claims: [], payouts: [] };
    const claims = R.claims.map((c) => Object.assign({}, c, { allocated: 0, margin: 0 }));
    const byId = {};
    claims.forEach((c) => { byId[c.id] = c; });
    const payouts = R.payouts.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)).map((p) => {
      let daily = 0, vault = 0, used = 0;
      (p.allocations || []).forEach((a) => {
        const c = byId[a.claimId];
        if (!c) return;
        const before = Math.max(0, c.allocated - c.eligible);
        c.allocated += a.amount;
        used += a.amount;
        const add = Math.max(0, c.allocated - c.eligible) - before;
        if (c.routing === 'vault') vault += add; else daily += add;
      });
      return Object.assign({}, p, { marginDaily: daily, marginVault: vault, excess: Math.max(0, p.amount - used) });
    });
    claims.forEach((c) => {
      c.outstanding = c.closed ? 0 : Math.max(0, c.eligible - c.allocated);
      c.margin = Math.max(0, c.allocated - c.eligible);
      c.shortfall = c.closed ? Math.max(0, c.eligible - c.allocated) : 0;
      c.status = c.closed ? 'CLOSED' : c.allocated >= c.eligible ? 'SETTLED' : c.allocated > 0 ? 'PARTIALLY_REIMBURSED' : 'PENDING';
    });
    return {
      claims, payouts,
      pendingFloat: sum(claims.filter((c) => c.status === 'PENDING' || c.status === 'PARTIALLY_REIMBURSED'), (c) => c.outstanding),
      vault: sum(payouts, (p) => p.marginVault),
      unallocated: sum(payouts, (p) => p.excess),
    };
  }

  // Writes the worked-out effects onto the linked entries; safe to run any number of times.
  function syncReimb(state) {
    const v = reimbView(state);
    const claimOf = {};
    v.claims.forEach((c) => { claimOf[c.txId] = c; });
    const payOf = {};
    v.payouts.forEach((p) => { payOf[p.txId] = p; });
    state.transactions.forEach((t) => {
      const c = claimOf[t.id];
      if (c) { t.claimId = c.id; t.reimbExcluded = c.closed ? Math.min(c.eligible, c.allocated) : c.eligible; }
      else if (t.claimId) { delete t.claimId; delete t.reimbExcluded; }
      const p = payOf[t.id];
      if (p) { t.payoutId = p.id; t.reimbDaily = p.marginDaily; t.useFor = 'reimb'; }
      else if (t.payoutId) { delete t.payoutId; delete t.reimbDaily; if (t.useFor === 'reimb') t.useFor = null; }
    });
    return v;
  }

  // A spending entry marked as paid for work: eligible defaults to all of it.
  function addClaim(state, txId, o, nowIso) {
    const tx = state.transactions.find((t) => t.id === txId);
    if (!tx || !isFlexible(tx) || tx.claimId) return null;
    const R = reimbOf(state);
    const eligible = Math.round(Number(o && o.eligible) || tx.amount);
    if (!(eligible > 0) || eligible > tx.amount) return null;
    const c = { id: newId('clm'), txId, actual: tx.amount, eligible, date: tx.date, who: (o && o.who) || '', ref: (o && o.ref) || '',
      closed: false, routing: o && o.routing === 'vault' ? 'vault' : 'daily', created: nowIso, updated: nowIso };
    R.claims.push(c);
    syncReimb(state);
    return c;
  }

  /*
   * A money-in entry that is a reimbursement, for the chosen claims. Each gets
   * what it's still owed, oldest first; with one claim, anything beyond is its
   * margin; with several, anything beyond is left unallocated (flagged), never
   * made into profit on a claim it wasn't for.
   */
  function recordPayout(state, txId, claimIds) {
    const tx = state.transactions.find((t) => t.id === txId);
    if (!tx || !isIncome(tx) || tx.payoutId || tx.iouId || tx.iouPay || tx.passedOn) return null;
    const v = reimbView(state);
    const chosen = v.claims.filter((c) => claimIds.indexOf(c.id) !== -1 && !c.closed).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!chosen.length) return null;
    let left = tx.amount;
    const allocations = chosen.map((c) => { const a = Math.min(left, c.outstanding); left -= a; return { claimId: c.id, amount: a }; });
    if (chosen.length === 1 && left > 0) { allocations[0].amount += left; left = 0; }
    const p = { id: newId('pay'), txId, amount: tx.amount, date: tx.date, allocations: allocations.filter((a) => a.amount > 0) };
    reimbOf(state).payouts.push(p);
    syncReimb(state);
    return p;
  }

  function claimSet(state, claimId, fields, nowIso) {
    const c = reimbOf(state).claims.find((x) => x.id === claimId);
    if (!c) return null;
    Object.assign(c, fields, { updated: nowIso });
    syncReimb(state);
    return c;
  }

  // Unlinks everything a deleted entry took part in (a claim's payouts stay, now unallocated).
  function reimbForget(state, tx) {
    const R = reimbOf(state);
    if (tx.claimId) {
      R.claims = R.claims.filter((c) => c.id !== tx.claimId);
      R.payouts.forEach((p) => { p.allocations = (p.allocations || []).filter((a) => a.claimId !== tx.claimId); });
    }
    if (tx.payoutId) R.payouts = R.payouts.filter((p) => p.id !== tx.payoutId);
    syncReimb(state);
  }

  // The amount of a claimed spending entry changed: the claim follows (eligible never above what was paid).
  function reimbAmount(state, tx) {
    const R = reimbOf(state);
    const c = R.claims.find((x) => x.id === tx.claimId);
    if (c) { c.actual = tx.amount; c.eligible = Math.min(c.eligible, tx.amount); }
    syncReimb(state);
  }

  // Pays a purchase from money kept for it, as far as it goes. Returns the amount covered.
  function coverPurchase(state, keepId, spendId) {
    const k = state.transactions.find((t) => t.id === keepId && t.useFor === 'keep');
    const x = state.transactions.find((t) => t.id === spendId && isFlexible(t));
    if (!k || !x) return 0;
    const amount = Math.min(k.amount - (Number(k.keepUsed) || 0), ownPart(x));
    if (!(amount > 0)) return 0;
    k.keepUsed = (Number(k.keepUsed) || 0) + amount;
    k.keepUses = (k.keepUses || []).concat({ id: x.id, amount });
    x.covered = (Number(x.covered) || 0) + amount;
    x.coveredFrom = k.id;
    return amount;
  }

  // Money kept for something to buy, not used yet: { tx, name, left }.
  function keptFor(state) {
    return state.transactions.filter((t) => isIncome(t) && t.useFor === 'keep' && t.amount - (Number(t.keepUsed) || 0) > 0)
      .map((t) => ({ tx: t, name: t.keepFor || t.note || '', left: t.amount - (Number(t.keepUsed) || 0) }));
  }

  /*
   * How much of a money-in entry stays in the account for spending.
   * useFor: null (not decided yet, so it stays) | 'spend' | 'emergency' |
   * 'grow' | 'debt'. Money moved to a fund or used on a loan leaves the
   * spending money, except any part larger than the loan.
   */
  function incomeKept(t) {
    if (t.payoutId) return Number(t.reimbDaily) || 0;
    // A refund that offsets a purchase: the purchase's spending drops instead.
    if (t.refundOf) return 0;
    // Taken out of your emergency fund or investments: yours already, now to spend.
    if (!t.useFor || t.useFor === 'spend' || t.useFor === 'fromfund' || t.useFor === 'fromgrow') return t.amount;
    // Kept for something to buy (a Diwali gift for a purchase): never spending money; it pays for that purchase.
    if (t.useFor === 'keep') return 0;
    if (t.useFor === 'debt') return t.amount - (Number(t.debtPaid) || 0);
    return 0;
  }

  function byCategory(transactions) {
    const out = {};
    transactions.forEach((t) => { out[t.category] = (out[t.category] || 0) + personalAmt(t); });
    return out;
  }

  // ---------- runway ----------

  /*
   * Day-by-day balance for the current cycle.
   * - Salary arrives on payday; savings set-asides leave the same day.
   * - Fixed bills and debt minimums leave on their due dates.
   * - Up to today: real spending. After today, two projections:
   *     pace: keep spending at this cycle's average daily rate
   *     plan: spend exactly what is left of the flexible budget, evenly
   * - A balance check ("money in your account this morning") replaces the
   *   worked-out balance from that day on. Spending before it is unknown,
   *   so the pace is measured from that day and the plan uses the daily budget.
   * - Money received arrives on its date. Whatever is kept for spending is
   *   added on top of the flexible budget for the rest of the cycle.
   */
  /*
   * What you really spent a day lately, on spending that passes `keep`: the
   * finished days of the last `days` days, counted only from your first
   * entry, so a new user isn't averaged over days the app never saw.
   */
  function recentDaily(state, todayIso, keep, days) {
    const from = addDays(todayIso, -(days || 30));
    const txs = state.transactions.filter((t) => isFlexible(t) && !t.gap && t.date >= from && t.date < todayIso && keep(t));
    const first = state.transactions.reduce((m, t) => (t.date < m ? t.date : m), todayIso);
    const span = daysBetween(first > from ? first : from, todayIso);
    return span > 0 ? sum(txs, (t) => t.amount) / span : 0;
  }

  function projectRunway(state, todayIso) {
    const cycle = cycleFor(todayIso, Number(state.settings.payday) || 1);
    const plan = monthlyPlan(state, todayIso);
    const events = cycleEvents(state, cycle, todayIso);
    const txns = spendInRange(state.transactions, cycle);
    const idxToday = daysBetween(cycle.start, todayIso);
    const N = cycle.days;
    const check = state.balanceCheck;
    const anchor = check && inCycle(check.date, cycle) && check.date <= todayIso ? check : null;
    const aIdx = anchor ? daysBetween(cycle.start, anchor.date) : 0;

    const spendByDate = {};
    txns.forEach((t) => { spendByDate[t.date] = (spendByDate[t.date] || 0) + t.amount; });
    const incomes = incomeInRange(state.transactions, cycle).filter((t) => t.date <= todayIso);
    // Money kept for something stays in the account: all of it counts in the balance.
    // A reimbursement is all cash in; only its margin (daily routing) adds to the budget, through incomeKept.
    incomes.forEach((t) => { spendByDate[t.date] = (spendByDate[t.date] || 0) - (t.useFor === 'keep' || t.payoutId || t.refundOf ? t.amount : incomeKept(t)); });
    /*
     * Money with friends and family (borrowed, lent, paid back) and money
     * passed on: not income or spending, but it moves the balance, so it
     * counts with money received (out as less). Passed on, in and out cancel.
     */
    // Card bills from before the card was added, paid from the account; card spending turned into an EMI.
    (state.cards || []).forEach((c) => {
      if (!(cardPayments(state, c).length)) return;
      for (let d = cycle.start; d <= todayIso && d < cycle.next; d = addDays(d, 1)) {
        const fx = cardDayEffect(state, c, d);
        if (fx) spendByDate[d] = (spendByDate[d] || 0) - fx;
      }
    });
    const flows = state.transactions.filter((t) => isPassedOn(t) && inCycle(t.date, cycle) && t.date <= todayIso);
    const flowOf = (t) => (isIncome(t) ? t.amount : -t.amount);
    flows.forEach((t) => { spendByDate[t.date] = (spendByDate[t.date] || 0) - flowOf(t); });
    let extraIn = sum(incomes.filter((t) => !anchor || t.date >= anchor.date), incomeKept) +
      sum(flows.filter((t) => !anchor || t.date >= anchor.date), flowOf);
    /*
     * The extra in this month's pay (₹1,07,689 against a usual ₹98,000) is
     * part of the salary: a bank balance entered on or after that day already
     * holds it, and so does a usual pay raised to cover it. Then it isn't
     * added again; only a part given a place (the emergency fund, say) comes
     * off.
     */
    const slip = (state.payslips || {})[cycle.start];
    const extra = slip && slip.extraTx && incomes.find((t) => t.id === slip.extraTx);
    if (extra && ((anchor && anchor.date >= extra.date) || (Number(state.settings.salary) || 0) >= (Number(slip.amount) || 0))) {
      spendByDate[extra.date] = (spendByDate[extra.date] || 0) + extra.amount;
      if (!anchor || extra.date >= anchor.date) extraIn -= extra.amount;
    }
    // Bill payments leave the account (less what the pot covers); moves to savings leave too.
    // Set-aside moves (t.setAside) record money already taken out on payday, so they're skipped here.
    const others = state.transactions.filter((t) => (isBillPayment(t) || isFixedPayment(t) || (isMove(t) && !t.setAside)) && inCycle(t.date, cycle) && t.date <= todayIso);
    others.forEach((t) => {
      const out = isBillPayment(t) ? t.amount - (Number(t.fromPot) || 0) : t.amount;
      spendByDate[t.date] = (spendByDate[t.date] || 0) + out;
    });
    // Unspent money moved out counts as used, so later days keep their planned amount.
    const moved = sum(others.filter((t) => isMove(t) && (!anchor || t.date >= anchor.date)), (t) => t.amount);
    /*
     * Money saved today can't be spent today, so it comes off today's amount
     * like spending. A leftover from an earlier day moved today (forDate)
     * belongs to that day instead, so today isn't cut twice.
     */
    const savedToday = sum(others.filter((t) => isMove(t) && (t.forDate || t.date) === todayIso), (t) => t.amount);
    const eventsByDate = {};
    events.forEach((e) => { eventsByDate[e.date] = (eventsByDate[e.date] || 0) + e.amount; });

    const pastTxns = txns.filter((t) => t.date <= todayIso);
    // A purchase paid from money kept for it (a gift) leaves the account, but not today's amount or the budgets.
    const spentToDate = sum(pastTxns, ownPart);
    const spentToday = sum(pastTxns.filter((t) => t.date === todayIso), ownPart);
    const paceSpend = sum(
      pastTxns.filter((t) => NON_PACE_CATEGORIES.indexOf(t.category) === -1 && (!anchor || t.date >= anchor.date)),
      ownPart
    );
    /*
     * The pace is the average over finished days only. Counting today as a
     * finished day with nothing spent made the forecast jump at midnight
     * (Careful at 11 pm, Green at 12:05 am with nothing done). Today counts
     * as at least a usual day until it's over.
     */
    const paceToday = sum(pastTxns.filter((t) => t.date === todayIso && NON_PACE_CATEGORIES.indexOf(t.category) === -1), ownPart);
    const daysDone = idxToday - aIdx;
    const remainingDays = N - 1 - idxToday;
    // With a balance check, extra money is shared over the days from that check.
    const dailyBudget = Math.max(0, plan.flexTotal / N + (anchor ? (extraIn - moved) / (N - aIdx) : 0));
    // Before two days of spending: the plan's rate, or, with nothing planned for daily spending, what you've really been spending.
    const startRate = plan.flexTotal > 0 ? plan.flexTotal / N : recentDaily(state, todayIso, (t) => NON_PACE_CATEGORIES.indexOf(t.category) === -1);
    const paceRate = daysDone >= 2 && paceSpend - paceToday > 0 ? (paceSpend - paceToday) / daysDone : startRate;
    const todayRest = Math.max(0, paceRate - paceToday);
    const flexLeft = Math.max(0, plan.flexTotal + extraIn - paceSpend - moved);
    const planRate = anchor ? dailyBudget : remainingDays > 0 ? flexLeft / remainingDays : 0;

    /*
     * No balance entered since payday, but one last round: last round's
     * leftover is still in the account, so the new round starts from it plus
     * the salary (an overspend starts it lower). Older than that, the salary
     * alone is the best guess.
     */
    const prevCycle = previousCycle(cycle, Number(state.settings.payday) || 1);
    const carried = !anchor && check && check.date < cycle.start && check.date >= prevCycle.start
      ? projectRunway(state, addDays(cycle.start, -1)).balanceToday || 0 : 0;
    const points = [];
    let bal = plan.salary - plan.savingsTotal + carried;
    let pace = 0;
    let planned = 0;
    for (let i = 0; i < N; i++) {
      const date = addDays(cycle.start, i);
      const out = eventsByDate[date] || 0;
      if (i <= idxToday) {
        if (anchor && i === aIdx) bal = (Number(anchor.amount) || 0) - cardReserve(state, anchor.date) - earmarkedIn(state, anchor.date);
        bal -= out + (spendByDate[date] || 0);
        pace = planned = bal;
        if (i === idxToday) pace -= todayRest;
        points.push({
          date,
          actual: anchor && i < aIdx ? null : bal,
          pace: i === idxToday ? bal : null,
          plan: i === idxToday ? bal : null,
        });
      } else {
        pace -= out + paceRate;
        planned -= out + planRate;
        points.push({ date, actual: null, pace, plan: planned });
      }
    }

    // Safe to spend today: the smaller of what the budget allows and what the
    // account can cover after the bills still to come.
    const billsAhead = sum(events.filter((e) => e.date > todayIso), (e) => e.amount);
    // Today's amount is fixed for the day: what spending and saving today don't change.
    // Money kept for something to buy is in the account but not to spend.
    // Kept apart: money kept for a purchase, and the side vault (margins routed there).
    // Likely costs that may come before payday are held too.
    const held = maybeHeld(state, todayIso);
    const kept = sum(state.transactions.filter((t) => isIncome(t) && t.useFor === 'keep' && t.date <= todayIso), (t) => Math.max(0, t.amount - (Number(t.keepUsed) || 0))) +
      (state.reimb ? reimbView(state).vault : 0) + held;
    const byMoney = Math.max(0, bal - kept + spentToday + savedToday - billsAhead) / (remainingDays + 1);
    // Never below zero: a limit of -₹50 means nothing, ₹0 says it.
    const byBudget = anchor
      ? Math.max(0, plan.flexTotal / N + (extraIn - (moved - savedToday)) / (N - aIdx))
      : Math.max(0, plan.flexTotal + extraIn - (moved - savedToday) - (paceSpend - spentToday)) / (remainingDays + 1);
    const dailyAllowance = Math.min(byMoney, byBudget);
    // The parts of today's limit, for "how is this calculated?".
    const limit = { byMoney, byBudget, money: bal - kept + spentToday + savedToday, bills: billsAhead, days: remainingDays + 1, kept };
    // What is left of today's amount after spending and saving, and tomorrow's amount once today is counted.
    const usedToday = spentToday + savedToday;
    const leftToday = Math.max(0, dailyAllowance - usedToday);
    const overToday = Math.max(0, usedToday - dailyAllowance);
    const tomorrowAllowance = remainingDays > 0
      ? Math.min(Math.max(0, bal - kept - billsAhead) / remainingDays, anchor ? dailyBudget : planRate)
      : 0;

    const firstBelowZero = (key) => {
      for (const p of points) {
        const v = p.actual !== null ? p.actual : p[key];
        if (v !== null && v < 0) return p.date;
      }
      return null;
    };

    const last = points[points.length - 1];
    return {
      cycle, plan, events, points, idxToday, remainingDays, anchor, anchorIdx: anchor ? aIdx : null, limit, carried,
      spentToDate, spentToday, savedToday, flexLeft, extraIn, moved, billsAhead, paceRate, planRate, dailyAllowance, leftToday, overToday, tomorrowAllowance,
      balanceToday: points[idxToday].actual, kept, held,
      zeroPace: firstBelowZero('pace'),
      zeroPlan: firstBelowZero('plan'),
      endPace: last.actual !== null ? last.actual : last.pace,
      endPlan: last.actual !== null ? last.actual : last.plan,
    };
  }

  // ---------- zones ----------

  // Spending that can't wait: used to judge whether basics are covered.
  const ESSENTIAL_CATEGORIES = ['Groceries', 'Health'];

  /*
   * Green: at this pace, money lasts until payday.
   * Amber: bills and basics are covered, but this pace runs out before payday.
   * Red: the money left doesn't cover bills still to come plus basics
   *      (groceries, health) for the days to payday.
   * needsLine gives, for each day from today, what bills and basics still need:
   * the red band on the graph.
   */
  function zoneStatus(state, todayIso, runway) {
    const r = runway || projectRunway(state, todayIso);
    const N = r.cycle.days;
    // Basics a day: the plan's groceries and health, or, when the plan has no room for them, what you really spend on them.
    const planned = sum(r.plan.budgets.filter((b) => ESSENTIAL_CATEGORIES.indexOf(b.name) !== -1), (b) => b.amount) / N;
    const essentialPerDay = planned > 0 ? planned : recentDaily(state, todayIso, (t) => ESSENTIAL_CATEGORIES.indexOf(t.category) !== -1, 60);
    const billsAfter = (iso) => sum(r.events.filter((e) => e.date > iso), (e) => e.amount);
    const money = r.balanceToday - (r.kept || 0);
    const needs = r.billsAhead + essentialPerDay * r.remainingDays;
    const needsLine = r.points.map((p, i) => (i < r.idxToday ? null : billsAfter(p.date) + essentialPerDay * (N - 1 - i)));
    const safeDaily = r.remainingDays > 0 ? Math.max(0, money - r.billsAhead) / r.remainingDays : 0;

    let zone = 'green';
    if (money < needs) zone = 'red';
    // Nothing left to spend today, with days still to go, is never "on track".
    else if (r.zeroPace || r.endPace < 0 || (r.remainingDays > 0 && r.dailyAllowance < 1)) zone = 'amber';

    const out = { zone, money, needs, shortBy: Math.max(0, needs - money), safeDaily, essentialPerDay, needsLine, options: [] };
    if (zone === 'red') {
      const fund = Number(state.savings.emergencyBalance) || 0;
      // Rounded up to ₹10 so moving it really clears the gap.
      if (fund > 0) out.options.push({ kind: 'fund', amount: Math.min(fund, Math.ceil(out.shortBy / 10) * 10) });
      const setAsides = r.plan.invest + r.plan.debtExtra;
      if (setAsides > 0 && !r.plan.adjustment) out.options.push({ kind: 'pause', amount: setAsides });
      out.options.push({ kind: 'basics', amount: Math.round(essentialPerDay) });
    }
    return out;
  }

  // ---------- credit cards ----------

  /*
   * Card spending counts as spending the day it happens, so the money is
   * treated as kept aside for the bill. Paying the bill only moves that money
   * to the card. What the app didn't see (the amount owed when the card was
   * added) shows up as a bill on its due date.
   *
   * A card: name, last4, limit, statementDay, dueDay, rate (% a year),
   * created, setupStatement (amount due on the last statement when added),
   * setupDueDate, setupUnbilled (spent since that statement), and optionally
   * statement: { date, total, min, due } from the bank's statement SMS.
   */
  function statementOn(card, iso) {
    const d = parseISO(iso);
    let st = clampedDate(d.getFullYear(), d.getMonth(), Number(card.statementDay) || 1);
    if (st > d) st = clampedDate(d.getFullYear(), d.getMonth() - 1, Number(card.statementDay) || 1);
    return toISO(st);
  }

  // The first statement date strictly after `iso`.
  function nextStatementAfter(card, iso) {
    const s = parseISO(statementOn(card, iso));
    return toISO(clampedDate(s.getFullYear(), s.getMonth() + 1, Number(card.statementDay) || 1));
  }

  function dueAfter(card, statementIso) {
    const s = parseISO(statementIso);
    let due = clampedDate(s.getFullYear(), s.getMonth(), Number(card.dueDay) || 1);
    if (due <= s) due = clampedDate(s.getFullYear(), s.getMonth() + 1, Number(card.dueDay) || 1);
    return toISO(due);
  }

  function cardSpends(state, card) {
    return state.transactions.filter((t) => (isFlexible(t) || isCashAdvance(t)) && t.paidFrom === card.id);
  }

  // Refunds or cashback to the card.
  function cardRefunds(state, card) {
    return state.transactions.filter((t) => isIncome(t) && t.paidFrom === card.id);
  }

  function cardPayments(state, card) {
    return state.transactions.filter((t) => isCardTransfer(t) && t.cardId === card.id);
  }

  function setupOwed(card) {
    return (Number(card.setupStatement) || 0) + (Number(card.setupUnbilled) || 0);
  }

  /*
   * Payments count toward the bill owed when the card was added from that
   * bill's statement on. A card added on 25 Oct with a bill due 3 Oct, paid
   * on 3 Oct, is paid, not overdue.
   */
  function setupFrom(card) {
    // A card saved before cards had an added date: every payment counts.
    const created = card.created || '';
    if (!card.setupDueDate || !created) return created;
    const st = statementOn(card, addDays(card.setupDueDate, -1));
    return st < created ? st : created;
  }

  /*
   * A loan paid through a card bill (debt.viaCard): its EMI is billed on each
   * statement. Its money leaves on the card's due date as the loan's EMI, so
   * it's owed on the card without being card spending. The bill already on
   * the card when it was added is in setupStatement, so this counts the
   * statements after that, until iso.
   */
  function cardEmis(state, card) {
    return (state.debts || []).filter((d) => d.viaCard === card.id && Number(d.balance) > 0 && Number(d.minPayment) > 0);
  }
  function cardEmiCharges(state, card, iso) {
    // A finished EMI was billed up to its last one.
    const loans = (state.debts || []).filter((d) => d.viaCard === card.id && Number(d.minPayment) > 0 &&
      (Number(d.balance) > 0 || (d.lastEmi && d.lastEmi.date)));
    let total = 0;
    for (let st = nextStatementAfter(card, card.created || iso); st <= iso; st = nextStatementAfter(card, st)) {
      const due = dueAfter(card, st);
      total += sum(loans.filter((d) => Number(d.balance) > 0 || due <= d.lastEmi.date), (d) => Number(d.minPayment));
    }
    return total;
  }

  /*
   * An EMI booked on a card on bookedIso for `months`: its first EMI is billed
   * on the next statement. How many are already paid by todayIso, and the EMI.
   */
  function cardEmiFromBooking(card, booking, todayIso) {
    let due = dueAfter(card, nextStatementAfter(card, booking.date));
    let paid = 0;
    while (due <= todayIso && paid < booking.months) { paid++; due = dueAfter(card, nextStatementAfter(card, addDays(due, 1))); }
    const rate = booking.rate === null || booking.rate === undefined ? 22 : booking.rate;
    return { emi: emiQuote(booking.amount, rate, booking.months, 0).emi, left: booking.months - paid, paid, rate, next: paid < booking.months ? due : null };
  }

  /*
   * An EMI already running on a card (a bill converted before the card was
   * added here): what's left is worked out from the EMI, how many are left
   * and the rate, unless the bank's figure is given.
   */
  function addCardEmi(state, cardId, opts, todayIso) {
    const card = (state.cards || []).find((c) => c.id === cardId);
    const emi = Math.round(Number(opts.emi) || 0);
    const left = Math.round(Number(opts.left) || 0);
    if (!card || !(emi > 0) || !(left > 0)) return null;
    const rate = Number(opts.rate) >= 0 && opts.rate !== '' && opts.rate !== undefined ? Number(opts.rate) : 22;
    const i = rate / 1200;
    const owed = Number(opts.balance) > 0 ? Math.round(Number(opts.balance)) : Math.round(i > 0 ? (emi * (1 - Math.pow(1 + i, -left))) / i : emi * left);
    const debt = { id: newId('d'), name: opts.name || card.name + ' EMI', balance: owed, startBalance: owed, rate, minPayment: emi, dueDay: card.dueDay,
      viaCard: card.id, emisLeft: left, emiThrough: lastDueOn(todayIso, Number(card.dueDay) || 1) };
    state.debts.push(debt);
    return debt;
  }

  // What the card owes the bank at the end of a date.
  function cardOwedAt(state, card, iso) {
    return setupOwed(card) + cardEmiCharges(state, card, iso) +
      sum(cardSpends(state, card).filter((t) => t.date <= iso), (t) => t.amount) -
      sum(cardRefunds(state, card).filter((t) => t.date <= iso), (t) => t.amount) -
      sum(cardPayments(state, card).filter((t) => t.date >= setupFrom(card) && t.date <= iso), (t) => t.amount);
  }

  /*
   * Card spending before a date that hasn't been paid yet. That money is
   * still in the bank, so a balance check subtracts it. Payments clear the
   * amount owed from before the card was added first.
   */
  function cardReserve(state, iso) {
    return sum(state.cards || [], (c) => Math.max(0, cardSpendOwed(state, c, iso)));
  }
  // Card spending (less refunds) and what was turned into EMIs, before the day iso.
  function cardSpentNet(state, c, iso) {
    return sum(cardSpends(state, c).filter((t) => t.date < iso), (t) => t.amount) -
      sum(cardRefunds(state, c).filter((t) => t.date < iso), (t) => t.amount);
  }
  function cardConverted(state, c, iso) {
    return sum(cardPayments(state, c).filter((t) => t.kind === 'cardconvert' && t.date >= setupFrom(c) && t.date < iso), (t) => t.amount);
  }
  /*
   * Paid toward the card's bills before the day iso: payments from the
   * account, and EMI conversions beyond the card spending (an EMI made of
   * card spending turns that spending into a loan; only the rest of it covers
   * the bill from before the card was added). Payments before the bill the
   * card was added with paid older bills.
   */
  function cardBillPaid(state, c, iso) {
    const cash = sum(cardPayments(state, c).filter((t) => t.kind !== 'cardconvert' && t.date >= setupFrom(c) && t.date < iso), (t) => t.amount);
    return cash + Math.max(0, cardConverted(state, c, iso) - Math.max(0, cardSpentNet(state, c, iso)));
  }
  // Card spending not yet paid, before the day iso (below 0: a refund credit on the card).
  function cardSpendOwed(state, c, iso) {
    const spent = cardSpentNet(state, c, iso);
    const toEmi = Math.min(cardConverted(state, c, iso), Math.max(0, spent));
    // Payments clear what isn't card spending first: the bill from before the card was added, and EMIs billed on it.
    return spent - toEmi - Math.max(0, cardBillPaid(state, c, iso) - setupOwed(c) - cardEmiCharges(state, c, addDays(iso, -1)));
  }

  /*
   * What the card does to the money shown on day d, beyond counting its
   * spending that day (spending is kept aside at once): paying the bill from
   * before the card was added takes money out of the account, turning card
   * spending into an EMI gives back what was kept aside for it. The EMI part
   * of a card bill leaves on its own due date, as the loan's EMI, so paying it
   * changes nothing here.
   */
  function cardDayEffect(state, c, d) {
    const from = setupFrom(c);
    const next = addDays(d, 1);
    const emiSetup = Math.min(Number(c.setupStatement) || 0, sum(cardEmis(state, c), (x) => Number(x.minPayment)));
    const owedBefore = setupOwed(c);
    // How much of what's been paid up to a day went to EMIs (paid in order: the EMI on the first bill, the rest of it, later EMIs, spending).
    const emiPart = (paid, iso) => Math.min(paid, emiSetup) + Math.min(Math.max(0, paid - owedBefore), cardEmiCharges(state, c, iso));
    const paidBy = (iso) => cardBillPaid(state, c, iso);
    const cash = sum(cardPayments(state, c).filter((t) => t.kind === 'cardpay' && t.date >= from && t.date === d), (t) => t.amount);
    const emiToday = emiPart(paidBy(next), d) - emiPart(paidBy(d), addDays(d, -1));
    const spends = sum(cardSpends(state, c).filter((t) => t.date === d), (t) => t.amount) - sum(cardRefunds(state, c).filter((t) => t.date === d), (t) => t.amount);
    return spends - Math.max(0, cash - emiToday) - (cardSpendOwed(state, c, next) - cardSpendOwed(state, c, d));
  }

  // Bills for what was owed before the card was added, until paid.
  function cardLegacyEvents(state, card, todayIso) {
    const paid = cardBillPaid(state, card, addDays(todayIso, 1));
    const billLeft = Math.max(0, (Number(card.setupStatement) || 0) - paid);
    // The EMIs on that bill leave as the loans' own EMIs, so only the rest is a bill to pay here.
    const statementLeft = Math.min(billLeft, Math.max(0, (Number(card.setupStatement) || 0) - sum(cardEmis(state, card), (d) => Number(d.minPayment))));
    const unbilledLeft = Math.max(0, setupOwed(card) - paid) - billLeft;
    const out = [];
    if (statementLeft > 0 && card.setupDueDate) {
      out.push({ date: card.setupDueDate, name: card.name + ' bill', amount: statementLeft, kind: 'card', cardId: card.id });
    }
    if (unbilledLeft > 0) {
      // Spent before the card was added but after its last statement: billed on the next one.
      const firstStatement = nextStatementAfter(card, card.created || todayIso);
      out.push({ date: dueAfter(card, firstStatement), name: card.name + ' bill', amount: unbilledLeft, kind: 'card', cardId: card.id });
    }
    return out;
  }

  /*
   * The card's position today: the last statement (amount, minimum, due date,
   * how much of it is still to pay), spending since then, total owed and how
   * much of the limit is used.
   */
  function cardStatus(state, card, todayIso) {
    const created = card.created || todayIso;
    const lastSt = statementOn(card, todayIso);
    const pays = cardPayments(state, card);
    let statementDate, total, due, paidSince;
    if (lastSt < created) {
      statementDate = null;
      total = Number(card.setupStatement) || 0;
      due = card.setupDueDate || dueAfter(card, lastSt);
      const from = setupFrom(card);
      paidSince = sum(pays.filter((t) => t.date >= from), (t) => t.amount);
    } else {
      statementDate = lastSt;
      total = Math.max(0, cardOwedAt(state, card, lastSt));
      due = dueAfter(card, lastSt);
      paidSince = sum(pays.filter((t) => t.date > lastSt), (t) => t.amount);
    }
    let min = null;
    const sms = card.statement;
    if (sms && sms.date >= addDays(lastSt, -3) && sms.date >= addDays(created, -3)) {
      total = Number(sms.total) || total;
      min = Number(sms.min) || null;
      due = sms.due || due;
    }
    total = Math.round(total);
    const remaining = Math.max(0, total - paidSince);
    const owed = Math.max(0, Math.round(cardOwedAt(state, card, todayIso)));
    if (min === null) min = total > 0 ? Math.min(total, Math.max(200, Math.round(total * 0.05))) : 0;
    const limit = Number(card.limit) || 0;
    return {
      card, statementDate, total, min, due, paidSince, remaining,
      minLeft: Math.max(0, min - paidSince),
      unbilled: Math.max(0, owed - remaining),
      owed,
      usedPct: limit > 0 ? Math.round((owed / limit) * 100) : null,
      overdue: remaining > 0 && due < todayIso,
      daysToDue: daysBetween(todayIso, due),
    };
  }

  // Monthly payment for a loan of P at `rate` % a year over `months`.
  function emiQuote(P, rate, months, fee) {
    const i = (Number(rate) || 0) / 1200;
    const n = Math.max(1, Number(months) || 1);
    const emi = i > 0 ? (P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1) : P / n;
    const interest = emi * n - P;
    return { emi: Math.ceil(emi - 1e-9), months: n, interest: Math.round(interest), fee: Math.round(Number(fee) || 0), cost: Math.round(interest + (Number(fee) || 0)) };
  }

  // Leaving P on the card and paying `monthly` each month at the card's rate.
  function revolveQuote(P, rate, monthly) {
    const r = simulateDebts([{ name: 'card', balance: P, rate: Number(rate) || 0, minPayment: monthly }], 0, 'avalanche', false);
    return { months: r.months, interest: r.totalInterest, cost: r.totalInterest, neverPaysOff: r.neverPaysOff };
  }

  /*
   * How to pay this card's bill. Full is suggested whenever the money is there
   * (card spending was already kept aside, so that's whenever you're not in
   * the red). Otherwise: pay what you can, and for the rest compare carrying
   * it on the card with an EMI. The EMI is suggested only when it's clearly
   * cheaper; it is still a loan.
   */
  function cardBillPlan(state, cardId, todayIso, emi) {
    const card = (state.cards || []).find((c) => c.id === cardId);
    if (!card) return null;
    const st = cardStatus(state, card, todayIso);
    const z = zoneStatus(state, todayIso);
    const rate = cardRate(card);
    const due = st.remaining;
    const short = z.zone === 'red' ? Math.min(due, Math.ceil(z.shortBy / 100) * 100) : 0;
    const payNow = Math.max(st.minLeft, due - short);
    const rest = due - payNow;

    // Minimum only: next month's interest and the time to clear at this minimum.
    const afterMin = due - st.minLeft;
    const minPlan = {
      amount: st.minLeft,
      interestNextMonth: Math.round((afterMin * rate) / 1200),
      payoff: afterMin > 0 ? revolveQuote(afterMin, rate, Math.max(200, Math.round(st.min || afterMin * 0.05))) : null,
    };

    const e = Object.assign({ rate: 22, months: 6, fee: 0 }, emi || {});
    let compare = null;
    if (rest > 0) {
      const emiQ = emiQuote(rest, e.rate, e.months, e.fee);
      const revolveQ = revolveQuote(rest, rate, emiQ.emi);
      compare = { amount: rest, emi: emiQ, revolve: revolveQ, emiSaves: revolveQ.cost - emiQ.cost };
    }

    let suggested, reason;
    if (due === 0) {
      suggested = null;
      reason = tr('Nothing to pay on this bill.');
    } else if (!short) {
      suggested = 'full';
      reason = tr('You’ve already kept this money aside: card spending was counted when it happened. Paying in full costs no interest.');
    } else if (compare && compare.emiSaves >= Math.max(200, compare.revolve.cost * 0.1)) {
      suggested = 'emi';
      reason = tr('You’re {short} short this month. Pay {now} now and convert {rest} to an EMI: it costs about {saves} less than carrying it on the card. It’s still a loan, so clear it as early as you can.',
        { short: rupees(short), now: rupees(payNow), rest: rupees(rest), saves: rupees(compare.emiSaves) });
    } else {
      suggested = 'part';
      reason = tr('You’re {short} short this month. Pay {now} now and the rest as soon as you can; an EMI wouldn’t save much here.', { short: rupees(short), now: rupees(payNow) });
    }
    return { card, status: st, rate, due, payNow, rest, short, minPlan, compare, emi: e, suggested, reason };
  }

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // A card bill payment from the bank account.
  function recordCardPayment(state, cardId, amount, dateIso, source) {
    const card = (state.cards || []).find((c) => c.id === cardId);
    if (!card) return null;
    const tx = { id: newId('cp'), kind: 'cardpay', cardId, date: dateIso, amount: Math.round(Number(amount) || 0), note: card.name + ' bill payment', source: source || 'manual' };
    state.transactions.push(tx);
    return tx;
  }

  // A payment's note that reads like paying a credit card bill.
  function looksLikeCardBill(note) {
    return /credit\s*card|card\s*bill|cc\s*bill|\bcc\b/i.test(String(note || ''));
  }

  /*
   * A card bill noted as spending counts twice: what was bought on the card
   * already counted. It becomes a card payment instead. When the same payment
   * is already recorded (from "did you pay?"), that one takes this one's date.
   */
  function spendToCardPayment(state, txId, cardId) {
    const tx = state.transactions.find((t) => t.id === txId);
    const card = (state.cards || []).find((c) => c.id === cardId);
    if (!tx || !card || !isFlexible(tx)) return null;
    const amount = Math.round(Number(tx.amount) || 0);
    const twin = state.transactions.find((t) => t.kind === 'cardpay' && t.cardId === cardId && Math.round(t.amount) === amount &&
      Math.abs(daysBetween(t.date, tx.date)) <= 40);
    state.transactions = state.transactions.filter((t) => t !== tx);
    if (twin) { twin.date = tx.date; return { tx: twin, merged: true }; }
    const pay = { id: newId('cp'), kind: 'cardpay', cardId, date: tx.date, amount, note: card.name + ' bill payment', source: tx.source || 'manual' };
    if (tx.smsKey) pay.smsKey = tx.smsKey;
    state.transactions.push(pay);
    return { tx: pay, merged: false };
  }

  /*
   * Moves part of the bill off the card into the Debts tab, either as an EMI
   * (with its rate, months and fee) or as a carried balance at the card's
   * rate with a 5% minimum. The Debts tab then plans its payoff and the
   * monthly payment is counted in every month's plan. Payments start with the
   * card's next bill; an EMI processing fee is charged on the card, as banks do.
   */
  /*
   * What a card costs when the bill isn't paid in full. Nobody needs to know
   * their card's rate: these are the usual Indian figures. Paying the whole
   * bill by the due date costs nothing.
   * - interest about 3.5% a month (42% a year) plus 18% GST on it
   * - a late fee only when not even the minimum is paid, by how much was due
   */
  const CARD_RATE = 42;
  const GST = 0.18;
  function cardRate(card) { return Math.round((Number(card && card.rate) || CARD_RATE) * (1 + GST) * 10) / 10; }
  function cardLateFee(due) {
    return due <= 500 ? 0 : due <= 5000 ? 500 : due <= 10000 ? 750 : due <= 25000 ? 950 : due <= 50000 ? 1100 : 1300;
  }

  /*
   * On the due date: did the bill get paid? 'full' records the payment (no
   * interest). 'part' (with `paid`) and 'missed' record what was paid and
   * move the rest to Debts as a carried balance at the card rate with GST,
   * plus the late fee with GST when not even the minimum was paid. EMI
   * conversions go through convertCardBalance. Asked once per bill.
   */
  /*
   * The answer to "did you pay the card bill?". paidOn is the day the money
   * left the account (the due date unless the person says otherwise): a
   * payment made before a balance check is already out of that balance, so
   * recording it on the day of answering would count it twice.
   */
  function answerCardDue(state, cardId, answer, paid, todayIso, paidOn) {
    const card = (state.cards || []).find((c) => c.id === cardId);
    if (!card) return null;
    const st = cardStatus(state, card, todayIso);
    card.answered = st.due;
    paid = answer === 'full' ? st.remaining : answer === 'part' ? Math.max(0, Math.min(st.remaining, Math.round(Number(paid) || 0))) : 0;
    const when = paidOn && paidOn <= todayIso ? paidOn : todayIso;
    if (paid > 0) recordCardPayment(state, cardId, paid, when, 'account');
    const rest = st.remaining - paid;
    if (rest <= 0) return { kind: 'full', paid };
    const fee = paid < st.minLeft ? Math.round(cardLateFee(st.total) * (1 + GST)) : 0;
    const res = convertCardBalance(state, cardId, rest, { kind: 'revolve', lateFee: fee }, todayIso);
    return { kind: 'carried', paid, rest, fee, debt: res.debt, monthly: Math.round((res.debt.balance * res.debt.rate) / 1200) };
  }

  function convertCardBalance(state, cardId, amount, opts, dateIso) {
    const card = (state.cards || []).find((c) => c.id === cardId);
    if (!card || !(amount > 0)) return null;
    amount = Math.round(amount);
    const isEmi = opts && opts.kind === 'emi';
    const starts = dueAfter(card, nextStatementAfter(card, dateIso));
    let debt;
    if (isEmi) {
      const q = emiQuote(amount, opts.rate, opts.months, 0);
      debt = { id: newId('d'), name: card.name + ' EMI', balance: amount, rate: Number(opts.rate) || 0, minPayment: q.emi, dueDay: card.dueDay, fromCard: card.id, months: q.months, starts };
    } else {
      // Interest with GST, and a late fee (with GST) when one was charged.
      const owed = amount + Math.round(Number(opts && opts.lateFee) || 0);
      debt = { id: newId('d'), name: card.name + ' carried balance', balance: owed, rate: cardRate(card), minPayment: Math.max(200, Math.round(owed * 0.05)), dueDay: card.dueDay, fromCard: card.id, starts };
      if (Number(opts && opts.lateFee) > 0) debt.lateFee = Math.round(opts.lateFee);
    }
    state.debts.push(debt);
    const tx = { id: newId('cc'), kind: 'cardconvert', cardId, date: dateIso, amount, note: debt.name, debtId: debt.id, source: 'manual' };
    state.transactions.push(tx);
    const fee = isEmi ? Math.round(Number(opts.fee) || 0) : 0;
    if (fee > 0) {
      tx.feeTx = newId('f');
      state.transactions.push({ id: tx.feeTx, date: dateIso, amount: fee, category: 'Bills', note: debt.name + ' processing fee', paidFrom: card.id, source: 'manual' });
    }
    return { tx, debt };
  }

  function undoCardConvert(state, tx) {
    state.debts = state.debts.filter((d) => d.id !== tx.debtId);
    if (tx.feeTx) state.transactions = state.transactions.filter((t) => t.id !== tx.feeTx);
  }

  // Days in a row, ending yesterday, with no card spending (since the first card was added).
  function cardFreeDays(state, todayIso) {
    const cards = state.cards || [];
    if (!cards.length) return 0;
    const since = cards.map((c) => c.created || todayIso).sort()[0];
    const used = new Set(state.transactions.filter((t) => isFlexible(t) && t.paidFrom && t.paidFrom !== 'account').map((t) => t.date));
    let n = 0;
    let d = addDays(todayIso, -1);
    while (d >= since && !used.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  // ---------- suggestions ----------

  const DEFAULT_SPLIT = [
    ['Groceries', 30], ['Food & dining', 15], ['Travel', 15], ['Shopping', 10],
    ['Entertainment', 10], ['Health', 5], ['Personal care', 5], ['Misc', 10],
  ];

  function weightFor(name) {
    const key = String(name || '').trim().toLowerCase();
    const hit = DEFAULT_SPLIT.find(([n]) => n.toLowerCase() === key);
    return hit ? hit[1] : 5;
  }

  /*
   * Monthly set-asides worked out from the user's own numbers. Budgeting
   * only: it decides how much to put aside, never what to invest it in.
   * - about 20% of salary (less when money is tight)
   * - never out of the money daily life needs: at least 10% of the salary
   *   stays for food, travel and the rest, or nothing is set aside
   * - emergency fund first, until it holds a few months of needs
   * - debts at 15%+ interest get the rest before the Grow budget does
   */
  function autoSavings(state, todayIso) {
    const salary = salaryFor(state, todayIso);
    const fixed = fixedTotal(state, todayIso);
    const mins = sum(debtsThisRound(state, todayIso), (d) => Number(d.minPayment) || 0);
    const sinking = sum(state.sinking, sinkingMonthly) + billsMonthly(state, todayIso) + goalsMonthly(state, todayIso);
    const available = salary - fixed - mins - sinking;
    const notes = [];
    if (available <= 0) {
      if (salary > 0) notes.push(tr('Fixed payments, debt minimums and yearly costs already use the whole salary, so nothing can be set aside yet. The Debts tab shows what clearing the costliest loan frees up.'));
      return { emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, notes, emergencyTarget: 0 };
    }

    const living = salary * 0.1;
    const pool = Math.floor(Math.min(salary * 0.2, available * 0.35, Math.max(0, available - living)) / 100) * 100;
    if (pool <= 0) {
      notes.push(tr('Only {amount} is left after fixed payments and loan minimums, so all of it stays for daily spending and nothing is set aside. The Debts tab shows what clearing the costliest loan frees up.', { amount: rupees(available) }));
      return { emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, notes, emergencyTarget: (Number(state.savings.emergencyTargetMonths) || 3) * (fixed + mins + available) };
    }
    const expensive = state.debts.filter((d) => d.balance > 0 && d.rate >= 15);
    const months = Number(state.savings.emergencyTargetMonths) || 3;
    const target = months * (fixed + mins + available - pool);
    const fundFull = (Number(state.savings.emergencyBalance) || 0) >= target;

    let emergency = fundFull ? 0 : round100(pool * (expensive.length ? 0.4 : 0.6));
    let invest = 0;
    let debtExtra = 0;
    if (expensive.length) {
      debtExtra = pool - emergency;
      const monthlyInterest = sum(expensive, (d) => (d.balance * d.rate) / 1200);
      notes.push(tr(expensive.length > 1
        ? 'Your {names} cost about {amount} a month in interest, so the extra goes there first. The Grow budget starts once they are cleared.'
        : 'Your {names} costs about {amount} a month in interest, so the extra goes there first. The Grow budget starts once it is cleared.',
      { names: expensive.map((d) => d.name).join(tr(' and ')), amount: rupees(monthlyInterest) }));
    } else {
      invest = pool - emergency;
    }
    if (!fundFull) notes.push(tr('The emergency fund gets money until it reaches {amount} ({months} months of needs).', { amount: rupees(target), months }));
    return { emergencyMonthly: emergency, investMonthly: invest, debtExtra, notes, emergencyTarget: target };
  }

  /*
   * Shares the salary out. Whatever is left after fixed payments, debt
   * minimums, yearly costs, set-asides and any budgets the user typed in
   * goes to the automatic budgets by weight (Groceries 30%, Travel 15%, ...).
   * Amounts are whole hundreds (tens when there is little to share, so a
   * small budget like Health isn't rounded to ₹0); the remainder goes to the largest.
   */
  function allocate(state, todayIso) {
    const sv = state.savings;
    // The payday reset can set this month's set-asides without changing the plan.
    const slip = todayIso ? (state.payslips || {})[cycleFor(todayIso, Number(state.settings.payday) || 1).start] : null;
    const override = slip && slip.setAside;
    const savings = override
      ? {
        emergencyMonthly: Number(override.emergency) || 0,
        investMonthly: Number(override.invest) || 0,
        debtExtra: Number(override.debtExtra) || 0,
        notes: [],
      }
      : sv.auto
        ? autoSavings(state, todayIso)
        : {
          emergencyMonthly: Number(sv.emergencyMonthly) || 0,
          investMonthly: Number(sv.investMonthly) || 0,
          debtExtra: Number(sv.debtExtra) || 0,
          notes: [],
        };
    /*
     * Rollovers: what a finished loan's EMI (or half a raise) used to take,
     * kept going to savings so it isn't quietly spent. With no loans left,
     * money meant for loans goes to the emergency fund.
     */
    const rollover = { emergency: 0, debt: 0, grow: 0, total: 0 };
    if (!override) {
      const hasDebt = state.debts.some((d) => d.balance > 0);
      (sv.rollovers || []).forEach((x) => {
        const to = x.to === 'debt' && !hasDebt ? 'emergency' : x.to;
        const a = Number(x.amount) || 0;
        rollover[to] = (rollover[to] || 0) + a;
        rollover.total += a;
      });
      savings.emergencyMonthly += rollover.emergency;
      savings.debtExtra += rollover.debt;
      savings.investMonthly += rollover.grow;
    }
    const salary = salaryFor(state, todayIso);
    const fixed = fixedTotal(state, todayIso);
    const mins = sum(debtsThisRound(state, todayIso), (d) => Number(d.minPayment) || 0);
    const sinking = sum(state.sinking, sinkingMonthly) + billsMonthly(state, todayIso) + goalsMonthly(state, todayIso);
    const pool = salary - fixed - mins - sinking - savings.emergencyMonthly - savings.investMonthly - savings.debtExtra;
    const customTotal = sum(state.budgets.filter((b) => !b.auto), (b) => Number(b.amount) || 0);
    const autoPool = Math.max(0, pool - customTotal);
    const autos = state.budgets.filter((b) => b.auto);
    const wTotal = sum(autos, (b) => weightFor(b.name));
    const amounts = {};
    const step = autoPool >= 10000 ? 100 : 10;
    autos.forEach((b) => { amounts[b.id] = Math.floor((autoPool * weightFor(b.name)) / wTotal / step) * step; });
    if (autos.length) {
      const largest = autos.reduce((a, b) => (weightFor(b.name) > weightFor(a.name) ? b : a));
      amounts[largest.id] += autoPool - sum(autos, (b) => amounts[b.id]);
    }
    const budgets = state.budgets.map((b) => ({
      id: b.id,
      name: b.name,
      auto: !!b.auto,
      share: b.auto && wTotal ? Math.round((weightFor(b.name) / wTotal) * 100) : null,
      amount: b.auto ? amounts[b.id] : Number(b.amount) || 0,
    }));
    return { savings, budgets, pool, autoPool, customTotal, rollover };
  }

  // ---------- insights ----------

  function normalizeMerchant(s) {
    return String(s || '').toLowerCase().split('@')[0].replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function rupees(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

  /*
   * Facts about the last few cycles, each with a rupee figure.
   * Wording states numbers; the user decides what to do with them.
   */
  function insights(state, todayIso, lookback) {
    lookback = lookback || 3;
    const payday = Number(state.settings.payday) || 1;
    const out = [];
    const current = cycleFor(todayIso, payday);
    const cycles = [];
    let c = current;
    for (let k = 0; k < lookback; k++) {
      c = previousCycle(c, payday);
      const txns = spendInRange(state.transactions, c);
      if (txns.length) cycles.push({ cycle: c, txns });
    }

    state.debts.filter((d) => d.balance > 0 && d.rate > 0).forEach((d) => {
      const interest = (d.balance * d.rate) / 1200;
      if (interest >= 100) {
        out.push({
          level: d.rate >= 15 ? 'warn' : 'info',
          title: tr('{name} costs about {amount} a month in interest', { name: d.name, amount: rupees(interest) }),
          body: tr('That is {year} a year at {rate}% a year. The Debts tab shows how much an extra payment saves.', { year: rupees(interest * 12), rate: d.rate }),
        });
      }
    });

    if (!cycles.length) {
      out.push({ level: 'info', title: tr('Trends appear after your first full month'), body: tr('Keep adding spending (or import bank SMS) and this section will show where your money goes.') });
      return out;
    }

    const n = cycles.length;
    const all = [].concat.apply([], cycles.map((x) => x.txns)).filter((t) => NON_PACE_CATEGORIES.indexOf(t.category) === -1);
    const totals = byCategory(all);
    const allocated = allocate(state, todayIso).budgets;
    const budgetMap = {};
    allocated.forEach((b) => { budgetMap[b.name] = b.amount; });

    // Over / under budget on average.
    Object.keys(totals).forEach((cat) => {
      const avg = totals[cat] / n;
      const budget = budgetMap[cat];
      if (budget && avg > budget * 1.1) {
        out.push({
          level: 'warn',
          title: tr('{category} averages {avg} a month against a {budget} budget', { category: tr(cat), avg: rupees(avg), budget: rupees(budget) }),
          body: tr('That is {more} more each month, or {year} a year.', { more: rupees(avg - budget), year: rupees((avg - budget) * 12) }),
        });
      }
    });
    if (n >= 2) {
      const steady = allocated.filter((b) => {
        const under = cycles.every((x) => sum(x.txns.filter((t) => t.category === b.name), (t) => t.amount) <= b.amount);
        const used = cycles.some((x) => x.txns.some((t) => t.category === b.name));
        return under && used && b.amount > 0;
      }).map((b) => b.name);
      if (steady.length) {
        const shown = steady.map((x) => tr(x));
        const names = shown.length > 1 ? shown.slice(0, -1).join(', ') + tr(' and ') + shown[shown.length - 1] : shown[0];
        out.push({ level: 'good', title: tr('{names} stayed within budget for {n} months', { names, n }), body: tr('Whatever is left in these at month end can go to a goal.') });
      }
    }

    // Many small payments.
    Object.keys(totals).forEach((cat) => {
      const small = all.filter((t) => t.category === cat && t.amount <= 300);
      const perMonth = small.length / n;
      if (perMonth >= 8) {
        out.push({
          level: 'info',
          title: tr('{n} small {category} payments a month add up to {amount}', { n: Math.round(perMonth), category: tr(cat), amount: rupees(sum(small, (t) => t.amount) / n) }),
          body: tr('Payments under ₹300 are easy to miss. Halving them would free about {amount} a month.', { amount: rupees(sum(small, (t) => t.amount) / n / 2) }),
        });
      }
    });

    // Repeating payments that look like subscriptions.
    const recentCycles = [current].concat(cycles.map((x) => x.cycle));
    const groups = {};
    state.transactions.forEach((t) => {
      if (!isFlexible(t)) return;
      const key = normalizeMerchant(t.note);
      if (!key) return;
      const idx = recentCycles.findIndex((cy) => inCycle(t.date, cy));
      if (idx === -1) return;
      (groups[key] = groups[key] || []).push({ t, idx });
    });
    Object.keys(groups).forEach((key) => {
      const g = groups[key];
      const seen = new Set(g.map((x) => x.idx));
      if (seen.size < 3 || g.length > seen.size + 1) return;
      const amounts = g.map((x) => x.t.amount).sort((a, b) => a - b);
      const median = amounts[Math.floor(amounts.length / 2)];
      if (amounts.every((a) => Math.abs(a - median) <= median * 0.1)) {
        out.push({
          level: 'info',
          title: tr('{name} looks like a subscription: {amount} a month', { name: g[0].t.note, amount: rupees(median) }),
          body: tr('That is {amount} a year. Still using it?', { amount: rupees(median * 12) }),
        });
      }
    });

    // Weekend vs weekday spending.
    let weekendSpend = 0, weekdaySpend = 0, weekendDays = 0, weekdayDays = 0;
    cycles.forEach((x) => {
      for (let i = 0; i < x.cycle.days; i++) {
        const dow = parseISO(addDays(x.cycle.start, i)).getDay();
        if (dow === 0 || dow === 6) weekendDays++; else weekdayDays++;
      }
      x.txns.forEach((t) => {
        if (NON_PACE_CATEGORIES.indexOf(t.category) !== -1) return;
        const dow = parseISO(t.date).getDay();
        if (dow === 0 || dow === 6) weekendSpend += t.amount; else weekdaySpend += t.amount;
      });
    });
    if (weekendDays && weekdayDays && weekdaySpend > 0) {
      const ratio = (weekendSpend / weekendDays) / (weekdaySpend / weekdayDays);
      if (ratio >= 1.4) {
        out.push({
          level: 'info',
          title: tr('A weekend day costs {ratio}× a weekday', { ratio: ratio.toFixed(1) }),
          body: tr('Average {weekend} per weekend day vs {weekday} on weekdays.', { weekend: rupees(weekendSpend / weekendDays), weekday: rupees(weekdaySpend / weekdayDays) }),
        });
      }
    }

    // Front-loaded spending after payday.
    const firstWeek = sum(all.filter((t) => {
      const cy = cycles.find((x) => inCycle(t.date, x.cycle));
      return cy && daysBetween(cy.cycle.start, t.date) < 7;
    }), (t) => t.amount);
    const allTotal = sum(all, (t) => t.amount);
    if (allTotal > 0 && firstWeek / allTotal >= 0.4) {
      out.push({
        level: 'info',
        title: tr('{pct}% of your spending happens in the week after payday', { pct: Math.round((firstWeek / allTotal) * 100) }),
        body: tr('Spending feels easy when the account is full. The daily "safe to spend" figure on this screen helps even it out.'),
      });
    }

    const rank = { warn: 0, info: 1, good: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  // ---------- debts ----------

  /*
   * Month-by-month payoff simulation.
   * strategy: 'avalanche' (highest rate first) or 'snowball' (smallest balance first).
   * rollover: when a debt is cleared, its minimum keeps going to the next target.
   */
  function simulateDebts(debts, extra, strategy, rollover) {
    const list = debts
      .filter((d) => d.balance > 0)
      .map((d) => ({ name: d.name, bal: Number(d.balance), rate: Number(d.rate) || 0, min: Number(d.minPayment) || 0, left: Math.round(Number(d.emisLeft) || 0) }));
    const budgetBase = sum(list, (d) => d.min) + (Number(extra) || 0);
    const order = (a, b) =>
      strategy === 'snowball' ? a.bal - b.bal || b.rate - a.rate : b.rate - a.rate || a.bal - b.bal;
    let month = 0;
    let totalInterest = 0;
    const cleared = [];
    const MAX = 600;
    while (list.some((d) => d.bal > 0.5) && month < MAX) {
      month++;
      list.forEach((d) => {
        if (d.bal > 0) {
          const i = (d.bal * d.rate) / 1200;
          d.bal += i;
          totalInterest += i;
        }
      });
      const active = list.filter((d) => d.bal > 0);
      let budget = rollover ? budgetBase : sum(active, (d) => d.min) + (Number(extra) || 0);
      active.forEach((d) => {
        const pay = Math.min(d.min, d.bal, budget);
        d.bal -= pay;
        budget -= pay;
        // A loan with a set number of EMIs ends with the last one.
        if (d.left > 0 && pay >= d.min && --d.left === 0) d.bal = 0;
      });
      // Minimums only: what a finishing loan's last EMI didn't need stays with you; only the extra goes on.
      if (!rollover) budget = Math.min(budget, Number(extra) || 0);
      active.filter((d) => d.bal > 0).sort(order).forEach((d) => {
        const pay = Math.min(budget, d.bal);
        d.bal -= pay;
        budget -= pay;
      });
      list.forEach((d) => {
        if (d.bal <= 0.5 && !d.done) {
          d.bal = 0;
          d.done = true;
          cleared.push({ name: d.name, month });
        }
      });
    }
    return { months: month, totalInterest: Math.round(totalInterest), order: cleared, neverPaysOff: month >= MAX };
  }

  /*
   * Two debt-free dates: paying only the minimums ("no change"), and the
   * plan: the extra set aside each month on the costliest loan first, and
   * each cleared loan's payment moving on to the next. null with no loans.
   */
  function debtFreeDates(state, todayIso) {
    const debts = state.debts.filter((d) => d.balance > 0);
    if (!debts.length) return null;
    const extra = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso).debtExtra;
    // Month 1 is the next EMI, so the dates match each loan's own last EMI (loanEnd).
    const base = debts.map((d) => loanEnd(state, d, todayIso)).filter((e) => e && e.next).map((e) => e.next).sort()[0] || addMonths(todayIso, 1);
    const when = (sim) => ({ months: sim.months, interest: sim.totalInterest, never: sim.neverPaysOff, date: sim.neverPaysOff ? null : addMonths(base, sim.months - 1) });
    const now = when(simulateDebts(debts, 0, 'avalanche', false));
    const plan = when(simulateDebts(debts, extra, payoffOrder(state), true));
    // Minimums only: each EMI paid, and a finished loan's EMI goes back to daily spending.
    // The plan: the extra set aside, and each finished loan's EMI moved to the next loan (rollover).
    return {
      now, plan, extra, rollover: debts.length > 1,
      minimums: sum(debts, (d) => Number(d.minPayment) || 0),
      sooner: now.never || plan.never ? 0 : now.months - plan.months,
      saved: now.never || plan.never ? 0 : Math.max(0, now.interest - plan.interest),
    };
  }

  function compareDebtPlans(debts, extra) {
    return {
      minimum: simulateDebts(debts, 0, 'avalanche', false),
      avalanche: simulateDebts(debts, extra, 'avalanche', true),
      snowball: simulateDebts(debts, extra, 'snowball', true),
    };
  }

  // ---------- the debt journey: survive, stabilize, escape ----------

  // The order chosen for clearing loans: highest interest first (saves most) or smallest first (early wins).
  function payoffOrder(state) {
    return state.settings && state.settings.payoffOrder === 'snowball' ? 'snowball' : 'avalanche';
  }

  // The latest due date of a loan on or before todayIso.
  function lastDueOn(todayIso, day) {
    const t = parseISO(todayIso);
    let d = toISO(clampedDate(t.getFullYear(), t.getMonth(), day));
    if (d > todayIso) d = toISO(clampedDate(t.getFullYear(), t.getMonth() - 1, day));
    return d;
  }

  /*
   * Once a day: each loan's EMI comes off after its due date (the EMI less
   * that month's interest), and each loan remembers its highest balance for
   * its progress bar. The balance typed in already counts EMIs paid up to
   * then, so the first run only notes the date. Card EMIs and carried
   * balances are paid through the card bill and left alone.
   * Returns the loans that reached ₹0.
   */
  /*
   * When a loan ends at its EMI: from what's still owed, the interest rate and
   * the EMI (an EMI on a card with a set number left: that number). Each
   * month the interest is added and the EMI comes off, as the bank does.
   * { left, next, last } or { never: true } when the EMI doesn't cover the
   * month's interest (the loan would never end).
   */
  function loanEnd(state, d, todayIso) {
    const bal = Number(d.balance) || 0;
    const emi = Number(d.minPayment) || 0;
    if (!(bal > 0) || !(emi > 0)) return null;
    const card = d.viaCard && (state.cards || []).find((c) => c.id === d.viaCard);
    const day = Number(card ? card.dueDay : d.dueDay) || 1;
    // The next EMI: after the last one counted, or the first, or the next due day from today.
    let next;
    if (d.starts && d.starts > todayIso) next = nextFixedDue({ dueDay: day }, d.starts);
    else if (d.emiThrough) { const f = parseISO(d.emiThrough); next = toISO(clampedDate(f.getFullYear(), f.getMonth() + 1, day)); }
    else next = nextFixedDue({ dueDay: day }, todayIso);
    let left = Math.round(Number(d.emisLeft) || 0);
    if (!(left > 0)) {
      const r = (Number(d.rate) || 0) / 1200;
      if (r > 0 && emi <= bal * r) return { never: true, interest: Math.round(bal * r) };
      left = r > 0 ? Math.ceil(-Math.log(1 - (r * bal) / emi) / Math.log(1 + r) - 1e-9) : Math.ceil(bal / emi);
    }
    const n = parseISO(next);
    return { left, next, last: toISO(clampedDate(n.getFullYear(), n.getMonth() + left - 1, day)) };
  }

  function tickDebts(state, todayIso) {
    const cleared = [];
    state.debts.forEach((d) => {
      const bal = Number(d.balance) || 0;
      if (bal > (Number(d.startBalance) || 0)) d.startBalance = bal;
      const card = d.viaCard && (state.cards || []).find((c) => c.id === d.viaCard);
      const day = Number(card ? card.dueDay : d.dueDay);
      const emi = Number(d.minPayment) || 0;
      if (d.fromCard || !day || !(emi > 0) || !(bal > 0)) return;
      if (!d.emiThrough) { d.emiThrough = lastDueOn(todayIso, day); return; }
      // One EMI a month, each in the month after the last one counted.
      const from = parseISO(d.emiThrough);
      for (let k = 1; d.balance > 0; k++) {
        const due = toISO(clampedDate(from.getFullYear(), from.getMonth() + k, day));
        if (due > todayIso) break;
        const interest = (d.balance * (Number(d.rate) || 0)) / 1200;
        let after = Math.max(0, Math.round(d.balance + interest - emi));
        // With a set number of EMIs left (a card EMI, say), the last one clears it.
        if (Number(d.emisLeft) > 0) {
          d.emisLeft = Math.round(Number(d.emisLeft)) - 1;
          if (d.emisLeft === 0) after = 0;
        }
        d.lastEmi = { date: due, off: Math.round(d.balance - after) };
        d.balance = after;
        d.emiThrough = due;
        if (after === 0) cleared.push(d);
      }
    });
    return cleared;
  }

  // The last day money was borrowed: card spending, or money received that is a loan.
  function lastBorrowed(state, todayIso) {
    let last = null;
    state.transactions.forEach((t) => {
      if (t.date > todayIso) return;
      const borrowed = (isFlexible(t) && t.paidFrom && t.paidFrom !== 'account') || (isIncome(t) && t.borrowed);
      if (borrowed && (!last || t.date > last)) last = t.date;
    });
    return last;
  }

  function emiFor(P, rate, months) { return emiQuote(P, rate, months, 0).emi; }

  /*
   * Where someone with loans stands, and the one next move.
   * - Survive: basics and every minimum covered, no new borrowing. Done when
   *   the salary covers them and nothing was borrowed in the last 30 days.
   *   Wins: 1, 7 and 30 days without borrowing. Short each month: the move
   *   is closing the gap (a call, one cut, a little income), never "no".
   * - Stabilize: 1, then 7 Days of Freedom.
   * - Escape: one loan at a time, in the chosen order, each with a bar of
   *   what's left of its highest balance.
   * Minimums and basics (rent, food, medicine, school fees) always come first.
   */
  function debtJourney(state, todayIso) {
    const j = state.journey || {};
    const debts = state.debts.filter((d) => Number(d.balance) > 0);
    if (!debts.length) return j.start ? { stage: 'free' } : null;
    const f = freedomDays(state, todayIso);
    const plan = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const salary = Number(plan.salary) || 0;
    const needs = f ? f.needs : plan.fixedTotal + plan.debtMin + plan.variableBills;
    const gap = Math.max(0, Math.round(needs - salary));
    const last = lastBorrowed(state, todayIso);
    const clean = last ? Math.max(0, daysBetween(last, todayIso) - 1) : null;
    const surviveDone = gap === 0 && (clean === null || clean >= 30);
    const fdays = f ? f.days : 0;
    const stage = !surviveDone ? 'survive' : fdays < 7 ? 'stabilize' : 'escape';

    const order = payoffOrder(state);
    const sorted = debts.slice().sort((a, b) =>
      order === 'snowball' ? a.balance - b.balance || b.rate - a.rate : b.rate - a.rate || a.balance - b.balance);
    const bosses = sorted.map((d) => {
      const start = Math.max(Number(d.startBalance) || 0, Number(d.balance) || 0);
      return {
        id: d.id, name: d.name, balance: Math.round(d.balance), start, rate: Number(d.rate) || 0,
        emi: Number(d.minPayment) || 0, left: start > 0 ? d.balance / start : 1,
        interest: Math.round((d.balance * (Number(d.rate) || 0)) / 1200), lastEmi: d.lastEmi || null, fromCard: !!d.fromCard,
      };
    });
    const extra = plan.debtExtra;
    const plans = { avalanche: simulateDebts(debts, extra, 'avalanche', true), snowball: simulateDebts(debts, extra, 'snowball', true) };

    let next;
    if (stage === 'survive' && gap > 0) {
      // Close the gap: a longer tenure on the biggest EMI, one cut, then a little income for the rest.
      const loans = debts.filter((d) => !d.fromCard && Number(d.minPayment) > 0).sort((a, b) => b.minPayment - a.minPayment);
      let call = null;
      if (loans.length) {
        const d = loans[0];
        const left = simulateDebts([d], 0, 'avalanche', false);
        if (!left.neverPaysOff) {
          const emi = emiFor(d.balance, d.rate, left.months + 12);
          if (emi < d.minPayment) call = { id: d.id, name: d.name, emi: d.minPayment, newEmi: emi, less: d.minPayment - emi, months: left.months + 12 };
        }
      }
      const leaks = leakSummary(state, todayIso);
      const flex = plan.budgets.filter((b) => ESSENTIAL_CATEGORIES.indexOf(b.name) === -1 && b.base > 0).sort((a, b) => b.base - a.base)[0];
      let cut = null;
      if (leaks.perMonth >= 300) cut = { kind: 'leaks', amount: Math.round(leaks.perMonth / 2), total: leaks.perMonth };
      else if (flex) cut = { kind: 'budget', name: flex.name, amount: Math.round(flex.base * 0.2), total: flex.base };
      const covered = (call ? call.less : 0) + (cut ? cut.amount : 0);
      next = { kind: 'gap', gap, call, cut, earn: Math.max(0, gap - covered) };
    } else if (stage === 'survive') {
      next = { kind: 'clean', clean: clean || 0, goal: !clean ? 1 : clean < 7 ? 7 : 30 };
    } else if (stage === 'stabilize') {
      const target = fdays < 1 ? 1 : 7;
      next = { kind: 'buffer', target, amount: Math.max(0, Math.ceil(target * f.daily - f.fund)), days: fdays };
    } else {
      const boss = bosses[0];
      if (extra > 0) {
        next = { kind: 'extra', boss, amount: extra };
      } else {
        const base = simulateDebts(debts, 0, order, true);
        const more = simulateDebts(debts, 1000, order, true);
        next = { kind: 'start', boss, amount: 1000, sooner: base.neverPaysOff || more.neverPaysOff ? 0 : base.months - more.months, saves: Math.max(0, base.totalInterest - more.totalInterest) };
      }
    }
    return {
      stage, gap, clean, last, best: Math.max(Number(j.best) || 0, clean || 0), freedom: f, fdays,
      order, bosses, plans, extra, next,
      milestones: { survive: [1, 7, 30], stabilize: [1, 7] },
    };
  }

  /*
   * Calls to lenders, one at a time:
   * 1. List every loan with its rate and due day.
   * 2. One easy call: move an EMI that leaves late in the month to just after
   *    payday, or ask for a card late fee to be waived.
   * 3. Log spending for 60 days, so the numbers behind the next ask are real.
   * 4. Ask each costly loan (12%+, highest first) for a lower rate; while the
   *    salary is short of the basics, also a longer tenure.
   * A call made counts as a win whatever the answer; the next day asks how it went.
   */
  function lenderTasks(state, todayIso) {
    const j = state.journey || {};
    const calls = j.calls || [];
    const debts = state.debts.filter((d) => Number(d.balance) > 0);
    if (!debts.length) return null;
    const payday = Number(state.settings.payday) || 1;
    const answered = (key, id) => calls.some((c) => c.task === key && c.debtId === id && c.result && c.result !== 'later');
    const tasks = [];

    const missing = debts.filter((d) => !d.fromCard && (!(Number(d.rate) > 0) || !Number(d.dueDay) || !(Number(d.minPayment) > 0)));
    tasks.push({ key: 'list', done: !missing.length, missing: missing.map((d) => d.name || '') });

    // EMI leaving 10+ days after payday: by then the account is lower.
    const late = debts.filter((d) => !d.fromCard && Number(d.dueDay) && Number(d.minPayment) > 0)
      .map((d) => ({ d, after: (Number(d.dueDay) - payday + 31) % 31 }))
      .filter((x) => x.after > 10 && !answered('easy', x.d.id))
      .sort((a, b) => b.d.minPayment - a.d.minPayment)[0];
    const fee = debts.filter((d) => d.fromCard && Number(d.lateFee) > 0 && !answered('easy', d.id))[0];
    const easyDone = calls.some((c) => c.task === 'easy' && c.result && c.result !== 'later');
    if (late && !easyDone) {
      const want = Math.min(28, payday + 2);
      tasks.push({ key: 'easy', kind: 'due', done: false, debtId: late.d.id, name: late.d.name, emi: Number(late.d.minPayment), day: Number(late.d.dueDay), want, after: late.after });
    } else if (fee && !easyDone) {
      tasks.push({ key: 'easy', kind: 'fee', done: false, debtId: fee.id, name: fee.name, fee: Number(fee.lateFee) });
    } else {
      tasks.push({ key: 'easy', done: true, skipped: !easyDone });
    }

    const start = j.start || todayIso;
    const logged = new Set(state.transactions.filter((t) => t.date >= start && t.date <= todayIso).map((t) => t.date)).size;
    tasks.push({ key: 'log', done: logged >= 60, logged, goal: 60 });

    const plan = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const f = freedomDays(state, todayIso);
    const short = f ? f.needs > plan.salary : false;
    const costly = debts.filter((d) => Number(d.rate) >= 12 && !answered('deal', d.id)).sort((a, b) => b.rate - a.rate);
    const offers = costly.map((d) => {
      // A loan: ask for about 4 points less. A carried card balance: ask to turn it into an EMI at about 18%.
      const target = d.fromCard ? Math.min(Number(d.rate), 18) : Math.max(10.5, Math.round((Number(d.rate) - 4) * 2) / 2);
      const now = simulateDebts([d], 0, 'avalanche', false);
      const lower = simulateDebts([Object.assign({}, d, { rate: target })], 0, 'avalanche', false);
      const o = {
        debtId: d.id, name: d.name, kind: d.fromCard ? 'emi' : 'rate', rate: Number(d.rate), target, emi: Number(d.minPayment) || 0, balance: Math.round(d.balance),
        saves: now.neverPaysOff ? null : Math.max(0, now.totalInterest - lower.totalInterest),
        sooner: now.neverPaysOff || lower.neverPaysOff ? 0 : now.months - lower.months,
      };
      if (short && !d.fromCard && !now.neverPaysOff && o.emi > 0) {
        const emi = emiFor(d.balance, d.rate, now.months + 12);
        const longer = emiQuote(d.balance, d.rate, now.months + 12, 0);
        if (emi < o.emi) o.tenure = { emi, less: o.emi - emi, months: now.months + 12, extraInterest: Math.max(0, longer.interest - now.totalInterest) };
      }
      return o;
    });
    const share = plan.salary > 0 ? Math.round((plan.debtMin / plan.salary) * 100) : 0;
    tasks.push({ key: 'deal', done: !offers.length, unlocked: tasks[2].done, offer: offers[0] || null, more: Math.max(0, offers.length - 1), share, salary: plan.salary, debtMin: plan.debtMin });

    const current = tasks.find((t) => !t.done && (t.key !== 'deal' || t.unlocked)) || null;
    const follow = calls.find((c) => !c.result && c.follow <= todayIso) || null;
    const pending = calls.find((c) => !c.result) || null;
    return { tasks, current, follow, pending, made: calls.length };
  }

  // ---------- emergencies ----------

  /*
   * Recovery plan for an unexpected cost:
   * 1. the emergency fund pays what it can
   * 2. the rest comes out of this month's money
   * 3. Grow and extra debt payments pause and flexible budgets shrink until
   *    that shortfall is made back
   * 4. then the emergency fund refills at its normal monthly amount
   */
  function emergencyPlan(state, amount, cutPct, todayIso) {
    amount = Number(amount) || 0;
    const fund = Number(state.savings.emergencyBalance) || 0;
    const fromFund = Math.min(fund, amount);
    const shortfall = amount - fromFund;
    const base = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const flexCut = Math.round((base.flexTotal * cutPct) / 100);
    const freed = base.invest + base.debtExtra + flexCut;
    const recoverMonths = shortfall > 0 ? (freed > 0 ? Math.ceil(shortfall / freed) : Infinity) : 0;
    const refillMonths = fromFund > 0
      ? (base.emergency > 0 ? Math.ceil(fromFund / base.emergency) : Infinity)
      : 0;
    return {
      amount, fromFund, shortfall, freed, flexCut,
      pausedInvest: base.invest, pausedDebtExtra: base.debtExtra,
      recoverMonths, refillMonths,
      backOnTrack: isFinite(recoverMonths) ? addMonths(todayIso, recoverMonths) : null,
      fundRefilled: isFinite(recoverMonths + refillMonths) ? addMonths(todayIso, recoverMonths + refillMonths) : null,
    };
  }

  // ---------- money received ----------

  function rupeesIn(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

  function shortDate(iso) {
    if (dateLabel) return dateLabel(iso);
    const d = parseISO(iso);
    return d.getDate() + ' ' + MONTHS[d.getMonth()].replace(/^./, (c) => c.toUpperCase());
  }

  /*
   * The choices for money received, each with what it would change, and a
   * suggestion: cover this month first if money would run out, then a
   * one-month emergency fund, then loans at 15%+ interest, then the full
   * emergency fund, then Grow.
   */
  function incomeOptions(state, txId, todayIso) {
    const tx = state.transactions.find((t) => t.id === txId);
    if (!tx) return null;
    const amount = tx.amount;
    const withUse = (use) => Object.assign({}, state, {
      transactions: state.transactions.map((t) => (t.id === txId ? Object.assign({}, t, { useFor: use }) : t)),
    });
    const kept = projectRunway(withUse('spend'), todayIso);
    const without = projectRunway(withUse('emergency'), todayIso);

    const p = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const needs = p.fixedTotal + p.debtMin + p.flexTotal;
    const target = (Number(state.savings.emergencyTargetMonths) || 3) * needs;
    const fund = Number(state.savings.emergencyBalance) || 0;
    const debts = state.debts.filter((d) => d.balance > 0);
    const top = debts.slice().sort((a, b) => b.rate - a.rate)[0];
    const options = [];

    let spendDetail = tr('Adds {amount} to this month’s spending money. Today’s amount goes from {from} to {to}.',
      { amount: rupeesIn(amount), from: rupeesIn(without.dailyAllowance), to: rupeesIn(kept.dailyAllowance) });
    if (without.zeroPace !== kept.zeroPace) {
      const v = { date: kept.zeroPace ? shortDate(kept.zeroPace) : '', before: without.zeroPace ? shortDate(without.zeroPace) : '' };
      spendDetail += ' ' + tr(kept.zeroPace
        ? (without.zeroPace ? 'At this pace your money lasts until {date} instead of {before}.' : 'At this pace your money lasts until {date} instead of payday.')
        : 'At this pace your money lasts until payday instead of {before}.', v);
    }
    options.push({ use: 'spend', title: tr('Keep it for this month'), detail: spendDetail });

    options.push({
      use: 'emergency',
      title: tr('Add to emergency fund'),
      detail: tr('Emergency fund goes from {from} to {to} of your {target} target.', { from: rupeesIn(fund), to: rupeesIn(fund + amount), target: rupeesIn(target) }),
    });

    let saved = null;
    if (top) {
      const paid = Math.min(amount, top.balance);
      const extra = allocate(state, todayIso).savings.debtExtra;
      const before = simulateDebts(debts, extra, 'avalanche', true);
      const after = simulateDebts(debts.map((d) => (d === top ? Object.assign({}, d, { balance: d.balance - paid }) : d)), extra, 'avalanche', true);
      saved = Math.max(0, before.totalInterest - after.totalInterest);
      const sooner = before.months - after.months;
      options.push({
        use: 'debt',
        title: tr('Pay off {name}', { name: top.name }),
        debtId: top.id,
        detail: tr('Pays {amount} off {name} ({rate}% a year).', { amount: rupeesIn(paid), name: top.name, rate: top.rate }) +
          (before.neverPaysOff ? '' : ' ' + (sooner > 0
            ? tr(sooner === 1 ? 'Saves about {saved} in interest and you’re debt-free {n} month sooner.' : 'Saves about {saved} in interest and you’re debt-free {n} months sooner.', { saved: rupeesIn(saved), n: sooner })
            : tr('Saves about {saved} in interest.', { saved: rupeesIn(saved) }))) +
          (paid < amount ? ' ' + tr('The other {amount} stays for this month.', { amount: rupeesIn(amount - paid) }) : ''),
      });
    }

    // A gift meant for a purchase: kept out of daily spending until it's used.
    options.push({
      use: 'keep',
      title: tr('Keep it for something to buy'),
      detail: tr('It stays in your account, out of daily spending, until you buy it. Today’s amount stays {amount}.', { amount: rupeesIn(without.dailyAllowance) }),
    });

    options.push({
      use: 'grow',
      title: tr('Set aside to invest'),
      detail: tr('Adds to the {amount} you’ve set aside to invest.', { amount: rupeesIn(Number(state.savings.investSaved) || 0) }) + ' ' +
        tr('Talk to a SEBI-registered investment adviser before investing it.'),
    });

    // Money taken back out of your own savings: yours already, so not new money (bank rule: a transfer, not income).
    const fundNow = Number(state.savings.emergencyBalance) || 0;
    const growNow = Number(state.savings.investSaved) || 0;
    if (fundNow > 0) options.push({ use: 'fromfund', title: tr('It came from my emergency fund'),
      detail: tr('Not new money: the fund goes down by {amount}, and it’s here to spend.', { amount: rupeesIn(Math.min(amount, fundNow)) }) });
    if (growNow > 0) options.push({ use: 'fromgrow', title: tr('It came from my savings or investments'),
      detail: tr('Not new money: what you’ve set aside goes down by {amount}, and it’s here to spend.', { amount: rupeesIn(Math.min(amount, growNow)) }) });

    const s = suggestUse(state, todayIso, without.zeroPace ? tr('Without this money, at your current pace you run out on {date}, before payday.', { date: shortDate(without.zeroPace) }) : null);
    // Keeping it while an expensive loan is open has a cost worth seeing.
    if (top && top.rate >= 15) options[0].badge = tr('Extends this month’s budget, but delays your debt-free date');
    return { tx, options, recommended: s.use, reason: s.reason, interestSaved: saved };
  }

  // ---------- payday reset ----------

  /*
   * The three steps of the payday reset, from the same numbers as the rest
   * of the app: what's committed, what's set aside first, and the safe
   * daily amount. `setAside` can replace this month's set-asides to preview
   * an edit before it's saved.
   */
  function paydayReset(state, todayIso, setAside) {
    const cyc = cycleFor(todayIso, Number(state.settings.payday) || 1);
    let s = state;
    if (setAside) {
      const slips = Object.assign({}, state.payslips || {});
      slips[cyc.start] = Object.assign({}, slips[cyc.start] || {}, { setAside });
      s = Object.assign({}, state, { payslips: slips });
    }
    const p = monthlyPlan(s, todayIso);
    const committed = [
      ['Fixed payments (rent, EMIs, subscriptions)', p.fixedTotal],
      ['Loan minimums and EMIs', p.debtMin],
      ['Bills that vary (monthly share)', p.variableBills],
      ['Yearly costs (monthly share)', p.sinking],
      ['Savings goals', p.goals],
    ].filter((x) => x[1] > 0);
    const committedTotal = sum(committed, (x) => x[1]);
    const free = p.salary - committedTotal;
    const parts = { emergency: p.emergency, debtExtra: p.debtExtra, invest: p.invest };
    const setAsideTotal = p.emergency + p.debtExtra + p.invest;
    const r = projectRunway(s, todayIso);
    return {
      cycle: cyc, salary: p.salary, committed, committedTotal, free,
      parts, setAsideTotal, flexible: p.flexTotal,
      daily: r.dailyAllowance, days: cyc.days - daysBetween(cyc.start, todayIso),
      freedom: freedomDays(s, todayIso),
    };
  }

  // ---------- behaviour: the numbers behind the nudges ----------

  /*
   * One order for every "what should this money do?" suggestion:
   * 1. keep it, if this month would otherwise run out (`runsOut` says why)
   * 2. the emergency fund, until it covers 30 days of basics
   * 3. loans at 15%+ interest
   * 4. the emergency fund, up to its full target
   * 5. invest
   * An empty fund comes before debt: without it, the next surprise goes on a card.
   */
  function suggestUse(state, todayIso, runsOut) {
    if (runsOut) return { use: 'spend', reason: runsOut };
    const f = freedomDays(state, todayIso);
    const days = f ? f.days : 0;
    const top = state.debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
    if (days < 30) {
      return { use: 'emergency', reason: tr(days === 1 ? 'Your emergency fund covers {n} day of basics. A 30-day shield comes first, so the next surprise doesn’t go on a card.' : 'Your emergency fund covers {n} days of basics. A 30-day shield comes first, so the next surprise doesn’t go on a card.', { n: days }) };
    }
    if (top && top.rate >= 15) {
      return { use: 'debt', reason: tr('{name} charges {rate}% a year. Paying it down saves that interest for certain.', { name: top.name, rate: top.rate }), debtId: top.id };
    }
    const p = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const target = (Number(state.savings.emergencyTargetMonths) || 3) * (p.fixedTotal + p.debtMin + p.variableBills + p.flexTotal);
    if ((Number(state.savings.emergencyBalance) || 0) < target) {
      return { use: 'emergency', reason: tr('Your emergency fund is still below its {months}-month target.', { months: state.savings.emergencyTargetMonths || 3 }) };
    }
    return { use: 'grow', reason: tr('This month is covered, your emergency fund is full and there are no expensive loans.') };
  }

  /*
   * Days of Freedom: how long the emergency fund covers the basics (fixed
   * payments, loan minimums, bills that vary, groceries and health). Null
   * until there are basics to measure against.
   */
  function freedomDays(state, todayIso) {
    const p = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const essentials = sum(p.budgets.filter((b) => ESSENTIAL_CATEGORIES.indexOf(b.name) !== -1), (b) => b.base);
    const needs = p.fixedTotal + p.debtMin + p.variableBills + essentials;
    if (needs <= 0) return null;
    const daily = needs / 30;
    const fund = Number(state.savings.emergencyBalance) || 0;
    const days = Math.floor(fund / daily);
    // Levels: red 0-6 days, amber 7-29, green 30+ (a month of basics covered). Always shown with a label.
    const level = days >= 30 ? 'green' : days >= 7 ? 'amber' : 'red';
    const badge = days >= 90 ? 'Three months safe' : days >= 30 ? 'A month safe' : days >= 7 ? 'Building' : 'At risk';
    // The next milestone: 7 days turns it amber, 30 green, 90 is three months.
    const target = days < 7 ? 7 : days < 30 ? 30 : days < 90 ? 90 : 0;
    const next = target ? { days: target - days, amount: Math.max(0, Math.ceil(target * daily - fund)), target, level: target === 7 ? 'amber' : target === 30 ? 'green' : 'three months' } : null;
    const parts = { fixed: p.fixedTotal, debtMin: p.debtMin, bills: p.variableBills, essentials };
    return { days, daily, needs, fund, badge, level, next, parts };
  }

  /*
   * Interest leaking out each day. Only money that actually costs interest
   * counts: loans (including card EMIs and carried balances) and card bills
   * past their due date. A card bill paid in full by its due date costs nothing.
   */
  function interestLeak(state, todayIso) {
    const items = [];
    state.debts.filter((d) => d.balance > 0).forEach((d) => {
      items.push({ name: d.name, balance: Number(d.balance) || 0, rate: Number(d.rate) || 0 });
    });
    (state.cards || []).forEach((c) => {
      const st = cardStatus(state, c, todayIso);
      if (st.overdue) items.push({ name: tr('{name} (overdue bill)', { name: c.name }), balance: st.remaining, rate: cardRate(c) });
    });
    items.forEach((x) => { x.daily = (x.balance * x.rate) / 36500; });
    const daily = sum(items, (x) => x.daily);
    return { daily, monthly: daily * 30, items, high: items.some((x) => x.rate >= 15 && x.balance > 0) };
  }

  /*
   * Next payday, after what this month's money can't cover. Card spending
   * was already taken from this month, so only these are subtracted:
   * - this month's shortfall at the current pace (a forecast: whatever covers it is borrowed)
   * - card bills from before the card was added that fall due next month
   * - card EMIs and carried card balances that start next month
   * Fixed payments, loan minimums and bills are then shown as what's committed.
   */
  function nextPaydayPreview(state, todayIso) {
    const r = projectRunway(state, todayIso);
    const payday = Number(state.settings.payday) || 1;
    const next = cycleFor(r.cycle.next, payday);
    const nominal = Number(state.settings.salary) || 0;
    const shortfall = Math.max(0, -Math.round(r.endPace));
    let fromBefore = 0;
    (state.cards || []).forEach((c) => {
      cardLegacyEvents(state, c, todayIso).forEach((e) => { if (inCycle(e.date, next)) fromBefore += e.amount; });
    });
    const startsNext = (d) => d.fromCard && d.starts && inCycle(d.starts, next) && d.balance > 0;
    const newCardDebt = sum(state.debts.filter(startsNext), (d) => Number(d.minPayment) || 0);
    const borrowed = Math.round(shortfall + fromBefore + newCardDebt);
    const effective = Math.max(0, nominal - borrowed);
    const committed = Math.round(
      fixedTotal(state, next.start) +
      sum(state.debts.filter((d) => d.balance > 0 && !startsNext(d)), (d) => Number(d.minPayment) || 0) +
      billsMonthly(state, next.start) + sum(state.sinking, sinkingMonthly) + goalsMonthly(state, next.start)
    );
    // Likely costs due next round.
    const maybeNext = sum(maybeOpen(state).filter((m) => m.likely === 'likely' && inCycle(m.date, next)), (m) => Math.round(Number(m.amount)));
    return {
      date: next.start, nominal, shortfall, fromBefore, newCardDebt, borrowed, effective,
      percent: nominal > 0 ? (borrowed / nominal) * 100 : 0,
      depleted: nominal > 0 && nominal - borrowed <= 0,
      committed, maybeNext, freeAfter: effective - committed - maybeNext,
    };
  }

  // ---------- before you borrow ----------

  // Lenders and Pay Later apps: money from them is borrowed, not earned. "=" means a whole word.
  const LENDERS = ['kreditbee', 'moneyview', 'money view', '=navi', '=fibe', 'earlysalary', '=cashe', 'mpokket', 'kissht', 'stashfin',
    'lazypay', '=simpl', 'zestmoney', 'paysense', 'moneytap', '=dhani', 'home credit', 'bajaj finserv', 'tata capital', 'truebalance', 'smartcoin'];

  // A bank "credited" SMS for money that has to be paid back: a loan payout or a credit line.
  function isLoanCredit(text) {
    const t = String(text || '').toLowerCase();
    if (/\bloans?\b|disburs|credit line|pay ?later/.test(t)) return true;
    return LENDERS.some((w) => keywordMatches(t, w));
  }

  /*
   * Borrowed this cycle so far: spending on credit cards (borrowed until the
   * bill is paid) and money received that is a loan.
   */
  function borrowedThisCycle(state, todayIso) {
    const cyc = cycleFor(todayIso, Number(state.settings.payday) || 1);
    const txs = state.transactions.filter((t) => inCycle(t.date, cyc) && t.date <= todayIso);
    const card = sum(txs.filter((t) => isFlexible(t) && t.paidFrom && t.paidFrom !== 'account'), (t) => t.amount);
    const loans = sum(txs.filter((t) => isIncome(t) && t.borrowed), (t) => t.amount);
    return { total: card + loans, card, loans };
  }

  /*
   * Before borrowing for a big expense: how to pay it without a loan, and what
   * borrowing would cost instead.
   * - urgent (a repair, a hospital bill): the emergency fund first (that's what
   *   it's for), then pausing this month's Grow and extra loan payment, then
   *   this month's money down to bills and basics. What's left is the shortfall.
   * - can wait (a purchase): this month's spare money if it fits, the next
   *   salary, or saving for it over 3, 6 or 12 months, next to the cost of an EMI.
   * Daily amounts come from running the runway with the expense added.
   */
  function borrowCheck(state, amount, todayIso) {
    amount = Math.max(0, Math.round(Number(amount) || 0));
    const r = projectRunway(state, todayIso);
    const z = zoneStatus(state, todayIso, r);
    const cyc = r.cycle;
    const spare = Math.max(0, Math.floor(z.money - z.needs));
    const fund = Number(state.savings.emergencyBalance) || 0;
    const setAsides = r.plan.adjustment ? 0 : r.plan.invest + r.plan.debtExtra;

    // The runway with this expense paid today, plus any money moved in to cover it.
    const after = (fromFund, pause) => {
      const txs = state.transactions.concat([{ id: '_bc', date: todayIso, amount, category: 'Misc', note: 'Big expense' }]);
      if (fromFund > 0) txs.push({ id: '_bf', kind: 'in', date: todayIso, amount: fromFund, category: 'From emergency fund', useFor: 'spend', fromFund: true });
      const s = Object.assign({}, state, { transactions: txs, savings: Object.assign({}, state.savings, { emergencyBalance: fund - fromFund }) });
      if (pause) s.adjustment = { until: cyc.next, flexCutPct: 0, pauseInvest: true, pauseDebtExtra: true, reason: 'Big expense' };
      const r2 = projectRunway(s, todayIso);
      const z2 = zoneStatus(s, todayIso, r2);
      return { daily: r2.remainingDays > 0 ? r2.tomorrowAllowance : 0, zone: z2.zone, freedom: freedomDays(s, todayIso) };
    };
    const daily = r.remainingDays > 0 ? r.tomorrowAllowance : 0;

    let left = amount;
    const fromFund = Math.min(fund, left); left -= fromFund;
    const pause = Math.min(setAsides, left); left -= pause;
    const fromMonth = Math.min(spare, left); left -= fromMonth;
    const urgentAfter = after(fromFund, pause > 0);
    const f = freedomDays(state, todayIso);

    const cards = state.cards || [];
    const cardRate = cards.length ? Math.max.apply(null, cards.map((c) => Number(c.rate) || 42)) : 42;
    const quotes = (P) => {
      const monthly = Math.max(200, Math.round(P * 0.05));
      return { amount: P, cardRate, cardMonthly: monthly, card: revolveQuote(P, cardRate, monthly), loan: emiQuote(P, 16, 12, 0) };
    };

    const preview = nextPaydayPreview(state, todayIso);
    const save = [3, 6, 12].map((n) => ({
      months: n,
      monthly: Math.ceil(amount / n / 100) * 100,
      ready: addMonths(cyc.next, n - 1),
      emi: emiQuote(amount, 16, n, 0),
    }));

    return {
      amount, spare, fund, daily, zone: z.zone, nextPayday: cyc.next, daysToPay: r.remainingDays + 1,
      urgent: {
        fromFund, pause, fromMonth, shortfall: left,
        dailyAfter: urgentAfter.daily, zoneAfter: urgentAfter.zone,
        freedomBefore: f ? f.days : null, freedomAfter: urgentAfter.freedom ? urgentAfter.freedom.days : null,
        borrow: left > 0 ? quotes(left) : null,
      },
      wait: {
        fits: amount <= spare,
        dailyAfter: amount <= spare ? after(0, false).daily : null,
        nextFree: Math.max(0, Math.round(preview.freeAfter)),
        save,
        borrow: quotes(amount),
      },
    };
  }

  /*
   * When a loan ends (or pay goes up), the money it took can keep going to
   * freedom instead of quietly becoming spending. What each choice does,
   * suggested in the usual safety-first order.
   */
  function rolloverOptions(state, amount, todayIso) {
    amount = Number(amount) || 0;
    const debts = state.debts.filter((d) => d.balance > 0);
    const extra = allocate(state, todayIso).savings.debtExtra;
    const options = [];
    if (debts.length) {
      const before = simulateDebts(debts, extra, 'avalanche', true);
      const after = simulateDebts(debts, extra + amount, 'avalanche', true);
      const sooner = before.months - after.months;
      options.push({
        to: 'debt',
        title: tr('Pay off your other loans faster'),
        detail: before.neverPaysOff
          ? tr('Gets your loans paying down instead of growing.')
          : tr(sooner > 1 ? 'Debt-free {n} months sooner, about {amount} less interest.' : sooner === 1 ? 'Debt-free {n} month sooner, about {amount} less interest.' : 'Debt-free sooner, about {amount} less interest.',
            { n: sooner, amount: rupeesIn(before.totalInterest - after.totalInterest) }),
      });
    }
    const f = freedomDays(state, todayIso);
    options.push({
      to: 'emergency',
      title: tr('Build your emergency fund'),
      detail: f ? tr('+{n} Days of Freedom every month.', { n: Math.floor(amount / f.daily) }) : tr('Adds {amount} a month to your emergency fund.', { amount: rupeesIn(amount) }),
    });
    options.push({ to: 'grow', title: tr('Set aside to invest'), detail: tr('{amount} a month to invest.', { amount: rupeesIn(amount) }) + ' ' + tr('Talk to a SEBI-registered investment adviser about where.') });
    options.push({ to: 'spend', title: tr('Spend it'), detail: tr('Your flexible budgets grow by {amount} a month.', { amount: rupeesIn(amount) }) });
    const s = suggestUse(state, todayIso, null);
    return { options, recommended: s.use === 'debt' && !debts.length ? 'emergency' : s.use, reason: s.reason };
  }

  // ---------- month-end report card ----------

  // Small payments that are easy to miss: everyday spending under this amount.
  const SMALL_PAYMENT = 200;

  /*
   * How the salary cycle before the one containing todayIso went.
   * Wins: days with no credit card spending, leftovers moved to savings or
   * loans, extra loan payments (and the interest they save at today's
   * balances), loans cleared. Watch-outs: the flexible category furthest
   * over its budget, and everyday payments under ₹200.
   */
  function monthReport(state, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const cycle = previousCycle(cycleFor(todayIso, payday), payday);
    const txs = state.transactions.filter((t) => inCycle(t.date, cycle));
    const cardDates = new Set(txs.filter((t) => isFlexible(t) && t.paidFrom && t.paidFrom !== 'account').map((t) => t.date));

    const swept = { emergency: 0, debt: 0, grow: 0, total: 0 };
    txs.filter((t) => isMove(t) && !t.setAside && swept[t.useFor] !== undefined).forEach((t) => {
      swept[t.useFor] += t.amount;
      swept.total += t.amount;
    });

    // Extra loan payments: money received or saved that went to a loan.
    const paid = {};
    txs.filter((t) => t.useFor === 'debt' && t.debtId).forEach((t) => { paid[t.debtId] = (paid[t.debtId] || 0) + (Number(t.debtPaid) || t.amount); });
    const debtPaid = sum(Object.keys(paid), (id) => paid[id]);
    let interestSaved = 0;
    if (debtPaid > 0) {
      const extra = allocate(state, todayIso).savings.debtExtra;
      const now = simulateDebts(state.debts, extra, 'avalanche', true);
      const before = simulateDebts(state.debts.map((d) => (paid[d.id] ? Object.assign({}, d, { balance: (Number(d.balance) || 0) + paid[d.id] }) : d)), extra, 'avalanche', true);
      if (!now.neverPaysOff && !before.neverPaysOff) interestSaved = Math.max(0, before.totalInterest - now.totalInterest);
    }
    const cleared = (state.savings.rollovers || []).filter((x) => x.kind !== 'raise' && x.from !== 'Half your raise' && inCycle(x.date, cycle)).map((x) => x.from);

    const plan = monthlyPlan(state, cycle.start);
    const spent = byCategory(txs.filter((t) => isFlexible(t) && NON_PACE_CATEGORIES.indexOf(t.category) === -1));
    let overspent = null;
    plan.budgets.forEach((b) => {
      const over = (spent[b.name] || 0) - b.amount;
      if (b.amount > 0 && over > 0 && (!overspent || over > overspent.over)) overspent = { name: b.name, budget: b.amount, spent: spent[b.name], over };
    });

    const small = txs.filter((t) => isFlexible(t) && t.amount < SMALL_PAYMENT && ['Bills', 'Emergency'].indexOf(t.category) === -1);
    return {
      cycle, last: addDays(cycle.next, -1), days: cycle.days, active: txs.length > 0,
      cardFree: cycle.days - cardDates.size, hasCards: (state.cards || []).length > 0,
      swept, debtPaid, interestSaved, cleared, overspent,
      small: { count: small.length, total: sum(small, (t) => t.amount), under: SMALL_PAYMENT },
    };
  }

  // ---------- wallets ----------

  /*
   * Where the money sits. Each wallet other than the main bank account starts
   * from its own count ("balance this morning", or ₹0 when it was added) and
   * moves with what is paid from it, received into it and moved between
   * wallets. The main account is what's left of the total once the other
   * wallets are counted, so the parts always add up to the total.
   * morning: leave out today's entries (the balances as the day began).
   */
  /*
   * Each flexible budget for the cycle containing todayIso, as an envelope:
   * the plan's amount (only the days from a balance check, if the person
   * joined mid-cycle), plus money covered in from other budgets (or minus
   * money covered out), plus what's left from last cycle when that budget
   * keeps its leftover. Only a leftover carries: overspending already came
   * out of the money. Today's limit still goes by the money itself.
   */
  function budgetEnvelopes(state, todayIso, depth) {
    const payday = Number(state.settings.payday) || 1;
    const cyc = cycleFor(todayIso, payday);
    const plan = monthlyPlan(state, todayIso);
    const check = state.balanceCheck;
    const anchor = check && inCycle(check.date, cyc) && check.date <= todayIso ? check : null;
    const share = anchor ? (cyc.days - daysBetween(cyc.start, anchor.date)) / cyc.days : 1;
    const from = anchor ? anchor.date : cyc.start;
    const spent = byCategory(spendInRange(state.transactions, cyc).filter((t) => t.date >= from && t.date <= todayIso)
      .map((t) => (t.maybeId ? Object.assign({}, t, { amount: 0 }) : t.covered ? Object.assign({}, t, { amount: t.amount - (Number(t.covered) || 0) }) : t)));
    const moves = (state.budgetMoves || []).filter((m) => m.cycle === cyc.start);
    const own = {};
    (state.budgets || []).forEach((b) => { own[b.name] = b; });
    let prev = null;
    const list = plan.budgets.map((b) => {
      const planned = Math.round((b.amount * share) / 10) * 10;
      const moved = sum(moves.filter((m) => m.to === b.name), (m) => m.amount) - sum(moves.filter((m) => m.from === b.name), (m) => m.amount);
      let carried = 0;
      const o = own[b.name];
      if (o && o.carry && o.carryFrom && (depth || 0) < 24) {
        const last = previousCycle(cyc, payday);
        if (last.start >= o.carryFrom) {
          prev = prev || budgetEnvelopes(state, addDays(cyc.start, -1), (depth || 0) + 1).list;
          const p = prev.find((x) => x.name === b.name);
          carried = p ? Math.max(0, p.left) : 0;
        }
      }
      const available = planned + moved + carried;
      const s = spent[b.name] || 0;
      return { name: b.name, planned, moved, carried, carry: !!(o && o.carry), available, spent: s, left: available - s };
    });
    const others = Object.keys(spent).filter((c) => !list.some((x) => x.name === c)).map((c) => ({ name: c, spent: spent[c] }));
    return { cycle: cyc, list, others, over: list.filter((x) => x.left < 0 && x.available >= 0 && x.spent > 0 && (x.available > 0 || x.planned > 0)) };
  }

  /*
   * What you own minus what you owe, today: the money in the account and
   * wallets, the emergency fund and money set aside to invest, less loans
   * and what was owed on credit cards when they were added.
   * Yearly costs and goals are part of the account's money already.
   */
  function netWorth(state, todayIso) {
    const r = projectRunway(state, todayIso);
    // Money owed to a friend that's due today is still in the account until paid: it counts once, as owed.
    const iouDue = sum(iouEvents(state, r.cycle, todayIso).filter((e) => e.date <= todayIso), (e) => e.amount);
    // The side vault is in the account; it's shown with the funds instead. Money owed back on claims is yours too.
    const rv = state.reimb ? reimbView(state) : { vault: 0, pendingFloat: 0 };
    const money = Math.max(0, (Number(r.balanceToday) || 0) + iouDue - rv.vault);
    const sv = state.savings || {};
    // Money moved out of the account into a goal (Jar for a bike) is still yours; set-asides for goals stay in the account.
    // Money received and given to a goal stays in the account but outside the balance shown, like the emergency fund.
    // A saving not yet given a place (Jar, still to choose) is yours too.
    const goalIds = new Set((state.goals || []).map((g) => g.id));
    const funds = (Number(sv.emergencyBalance) || 0) + (Number(sv.investSaved) || 0) +
      sum(state.goals || [], (g) => Number(g.savedOutside) || 0) +
      sum(state.transactions.filter((t) => t.date <= todayIso && ((isIncome(t) && t.useFor === 'goal' && goalIds.has(t.goalId)) || (isMove(t) && !t.useFor && !t.setAside))), (t) => t.amount);
    const loans = sum((state.debts || []).filter((d) => d.balance > 0), (d) => Number(d.balance) || 0);
    // Card spending this cycle already came off the money; what was owed before the card was added did not.
    // EMIs on a card bill are counted once, with the loans. Payments go to the EMI on that bill first, as its bill to pay does.
    const cards = sum(state.cards || [], (c) => {
      const emiSetup = Math.min(Number(c.setupStatement) || 0, sum(cardEmis(state, c), (d) => Number(d.minPayment)));
      return Math.max(0, setupOwed(c) - emiSetup - Math.max(0, cardBillPaid(state, c, addDays(todayIso, 1)) - emiSetup));
    });
    // Friends and family: what you owe them, and what they owe you.
    const people = iouSummary(state, todayIso);
    // Loan money received (Pay Later, a bank loan) that isn't in Debts yet: owed all the same.
    const newLoans = sum(state.transactions.filter((t) => isIncome(t) && t.borrowed && !t.debtId && t.date <= todayIso), (t) => t.amount);
    const vault = rv.vault;
    const reimbOwed = rv.pendingFloat;
    return { money, funds, loans, cards, owedPeople: people.oweTotal, lentPeople: people.lentTotal, newLoans, vault, reimbOwed,
      owe: loans + cards + people.oweTotal + newLoans, own: money + funds + people.lentTotal + vault + reimbOwed,
      value: Math.round(money + funds + people.lentTotal + vault + reimbOwed - loans - cards - people.oweTotal - newLoans) };
  }

  // ---------- weekly plan: fraud checks, readiness, goals ----------

  // Monday of the week containing iso.
  /*
   * The last n full weeks (Monday to Sunday, oldest first), week by week:
   * spending, days within the limit, saved, extra to loans, borrowed, each
   * category, and that week's goal from the weekly plan. Then what the app
   * reads from them: categories up or down three weeks in a row, the goal
   * streak, and how hard this week's goal should be (easier after two
   * misses, a little harder after two wins). A week with almost nothing
   * recorded is marked, so a quiet week isn't read as a cheap one.
   */
  function weekTrend(state, todayIso, n) {
    n = n || 4;
    const goals = {};
    (state.goalHistory || []).concat(state.weeklyPlan ? [state.weeklyPlan.lastGoal, state.weeklyPlan.goal] : [])
      .forEach((g) => { if (g && g.week) goals[g.week] = g; });
    const thisWeek = weekStart(todayIso);
    const weeks = [];
    for (let k = n; k >= 1; k--) {
      const from = addDays(thisWeek, -7 * k);
      const to = addDays(from, 6);
      const txs = state.transactions.filter((t) => t.date >= from && t.date <= to);
      const flex = txs.filter((t) => isFlexible(t) && !t.gap);
      const tally = dayTally(state, from, to);
      const g = goals[from];
      const res = g ? goalResult(state, g) : null;
      weeks.push({
        from, to,
        spent: Math.round(sum(flex, ownPart)),
        byCategory: byCategory(flex.map((t) => Object.assign({}, t, { amount: ownPart(t) }))),
        won: tally.won, over: tally.over, logged: tally.logged, quiet: tally.logged < 2,
        saved: Math.round(sum(txs.filter((t) => isMove(t) && !t.setAside && t.useFor !== 'debt'), (t) => t.amount)),
        debtPaid: Math.round(extraToLoans(state, from, to)),
        borrowed: Math.round(borrowedIn(state, from, to)),
        goal: g ? { text: g.text, type: g.type, amount: g.amount, met: res ? res.met : null, value: res ? res.value : null } : null,
      });
    }
    // Three recorded weeks in a row going one way, ending last week.
    const last3 = weeks.slice(-3);
    const run = (dir) => {
      if (last3.length < 3 || last3.some((w) => w.quiet)) return [];
      const cats = Object.keys(last3[2].byCategory).concat(Object.keys(last3[0].byCategory)).filter((c, i, a) => a.indexOf(c) === i);
      return cats.map((c) => ({ name: c, values: last3.map((w) => Math.round(w.byCategory[c] || 0)) }))
        .filter((x) => (dir > 0 ? x.values[0] < x.values[1] && x.values[1] < x.values[2] && x.values[2] >= 300
          : x.values[0] > x.values[1] && x.values[1] > x.values[2] && x.values[0] >= 300))
        .sort((a, b) => Math.abs(b.values[2] - b.values[0]) - Math.abs(a.values[2] - a.values[0])).slice(0, 3);
    };
    // The goal streak, newest first: weeks with a goal, until one without.
    let streak = 0;
    let kind = null;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const g = weeks[i].goal;
      if (!g || g.met === null) break;
      if (kind === null) kind = g.met ? 'met' : 'missed';
      if ((g.met ? 'met' : 'missed') !== kind) break;
      streak++;
    }
    const difficulty = kind === 'missed' && streak >= 2 ? 'easier' : kind === 'met' && streak >= 2 ? 'harder' : 'same';
    return { weeks, rising: run(1), falling: run(-1), streak: { kind, count: streak }, difficulty };
  }

  function weekStart(iso) {
    return addDays(iso, -((parseISO(iso).getDay() + 6) % 7));
  }

  /*
   * Payments worth a second look, worked out on the phone (payee names never
   * leave it). Over the last `days` days:
   * - tiny: debits of ₹10 or less, how fraudsters test that a card or UPI works
   * - duplicate: the same amount to the same payee twice on one day (₹200+)
   * - large_new: a big payment to a payee not paid in the 90 days before
   *   (₹5,000+ and at least 3× the usual payment)
   * - many_new: three or more first-time payees on one day
   * Card bills, loan EMIs and moves to savings are never flagged.
   */
  function fraudSignals(state, todayIso, days) {
    const from = addDays(todayIso, -((days || 14) - 1));
    const debits = state.transactions.filter((t) => isFlexible(t) && !t.gap && t.date <= todayIso);
    // Payments the person already confirmed as theirs aren't flagged again.
    const ok = new Set(state.fraudOk || []);
    const recent = debits.filter((t) => t.date >= from && !ok.has(t.id));
    const payee = (t) => normalizeMerchant(t.note || '') || '';
    const amounts = debits.filter((t) => t.date >= addDays(todayIso, -90)).map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;
    const seenBefore = (t) => debits.some((x) => x !== t && payee(x) === payee(t) && x.date < t.date && x.date >= addDays(t.date, -90));
    const out = [];
    const add = (kind, list) => { if (list.length) out.push({ kind, count: list.length, total: Math.round(sum(list, (t) => t.amount)), ids: list.map((t) => t.id) }); };
    add('tiny', recent.filter((t) => t.amount <= 10 && t.category !== 'Cash'));
    const dup = [];
    recent.forEach((t) => {
      if (t.amount < 200 || !payee(t) || t.splitOf) return;
      const twins = recent.filter((x) => x !== t && x.date === t.date && x.amount === t.amount && payee(x) === payee(t) && !x.splitOf);
      if (twins.length && dup.indexOf(t) === -1) dup.push(t);
    });
    add('duplicate', dup);
    add('large_new', recent.filter((t) => payee(t) && t.amount >= Math.max(5000, median * 3) && !seenBefore(t)));
    const byDay = {};
    recent.filter((t) => payee(t) && !seenBefore(t)).forEach((t) => { (byDay[t.date] = byDay[t.date] || []).push(t); });
    add('many_new', [].concat(...Object.keys(byDay).filter((d) => new Set(byDay[d].map(payee)).size >= 3).map((d) => byDay[d])));
    return out;
  }

  /*
   * Ready to learn about investing? Only with an emergency fund that covers a
   * month of basics and no loan at 12% a year or more: before that, paying the
   * loan or building the fund is the better use of the money.
   */
  function investReady(state, todayIso) {
    const f = freedomDays(state, todayIso);
    const costly = (state.debts || []).filter((d) => d.balance > 0 && (Number(d.rate) || 0) >= 12).sort((a, b) => b.rate - a.rate);
    if (costly.length) return { ready: false, reason: 'A loan costs ' + costly[0].rate + '% a year: clearing it is a sure return no investment beats.' };
    if (!f || f.days < 30) return { ready: false, reason: 'The emergency fund covers ' + (f ? f.days : 0) + ' days of basics; build it to at least 30 days first.' };
    return { ready: true, reason: 'Emergency fund covers ' + f.days + ' days and no loan costs 12% or more.' };
  }

  /*
   * Whether a week's goal was met: spend_cap (flexible spending at or under
   * the amount), save (moved to savings), extra_loan (extra paid to loans),
   * no_card (no credit card spending). The week runs Monday to Sunday.
   */
  function goalResult(state, goal) {
    if (!goal || !goal.week) return null;
    const from = goal.week;
    const to = addDays(goal.week, 6);
    const txs = state.transactions.filter((t) => t.date >= from && t.date <= to);
    const amount = Number(goal.amount) || 0;
    let value;
    if (goal.type === 'spend_cap') value = sum(txs.filter((t) => isFlexible(t) && !t.gap), personalAmt);
    else if (goal.type === 'save') value = sum(txs.filter((t) => isMove(t) && !t.setAside && t.useFor !== 'debt'), (t) => t.amount);
    else if (goal.type === 'extra_loan') value = extraToLoans(state, from, to);
    else if (goal.type === 'no_card') value = sum(txs.filter((t) => isFlexible(t) && t.paidFrom && t.paidFrom !== 'account'), (t) => t.amount);
    else return null;
    value = Math.round(value);
    const met = goal.type === 'spend_cap' ? value <= amount : goal.type === 'no_card' ? value === 0 : value >= amount;
    return { met, value };
  }

  /*
   * Everything the weekly plan is made from: the facts below, plus this week
   * against the usual week, little leaks, last week's goal, fraud signals
   * (counts and amounts only), loan options worked out here, and whether
   * the person is ready to learn about investing.
   */
  function planFacts(state, todayIso, lastGoal) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const R = (n) => (n < 0 ? '-' : '') + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
    const D = (iso) => { const d = parseISO(iso); return d.getDate() + ' ' + MON[d.getMonth()]; };
    const L = [aiFacts(state, todayIso), '', 'THIS WEEK'];
    const flex = state.transactions.filter((t) => isFlexible(t) && !t.gap);
    const from = addDays(todayIso, -6);
    const week = byCategory(flex.filter((t) => t.date >= from && t.date <= todayIso));
    const before = byCategory(flex.filter((t) => t.date >= addDays(from, -28) && t.date < from));
    const cats = Object.keys(Object.assign({}, week, before));
    if (cats.length) {
      L.push('Spending, last 7 days against the usual week (average of the 4 weeks before): ' + cats
        .map((c) => ({ c, now: week[c] || 0, usual: (before[c] || 0) / 4 }))
        .sort((a, b) => b.now - a.now).slice(0, 8)
        .map((x) => x.c + ' ' + R(x.now) + ' (usual ' + R(x.usual) + ')').join('; ') + '.');
    }
    const small = flex.filter((t) => t.date >= from && t.amount < 200);
    if (small.length) L.push('Small payments under ₹200 this week: ' + small.length + ', together ' + R(sum(small, (t) => t.amount)) + '.');
    const leaks = leakSummary(state, todayIso);
    if (leaks.leaks.length) L.push('Little leaks the person tagged: ' + leaks.leaks.map((x) => x.name + ' about ' + R(x.perMonth) + ' a month').join('; ') + '.');
    const rec = weekRecap(state, todayIso);
    L.push('Last 7 days: ' + rec.tally.won + ' days within the limit, ' + rec.tally.over + ' over; saved ' + R(rec.saved) + '; extra to loans ' + R(rec.debtPaid) + '; borrowed ' + R(rec.borrowed) + '.');
    if (lastGoal) {
      const res = goalResult(state, lastGoal);
      if (res) L.push("Last week's goal: " + (lastGoal.text || lastGoal.type) + ' (' + lastGoal.type + ' ' + R(lastGoal.amount) + '): ' + (res.met ? 'met' : 'not met') + ', actual ' + R(res.value) + '.');
    }
    const rv = monthlyReview(state, todayIso);
    const M = (iso) => { const d = parseISO(iso); return MON[d.getMonth()] + ' ' + d.getFullYear(); };
    const STEP = { basics: 'cover basics and every minimum, borrow nothing new', buffer: 'a starter safety fund (one month of basics)',
      debt: 'clear loans costing ' + COSTLY_RATE + '% a year or more, costliest first', fund: 'the full emergency fund (' + ((rv.fund && rv.fund.target) || 3) + ' months of basics)',
      goals: 'savings goals', invest: 'learn about investing' };
    const ms = rv.ladder.milestone;
    L.push('', 'LONG TERM (the app works these out; the step is decided by the app)');
    L.push('Money ladder, in order: 1 basics and minimums, 2 starter fund, 3 costly loans, 4 full emergency fund, 5 goals, 6 investing. Now on step ' +
      rv.ladder.steps.find((x) => x.current).n + ': ' + STEP[rv.ladder.key] + '. ' + ({
      basics: 'Next: ' + (ms.short ? 'the salary is short of basics and minimums by ' + R(ms.short) + ' a month' : 'a month with nothing new borrowed') + '.',
      buffer: 'Next milestone: ' + R(ms.amount) + ' more in the emergency fund reaches ' + ms.target + ' days of basics (now ' + ms.days + ').',
      debt: 'Next milestone: clear ' + ms.name + ' (' + ms.rate + '% a year, ' + R(ms.balance) + ' left)' + (ms.count > 1 ? ', then the other ' + (ms.count - 1) : '') + '.',
      fund: 'Next milestone: ' + R(ms.amount) + ' more reaches ' + ms.months + ' months of basics.',
      goals: 'Next milestone: ' + ms.name + ', ' + R(ms.left) + ' to go' + (ms.by ? ' by ' + M(ms.by) : '') + (ms.late ? ' (date passed)' : '') + '.',
      invest: 'Ready to learn about investing.',
    }[rv.ladder.key]));
    if (rv.debtFree) L.push('Debt-free with the plan: ' + (rv.debtFree.plan ? M(rv.debtFree.plan) : 'never at these payments') + '; with minimums only: ' + (rv.debtFree.minimums ? M(rv.debtFree.minimums) : 'never') +
      (rv.debtFree.moved ? '; ' + Math.abs(rv.debtFree.moved) + ' month' + (Math.abs(rv.debtFree.moved) > 1 ? 's' : '') + (rv.debtFree.moved < 0 ? ' sooner' : ' later') + ' than last payday' : '') + '.');
    if (rv.worth.length > 1) L.push('Net worth by round: ' + rv.worth.map((w) => M(w.cycle) + ' ' + R(w.value)).join(' → ') + ' (' + (rv.worthChange >= 0 ? 'up ' : 'down ') + R(Math.abs(rv.worthChange)) + ').');
    if (rv.fund) L.push('Emergency fund: ' + R(rv.fund.amount) + ' = ' + rv.fund.months + ' months of basics; target ' + rv.fund.target + ' months.');
    if (rv.savedRate.length) L.push('Saved each round (to funds, investing and loans, beyond EMIs): ' + rv.savedRate.map((m) => M(m.start) + ' ' + m.pct + '% of pay (' + R(m.saved) + ')').join('; ') + '.');
    if (rv.goals.length) L.push('Goals: ' + rv.goals.map((g) => g.name + ' ' + R(g.saved) + ' of ' + R(g.target) + (g.by ? ' by ' + M(g.by) : '') + (g.done ? ' (reached)' : g.late ? ' (date passed)' : '')).join('; ') + '.');
    // The health check and the what-ifs: what the diagnosis is built on, never recalculated by the AI.
    const hc = healthCheck(state, todayIso);
    const ST = { good: 'good', watch: 'needs watching', bad: 'needs action', unknown: 'not enough recorded to judge' };
    L.push('', 'HEALTH CHECK (worked out by the app; agree with these, never contradict them)');
    hc.areas.forEach((a) => {
      const line = {
        cash: () => 'Cash flow: ' + ST[a.status] + '. Fixed payments, EMIs and bills take ' + R(a.committed) + (a.pct !== null ? ' = ' + a.pct + '% of pay' : '') + '; zone ' + a.zone + '.',
        debt: () => 'Debt: ' + ST[a.status] + '. EMIs and minimums ' + R(a.emis) + (a.pct !== null ? ' = ' + a.pct + '% of pay (banks see over 50% as too much, over 30% as heavy)' : '') +
          (a.costliest ? '; costliest: ' + a.costliest.name + ' at ' + a.costliest.rate + '% a year' : '; no loans') + '.',
        fund: () => 'Safety fund: ' + ST[a.status] + '. ' + R(a.amount) + ' = ' + a.days + ' days of basics (30 is a month safe, 90 three months).',
        spend: () => 'Spending last round: ' + ST[a.status] + (a.status === 'unknown' ? ' (under half its days have entries).' : '. ' + R(a.spent) + ' of a ' + R(a.budget) + ' flexible budget; borrowed ' + R(a.borrowed) + '.'),
        save: () => 'Saving last round: ' + ST[a.status] + (a.status === 'unknown' ? '.' : '. ' + R(a.saved) + ' = ' + a.pct + '% of pay (20% is the usual healthy mark).'),
      }[a.area];
      L.push(line());
    });
    const wi = whatIf(state, todayIso);
    L.push('', 'WHAT IF (worked out by the app; quote these, never make up other projections)');
    const WHERE = { basics: 'into the emergency fund', buffer: 'into the emergency fund', fund: 'into the emergency fund', debt: 'extra on the costliest loans' };
    if (WHERE[wi.step]) L.push('The plan: ' + R(wi.per) + ' a month (5% of pay) ' + WHERE[wi.step] + '. What reached the fund last round: ' + R(wi.pace) + '.');
    if (wi.fund) L.push('Fund target ' + wi.fund.target + ' days of basics, ' + R(wi.fund.need) + ' to go. With the plan: reached in ' + wi.fund.months.plan + ' month' + (wi.fund.months.plan > 1 ? 's' : '') +
      ', and in 3 months the fund covers ' + wi.fund.daysIn3.plan + ' days. If nothing changes: ' + (wi.fund.months.now ? 'reached in ' + wi.fund.months.now + ' months' : 'not reached at this pace') +
      ', and in 3 months it covers ' + wi.fund.daysIn3.now + ' days.');
    if (wi.debt) L.push(wi.debt.extra ? 'With ' + R(wi.debt.extra) + ' extra a month on loans: debt-free ' + (wi.debt.free.plan ? M(wi.debt.free.plan) : 'never') + ', interest still to pay ' + R(wi.debt.interest.plan) +
      '. If nothing changes: ' + (wi.debt.free.now ? M(wi.debt.free.now) : 'never') + ', interest ' + R(wi.debt.interest.now) + '.'
      : 'Loans at this step: debt-free ' + (wi.debt.free.now ? M(wi.debt.free.now) : 'never') + ' as planned, interest still to pay ' + R(wi.debt.interest.now) + ' (extra goes to the fund first).');
    if (wi.ending && wi.ending.length) L.push('EMIs ending within a year, whose money is then free: ' + wi.ending.map((e) => e.name + ' ' + R(e.emi) + ' a month, last in ' + M(e.last)).join('; ') + '.');
    // Official figures, searched once a month on government sites only (nothing about the person is sent for them).
    const RATE_NAMES = { repo_rate: 'RBI repo rate', cpi_inflation: 'Retail inflation (CPI, year on year)', ppf: 'PPF', ssy: 'Sukanya Samriddhi', scss: "Senior Citizens' Savings Scheme", nsc: 'NSC', po_savings: 'Post office savings account' };
    const rates = state.rates && (state.rates.figures || []).filter((x) => RATE_NAMES[x.key]);
    if (rates && rates.length) {
      L.push('', 'OFFICIAL FIGURES (found on government sites on ' + D(state.rates.fetched) + '; quote them with their period and source; for any other rate or tax figure, say to check the official site)');
      rates.forEach((x) => { let site = ''; try { site = new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) { site = ''; } L.push(RATE_NAMES[x.key] + ': ' + x.value + '% (' + x.period + '; ' + site + ').'); });
    }
    const prevChecks = (state.reviewChecks || {});
    if (prevChecks.round && prevChecks.round < rv.round && (prevChecks.checks || []).length) L.push("Last month's checks to follow up: " + prevChecks.checks.join('; ') + '.');
    const monthly = !state.reviewDone || state.reviewDone < rv.round;
    L.push('Monthly review this time: ' + (monthly ? 'yes (write the diagnosis and the advisor section)' : 'no (diagnosis null)') + '.');
    const tr4 = weekTrend(state, todayIso, 4);
    if (tr4.weeks.some((w) => !w.quiet)) {
      L.push('', 'LAST 4 WEEKS (Monday to Sunday, oldest first)');
      tr4.weeks.forEach((w) => {
        if (w.quiet) { L.push('Week of ' + D(w.from) + ': hardly anything recorded, so not a guide.'); return; }
        L.push('Week of ' + D(w.from) + ': spent ' + R(w.spent) + '; ' + (w.won + w.over ? w.won + ' of ' + (w.won + w.over) + ' days within the limit' : 'daily limit not tracked') +
          (w.over ? ', ' + w.over + ' over' : '') + '; saved ' + R(w.saved) + '; extra to loans ' + R(w.debtPaid) + '; borrowed ' + R(w.borrowed) +
          (w.goal ? "; that week's goal: " + (w.goal.text || w.goal.type) + ' (' + (w.goal.met ? 'met' : 'not met') + ', actual ' + R(w.goal.value || 0) + ')' : '') + '.');
      });
      if (tr4.rising.length) L.push('Up three weeks in a row: ' + tr4.rising.map((x) => x.name + ' ' + x.values.map(R).join(' → ')).join('; ') + '.');
      if (tr4.falling.length) L.push('Down three weeks in a row: ' + tr4.falling.map((x) => x.name + ' ' + x.values.map(R).join(' → ')).join('; ') + '.');
      if (tr4.streak.count) L.push('Weekly goals: ' + tr4.streak.kind + ' ' + tr4.streak.count + ' week' + (tr4.streak.count > 1 ? 's' : '') + ' in a row.');
      L.push("This week's goal should be " + {
        easier: 'easier: the last goals were missed, so set it close to what they actually managed last week. A goal they reach beats a perfect one they don\'t.',
        harder: 'a little harder (about 10% more) than last week\'s: the last goals were met.',
        same: 'about as hard as last week\'s.',
      }[tr4.difficulty]);
    }
    const debts = (state.debts || []).filter((d) => d.balance > 0);
    if (debts.length) {
      const base = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso).debtExtra;
      const how = payoffOrder(state);
      const now = simulateDebts(debts, base, how, true);
      const opts = [1000, 2000, 5000].map((x) => {
        const r = simulateDebts(debts, base + x, how, true);
        if (r.neverPaysOff || now.neverPaysOff) return null;
        return R(x) + ' more a month: debt-free ' + (now.months - r.months) + ' months sooner, about ' + R(now.totalInterest - r.totalInterest) + ' less interest';
      }).filter(Boolean);
      const first = debts.slice().sort((a, b) => (how === 'snowball' ? a.balance - b.balance : b.rate - a.rate))[0];
      L.push('Loan to put any extra on first: ' + first.name + ' (' + (how === 'snowball' ? 'smallest balance' : 'highest interest') + ').');
      if (opts.length) L.push('Loan options worked out by the app: ' + opts.join('; ') + '.');
    }
    const fr = fraudSignals(state, todayIso, 14);
    const FR = { tiny: 'tiny debits of ₹10 or less (fraudsters test cards and UPI this way)', duplicate: 'the same amount to the same payee twice on one day', large_new: 'a big payment to a payee not paid before', many_new: 'three or more first-time payees on one day' };
    L.push(fr.length ? 'Payments to double-check, last 14 days: ' + fr.map((x) => x.count + ' × ' + FR[x.kind] + ', together ' + R(x.total)).join('; ') + '. The app shows the person which ones.' : 'Payments to double-check, last 14 days: none found.');
    const inv = investReady(state, todayIso);
    L.push('Ready to learn about investing: ' + (inv.ready ? 'yes. ' : 'no. ') + inv.reason);
    L.push('Plan for the week starting ' + D(weekStart(todayIso)) + '.');
    return L.join('\n');
  }

  /*
   * What "Ask AI" sends: the numbers the app has already worked out, as short
   * English lines (the AI answers in the app's language). Totals, categories
   * and the names the person typed for loans, cards, budgets and goals; never
   * SMS text, shop names, notes or account numbers.
   */
  function aiFacts(state, todayIso) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const R = (n) => (n < 0 ? '-' : '') + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
    const D = (iso) => { const d = parseISO(iso); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
    const r = projectRunway(state, todayIso);
    const z = zoneStatus(state, todayIso, r);
    const p = r.plan;
    const L = [];
    const daysLeft = r.remainingDays + 1;
    L.push('Today: ' + D(todayIso) + '. Next payday: ' + D(r.cycle.next) + ' (' + daysLeft + ' days including today).');
    if (p.salary) L.push('Salary: ' + R(p.salary) + ' a month.');
    // Earned and the rest kept apart: a loan or money back isn't income.
    const ins = incomeInRange(state.transactions, r.cycle).filter((t) => t.date <= todayIso);
    const earned = sum(ins.filter(isEarned), (t) => t.amount);
    const otherIn = sum(ins.filter((t) => !isEarned(t)), (t) => t.amount);
    if (earned || otherIn) L.push('Money in this round besides the salary: earned ' + R(earned) + '; other money in ' + R(otherIn) + ' (loans, friends, refunds, reimbursements, your own money: not income).');
    L.push('Money now, all accounts and wallets together: ' + R(r.balanceToday || 0) + '.');
    L.push("Today's limit: " + R(r.dailyAllowance) + '; spent today: ' + R(r.spentToday) + (r.savedToday ? '; saved today: ' + R(r.savedToday) : '') + '.');
    L.push('Zone: ' + { green: 'green (on track to payday)', amber: 'careful (at this pace money runs out before payday)', red: 'red (bills and basics until payday are not covered)' }[z.zone] +
      (z.shortBy ? '; short by ' + R(z.shortBy) : '') + '.');
    L.push('Spending pace: about ' + R(r.paceRate) + ' a day; at this pace payday comes with ' + R(r.endPace) + (r.zeroPace ? ' (runs out on ' + D(r.zeroPace) + ')' : '') + '.');
    L.push('Basics (groceries and health) cost about ' + R(z.essentialPerDay) + ' a day.');
    if (r.remainingDays > 0) L.push('Rule of thumb: every ' + R(1000) + ' spent extra today lowers each remaining day\'s limit by about ' + R(1000 / r.remainingDays) + '.');
    const ahead = r.events.filter((e) => e.date > todayIso);
    L.push(ahead.length ? 'Still to pay before payday: ' + ahead.map((e) => e.name + ' ' + R(e.amount) + ' on ' + D(e.date)).join('; ') + '.' : 'No more bills or EMIs before payday.');
    L.push('Plan each month: fixed payments ' + R(p.fixedTotal) + ', loan minimums ' + R(p.debtMin) + ', bills that vary ' + R(p.variableBills) + ', set aside ' + R(p.savingsTotal) + ', flexible budgets ' + R(p.flexTotal) + '.');
    const env = budgetEnvelopes(state, todayIso);
    if (env.list.length) {
      L.push('Budgets this round: ' + env.list.map((b) => b.name + ' ' + R(b.spent) + ' of ' + R(b.available) + (b.left < 0 ? ' (over by ' + R(-b.left) + ')' : '')).join('; ') + '.');
    }
    if (env.others.length) L.push('Spent with no budget this round: ' + env.others.map((o) => o.name + ' ' + R(o.spent)).join('; ') + '.');
    const trend = spendTrend(state, todayIso, 4).filter((m) => !m.current && m.recorded);
    if (trend.length) L.push('Past rounds: ' + trend.map((m) => D(m.start).slice(-8) + ': spent ' + R(m.spent) + ', saved ' + R(m.saved) + ', borrowed ' + R(m.borrowed)).join('; ') + '.');
    const debts = (state.debts || []).filter((d) => d.balance > 0);
    if (debts.length) {
      L.push('Loans: ' + debts.map((d) => d.name + ': ' + R(d.balance) + ' left at ' + (Number(d.rate) || 0) + '% a year, EMI or minimum ' + R(Number(d.minPayment) || 0)).join('; ') + '.');
      const dfd = debtFreeDates(state, todayIso);
      if (dfd) L.push('Debt-free: ' + (dfd.plan.never ? 'never at the current payments' : D(dfd.plan.date)) + ' with ' + R(dfd.extra) + ' a month extra' +
        (dfd.now.never ? '; never with minimums only' : '; ' + D(dfd.now.date) + ' with minimums only') + '. Payoff order chosen: ' + (payoffOrder(state) === 'snowball' ? 'smallest balance first' : 'highest interest first') + '.');
    } else L.push('Loans: none.');
    (state.cards || []).forEach((c) => {
      const st = cardStatus(state, c, todayIso);
      L.push('Credit card ' + c.name + ': owes ' + R(st.owed) + (st.due ? ', bill due ' + D(st.due) : '') + (st.remaining ? ', still to pay on that bill ' + R(st.remaining) : '') +
        ', interest about ' + cardRate(c) + '% a year if not paid in full.');
    });
    // Costs that may come, with how likely the person thinks they are, and how good their guesses have been.
    const maybe = maybeOpen(state).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8);
    if (maybe.length) {
      const LK = { likely: 'likely (money already held from today\'s limit if before payday)', maybe: 'maybe (not held)', unlikely: 'unlikely (not held)' };
      L.push('Costs that may come: ' + maybe.map((m) => m.name + ' ' + R(m.amount) + ' around ' + D(m.date) + ', ' + LK[m.likely]).join('; ') + '.');
      const w = maybeIfHappens(state, todayIso);
      if (w) L.push("If the 'maybe' costs before payday come (" + R(w.amount) + "), today's limit would be " + R(w.limit) + '.');
      const st = maybeStats(state);
      const past = MAYBE_LIKELY.filter((k) => st[k].answered >= 3).map((k) => k + ' ones came ' + st[k].happened + ' of ' + st[k].answered + ' times' +
        (st[k].guess ? ', costing ' + Math.round((st[k].actual / st[k].guess) * 100) + '% of the guess' : ''));
      if (past.length) L.push('How past guesses turned out: ' + past.join('; ') + '.');
    }
    const f = freedomDays(state, todayIso);
    L.push('Emergency fund: ' + R(Number((state.savings || {}).emergencyBalance) || 0) + (f ? ' = ' + f.days + ' days of basics covered' : '') + '.');
    (state.goals || []).forEach((g) => {
      const st = goalStatus(state, g, todayIso);
      L.push('Savings goal ' + g.name + ': ' + R(st.saved) + ' of ' + R(st.target) + (g.by ? ' by ' + D(g.by) : '') + (st.perPayday ? ', ' + R(st.perPayday) + ' a month' : '') + (st.late ? ' (date passed)' : '') + '.');
    });
    const n = netWorth(state, todayIso);
    L.push('Net worth: ' + R(n.value) + ' (own ' + R(n.own) + ', owe ' + R(n.owe) + ').');
    return L.join('\n');
  }

  function walletBalances(state, todayIso, total, morning) {
    const wallets = (state.wallets || []).map((w) => {
      const from = w.check ? w.check.date : w.created || '0000-00-00';
      let bal = w.check ? Number(w.check.amount) || 0 : 0;
      state.transactions.forEach((t) => {
        if (t.date < from || t.date > todayIso || (morning && t.date >= todayIso)) return;
        if (isTransfer(t)) {
          if (t.to === w.id) bal += t.amount;
          if (t.from === w.id) bal -= t.amount;
          return;
        }
        if (t.wallet !== w.id) return;
        if (isPassedOn(t)) { bal += isIncome(t) ? t.amount : -t.amount; return; }
        if (isIncome(t)) bal += t.useFor === 'keep' ? t.amount : incomeKept(t);
        else if (isFlexible(t) && !(t.paidFrom && t.paidFrom !== 'account')) bal -= t.amount;
        else if (isMove(t) || isBillPayment(t) || isFixedPayment(t) || t.kind === 'cardpay') bal -= t.amount;
        else if (isCashAdvance(t)) bal += t.amount;
      });
      return { id: w.id, name: w.name, kind: w.kind, last4: w.last4 || '', balance: Math.round(bal) };
    });
    return { main: Math.round((Number(total) || 0) - sum(wallets, (w) => w.balance)), wallets };
  }

  // ---------- round result and weekly recap ----------

  // Spent and saved on a day: saved money can't be spent either. Emergencies don't count against the day.
  function daySpent(state, date) {
    return sum(state.transactions.filter((x) =>
      (isFlexible(x) && x.date === date && x.category !== 'Emergency' && !x.gap) || (isMove(x) && !x.setAside && (x.forDate || x.date) === date)), ownPart);
  }

  // Spending alone on a day: whether the day was won. Moving money to savings or a loan never makes a day "over".
  function daySpending(state, date) {
    // A gap found at a balance check isn't one day's spending.
    return sum(state.transactions.filter((x) => isFlexible(x) && x.date === date && x.category !== 'Emergency' && !x.gap), ownPart);
  }

  // Days in [from, to]: won (within that day's limit), over, or not tracked (the app wasn't opened).
  function dayTally(state, from, to) {
    const days = state.days || {};
    const out = { won: 0, over: 0, none: 0, logged: 0, total: 0 };
    const logged = new Set(state.transactions.map((t) => t.date));
    for (let d = from; d <= to; d = addDays(d, 1)) {
      out.total++;
      if (logged.has(d)) out.logged++;
      const rec = days[d];
      if (!rec) out.none++;
      else if (daySpending(state, d) <= rec.allowance) out.won++;
      else out.over++;
    }
    return out;
  }

  function borrowedIn(state, from, to) {
    const txs = state.transactions.filter((t) => t.date >= from && t.date <= to);
    return sum(txs.filter((t) => (isFlexible(t) && t.paidFrom && t.paidFrom !== 'account') || (isIncome(t) && t.borrowed)), (t) => t.amount);
  }

  // Paid toward loans beyond the EMIs: leftovers and money received sent to a loan.
  function extraToLoans(state, from, to) {
    return sum(state.transactions.filter((t) => t.date >= from && t.date <= to && t.useFor === 'debt' && t.debtId), (t) => Number(t.debtPaid) || t.amount);
  }

  // What the loans add up to, and Days of Freedom: kept at the start of each round to compare at the end.
  function roundSnapshot(state, todayIso) {
    const f = freedomDays(state, todayIso);
    const dfd = debtFreeDates(state, todayIso);
    return { date: todayIso, freedom: f ? f.days : 0, debt: Math.round(sum(state.debts, (d) => Math.max(0, Number(d.balance) || 0))),
      free: dfd && !dfd.plan.never ? dfd.plan.date : null };
  }

  /*
   * The priority ladder: the order money goes in, as banks and financial
   * planners teach it. The app decides the step from the numbers; advice is
   * only about that step, so it never suggests investing while a 40% card
   * is open.
   *   1 basics  cover basics and every minimum, nothing new borrowed
   *   2 buffer  a starter fund: one month of basics
   *   3 debt    clear loans costing 12% a year or more, costliest first
   *             (paying them off is a sure return no investment beats)
   *   4 fund    the full emergency fund (the months chosen, 3 by default)
   *   5 goals   savings goals
   *   6 invest  learn about investing
   */
  const COSTLY_RATE = 12;
  function priorityLadder(state, todayIso) {
    const plan = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const f = freedomDays(state, todayIso);
    const days = f ? f.days : 0;
    const daily = f ? f.daily : 0;
    const months = Number(state.savings.emergencyTargetMonths) || 3;
    const debts = (state.debts || []).filter((d) => Number(d.balance) > 0);
    const costly = debts.filter((d) => (Number(d.rate) || 0) >= COSTLY_RATE).sort((a, b) => b.rate - a.rate || a.balance - b.balance);
    const j = debtJourney(state, todayIso);
    const short = Math.max(0, Math.round((f ? f.needs : plan.fixedTotal + plan.debtMin) - (Number(plan.salary) || 0)));
    const last = lastBorrowed(state, todayIso);
    const borrowedLately = !!last && daysBetween(last, todayIso) <= 30;
    const goals = (state.goals || []).filter((g) => !goalStatus(state, g, todayIso).done);
    const done = {
      basics: !(j ? j.stage === 'survive' : short > 0 || borrowedLately),
      buffer: days >= 30,
      debt: !costly.length,
      fund: days >= months * 30,
      goals: !goals.length,
    };
    const order = ['basics', 'buffer', 'debt', 'fund', 'goals', 'invest'];
    const key = order.find((k) => k === 'invest' || !done[k]);
    const steps = order.map((k, i) => ({ n: i + 1, key: k, done: k !== 'invest' && done[k] && order.indexOf(key) > i, current: k === key }));
    // What finishing this step takes, in rupees.
    let milestone = null;
    if (key === 'basics') milestone = { kind: 'basics', short, borrowedLately };
    // The nearest milestone first: 7 days of basics, then 30.
    else if (key === 'buffer') milestone = { kind: 'buffer', amount: f && f.next ? f.next.amount : 0, target: f && f.next ? f.next.target : 30, days };
    else if (key === 'debt') {
      const d = costly[0];
      const sim = simulateDebts(debts, plan.debtExtra, payoffOrder(state), true);
      milestone = { kind: 'debt', name: d.name, rate: Number(d.rate), balance: Math.round(d.balance), count: costly.length,
        months: sim.neverPaysOff ? null : sim.months };
    } else if (key === 'fund') milestone = { kind: 'fund', amount: Math.max(0, Math.ceil(months * 30 * daily - (f ? f.fund : 0))), months, days };
    else if (key === 'goals') {
      const g = goals.slice().sort((a, b) => (a.by || '9') < (b.by || '9') ? -1 : 1)[0];
      const st = goalStatus(state, g, todayIso);
      milestone = { kind: 'goals', name: g.name, left: st.left, by: g.by || null, late: st.late };
    } else milestone = { kind: 'invest' };
    return { key, steps, milestone };
  }

  /*
   * The health check behind the monthly diagnosis: five areas, each with the
   * number that decides it and a status (good, watch, bad, or unknown when
   * too little is recorded). The lines are the usual bank and planner ones:
   * - Cash flow: fixed payments, EMIs and bills as a share of pay (over 90%
   *   leaves no room; red zone is bad whatever the share).
   * - Debt: EMIs as a share of pay, as banks measure it (over 50% is what
   *   lenders refuse; over 30% is heavy) and the costliest rate.
   * - Safety fund: days of basics (30 a month safe, 90 three months).
   * - Spending, last round: within the flexible budgets, nothing borrowed.
   * - Saving, last round: share of pay saved (20% is the usual healthy mark).
   */
  function healthCheck(state, todayIso) {
    const plan = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const salary = Number(plan.salary) || 0;
    const r = projectRunway(state, todayIso);
    const zone = zoneStatus(state, todayIso, r).zone;
    const committed = plan.fixedTotal + plan.debtMin + plan.variableBills;
    const pct = (n) => (salary > 0 ? Math.round((n / salary) * 100) : null);
    const debts = (state.debts || []).filter((d) => Number(d.balance) > 0);
    const costliest = debts.slice().sort((a, b) => b.rate - a.rate)[0] || null;
    const f = freedomDays(state, todayIso);
    const days = f ? f.days : 0;
    const res = roundResult(state, todayIso);
    const flex = res.rows.find((x) => x.key === 'flex');
    // Too little recorded last round (under half its days) says nothing about spending.
    const recordedLast = res.tally && res.tally.total > 0 && res.tally.logged >= res.tally.total / 2;
    const saved = spendTrend(state, todayIso, 2).filter((m) => !m.current && m.recorded && m.salary > 0)[0];
    const cash = { area: 'cash', committed: Math.round(committed), pct: pct(committed), zone,
      status: zone === 'red' || pct(committed) > 90 ? 'bad' : pct(committed) > 70 || zone === 'amber' ? 'watch' : 'good' };
    const emiPct = pct(plan.debtMin);
    const debt = { area: 'debt', emis: Math.round(plan.debtMin), pct: emiPct, costliest: costliest ? { name: costliest.name, rate: Number(costliest.rate) } : null,
      status: !debts.length ? 'good' : emiPct > 50 ? 'bad' : emiPct > 30 || (costliest && costliest.rate >= 24) ? 'watch' : 'good' };
    const fund = { area: 'fund', days, amount: f ? f.fund : 0, status: days >= 90 ? 'good' : days >= 30 ? 'watch' : 'bad' };
    const spend = { area: 'spend', spent: flex ? flex.actual : 0, budget: flex ? flex.planned : 0, borrowed: Math.round(res.borrowed || 0),
      status: !recordedLast ? 'unknown' : res.borrowed > 0 || (flex && flex.actual > flex.planned * 1.1) ? 'bad' : flex && flex.actual > flex.planned ? 'watch' : 'good' };
    const save = saved ? { area: 'save', saved: Math.round(saved.saved), pct: Math.round((saved.saved / saved.salary) * 100) } : { area: 'save', saved: 0, pct: null };
    save.status = save.pct === null || !recordedLast ? 'unknown' : save.pct >= 20 ? 'good' : save.pct >= 10 ? 'watch' : 'bad';
    return { salary, areas: [cash, debt, fund, spend, save] };
  }

  /*
   * If nothing changes, and with the plan: the numbers the diagnosis may
   * quote, worked out here so the AI never makes up a projection. The plan
   * puts a set amount a month (5% of pay, at least ₹1,000, in ₹500s) on the
   * ladder's step: into the fund for steps 1, 2 and 4, on the costliest loans
   * for step 3. Also EMIs ending within a year, whose money is then free.
   */
  function whatIf(state, todayIso) {
    const L = priorityLadder(state, todayIso);
    const plan = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const salary = Number(plan.salary) || 0;
    const per = Math.max(1000, Math.round((salary * 0.05) / 500) * 500);
    const f = freedomDays(state, todayIso);
    const payday = Number(state.settings.payday) || 1;
    const last = previousCycle(cycleFor(todayIso, payday), payday);
    // What reached the fund last round: the pace if nothing changes.
    const pace = Math.round(sum(state.transactions.filter((t) => inCycle(t.date, last) && ((isMove(t) && t.useFor === 'emergency') || (isIncome(t) && t.useFor === 'emergency'))), (t) => t.amount));
    const out = { step: L.key, per, pace };
    if (f && ['basics', 'buffer', 'fund'].indexOf(L.key) !== -1) {
      const target = L.key === 'fund' ? (Number(state.savings.emergencyTargetMonths) || 3) * 30 : L.key === 'buffer' ? L.milestone.target : 7;
      const need = Math.max(0, Math.ceil(target * f.daily - f.fund));
      out.fund = { target, need, daysIn3: { now: Math.floor((f.fund + 3 * pace) / f.daily), plan: Math.floor((f.fund + 3 * (pace + per)) / f.daily) },
        // Over five years away isn't a plan: "not at this pace".
        months: { now: pace > 0 && need / pace <= 60 ? Math.ceil(need / pace) : null, plan: Math.ceil(need / (pace + per)) } };
    }
    const debts = (state.debts || []).filter((d) => d.balance > 0);
    if (debts.length) {
      const how = payoffOrder(state);
      const base = plan.debtExtra;
      const now = simulateDebts(debts, base, how, true);
      const more = simulateDebts(debts, base + per, how, true);
      // Dated as debtFreeDates does, from the next EMI.
      const dfd = debtFreeDates(state, todayIso);
      const when = (sim) => (sim.neverPaysOff || !dfd.plan.date ? null : addMonths(dfd.plan.date, sim.months - now.months));
      out.debt = { extra: L.key === 'debt' ? per : 0, free: { now: when(now), plan: when(L.key === 'debt' ? more : now) },
        interest: { now: Math.round(now.totalInterest), plan: Math.round((L.key === 'debt' ? more : now).totalInterest) } };
      out.ending = debts.map((d) => ({ d, e: loanEnd(state, d, todayIso) })).filter((x) => x.e && !x.e.never && x.e.last <= addMonths(todayIso, 12))
        .map((x) => ({ name: x.d.name, emi: Number(x.d.minPayment) || 0, last: x.e.last })).sort((a, b) => (a.last < b.last ? -1 : 1));
    }
    return out;
  }

  /*
   * The monthly review, made on payday: where the long run is heading.
   * Debt-free date and how it moved since last payday, net worth over six
   * rounds, the emergency fund in months, how much of the salary was saved
   * each round, goals, and the step on the ladder.
   */
  function monthlyReview(state, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const cyc = cycleFor(todayIso, payday);
    const prev = previousCycle(cyc, payday);
    const rounds = state.rounds || {};
    const dfd = debtFreeDates(state, todayIso);
    const thenFree = rounds[prev.start] && rounds[prev.start].free;
    const nowFree = dfd && !dfd.plan.never ? dfd.plan.date : null;
    const moved = thenFree && nowFree ? (parseISO(nowFree).getFullYear() - parseISO(thenFree).getFullYear()) * 12 + parseISO(nowFree).getMonth() - parseISO(thenFree).getMonth() : null;
    const log = state.worthLog || {};
    const worth = Object.keys(log).sort().slice(-6).map((k) => ({ cycle: k, value: Math.round(Number(log[k]) || 0) }));
    const f = freedomDays(state, todayIso);
    const rate = spendTrend(state, todayIso, 4).filter((m) => !m.current && m.recorded && m.salary > 0)
      .map((m) => ({ start: m.start, saved: Math.round(m.saved), salary: m.salary, pct: Math.round((m.saved / m.salary) * 100) }));
    const goals = (state.goals || []).map((g) => { const st = goalStatus(state, g, todayIso); return { name: g.name, saved: st.saved, target: st.target, by: g.by || null, done: st.done, late: st.late, monthly: st.perPayday }; });
    return {
      round: cyc.start,
      debtFree: dfd ? { plan: dfd.plan.never ? null : dfd.plan.date, minimums: dfd.now.never ? null : dfd.now.date, extra: dfd.extra, moved } : null,
      debt: Math.round(sum(state.debts || [], (d) => Math.max(0, Number(d.balance) || 0))),
      worth, worthChange: worth.length > 1 ? worth[worth.length - 1].value - worth[0].value : null,
      fund: f ? { days: f.days, months: Math.round((f.days / 30) * 10) / 10, target: Number(state.savings.emergencyTargetMonths) || 3, amount: f.fund } : null,
      savedRate: rate, goals, ladder: priorityLadder(state, todayIso),
    };
  }

  /*
   * The round that ended at the last payday, as a result: reached payday
   * without borrowing (won) or not, days won and over, days logged (the bad
   * ones count too), planned against actual, and one goal for the next round.
   * With a snapshot from the round's start: Days of Freedom and debt, then and now.
   */
  function roundResult(state, todayIso) {
    const r = monthReport(state, todayIso);
    const c = r.cycle;
    const last = r.last;
    const plan = monthlyPlan(Object.assign({}, state, { adjustment: null }), c.start);
    const slip = (state.payslips || {})[c.start];
    const pay = { planned: slip ? Number(slip.usual) || 0 : Number(state.settings.salary) || 0, actual: slip ? Number(slip.amount) || 0 : Number(state.settings.salary) || 0 };
    const txs = state.transactions.filter((t) => inCycle(t.date, c));
    const flexSpent = sum(txs.filter((t) => isFlexible(t) && t.category !== 'Emergency'), personalAmt);
    const saved = sum(txs.filter((t) => isMove(t)), (t) => t.amount);
    const borrowed = borrowedIn(state, c.start, last);
    const rows = [
      { key: 'pay', planned: pay.planned, actual: pay.actual, good: pay.actual >= pay.planned },
      { key: 'flex', planned: plan.flexTotal, actual: Math.round(flexSpent), good: flexSpent <= plan.flexTotal },
      { key: 'saved', planned: plan.emergency + plan.invest + plan.debtExtra, actual: Math.round(saved), good: saved >= plan.emergency + plan.invest + plan.debtExtra },
      { key: 'borrowed', planned: 0, actual: Math.round(borrowed), good: borrowed === 0 },
    ];
    const tally = dayTally(state, c.start, last);
    const snap = (state.rounds || {})[c.start];
    const now = roundSnapshot(state, todayIso);
    const change = snap ? { since: snap.date, freedom: [snap.freedom, now.freedom], debt: [snap.debt, now.debt] } : null;
    let goal;
    if (borrowed > 0) goal = { kind: 'borrow' };
    else if (r.overspent) goal = { kind: 'budget', name: r.overspent.name, amount: r.overspent.budget };
    else if (r.swept.total === 0) goal = { kind: 'save' };
    else goal = { kind: 'again', won: tally.won };
    return Object.assign(r, { won: borrowed === 0, borrowed, rows, tally, change, goal });
  }

  /*
   * The week that ended yesterday, in small wins: days won, days logged,
   * saved, extra paid on loans (and how many days of loan payments that
   * is: that much closer to debt-free), and anything borrowed.
   */
  function weekRecap(state, todayIso) {
    const to = addDays(todayIso, -1);
    const from = addDays(todayIso, -7);
    const tally = dayTally(state, from, to);
    const txs = state.transactions.filter((t) => t.date >= from && t.date <= to);
    const toFund = sum(txs.filter((t) => isMove(t) && !t.setAside && t.useFor === 'emergency'), (t) => t.amount);
    // Saved: to the fund or savings. Money sent to a loan is counted on its own line.
    const saved = sum(txs.filter((t) => isMove(t) && !t.setAside && t.useFor !== 'debt'), (t) => t.amount);
    const debtPaid = extraToLoans(state, from, to);
    const plan = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const perDay = (plan.debtMin + plan.debtExtra) / 30;
    const f = freedomDays(state, todayIso);
    return {
      from, to, tally, saved: Math.round(saved), debtPaid: Math.round(debtPaid),
      daysCloser: perDay > 0 ? Math.floor(debtPaid / perDay) : 0,
      freedomGained: f && f.daily > 0 ? Math.floor(toFund / f.daily) : 0,
      borrowed: Math.round(borrowedIn(state, from, to)),
    };
  }

  // ---------- encrypted backup ----------

  /*
   * A backup file locked with the person's password: AES-256-GCM, with the key
   * made from the password by PBKDF2-SHA256 (210,000 rounds, random salt).
   * Without the password nobody can open it. Older plain backups (the app's
   * data as JSON) still restore without one.
   */
  const BACKUP_ROUNDS = 210000;

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function fromB64(text) {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function backupKey(password, salt, rounds) {
    const subtle = globalThis.crypto.subtle;
    return subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then((base) => subtle.deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }

  // Resolves to the backup file's text.
  function encryptBackup(state, password, todayIso) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    return backupKey(password, salt, BACKUP_ROUNDS)
      .then((key) => globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(state))))
      .then((data) => JSON.stringify({
        app: 'Hisab Se', kind: 'backup', v: 1, date: todayIso, entries: (state.transactions || []).length,
        kdf: 'PBKDF2-SHA256', rounds: BACKUP_ROUNDS, salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(data)),
      }));
  }

  // What a backup file is, before asking for its password: { locked, date, entries }, or null if it isn't one.
  function backupInfo(text) {
    let o;
    try { o = JSON.parse(String(text || '').trim()); } catch (e) { return null; }
    if (o && o.kind === 'backup' && o.data && o.salt && o.iv) return { locked: true, date: o.date || null, entries: Number(o.entries) || 0 };
    if (o && o.settings && Array.isArray(o.transactions)) return { locked: false, date: null, entries: o.transactions.length };
    return null;
  }

  /*
   * Restored data, made safe: amounts are whole rupees (a "700" typed into a
   * file becomes 700), dates are real days, and lists are lists. Anything that
   * can't be made right refuses the file (Error('format')) rather than
   * loading half of it.
   */
  function cleanState(s) {
    const okDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && toISO(parseISO(d)) === d;
    s.transactions = s.transactions.map((t) => {
      const amount = Math.round(Number(t && t.amount));
      if (!t || !Number.isFinite(amount) || amount < 0 || amount > 1e10 || !okDate(t.date)) throw new Error('format');
      return Object.assign({}, t, { amount });
    });
    ['fixed', 'debts', 'budgets', 'bills', 'sinking', 'goals', 'cards', 'wallets', 'iou', 'emergencies', 'accuracy', 'maybe', 'goalHistory'].forEach((k) => {
      if (k in s && !Array.isArray(s[k])) delete s[k];
    });
    if (!s.savings || typeof s.savings !== 'object') delete s.savings;
    if (s.reimb != null && (typeof s.reimb !== 'object' || !Array.isArray(s.reimb.claims || []) || !Array.isArray(s.reimb.payouts || []))) delete s.reimb;
    if (s.maybe) s.maybe = s.maybe.filter((m) => m && okDate(m.date) && Number(m.amount) > 0).map((m) => Object.assign({}, m, { amount: Math.round(Number(m.amount)) }));
    ['fixed', 'debts'].forEach((k) => (s[k] || []).forEach((x) => {
      ['amount', 'balance', 'minPayment', 'rate'].forEach((f) => { if (x[f] != null) x[f] = Number(x[f]) || 0; });
    }));
    return s;
  }

  // Resolves to the saved app data; rejects with Error('format') or Error('password').
  function openBackup(text, password) {
    let o;
    try { o = JSON.parse(String(text || '').trim()); } catch (e) { return Promise.reject(new Error('format')); }
    const check = (s) => { if (!s || !s.settings || !Array.isArray(s.transactions)) throw new Error('format'); return cleanState(s); };
    if (o && o.settings) return Promise.resolve().then(() => check(o));
    if (!o || o.kind !== 'backup') return Promise.reject(new Error('format'));
    return backupKey(password || '', fromB64(o.salt), Number(o.rounds) || BACKUP_ROUNDS)
      .then((key) => globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(o.iv) }, key, fromB64(o.data)))
      .then((plain) => check(JSON.parse(new TextDecoder().decode(plain))), (e) => { throw new Error(e && e.message === 'format' ? 'format' : 'password'); });
  }

  // ---------- spending, three ways ----------

  // Basics: what has to be paid whatever happens. Everything else is a choice.
  const BASICS = ['Groceries', 'Health', 'Bills', 'Emergency'];

  // Where: spending by category this cycle (to today), against budget, and basics vs the rest.
  /*
   * The rounds a report period covers, newest last: 'this' (this round so
   * far), 'last' (the round before), or a number of rounds back including
   * this one. `before` is the same length of time just before it, to compare.
   */
  function reportRange(state, todayIso, period) {
    const payday = Number(state.settings.payday) || 1;
    const cur = cycleFor(todayIso, payday);
    const n = period === 'this' || period === 'last' || !period ? 1 : Math.max(1, Number(period) || 1);
    let last = period === 'last' ? previousCycle(cur, payday) : cur;
    let first = last;
    for (let i = 1; i < n; i++) first = previousCycle(first, payday);
    const end = last === cur ? addDays(todayIso, 1) : last.next;
    let bFirst = previousCycle(first, payday);
    for (let i = 1; i < n; i++) bFirst = previousCycle(bFirst, payday);
    // This round so far is compared with the same number of days of the round before.
    const sameDays = last === cur && n === 1 ? addDays(bFirst.start, daysBetween(cur.start, todayIso) + 1) : first.start;
    return { from: first.start, to: end, rounds: n, current: last === cur, before: { from: bFirst.start, to: sameDays } };
  }

  /*
   * Where: flexible spending by category for a period (see reportRange),
   * against the budget for that many rounds, with the period before to
   * compare and the payments behind each category.
   */
  function spendWhere(state, todayIso, period) {
    const range = reportRange(state, todayIso, period || 'this');
    const cycle = cycleFor(todayIso, Number(state.settings.payday) || 1);
    const flex = state.transactions.filter(isFlexible);
    const txs = flex.filter((t) => t.date >= range.from && t.date < range.to && t.date <= todayIso);
    const spent = byCategory(txs);
    // Compare only with a stretch the records fully cover.
    const first = flex.reduce((m, t) => (t.date < m ? t.date : m), todayIso);
    const comparable = first <= range.before.from;
    const prev = comparable ? byCategory(flex.filter((t) => t.date >= range.before.from && t.date < range.before.to)) : {};
    const budgets = {};
    monthlyPlan(state, todayIso).budgets.forEach((b) => { budgets[b.name] = b.amount * range.rounds; });
    const categories = Object.keys(spent).map((name) => ({
      name, spent: spent[name], budget: budgets[name] || 0, before: prev[name] || 0,
      payments: txs.filter((t) => t.category === name).sort((a, b) => (a.date < b.date ? 1 : -1)),
    })).sort((a, b) => b.spent - a.spent);
    const basics = sum(categories.filter((c) => BASICS.indexOf(c.name) !== -1), (c) => c.spent);
    const total = sum(categories, (c) => c.spent);
    return { cycle, range, categories, total, basics, other: total - basics, comparable, before: comparable ? sum(Object.keys(prev), (k) => prev[k]) : null };
  }

  /*
   * What each flexible budget really needed: spending in the last full round
   * and the average of the last three full rounds (rounds with nothing
   * recorded don't count), rounded to ₹100. For quick budget setting.
   */
  function budgetHistory(state, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const flex = state.transactions.filter(isFlexible);
    const rounds = [];
    let c = previousCycle(cycleFor(todayIso, payday), payday);
    for (let i = 0; i < 3; i++) {
      const cyc = c;
      const txs = flex.filter((t) => inCycle(t.date, cyc));
      if (txs.length) rounds.push(byCategory(txs));
      c = previousCycle(c, payday);
    }
    const out = {};
    (state.budgets || []).forEach((b) => {
      if (!rounds.length) return;
      const last = rounds[0][b.name] || 0;
      const avg = sum(rounds, (r) => r[b.name] || 0) / rounds.length;
      out[b.name] = { last: round100(last), avg: round100(avg), rounds: rounds.length };
    });
    return out;
  }

  /*
   * When: each day of this cycle so far (amount, card used), and the average
   * for each weekday over the last three cycles, Monday first. Days with
   * nothing spent count, so a quiet Sunday pulls Sunday's average down.
   */
  function spendWhen(state, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const cycle = cycleFor(todayIso, payday);
    const flex = state.transactions.filter(isFlexible);
    const byDate = {};
    flex.forEach((t) => {
      const d = byDate[t.date] || (byDate[t.date] = { amount: 0, card: false });
      d.amount += personalAmt(t);
      if (t.paidFrom && t.paidFrom !== 'account') d.card = true;
    });
    const days = [];
    for (let d = cycle.start; d <= todayIso && d < cycle.next; d = addDays(d, 1)) {
      days.push({ date: d, amount: byDate[d] ? byDate[d].amount : 0, card: !!(byDate[d] && byDate[d].card) });
    }
    const from = previousCycle(previousCycle(cycle, payday), payday).start;
    const firstTx = flex.reduce((m, t) => (t.date < m ? t.date : m), todayIso);
    const start = firstTx > from ? firstTx : from;
    const totals = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let d = start; d < todayIso; d = addDays(d, 1)) {
      const w = (parseISO(d).getDay() + 6) % 7;
      totals[w] += byDate[d] ? byDate[d].amount : 0;
      counts[w]++;
    }
    const weekdays = totals.map((x, i) => (counts[i] ? Math.round(x / counts[i]) : 0));
    const plan = monthlyPlan(state, todayIso);
    return { cycle, days, weekdays, daily: plan.flexTotal / cycle.days };
  }

  /*
   * Trend: the last `n` cycles, oldest first (the current one so far): pay,
   * spent (flexible and bills), saved (anything moved to savings or loans,
   * payday set-asides included) and borrowed (card spending and loans).
   */
  function spendTrend(state, todayIso, n) {
    const payday = Number(state.settings.payday) || 1;
    const pay = salaryHistory(state, todayIso, n || 6);
    const out = [];
    let c = cycleFor(todayIso, payday);
    for (let i = 0; i < (n || 6); i++) {
      const cyc = c;
      const txs = state.transactions.filter((t) => inCycle(t.date, cyc) && t.date <= todayIso);
      out.unshift({
        start: cyc.start,
        current: i === 0,
        salary: 0,
        spent: sum(txs.filter((t) => isFlexible(t) || isBillPayment(t) || isFixedPayment(t)), personalAmt),
        saved: sum(txs.filter(isMove), (t) => t.amount),
        borrowed: sum(txs.filter((t) => isFlexible(t) && t.paidFrom && t.paidFrom !== 'account'), (t) => t.amount) +
          sum(txs.filter((t) => isIncome(t) && t.borrowed), (t) => t.amount),
        recorded: txs.length > 0,
      });
      c = previousCycle(c, payday);
    }
    out.forEach((m, i) => { m.salary = pay[i] ? pay[i].amount : 0; });
    return out;
  }

  // ---------- little leaks ----------

  /*
   * Small, regular spends that add up. A leak is a tag on a payee (the shop
   * or app), on top of the payment's category, so budgets stay as they are.
   * Only money and what it costs in Days of Freedom are shown: no lectures.
   */
  const LEAKS = ['Cigarettes', 'Liquor', 'Tea & snacks', 'Food delivery', 'Betting & fantasy'];
  // Payees that are clearly one of them: suggested, never tagged without a yes. "=" means a whole word.
  const LEAK_HINTS = {
    'Food delivery': ['swiggy', 'zomato', 'eatsure', '=box8', 'faasos'],
    'Betting & fantasy': ['dream11', 'my11circle', '=mpl', 'winzo', 'rummy', 'poker', 'junglee', 'howzat', '=a23', 'fantasy', 'betway', 'parimatch', '1xbet', 'stake com'],
    'Liquor': ['wine', 'liquor', 'beer', '=bar'],
    'Cigarettes': ['paan', 'pan shop', 'tobacco', 'cigarette'],
    'Tea & snacks': ['chai', 'tea stall', 'chaiwala', 'chaayos', 'chai point'],
  };

  function leakNames(state) {
    const own = (state.customLeaks || []).filter((n) => LEAKS.indexOf(n) === -1);
    return LEAKS.concat(own);
  }

  function leakOf(state, t) {
    return (state.leakRules || {})[normalizeMerchant(t.note)] || null;
  }

  // Each leak this round and last: spent, a month's worth, and its cost in Days of Freedom.
  function leakSummary(state, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const cyc = cycleFor(todayIso, payday);
    const prev = previousCycle(cyc, payday);
    const f = freedomDays(state, todayIso);
    const flex = state.transactions.filter(isFlexible);
    const days = daysBetween(cyc.start, todayIso) + 1;
    const goals = state.leakGoals || {};
    const rules = state.leakRules || {};
    const leaks = leakNames(state).map((name) => {
      const mine = flex.filter((t) => leakOf(state, t) === name);
      const now = mine.filter((t) => inCycle(t.date, cyc) && t.date <= todayIso);
      const last = sum(mine.filter((t) => inCycle(t.date, prev)), personalAmt);
      const thisRound = sum(now, personalAmt);
      // A month's worth: last round, or this round's pace if that's higher.
      const perMonth = Math.max(last, Math.round((thisRound / days) * cyc.days));
      const g = goals[name] && goals[name].cycle === cyc.start ? goals[name] : null;
      // A challenge counts from the day it starts: what was spent before, plus the cut amount for the days left.
      const target = g ? Math.round((Number(g.spentBefore) || 0) + g.base * (1 - g.pct / 100) * ((cyc.days - daysBetween(cyc.start, g.from || cyc.start)) / cyc.days)) : 0;
      return {
        name, thisRound, count: now.length, lastRound: last, perMonth,
        freedom: f && perMonth > 0 ? Math.floor((perMonth / f.daily) * 10) / 10 : 0,
        places: Object.keys(rules).filter((k) => rules[k] === name),
        goal: g ? { pct: g.pct, target, left: target - thisRound } : null,
      };
    }).filter((x) => x.places.length || x.thisRound || x.lastRound);
    const perMonth = sum(leaks, (x) => x.perMonth);
    return { cycle: cyc, leaks, perMonth, freedom: f && perMonth > 0 ? Math.floor((perMonth / f.daily) * 10) / 10 : 0, daily: f ? f.daily : 0 };
  }

  // Payees from the last two rounds that look like a leak and haven't been answered yet.
  function leakSuggestions(state, todayIso) {
    const payday = Number(state.settings.payday) || 1;
    const from = previousCycle(cycleFor(todayIso, payday), payday).start;
    const rules = state.leakRules || {};
    const no = state.leakDeclined || [];
    const seen = {};
    state.transactions.filter((t) => isFlexible(t) && t.date >= from && t.date <= todayIso).forEach((t) => {
      const key = normalizeMerchant(t.note);
      if (!key || rules[key] || no.indexOf(key) !== -1) return;
      const leak = Object.keys(LEAK_HINTS).find((l) => LEAK_HINTS[l].some((w) => keywordMatches(key, w)));
      if (!leak) return;
      const x = seen[key] || (seen[key] = { payee: key, name: t.note, leak, total: 0, count: 0 });
      x.total += t.amount;
      x.count++;
    });
    return Object.keys(seen).map((k) => seen[k]).sort((a, b) => b.total - a.total);
  }

  // ---------- report for an AI chat ----------

  // ---------- bank SMS parsing ----------

  const CATEGORY_KEYWORDS = [
    ['Food & dining', ['swiggy', 'zomato', 'eatsure', 'dominos', 'pizza', 'mcdonald', 'kfc', 'cafe', 'restaurant', 'starbucks', 'chai']],
    ['Groceries', ['bigbasket', 'blinkit', 'zepto', 'dmart', 'jiomart', 'grofers', 'reliance fresh', 'more retail', 'kirana', 'instamart', 'grocery']],
    ['Travel', ['uber', 'ola', 'rapido', 'irctc', 'redbus', 'makemytrip', 'indigo', 'petrol', 'fuel', 'hpcl', 'iocl', 'bpcl', 'metro', 'fastag']],
    ['Shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'decathlon', 'croma']],
    ['Entertainment', ['netflix', 'spotify', 'hotstar', 'prime video', 'bookmyshow', 'pvr', 'inox', 'youtube', 'sonyliv']],
    ['Health', ['pharmacy', 'apollo', 'medplus', '1mg', 'pharmeasy', 'hospital', 'clinic', 'diagnostic', 'netmeds']],
    ['Personal care', ['salon', 'urban company', 'urbanclap', 'spa', 'barber']],
    ['Bills', ['recharge', 'airtel', 'jio', 'vodafone', 'bsnl', 'electricity', 'bescom', 'msedcl', 'tata power', 'adani electricity', 'torrent power', 'tneb', 'bses', 'indane', 'hp gas', 'bharatgas', 'bharat gas', 'mahanagar gas', 'water bill', 'broadband', 'fibernet', 'hathway']],
    // Money moved to savings or investments: recorded as saved, not spent. "=" means a whole word.
    ['Savings', ['=jar', 'changejar', 'groww', 'zerodha', 'kuvera', 'upstox', 'paytm money', 'indmoney', 'etmoney', 'mutual fund', '=sip', '=nps', '=ppf', 'recurring deposit', 'fixed deposit', 'safegold', 'digigold', 'digital gold', 'augmont', 'gullak']],
  ];

  function keywordMatches(lower, w) {
    return w[0] === '=' ? new RegExp('\\b' + w.slice(1) + '\\b').test(lower) : lower.indexOf(w) !== -1;
  }

  /*
   * Names AI advice must never carry: banks, card issuers, lenders, fund
   * houses, insurers, brokers and payment or investing apps. "=" means a
   * whole word. The names the person gave their own loans, cards, goals and
   * payments are allowed ("HDFC credit card EMI" is theirs).
   */
  const BRANDS = ['=sbi', 'state bank', '=hdfc', '=icici', '=axis', '=kotak', '=pnb', 'punjab national', 'bank of baroda', '=canara', 'union bank', '=idfc', 'indusind',
    'yes bank', 'federal bank', '=rbl', 'au small finance', 'bandhan', '=idbi', 'standard chartered', '=hsbc', '=citi', 'citibank', 'american express', '=amex', 'bank of india',
    '=onecard', '=uni card', '=lic', 'hdfc life', 'icici prudential', 'sbi life', 'max life', 'tata aia', 'star health', 'niva bupa', 'care health', 'bajaj allianz',
    'icici lombard', 'policybazaar', 'zerodha', '=groww', 'upstox', 'angel one', '=paytm', 'phonepe', 'google pay', '=gpay', '=cred', '=kuvera', 'et money', 'nippon', 'mirae',
    'parag parikh', '=quant', '=uti', '=dsp', 'motilal', 'franklin', 'aditya birla', '=bajaj', 'tata capital', 'muthoot', 'manappuram'].concat(LENDERS);
  function namesBrand(text, own) {
    const lower = String(text || '').toLowerCase();
    const mine = (own || []).map((x) => String(x || '').toLowerCase()).join(' | ');
    return BRANDS.find((w) => keywordMatches(lower, w) && !keywordMatches(mine, w)) || null;
  }
  // An AI plan, checked before it's kept: a step naming a bank, fund, insurer or app goes; an empty section goes too.
  function cleanAdvice(plan, state) {
    if (!plan || !Array.isArray(plan.sections)) return plan;
    const own = [].concat(state.debts || [], state.cards || [], state.goals || [], state.fixed || [], state.bills || []).map((x) => x && x.name);
    const ok = (st) => !namesBrand([st.action, st.why].join(' '), own);
    const clean = (s) => !namesBrand(s, own);
    const d = plan.diagnosis;
    return Object.assign({}, plan, {
      headline: namesBrand(plan.headline, own) ? '' : plan.headline,
      sections: plan.sections.map((sec) => Object.assign({}, sec, { steps: (sec.steps || []).filter(ok) })).filter((sec) => sec.steps.length),
      diagnosis: d && d.verdict ? Object.assign({}, d, {
        verdict: clean(d.verdict) ? d.verdict : '',
        causes: (d.causes || []).filter((c) => clean(c.title + ' ' + c.text)),
        actions: (d.actions || []).filter((a) => clean([a.action, a.by_when, a.changes].join(' '))),
        checks: (d.checks || []).filter(clean),
      }) : null,
    });
  }

  function categorize(text, rules) {
    const key = normalizeMerchant(text);
    if (rules && key && rules[key]) return rules[key];
    const lower = String(text || '').toLowerCase();
    for (const [cat, words] of CATEGORY_KEYWORDS) {
      if (words.some((w) => keywordMatches(lower, w))) return cat;
    }
    return 'Misc';
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // `future` allows dates after today (a card's due date); otherwise they become today.
  function parseSmsDate(text, todayIso, future) {
    let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    if (!m) {
      m = text.match(/\b(\d{1,2})[-\/ ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\/ ,]*(\d{2,4})\b/i);
      if (m) { d = +m[1]; mo = MONTHS.indexOf(m[2].toLowerCase()) + 1; y = +m[3]; }
    }
    if (!m) {
      m = text.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/);
      if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    }
    if (!m) {
      // "On 27-08" (HDFC card SMS): this year, or last year if that's still to come.
      m = text.match(/\bon\s+(\d{1,2})[-\/](\d{1,2})\b(?![-\/]\d)/i);
      if (m) {
        d = +m[1]; mo = +m[2]; y = +todayIso.slice(0, 4);
        if (y + '-' + pad(mo) + '-' + pad(d) > todayIso) y--;
      }
    }
    if (!m) return todayIso;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return todayIso;
    const iso = y + '-' + pad(mo) + '-' + pad(d);
    return iso > todayIso && !future ? todayIso : iso;
  }

  /*
   * The shop in a UPI ID: "gokhana.payu@indus" is Gokhana (PayU only took the
   * payment), "paytmqr6s55o1@ptys" a Paytm QR code. Kept in step with SmsParser.java.
   */
  const GATEWAYS = /^(payu|razorpay|rzp|rzpy|cashfree|ccavenue|billdesk|paygate|pg|upi|pay|payments?|merchant|mer)$/i;
  function vpaName(vpa) {
    const user = String(vpa).split('@')[0];
    // Masked by the bank ("*1995@okaxis"): only the end of it is known.
    if (/^\*/.test(user)) return 'UPI ' + user;
    if (/^paytmqr/i.test(user)) return 'Paytm QR';
    if (/^q\d{6,}/i.test(user) || /^bharatpe/i.test(user)) return 'QR payment';
    const words = user.split(/[._-]+/).filter((w) => w && !GATEWAYS.test(w) && !/^\d+$/.test(w));
    return words.length ? words.join(' ') : user;
  }

  function cleanMerchant(raw) {
    let s = String(raw || '').trim();
    if (/^(a\/?c|your|ac|account|card)\b/i.test(s)) return '';
    if (s.indexOf('/') !== -1) {
      const parts = s.split('/').map((p) => p.trim()).filter((p) => p && !/^\d+$/.test(p) && !/^(upi|p2m|p2a|imps|neft)$/i.test(p));
      s = parts.length ? parts[parts.length - 1] : s;
    }
    if (s.indexOf('@') !== -1) s = vpaName(s);
    s = s.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
    if (!s || /^(a\/?c|your|ac|account|card)\b/i.test(s)) return '';
    return s
      .toLowerCase()
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
      .replace(/\b(Upi|Qr)\b/g, (w) => w.toUpperCase())
      .slice(0, 40);
  }

  function findMerchant(text, type) {
    const patterns = type === 'credit'
      ? [/\bfrom\s+(?:vpa\s+)?([A-Za-z0-9@._&'\/ -]{2,50}?)(?=\s+(?:on|via|ref|upi|txn|for|avl|avbl|to|dt|date)\b|\s*[.,;(]\s|\s*[.,;]?$)/i, /(?:^|[^a-z0-9._*-])(\*?[a-z0-9._-]+@[a-z]+)\b/i]
      : [
        /\binfo[:\s]+([^\s].*?)(?=\.\s|\.$|$|\s+avl)/i,
        /\b(?:to|at|towards)\s+(?:vpa\s+)?([A-Za-z0-9@._&'\/ -]{2,50}?)(?=\s+(?:on|via|ref|upi|txn|for|avl|avbl|from|using|by|dt|date|received)\b|\s*[.,;(]\s|\s*[.,;]?$)/i,
        /\bon\s+([A-Z][A-Z0-9 &'-]{2,30})(?=\s*[.,]|\s+avl)/,
        /(?:^|[^a-z0-9._*-])(\*?[a-z0-9._-]+@[a-z]+)\b/i,
      ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const name = cleanMerchant(m[1]);
        if (name) return name;
      }
    }
    return '';
  }

  /*
   * Reads one bank transaction SMS. Returns null for messages that are not
   * transactions (OTPs, offers) or have no amount.
   */
  // Credit card SMS. Kept in step with SmsParser.java.
  const CARD_HINT = /credit card|\bcc\b|card\s*(?:no\.?|number|ending|xx|\*{2})|bank card\s*\d{4}\b|avl\.?\s*limit|available\s*limit|avail\.?\s*lmt/i;
  const DEBIT_CARD = /debit card/i;
  const STATEMENT = /\b(?:statement|stmt)\b/i;
  const TOTAL_DUE = /total\s*(?:amount|amt\.?)?\s*due\s*(?:is|of|:|-)?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const MIN_DUE = /min(?:imum)?\.?\s*(?:amount|amt\.?)?\s*due\s*(?:is|of|:|-)?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const DUE_DATE = /due\s*(?:date|by|on)\s*(?:is|:|-)?\s*(\d{1,2}[-\/ ]?(?:[a-z]{3,9}|\d{1,2})[-\/ ,]*\d{2,4})/i;
  // `(?:(?!\.\s).)` is any character within the same sentence (amounts like 8,400.00 have dots).
  const CARD_PAYMENT = /(?:payment|pymt)(?:(?!\.\s).){0,50}(?:received|credited|successful|processed)|(?:received|credited)(?:(?!\.\s).){0,40}(?:payment|pymt)|thank you for (?:the |your )?payment|towards(?:(?!\.\s).){0,40}credit card|credit card(?:(?!\.\s).){0,30}(?:bill|payment)/i;

  /*
   * Bank SMS with an amount that isn't money moving. Kept in step with SmsParser.java.
   * - reward points ("Reward Points Credited: 140 … 2 RP per Rs.200")
   * - UPI payment requests ("X has requested Rs 500 … approve")
   * - reminders ("Rs 6010 will be debited on 03-11")
   * - autopay set up ("mandate … registered", "AutoPay … set up")
   * - a bonus in a shop's or DTH account ("Dear Subscriber … Bonus amount of Rs. 114.45")
   * - offers ("LIFETIME FREE pre-approved … Credit Card … 19 BluChips per Rs.100 spent … T&C apply")
   */
  const NOT_MONEY = /reward\s*points?|\b(?:rp|points)\s+(?:credited|earned|redeemed)|\bhas requested\b|\bcollect request\b|\bpayment request\b|\bwill be (?:auto[- ]?)?(?:debited|deducted|charged)\b|\bmandate\b.{0,60}\b(?:registered|created|set ?up|approved)\b|\bauto ?pay\b.{0,40}\b(?:set ?up|registered|activated)\b|\bbonus amount\b|\bdear subscriber\b|\bpre-?approved\b|\blifetime free\b|\bper\s*(?:rs\.?|inr|₹)\s*[\d,]+|\bt\s*&\s*c\b|\bapply now\b|\b(?:get|earn|win) up ?to\b|\bfailed\b|\bdeclined\b|\bunsuccessful\b|\bwaive[dr]\b/i;

  // A bank's own charges ("Late payment fee of Rs.500 + GST Rs.90 charged", "Finance charges of Rs 1,234 levied"). Kept in step with SmsParser.java.
  const BANK_FEE = /\b(?:late (?:payment )?fee|finance charges?|interest charged|annual (?:fee|membership fee)|over ?limit fee|cash advance fee|joining fee|renewal fee)\b/i;

  // Bill amounts round up, so paying them clears the bill.
  function money(m) { return m ? Math.ceil(parseFloat(m[1].replace(/,/g, ''))) : 0; }

  function cardLast4(t) {
    const m = t.match(/card[^0-9]{0,25}?(\d{4})\b/i);
    return m ? m[1] : null;
  }

  /*
   * Reads one bank SMS. Types:
   *   debit / credit  payment out or money in, with paidFrom 'card' (and the
   *                   card's last 4 digits) or 'account'
   *   statement       a card's monthly statement: total, minimum, due date
   *   cardpayment     a card bill payment (from either side), not income
   * Returns null for messages that aren't payments (OTPs, offers).
   */
  function parseSms(text, rules, todayIso) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    // A card bill being turned into an EMI ("SMART EMI Loan booking"): not a payment, but the
    // EMI it sets up. It's an OTP, so it's only offered, never recorded by itself.
    // The OTP ("Loan of Rs 36390 … Tenure 06 months") and the confirmation ("processed your
    // Smart EMI request for Rs. ****36389.99 payable in **6 EMIs *1.87000 % ROI pm") both count.
    const emiLoan = /smart\s*emi|emi\s+(?:loan\s+)?booking/i.test(t) &&
      t.match(/(?:loan of|request for)\s*(?:rs\.?|inr|₹)[\s*]*([\d,]+(?:\.\d{1,2})?)/i);
    const emiMonths = t.match(/tenure\s*(?:of\s*)?(\d{1,3})\s*months?/i) || t.match(/\*?(\d{1,3})\s*emis?\b/i);
    if (emiLoan && emiMonths) {
      const pm = t.match(/(\d{1,2}(?:\.\d{1,5})?)\s*%\s*(?:roi\s*)?(?:pm|p\.m\.?|per month|a month)/i);
      return { type: 'cardemi', amount: Math.round(parseFloat(emiLoan[1].replace(/,/g, ''))), months: +emiMonths[1],
        rate: pm ? Math.round(parseFloat(pm[1]) * 12 * 100) / 100 : null, last4: cardLast4(t), merchant: 'Card EMI', category: 'Bills', date: todayIso,
        booked: /processed|boarded|booked successfully|successful/i.test(t), raw: t };
    }
    if (!t || /\botp\b|one time password|verification code/i.test(t) || NOT_MONEY.test(t)) return null;
    const amt = t.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (!amt) return null;
    let amount = Math.round(parseFloat(amt[1].replace(/,/g, '')));
    // More than ₹100 crore in one SMS is a misread, not a payment.
    if (!amount || amount > 1e9) return null;
    // A card fee and its GST ("fee of Rs.500 + GST Rs.90"): the card is charged both.
    if (/\b(?:fee|charges?)\b/i.test(t) && /\bgst\b/i.test(t)) {
      amount = (t.match(/(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?/gi) || []).reduce((a, m) => a + Math.round(parseFloat(m.replace(/^\D+/, '').replace(/,/g, ''))), 0);
    }
    // A date that doesn't exist (31-02) is a misread: the day the SMS came instead.
    const dateOf = (x) => { const d = parseSmsDate(x, todayIso); return d && toISO(parseISO(d)) === d ? d : todayIso; };
    const card = /card/i.test(t);
    if (card && STATEMENT.test(t) && (TOTAL_DUE.test(t) || MIN_DUE.test(t))) {
      const due = t.match(DUE_DATE);
      return {
        type: 'statement',
        amount: money(t.match(TOTAL_DUE)) || amount,
        min: money(t.match(MIN_DUE)) || null,
        due: due ? parseSmsDate(due[1], todayIso, true) : null,
        last4: cardLast4(t),
        merchant: 'Card statement',
        category: 'Bills',
        date: todayIso,
        raw: t,
      };
    }
    if (card && CARD_PAYMENT.test(t)) {
      return { type: 'cardpayment', amount, last4: cardLast4(t), merchant: 'Card bill payment', category: 'Bills', date: dateOf(t), raw: t };
    }
    if (BANK_FEE.test(t) && !/\b(?:reversed|reversal|refund(?:ed)?|credited)\b/i.test(t)) {
      const onCardFee = CARD_HINT.test(t) && !DEBIT_CARD.test(t);
      return { type: 'debit', amount, merchant: 'Bank charges', date: dateOf(t), category: 'Bills', paidFrom: onCardFee ? 'card' : 'account', last4: onCardFee ? cardLast4(t) : null, acct: null, atm: false, raw: t };
    }
    const isCredit = /\b(credited|received|deposited|refund(?:ed)?|disbursed|reversed)\b/i.test(t);
    // A reversal is money coming back, even when the SMS also says "debited".
    const reversed = /\breversed\b|\breversal\b/i.test(t);
    // Between your own accounts ("(self)", "own account"): out is a saving to place, in is your own money back.
    const self = /\(self\)|\bself[- ]?transfer\b|\bown (?:a\/?c|account)\b/i.test(t);
    // "Txn Rs.68.26 On HDFC Bank Card 6645 At …": HDFC's card and UPI payments.
    const isDebit = /\b(debited|spent|paid|sent|withdrawn|purchase|debit|payment of|charged|transferred\s+from)\b/i.test(t) || (!isCredit && /\btxn\s+(?:of\s+)?(?:rs\.?|inr|₹)/i.test(t));
    // Cash taken out at an ATM, and the account it came from (a/c XX1234), so it lands in the right wallet.
    const atm = /\batm\b|cash\s*withdraw|cash\s*wdl|withdrawn\s+at/i.test(t);
    const acct = (t.match(/\ba\/?c(?:count)?\.?\s*(?:no\.?\s*)?[x*.]*\s*[x*.]*(\d{3,4})\b/i) || [])[1] || null;
    if (!isDebit && !isCredit) return null;
    const type = reversed && isCredit ? 'credit' : isDebit ? 'debit' : 'credit';
    // A reversal names the shop the way the payment did ("at SWIGGY"); a date is never a name.
    let merchant = self ? 'Own account' : (reversed && findMerchant(t, 'debit')) || findMerchant(t, type);
    if (/^\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?$/.test(merchant || '')) merchant = '';
    const onCard = CARD_HINT.test(t) && !DEBIT_CARD.test(t);
    const paidFrom = onCard ? 'card' : 'account';
    const last4 = onCard ? cardLast4(t) : null;
    if (type === 'credit') {
      return {
        type,
        amount,
        merchant: /\b(?:it|itr|income[- ]tax) refund\b/i.test(t) ? 'Income tax refund' : merchant || 'Money received',
        date: dateOf(t),
        category: /refund|reversal|reversed|cashback/i.test(t) ? 'Refund' : 'Money received',
        salary: /\bsal(ary)?\b|payroll/i.test(t),
        paidFrom, last4, acct,
        raw: t,
      };
    }
    return {
      type,
      amount,
      merchant: merchant || 'Bank payment',
      date: dateOf(t),
      category: self ? 'Savings' : atm ? 'Cash' : categorize(merchant || t, rules),
      paidFrom, last4, acct, atm: atm && !onCard,
      // Cash from an ATM on a credit card: borrowed on the card (interest from day one), not spending.
      cashAdvance: atm && onCard,
      raw: t,
    };
  }

  /*
   * Identifies a message by its text so the same SMS isn't added twice: once
   * from a notification and again when the inbox is read. Must match
   * SmsParser.key() in the Android app.
   */
  function smsKey(body) {
    const text = String(body || '').replace(/\s/g, '');
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return 's' + (h >>> 0).toString(16);
  }

  function splitSmsBatch(text) {
    const blocks = String(text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (blocks.length > 1) return blocks;
    const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const withAmount = lines.filter((l) => /(?:rs\.?|inr|₹)\s*[\d,]/i.test(l));
    return withAmount.length > 1 && withAmount.length === lines.length ? lines : blocks;
  }

  const Core = {
    parseISO, toISO, addDays, addMonths, daysBetween, cycleFor, previousCycle,
    occurrenceInCycle, monthlyPlan, cycleEvents, projectRunway, autoSavings, allocate,
    insights, simulateDebts, compareDebtPlans, debtFreeDates, emergencyPlan, parseSms,
    splitSmsBatch, smsKey, categorize, normalizeMerchant, sinkingMonthly, inCycle,
    spendInRange, incomeInRange, incomeKept, isIncome, isMove, isBillPayment, isFixedPayment, isCashAdvance, emiLoans,
    linkRefund, unlinkRefund, forgetRefunds, refundMatches, isEarned, earnedIn, fixedPaidFor, fixedDueFor, payFixed, unpayFixed, fixedMatches, isFlexible, incomeOptions,
    salaryFor, salaryHistory, looksLikeSalary, paydayReset, suggestUse, freedomDays, interestLeak, nextPaydayPreview,
    billShare, billPot, billsMonthly, billPaidIn, billDue, billEnded, fixedEnded, loanEnd, billsFor, fixedFor, fixedTotal, paymentsLeft, lastDueFrom, nextFixedDue, payBill, undoBillPayment, zoneStatus, ESSENTIAL_CATEGORIES,
    isCardTransfer, statementOn, dueAfter, cardOwedAt, cardReserve, cardStatus, emiQuote, revolveQuote, cardBillPlan,
    recordCardPayment, keptFor, ownPart, coverPurchase, refundToPurchase, undoRefund, earmarkedIn, cleanState, accuracyStats, reimbView, syncReimb, addClaim, recordPayout, claimSet, reimbForget, reimbAmount, addCardEmi, isPassedOn, passThroughPair, passOn, iouLeft, openIous, addIou, payIou, undoIouTx, iouSummary, iouEvents, cardEmiFromBooking, looksLikeCardBill, spendToCardPayment, convertCardBalance, answerCardDue, cardLateFee, cardRate, CARD_RATE, undoCardConvert, cardFreeDays, byCategory, DEFAULT_SPLIT,
    unpassOn, isLoanCredit, borrowedThisCycle, borrowCheck, rolloverOptions, setTranslator,
    maybeOpen, maybeHeld, maybeDue, maybeIfHappens, addMaybe, maybeHappened, maybeDidnt, maybeReopen, maybeForget, maybeCandidates, maybeStats,
    weekTrend, priorityLadder, monthlyReview, healthCheck, whatIf, namesBrand, cleanAdvice, payoffOrder, tickDebts, debtJourney, lenderTasks, lastBorrowed,
    encryptBackup, openBackup, backupInfo, toB64, fromB64, isTransfer, walletBalances, goalStatus, goalsMonthly, budgetEnvelopes, netWorth, reportRange, budgetHistory, aiFacts, planFacts, fraudSignals, investReady, goalResult, weekStart,
    daySpent, daySpending, dayTally, roundSnapshot, roundResult, weekRecap,
    monthReport, LEAKS, leakNames, leakOf, leakSummary, leakSuggestions, spendWhere, spendWhen, spendTrend, BASICS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
