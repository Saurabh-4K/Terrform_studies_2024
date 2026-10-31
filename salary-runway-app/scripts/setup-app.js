// Getting started in the real app, as a new person: salary, payday and balance first, then one
// setup card at a time on Runway (rent shows the real limit rolling down, no loans, later,
// what matters most the next day), the checklist ticking to "all set", "I'll explore myself"
// turning the cards off, and an old half-done setup finishing by itself.
//   npm run build && node scripts/setup-app.js [screenshot-dir]
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
(async () => {
  await new Promise((r) => server.listen(8803, r));
  const browser = await playwright.chromium.launch();
  let ok = true; const check = (n, cond, extra) => { console.log((cond ? 'OK   ' : 'FAIL ') + n + (cond ? '' : ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 400))); if (!cond) ok = false; };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(350); };
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem('salary-runway-v1')));
  const text = (sel) => page.evaluate((x) => (document.querySelector(x) || {}).innerText || '', sel);
  const shot = async (name, sel) => { if (!shots) return; const el = sel ? await page.$(sel) : null; await (el || page).screenshot({ path: path.join(shots, name + '.png') }); };
  const day = async (d) => { await page.clock.setFixedTime(new Date(d + 'T12:00:00+05:30')); };

  await day('2026-11-02');
  await page.goto('http://localhost:8803/#home');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-crash', '{"on":false}'); });
  await page.reload(); await page.waitForTimeout(600);
  await c('[data-action=start-own]');
  // First-time screen: two steps only
  check('first screen: step 1 of 2', /Step 1 of 2/i.test(await text('#onboard-card')));
  await page.fill('#ob-salary', '60000'); await page.fill('#ob-payday', '1'); await c('[data-action=onboard-next]');
  check('step 2 of 2 has its button: Show today’s limit', /Step 2 of 2/i.test(await text('#onboard-card')) && !!(await page.$('#onboard-card [data-action=onboard-next]')));
  await page.fill('#ob-balance', '45000'); await c('[data-action=onboard-next]');
  check('then Runway, no more forms', !(await page.$('#onboard-card')));
  // Card 1: rent, with today's limit in it
  const card1 = await text('.setup-card');
  check('card: Rent bhi toh dena hai na?, with today’s limit', /Rent bhi toh dena hai na\?/.test(card1) && /spend ₹[\d,]+ a day/.test(card1), card1);
  await page.waitForTimeout(1100); await shot('1-rent-card', '.hero');
  await page.fill('#su-rent', '18000'); await page.fill('#su-rent-day', '5');
  await c('[data-action=setup-fixed]');
  let d = await st();
  check('rent added', d.fixed.some((f) => f.amount === 18000 && f.dueDay === 5));
  const win = await page.evaluate(() => { const e = document.querySelector('.setup-to'); return e && { from: Number(e.dataset.rollFrom), to: Number(e.dataset.rollTo) }; });
  check('the real limit: rolls down from the old one', win && win.to < win.from, win);
  await page.waitForTimeout(1400); await shot('2-real-limit', '.setup-card');
  check('  and lands on today’s limit', (await text('.setup-to')).replace(/\D/g, '') === String(win.to), await text('.setup-to'));
  await c('[data-action=setup-win-next]');
  // Card 2: loans, answered "none"
  check('next card: EMIs, the guests who visit every month', /EMIs: the guests who visit every month/.test(await text('.setup-card')));
  await c('.setup-card [data-action=setup-none]');
  // Card 3: emergency savings, with Days of Freedom rolling up from 0
  check('next card: Mushkil waqt ke liye kuch bachaya hai?', /Mushkil waqt ke liye kuch bachaya hai\?/.test(await text('.setup-card')), await text('.setup-card'));
  await page.fill('#su-fund', '20000'); await c('[data-action=setup-savings]');
  d = await st();
  const days = await page.evaluate(() => { const e = document.querySelector('.setup-to'); return e && { from: Number(e.dataset.rollFrom), to: Number(e.dataset.rollTo), unit: e.dataset.rollUnit }; });
  check('savings added; Days of Freedom roll up from 0', d.savings.emergencyBalance === 20000 && days && days.unit === 'days' && days.from === 0 && days.to > 0, days);
  await page.waitForTimeout(1400); await shot('2b-days-of-freedom', '.setup-card');
  check('  and land on whole days', (await text('.setup-to')) === String(days.to), await text('.setup-to'));
  await c('[data-action=setup-win-next]');
  // Card 4 (no SMS in a browser): what matters most, then "later"
  check('next card: what can’t you live without?', /What can’t you live without\?/.test(await text('.setup-card')));
  await c('.setup-card [data-action=setup-later]');
  check('"Later": no card for the rest of today', !(await page.$('.setup-card')));
  await c('.setup-list-head');
  const list = await text('.setup-list');
  check('checklist: 5 of 6, the one left is a link', /Getting started · 5 of 6/.test(list) && !!(await page.$('.setup-list [data-action=setup-step][data-key=protect]')), list);
  await page.waitForTimeout(900); await shot('3-checklist', '.setup-list');
  // Next day: back
  await day('2026-11-03'); await page.reload(); await page.waitForTimeout(600);
  check('next day: the card is back', /What can’t you live without\?/.test(await text('.setup-card')));
  await c('[data-action=setup-protect]');
  await c('[data-action=protect-add][data-preset=family]');
  await c('[data-action=page-back]');
  await c('[data-action=tab][data-tab=home]');
  check('all done: You’re all set, and no card', /You’re all set/.test(await text('.setup-list')) && !(await page.$('.setup-card')));
  d = await st();
  check('  done date kept', d.setup && d.setup.doneAt === '2026-11-03');
  await day('2026-11-04'); await page.reload(); await page.waitForTimeout(500);
  check('the day after: the checklist is gone', !(await page.$('.setup-list')));

  // "I'll explore myself"
  await day('2026-11-02');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-crash', '{"on":false}');
    localStorage.setItem('salary-runway-v1', JSON.stringify({ version: 1, settings: { salary: 40000, payday: 1 }, fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [], wallets: [], iou: [], budgets: [], savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null, balanceCheck: { date: '2026-11-02', amount: 20000 }, recapSeen: '2026-11-02', lastBackup: '2026-11-02' })); });
  await page.reload(); await page.waitForTimeout(600);
  check('an existing person with no rent yet gets the rent card', /Rent bhi toh dena hai na\?/.test(await text('.setup-card')));
  await c('[data-action=setup-off]');
  check('"I’ll explore myself": no cards, the checklist stays', !(await page.$('.setup-card')) && !!(await page.$('.setup-list')));
  await c('.setup-list-head'); await c('[data-action=setup-step][data-key=loans]');
  check('  a checklist row still opens its card', /EMIs: the guests/.test(await text('.setup-card')));
  await page.fill('#su-emi', '6000'); await page.fill('#su-left', '90000'); await c('[data-action=setup-loan]');
  d = await st();
  check('  an EMI added: counted in the plan', d.debts.some((x) => x.minPayment === 6000 && x.balance === 90000 && x.rate === 14));

  // An old half-done setup (the longer form, step 4) finishes by itself
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('salary-runway-v1')); s.onboarding = { step: 4 }; localStorage.setItem('salary-runway-v1', JSON.stringify(s)); });
  await page.reload(); await page.waitForTimeout(800);
  d = await st();
  check('an old setup at step 4 finishes by itself', !d.onboarding && !(await page.$('#onboard-card')));
  check('page errors: none', errors.length === 0, errors);
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  await browser.close(); server.close();
  process.exitCode = ok ? 0 : 1;
})();
