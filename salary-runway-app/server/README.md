# AI weekly plan server

A small Cloudflare Worker for the app's optional **AI weekly plan**. It holds your Anthropic API key (the app never contains it), lets in only people with an invite code, and asks Claude Sonnet 5.5. It stores nothing.

## What it receives
Once a week per tester (plus at most one remake a day): the app's language and a summary of numbers the app has already worked out (`Core.planFacts` in `core.js`): today's limit, zone, spending by category this week and usually, budgets, bills to come, past rounds, loans, cards and goals by the names the person gave them, fraud-check counts and amounts, and loan options. It answers with the plan in a fixed JSON format. Never SMS text, shop names, notes or account numbers. Testers can see the summary word for word in Profile → AI weekly plan → *See exactly what's sent*.

## Set it up (about 15 minutes, all in a browser)
1. **Claude Console** (platform.claude.com, separate from Claude Pro):
   - Billing → buy $5 of credits.
   - Limits → set a monthly spend limit, e.g. $5, so the bill can never be more.
   - API keys → create a key and copy it.
2. **Cloudflare** (free account at dash.cloudflare.com):
   - Copy your **Account ID** (shown on the Workers & Pages page).
   - My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** → copy the token.
3. **GitHub** → this repository → Settings → Secrets and variables → Actions → New repository secret, four times:
   - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`
   - `INVITE_CODES`: one code per tester, comma-separated, e.g. `asha-71k2,ravi-9pq4`. Make them hard to guess.
4. **Actions** tab → *AI weekly plan server (deploy)* → Run workflow. When it finishes, the log shows the address, like `https://salary-runway-ai.<your-name>.workers.dev`.
5. Give each tester the address and their own code. In the app: Profile → AI weekly plan → paste both → Turn on the weekly plan. The first plan is made right away.

To stop one tester, remove their code from `INVITE_CODES` and run the workflow again. To stop everyone, delete the key in the Claude Console.

## Change the model
`MODEL` in `wrangler.toml` (default `claude-sonnet-5-5`). Change it and run the workflow; no app update needed.

## Costs
About ₹4 per plan on Sonnet 5.5, so roughly ₹15–20 per tester per month; the spend limit caps it. Cloudflare's free plan covers 100,000 requests a day.

## Develop
`npm install`, `npm test` (request checks, no API calls), `npx wrangler dev` with `ANTHROPIC_API_KEY` and `INVITE_CODES` in a `.dev.vars` file (git-ignored).
