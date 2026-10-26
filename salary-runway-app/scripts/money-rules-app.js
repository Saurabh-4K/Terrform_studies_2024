// The money rules in the real app: every kind of entry, added through the
// screens, then edited and deleted, must leave each number right: funds,
// goals, loans, People, kept money, net worth, today's limit and balance.
//   npm run build && node scripts/money-rules-app.js
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

function household() {
  return {
    version: 1, isDemo: false,
    settings: { salary: 98000, payday: 28 },
    fixed: [{ id: 'rent', name: 'Rent', amount: 22000, dueDay: 28 }],
    debts: [{ id: 'pl', name: 'Personal loan', balance: 500000, rate: 11, minPayment: 15000, dueDay: 7, emiThrough: '2026-10-07' }],
    budgets: ['Groceries', 'Food & dining', 'Travel', 'Shopping', 'Health', 'Misc'].map((name, i) => ({ id: 'b' + i, name, amount: 0, auto: true })),
    bills: [], sinking: [], cards: [], merchantRules: {}, adjustment: null,
    savings: { auto: true, emergencyBalance: 1000, emergencyTargetMonths: 6, investSaved: 0, rollovers: [] },
    goals: [{ id: 'g1', name: 'Bike', target: 20000, by: '2027-06-01', saved: 0, created: '2026-10-01' }],
    transactions: [{ id: 'food', date: '2026-10-24', amount: 300, category: 'Food & dining', note: 'Canteen' }],
    balanceCheck: { date: '2026-10-23', amount: 20000 },
    recapSeen: '2026-10-26', lastBackup: '2026-10-26',
  };
}

