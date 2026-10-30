// Opens a tester's problem report (Profile → Report a problem) in the real app,
// on the report's own date, and goes through every page:
//   node scripts/replay-report.js HisabSe-report-2026-10-26.json [out-dir]
// Prints the note, the app's numbers, recent errors and the log, and writes
// every page's text and a screenshot of each tab to out-dir (default reports/replay).
// Needs `npm run build` first and Playwright. Reports from build 76 on hold no
// names (a report "with numbers" has random stand-ins), but still a person's
// amounts: keep them and the output out of the repo (.gitignore covers reports/)
// and delete them once the bug is fixed. A report with errors only has no data
// to open: its errors and screens are printed.
const fs = require('fs');
const path = require('path');
const http = require('http');
let playwright;
try { playwright = require('playwright'); } catch (e) {
  playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
}

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/replay-report.js <report.json> [out-dir]'); process.exit(1); }
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
if (report.kind !== 'hisab-problem-report') { console.error('Not a Hisab Se problem report.'); process.exit(1); }
if (!report.state) {
  // Errors only: what went wrong and where, nothing to open in the app.
  console.log('Report made ' + report.made + ' · build ' + report.build + ' · Android ' + report.android + ' · ' + report.model + ' · ' + report.lang);
  console.log('Note: ' + (report.note || '(none)'));
  console.log('Entries: ' + JSON.stringify(report.counts || {}));
  (report.errors || []).forEach((x) => console.log('  ERROR ' + x.day + ' [' + x.tab + '/' + (x.page || '') + '] ' + x.message + ' @ ' + x.where + (x.stack ? '\n    ' + x.stack.split('\n').slice(0, 5).join('\n    ') : '')));
  console.log('Last screens: ' + (report.screens || []).map((x) => [x.tab, x.page, x.action].filter(Boolean).join('/')).join(' → '));
  console.log('\nNo data in this report. For a wrong number, ask for one with "Add my numbers, names hidden".');
  process.exit(0);
}
const out = process.argv[3] || path.join(__dirname, '..', 'reports', 'replay');
fs.mkdirSync(out, { recursive: true });
const www = path.join(__dirname, '..', 'www');
if (!fs.existsSync(path.join(www, 'index.html'))) { console.error('Run npm run build first.'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(www, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

const line = (s) => console.log(s);
(async () => {
  await new Promise((ok) => server.listen(0, ok));
  const base = 'http://localhost:' + server.address().port + '/index.html';
  line('Report made ' + report.made + ' · build ' + report.build + ' · ' + report.lang + ' · lock ' + (report.lock ? 'on' : 'off') + ' · AI ' + (report.ai ? 'on' : 'off'));
  line('Device: ' + (report.device || ('Android ' + report.android + ' · ' + report.model)) + ' · ' + report.screen);
  line('Note: ' + (report.note || '(none)'));
  line('On the phone: ' + JSON.stringify(report.numbers && { limit: report.numbers.limit, balance: report.numbers.balance, zone: report.numbers.zone, parts: report.numbers.parts }));
  const log = report.log || [];
  const errs = log.filter((x) => x.kind === 'error');
  line('\nLog: ' + log.length + ' events, ' + errs.length + ' errors');
  errs.slice(-10).forEach((x) => line('  ERROR ' + x.at + ' [' + x.tab + '/' + (x.page || '') + '] ' + x.message + ' @ ' + x.where + (x.stack ? '\n    ' + x.stack.split('\n').slice(0, 4).join('\n    ') : '')));
  line('Last 40 events:');
  log.slice(-40).forEach((x) => line('  ' + String(x.at || '').slice(5, 19) + ' ' + String(x.kind || '').padEnd(5) + ' ' + JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => ['at', 'kind'].indexOf(k) === -1)))));
  fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify(log, null, 1));

  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // The report's day, at midday in India (reports from build 76 on carry the date only).
  await page.clock.setFixedTime(new Date(String(report.made).length > 10 ? report.made : report.today + 'T12:00:00+05:30'));
  await page.goto(base + '#home');
  await page.evaluate((st) => {
    localStorage.clear();
    localStorage.setItem('salary-runway-lang', 'en');
    localStorage.setItem('salary-runway-tour', '1');
    localStorage.setItem('salary-runway-v1', JSON.stringify(st));
  }, report.state);
  await page.reload();
  await page.waitForTimeout(700);
  const text = () => page.evaluate(() => document.body.innerText);
  const click = (sel) => page.evaluate((x) => { const e = document.querySelector(x); if (e) e.click(); return !!e; }, sel);
  const dump = [];
  for (const t of ['home', 'spend', 'plan', 'debts', 'grow', 'profile']) {
    await click(t === 'profile' ? '[data-action=profile-open]' : '[data-action=tab][data-tab=' + t + ']');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, t + '.png'), fullPage: true });
    dump.push('######## ' + t + '\n' + await text());
    const keys = await page.$$eval('[data-action=page-open]', (els) => [...new Set(els.filter((e) => !e.closest('.page-body')).map((e) => (e.dataset.tab || '') + '|' + e.dataset.key))]);
    for (const k of keys) {
      const [tb, key] = k.split('|');
      if (tb && tb !== t) continue;
      await page.evaluate((key) => { const e = [...document.querySelectorAll('[data-action=page-open]')].find((x) => x.dataset.key === key); if (e) e.click(); }, key);
      await page.waitForTimeout(200);
      dump.push('======== ' + t + '/' + key + '\n' + await text());
      await click('[data-action=page-back]');
      await page.waitForTimeout(120);
    }
  }
  const all = dump.join('\n\n');
  fs.writeFileSync(path.join(out, 'pages.txt'), all);
  const odd = all.split('\n').filter((l) => /NaN|undefined|Invalid Date|Infinity|\bnull\b|₹-|\[object/.test(l));
  line('\nReplayed ' + dump.length + ' pages into ' + out);
  line('Odd text on screen: ' + (odd.length ? '\n  ' + [...new Set(odd)].slice(0, 20).join('\n  ') : 'none'));
  line('Errors in the replay: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
