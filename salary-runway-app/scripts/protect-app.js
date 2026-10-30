// What matters most in the real app: add from the list and your own (five at most), link a
// category, a shop and one payment, see the 🛡 on payments, cuts leave protected spending
// alone and say what it would save, "can I afford it?" still checks the money, and a backup
// keeps it all.
//   npm run build && node scripts/protect-app.js
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
function household(balance) {
  const s = {
    version: 1, settings: { salary: 50000, payday: 1 },
    fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [], wallets: [], iou: [],
    budgets: [{ id: 'b1', name: 'Food & dining', amount: 9000 }, { id: 'b2', name: 'Groceries', amount: 9000 }, { id: 'b3', name: 'Shopping', amount: 3000 }],
    savings: { emergencyBalance: 0, investSaved: 0 }, transactions: [], merchantRules: {}, adjustment: null,
    recapSeen: T, lastBackup: T, balanceCheck: { date: T, amount: balance },
  };
  for (let i = 28; i >= 1; i--) {
    const d = Core.addDays(T, -i);
    s.transactions.push({ id: 'c' + i, date: d, amount: 100, category: 'Food & dining', sub: 'Tea & snacks', note: 'Chaiwala' },
      { id: 'e' + i, date: d, amount: 200, category: 'Food & dining', sub: 'Eating out', note: 'Dhaba' },
      { id: 'g' + i, date: d, amount: 300, category: 'Groceries', note: 'Kirana' });
  }
  s.transactions.push({ id: 'sh', date: '2026-10-01', amount: 2800, category: 'Shopping', note: 'Mall' },
    { id: 'vet', date: '2026-10-19', amount: 1500, category: 'Misc', note: 'City Vet Clinic' });
  return s;
}
(async () => {
  await new Promise((r) => server.listen(8800, r));
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let ok = true; const check = (n, cond, extra) => { console.log((cond ? 'OK   ' : 'FAIL ') + n + (cond ? '' : ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 500))); if (!cond) ok = false; };
  const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(250); };
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem('salary-runway-v1')));
  const text = (sel) => page.evaluate((x) => (document.querySelector(x) || {}).innerText || '', sel);
  await page.clock.setFixedTime(new Date(T + 'T12:00:00+05:30'));
  await page.goto('http://localhost:8800/#home');
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-crash', '{"on":false}'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, household(2000));
  await page.reload(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
  const openProtect = async () => { await c('[data-action=tab][data-tab=plan]'); await c('[data-action=page-open][data-key=protect]'); };

  // Before: where to cut offers Food & dining at ₹300 a day (chai + eating out)
  const before = Core.cutOptions(household(2000), T);
  check('before: food is offered as a cut at ₹300 a day', before.cuts.some((x) => x.category === 'Food & dining' && x.daily === 300), before.cuts);

  await openProtect();
  check('Plan → What matters most opens', /Things I protect/.test(await text('.protect')));
  await c('[data-action=protect-add][data-preset=pleasures]');
  await c('[data-action=protect-add][data-preset=pets]');
  await c('[data-action=protect-add][data-preset=family]');
  await c('[data-action=protect-add][data-preset=health]');
  await page.fill('#protect-name', 'Sunday lunch with parents'); await page.evaluate(() => document.getElementById('protect-form').requestSubmit()); await page.waitForTimeout(250);
  let d = await st();
  check('five added: four from the list and one of your own', d.protect.length === 5 && d.protect[4].name === 'Sunday lunch with parents', d.protect.map((x) => x.name));
  check('  no more can be added', !(await page.$('#protect-form')) && /Five is the most/.test(await text('.protect')));
  // Pets: link the vet by shop
  const pets = d.protect.find((x) => x.preset === 'pets');
  await c('[data-action=protect-link][data-id="' + pets.id + '"]');
  await page.selectOption('#pl-shop-' + pets.id, 'City Vet Clinic');
  await c('[data-action=protect-link-save][data-id="' + pets.id + '"]');
  d = await st();
  check('a shop is linked to Pets', d.protect.find((x) => x.id === pets.id).shops.indexOf('city vet clinic') !== -1, d.protect.find((x) => x.id === pets.id));
  // One payment linked from the edit screen: the mall shopping, to your own
  await c('[data-action=tab][data-tab=spend]'); await c('[data-action=page-open][data-key=payments]');
  const own = d.protect[4];
  // The mall payment is old: the vet one (newest) is on the first page, so link that one too
  const opened = await page.evaluate(() => { const e = document.querySelector('[data-action=tx-edit][data-id="sh"]') || document.querySelector('[data-action=tx-edit][data-id="vet"]'); if (e) e.click(); return e ? e.dataset.id : null; });
  await page.waitForTimeout(250);
  if (await page.$('#edit-protect')) {
    await page.selectOption('#edit-protect', own.id); await c('[data-action=edit-save]');
    d = await st();
    check('one payment linked from the edit screen', d.protect.find((x) => x.id === own.id).txIds.indexOf(opened) !== -1, opened);
  } else check('edit screen has "What you protect"', false, opened);
  const chip = await page.evaluate(() => [...document.querySelectorAll('.protect-chip')].map((e) => e.innerText).slice(0, 3));
  check('protected payments show 🛡 with the name', chip.some((x) => /Small pleasures/.test(x)), chip);

  // Where to cut now leaves chai alone, says what it would save, and the gap
  const cu = Core.cutOptions(d, T);
  check('cuts: food only eating out (₹200 a day); chai protected', cu.cuts.some((x) => x.category === 'Food & dining' && x.daily === 200) && cu.protected.some((x) => x.name === 'Small pleasures'), [cu.cuts, cu.protected]);
  await c('[data-action=tab][data-tab=home]');
  await c('[data-action=page-open][data-key=review]');
  const rv = await text('.review');
  check('monthly review: "Left alone: you protect these" with what halving would save', /Left alone: you protect these/.test(rv) && /Small pleasures: about ₹100 a day\. Halving it would save ₹[\d,]+ by payday/.test(rv), rv.slice(rv.indexOf('Where to cut'), rv.indexOf('Where to cut') + 600));
  check('  and the other ways first when still short', cu.gapAfterCuts > 0 ? /Before touching what you protect/.test(rv) : /covered without touching them/.test(rv));
  // Can I afford it, for something protected: still checked
  await c('[data-action=page-back]');
  await c('.road-link');
  await page.fill('#afford-amt', '5000'); await page.selectOption('#afford-for', pets.id);
  await page.evaluate(() => document.getElementById('afford-form').requestSubmit()); await page.waitForTimeout(250);
  const af = await text('.afford');
  check('afford for Pets: protected, but the money is still checked', /It’s for Pets, which you protect/.test(af) && /Not now|Only if/.test(af), af);
  // Backup keeps it
  const back = Core.cleanState(JSON.parse(JSON.stringify(await st())));
  check('a backup keeps all five with their links', back.protect.length === 5 && back.protect.find((x) => x.id === pets.id).shops.length === 1);
  check('page errors: none', errors.length === 0, errors);
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  await browser.close(); server.close();
  process.exitCode = ok ? 0 : 1;
})();
