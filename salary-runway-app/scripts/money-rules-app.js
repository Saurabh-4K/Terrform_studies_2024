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

/*
 * Picks a value the way a person does: the first dropdown (its group), then
 * the second (the item). sub: a CSS selector for the second dropdowns; the
 * first one holding the value is used.
 */
async function pick(page, sub, value) {
  await page.evaluate(([sel, v]) => {
    const e = [...document.querySelectorAll(sel)].find((x) => JSON.parse(x.parentNode.querySelector('.pick-main').dataset.groups).some((g) => g.i.some((i) => i[0] === v)));
    const main = e.parentNode.querySelector('.pick-main');
    main.value = String(JSON.parse(main.dataset.groups).findIndex((g) => g.i.some((i) => i[0] === v)));
    main.dispatchEvent(new Event('change', { bubbles: true }));
    window.__pickSub = e;
  }, [sub, value]);
  await page.waitForTimeout(150);
  await page.evaluate((v) => { const e = window.__pickSub; e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}

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
  // A name from the SMS made right in People: the entries follow
  await c('[data-action=tab][data-tab=debts]'); await c('[data-action=page-open][data-key=people]');
  await c('[data-action=iou-edit]'); await page.fill('#ie-name', 'Rahul Patil'); await c('[data-action=iou-edit-save]');
  s = await S(); expect('renamed in People', [s.iou.map((i) => i.name), s.transactions.filter((t) => t.iouId || t.iouPay).map((t) => t.note)], [['Rahul Patil'], ['Rahul Patil', 'Rahul back']]);
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

// A repayment to someone never takes over an unrelated purchase of the same amount.
async function iouLink(browser, B) {
  const data = household();
  data.transactions.push({ id: 'croma', date: '2026-10-25', amount: 3000, category: 'Shopping', note: 'Croma' });
  data.iou = [{ id: 'iou1', name: 'Rahul', dir: 'owe', amount: 3000, paid: 0, promised: '2026-10-26', created: '2026-10-20', payments: [] }];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+05:30'));
  await page.goto(B + '#home');
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, data);
  await page.reload(); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-action=iou-all][data-iou=iou1]').click()); await page.waitForTimeout(200);
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('salary-runway-v1')));
  const ok = !s.transactions.find((t) => t.id === 'croma').iouPay && s.transactions.some((t) => t.iouPay === 'iou1' && t.note === 'Rahul');
  console.log((ok ? 'OK   ' : 'FAIL ') + 'repaying Rahul ₹3,000 leaves a ₹3,000 Croma purchase as spending');
  await page.close();
  return ok ? 0 : 1;
}

/*
 * Categories picked in the notification pop-up: the app saves them when it
 * opens, and each must land where the same choice in the app does (People,
 * a saving place, a card, "not a payment"), then undo cleanly on delete.
 * HisabTestSms stands in for the phone's store of pop-up answers.
 */
