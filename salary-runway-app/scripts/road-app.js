// Road to payday in the real app: opened from Runway, the warning across the top
// names the first payment that falls short, the four numbers match the engine,
// the graph, timeline and "what if" views switch, "can I afford it?" answers
// yes / only on essentials / no, and the phone's back button closes the page.
//   npm run build && node scripts/road-app.js
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
const T = '2026-10-30';
const household = (balance) => ({
  version: 1, settings: { salary: 100000, payday: 28 },
  fixed: [{ id: 'rent', name: 'Rent', amount: 22000, dueDay: 28 }, { id: 'maid', name: 'Maid', amount: 1000, dueDay: 1 }],
  debts: [{ id: 'car', name: 'Car loan', balance: 400000, rate: 9, minPayment: 20000, dueDay: 5 }],
  bills: [], sinking: [], goals: [], cards: [], iou: [], wallets: [],
  budgets: [{ id: 'g', name: 'Groceries', amount: 6000 }, { id: 'h', name: 'Health', amount: 3000 }],
  savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
  recapSeen: T, lastBackup: T, balanceCheck: { date: '2026-10-28', amount: balance },
});
(async () => {
  await new Promise((r) => server.listen(8799, r));
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let ok = true; const check = (n, cond, extra) => { console.log((cond ? 'OK   ' : 'FAIL ') + n + (cond ? '' : ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 500))); if (!cond) ok = false; };
  const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(250); };
  const text = (sel) => page.evaluate((x) => (document.querySelector(x) || {}).innerText || '', sel);
  const load = async (s) => {
    await page.clock.setFixedTime(new Date(T + 'T12:00:00+05:30'));
    await page.goto('http://localhost:8799/#home');
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-crash', '{"on":false}'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, s);
    await page.reload(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
  };
  const afford = async (amount) => { await page.fill('#afford-amt', String(amount)); await page.evaluate(() => document.getElementById('afford-form').requestSubmit()); await page.waitForTimeout(250); return text('.afford-res'); };

  // Short: ₹40,000 can't pay the car loan
  let s = household(40000);
  await load(s);
  await c('.road-link');
  const road = Core.roadToPayday(s, T);
  const status = await page.evaluate(() => { const e = document.querySelector('.road-status'); const r = e && e.getBoundingClientRect(); return e && { text: e.innerText, red: e.classList.contains('zone-red'), top: r.top, width: r.width }; });
  check('the warning is across the top, in red, naming the payment', status && status.red && status.width > 300 && status.top < 260 && /Car loan on 5 Nov would be ₹[\d,]+ short/.test(status.text), status);
  check('  its amount is the engine\'s', status && status.text.includes('₹' + road.short.amount.toLocaleString('en-IN')), [road.short, status && status.text]);
  const stats = await text('.road-stats');
  check('four numbers: balance, still to pay, lowest point, day before payday', ['Balance now', 'Still to pay', 'Lowest point', 'Day before payday'].every((w) => stats.includes(w)) && stats.includes('₹' + road.start.toLocaleString('en-IN')), stats);
  check('the graph draws', !!(await page.$('.road-svg path.road-line')));
  await c('[data-action=road-view][data-view=timeline]');
  const tl = await text('.road-timeline');
  check('timeline: each payment with the balance after it; the short one marked', /Rent[\s\S]*Maid[\s\S]*Car loan/.test(tl) && !!(await page.$('.road-row.short')) && /Salary/.test(tl), tl.slice(0, 300));
  await c('[data-action=road-view][data-view=whatif]');
  const before = await text('.road-stats');
  await c('[data-action=road-rate][data-rate=essentials]');
  check('what if: essentials only changes the numbers', (await text('.road-stats')) !== before && /essentials only/.test(await text('.road-stats')));
  check('can I afford ₹5,000: no, and which payment', /Not now: ₹5,000/.test(await afford(5000)) && /Car loan on 5 Nov/.test(await text('.afford-res')));
  // Enough money: yes, then only on essentials
  s = household(90000);
  await load(s);
  await c('.road-link');
  check('enough: the banner is not red', !(await page.$('.road-status.zone-red')), await text('.road-status'));
  check('can I afford ₹1,000: yes', /Yes, you can afford ₹1,000/.test(await afford(1000)));
  const a = Core.affordCheck(s, T, 0);
  const mid = a.usual.end + Math.round((a.essentials.end - a.usual.end) / 2);
  if (a.essentials.end > a.usual.end + 100) check('can I afford a bit more than fits: only on essentials', /Only if you spend on essentials/.test(await afford(mid)), [mid, await text('.afford-res')]);
  // The phone's back button closes the page and returns to Runway
  check('phone back closes the page', (await page.evaluate(() => window.hisabBack())) === true);
  await page.waitForTimeout(300);
  check('  and Runway shows again', !(await page.$('.road')) && !!(await page.$('.road-link')));
  check('page errors: none', errors.length === 0, errors);
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  await browser.close(); server.close();
  process.exitCode = ok ? 0 : 1;
})();
