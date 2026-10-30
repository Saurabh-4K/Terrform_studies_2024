// Connections: each real payment recorded both ways, by hand (as its button does it) and
// by its bank SMS (through the app's SMS reader), in both orders. Each must count once:
// one entry, the balance, spending and People moving as they should.
//   npm run build && node scripts/connections-app.js
// Made-up data only. Needs Playwright.
const fs = require('fs'); const path = require('path'); const http = require('http');
let playwright;
try { playwright = require('playwright'); } catch (e) {
  playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
}
const www = path.join(__dirname, '..', 'www');
const Core = require(path.join(__dirname, '..', 'core.js'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(www, req.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const T = '2026-10-20';
function base() {
  return {
    version: 1, settings: { salary: 90000, payday: 1, mainLast4: '1234' },
    fixed: [{ id: 'rent', name: 'Rent', amount: 22000, dueDay: 21 }],
    debts: [{ id: 'pl', name: 'Personal loan', balance: 300000, rate: 12, minPayment: 15000, dueDay: 22 }],
    bills: [{ id: 'elec', name: 'Electricity', estimate: 1200, everyMonths: 1, nextDue: '2026-10-25', history: [1200] }],
    cards: [{ id: 'c1', name: 'HDFC card', last4: '6645', limit: 90000, statementDay: 14, dueDay: 3, created: '2026-10-01' }],
    wallets: [{ id: 'cash', name: 'Cash', kind: 'cash', created: '2026-10-01', check: { date: '2026-10-18', amount: 500 } },
      { id: 'sbi', name: 'SBI', kind: 'bank', last4: '9999', created: '2026-10-01', check: { date: '2026-10-18', amount: 10000 } }],
    budgets: [{ id: 'b1', name: 'Food & dining', amount: 8000 }, { id: 'b2', name: 'Misc', amount: 4000 }],
    savings: { emergencyBalance: 0, investSaved: 0, emergencyTargetMonths: 3 }, sinking: [], goals: [], iou: [],
    transactions: [], merchantRules: {}, adjustment: null, recapSeen: T, lastBackup: T,
    balanceCheck: { date: '2026-10-18', amount: 100000 },
  };
}
const sms = (amount, to, ref, extra) => 'Rs.' + amount.toLocaleString('en-IN') + '.00 debited from a/c **1234 on 20-10-26 ' + to + '. Ref ' + ref + (extra || '');
// Each case: the SMS, the by-hand action (as its button does it), and what "once" means.
const CASES = [
  { name: 'Rent (fixed payment): Mark paid', sms: sms(22000, 'to VPA landlord@okaxis', 101), hand: (s) => Core.payFixed(s, 'rent', { amount: 22000, date: T }), out: 22000, spend: 0 },
  { name: 'Loan EMI: Mark paid', sms: sms(15000, 'towards NACH LOAN EMI', 102), hand: (s) => Core.payFixed(s, 'pl', { amount: 15000, date: T }), out: 15000, spend: 0 },
  { name: 'Electricity bill: Pay', sms: sms(1200, 'to MSEDCL', 103), hand: (s) => Core.joinBankTwin(s, Core.payBill(s, 'elec', 1200, 1, T), true), out: 1200, spend: 0 },
  { name: 'Credit card bill: Pay (card known)', sms: 'Rs.5,000.00 debited from a/c **1234 on 20-10-26 towards HDFC Credit Card XX6645 payment. Ref 104', hand: (s) => {
    const dup = s.transactions.find((x) => x.kind === 'cardpay' && x.cardId === 'c1' && x.amount === 5000 && x.source !== 'manual');
    if (!dup) Core.joinBankTwin(s, Core.recordCardPayment(s, 'c1', 5000, T), true); }, out: 0, spend: 0 },
  { name: 'Lent to Amit (People → Add)', sms: sms(3000, 'to VPA amit@ybl', 105), hand: (s) => { const b = Core.bankTwin(s, { amount: 3000, date: T, dir: 'out', any: true }); Core.addIou(s, { name: 'Amit', dir: 'lent', amount: 3000, txId: b && b.id }, T); }, out: 3000, spend: 0, people: 3000 },
  { name: 'Borrowed from Rahul (People → Add)', sms: 'Rs.4,000.00 credited to a/c **1234 on 20-10-26 by VPA rahul@ybl. Ref 110', hand: (s) => { const b = Core.bankTwin(s, { amount: 4000, date: T, dir: 'in', any: true }); Core.addIou(s, { name: 'Rahul', dir: 'owe', amount: 4000, txId: b && b.id }, T); if (b) b.useFor = 'spend'; }, out: -4000, spend: 0, people: -4000 },
  { name: 'Moved to own SBI (Move money)', sms: sms(5000, 'to SBI a/c XX9999', 106), hand: (s) => { const t = { id: 'mv1', kind: 'transfer', date: T, amount: 5000, from: 'main', to: 'sbi', note: 'Moved money', source: 'manual' }; s.transactions.push(t); Core.joinBankTwin(s, t, true); }, out: 0, spend: 0 },
  { name: 'Moved to own SBI, both banks\' SMS', sms: sms(5000, 'to SBI a/c XX9999', 112) + '\n\nRs.5,000.00 credited to a/c **9999 on 20-10-26 from a/c XX1234. Ref 113', hand: (s) => { const t = { id: 'mv3', kind: 'transfer', date: T, amount: 5000, from: 'main', to: 'sbi', note: 'Moved money', source: 'manual' }; s.transactions.push(t); Core.joinBankTwin(s, t, true); }, out: 0, spend: 0 },
  { name: 'ATM cash (Move money to Cash)', sms: 'Rs.2,000.00 withdrawn at ATM from a/c **1234 on 20-10-26. Ref 107', hand: (s) => { const t = { id: 'mv2', kind: 'transfer', date: T, amount: 2000, from: 'main', to: 'cash', note: 'Moved money', source: 'manual' }; s.transactions.push(t); Core.joinBankTwin(s, t, true); }, out: 0, spend: 0 },
  { name: 'Trip dinner I paid (event)', sms: sms(2000, 'to VPA dinner@ybl', 108), hand: (s) => { const ev = Core.addEvent(s, { name: 'Trip', from: T, to: T, people: ['A', 'B', 'C'] }, T); const it = Core.addEventExpense(s, ev.id, { date: T, total: 2000, paidBy: 'me', shares: { me: 500, A: 500, B: 500, C: 500 }, place: 'Dinner', category: 'Food & dining' }); Core.joinBankTwin(s, s.transactions.find((x) => x.id === it.txIds[0] && x.eventNew), true); }, out: 2000, spend: 500, people: 1500 },
  { name: 'Refund in (Add → money in)', sms: 'Rs.500.00 credited to a/c **1234 on 20-10-26 refund from AMAZON. Ref 109', hand: (s) => { const t = { id: 'in1', kind: 'in', date: T, amount: 500, category: 'Refund', note: 'AMAZON', source: 'manual', useFor: null }; s.transactions.push(t); Core.joinBankTwin(s, t, false); }, out: -500, spend: 0 },
  { name: 'Groceries typed in (Add)', sms: sms(850, 'to VPA dmart@ybl', 111), hand: (s) => { const t = { id: 'g1', date: T, amount: 850, category: 'Groceries', note: 'DMart', source: 'manual' }; s.transactions.push(t); Core.joinBankTwin(s, t, false); }, out: 850, spend: 850 },
];
(async () => {
  await new Promise((r) => server.listen(8792, r));
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const load = async (s) => {
    await page.clock.setFixedTime(new Date(T + 'T12:00:00+05:30')); await page.goto('http://localhost:8792/#home');
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, s);
    await page.reload(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
  };
  const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(200); };
  const importSms = async (text) => {
    await c('[data-action=tab][data-tab=spend]'); await c('[data-action=page-open][data-key=sms]');
    await page.fill('#sms-text', text); await c('[data-action=sms-read]'); await c('[data-action=sms-import]');
    return page.evaluate(() => JSON.parse(localStorage.getItem('salary-runway-v1')));
  };
  const measure = (s) => { const c = Core.cleanState(JSON.parse(JSON.stringify(s))); const r = Core.projectRunway(c, T); const n = Core.netWorth(c, T); return { bal: r.balanceToday, spent: r.spentToDate, n: s.transactions.length, people: n.lentPeople - n.owedPeople }; };
  const b0 = measure(base());
  const rows = [];
  for (const k of CASES) {
    for (const order of ['by hand, then SMS', 'SMS, then by hand']) {
      let s = base();
      if (order[0] === 'b') { k.hand(s); await load(s); s = await importSms(k.sms); }
      else { await load(s); s = await importSms(k.sms); k.hand(s); }
      const m = measure(s);
      const ok = m.bal === b0.bal - k.out && m.spent === b0.spent + k.spend && m.n === 1 && m.people === (k.people || 0);
      rows.push({ case: k.name, order, once: ok ? 'OK' : 'WRONG', balance: m.bal - b0.bal, expected: -k.out, spending: m.spent - b0.spent, expSpend: k.spend, people: m.people, entries: m.n });
    }
  }
  console.table(rows);
  const bad = rows.filter((r) => r.once !== 'OK').length + errors.length;
  console.log(errors.length ? 'page errors ' + JSON.stringify(errors) : '');
  console.log(bad ? 'SOME FAILED' : 'ALL OK: each payment counted once, whichever came first');
  await browser.close(); server.close();
  process.exitCode = bad ? 1 : 0;
})();