async function notifications(browser, B) {
  const data = household();
  data.smsAlerts = true;
  data.cards = [{ id: 'c1', name: 'HDFC', last4: '6645', limit: 100000, dueDay: 5, statementDay: 15 }];
  data.iou = [{ id: 'iou1', name: 'Rahul', dir: 'lent', amount: 5000, paid: 0, promised: null, created: '2026-10-20', payments: [] }];
  const alert = (o) => Object.assign({ key: 'k' + Math.random().toString(36).slice(2), date: '2026-10-26', body: '', status: 'confirmed' }, o);
  const cases = {
    'spend, Food & dining': [alert({ type: 'debit', amount: 500, merchant: 'ZOMATO', category: 'Food & dining' }),
      (s) => s.transactions.some((t) => t.note === 'ZOMATO' && t.category === 'Food & dining' && !t.kind && !t.needsReview)],
    'spend, Family': [alert({ type: 'debit', amount: 2000, merchant: 'PRIYA', category: 'Family' }),
      (s) => s.transactions.some((t) => t.note === 'PRIYA' && t.category === 'Family' && Core.isFlexible(t))],
    'Savings → a saving place': [alert({ type: 'debit', amount: 1000, merchant: 'JAR', category: 'Savings' }),
      (s) => s.transactions.some((t) => t.note === 'JAR' && t.kind === 'move' && !!t.useFor)],
    'paid with a card': [alert({ type: 'debit', amount: 800, merchant: 'AMAZON', category: 'Shopping', cardId: 'c1' }),
      (s) => s.transactions.some((t) => t.note === 'AMAZON' && t.paidFrom === 'c1')],
    'Lent to someone → People': [alert({ type: 'debit', amount: 3000, merchant: 'AMIT', category: '@lent' }),
      (s) => s.iou.some((i) => i.name === 'AMIT' && i.dir === 'lent' && i.amount === 3000) && s.transactions.some((t) => t.note === 'AMIT' && t.iouId)],
    'Borrowed from someone → People': [alert({ type: 'credit', amount: 4000, merchant: 'SUNIL', category: '@borrowed' }),
      (s) => s.iou.some((i) => i.name === 'SUNIL' && i.dir === 'owe' && i.amount === 4000) && s.transactions.some((t) => t.note === 'SUNIL' && t.iouId && t.useFor === 'spend')],
    'Rahul paying back → People': [alert({ type: 'credit', amount: 2000, merchant: 'RAHUL K', category: '@iou:iou1' }),
      (s) => s.iou.find((i) => i.id === 'iou1').paid === 2000 && s.transactions.some((t) => t.note === 'RAHUL K' && t.iouPay === 'iou1')],
    'Loan or Pay Later → borrowed': [alert({ type: 'credit', amount: 10000, merchant: 'KREDITBEE', category: 'Loan or Pay Later' }),
      (s) => s.transactions.some((t) => t.note === 'KREDITBEE' && t.borrowed)],
    'Gift → asks what it should do': [alert({ type: 'credit', amount: 1500, merchant: 'FATHER', category: 'Gift' }),
      (s) => s.transactions.some((t) => t.note === 'FATHER' && t.kind === 'in' && !t.useFor)],
    'not tapped, then Lent in Needs your check': [alert({ type: 'debit', amount: 3000, merchant: 'AMIT', category: 'Misc', status: 'new' }),
      (s) => s.iou.some((i) => i.name === 'AMIT' && i.dir === 'lent' && i.amount === 3000) && s.transactions.some((t) => t.note === 'AMIT' && t.iouId && !t.needsReview),
      async (page) => {
        await page.evaluate(() => document.querySelector('[data-action=tab][data-tab=spend]').click()); await page.waitForTimeout(200);
        await pick(page, '.check-card select[data-tx-cat]', '@lent');
        await page.waitForTimeout(200);
      }],
    'money in, then "Rahul paying back" in Payments': [alert({ type: 'credit', amount: 1000, merchant: 'RAHUL K', category: 'Money received', status: 'new' }),
      (s) => s.iou.find((i) => i.id === 'iou1').paid === 1000 && s.transactions.some((t) => t.note === 'RAHUL K' && t.iouPay === 'iou1' && t.useFor === 'spend'),
      async (page) => {
        await page.evaluate(() => document.querySelector('[data-action=tab][data-tab=spend]').click()); await page.waitForTimeout(200);
        await page.evaluate(() => document.querySelector('[data-action=page-open][data-key=payments]').click()); await page.waitForTimeout(200);
        await pick(page, 'select[data-tx-cat]', '@iou:iou1');
        await page.waitForTimeout(200);
      }],
    'card refund → the purchase gets smaller': [alert({ type: 'credit', amount: 500, merchant: 'CROMA', category: 'Refund', cardId: 'c1' }),
      (s) => s.transactions.some((t) => t.note === 'CROMA' && t.amount === 1000 && (t.refunds || []).length === 1) && !s.transactions.some((t) => t.kind === 'in' && t.note === 'CROMA'),
      null,
      async (page) => {
        await page.evaluate(() => document.querySelector('[data-action=tab][data-tab=spend]').click()); await page.waitForTimeout(150);
        await page.evaluate(() => document.querySelector('[data-action=page-open][data-key=payments]').click()); await page.waitForTimeout(150);
        await page.evaluate(() => [...document.querySelectorAll('[data-action=tx-edit]')].find((b) => /CROMA/.test(b.innerText)).click()); await page.waitForTimeout(200);
        await page.evaluate(() => document.querySelector('[data-action=refund-undo]').click()); await page.waitForTimeout(200);
      }],
    'Not a payment → never offered again': [alert({ type: 'debit', amount: 99, merchant: 'OFFER', category: 'Misc', status: 'ignored' }),
      (s, a) => !s.transactions.some((t) => t.note === 'OFFER') && (s.smsIgnored || []).indexOf(a.key) !== -1],
  };
  const snap = (page) => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('salary-runway-v1')); const t = '2026-10-26';
    const r = Core.projectRunway(s, t);
    return JSON.stringify({ fund: s.savings.emergencyBalance, invest: s.savings.investSaved || 0, goal: [s.goals[0].saved, s.goals[0].savedOutside || 0],
      people: (s.iou || []).map((i) => [i.name, Core.iouLeft(i)]), worth: Core.netWorth(s, t).value, limit: Math.round(r.dailyAllowance), balance: r.balanceToday, txs: s.transactions.length });
  });
  let bad = 0;
  // The pop-up's lists: People choices sit with the categories.
  {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.HisabTestSms = { synced: null, getAlerts: () => Promise.resolve({ items: [] }), removeAlerts: () => Promise.resolve(),
        syncAlerts: (x) => { window.HisabTestSms.synced = x; return Promise.resolve(); } };
    });
    await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+05:30'));
    await page.goto(B + '#home');
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, data);
    await page.reload(); await page.waitForTimeout(500);
    const lists = await page.evaluate(() => window.HisabTestSms.synced);
    const ok = !!lists && lists.categories.indexOf('@lent') !== -1 && lists.categories.indexOf('Family') !== -1 && lists.categories.indexOf('Savings') !== -1 &&
      lists.incomeCategories.indexOf('@borrowed') !== -1 && lists.incomeCategories.indexOf('@iou:iou1') !== -1 &&
      lists.incomeCategoryLabels[lists.incomeCategories.indexOf('@iou:iou1')] === 'People › Rahul paying back (₹5,000 left)' &&
      // A short list: categories without their subcategories (the shop's comes by itself), and the choices that do something
      lists.categories.indexOf('Bills') !== -1 && !lists.categories.some((c) => c.indexOf('|') !== -1) && lists.categories.indexOf('@loan:pl') !== -1 && lists.incomeCategories.indexOf('@refund') !== -1 &&
      lists.categories.length === lists.categoryLabels.length && lists.incomeCategories.length === lists.incomeCategoryLabels.length;
    if (!ok) bad++;
    console.log((ok ? 'OK   ' : 'FAIL ') + 'pop-up lists include People' + (ok ? '' : '\n   ' + JSON.stringify(lists)));
    await page.close();
  }
  data.transactions.push({ id: 'croma', date: '2026-10-25', amount: 1500, category: 'Shopping', note: 'CROMA', paidFrom: 'c1', source: 'sms' });
  for (const [name, [a, check, then, undo]] of Object.entries(cases)) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.HisabTestSms = { getAlerts: () => Promise.resolve({ items: JSON.parse(localStorage.getItem('test-alerts') || '[]') }),
        removeAlerts: () => { localStorage.removeItem('test-alerts'); return Promise.resolve(); }, syncAlerts: () => Promise.resolve(),
        read: () => Promise.resolve({ messages: [] }) };
    });
    await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+05:30'));
    await page.goto(B + '#home');
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem('salary-runway-lang', 'en'); localStorage.setItem('salary-runway-tour', '1'); localStorage.setItem('salary-runway-v1', JSON.stringify(d)); }, data);
    await page.reload(); await page.waitForTimeout(500);
    const c = async (sel) => { await page.evaluate((x) => { const e = document.querySelector(x); if (!e) throw new Error('missing ' + x); e.click(); }, sel); await page.waitForTimeout(150); };
    const before = await snap(page);
    let landed = false; let mid = '';
    try {
      // The pop-up answered while the app was closed; the app opens.
      await page.evaluate((x) => localStorage.setItem('test-alerts', JSON.stringify([x])), a);
      await page.reload(); await page.waitForTimeout(600);
      if (then) await then(page);
      landed = await page.evaluate(([src, x]) => (0, eval)('(' + src + ')')(JSON.parse(localStorage.getItem('salary-runway-v1')), x), [check.toString(), a]);
      mid = await snap(page);
      const ids = await page.evaluate((n) => JSON.parse(localStorage.getItem('salary-runway-v1')).transactions.slice(n).map((t) => t.id), JSON.parse(before).txs);
      await c('[data-action=tab][data-tab=spend]'); await c('[data-action=page-open][data-key=payments]');
      if (undo) await undo(page);
      else for (const id of ids.reverse()) await c('[data-action=tx-delete][data-id="' + id + '"]');
    } catch (e) { errors.push(String(e.message || e)); }
    const after = await snap(page);
    const ok = landed && before === after && !errors.length;
    if (!ok) bad++;
    console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : '\n   landed ' + landed + '\n   before ' + before + '\n   added  ' + mid + '\n   after  ' + after + (errors.length ? '\n   errors ' + errors.join(' / ') : '')));
    await page.close();
  }
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
    console.log('Notification pop-up:');
    bad += await notifications(browser, B);
    console.log('People:');
    bad += await iouLink(browser, B);
  } finally { await browser.close(); server.close(); }
  process.exit(bad ? 1 : 0);
})();
