// Checks a problem report's numbers (a report "with numbers"): every screen's formulas run on
// the person's data, on the report's day, and must agree with each other. Prints the numbers and
// anything that doesn't add up; never prints names or notes.
//   node scripts/check-report.js HisabSe-report-….json
// Reports hold a person's amounts: keep them out of the repo and delete them once fixed.
const fs = require('fs');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'core.js'));

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/check-report.js <report.json>'); process.exit(1); }
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!report.state) { console.error('This report has no numbers (errors only).'); process.exit(1); }
const s = Core.cleanState(JSON.parse(JSON.stringify(report.state)));
const T = report.today || String(report.made).slice(0, 10);
const R = (n) => (n < 0 ? '−' : '') + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
const problems = [];
const bad = (what, detail) => problems.push(what + (detail ? ': ' + detail : ''));
const finite = (name, obj) => Object.keys(obj || {}).forEach((k) => { if (typeof obj[k] === 'number' && !Number.isFinite(obj[k])) bad(name + '.' + k + ' is ' + obj[k]); });

const r = Core.projectRunway(s, T);
const z = Core.zoneStatus(s, T, r);
const road = Core.roadToPayday(s, T);
const road0 = Core.roadToPayday(s, T, { daily: 0 });
const fe = Core.feasibility(s, T);
const nw = Core.netWorth(s, T);
const cu = Core.cutOptions(s, T);
const wt = Core.weekTarget(s, T);
[['runway', r], ['zone', z], ['road', road], ['feasibility', fe], ['net worth', nw], ['cuts', cu], ['week', wt]].forEach(([n, o]) => finite(n, o));

console.log('Report ' + path.basename(file) + ' · day ' + T + ' · build ' + report.build);
console.log('Round ' + r.cycle.start + ' to ' + r.cycle.next + ' · ' + r.remainingDays + ' days after today');
console.log('Balance ' + R(r.balanceToday) + ' · kept ' + R(r.kept) + ' · payments still due ' + R(r.billsAhead) + ' (due now ' + R(r.dueTotal) + ')');
console.log('Today\'s limit ' + R(r.dailyAllowance) + ' (by money ' + R(r.limit.byMoney) + ', by budget ' + R(r.limit.byBudget) + ') · spent today ' + R(r.spentToday) + ' · this round ' + R(r.spentToDate));
console.log('Zone ' + z.zone + (z.cause ? ' (' + z.cause + ')' : '') + ' · short for payments ' + R(z.billsShort) + ' · with basics ' + R(z.shortBy) + ' · basics ' + R(z.essentialPerDay) + '/day');
console.log('Road: usual ' + R(road.rates.usual) + '/day · lowest ' + R(road.lowest.amount) + ' on ' + road.lowest.date + ' · day before payday ' + R(road.end) +
  (road.short ? ' · first short: ' + (road.short.name ? 'a payment' : 'everyday spending') + ' on ' + road.short.date + ' by ' + R(road.short.amount) : ''));
console.log('Until payday (review): ' + fe.status + ' · available ' + R(fe.available) + ' · essentials ' + R(fe.essentials) + (fe.shortBy ? ' · short ' + R(fe.shortBy) : ''));
console.log('Week target ' + R(wt.cap) + ' = spent ' + R(wt.spent) + ' + ' + R(wt.daily) + ' × ' + wt.days + (wt.daysAfter ? ' + ' + R(wt.nextDaily) + ' × ' + wt.daysAfter : ''));
console.log('Net worth ' + R(nw.value) + ' · cuts offered ' + cu.cuts.length + (cu.protected.length ? ' · protected left alone ' + cu.protected.length : ''));

// The screens must agree with each other
if (Math.abs(r.dailyAllowance - Math.min(r.limit.byMoney, r.limit.byBudget)) > 0.01) bad('limit is not the smaller of money and budget');
if (r.remainingDays > 0 && r.dailyAllowance < 1 && z.zone === 'green') bad('limit ₹0 but zone green');
if (z.zone === 'red' && z.cause === 'bills' && r.kept === 0 && -road0.lowest.amount !== z.billsShort) bad('road with no spending ≠ red zone payments shortfall', R(-road0.lowest.amount) + ' vs ' + R(z.billsShort));
if (z.billsShort > 0 && !road0.short) bad('payments short on Runway, but no payment short on the road');
if (fe.status === 'short' && z.zone !== 'red') bad('review says short, Runway zone is ' + z.zone);
if (z.zone === 'red' && fe.status === 'ok') bad('Runway is red, review says essentials are covered');
if (wt.cap !== Math.round((wt.spent + wt.daily * wt.days + wt.nextDaily * wt.daysAfter) / 10) * 10) bad('week target doesn\'t add up');
cu.cuts.concat(cu.protected).forEach((c) => { if (c.toPayday !== Math.round(((c.daily - c.keep) * cu.days) / 10) * 10) bad('a cut doesn\'t add up', JSON.stringify(c)); });
if (nw.value !== Math.round(nw.own - nw.owe)) bad('net worth ≠ own − owe');

// The data itself
const twins = Core.fixedTwins(s, T);
if (twins.length) bad(twins.length + ' payment(s) counted twice (fixed payment marked paid and also in from the bank)', twins.map((x) => R(x.paid.amount) + ' on ' + x.paid.date).join(', '));
const keys = {};
s.transactions.forEach((t) => { if (t.smsKey) keys[t.smsKey] = (keys[t.smsKey] || 0) + 1; });
const dupKeys = Object.keys(keys).filter((k) => keys[k] > 1);
if (dupKeys.length) bad(dupKeys.length + ' bank SMS recorded more than once');
const same = {};
s.transactions.filter((t) => Core.isFlexible(t) && t.amount >= 200).forEach((t) => { const k = t.date + '|' + t.amount + '|' + Core.normalizeMerchant(t.note); same[k] = (same[k] || 0) + 1; });
const sameDay = Object.keys(same).filter((k) => same[k] > 1);
if (sameDay.length) console.log('Note: ' + sameDay.length + ' same-day same-amount same-place payment(s) of ₹200+ (could be real, could be a double): ' + sameDay.map((k) => R(Number(k.split('|')[1])) + ' on ' + k.split('|')[0]).join(', '));
if (s.transactions.some((t) => !(t.amount > 0))) bad('a payment of ₹0 or less');
if (s.transactions.some((t) => t.date > T)) bad('payments dated after the report\'s day');
(s.debts || []).forEach((d) => { if (Number(d.minPayment) > Number(d.balance) && Number(d.balance) > 0) bad('an EMI bigger than what\'s left on its loan'); });

console.log(problems.length ? '\nPROBLEMS (' + problems.length + '):\n  ' + problems.join('\n  ') : '\nAll numbers agree.');
process.exitCode = problems.length ? 1 : 0;
