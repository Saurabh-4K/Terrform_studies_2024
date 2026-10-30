import test from "node:test";
import assert from "node:assert/strict";
import worker, { cleanCrash, saveCrash } from "../src/index.js";

// Workers KV, in memory.
function kv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v == null ? null : type === "json" ? JSON.parse(v.value) : v.value; },
    async put(k, value, opts) { m.set(k, { value, opts }); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const report = {
  v: 1, build: "76", day: "2026-11-01", android: "14", model: "SM-A146B", lang: "mr", screen: "393x851",
  message: "Cannot read properties of undefined (reading 'amount') paid ₹18,000 to raju@okaxis 9876543210",
  where: "app.js:3145:22", stack: "TypeError: x\n    at recordSms (app.js:3145:22)",
  screens: [{ kind: "tap", tab: "spend", page: "sms", action: "sms-read", note: "Chai with Neha" }],
  counts: { transactions: 212, cards: 1, "<b>": 3 }, state: { transactions: [{ amount: 500 }] }, note: "Priya",
};
const post = (body, env) => worker.fetch(new Request("https://x.workers.dev/crash", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), env);

test("a crash report keeps only its fields, and numbers, UPI ids and amounts are taken out again", () => {
  const r = cleanCrash(report);
  assert.deepEqual(Object.keys(r).sort(), ["android", "build", "counts", "day", "lang", "message", "model", "screen", "screens", "stack", "v", "where"]);
  assert.equal(r.message, "Cannot read properties of undefined (reading 'amount') paid ₹# to <id> #");
  assert.deepEqual(r.screens, [{ kind: "tap", tab: "spend", page: "sms", action: "sms-read" }]);
  assert.deepEqual(r.counts, { transactions: 212, cards: 1 });
  assert.equal(JSON.stringify(r).includes("Neha"), false);
  assert.equal(cleanCrash({ v: 2, message: "x" }), null);
  assert.equal(cleanCrash({ v: 1 }), null);
});

test("the same error is one record that counts; kept 90 days", async () => {
  const store = kv();
  const r = cleanCrash(report);
  await saveCrash(store, r, "2026-11-01");
  const rec = await saveCrash(store, r, "2026-11-03");
  assert.deepEqual([rec.count, rec.first, rec.last], [2, "2026-11-01", "2026-11-03"]);
  assert.equal(store.m.size, 1);
  assert.equal([...store.m.values()][0].opts.expirationTtl, 90 * 86400);
});

test("/crash needs no invite code; too big, broken or not set up is refused", async () => {
  const store = kv();
  const env = { CRASHES: store, INVITE_CODES: "a" };
  assert.equal((await post(report, env)).status, 204);
  assert.equal(store.m.size, 1);
  assert.equal((await post("x".repeat(17000), env)).status, 413);
  assert.equal((await post("{not json", env)).status, 400);
  assert.equal((await post({ hello: 1 }, env)).status, 400);
  assert.equal((await post(report, {})).status, 503);
});

test("/crashes is for the developer's key only", async () => {
  const store = kv();
  const env = { CRASHES: store, CRASH_READ_KEY: "dev-secret" };
  await post(report, env);
  const get = (key) => worker.fetch(new Request("https://x.workers.dev/crashes", { headers: key ? { "X-Admin-Key": key } : {} }), env);
  assert.equal((await get()).status, 401);
  assert.equal((await get("wrong")).status, 401);
  const res = await get("dev-secret");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.crashes.length, 1);
  assert.equal(body.crashes[0].report.model, "SM-A146B");
  // No key set on the server: nobody can read them
  assert.equal((await worker.fetch(new Request("https://x.workers.dev/crashes", { headers: { "X-Admin-Key": "" } }), { CRASHES: store })).status, 401);
});

test("crash reports only (no Anthropic key, no invite codes): the AI plan refuses everyone, crashes are kept", async () => {
  const store = kv();
  const env = { CRASHES: store };
  const plan = await worker.fetch(new Request("https://x.workers.dev/plan", { method: "POST", headers: { "X-Invite-Code": "" }, body: JSON.stringify({ facts: "x" }) }), env);
  assert.equal(plan.status, 401);
  const rates = await worker.fetch(new Request("https://x.workers.dev/rates", { method: "POST", headers: { "X-Invite-Code": "anything" } }), env);
  assert.equal(rates.status, 401);
  assert.equal((await post(report, env)).status, 204);
});
