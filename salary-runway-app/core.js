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

  function billsMonthly(state) {
    return sum(state.bills || [], billShare);
  }

  function billPaidIn(state, b, cycle) {
    return state.transactions.find((t) => t.billId === b.id && inCycle(t.date, cycle)) || null;
  }

  // A bill is due this cycle if its next due date is before the next payday (overdue included).
  function billDue(b, cycle) {
    return !!b.nextDue && b.nextDue < cycle.next;
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
    b.nextDue = addMonths(near ? b.nextDue : dateIso, months);
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
  function monthlyPlan(state, todayIso) {
    const adj = activeAdjustment(state, todayIso);
    const alloc = allocate(state, todayIso);
    const sv = alloc.savings;
    const salary = salaryFor(state, todayIso);
    const fixedTotal = sum(state.fixed, (f) => Number(f.amount) || 0);
    const debtMin = sum(state.debts.filter((d) => d.balance > 0), (d) => Number(d.minPayment) || 0);
    const emergency = sv.emergencyMonthly;
    const invest = adj && adj.pauseInvest ? 0 : sv.investMonthly;
    const debtExtra = adj && adj.pauseDebtExtra ? 0 : sv.debtExtra;
    const sinking = sum(state.sinking, sinkingMonthly);
    const variableBills = billsMonthly(state);
    const cut = adj ? adj.flexCutPct : 0;
    const budgets = alloc.budgets.map((b) => ({
      name: b.name,
      auto: b.auto,
      base: b.amount,
      amount: Math.round(b.amount * (1 - cut / 100)),
    }));
    const flexTotal = sum(budgets, (b) => b.amount);
    const savingsTotal = emergency + invest + debtExtra + sinking;
    const allocated = fixedTotal + debtMin + variableBills + savingsTotal + flexTotal;
    return {
      salary, fixedTotal, debtMin, variableBills, emergency, invest, debtExtra, sinking,
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
      if (!((Number(b.estimate) || 0) > 0) || billPaidIn(state, b, cycle)) return;
      if (billDue(b, cycle)) {
        let date = b.nextDue < cycle.start ? cycle.start : b.nextDue;
        if (todayIso && date < todayIso) date = todayIso;
        events.push({ date, name: b.name, amount: Math.max(0, (Number(b.estimate) || 0) - billPot(b, state, cycle.start)), kind: 'bill', billId: b.id });
      } else if (billShare(b) > 0) {
        events.push({ date: cycle.start, name: tr('Set aside for {name}', { name: b.name }), amount: billShare(b), kind: 'billpot', billId: b.id });
      }
    });
    state.fixed.forEach((f) => {
      const date = occurrenceInCycle(Number(f.dueDay) || 1, cycle);
      if (date) events.push({ date, name: f.name, amount: Number(f.amount) || 0, kind: 'fixed' });
    });
    state.debts.filter((d) => d.balance > 0).forEach((d) => {
      const date = occurrenceInCycle(Number(d.dueDay) || 1, cycle);
      // A card EMI starts with the card's next bill.
      if (date && (!d.starts || date >= d.starts)) events.push({ date, name: d.name, amount: Number(d.minPayment) || 0, kind: 'debt' });
    });
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
  // Paying a card bill, or moving a card balance to a loan, only moves money
  // between your account and the card: the spending was counted when it happened.
  function isCardTransfer(t) { return t.kind === 'cardpay' || t.kind === 'cardconvert'; }
  function isFlexible(t) { return !isIncome(t) && !isMove(t) && !isBillPayment(t) && !isCardTransfer(t); }

  function spendInRange(transactions, cycle) {
    return transactions.filter((t) => isFlexible(t) && inCycle(t.date, cycle));
  }

  function incomeInRange(transactions, cycle) {
    return transactions.filter((t) => isIncome(t) && inCycle(t.date, cycle));
  }

  /*
   * How much of a money-in entry stays in the account for spending.
   * useFor: null (not decided yet, so it stays) | 'spend' | 'emergency' |
   * 'grow' | 'debt'. Money moved to a fund or used on a loan leaves the
   * spending money, except any part larger than the loan.
   */
  function incomeKept(t) {
    if (!t.useFor || t.useFor === 'spend') return t.amount;
    if (t.useFor === 'debt') return t.amount - (Number(t.debtPaid) || 0);
    return 0;
  }

  function byCategory(transactions) {
    const out = {};
    transactions.forEach((t) => { out[t.category] = (out[t.category] || 0) + t.amount; });
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
    incomes.forEach((t) => { spendByDate[t.date] = (spendByDate[t.date] || 0) - incomeKept(t); });
    const extraIn = sum(incomes.filter((t) => !anchor || t.date >= anchor.date), incomeKept);
    // Bill payments leave the account (less what the pot covers); moves to savings leave too.
    // Set-aside moves (t.setAside) record money already taken out on payday, so they're skipped here.
    const others = state.transactions.filter((t) => (isBillPayment(t) || (isMove(t) && !t.setAside)) && inCycle(t.date, cycle) && t.date <= todayIso);
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
    const spentToDate = sum(pastTxns, (t) => t.amount);
    const spentToday = sum(pastTxns.filter((t) => t.date === todayIso), (t) => t.amount);
    const paceSpend = sum(
      pastTxns.filter((t) => NON_PACE_CATEGORIES.indexOf(t.category) === -1 && (!anchor || t.date >= anchor.date)),
      (t) => t.amount
    );
    /*
     * The pace is the average over finished days only. Counting today as a
     * finished day with nothing spent made the forecast jump at midnight
     * (Careful at 11 pm, Green at 12:05 am with nothing done). Today counts
     * as at least a usual day until it's over.
     */
    const paceToday = sum(pastTxns.filter((t) => t.date === todayIso && NON_PACE_CATEGORIES.indexOf(t.category) === -1), (t) => t.amount);
    const daysDone = idxToday - aIdx;
    const remainingDays = N - 1 - idxToday;
    // With a balance check, extra money is shared over the days from that check.
    const dailyBudget = plan.flexTotal / N + (anchor ? (extraIn - moved) / (N - aIdx) : 0);
    const paceRate = daysDone >= 2 && paceSpend - paceToday > 0 ? (paceSpend - paceToday) / daysDone : plan.flexTotal / N;
    const todayRest = Math.max(0, paceRate - paceToday);
    const flexLeft = Math.max(0, plan.flexTotal + extraIn - paceSpend - moved);
    const planRate = anchor ? dailyBudget : remainingDays > 0 ? flexLeft / remainingDays : 0;

    const points = [];
    let bal = plan.salary - plan.savingsTotal;
    let pace = 0;
    let planned = 0;
    for (let i = 0; i < N; i++) {
      const date = addDays(cycle.start, i);
      const out = eventsByDate[date] || 0;
      if (i <= idxToday) {
        if (anchor && i === aIdx) bal = (Number(anchor.amount) || 0) - cardReserve(state, anchor.date);
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
    const byMoney = Math.max(0, bal + spentToday + savedToday - billsAhead) / (remainingDays + 1);
    const byBudget = anchor
      ? plan.flexTotal / N + (extraIn - (moved - savedToday)) / (N - aIdx)
      : Math.max(0, plan.flexTotal + extraIn - (moved - savedToday) - (paceSpend - spentToday)) / (remainingDays + 1);
    const dailyAllowance = Math.min(byMoney, byBudget);
    // The parts of today's limit, for "how is this calculated?".
    const limit = { byMoney, byBudget, money: bal + spentToday + savedToday, bills: billsAhead, days: remainingDays + 1 };
    // What is left of today's amount after spending and saving, and tomorrow's amount once today is counted.
    const usedToday = spentToday + savedToday;
    const leftToday = Math.max(0, dailyAllowance - usedToday);
    const overToday = Math.max(0, usedToday - dailyAllowance);
    const tomorrowAllowance = remainingDays > 0
      ? Math.min(Math.max(0, bal - billsAhead) / remainingDays, anchor ? dailyBudget : planRate)
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
      cycle, plan, events, points, idxToday, remainingDays, anchor, anchorIdx: anchor ? aIdx : null, limit,
      spentToDate, spentToday, savedToday, flexLeft, extraIn, moved, billsAhead, paceRate, planRate, dailyAllowance, leftToday, overToday, tomorrowAllowance,
      balanceToday: points[idxToday].actual,
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
    const essentialPerDay = sum(r.plan.budgets.filter((b) => ESSENTIAL_CATEGORIES.indexOf(b.name) !== -1), (b) => b.amount) / N;
    const billsAfter = (iso) => sum(r.events.filter((e) => e.date > iso), (e) => e.amount);
    const money = r.balanceToday;
    const needs = r.billsAhead + essentialPerDay * r.remainingDays;
    const needsLine = r.points.map((p, i) => (i < r.idxToday ? null : billsAfter(p.date) + essentialPerDay * (N - 1 - i)));
    const safeDaily = r.remainingDays > 0 ? Math.max(0, money - r.billsAhead) / r.remainingDays : 0;

    let zone = 'green';
    if (money < needs) zone = 'red';
    else if (r.zeroPace || r.endPace < 0) zone = 'amber';

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
    return state.transactions.filter((t) => isFlexible(t) && t.paidFrom === card.id);
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

  // What the card owes the bank at the end of a date.
  function cardOwedAt(state, card, iso) {
    return setupOwed(card) +
      sum(cardSpends(state, card).filter((t) => t.date <= iso), (t) => t.amount) -
      sum(cardRefunds(state, card).filter((t) => t.date <= iso), (t) => t.amount) -
      sum(cardPayments(state, card).filter((t) => t.date <= iso), (t) => t.amount);
  }

  /*
   * Card spending before a date that hasn't been paid yet. That money is
   * still in the bank, so a balance check subtracts it. Payments clear the
   * amount owed from before the card was added first.
   */
  function cardReserve(state, iso) {
    return sum(state.cards || [], (c) => {
      const spent = sum(cardSpends(state, c).filter((t) => t.date < iso), (t) => t.amount) -
        sum(cardRefunds(state, c).filter((t) => t.date < iso), (t) => t.amount);
      const paid = sum(cardPayments(state, c).filter((t) => t.date < iso), (t) => t.amount);
      return Math.max(0, spent - Math.max(0, paid - setupOwed(c)));
    });
  }

  // Bills for what was owed before the card was added, until paid.
  function cardLegacyEvents(state, card, todayIso) {
    const paid = sum(cardPayments(state, card).filter((t) => t.date <= todayIso), (t) => t.amount);
    const statementLeft = Math.max(0, (Number(card.setupStatement) || 0) - paid);
    const unbilledLeft = Math.max(0, setupOwed(card) - paid) - statementLeft;
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
      paidSince = sum(pays.filter((t) => t.date >= created), (t) => t.amount);
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
    return { emi: Math.round(emi), months: n, interest: Math.round(interest), fee: Math.round(Number(fee) || 0), cost: Math.round(interest + (Number(fee) || 0)) };
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
  function answerCardDue(state, cardId, answer, paid, todayIso) {
    const card = (state.cards || []).find((c) => c.id === cardId);
    if (!card) return null;
    const st = cardStatus(state, card, todayIso);
    card.answered = st.due;
    paid = answer === 'full' ? st.remaining : answer === 'part' ? Math.max(0, Math.min(st.remaining, Math.round(Number(paid) || 0))) : 0;
    if (paid > 0) recordCardPayment(state, cardId, paid, todayIso, 'account');
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
   * - emergency fund first, until it holds a few months of needs
   * - debts at 15%+ interest get the rest before the Grow budget does
   */
  function autoSavings(state, todayIso) {
    const salary = salaryFor(state, todayIso);
    const fixed = sum(state.fixed, (f) => Number(f.amount) || 0);
    const mins = sum(state.debts.filter((d) => d.balance > 0), (d) => Number(d.minPayment) || 0);
    const sinking = sum(state.sinking, sinkingMonthly) + billsMonthly(state);
    const available = salary - fixed - mins - sinking;
    const notes = [];
    if (available <= 0) {
      if (salary > 0) notes.push(tr('Fixed payments, debt minimums and yearly costs already use the whole salary, so nothing can be set aside yet. The Debts tab shows what clearing the costliest loan frees up.'));
      return { emergencyMonthly: 0, investMonthly: 0, debtExtra: 0, notes, emergencyTarget: 0 };
    }

    const pool = round100(Math.min(salary * 0.2, available * 0.35));
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
   * Amounts are whole hundreds; the rounding remainder goes to the largest.
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
    const fixed = sum(state.fixed, (f) => Number(f.amount) || 0);
    const mins = sum(state.debts.filter((d) => d.balance > 0), (d) => Number(d.minPayment) || 0);
    const sinking = sum(state.sinking, sinkingMonthly) + billsMonthly(state);
    const pool = salary - fixed - mins - sinking - savings.emergencyMonthly - savings.investMonthly - savings.debtExtra;
    const customTotal = sum(state.budgets.filter((b) => !b.auto), (b) => Number(b.amount) || 0);
    const autoPool = Math.max(0, pool - customTotal);
    const autos = state.budgets.filter((b) => b.auto);
    const wTotal = sum(autos, (b) => weightFor(b.name));
    const amounts = {};
    autos.forEach((b) => { amounts[b.id] = Math.floor((autoPool * weightFor(b.name)) / wTotal / 100) * 100; });
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
      .map((d) => ({ name: d.name, bal: Number(d.balance), rate: Number(d.rate) || 0, min: Number(d.minPayment) || 0 }));
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
      });
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
    const when = (sim) => ({ months: sim.months, interest: sim.totalInterest, never: sim.neverPaysOff, date: sim.neverPaysOff ? null : addMonths(todayIso, sim.months) });
    const now = when(simulateDebts(debts, 0, 'avalanche', false));
    const plan = when(simulateDebts(debts, extra, payoffOrder(state), true));
    return {
      now, plan, extra,
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
  function tickDebts(state, todayIso) {
    const cleared = [];
    state.debts.forEach((d) => {
      const bal = Number(d.balance) || 0;
      if (bal > (Number(d.startBalance) || 0)) d.startBalance = bal;
      const day = Number(d.dueDay);
      const emi = Number(d.minPayment) || 0;
      if (d.fromCard || !day || !(emi > 0) || !(bal > 0)) return;
      if (!d.emiThrough) { d.emiThrough = lastDueOn(todayIso, day); return; }
      // One EMI a month, each in the month after the last one counted.
      const from = parseISO(d.emiThrough);
      for (let k = 1; d.balance > 0; k++) {
        const due = toISO(clampedDate(from.getFullYear(), from.getMonth() + k, day));
        if (due > todayIso) break;
        const interest = (d.balance * (Number(d.rate) || 0)) / 1200;
        const after = Math.max(0, Math.round(d.balance + interest - emi));
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

    options.push({
      use: 'grow',
      title: tr('Set aside to invest'),
      detail: tr('Adds to the {amount} you’ve set aside to invest.', { amount: rupeesIn(Number(state.savings.investSaved) || 0) }) + ' ' +
        tr(personal(state) ? 'The Grow tab shows how to split it.' : 'Talk to a SEBI-registered investment adviser before investing it.'),
    });

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
      sum(state.fixed, (f) => Number(f.amount) || 0) +
      sum(state.debts.filter((d) => d.balance > 0 && !startsNext(d)), (d) => Number(d.minPayment) || 0) +
      billsMonthly(state) + sum(state.sinking, sinkingMonthly)
    );
    return {
      date: next.start, nominal, shortfall, fromBefore, newCardDebt, borrowed, effective,
      percent: nominal > 0 ? (borrowed / nominal) * 100 : 0,
      depleted: nominal > 0 && nominal - borrowed <= 0,
      committed, freeAfter: effective - committed,
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
    options.push({ to: 'grow', title: tr('Set aside to invest'), detail: tr('{amount} a month to invest.', { amount: rupeesIn(amount) }) + ' ' + tr(personal(state) ? 'The Grow tab shows how to split it.' : 'Talk to a SEBI-registered investment adviser about where.') });
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

  // ---------- spending, three ways ----------

  // Basics: what has to be paid whatever happens. Everything else is a choice.
  const BASICS = ['Groceries', 'Health', 'Bills', 'Emergency'];

  // Where: spending by category this cycle (to today), against budget, and basics vs the rest.
  function spendWhere(state, todayIso) {
    const cycle = cycleFor(todayIso, Number(state.settings.payday) || 1);
    const txs = state.transactions.filter((t) => isFlexible(t) && inCycle(t.date, cycle) && t.date <= todayIso);
    const spent = byCategory(txs);
    const budgets = {};
    monthlyPlan(state, todayIso).budgets.forEach((b) => { budgets[b.name] = b.amount; });
    const categories = Object.keys(spent).map((name) => ({ name, spent: spent[name], budget: budgets[name] || 0 }))
      .sort((a, b) => b.spent - a.spent);
    const basics = sum(categories.filter((c) => BASICS.indexOf(c.name) !== -1), (c) => c.spent);
    const total = sum(categories, (c) => c.spent);
    return { cycle, categories, total, basics, other: total - basics };
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
      d.amount += t.amount;
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
        spent: sum(txs.filter((t) => isFlexible(t) || isBillPayment(t)), (t) => t.amount),
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
      const last = sum(mine.filter((t) => inCycle(t.date, prev)), (t) => t.amount);
      const thisRound = sum(now, (t) => t.amount);
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

  /*
   * A text report to give any free AI chat (ChatGPT, Gemini, Claude…) for
   * next month's plan. The questions come first and never change, so the
   * answer has the same shape every month. Then: the setup today, last month
   * in full (every entry) and the two months before as summaries, plus this
   * month so far. Every number is worked out here; the AI only plans from it.
   * The data stays in English (any AI reads it); the answer comes in the
   * app's language.
   */
  const REPORT_LANGS = { en: 'English', mr: 'Marathi (मराठी)', hi: 'Hindi (हिंदी)' };
  const USE_NAMES = { emergency: 'emergency fund', debt: 'loan', grow: 'savings', spend: 'spending' };

  function monthAbbr(m) { return MONTHS[m].replace(/^./, (c) => c.toUpperCase()); }

  function reportDate(iso) {
    const d = parseISO(iso);
    return d.getDate() + ' ' + monthAbbr(d.getMonth()) + ' ' + d.getFullYear();
  }

  function cell(s) { return String(s == null ? '' : s).replace(/[|\n]/g, ' ').trim(); }

  function table(head, rows) {
    return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|']
      .concat(rows.map((r) => '| ' + r.map(cell).join(' | ') + ' |')).join('\n');
  }

  // One salary cycle: pay, spending against budgets, savings, borrowing, leaks.
  function cycleFacts(state, cycle, upTo) {
    const end = upTo || addDays(cycle.next, -1);
    const txs = state.transactions.filter((t) => inCycle(t.date, cycle) && t.date <= end);
    const slip = (state.payslips || {})[cycle.start];
    const flex = txs.filter(isFlexible);
    const spent = byCategory(flex);
    const plan = monthlyPlan(state, cycle.start);
    const budgets = {};
    plan.budgets.forEach((b) => { budgets[b.name] = b.amount; });
    const cats = Object.keys(spent).concat(Object.keys(budgets).filter((n) => !(n in spent) && budgets[n] > 0));
    const cardSpend = flex.filter((t) => t.paidFrom && t.paidFrom !== 'account');
    const small = flex.filter((t) => t.amount < SMALL_PAYMENT && ['Bills', 'Emergency'].indexOf(t.category) === -1);
    const saved = {};
    txs.filter((t) => isMove(t)).forEach((t) => { const k = USE_NAMES[t.useFor] || 'savings'; saved[k] = (saved[k] || 0) + t.amount; });
    const merchants = {};
    flex.forEach((t) => { const m = normalizeMerchant(t.note) || t.category; merchants[m] = (merchants[m] || { name: t.note || t.category, total: 0, count: 0 }); merchants[m].total += t.amount; merchants[m].count++; });
    return {
      cycle, end, txs,
      pay: slip ? Number(slip.amount) || 0 : Number(state.settings.salary) || 0,
      payNote: slip && slip.reason ? slip.reason + (slip.note ? ': ' + slip.note : '') : '',
      income: txs.filter(isIncome),
      flexTotal: sum(flex, (t) => t.amount),
      bills: sum(txs.filter(isBillPayment), (t) => t.amount),
      cardPaid: sum(txs.filter((t) => t.kind === 'cardpay'), (t) => t.amount),
      categories: cats.map((n) => ({ name: n, spent: spent[n] || 0, budget: budgets[n] || 0 })).sort((a, b) => b.spent - a.spent),
      cardSpend: sum(cardSpend, (t) => t.amount),
      cardDays: new Set(cardSpend.map((t) => t.date)).size,
      days: daysBetween(cycle.start, end) + 1,
      small: { count: small.length, total: sum(small, (t) => t.amount) },
      saved,
      borrowedIn: sum(txs.filter((t) => isIncome(t) && t.borrowed), (t) => t.amount),
      merchants: Object.keys(merchants).map((k) => merchants[k]).sort((a, b) => b.total - a.total).slice(0, 5),
    };
  }

  function factsText(f, full, state) {
    const out = [];
    out.push('- Salary received: ' + rupees(f.pay) + (f.payNote ? ' (' + f.payNote + ')' : ''));
    f.income.forEach((t) => out.push('- Other money in: ' + rupees(t.amount) + ' from ' + (t.note || t.category || 'unknown') +
      (t.borrowed ? ' (BORROWED: a loan or credit line)' : '') + (t.useFor ? ', used for ' + (USE_NAMES[t.useFor] || t.useFor) : '')));
    out.push('- Flexible spending: ' + rupees(f.flexTotal) + ' · bills paid: ' + rupees(f.bills) + ' · credit card bills paid: ' + rupees(f.cardPaid));
    out.push('- Spent on credit cards: ' + rupees(f.cardSpend) + ' on ' + f.cardDays + ' of ' + f.days + ' days');
    out.push('- Small payments under ' + rupees(SMALL_PAYMENT) + ': ' + f.small.count + ', adding up to ' + rupees(f.small.total));
    const saved = Object.keys(f.saved);
    out.push('- Moved from leftovers: ' + (saved.length ? saved.map((k) => rupees(f.saved[k]) + ' to ' + k).join(', ') : 'nothing'));
    if (f.borrowedIn) out.push('- Borrowed money received: ' + rupees(f.borrowedIn));
    out.push('');
    out.push(table(['Category', 'Spent', 'Budget', 'Over / under'], f.categories.map((c) => [
      c.name, rupees(c.spent), c.budget ? rupees(c.budget) : '-', c.budget ? (c.spent > c.budget ? 'over by ' + rupees(c.spent - c.budget) : 'under by ' + rupees(c.budget - c.spent)) : '-',
    ])));
    if (f.merchants.length) {
      out.push('');
      out.push('Top places: ' + f.merchants.map((m) => cell(m.name) + ' ' + rupees(m.total) + ' (' + m.count + 'x)').join(', '));
    }
    if (full) {
      const cards = {};
      (state.cards || []).forEach((c) => { cards[c.id] = c.name + ' card'; });
      const type = (t) => (isIncome(t) ? (t.borrowed ? 'Money in (borrowed)' : 'Money in') : isMove(t) ? 'Saved to ' + (USE_NAMES[t.useFor] || 'savings')
        : isBillPayment(t) ? 'Bill' : t.kind === 'cardpay' ? 'Card bill paid' : t.kind === 'cardconvert' ? 'Card balance to EMI' : 'Spent');
      out.push('');
      out.push('### Every entry (' + f.txs.length + ')');
      out.push(table(['Date', 'Type', 'Amount', 'Category', 'Note', 'Paid from'], f.txs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((t) => [
        reportDate(t.date), type(t), rupees(t.amount), t.category || '', t.note || '', t.paidFrom && t.paidFrom !== 'account' ? cards[t.paidFrom] || 'card' : isFlexible(t) ? 'bank / UPI / cash' : '',
      ])));
    }
    return out.join('\n');
  }

  function aiReport(state, todayIso, lang) {
    const payday = Number(state.settings.payday) || 1;
    const now = cycleFor(todayIso, payday);
    const last = previousCycle(now, payday);
    const before = [previousCycle(last, payday)];
    before.push(previousCycle(before[0], payday));
    const span = (c) => reportDate(c.start) + ' – ' + reportDate(addDays(c.next, -1));
    const plan = monthlyPlan(state, todayIso);
    const f = freedomDays(state, todayIso);
    const L = [];

    L.push('# Hisab Se: my money report for next month’s plan');
    L.push('Made on ' + reportDate(todayIso) + '. Last month: ' + span(last) + '. Next payday: ' + reportDate(now.next) + '.');
    L.push('');
    L.push('## Instructions for the AI (follow exactly)');
    L.push('You are my personal money coach in India. My goal: live free of loans, never reach ₹0 before payday, and build savings so emergencies don’t need borrowing.');
    L.push('- Use only the data in this report. Don’t guess numbers; if something you need is missing, say what is missing.');
    L.push('- Never suggest a new loan, credit card, buy-now-pay-later, salary advance or borrowing from friends or apps.');
    L.push('- Use ₹ with Indian commas (₹1,20,000). Be specific and short. Reply in ' + (REPORT_LANGS[lang] || 'English') + '.');
    L.push('');
    L.push('Answer with exactly these sections, in this order:');
    L.push('1. **Last month in brief**: 3 lines: what went well, what went badly, the biggest risk now.');
    L.push('2. **Trend**: last month against the 2 months before it (spending, saving, card use, borrowing), with numbers.');
    L.push('3. **Next month’s budget**: a table: Category | Spent last month | Budget | Suggested budget | Why. The total must fit my pay after fixed payments, loan EMIs, bills and set-asides.');
    L.push('4. **Debt plan**: which loan gets extra money first (highest interest first), how much a month, and the month each loan would be cleared.');
    L.push('5. **Emergency fund**: how much to add each month, and when it reaches 1 month and 3 months of bills and basics.');
    L.push('6. **Leaks to fix**: the 3 biggest avoidable spends from the entry list (places, small payments, card spending), each with the ₹ a month it would save.');
    L.push('7. **Daily limit**: one number: what I can spend a day next month on flexible spending, and the date I check it again.');
    L.push('8. **3 rules for next month**: short, specific, easy to follow.');
    if (personal(state)) L.push('9. **Investing**: only if the emergency fund covers 1 month and no loan costs over 12% a year: how much to invest a month and where (a SIP in a Nifty 50 index fund, PPF). Otherwise say what must happen first.');
    L.push('');

    L.push('## My setup today');
    L.push('- Usual monthly salary (in hand): ' + rupees(Number(state.settings.salary) || 0) + ', paid on day ' + payday + ' of the month');
    if (state.fixed.length) L.push('- Fixed payments: ' + state.fixed.map((x) => cell(x.name) + ' ' + rupees(Number(x.amount) || 0) + (x.dueDay ? ' (day ' + x.dueDay + ')' : '')).join(', '));
    if ((state.bills || []).length) L.push('- Bills that vary: ' + state.bills.map((b) => cell(b.name) + ' about ' + rupees(Number(b.estimate) || 0) + ((Number(b.everyMonths) || 1) > 1 ? ' every ' + b.everyMonths + ' months' : ' a month')).join(', '));
    const debts = state.debts.filter((d) => d.balance > 0);
    if (debts.length) {
      L.push('- Loans:');
      L.push(table(['Loan', 'Balance left', 'Interest a year', 'EMI / minimum'], debts.map((d) => [d.name, rupees(d.balance), (Number(d.rate) || 0) + '%', rupees(Number(d.minPayment) || 0)])));
    } else L.push('- Loans: none');
    (state.cards || []).forEach((c) => L.push('- Credit card ' + cell(c.name) + ': limit ' + rupees(Number(c.limit) || 0) + ', ' + (Number(c.rate) || 0) + '% a year, owed now ' + rupees(Math.max(0, cardOwedAt(state, c, todayIso)))));
    L.push('- Emergency fund: ' + rupees(Number(state.savings.emergencyBalance) || 0) + (f ? ' (covers ' + f.days + ' days of bills and basics at ' + rupees(f.daily) + ' a day)' : '') + '; target ' + (Number(state.savings.emergencyTargetMonths) || 3) + ' months');
    L.push('- Set aside each month now: emergency fund ' + rupees(plan.emergency) + ', extra to loans ' + rupees(plan.debtExtra) + ', investing ' + rupees(plan.invest) + ', yearly costs ' + rupees(plan.sinking));
    (state.sinking || []).forEach((s) => L.push('- Saving for ' + cell(s.name) + ': ' + rupees(Number(s.amount) || 0) + (s.month ? ' due in ' + monthAbbr((Number(s.month) || 1) - 1) : '') + ', saved ' + rupees(Number(s.saved) || 0)));
    L.push('- Flexible budgets this month: ' + plan.budgets.map((b) => b.name + ' ' + rupees(b.amount)).join(', '));
    L.push('');

    L.push('## Last month: ' + span(last));
    L.push(factsText(cycleFacts(state, last), true, state));
    L.push('');
    L.push('## The two months before (summaries)');
    before.forEach((c) => {
      L.push('### ' + span(c));
      L.push(factsText(cycleFacts(state, c), false, state));
      L.push('');
    });
    const sofar = cycleFacts(state, now, todayIso);
    if (sofar.txs.length) {
      L.push('## This month so far: ' + reportDate(now.start) + ' – ' + reportDate(todayIso) + ' (day ' + sofar.days + ' of ' + now.days + ')');
      L.push(factsText(sofar, false, state));
      L.push('');
    }
    return { name: 'hisab-se-report-' + todayIso + '.txt', text: L.join('\n') };
  }

  // ---------- investing (personal mode) ----------

  /*
   * Personal mode: the app's owner uses it for themselves, so it can say
   * where to invest. Off, it only sets the amount aside and points to a
   * SEBI-registered adviser (for sharing or publishing the app).
   */
  function personal(state) { return state.settings.personal !== false; }

  // Assumed long-run yearly returns for the projection. Not guaranteed.
  const ASSUMED_RETURN = { equity: 11, debt: 7, gold: 8 };

  // What `monthly` invested every month grows to after `years` at `rate`% a year.
  function sipValue(monthly, rate, years) {
    const i = rate / 1200;
    const n = years * 12;
    return i > 0 ? monthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i) : monthly * n;
  }

  /*
   * Where the Grow budget goes, freedom first:
   * 1. shield: a 30-day emergency fund comes before any investing
   * 2. debt: loans at 15%+ come next (a sure return no investment beats)
   * 3. fund: the emergency fund keeps growing to its target alongside
   * 4. invest: everything is in place
   * The split for money left 5+ years: equity is 100 minus age (60% without
   * an age), moved by risk comfort, between 20% and 85%; gold 10%; the rest
   * debt (PPF, EPF/VPF).
   */
  function investPlan(state, todayIso) {
    const st = state.settings;
    const risk = st.risk === 'low' || st.risk === 'high' ? st.risk : 'medium';
    const age = Number(st.age) || 0;
    const f = freedomDays(state, todayIso);
    const days = f ? f.days : 0;
    const p = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const months = Number(state.savings.emergencyTargetMonths) || 3;
    const target = months * (p.fixedTotal + p.debtMin + p.variableBills + p.flexTotal);
    const fund = Number(state.savings.emergencyBalance) || 0;
    const costly = state.debts.filter((d) => d.balance > 0 && d.rate >= 15).sort((a, b) => b.rate - a.rate);

    let stage = 'invest';
    if (days < 30) stage = 'shield';
    else if (costly.length) stage = 'debt';
    else if (fund < target) stage = 'fund';

    let equity = (age ? Math.min(80, Math.max(30, 100 - age)) : 60) + (risk === 'low' ? -15 : risk === 'high' ? 10 : 0);
    equity = Math.min(85, Math.max(20, equity));
    const gold = 10;
    const debt = 100 - equity - gold;

    const monthly = p.invest;
    const share = (pct) => Math.floor((monthly * pct) / 100 / 100) * 100;
    const amounts = { debt: share(debt), gold: share(gold) };
    amounts.equity = monthly - amounts.debt - amounts.gold;
    const lines = [
      { key: 'equity', pct: equity, amount: amounts.equity, title: tr('Nifty 50 index fund, monthly SIP'),
        detail: tr(risk === 'high' ? 'Direct plan. With high risk comfort, up to a third can go to a Nifty Next 50 or flexi-cap fund.' : 'Direct plan, low cost. Prices will fall at times: keep the SIP going and stay 5+ years.') },
      { key: 'debt', pct: debt, amount: amounts.debt, title: tr('PPF, or VPF through your employer'),
        detail: tr('Government-backed and steady. PPF is tax-free with a 15-year lock-in. Money needed in 1–3 years: FD or RD instead.') },
      { key: 'gold', pct: gold, amount: amounts.gold, title: tr('Gold ETF or gold mutual fund'),
        detail: tr('Balances the rest when markets fall. Better than jewellery: no making charges.') },
    ];
    const blended = (equity * ASSUMED_RETURN.equity + debt * ASSUMED_RETURN.debt + gold * ASSUMED_RETURN.gold) / 100;
    const projection = monthly > 0 ? [5, 10, 20].map((y) => ({ years: y, invested: monthly * 12 * y, value: Math.round(sipValue(monthly, blended, y)) })) : [];

    let reason;
    if (stage === 'shield') reason = tr(days === 1 ? 'First, a 30-day emergency shield: you have {n} day. Investing before it means the next surprise goes on a card.' : 'First, a 30-day emergency shield: you have {n} days. Investing before it means the next surprise goes on a card.', { n: days });
    else if (stage === 'debt') reason = tr('First, clear {name} at {rate}% a year. Paying it off is a sure {rate}% return; no investment reliably beats that.', { name: costly[0].name, rate: costly[0].rate });
    else if (stage === 'fund') reason = tr('Your 30-day shield is up and there are no costly loans. Invest alongside the emergency fund while it grows to its {months}-month target.', { months });
    else reason = tr('Emergency fund full and no costly loans: you’re ready to invest.');

    return { stage, reason, risk, age, equity, debt, gold, monthly, lines, blended: Math.round(blended * 10) / 10, projection, costly: costly[0] || null };
  }

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
    if (!m) return todayIso;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return todayIso;
    const iso = y + '-' + pad(mo) + '-' + pad(d);
    return iso > todayIso && !future ? todayIso : iso;
  }

  function cleanMerchant(raw) {
    let s = String(raw || '').trim();
    if (/^(a\/?c|your|ac|account|card)\b/i.test(s)) return '';
    if (s.indexOf('/') !== -1) {
      const parts = s.split('/').map((p) => p.trim()).filter((p) => p && !/^\d+$/.test(p) && !/^(upi|p2m|p2a|imps|neft)$/i.test(p));
      s = parts.length ? parts[parts.length - 1] : s;
    }
    if (s.indexOf('@') !== -1) s = s.split('@')[0].replace(/[._-]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
    if (!s || /^(a\/?c|your|ac|account|card)\b/i.test(s)) return '';
    return s
      .toLowerCase()
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
      .slice(0, 40);
  }

  function findMerchant(text, type) {
    const patterns = type === 'credit'
      ? [/\bfrom\s+(?:vpa\s+)?([A-Za-z0-9@._&'\/ -]{2,50}?)(?=\s+(?:on|via|ref|upi|txn|for|avl|avbl|to|dt|date)\b|\s*[.,;(]\s|\s*[.,;]?$)/i, /\b([a-z0-9._-]+@[a-z]+)\b/i]
      : [
        /\binfo[:\s]+([^\s].*?)(?=\.\s|\.$|$|\s+avl)/i,
        /\b(?:to|at|towards)\s+(?:vpa\s+)?([A-Za-z0-9@._&'\/ -]{2,50}?)(?=\s+(?:on|via|ref|upi|txn|for|avl|avbl|from|using|dt|date|received)\b|\s*[.,;(]\s|\s*[.,;]?$)/i,
        /\bon\s+([A-Z][A-Z0-9 &'-]{2,30})(?=\s*[.,]|\s+avl)/,
        /\b([a-z0-9._-]+@[a-z]+)\b/i,
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
  const CARD_HINT = /credit card|\bcc\b|card\s*(?:no\.?|number|ending|xx|\*{2})|avl\.?\s*limit|available\s*limit|avail\.?\s*lmt/i;
  const DEBIT_CARD = /debit card/i;
  const STATEMENT = /\b(?:statement|stmt)\b/i;
  const TOTAL_DUE = /total\s*(?:amount|amt\.?)?\s*due\s*(?:is|of|:|-)?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const MIN_DUE = /min(?:imum)?\.?\s*(?:amount|amt\.?)?\s*due\s*(?:is|of|:|-)?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const DUE_DATE = /due\s*(?:date|by|on)\s*(?:is|:|-)?\s*(\d{1,2}[-\/ ]?(?:[a-z]{3,9}|\d{1,2})[-\/ ,]*\d{2,4})/i;
  // `(?:(?!\.\s).)` is any character within the same sentence (amounts like 8,400.00 have dots).
  const CARD_PAYMENT = /(?:payment|pymt)(?:(?!\.\s).){0,50}(?:received|credited|successful|processed)|(?:received|credited)(?:(?!\.\s).){0,40}(?:payment|pymt)|thank you for (?:the |your )?payment|towards(?:(?!\.\s).){0,40}credit card|credit card(?:(?!\.\s).){0,30}(?:bill|payment)/i;

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
    if (!t || /\botp\b|one time password|verification code/i.test(t)) return null;
    const amt = t.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (!amt) return null;
    const amount = Math.round(parseFloat(amt[1].replace(/,/g, '')));
    if (!amount) return null;
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
      return { type: 'cardpayment', amount, last4: cardLast4(t), merchant: 'Card bill payment', category: 'Bills', date: parseSmsDate(t, todayIso), raw: t };
    }
    const isDebit = /\b(debited|spent|paid|sent|withdrawn|purchase|debit|payment of)\b/i.test(t);
    const isCredit = /\b(credited|received|deposited|refund(?:ed)?)\b/i.test(t);
    if (!isDebit && !isCredit) return null;
    const type = isDebit ? 'debit' : 'credit';
    const merchant = findMerchant(t, type);
    const onCard = CARD_HINT.test(t) && !DEBIT_CARD.test(t);
    const paidFrom = onCard ? 'card' : 'account';
    const last4 = onCard ? cardLast4(t) : null;
    if (type === 'credit') {
      return {
        type,
        amount,
        merchant: merchant || 'Money received',
        date: parseSmsDate(t, todayIso),
        category: /refund|reversal|reversed|cashback/i.test(t) ? 'Refund' : 'Money received',
        salary: /\bsal(ary)?\b|payroll/i.test(t),
        paidFrom, last4,
        raw: t,
      };
    }
    return {
      type,
      amount,
      merchant: merchant || 'Bank payment',
      date: parseSmsDate(t, todayIso),
      category: categorize(merchant || t, rules),
      paidFrom, last4,
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
    spendInRange, incomeInRange, incomeKept, isIncome, isMove, isBillPayment, isFlexible, incomeOptions,
    salaryFor, salaryHistory, paydayReset, suggestUse, freedomDays, interestLeak, nextPaydayPreview,
    billShare, billPot, billsMonthly, billPaidIn, billDue, payBill, undoBillPayment, zoneStatus, ESSENTIAL_CATEGORIES,
    isCardTransfer, statementOn, dueAfter, cardOwedAt, cardReserve, cardStatus, emiQuote, revolveQuote, cardBillPlan,
    recordCardPayment, convertCardBalance, answerCardDue, cardLateFee, cardRate, CARD_RATE, undoCardConvert, cardFreeDays, byCategory, DEFAULT_SPLIT,
    isLoanCredit, borrowedThisCycle, borrowCheck, rolloverOptions, personal, investPlan, sipValue, ASSUMED_RETURN, setTranslator,
    payoffOrder, tickDebts, debtJourney, lenderTasks, lastBorrowed,
    monthReport, aiReport, LEAKS, leakNames, leakOf, leakSummary, leakSuggestions, spendWhere, spendWhen, spendTrend, BASICS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
