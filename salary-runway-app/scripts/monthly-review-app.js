// The monthly AI review in the real app, with a stand-in server: written once a round and
// kept until next payday (next week's plan doesn't replace it); a server that never writes
// it is asked at most twice a round, not with every plan.
//   npm run build && node scripts/monthly-review-app.js
// Made-up data only. Needs Playwright.
const fs = require('fs'); const path = require('path'); const http = require('http');
let playwright;
try { playwright = require('playwright'); } catch (e) {
  playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
}
const www = path.join(__dirname, '..', 'www');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(www, req.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const state = {
  version: 1, settings: { salary: 60000, payday: 1 }, fixed: [], debts: [], bills: [], sinking: [], goals: [], cards: [], wallets: [], iou: [],
  budgets: [{ id: 'b1', name: 'Groceries', amount: 8000 }], savings: { emergencyBalance: 0, investSaved: 0 },
  transactions: [], merchantRules: {}, adjustment: null, recapSeen: '2026-11-03', lastBackup: '2026-11-03', balanceCheck: { date: '2026-11-03', amount: 40000 },
};
const plan = (diagnosis) => ({ headline: 'A calm week', diagnosis, week_goal: { type: 'no_card', amount: 0, text: 'No card this week' },
  sections: [{ kind: 'fraud', title: 'Stay safe', steps: [{ action: 'Never share an OTP', why: 'Banks never ask', amount: null, basis: 'general' }] }] });
const DIAG = { verdict: 'Your salary covers everything this month', causes: [{ title: 'Steady', text: 'Nothing unusual.' }], actions: [], checks: [] };
(async () => {
  await new Promise((r) => server.listen(8802, r));
  const browser = await playwright.chromium.launch();
  let ok = true; const check = (n, cond, extra) => { console.log((cond ? 'OK   ' : 'FAIL ') + n + (cond ? '' : ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 400))); if (!cond) ok = false; };
  const run = async (writes) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const asked = [];
    await page.route('https://ai.example.dev/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/rates')) return route.fulfill({ status: 404, body: '{}' });
      const facts = JSON.parse(route.request().postData() || '{}').facts || '';
      const monthly = /Monthly review this time: yes/.test(facts);
      asked.push(monthly);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: plan(monthly && writes ? DIAG : null) }) });
    });
    const at = async (day) => {
      await page.clock.setFixedTime(new Date(day + 'T12:00:00+05:30'));
      await page.reload(); await page.waitForTimeout(1200);
    };
    await page.goto('http://localhost:8802/#home');
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-crash', '{"on":false}');
      localStorage.setItem('salary-runway-ai', JSON.stringify({ on: true, url: 'https://ai.example.dev', code: 'x' })); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, state);
    await at('2026-11-03'); // week 1: the plan asks for the monthly review
    await at('2026-11-10'); // week 2
    await at('2026-11-17'); // week 3
    await at('2026-11-24'); // week 4
    const review = async () => { await page.evaluate(() => { const b = document.querySelector('[data-action=tab][data-tab=home]'); if (b) b.click(); }); await page.waitForTimeout(200);
      await page.evaluate(() => { const b = document.querySelector('[data-action=page-open][data-key=review]'); if (b) b.click(); }); await page.waitForTimeout(300);
      return page.evaluate(() => (document.querySelector('.review') || {}).innerText || ''); };
    const r = { asked, text: await review() };
    await page.close();
    return r;
  };
  const good = await run(true);
  check('four weekly plans made, one a week (not continuously)', good.asked.length === 4, good.asked);
  check('the monthly review asked for once, in the first plan after payday', JSON.stringify(good.asked) === JSON.stringify([true, false, false, false]), good.asked);
  check('three weeks later the review is still there', /Your salary covers everything this month/.test(good.text) && /written once for this month, on 3 Nov/.test(good.text), good.text.slice(0, 300));
  const old = await run(false);
  check('a server that never writes it: asked at most twice this round', JSON.stringify(old.asked) === JSON.stringify([true, true, false, false]), old.asked);
  check('  and the page says when it comes', /written once a month, with the first plan after payday/.test(old.text));
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  await browser.close(); server.close();
  process.exitCode = ok ? 0 : 1;
})();
