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
- diagnosis: null unless the facts say "Monthly review this time: yes". Then a short report the person should finish thinking "yes, that's exactly my situation, and this is what I'll do". Plain words, no jargon, warm and direct.
  - verdict: one honest sentence on their money right now (for example: "Your salary covers everything, but nothing is left for surprises").
  - causes: 2 or 3, the root causes behind the HEALTH CHECK, not its symptoms. title: a few words. text: 2 to 4 sentences with the evidence from the facts (the rupee figures and shares), and why it matters for them. Never contradict the health check.
  - actions: exactly 3, in order, for the money ladder step the facts name. action: what to do. how_much: rupees a month or once (or null). by_when: a month or a simple time ("from this payday", "by March 2027"). changes: what it changes, quoting only the WHAT IF numbers (for example "7 days of safety in 5 months instead of never"). Use money that frees up (an EMI ending) where the facts show it. If the facts list last month's checks, the first cause or action says plainly how they went.
  - checks: 2 or 3 targets for next month that their numbers will show (for example "₹5,500 in the emergency fund", "no card spending").
- week_goal: one measurable goal the app can check next week. type is one of: spend_cap (keep flexible spending this week at or under amount), save (move at least amount to savings), extra_loan (pay at least amount extra on loans), no_card (no credit card spending; amount 0). Pick an amount they can actually reach from their numbers. text says it in plain words.
- sections, in this order, each with 1 to 3 steps. Each step: action (what to do, concrete, with a rupee amount where it helps), why (one short sentence using their numbers), amount (the rupees involved, or null), basis ("numbers" when it rests on the facts; "general" when it is general guidance from your own knowledge that they should check).
  - advisor: only when the facts say "Monthly review this time: yes". Here you act as a careful financial adviser for India and may use your own knowledge, not only the facts: the two or three things that matter most for their situation and their ladder step, beyond what the other sections say (for example: ask the bank to convert a costly card balance to a lower-rate EMI; paying only a card's minimum costs the most interest and hurts the credit score; term insurance before investing if anyone depends on their income; checking which tax regime suits them; what a loan's rate and processing fee should not exceed). Mark each step's basis. Never state a current interest rate, tax slab, tax limit or scheme rate as a fact unless it is in OFFICIAL FIGURES in the facts: quote those with their period and source (for example "inflation was 4.8% in Sep 2026, per mospi.gov.in"), and use them where they help (money earning less than inflation loses value). For anything else, say to check the current figure on the official site. Suggest areas of investing (such as an index fund SIP for money not needed for 5 years or more) only when the ladder step is 6.
  - save: where this week's spending was above the usual week, little leaks and small payments; name the category and a realistic cut. Protect basics: never suggest cutting groceries below need, medicine, rent or school fees.
  - loans: only if they have loans. Which loan to put extra on and how much, using the loan options in the facts. If money is tight, say to keep paying every minimum on time first.
  - fraud: always include. If the facts list payments to double-check, tell them to look at those in the app and what to do if one isn't theirs: call the bank to block the card or UPI, and report it on the National Cyber Crime Helpline 1930 or cybercrime.gov.in, quickly. Add one or two short safety habits that fit (never share an OTP or UPI PIN; a UPI PIN is only for paying, never for receiving money; banks never ask for KYC updates by call, SMS link or screen-sharing apps; avoid instant loan apps).
  - invest: only if the facts say "Ready to learn about investing: yes". Explain at most three types that fit money they won't need for years (for example PPF, fixed or recurring deposits, an index fund SIP, gold through an ETF), what each suits (how long, how risky), never naming a specific fund, stock, company, bank or platform. End the section by saying to take advice from a SEBI-registered investment adviser before investing. If not ready, leave this section out.

