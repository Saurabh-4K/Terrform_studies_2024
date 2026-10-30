# AI weekly plan: setup checklist

Tick each box as you go. About 15 minutes, all in a browser.

> ⚠️ **Never write the key, token or invite code in this file or any file in git.**
> Git keeps every old version forever, so a key pasted here once stays readable even after you delete it.
> They go only into **GitHub Secrets** (step 3), which nobody can read back, not even you.

---

## 1. Claude Console: your key
Open **https://platform.claude.com**

- [ ] **Limits** → set a monthly spend limit (for example `$5`), so the bill can never go above it
- [ ] **API keys** → **Create key** → copy it (it starts with `sk-ant-`)

Keep the copied key on your clipboard for step 3. Don't save it anywhere else.

---

## 2. Cloudflare: the free server
Open **https://dash.cloudflare.com** (free account)

- [ ] **Workers & Pages** → copy your **Account ID** (shown on the right side)
- [ ] **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers** → **Continue to summary** → **Create Token** → copy it

---

## 3. GitHub Secrets: where the details go
Open **https://github.com/saurabh-4k/terrform_studies_2024/settings/secrets/actions/new**

Add four secrets. For each one: copy the **Name** exactly, paste your value in **Secret**, then **Add secret**.

- [ ] Secret 1, your key from step 1:
  ```
  ANTHROPIC_API_KEY
  ```
- [ ] Secret 2, the token from step 2:
  ```
  CLOUDFLARE_API_TOKEN
  ```
- [ ] Secret 3, the Account ID from step 2:
  ```
  CLOUDFLARE_ACCOUNT_ID
  ```
- [ ] Secret 4, invite codes you make up, one per person, separated by commas, no spaces:
  ```
  INVITE_CODES
  ```
  Example value: `saurabh-x7k2q9,friend-m4p8w1`. Make each code hard to guess.

When you're done, the Secrets page should list all four names.

---

## 4. Start the server
Open **https://github.com/saurabh-4k/terrform_studies_2024/actions/workflows/ai-server.yml**

- [ ] **Run workflow** → **Run workflow** (green button)
- [ ] Wait for the green tick (about 1 minute), open the run → **deploy** → **Deploy to Cloudflare**, and find the address, which looks like:
  ```
  https://salary-runway-ai.<your-name>.workers.dev
  ```

This only starts the server. It doesn't release the app.

---

## 5. Turn it on in the app
- [ ] **Profile → AI weekly plan**
- [ ] Paste the **server address** from step 4
- [ ] Paste **your invite code** (one of the codes from secret 4)
- [ ] **Turn on the weekly plan**: the first plan is made right away

---

## 6. Crash reports (optional, about 5 minutes)
Crash reports come from people who said yes in the app. They hold no money data (see `PRIVACY.md`). The server keeps them for 90 days.

- [ ] **Cloudflare token:** it needs **Workers KV Storage: Edit** as well. The *Edit Cloudflare Workers* template usually has it; if the deploy shows *Couldn't make the crash reports storage*, edit the token and add it.
- [ ] **A key for reading them:** make a long random password, for example in a password manager. Add it as a GitHub **secret** named:
  ```
  CRASH_READ_KEY
  ```
- [ ] **Tell the app where to send them:** open **https://github.com/saurabh-4k/terrform_studies_2024/settings/variables/actions/new** and add a **variable** (not a secret, it isn't private):
  - Name: `HISAB_CRASH_URL`
  - Value: the server address from step 4, e.g. `https://salary-runway-ai.<your-name>.workers.dev`
- [ ] Run the **AI weekly plan server (deploy)** workflow again (step 4). The next app build sends crash reports there.
- [ ] To read them, in a terminal:
  ```
  curl -H "X-Admin-Key: <your CRASH_READ_KEY>" https://salary-runway-ai.<your-name>.workers.dev/crashes
  ```
  Or open Cloudflare → **Storage & Databases → KV → salary-runway-crashes**.

---

## If something goes wrong
| What you see | What to do |
|---|---|
| The workflow fails at **Deploy to Cloudflare** | Check the Cloudflare token and Account ID secrets (step 3), then run it again |
| The app says the invite code is wrong | The code in the app must match one in `INVITE_CODES` exactly |
| The app says the AI couldn't answer | Check your credits and spend limit in the Claude Console |
| The key may have leaked | Claude Console → API keys → delete it, create a new one, update secret 1 and run step 4 again |
| A friend shouldn't have access any more | Remove their code from `INVITE_CODES` and run step 4 again |

**Cost:** about ₹4 per plan, so roughly ₹15–20 a month for you. The spend limit caps it.
