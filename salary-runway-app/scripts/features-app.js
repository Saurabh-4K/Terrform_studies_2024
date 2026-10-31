// Features when needed, in the real app: a new person sees a short app (each tab ends with
// "More features" listing what's not shown); opening one from there keeps it; a page appears
// by itself with "New" once the person's data makes it relevant, until it's opened; "Show all
// features" shows everything; links to a page not shown still open it.
//   npm run build && node scripts/features-app.js [screenshot-dir]
// Made-up data only. Needs Playwright.
const fs = require('fs'); const path = require('path'); const http = require('http');
let playwright;
try { playwright = require('playwright'); } catch (e) {
  playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
}
const www = path.join(__dirname, '..', 'www');
const shots = process.argv[2] || null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(www, req.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const T = '2026-11-02';
const fresh = () => ({ version: 1, settings: { salary: 50000, payday: 1 }, fixed: [{ id: 'f1', name: 'Rent', amount: 15000, dueDay: 5 }], debts: [], bills: [], sinking: [], goals: [], cards: [], wallets: [], iou: [],
  budgets: [{ id: 'b1', name: 'Groceries', amount: 8000 }], savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  balanceCheck: { date: T, amount: 40000 }, recapSeen: T, lastBackup: T, setup: { off: true } });
(async () => {
  await new Promise((r) => server.listen(8804, r));
  const browser = await playwright.chromium.launch();
  let ok = true; const check = (n, cond, extra) => { console.log((cond ? 'OK   ' : 'FAIL ') + n + (cond ? '' : ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 400))); if (!cond) ok = false; };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(300); };
  const tiles = () => page.evaluate(() => [...document.querySelectorAll('.hub-tile')].map((e) => e.dataset.key + (e.querySelector('.hub-new') ? ':New' : e.querySelector('.hub-badge') ? ':' + e.querySelector('.hub-badge').innerText : '')));
  const load = async (s) => {
    await page.clock.setFixedTime(new Date(T + 'T12:00:00+05:30'));
    await page.goto('http://localhost:8804/#home');
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-crash', '{"on":false}'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, s);
    await page.reload(); await page.waitForTimeout(500);
  };
  const tab = async (t) => { await c('[data-action=tab][data-tab=' + t + ']'); return tiles(); };

  // A new person: short tabs, each ending with More features
  await load(fresh());
  let spend = await tab('spend');
  check('Spend: no Trips, Reimbursements, Little leaks or Calendar yet', !spend.some((k) => /^(events|reimb|leaks|calendar)/.test(k)), spend);
  check('  payments and bank SMS stay', spend.some((k) => /^payments/.test(k)) && spend.some((k) => /^sms/.test(k)), spend);
  check('  "More features" ends the tab, with how many', spend.some((k) => /^more:\+\d/.test(k)), spend);
  const debts = await tab('debts');
  check('Debts: loans and cards always; People not yet', debts.some((k) => /^loans/.test(k)) && debts.some((k) => /^cards/.test(k)) && !debts.some((k) => /^people/.test(k)), debts);
  const counts = {};
  for (const t of ['home', 'spend', 'plan', 'debts', 'grow']) counts[t] = (await tab(t)).filter((k) => !/^more/.test(k)).length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log('     pages on the tabs for a new person: ' + JSON.stringify(counts) + ' = ' + total);
  // More features: listed with a line each; opening one keeps it
  await tab('spend');
  await c('[data-action=page-open][data-key=more]');
  const more = await page.evaluate(() => document.querySelector('.more-features').innerText);
  check('More features lists Trips with what it is', /Trips and events: split payments with friends/.test(more), more.slice(0, 200));
  if (shots) await (await page.$('.more-features')).screenshot({ path: path.join(shots, 'more-features.png') });
  await c('[data-action=feature-on][data-key=events]');
  check('  "Open" opens the Trips page', /Trips/.test(await page.evaluate(() => document.querySelector('.page-body').innerText)));
  await c('[data-action=page-back]');
  spend = await tiles();
  check('  and Trips stays on the tab after', spend.some((k) => /^events/.test(k)), spend);

  // Appears by itself once relevant, with "New" until opened
  const s = fresh();
  s.iou = [{ id: 'i1', name: 'Amit', dir: 'lent', amount: 2000, paid: 0, created: T, payments: [] }];
  await load(s);
  let d = await tab('debts');
  check('People appears by itself once someone owes you', d.some((k) => /^people/.test(k)), d);
  // An existing person upgrading doesn't get "New" on what they already had
  const had = fresh(); had.iou = s.iou;
  await load(had);
  d = await tab('debts');
  check('someone who already had People: no "New" on it', d.some((k) => k === 'people' || /^people:[^N]/.test(k)), d);
  // Becoming relevant later: New, then gone once opened
  const later = fresh();
  await load(later);
  await tab('debts');
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('salary-runway-v1')); st.iou = [{ id: 'i2', name: 'Neha', dir: 'owe', amount: 500, paid: 0, created: '2026-11-02', payments: [] }]; localStorage.setItem('salary-runway-v1', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  d = await tab('debts');
  check('a page that becomes relevant later is marked New', d.some((k) => /^people:New/.test(k)), d);
  await c('[data-action=page-open][data-key=people]'); await c('[data-action=page-back]');
  d = await tiles();
  check('  and opening it clears New', d.some((k) => /^people/.test(k)) && !d.some((k) => /^people:New/.test(k)), d);

  // A link to a page not shown still opens it
  await load(fresh());
  await c('[data-action=tab][data-tab=home]');
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'page-open'; b.dataset.tab = 'spend'; b.dataset.key = 'calendar'; b.id = 'x'; document.body.appendChild(b); b.click(); });
  await page.waitForTimeout(300);
  check('a link to a page not shown yet still opens it', !!(await page.$('.page-body')));

  // Show all features
  await load(fresh());
  await c('[data-action=profile-open]'); await c('[data-action=page-open][data-key=appearance]');
  await c('[data-action=features-all]');
  spend = await tab('spend');
  check('Show all features: everything, no More features', spend.some((k) => /^events/.test(k)) && spend.some((k) => /^calendar/.test(k)) && !spend.some((k) => /^more/.test(k)), spend);
  check('page errors: none', errors.length === 0, errors);
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  await browser.close(); server.close();
  process.exitCode = ok ? 0 : 1;
})();