Rules:
- Never suggest new borrowing: no loans to spend or invest, loan apps, credit card spending, Buy Now Pay Later, advance salary or borrowing from friends. The one exception, in the advisor section only: moving a costly balance to a cheaper one (a card balance to a lower-rate EMI, or a balance transfer), only if it costs less after all fees and they stop using that card. You may say what rate or fee is too high.
- Never name a bank, lender, card, fund house, fund, insurer, policy, broker, app, company or person. The names the person gave their own loans, cards and goals in the facts may be used.
- Be kind and direct, never shaming. Short sentences, plain words, no jargon.
- Amounts in rupees with Indian digit grouping (₹1,23,456).
- Write every text field in the language named in <language>. Keep words like EMI, UPI, SIP, PPF, OTP, PIN and ₹ as they are.`;

const STEP = {
  type: "object",
  properties: {
    action: { type: "string" },
    why: { type: "string" },
    amount: { anyOf: [{ type: "integer" }, { type: "null" }] },
    basis: { type: "string", enum: ["numbers", "general"] },
  },
  required: ["action", "why", "amount", "basis"],
  additionalProperties: false,
};

// The monthly diagnosis: null on ordinary weeks.
const DIAGNOSIS = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        verdict: { type: "string" },
        causes: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"], additionalProperties: false },
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string" },
              how_much: { anyOf: [{ type: "integer" }, { type: "null" }] },
              by_when: { type: "string" },
              changes: { type: "string" },
            },
            required: ["action", "how_much", "by_when", "changes"],
            additionalProperties: false,
          },
        },
        checks: { type: "array", items: { type: "string" } },
      },
      required: ["verdict", "causes", "actions", "checks"],
      additionalProperties: false,
    },
  ],
};

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    diagnosis: DIAGNOSIS,
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
          kind: { type: "string", enum: ["direction", "advisor", "save", "loans", "fraud", "invest"] },
          title: { type: "string" },
          steps: { type: "array", items: STEP },
        },
        required: ["kind", "title", "steps"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "diagnosis", "week_goal", "sections"],
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

// The plan as the app draws it: known sections, once each, in order, at most 3 steps each. Exported for tests.
export function cleanPlan(plan) {
  const order = ["direction", "advisor", "save", "loans", "fraud", "invest"];
  const seen = new Set();
  const sections = (plan.sections || [])
    .filter((s) => order.includes(s.kind) && !seen.has(s.kind) && seen.add(s.kind))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((s) => ({ kind: s.kind, title: String(s.title),
      steps: (s.steps || []).slice(0, 3).map((st) => ({ ...st, basis: st.basis === "general" ? "general" : "numbers" })) }))
    .filter((s) => s.steps.length);
  const d = plan.diagnosis;
  const diagnosis = d && typeof d === "object" && d.verdict ? {
    verdict: String(d.verdict),
    causes: (d.causes || []).slice(0, 3).map((c) => ({ title: String(c.title || ""), text: String(c.text || "") })).filter((c) => c.text),
    actions: (d.actions || []).slice(0, 3).map((a) => ({ action: String(a.action || ""), how_much: Number.isInteger(a.how_much) ? a.how_much : null, by_when: String(a.by_when || ""), changes: String(a.changes || "") })).filter((a) => a.action),
    checks: (d.checks || []).slice(0, 3).map(String),
  } : null;
  return { headline: String(plan.headline || ""), diagnosis, week_goal: plan.week_goal, sections };
}

/*
 * Official rates, for the monthly review: searched only on Indian government
 * sites, each with the period it applies to and the page it came from. The
 * request carries nothing about the person: it's the same for everyone.
 */
export const RATE_SITES = ["rbi.org.in", "mospi.gov.in", "nsiindia.gov.in", "indiapost.gov.in", "pib.gov.in", "dea.gov.in", "finmin.nic.in", "incometaxindia.gov.in"];
// Each figure and the range a real value falls in; anything outside is a misread.
export const RATE_KEYS = {
  repo_rate: [0, 15], cpi_inflation: [-5, 25], ppf: [3, 12], ssy: [3, 12], scss: [3, 12], nsc: [3, 12], po_savings: [1, 8],
};
const RATES_SCHEMA = {
  type: "object",
  properties: {
    figures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", enum: Object.keys(RATE_KEYS) },
          value: { type: "number" },
          period: { type: "string" },
          url: { type: "string" },
        },
        required: ["key", "value", "period", "url"],
        additionalProperties: false,
      },
    },
  },
  required: ["figures"],
  additionalProperties: false,
};
const RATES_SYSTEM = `Find India's latest official figures, using only the web search tool (it only searches government sites):
- repo_rate: the RBI policy repo rate, % a year.
- cpi_inflation: the latest all-India CPI (combined) inflation, year on year, %.
- ppf, ssy, scss, nsc: the current quarter's interest rates for the Public Provident Fund, Sukanya Samriddhi, the Senior Citizens' Savings Scheme and the National Savings Certificate, % a year.
- po_savings: the post office savings account rate, % a year.
For each: value as a number, period (the month, quarter or date it applies to, e.g. "Oct-Dec 2026 quarter", "Sep 2026", "from 6 Aug 2026"), and url: the address of the page you found it on, exactly as in the search results. Leave out any figure you can't find on those pages. Never guess and never use what you remember: an old figure is worse than none.`;

