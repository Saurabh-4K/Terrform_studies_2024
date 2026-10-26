// The money map in the real app (tests/money-map.js): each kind of entry recorded,
// then deleted from Payments (every number must come back), and recorded again
// with its amount doubled in the edit screen (what it did must double).
//   npm run build && node scripts/money-map-app.js [part of a name]
// Made-up data only. Needs Playwright.
const fs = require('fs');
const path = require('path');
const http = require('http');
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
const MAP = fs.readFileSync(path.join(__dirname, '..', 'tests', 'money-map.js'), 'utf8');
const only = process.argv[2];
// Numbers that follow an entry's amount one for one.
const LINEAR = ['bank', 'spentToday', 'spentCycle', 'daySpent', 'reports', 'envelopes', 'income', 'worth', 'fund', 'grow', 'goal', 'loans', 'people', 'cardOwed', 'kept', 'cash'];
// Not linear by nature: only so much was kept (₹2,000 for a ₹3,000 purchase); repaying more than is owed is refused.
const NOT_LINEAR = ['purchase covered by kept'];

async function run(browser, B, name, mode) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-26T12:00:00+05:30'));
  await page.goto(B + '#home');
  const load = async () => { await page.reload(); await page.waitForTimeout(400); await page.evaluate(MAP); };
  await page.evaluate(MAP);
  await page.evaluate((name) => { const M = window.MoneyMap; const s = M.base(); const k = M.kinds[name]; if (k.pre) k.pre(s); s.recapSeen = M.T; s.lastBackup = M.T;
    localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(s)); }, name);
  await load();
  const M = () => page.evaluate(() => window.MoneyMap.measure(JSON.parse(localStorage.getItem('salary-runway-v1'))));
  const before = await M();
  const ids0 = await page.evaluate(() => JSON.parse(localStorage.getItem('salary-runway-v1')).transactions.map((t) => t.id));
  await page.evaluate((name) => { const s = JSON.parse(localStorage.getItem('salary-runway-v1')); const k = window.MoneyMap.kinds[name]; (typeof k === 'function' ? k : k.apply)(s); localStorage.setItem('salary-runway-v1', JSON.stringify(s)); }, name);
  await load();
  const mid = await M();
  const ids = await page.evaluate((ids0) => JSON.parse(localStorage.getItem('salary-runway-v1')).transactions.map((t) => t.id).filter((id) => ids0.indexOf(id) === -1), ids0);
  const c = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return false; e.click(); return true; }, sel).then(async (ok) => { await page.waitForTimeout(150); return ok; });
  let note = '';
  let bad = [];
  if (!ids.length) { await page.close(); return null; }
  await c('[data-action=tab][data-tab=spend]'); await c('[data-action=page-open][data-key=payments]');
  if (mode === 'delete') {
    for (const id of ids.slice().reverse()) if (!(await c('[data-action=tx-delete][data-id="' + id + '"]'))) note += ' no delete for ' + id;
    const after = await M();
    bad = Object.keys(before).filter((k) => before[k] !== after[k]).map((k) => k + ' ' + before[k] + '→' + after[k]);
  } else {
    if (ids.length !== 1 || NOT_LINEAR.indexOf(name) !== -1) { await page.close(); return null; }
    const amt = await page.evaluate((id) => JSON.parse(localStorage.getItem('salary-runway-v1')).transactions.find((t) => t.id === id).amount, ids[0]);
    if (!(await c('[data-action=tx-edit][data-id="' + ids[0] + '"]'))) note = ' (no edit)';
    else if (!(await page.$('#edit-amount'))) note = ' (amount fixed)';
    else {
      await page.fill('#edit-amount', String(amt * 2)); await c('[data-action=edit-save]');
      const refused = await page.evaluate(() => { const e = document.querySelector('.edit-card .bad'); return e ? e.innerText : ''; });
      if (refused) note = ' (refused: ' + refused + ')';
      else {
        const after = await M();
        bad = LINEAR.filter((k) => typeof before[k] === 'number' && after[k] !== before[k] + 2 * (mid[k] - before[k]))
          .map((k) => k + ' once ' + (mid[k] - before[k]) + ', doubled ' + (after[k] - before[k]));
      }
    }
  }
  await page.close();
  return { bad: bad.concat(errors), note };
}

(async () => {
  await new Promise((ok) => server.listen(0, ok));
  const B = 'http://localhost:' + server.address().port + '/index.html';
  const browser = await playwright.chromium.launch();
  let fails = 0;
  try {
    const names = Object.keys(require('../tests/money-map.js').kinds).filter((n) => !only || n.indexOf(only) !== -1);
    for (const mode of ['delete', 'double']) {
      console.log(mode === 'delete' ? 'Recorded, then deleted:' : 'Amount doubled in the edit screen:');
      for (const name of names) {
        const r = await run(browser, B, name, mode);
        if (!r) continue;
        if (r.bad.length) fails++;
        console.log((r.bad.length ? 'FAIL ' : 'OK   ') + name + r.note + (r.bad.length ? '\n   ' + r.bad.join(', ') : ''));
      }
    }
  } finally { await browser.close(); server.close(); }
  process.exit(fails ? 1 : 0);
})();
