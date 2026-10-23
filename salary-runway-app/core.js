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

  // The month's money, line by line, with any emergency adjustments applied.
  function monthlyPlan(state, todayIso) {
    const adj = activeAdjustment(state, todayIso);
    const sv = state.savings;
    const salary = Number(state.settings.salary) || 0;
    const fixedTotal = sum(state.fixed, (f) => Number(f.amount) || 0);
    const debtMin = sum(state.debts.filter((d) => d.balance > 0), (d) => Number(d.minPayment) || 0);
    const emergency = Number(sv.emergencyMonthly) || 0;
    const invest = adj && adj.pauseInvest ? 0 : Number(sv.investMonthly) || 0;
    const debtExtra = adj && adj.pauseDebtExtra ? 0 : Number(sv.debtExtra) || 0;
    const sinking = sum(state.sinking, sinkingMonthly);
    const cut = adj ? adj.flexCutPct : 0;
    const budgets = state.budgets.map((b) => ({
      name: b.name,
      base: Number(b.amount) || 0,
      amount: Math.round((Number(b.amount) || 0) * (1 - cut / 100)),
    }));
    const flexTotal = sum(budgets, (b) => b.amount);
    const savingsTotal = emergency + invest + debtExtra + sinking;
    const allocated = fixedTotal + debtMin + savingsTotal + flexTotal;
    return {
      salary, fixedTotal, debtMin, emergency, invest, debtExtra, sinking,
      budgets, flexTotal, savingsTotal, allocated,
      unallocated: salary - allocated,
      adjustment: adj,
    };
  }

  // Payments (fixed bills and debt minimums) that fall inside the cycle, by date.
  function cycleEvents(state, cycle) {
    const events = [];
    state.fixed.forEach((f) => {
      const date = occurrenceInCycle(Number(f.dueDay) || 1, cycle);
      if (date) events.push({ date, name: f.name, amount: Number(f.amount) || 0, kind: 'fixed' });
    });
    state.debts.filter((d) => d.balance > 0).forEach((d) => {
      const date = occurrenceInCycle(Number(d.dueDay) || 1, cycle);
      if (date) events.push({ date, name: d.name, amount: Number(d.minPayment) || 0, kind: 'debt' });
    });
    return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function spendInRange(transactions, cycle) {
    return transactions.filter((t) => inCycle(t.date, cycle));
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
   */
  function projectRunway(state, todayIso) {
    const cycle = cycleFor(todayIso, Number(state.settings.payday) || 1);
    const plan = monthlyPlan(state, todayIso);
    const events = cycleEvents(state, cycle);
    const txns = spendInRange(state.transactions, cycle);
    const idxToday = daysBetween(cycle.start, todayIso);
    const N = cycle.days;

    const spendByDate = {};
    txns.forEach((t) => { spendByDate[t.date] = (spendByDate[t.date] || 0) + t.amount; });
    const eventsByDate = {};
    events.forEach((e) => { eventsByDate[e.date] = (eventsByDate[e.date] || 0) + e.amount; });

    const pastTxns = txns.filter((t) => t.date <= todayIso);
    const spentToDate = sum(pastTxns, (t) => t.amount);
    const spentToday = sum(pastTxns.filter((t) => t.date === todayIso), (t) => t.amount);
    const paceSpend = sum(
      pastTxns.filter((t) => NON_PACE_CATEGORIES.indexOf(t.category) === -1),
      (t) => t.amount
    );
    const daysElapsed = idxToday + 1;
    const remainingDays = N - 1 - idxToday;
    const paceRate = daysElapsed >= 3 && paceSpend > 0 ? paceSpend / daysElapsed : plan.flexTotal / N;
    const flexLeft = Math.max(0, plan.flexTotal - paceSpend);
    const planRate = remainingDays > 0 ? flexLeft / remainingDays : 0;
    const dailyAllowance = Math.max(0, plan.flexTotal - (paceSpend - spentToday)) / (remainingDays + 1);

    const points = [];
    let bal = plan.salary - plan.savingsTotal;
    let pace = 0;
    let planned = 0;
    for (let i = 0; i < N; i++) {
      const date = addDays(cycle.start, i);
      const out = eventsByDate[date] || 0;
      if (i <= idxToday) {
        bal -= out + (spendByDate[date] || 0);
        pace = planned = bal;
        points.push({ date, actual: bal, pace: i === idxToday ? bal : null, plan: i === idxToday ? bal : null });
      } else {
        pace -= out + paceRate;
        planned -= out + planRate;
        points.push({ date, actual: null, pace, plan: planned });
      }
    }

    const firstBelowZero = (key) => {
      for (const p of points) {
        const v = p.actual !== null ? p.actual : p[key];
        if (v < 0) return p.date;
      }
      return null;
    };

    const last = points[points.length - 1];
    return {
      cycle, plan, events, points, idxToday, remainingDays,
      spentToDate, spentToday, flexLeft, paceRate, planRate, dailyAllowance,
      balanceToday: points[idxToday].actual,
      zeroPace: firstBelowZero('pace'),
      zeroPlan: firstBelowZero('plan'),
      endPace: last.actual !== null ? last.actual : last.pace,
      endPlan: last.actual !== null ? last.actual : last.plan,
    };
  }

  // ---------- suggestions ----------

  const DEFAULT_SPLIT = [
    ['Groceries', 30], ['Food & dining', 15], ['Travel', 15], ['Shopping', 10],
    ['Entertainment', 10], ['Health', 5], ['Personal care', 5], ['Misc', 10],
  ];

  /*
   * A starting plan from the user's own numbers. Budgeting only: it decides
   * how much to set aside, never what to invest it in.
   */
  function suggestPlan(state) {
    const salary = Number(state.settings.salary) || 0;
    const fixed = sum(state.fixed, (f) => Number(f.amount) || 0);
    const mins = sum(state.debts.filter((d) => d.balance > 0), (d) => Number(d.minPayment) || 0);
    const sinking = sum(state.sinking, sinkingMonthly);
    const available = salary - fixed - mins - sinking;
    const notes = [];
    if (available <= 0) {
      return {
        ok: false,
        notes: ['Your fixed payments, debt minimums and yearly costs already use the whole salary. Start with the Debts tab to see what clearing the costliest loan frees up.'],
      };
    }

    const expensive = state.debts.filter((d) => d.balance > 0 && d.rate >= 15);
    const currentFlex = sum(state.budgets, (b) => Number(b.amount) || 0);
    const monthlyNeeds = fixed + mins + (currentFlex || available * 0.6);
    const target = (Number(state.savings.emergencyTargetMonths) || 3) * monthlyNeeds;
    const fundFull = (Number(state.savings.emergencyBalance) || 0) >= target;

    const pool = round100(Math.min(salary * 0.2, available * 0.35));
    let emergency = 0;
    let invest = 0;
    let debtExtra = 0;
    if (!fundFull) emergency = round100(pool * (expensive.length ? 0.4 : 0.6));
    const rest = pool - emergency;
    if (expensive.length) {
      debtExtra = rest;
      const monthlyInterest = sum(expensive, (d) => (d.balance * d.rate) / 1200);
      notes.push(
        'Your ' + expensive.map((d) => d.name).join(' and ') + (expensive.length > 1 ? ' cost' : ' costs') + ' about ₹' +
        Math.round(monthlyInterest).toLocaleString('en-IN') +
        ' a month in interest, so the extra goes there first. The Grow budget starts once they are cleared.'
      );
    } else {
      invest = rest;
    }
    if (!fundFull) notes.push('Emergency fund target: ₹' + Math.round(target).toLocaleString('en-IN') + ' (' + (state.savings.emergencyTargetMonths || 3) + ' months of needs).');

    const flexPool = available - pool;
    const weights = currentFlex > 0
      ? state.budgets.map((b) => [b.name, Number(b.amount) || 0])
      : DEFAULT_SPLIT;
    const wTotal = sum(weights, (w) => w[1]);
    const budgets = weights.map(([name, w]) => ({ name, amount: round100((flexPool * w) / wTotal) }));
    return { ok: true, emergencyMonthly: emergency, investMonthly: invest, debtExtra, budgets, notes, emergencyTarget: target };
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
    const budgetMap = {};
    state.budgets.forEach((b) => { budgetMap[b.name] = Number(b.amount) || 0; });

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
      const steady = state.budgets.filter((b) => {
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
    const flexCut = Math.round((sum(state.budgets, (b) => Number(b.amount) || 0) * cutPct) / 100);
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

  // ---------- bank SMS parsing ----------

  const CATEGORY_KEYWORDS = [
    ['Food & dining', ['swiggy', 'zomato', 'eatsure', 'dominos', 'pizza', 'mcdonald', 'kfc', 'cafe', 'restaurant', 'starbucks', 'chai']],
    ['Groceries', ['bigbasket', 'blinkit', 'zepto', 'dmart', 'jiomart', 'grofers', 'reliance fresh', 'more retail', 'kirana', 'instamart', 'grocery']],
    ['Travel', ['uber', 'ola', 'rapido', 'irctc', 'redbus', 'makemytrip', 'indigo', 'petrol', 'fuel', 'hpcl', 'iocl', 'bpcl', 'metro', 'fastag']],
    ['Shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'decathlon', 'croma']],
    ['Entertainment', ['netflix', 'spotify', 'hotstar', 'prime video', 'bookmyshow', 'pvr', 'inox', 'youtube', 'sonyliv']],
    ['Health', ['pharmacy', 'apollo', 'medplus', '1mg', 'pharmeasy', 'hospital', 'clinic', 'diagnostic', 'netmeds']],
    ['Personal care', ['salon', 'urban company', 'urbanclap', 'spa', 'barber']],
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

  function parseSmsDate(text, todayIso) {
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
    return iso > todayIso ? todayIso : iso;
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

  function findMerchant(text) {
    const patterns = [
      /\binfo[:\s]+([^\s].*?)(?=\.\s|\.$|$|\s+avl)/i,
      /\b(?:to|at|towards)\s+(?:vpa\s+)?([A-Za-z0-9@._&'\/ -]{2,50}?)(?=\s+(?:on|via|ref|upi|txn|for|avl|avbl|from|using|dt|date)\b|\s*[.,;(]\s|\s*[.,;]?$)/i,
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
  function parseSms(text, rules, todayIso) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || /\botp\b|one time password|verification code/i.test(t)) return null;
    const amt = t.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (!amt) return null;
    const amount = Math.round(parseFloat(amt[1].replace(/,/g, '')));
    if (!amount) return null;
    const isDebit = /\b(debited|spent|paid|sent|withdrawn|purchase|debit|payment of)\b/i.test(t);
    const isCredit = /\b(credited|received|deposited|refund(?:ed)?)\b/i.test(t);
    if (!isDebit && !isCredit) return null;
    const type = isDebit ? 'debit' : 'credit';
    const merchant = findMerchant(t);
    return {
      type,
      amount,
      merchant: merchant || 'Bank payment',
      date: parseSmsDate(t, todayIso),
      category: categorize(merchant || t, rules),
      raw: t,
    };
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
    occurrenceInCycle, monthlyPlan, cycleEvents, projectRunway, suggestPlan,
    insights, simulateDebts, compareDebtPlans, emergencyPlan, parseSms,
    splitSmsBatch, categorize, normalizeMerchant, sinkingMonthly, inCycle,
    spendInRange, byCategory, DEFAULT_SPLIT,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
