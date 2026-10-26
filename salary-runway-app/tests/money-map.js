/*
 * The money map: every kind of entry the app records, and every number it
 * shows (balance, today's limit, spending, budgets, income, net worth, funds,
 * goals, loans, People, the card, kept money, wallets, days of freedom,
 * payday). Used by tests/money-map.test.js (what each entry does to each
 * number) and scripts/money-map-app.js (in the app: deleting an entry puts
 * every number back, doubling its amount doubles what it did).
 * Made-up data only. Each kind is recorded the way the app records it.
 */
(function (root) {
  const Core = root.Core || require('../core.js');
  const T = '2026-10-26';
  function base() {
    return {
      settings: { salary: 98000, payday: 28 },
      fixed: [{ id: 'rent', name: 'Rent', amount: 22000, dueDay: 28 }],
      debts: [
        { id: 'pl', name: 'Personal loan', balance: 500000, rate: 11, minPayment: 15000, dueDay: 7, emiThrough: '2026-10-07' },
        { id: 'cemi', name: 'Card EMI', balance: 24000, rate: 22.44, minPayment: 6010, dueDay: 3, viaCard: 'c1', emisLeft: 4, emiThrough: '2026-10-03' },
      ],
      budgets: ['Groceries', 'Food & dining', 'Travel', 'Shopping', 'Health', 'Misc'].map((name, i) => ({ id: 'b' + i, name, amount: 0, auto: true })),
      bills: [{ id: 'elec', name: 'Electricity', estimate: 1200, everyMonths: 1, nextDue: '2026-11-10', history: [1200] }],
      savings: { auto: true, emergencyBalance: 1000, emergencyTargetMonths: 6, investSaved: 0, rollovers: [] },
      sinking: [],
      goals: [{ id: 'g1', name: 'Bike', target: 20000, by: '2027-06-01', saved: 0, created: '2026-10-01' }],
      cards: [{ id: 'c1', name: 'HDFC card', last4: '6645', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-20', setupStatement: 6010, setupDueDate: '2026-11-03' }],
      wallets: [{ id: 'cash', name: 'Cash', kind: 'cash', created: '2026-10-20', check: { date: '2026-10-23', amount: 500 } }],
      transactions: [{ id: 'food', date: '2026-10-24', amount: 300, category: 'Food & dining', note: 'Canteen' }],
      merchantRules: {}, adjustment: null,
      balanceCheck: { date: '2026-10-23', amount: 20000 },
    };
  }
  const X = (s, t) => s.transactions.push(Object.assign({ id: 'x', date: T, source: 'manual' }, t));
  const kinds = {
    'spend (account)': (s) => X(s, { amount: 500, category: 'Shopping', note: 'Mall' }),
    'spend Family': (s) => X(s, { amount: 500, category: 'Family', note: 'Wife' }),
    'spend on card': (s) => X(s, { amount: 500, category: 'Shopping', note: 'Mall', paidFrom: 'c1' }),
    'spend from cash wallet': (s) => X(s, { amount: 500, category: 'Food & dining', note: 'Tea', wallet: 'cash' }),
    'ATM cash to wallet': (s) => X(s, { kind: 'transfer', amount: 500, from: 'main', to: 'cash', note: 'ATM' }),
    'refund to card': (s) => X(s, { kind: 'in', amount: 500, category: 'Refund', note: 'Amazon', paidFrom: 'c1', useFor: 'spend' }),
    'money in, undecided': (s) => X(s, { kind: 'in', amount: 2000, category: 'Gift', note: 'Dad', useFor: null }),
    'money in → spend': (s) => X(s, { kind: 'in', amount: 2000, category: 'Side income', note: 'Comm', useFor: 'spend' }),
    'money in → emergency': (s) => { X(s, { kind: 'in', amount: 2000, category: 'Gift', note: 'Dad', useFor: 'emergency' }); s.savings.emergencyBalance += 2000; },
    'money in → grow': (s) => { X(s, { kind: 'in', amount: 2000, category: 'Gift', note: 'Dad', useFor: 'grow' }); s.savings.investSaved += 2000; },
    'money in → goal': (s) => { X(s, { kind: 'in', amount: 2000, category: 'Gift', note: 'Dad', useFor: 'goal', goalId: 'g1' }); s.goals[0].saved += 2000; },
    'money in → loan': (s) => { X(s, { kind: 'in', amount: 2000, category: 'Gift', note: 'Dad', useFor: 'debt', debtId: 'pl', debtPaid: 2000 }); s.debts[0].balance -= 2000; },
    'money in → keep': (s) => X(s, { kind: 'in', amount: 2000, category: 'From family', note: 'Father', useFor: 'keep', keepFor: 'Diwali', keepUsed: 0 }),
    'bank loan credit': (s) => X(s, { kind: 'in', amount: 10000, category: 'Loan or Pay Later', note: 'KreditBee', useFor: 'spend', borrowed: true }),
    'save → emergency': (s) => { X(s, { kind: 'move', amount: 100, category: 'Savings', note: 'Jar', useFor: 'emergency' }); s.savings.emergencyBalance += 100; },
    'save → grow': (s) => { X(s, { kind: 'move', amount: 100, category: 'Savings', note: 'SIP', useFor: 'grow' }); s.savings.investSaved += 100; },
    'save → goal': (s) => { X(s, { kind: 'move', amount: 100, category: 'Savings', note: 'Jar', useFor: 'goal', goalId: 'g1' }); s.goals[0].saved += 100; s.goals[0].savedOutside = 100; },
    'save → loan prepay': (s) => { X(s, { kind: 'move', amount: 100, category: 'Savings', note: 'Prepay', useFor: 'debt', debtId: 'pl', debtPaid: 100 }); s.debts[0].balance -= 100; },
    'save, undecided': (s) => X(s, { kind: 'move', amount: 100, category: 'Savings', note: 'Jar', useFor: null }),
    'bill paid (electricity)': (s) => Core.payBill(s, 'elec', 1200, 1, T),
    'card bill paid (its EMI part)': (s) => Core.recordCardPayment(s, 'c1', 6010, T, 'account'),
    'old card bill paid early': { pre: (s) => { s.cards[0].setupStatement = 9010; }, apply: (s) => Core.recordCardPayment(s, 'c1', 3000, T, 'account') },
    'old card bill paid in full': { pre: (s) => { s.cards[0].setupStatement = 9010; }, apply: (s) => Core.recordCardPayment(s, 'c1', 9010, T, 'account') },
    'borrowed from friend': (s) => { X(s, { kind: 'in', amount: 3000, category: 'Money received', note: 'Rahul', useFor: 'spend' }); Core.addIou(s, { name: 'Rahul', dir: 'owe', amount: 3000, txId: 'x' }, T); },
    'lent to friend': (s) => { X(s, { amount: 3000, category: 'Misc', note: 'Amit' }); Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 3000, txId: 'x' }, T); },
    'friend pays back': { pre: (s) => { X(s, { id: 'l0', date: '2026-10-20', amount: 3000, category: 'Misc', note: 'Amit' }); Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 3000, txId: 'l0' }, '2026-10-20'); s.iou[0].id = 'i1'; s.transactions.find((t) => t.id === 'l0').iouId = 'i1'; }, apply: (s) => { X(s, { kind: 'in', amount: 3000, category: 'Money returned', note: 'Amit', useFor: 'spend' }); Core.payIou(s, 'i1', 3000, T, 'x'); } },
    'you pay friend back': { pre: (s) => { X(s, { id: 'b0', date: '2026-10-20', kind: 'in', amount: 3000, category: 'Money received', note: 'Rahul', useFor: 'spend' }); Core.addIou(s, { name: 'Rahul', dir: 'owe', amount: 3000, txId: 'b0' }, '2026-10-20'); s.iou[0].id = 'i1'; s.transactions.find((t) => t.id === 'b0').iouId = 'i1'; },
      apply: (s) => { X(s, { amount: 3000, category: 'Misc', note: 'Rahul' }); Core.payIou(s, 'i1', 3000, T, 'x'); } },
    'passed on (in+out)': (s) => { X(s, { kind: 'in', amount: 26000, category: 'Money received', note: 'Rahul', useFor: null }); X(s, { id: 'y', amount: 26000, category: 'Misc', note: 'Amit' }); Core.passOn(s, 'x', 'y'); },
    'purchase covered by kept': { pre: (s) => X(s, { id: 'k', date: '2026-10-20', kind: 'in', amount: 2000, category: 'From family', note: 'Father', useFor: 'keep', keepFor: 'Diwali', keepUsed: 0 }),
      apply: (s) => { X(s, { amount: 1500, category: 'Shopping', note: 'Croma' }); Core.coverPurchase(s, 'k', 'x'); } },
    'card spend → EMI (6 months)': { pre: (s) => X(s, { id: 'cs', amount: 12000, category: 'Shopping', note: 'Phone', paidFrom: 'c1', date: '2026-10-21' }),
      apply: (s) => Core.convertCardBalance(s, 'c1', 12000, { kind: 'emi', months: 6, rate: 16 }, T) },
    'spend Emergency': (s) => X(s, { amount: 500, category: 'Emergency', note: 'Hospital' }),
    'salary lower (90k)': (s) => { s.payslips = { '2026-09-28': { amount: 90000, usual: 98000 } }; },
    'balance check (−1000)': (s) => { s.balanceCheck = { date: T, amount: 18700 }; },
  };
  const sumv = (a, f) => a.reduce((x, y) => x + (f ? f(y) : y), 0);
  function measure(s) {
    const out = {};
    const m = (k, f) => { try { const v = f(); out[k] = typeof v === 'number' ? Math.round(v) : v; } catch (e) { out[k] = 'ERR:' + e.message.slice(0, 40); } };
    const r = Core.projectRunway(s, T);
    const cyc = r.cycle;
    m('bank', () => r.balanceToday);
    m('limit', () => r.dailyAllowance);
    m('spentToday', () => r.spentToday);
    m('spentCycle', () => r.spentToDate);
    m('daySpent', () => Core.daySpent(s, T));
    m('reports', () => sumv(Core.spendWhere(s, T, 'cycle').categories, (c) => c.spent));
    m('envelopes', () => { const e = Core.budgetEnvelopes(s, T); return sumv(e.list, (b) => b.spent) + sumv(e.others, (b) => b.spent); });
    m('income', () => sumv(Core.incomeInRange(s.transactions, cyc), Core.incomeKept));
    m('worth', () => Core.netWorth(s, T).value);
    m('fund', () => s.savings.emergencyBalance);
    m('grow', () => s.savings.investSaved);
    m('goal', () => Core.goalStatus(s, s.goals[0], T).saved);
    m('loans', () => sumv(s.debts, (d) => Number(d.balance) || 0));
    m('people', () => Core.iouSummary(s, T).net);
    m('cardOwed', () => Core.cardOwedAt(s, s.cards[0], T));
    m('cardReserve', () => Core.cardReserve(s, T));
    m('kept', () => sumv(Core.keptFor(s), (k) => k.left));
    m('zone', () => Core.zoneStatus(s, T, r).zone);
    m('cash', () => { const w = Core.walletBalances(s, T); return (w.wallets || w).find((x) => x.id === 'cash').balance; });
    m('freedom', () => Core.freedomDays(s, T).days);
    m('payday', () => Core.nextPaydayPreview(s, T).effective);
    m('endPace', () => r.endPace);
    return out;
  }
  const api = { T, base, kinds, measure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoneyMap = api;
})(typeof self !== 'undefined' ? self : this);
