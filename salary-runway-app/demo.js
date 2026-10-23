/*
 * Example data: a ₹55,000 salary with rent, a bike EMI, a credit card and a
 * personal loan, plus about four months of spending generated around today.
 */
(function (root) {
  'use strict';

  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core;

  // Small seeded random so the example looks the same on every load.
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  let n = 0;
  function id(prefix) { n++; return prefix + n; }

  const SPENDS = [
    // category, merchants, typical amount range, chance per weekday, chance per weekend day
    ['Groceries', ['Blinkit', 'Zepto', 'DMart', 'Local kirana'], [180, 900], 0.32, 0.5],
    ['Food & dining', ['Swiggy', 'Zomato', 'Chai point', 'Dominos'], [120, 520], 0.38, 0.75],
    ['Travel', ['Uber', 'Rapido', 'Petrol pump', 'Metro card'], [60, 450], 0.38, 0.35],
    ['Shopping', ['Amazon', 'Flipkart', 'Myntra'], [300, 1800], 0.05, 0.12],
    ['Entertainment', ['BookMyShow', 'PVR', 'Friends night out'], [300, 1400], 0.03, 0.18],
    ['Health', ['Apollo Pharmacy', 'MedPlus'], [150, 600], 0.04, 0.04],
    ['Personal care', ['Salon', 'Urban Company'], [250, 700], 0.02, 0.06],
    ['Misc', ['Bank payment', 'Gift', 'Stationery'], [100, 600], 0.06, 0.08],
  ];

  function transactionsFor(cycle, upTo, rand, intensity) {
    const out = [];
    for (let i = 0; i < cycle.days; i++) {
      const date = Core.addDays(cycle.start, i);
      if (date > upTo) break;
      const dow = Core.parseISO(date).getDay();
      const weekend = dow === 0 || dow === 6;
      // Spending runs hotter in the first week after payday.
      const boost = (i < 7 ? 1.35 : 1) * intensity;
      SPENDS.forEach(([cat, shops, [lo, hi], pWeek, pWeekend]) => {
        if (rand() < (weekend ? pWeekend : pWeek) * boost) {
          out.push({
            id: id('t'),
            date,
            amount: Math.round((lo + rand() * (hi - lo)) / 10) * 10,
            category: cat,
            note: shops[Math.floor(rand() * shops.length)],
            source: 'manual',
          });
        }
      });
    }
    const netflix = Core.addDays(cycle.start, 3);
    if (netflix <= upTo) out.push({ id: id('t'), date: netflix, amount: 649, category: 'Entertainment', note: 'Netflix', source: 'sms' });
    return out;
  }

  function demoState(todayIso) {
    n = 0;
    const rand = rng(20261023);
    const state = {
      version: 1,
      isDemo: true,
      settings: { salary: 55000, payday: 1, name: 'Example' },
      fixed: [
        { id: id('f'), name: 'Rent', amount: 15000, dueDay: 5 },
        { id: id('f'), name: 'Bike EMI', amount: 3200, dueDay: 10 },
      ],
      bills: [],
      debts: [
        { id: id('d'), name: 'Credit card', balance: 85000, rate: 42, minPayment: 4250, dueDay: 20 },
        { id: id('d'), name: 'Personal loan', balance: 120000, rate: 14, minPayment: 4100, dueDay: 7 },
      ],
      budgets: [
        { id: id('b'), name: 'Groceries', amount: 0, auto: true },
        { id: id('b'), name: 'Food & dining', amount: 0, auto: true },
        { id: id('b'), name: 'Travel', amount: 0, auto: true },
        { id: id('b'), name: 'Shopping', amount: 0, auto: true },
        { id: id('b'), name: 'Entertainment', amount: 0, auto: true },
        { id: id('b'), name: 'Health', amount: 0, auto: true },
        { id: id('b'), name: 'Personal care', amount: 0, auto: true },
        { id: id('b'), name: 'Misc', amount: 0, auto: true },
      ],
      savings: {
        auto: false,
        emergencyMonthly: 1500,
        investMonthly: 0,
        debtExtra: 2000,
        emergencyBalance: 8000,
        emergencyTargetMonths: 3,
        investSaved: 0,
      },
      sinking: [
        { id: id('s'), name: 'Diwali & gifts', amount: 12000, month: 11, saved: 9000 },
        { id: id('s'), name: 'Bike service & insurance', amount: 6000, month: 3, saved: 3500 },
      ],
      transactions: [],
      merchantRules: {},
      emergencies: [],
      adjustment: null,
      savingsRecorded: [],
    };

    const current = Core.cycleFor(todayIso, state.settings.payday);
    // Bills that vary: electricity monthly, a 3-month mobile recharge due next cycle.
    state.bills.push(
      { id: id('v'), name: 'Electricity', estimate: 1300, everyMonths: 1, nextDue: Core.addDays(current.start, 14), history: [1240, 1410, 1250] },
      { id: id('v'), name: 'Mobile recharge', estimate: 899, everyMonths: 3, nextDue: Core.addDays(current.next, 11), history: [300, 300] }
    );
    const electricityDue = state.bills[0].nextDue;
    if (electricityDue <= todayIso) Core.payBill(state, state.bills[0].id, 1342, 1, electricityDue);
    let c = current;
    const cycles = [];
    for (let k = 0; k < 4; k++) { c = Core.previousCycle(c, state.settings.payday); cycles.unshift(c); }
    cycles.forEach((cy) => { state.transactions.push.apply(state.transactions, transactionsFor(cy, todayIso, rand, 1)); });
    state.transactions.push.apply(state.transactions, transactionsFor(current, todayIso, rand, 1.12));
    state.transactions.sort((a, b) => (a.date < b.date ? 1 : -1));
    return state;
  }

  const Demo = { demoState };
  if (typeof module !== 'undefined' && module.exports) module.exports = Demo;
  else root.Demo = Demo;
})(typeof self !== 'undefined' ? self : this);
