/*
 * The app's "AI weekly plan" server. It holds the Anthropic API key, so the
 * key is never inside the app, and it only answers people with an invite code.
 *
 * Once a week the app sends a summary of numbers it has already worked out
 * (Core.planFacts in core.js): totals, categories, the names the person gave
 * their loans, cards, budgets and goals, fraud-check counts, and loan options.
 * Never SMS text, shop names, notes or account numbers. Nothing is stored here.
 */
import Anthropic from "@anthropic-ai/sdk";

const MAX_FACTS = 12000;

// Frozen, so it is cached across requests (same bytes every time).
const SYSTEM = `You write a weekly money plan for a person using a salary budgeting app in India. The app's goal is a loan-free life: make the salary last until payday, save a little more, clear loans early, and stay safe from fraud. Many users carry EMIs and credit card debt.

The app has already worked out every number in <facts>, including the loan options. Treat them as correct and use them; never recalculate them differently or invent new figures. Only simple arithmetic on them is allowed (a difference, a total, a weekly or daily share), and when you do it, show it briefly (e.g. "₹2,230 − ₹1,140 = ₹1,090 more than usual").

Write the plan for this week:
- headline: one sentence on where they stand and the single most important thing to do this week.
- week_goal: one measurable goal the app can check next week. type is one of: spend_cap (keep flexible spending this week at or under amount), save (move at least amount to savings), extra_loan (pay at least amount extra on loans), no_card (no credit card spending; amount 0). Pick an amount they can actually reach from their numbers. text says it in plain words.
- sections, in this order, each with 1 to 3 steps. Each step: action (what to do, concrete, with a rupee amount where it helps), why (one short sentence using their numbers), amount (the rupees involved, or null).
  - save: where this week's spending was above the usual week, little leaks and small payments; name the category and a realistic cut. Protect basics: never suggest cutting groceries below need, medicine, rent or school fees.
  - loans: only if they have loans. Which loan to put extra on and how much, using the loan options in the facts. If money is tight, say to keep paying every minimum on time first.
  - fraud: always include. If the facts list payments to double-check, tell them to look at those in the app and what to do if one isn't theirs: call the bank to block the card or UPI, and report it on the National Cyber Crime Helpline 1930 or cybercrime.gov.in, quickly. Add one or two short safety habits that fit (never share an OTP or UPI PIN; a UPI PIN is only for paying, never for receiving money; banks never ask for KYC updates by call, SMS link or screen-sharing apps; avoid instant loan apps).
  - invest: only if the facts say "Ready to learn about investing: yes". Explain at most three types that fit money they won't need for years (for example PPF, fixed or recurring deposits, an index fund SIP, gold through an ETF), what each suits (how long, how risky), never naming a specific fund, stock, company, bank or platform. End the section by saying to take advice from a SEBI-registered investment adviser before investing. If not ready, leave this section out.

Rules:
- Never suggest borrowing of any kind: no loans, loan apps, credit card spending, Buy Now Pay Later, advance salary or borrowing from friends.
- Be kind and direct, never shaming. Short sentences, plain words, no jargon.
- Amounts in rupees with Indian digit grouping (₹1,23,456).
- Write every text field in the language named in <language>. Keep words like EMI, UPI, SIP, PPF, OTP, PIN and ₹ as they are.`;

const STEP = {
  type: "object",
  properties: {
    action: { type: "string" },
    why: { type: "string" },
    amount: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
  required: ["action", "why", "amount"],
  additionalProperties: false,
};

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    week_goal: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["spend_cap", "save", "extra_loan", "no_card"] },
        amount: { type: "integer" },
        text: { type: "string" },
      },
      required: ["type", "amount", "text"],
      additionalProperties: false,
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["save", "loans", "fraud", "invest"] },
          title: { type: "string" },
          steps: { type: "array", items: STEP },
        },
        required: ["kind", "title", "steps"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "week_goal", "sections"],
  additionalProperties: false,
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Invite-Code",
  "Access-Control-Max-Age": "86400",
};

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

// Checks the request and turns it into Messages API input. Exported for tests.
export function buildRequest(body, model) {
  const facts = String((body && body.facts) || "").slice(0, MAX_FACTS).trim();
  if (!facts) return { error: "No facts." };
  const lang = ["English", "Marathi", "Hindi"].includes(body.language) ? body.language : "English";
  return {
    params: {
      model,
      max_tokens: 16000,
      system: SYSTEM,
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [{ role: "user", content: `<facts>\n${facts}\n</facts>\n<language>${lang}</language>\n\nWrite this week's plan.` }],
    },
  };
}

// The plan as the app draws it: at most 4 sections and 3 steps each, in order. Exported for tests.
export function cleanPlan(plan) {
  const order = ["save", "loans", "fraud", "invest"];
  const seen = new Set();
  const sections = (plan.sections || [])
    .filter((s) => order.includes(s.kind) && !seen.has(s.kind) && seen.add(s.kind))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((s) => ({ kind: s.kind, title: String(s.title), steps: (s.steps || []).slice(0, 3) }))
    .filter((s) => s.steps.length);
  return { headline: String(plan.headline || ""), week_goal: plan.week_goal, sections };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/plan") return reply(404, { error: "Not found" });

    const codes = String(env.INVITE_CODES || "").split(",").map((c) => c.trim()).filter(Boolean);
    const code = (request.headers.get("X-Invite-Code") || "").trim();
    if (!codes.length || !codes.includes(code)) return reply(401, { error: "invite" });

    let body;
    try { body = await request.json(); } catch (e) { return reply(400, { error: "Bad request" }); }
    const built = buildRequest(body, env.MODEL || "claude-sonnet-5-5");
    if (built.error) return reply(400, { error: built.error });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      // On a safety decline, Anthropic retries on its recommended model for that category.
      const response = await client.beta.messages.create({
        ...built.params,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") return reply(200, { plan: null, declined: true });
      if (response.stop_reason === "max_tokens") return reply(502, { error: "cut" });
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      let plan;
      try { plan = JSON.parse(text); } catch (e) { return reply(502, { error: "format" }); }
      return reply(200, { plan: cleanPlan(plan), model: response.model });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return reply(429, { error: "busy" });
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return reply(502, { error: "key" });
      if (error instanceof Anthropic.BadRequestError) return reply(502, { error: "request", detail: error.message });
      if (error instanceof Anthropic.APIError) return reply(502, { error: "api", status: error.status });
      return reply(502, { error: "network" });
    }
  },
};