async function addThenDelete(browser, B) {
  const data = household();
  const snap = (page) => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('salary-runway-v1')); const t = '2026-10-26';
    const r = Core.projectRunway(s, t);
    return JSON.stringify({ fund: s.savings.emergencyBalance, invest: s.savings.investSaved || 0, goal: [s.goals[0].saved, s.goals[0].savedOutside || 0],
      debts: s.debts.map((d) => d.balance), people: (s.iou || []).map((i) => [i.name, Core.iouLeft(i)]), kept: Core.keptFor(s).map((k) => k.left),
      worth: Core.netWorth(s, t).value, limit: Math.round(r.dailyAllowance), balance: r.balanceToday, txs: s.transactions.length });
  });
  const flows = {
    'saving to a goal (Saved form)': async (p, c) => {
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=tx-kind][data-kind=save]');
      await p.fill('#sv-amount', '100'); await p.fill('#sv-note', 'Jar'); await p.selectOption('#sv-use', { label: 'Goal: Bike' });
      await p.evaluate(() => document.getElementById('save-tx').requestSubmit());
    },
    'money in → emergency fund': async (p, c) => {
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=tx-kind][data-kind=in]');
      await p.fill('#tx-amount', '2000'); await p.fill('#tx-note', 'Dad'); await p.evaluate(() => document.getElementById('add-tx').requestSubmit());
      await c('[data-action=income-use][data-use=emergency]');
    },
    'money in → kept for a purchase, then used': async (p, c) => {
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=tx-kind][data-kind=in]');
      await p.fill('#tx-amount', '5000'); await p.fill('#tx-note', 'Father'); await p.evaluate(() => document.getElementById('add-tx').requestSubmit());
      await c('[data-action=income-use][data-use=keep]'); await p.fill('#keep-name', 'Diwali'); await c('[data-action=keep-save]');
      await c('[data-action=tx-kind][data-kind=out]'); await p.fill('#tx-amount', '4700'); await p.fill('#tx-note', 'Croma');
      await p.evaluate(() => document.getElementById('add-tx').requestSubmit());
      await c('[data-action=tab][data-tab=grow]'); await c('[data-action=keep-use-open]'); await p.selectOption('#keep-buy', { index: 0 }); await c('[data-action=keep-use]');
    },
    'money in → borrowed (People)': async (p, c) => {
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=tx-kind][data-kind=in]');
      await p.fill('#tx-amount', '3000'); await p.fill('#tx-note', 'Rahul'); await p.evaluate(() => document.getElementById('add-tx').requestSubmit());
      await c('[data-action=iou-start]'); await c('[data-action=iou-start-save]');
    },
    'money out → lent (People)': async (p, c) => {
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=tx-kind][data-kind=out]');
      await p.fill('#tx-amount', '3000'); await p.fill('#tx-note', 'Amit'); await p.evaluate(() => document.getElementById('add-tx').requestSubmit());
      await c('[data-action=page-open][data-key=payments]');
      await p.evaluate(() => [...document.querySelectorAll('[data-action=tx-edit]')].find((b) => /Amit/.test(b.innerText)).click()); await p.waitForTimeout(200);
      await c('[data-action=iou-start]'); await c('[data-action=iou-start-save]');
    },
    'money passed on': async (p, c) => {
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=tx-kind][data-kind=in]');
      await p.fill('#tx-amount', '26000'); await p.fill('#tx-note', 'Rahul'); await p.evaluate(() => document.getElementById('add-tx').requestSubmit());
      await c('[data-action=tx-kind][data-kind=out]'); await p.fill('#tx-amount', '26000'); await p.fill('#tx-note', 'Amit'); await p.evaluate(() => document.getElementById('add-tx').requestSubmit());
      await c('[data-action=tab][data-tab=home]'); await c('[data-action=pass-yes]');
    },
  };
  let bad = 0;
  for (const [name, flow] of Object.entries(flows)) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+05:30'));
    await page.goto(B + '#home');
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, data);
    await page.reload(); await page.waitForTimeout(500);
    const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(150); };
    const before = await snap(page);
    let mid = '';
    try {
      await flow(page, c); await page.waitForTimeout(200);
      mid = await snap(page);
      // Delete every new entry from Payments
      const ids = await page.evaluate((n) => JSON.parse(localStorage.getItem('salary-runway-v1')).transactions.slice(n).map((t) => t.id), JSON.parse(before).txs);
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=page-open][data-key=payments]');
      for (const id of ids.reverse()) await c('[data-action=tx-delete][data-id="' + id + '"]');
    } catch (e) { errors.push(String(e.message || e)); }
    const after = await snap(page);
    const ok = before === after && !errors.length;
    if (!ok) bad++;
    console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : '\n   before ' + before + '\n   added  ' + mid + '\n   after  ' + after + (errors.length ? '\n   errors ' + errors.join(' / ') : '')));
    await page.close();
  }
  return bad;
}