// Keeps only figures from the government sites, found in this search, with a believable value. Exported for tests.
export function cleanRates(out, seen) {
  const host = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.hostname.toLowerCase() : ""; } catch (e) { return ""; } };
  const official = (u) => RATE_SITES.some((s) => host(u) === s || host(u).endsWith("." + s));
  const done = new Set();
  return ((out && out.figures) || []).filter((f) => {
    const range = RATE_KEYS[f.key];
    if (!range || done.has(f.key) || typeof f.value !== "number" || !(f.value >= range[0] && f.value <= range[1])) return false;
    if (!official(f.url)) return false;
    // A page Claude really found, not one it made up.
    if (seen && seen.size && !seen.has(String(f.url).replace(/\/+$/, ""))) return false;
    done.add(f.key);
    return true;
  }).map((f) => ({ key: f.key, value: Math.round(f.value * 100) / 100, period: String(f.period || "").slice(0, 60), url: f.url }));
}

// Every page the searches returned, wherever they sit in the response.
export function seenUrls(content) {
  const seen = new Set();
  const walk = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if ((x.type === "web_search_result" || x.type === "web_search_result_location") && x.url) seen.add(String(x.url).replace(/\/+$/, ""));
    Object.values(x).forEach(walk);
  };
  walk(content);
  return seen;
}

async function officialRates(env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const params = {
    model: env.MODEL || "claude-sonnet-5-5",
    max_tokens: 8000,
    system: RATES_SYSTEM,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, allowed_domains: RATE_SITES }],
    output_config: { effort: "low", format: { type: "json_schema", schema: RATES_SCHEMA } },
    messages: [{ role: "user", content: "Find the latest official figures." }],
  };
  let response = await client.messages.create(params);
  const content = [];
  // A long search can pause; send the paused turn back as it is to continue (twice at most).
  for (let i = 0; response.stop_reason === "pause_turn" && i < 2; i++) {
    content.push(...response.content);
    response = await client.messages.create({ ...params, messages: [params.messages[0], { role: "assistant", content: response.content }] });
  }
  content.push(...response.content);
  const texts = response.content.filter((b) => b.type === "text").map((b) => b.text);
  let out = null;
  for (let i = texts.length - 1; i >= 0 && !out; i--) { try { out = JSON.parse(texts[i]); } catch (e) { /* narration, not the answer */ } }
  return cleanRates(out, seenUrls(content));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/plan" && url.pathname !== "/rates")) return reply(404, { error: "Not found" });

    const codes = String(env.INVITE_CODES || "").split(",").map((c) => c.trim()).filter(Boolean);
    const code = (request.headers.get("X-Invite-Code") || "").trim();
    if (!codes.length || !codes.includes(code)) return reply(401, { error: "invite" });

    if (url.pathname === "/rates") {
      try {
        return reply(200, { rates: await officialRates(env), fetched: new Date().toISOString().slice(0, 10) });
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError) return reply(429, { error: "busy" });
        return reply(502, { error: "rates" });
      }
    }

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
