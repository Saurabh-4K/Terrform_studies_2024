/*
 * Salary Runway: core calculations.
 *
 * Pure functions only (no DOM, no storage) so they can run in the browser
 * and be tested with Node. Dates are local calendar dates as 'YYYY-MM-DD'.
 */
(function (root) {
  'use strict';

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

  function billPot(b) {
    return billShare(b) * (Math.max(1, Number(b.everyMonths) || 1) - 1);
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
      fromPot: Math.min(amount, billPot(b)),
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
      if (billPaidIn(state, b, cycle)) return;
      if (billDue(b, cycle)) {
        let date = b.nextDue < cycle.start ? cycle.start : b.nextDue;
        if (todayIso && date < todayIso) date = todayIso;
        events.push({ date, name: b.name, amount: Math.max(0, (Number(b.estimate) || 0) - billPot(b)), kind: 'bill', billId: b.id });
      } else if (billShare(b) > 0) {
        events.push({ date: cycle.start, name: 'Set aside for ' + b.name, amount: billShare(b), kind: 'billpot', billId: b.id });
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
    const others = state.transactions.filter((t) => (isBillPayment(t) || isMove(t)) && inCycle(t.date, cycle) && t.date <= todayIso);
    others.forEach((t) => {
      const out = isBillPayment(t) ? t.amount - (Number(t.fromPot) || 0) : t.amount;
      spendByDate[t.date] = (spendByDate[t.date] || 0) + out;
    });
    // Unspent money moved out counts as used, so later days keep their planned amount.
    const moved = sum(others.filter((t) => isMove(t) && (!anchor || t.date >= anchor.date)), (t) => t.amount);
    const eventsByDate = {};
    events.forEach((e) => { eventsByDate[e.date] = (eventsByDate[e.date] || 0) + e.amount; });

    const pastTxns = txns.filter((t) => t.date <= todayIso);
    const spentToDate = sum(pastTxns, (t) => t.amount);
    const spentToday = sum(pastTxns.filter((t) => t.date === todayIso), (t) => t.amount);
    const paceSpend = sum(
      pastTxns.filter((t) => NON_PACE_CATEGORIES.indexOf(t.category) === -1 && (!anchor || t.date >= anchor.date)),
      (t) => t.amount
    );
    const daysElapsed = idxToday - aIdx + 1;
    const remainingDays = N - 1 - idxToday;
    // With a balance check, extra money is shared over the days from that check.
    const dailyBudget = plan.flexTotal / N + (anchor ? (extraIn - moved) / (N - aIdx) : 0);
    const paceRate = daysElapsed >= 3 && paceSpend > 0 ? paceSpend / daysElapsed : plan.flexTotal / N;
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
    const byMoney = Math.max(0, bal + spentToday - billsAhead) / (remainingDays + 1);
    const byBudget = anchor
      ? dailyBudget
      : Math.max(0, plan.flexTotal + extraIn - moved - (paceSpend - spentToday)) / (remainingDays + 1);
    const dailyAllowance = Math.min(byMoney, byBudget);
    // What is left of today's amount, and tomorrow's amount once today is counted.
    const leftToday = Math.max(0, dailyAllowance - spentToday);
    const overToday = Math.max(0, spentToday - dailyAllowance);
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
      cycle, plan, events, points, idxToday, remainingDays, anchor, anchorIdx: anchor ? aIdx : null,
      spentToDate, spentToday, flexLeft, extraIn, moved, billsAhead, paceRate, planRate, dailyAllowance, leftToday, overToday, tomorrowAllowance,
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
    const rate = Number(card.rate) || 42;
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
      reason = 'Nothing to pay on this bill.';
    } else if (!short) {
      suggested = 'full';
      reason = 'You’ve already kept this money aside: card spending was counted when it happened. Paying in full costs no interest.';
    } else if (compare && compare.emiSaves >= Math.max(200, compare.revolve.cost * 0.1)) {
      suggested = 'emi';
      reason = 'You’re ' + rupees(short) + ' short this month. Pay ' + rupees(payNow) + ' now and convert ' + rupees(rest) +
        ' to an EMI: it costs about ' + rupees(compare.emiSaves) + ' less than carrying it on the card. It’s still a loan, so clear it as early as you can.';
    } else {
      suggested = 'part';
      reason = 'You’re ' + rupees(short) + ' short this month. Pay ' + rupees(payNow) + ' now and the rest as soon as you can; an EMI wouldn’t save much here.';
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
      debt = { id: newId('d'), name: card.name + ' carried balance', balance: amount, rate: Number(card.rate) || 42, minPayment: Math.max(200, Math.round(amount * 0.05)), dueDay: card.dueDay, fromCard: card.id, starts };
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
      if (salary > 0) notes.push('Fixed payments, debt minimums and yearly costs already use the whole salary, so nothing can be set aside yet. The Debts tab shows what clearing the costliest loan frees up.');
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
      notes.push(
        'Your ' + expensive.map((d) => d.name).join(' and ') + (expensive.length > 1 ? ' cost' : ' costs') + ' about ₹' +
        Math.round(monthlyInterest).toLocaleString('en-IN') +
        ' a month in interest, so the extra goes there first. The Grow budget starts once ' + (expensive.length > 1 ? 'they are' : 'it is') + ' cleared.'
      );
    } else {
      invest = pool - emergency;
    }
    if (!fundFull) notes.push('The emergency fund gets money until it reaches ₹' + Math.round(target).toLocaleString('en-IN') + ' (' + months + ' months of needs).');
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
    const savings = sv.auto
      ? autoSavings(state, todayIso)
      : {
        emergencyMonthly: Number(sv.emergencyMonthly) || 0,
        investMonthly: Number(sv.investMonthly) || 0,
        debtExtra: Number(sv.debtExtra) || 0,
        notes: [],
      };
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
    return { savings, budgets, pool, autoPool, customTotal };
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
          title: d.name + ' costs about ' + rupees(interest) + ' a month in interest',
          body: 'That is ' + rupees(interest * 12) + ' a year at ' + d.rate + '% a year. The Debts tab shows how much an extra payment saves.',
        });
      }
    });

    if (!cycles.length) {
      out.push({ level: 'info', title: 'Trends appear after your first full month', body: 'Keep adding spending (or import bank SMS) and this section will show where your money goes.' });
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
          title: cat + ' averages ' + rupees(avg) + ' a month against a ' + rupees(budget) + ' budget',
          body: 'That is ' + rupees(avg - budget) + ' more each month, or ' + rupees((avg - budget) * 12) + ' a year.',
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
        const names = steady.length > 1 ? steady.slice(0, -1).join(', ') + ' and ' + steady[steady.length - 1] : steady[0];
        out.push({ level: 'good', title: names + ' stayed within budget for ' + n + ' months', body: 'Whatever is left in these at month end can go to a goal.' });
      }
    }

    // Many small payments.
    Object.keys(totals).forEach((cat) => {
      const small = all.filter((t) => t.category === cat && t.amount <= 300);
      const perMonth = small.length / n;
      if (perMonth >= 8) {
        out.push({
          level: 'info',
          title: Math.round(perMonth) + ' small ' + cat + ' payments a month add up to ' + rupees(sum(small, (t) => t.amount) / n),
          body: 'Payments under ₹300 are easy to miss. Halving them would free about ' + rupees(sum(small, (t) => t.amount) / n / 2) + ' a month.',
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
          title: g[0].t.note + ' looks like a subscription: ' + rupees(median) + ' a month',
          body: 'That is ' + rupees(median * 12) + ' a year. Still using it?',
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
          title: 'A weekend day costs ' + ratio.toFixed(1) + '× a weekday',
          body: 'Average ' + rupees(weekendSpend / weekendDays) + ' per weekend day vs ' + rupees(weekdaySpend / weekdayDays) + ' on weekdays.',
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
        title: Math.round((firstWeek / allTotal) * 100) + '% of your spending happens in the week after payday',
        body: 'Spending feels easy when the account is full. The daily "safe to spend" figure on this screen helps even it out.',
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

  function compareDebtPlans(debts, extra) {
    return {
      minimum: simulateDebts(debts, 0, 'avalanche', false),
      avalanche: simulateDebts(debts, extra, 'avalanche', true),
      snowball: simulateDebts(debts, extra, 'snowball', true),
    };
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

    const lasts = (r) => (r.zeroPace ? 'lasts until ' + shortDate(r.zeroPace) : 'lasts until payday');
    let spendDetail = 'Adds ' + rupeesIn(amount) + ' to this month’s spending money. Today’s amount goes from ' +
      rupeesIn(without.dailyAllowance) + ' to ' + rupeesIn(kept.dailyAllowance) + '.';
    if (without.zeroPace !== kept.zeroPace) spendDetail += ' At this pace your money ' + lasts(kept) + ' instead of ' + (without.zeroPace ? shortDate(without.zeroPace) : 'payday') + '.';
    options.push({ use: 'spend', title: 'Keep it for this month', detail: spendDetail });

    options.push({
      use: 'emergency',
      title: 'Add to emergency fund',
      detail: 'Emergency fund goes from ' + rupeesIn(fund) + ' to ' + rupeesIn(fund + amount) + ' of your ' + rupeesIn(target) + ' target.',
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
        title: 'Pay off ' + top.name,
        debtId: top.id,
        detail: 'Pays ' + rupeesIn(paid) + ' off ' + top.name + ' (' + top.rate + '% a year)' +
          (before.neverPaysOff ? '.' : '. Saves about ' + rupeesIn(saved) + ' in interest' + (sooner > 0 ? ' and you’re debt-free ' + sooner + (sooner === 1 ? ' month' : ' months') + ' sooner.' : '.')) +
          (paid < amount ? ' The other ' + rupeesIn(amount - paid) + ' stays for this month.' : ''),
      });
    }

    options.push({
      use: 'grow',
      title: 'Set aside to invest',
      detail: 'Adds to the ' + rupeesIn(Number(state.savings.investSaved) || 0) + ' you’ve set aside to invest. Talk to a SEBI-registered investment adviser before investing it.',
    });

    const s = suggestUse(state, todayIso, without.zeroPace ? 'Without this money, at your current pace you run out on ' + shortDate(without.zeroPace) + ', before payday.' : null);
    // Keeping it while an expensive loan is open has a cost worth seeing.
    if (top && top.rate >= 15) options[0].badge = 'Extends this month’s budget, but delays your debt-free date';
    return { tx, options, recommended: s.use, reason: s.reason, interestSaved: saved };
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
      return { use: 'emergency', reason: 'Your emergency fund covers ' + days + (days === 1 ? ' day' : ' days') + ' of basics. A 30-day shield comes first, so the next surprise doesn’t go on a card.' };
    }
    if (top && top.rate >= 15) {
      return { use: 'debt', reason: top.name + ' charges ' + top.rate + '% a year. Paying it down saves that interest for certain.', debtId: top.id };
    }
    const p = monthlyPlan(Object.assign({}, state, { adjustment: null }), todayIso);
    const target = (Number(state.savings.emergencyTargetMonths) || 3) * (p.fixedTotal + p.debtMin + p.variableBills + p.flexTotal);
    if ((Number(state.savings.emergencyBalance) || 0) < target) {
      return { use: 'emergency', reason: 'Your emergency fund is still below its ' + (state.savings.emergencyTargetMonths || 3) + '-month target.' };
    }
    return { use: 'grow', reason: 'This month is covered, your emergency fund is full and there are no expensive loans.' };
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
    const badge = days === 0 ? 'Unprotected' : days <= 14 ? 'Starter shield' : days <= 89 ? 'Incident proof' : 'Unshakeable';
    return { days, daily, needs, fund, badge };
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
      if (st.overdue) items.push({ name: c.name + ' (overdue bill)', balance: st.remaining, rate: Number(c.rate) || 42 });
    });
    items.forEach((x) => { x.daily = (x.balance * x.rate) / 36500; });
    const daily = sum(items, (x) => x.daily);
    return { daily, monthly: daily * 30, items, high: items.some((x) => x.rate >= 15 && x.balance > 0) };
  }

  /*
   * Next payday, after what this month's money can't cover. Card spending
   * was already taken from this month, so only these are subtracted:
   * - this month's shortfall at the current pace (it ends up borrowed)
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
  ];

  function categorize(text, rules) {
    const key = normalizeMerchant(text);
    if (rules && key && rules[key]) return rules[key];
    const lower = String(text || '').toLowerCase();
    for (const [cat, words] of CATEGORY_KEYWORDS) {
      if (words.some((w) => lower.indexOf(w) !== -1)) return cat;
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
    insights, simulateDebts, compareDebtPlans, emergencyPlan, parseSms,
    splitSmsBatch, smsKey, categorize, normalizeMerchant, sinkingMonthly, inCycle,
    spendInRange, incomeInRange, incomeKept, isIncome, isMove, isBillPayment, isFlexible, incomeOptions,
    salaryFor, salaryHistory, suggestUse, freedomDays, interestLeak, nextPaydayPreview,
    billShare, billPot, billsMonthly, billPaidIn, billDue, payBill, undoBillPayment, zoneStatus, ESSENTIAL_CATEGORIES,
    isCardTransfer, statementOn, dueAfter, cardOwedAt, cardReserve, cardStatus, emiQuote, revolveQuote, cardBillPlan,
    recordCardPayment, convertCardBalance, undoCardConvert, cardFreeDays, byCategory, DEFAULT_SPLIT,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