async function edits(browser, B) {
  const data = household();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+05:30'));
  await page.goto(B + '#home');
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, data);
  await page.reload(); await page.waitForTimeout(500);
  const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(150); };
  const S = () => page.evaluate(() => JSON.parse(localStorage.getItem('salary-runway-v1')));
  const worth = () => page.evaluate(() => Core.netWorth(JSON.parse(localStorage.getItem('salary-runway-v1')), '2026-10-26').value);
  const edit = async (note, amount) => {
    await c('[data-action=tab][data-tab=spend]'); await c('[data-action=page-open][data-key=payments]');
    await page.evaluate((n) => [...document.querySelectorAll('[data-action=tx-edit]')].find((b) => b.innerText.indexOf(n) === 0).click(), note); await page.waitForTimeout(200);
    await page.fill('#edit-amount', String(amount)); await c('[data-action=edit-save]');
    const err = await page.$eval('.edit-card .bad', (e) => e.innerText).catch(() => '');
    if (err) await c('[data-action=edit-cancel]');
    return err;
  };
  const add = async (kind, amount, note) => {
    await c('[data-action=tab][data-tab=spend]'); await c('[data-action=tx-kind][data-kind=' + kind + ']');
    if (kind === 'save') { await page.fill('#sv-amount', String(amount)); await page.fill('#sv-note', note); await page.selectOption('#sv-use', { label: 'Goal: Bike' }); await page.evaluate(() => document.getElementById('save-tx').requestSubmit()); }
    else { await page.fill('#tx-amount', String(amount)); await page.fill('#tx-note', note); await page.evaluate(() => document.getElementById('add-tx').requestSubmit()); }
    await page.waitForTimeout(150);
  };
  const w0 = await worth();
  let bad = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad++;
    console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)));
  };
  // 1. Saving into a goal, edited ₹100 → ₹150
  await add('save', 100, 'Jar'); await edit('Jar', 150);
  let s = await S(); expect('saving into a goal, 100 → 150', { saved: s.goals[0].saved, outside: s.goals[0].savedOutside, use: s.transactions.find((t) => t.note === 'Jar').useFor, worthChange: (await worth()) - w0 }, { saved: 150, outside: 150, use: 'goal', worthChange: 0 });
  // 2. Borrowed ₹3,000 from Rahul, edited → ₹4,000; then a repayment ₹1,000 edited → ₹1,500
  await add('in', 3000, 'Rahul'); await c('[data-action=tab][data-tab=home]'); await c('[data-action=iou-start]'); await c('[data-action=iou-start-save]');
  await edit('Rahul', 4000);
  s = await S(); expect('borrowed, 3000 → 4000', [s.iou.map((i) => [i.name, i.amount, i.paid]), (await worth()) - w0], [[['Rahul', 4000, 0]], 0]);
  await add('out', 1000, 'Rahul back'); await c('[data-action=page-open][data-key=payments]');
  await page.evaluate(() => [...document.querySelectorAll('[data-action=tx-edit]')].find((b) => /Rahul back/.test(b.innerText)).click()); await page.waitForTimeout(200);
  await c('[data-action=iou-pay-tx]');
  await edit('Rahul back', 1500);
  s = await S(); expect('a repayment, 1000 → 1500', s.iou.map((i) => [i.name, i.amount, i.paid]), [['Rahul', 4000, 1500]]);
  // 3. Kept ₹5,000, used ₹4,700 on a purchase; edit kept → ₹4,000 (refused) and → ₹6,000; purchase → ₹4,000
  await add('in', 5000, 'Father'); await c('[data-action=tab][data-tab=home]'); await c('[data-action=income-use][data-use=keep]'); await page.fill('#keep-name', 'Diwali'); await c('[data-action=keep-save]');
  await add('out', 4700, 'Croma'); await c('[data-action=tab][data-tab=grow]'); await c('[data-action=keep-use-open]'); await page.selectOption('#keep-buy', { index: 0 }); await c('[data-action=keep-use]');
  expect('kept money below what it paid for is refused', !!(await edit('Father', 4000)), true);
  await edit('Father', 6000);
  s = await S(); expect('kept money, 5000 → 6000', s.transactions.filter((t) => t.useFor === 'keep').map((t) => [t.amount, t.keepUsed, t.keepFor]), [[6000, 4700, 'Diwali']]);
  await edit('Croma', 4000);
  s = await S(); expect('a covered purchase, 4700 → 4000', [s.transactions.filter((t) => t.useFor === 'keep').map((t) => [t.amount, t.keepUsed]), s.transactions.filter((t) => t.note === 'Croma').map((t) => [t.amount, t.covered])], [[[6000, 4000]], [[4000, 4000]]]);
  if (errors.length) { bad++; console.log('FAIL errors: ' + errors.join(' / ')); }
  return bad;
}

(async () => {
  await new Promise((ok) => server.listen(0, ok));
  const B = 'http://localhost:' + server.address().port + '/index.html';
  const browser = await playwright.chromium.launch();
  let bad = 0;
  try {
    console.log('Add, then delete:');
    bad += await addThenDelete(browser, B);
    console.log('Edit amounts:');
    bad += await edits(browser, B);
  } finally { await browser.close(); server.close(); }
  process.exit(bad ? 1 : 0);
})();
