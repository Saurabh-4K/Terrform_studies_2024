import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildRequest, cleanPlan, PLAN_SCHEMA } from "../src/index.js";

test("builds a Sonnet request with a fixed plan format and the facts", () => {
  const r = buildRequest({ facts: "Today's limit: ₹290", language: "Marathi" }, "claude-sonnet-5-5");
  assert.equal(r.params.model, "claude-sonnet-5-5");
  assert.equal(r.params.output_config.format.type, "json_schema");
  assert.equal(r.params.output_config.format.schema, PLAN_SCHEMA);
  assert.match(r.params.messages[0].content, /<facts>\nToday's limit: ₹290\n<\/facts>/);
  assert.match(r.params.messages[0].content, /<language>Marathi<\/language>/);
});

test("rejects empty facts, trims long ones, and defaults the language", () => {
  assert.ok(buildRequest({}, "m").error);
  const r = buildRequest({ facts: "x".repeat(50000), language: "Klingon" }, "m");
  assert.ok(r.params.messages[0].content.length < 12200);
  assert.match(r.params.messages[0].content, /<language>English/);
});

test("every object in the schema is closed, as structured outputs need", () => {
  const walk = (s) => {
    if (s.type === "object") { assert.equal(s.additionalProperties, false); Object.values(s.properties).forEach(walk); }
    if (s.items) walk(s.items);
    (s.anyOf || []).forEach(walk);
  };
  walk(PLAN_SCHEMA);
});

test("the plan is cleaned to known sections, in order, at most 3 steps each", () => {
  const step = { action: "a", why: "b", amount: null };
  const p = cleanPlan({
    headline: "h", week_goal: { type: "save", amount: 500, text: "t" },
    sections: [
      { kind: "fraud", title: "F", steps: [step] },
      { kind: "save", title: "S", steps: [step, step, step, step] },
      { kind: "save", title: "dup", steps: [step] },
      { kind: "crypto", title: "X", steps: [step] },
      { kind: "loans", title: "L", steps: [] },
    ],
  });
  assert.deepEqual(p.sections.map((s) => s.kind), ["save", "fraud"]);
  assert.equal(p.sections[0].steps.length, 3);
});

test("no invite code, no plan", async () => {
  const res = await worker.fetch(new Request("https://x.dev/plan", { method: "POST", body: "{}", headers: { "X-Invite-Code": "nope" } }), { INVITE_CODES: "a,b" });
  assert.equal(res.status, 401);
  const res2 = await worker.fetch(new Request("https://x.dev/ask", { method: "POST" }), { INVITE_CODES: "a" });
  assert.equal(res2.status, 404);
});
