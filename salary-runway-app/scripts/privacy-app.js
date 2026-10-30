// Privacy in the real app: crash reports are asked for once and sent only after a
// yes, with no amounts or names; a problem report holds errors only, or (when
// ticked) the data with every name a random stand-in; the copy works out the
// same numbers as the phone.
//   npm run build && node scripts/privacy-app.js
// Made-up data only. Needs Playwright.
const fs = require('fs'); const path = require('path'); const http = require('http'); const os = require('os');
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
const state = {
  version: 1, settings: { salary: 72000, payday: 1, name: 'Priya Deshmukh', mainLast4: '4417' },
  fixed: [{ id: 'f1abc9', name: 'Rent to Kulkarni kaka', amount: 18000, dueDay: 5 }],
  debts: [{ id: 'd1abc9', name: 'Bajaj bike loan', balance: 60000, rate: 14, minPayment: 3100, dueDay: 10 }],
  bills: [], sinking: [], goals: [], events: [],
  cards: [{ id: 'c1abc9', name: 'Axis Ace', last4: '8812', limit: 50000, statementDay: 14, dueDay: 3, created: '2026-09-01' }],
  wallets: [], budgets: [{ id: 'g1', name: 'Groceries', amount: 7000 }, { id: 'g2', name: 'Chai tapri', amount: 600 }],
  savings: { emergencyBalance: 5000, investSaved: 0 },
  iou: [{ id: 'iou1abc', name: 'Sameer Patil', dir: 'lent', amount: 2500, paid: 0, created: '2026-10-12', payments: [] }],
  transactions: [
    { id: 't1abc9', date: '2026-10-03', amount: 640, category: 'Groceries', note: 'RAJU SABZIWALA', source: 'sms', smsKey: 's9f8e7d6' },
    { id: 't3abc9', date: '2026-10-08', amount: 2500, category: 'Misc', note: '9876543210@ybl', source: 'sms', smsKey: 's5e6f7a8', iouId: 'iou1abc' },
    { id: 't5abc9', date: '2026-10-11', amount: 300, category: 'Chai tapri', note: 'Chai with Neha' },
  ],
  merchantRules: { 'raju sabziwala': 'Groceries' }, adjustment: null, recapSeen: T, lastBackup: T,
  balanceCheck: { date: '2026-10-18', amount: 41000 },
};
const PRIVATE = ['Priya', 'Deshmukh', '4417', 'Kulkarni', 'Bajaj', 'Axis Ace', '8812', 'Chai tapri', 'Sameer', 'Patil', 'Neha', 'RAJU', 'SABZIWALA', '9876543210', 's9f8e7d6', 's5e6f7a8'];
const leaks = (text) => PRIVATE.filter((w) => String(text).toLowerCase().includes(w.toLowerCase()));
(async () => {
  await new Promise((r) => server.listen(8794, r));
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => { if (!/Test crash/.test(e.message)) errors.push(e.message); });
  const sent = [];
  await page.route('https://crash.example.dev/**', (route) => { sent.push({ url: route.request().url(), body: route.request().postData() }); route.fulfill({ status: 204, body: '' }); });
  let ok = true; const check = (n, cond, extra) => { console.log((cond ? 'OK   ' : 'FAIL ') + n + (cond ? '' : ' ' + JSON.stringify(extra === undefined ? '' : extra).slice(0, 600))); if (!cond) ok = false; };
  const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(250); };
  await page.clock.setFixedTime(new Date(T + 'T12:00:00+05:30'));
  await page.goto('http://localhost:8794/#home');
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(d));
    // The server: here the AI plan's address (the plan itself stays off); a real build has its own.
    localStorage.setItem('salary-runway-ai', JSON.stringify({ on: false, url: 'https://crash.example.dev', code: '' })); }, state);
  await page.reload(); await page.waitForTimeout(600); await page.keyboard.press('Escape');
  // An error the way the browser reports one to the app (timers don't run under a fixed clock).
  const crashErr = () => page.evaluate(() => { const e = new Error('Test crash reading Sameer Patil ₹18,000 RAJU SABZIWALA');
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught ' + e.message, filename: location.origin + '/app.js', lineno: 1200, colno: 15, error: e })); });

  // 1. Asked once; nothing is sent before a yes
  check('home asks once about crash reports', !!(await page.$('.crash-ask')));
  await crashErr(); await page.waitForTimeout(1500);
  check('an error before any answer: nothing sent', sent.length === 0, sent);
  await c('.crash-ask [data-action=crash-no]');
  check('"Don\'t send": the question is gone', !(await page.$('.crash-ask')));
  await crashErr(); await page.waitForTimeout(1500);
  check('crash reports off: nothing sent', sent.length === 0, sent);

  // 2. Turned on in Profile → Privacy; the example shows what goes
  await c('[data-action=profile-open]'); await c('[data-action=page-open][data-key=privacy]');
  await c('[data-action=crash-sample]');
  const sample = await page.evaluate(() => (document.querySelector('.privacy-card .report-preview') || {}).innerText || '');
  check('the example crash report holds no names', sample.length > 50 && leaks(sample).length === 0, leaks(sample));
  await c('[data-action=crash-yes]');
  await crashErr(); await page.waitForTimeout(2500);
  check('after a yes, the crash goes to the server', sent.length === 1 && /\/crash$/.test(sent[0].url), sent.map((x) => x.url));
  const body = sent[0] ? JSON.parse(sent[0].body) : {};
  check('  with the error and where it happened', /Test crash reading/.test(body.message) && typeof body.where === 'string', body);
  check('  and no names, amounts, account digits or SMS keys', leaks(sent[0] && sent[0].body).length === 0 && !/18,000|640|2500|41000/.test(sent[0] && sent[0].body), [leaks(sent[0] && sent[0].body), sent[0] && sent[0].body]);
  await crashErr(); await page.waitForTimeout(2000);
  check('the same error again the same day: not sent twice', sent.length === 1, sent.length);

  // 3. The problem report: errors only by default
  await page.evaluate(() => { const b = document.querySelector('[data-action=page-back]'); if (b) b.click(); }); await page.waitForTimeout(200);
  await c('[data-action=page-open][data-key=report]');
  await page.fill('#report-note', 'Limit wrong after paying Sameer');
  const save = async () => { const [dl] = await Promise.all([page.waitForEvent('download'), c('[data-action=report-save]')]); const f = path.join(os.tmpdir(), 'hisab-report-' + Date.now() + '.json'); await dl.saveAs(f); return f; };
  const f1 = await save(); const r1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
  check('report, errors only: no data, no names, no amounts', !r1.state && r1.level === 'errors' && leaks(JSON.stringify(r1)).length === 0 && !/18,000|"amount"/.test(JSON.stringify(r1)), [r1.level, leaks(JSON.stringify(r1))]);
  check('  it has the errors and the screens', (r1.errors || []).length >= 1 && (r1.screens || []).length >= 1 && r1.counts.transactions === 3, [r1.errors, r1.counts]);
  check('  the note keeps its words but not the name', /Limit wrong after paying …/.test(r1.note), r1.note);

  // 4. With my numbers, names hidden; the preview is the file
  await c('[data-action=page-open][data-key=report]').catch(() => {});
  await page.check('#report-data'); await c('[data-action=report-preview]');
  const prev = await page.evaluate(() => (document.querySelector('.report-preview') || {}).innerText || '');
  check('preview with numbers: amounts there, names not', /"amount": 640/.test(prev) && leaks(prev).length === 0, leaks(prev));
  const f2 = await save(); const r2 = JSON.parse(fs.readFileSync(f2, 'utf8'));
  check('report with numbers: names hidden', r2.level === 'numbers' && !!r2.state && leaks(JSON.stringify(r2)).length === 0, leaks(JSON.stringify(r2)));
  const n = (s) => { const x = Core.projectRunway(Core.cleanState(JSON.parse(JSON.stringify(s))), T); return [x.balanceToday, Math.round(x.dailyAllowance), x.spentToDate, x.billsAhead]; };
  check('  the copy works out the same numbers as the phone', JSON.stringify(n(r2.state)) === JSON.stringify(n(state)), [n(r2.state), n(state)]);
  check('  no time of day anywhere', !/\d{4}-\d{2}-\d{2}T\d/.test(JSON.stringify(r2)));
  check('page errors: none', errors.length === 0, errors);
  if (process.env.KEEP_REPORTS) { fs.copyFileSync(f1, path.join(process.env.KEEP_REPORTS, 'errors.json')); fs.copyFileSync(f2, path.join(process.env.KEEP_REPORTS, 'numbers.json')); }
  fs.unlinkSync(f1); fs.unlinkSync(f2);
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  await browser.close(); server.close();
  process.exitCode = ok ? 0 : 1;
})();
