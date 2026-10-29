# Hisab Se: complete feature list

*Hisab Se was called Salary Runway until October 2026. The app ID stays `com.salaryrunway.app`, so updates keep your data.*

Everything the app can do today, screen by screen, with the rules it follows. For installing and the code, see [README.md](README.md).

**The goal:** make the salary last until the next payday without touching ₹0, stay out of the credit card trap, and move towards a loan-free life.

**Contents**
1. [Privacy and your data](#1-privacy-and-your-data)
2. [Plan tab: setting up your month](#2-plan-tab-setting-up-your-month)
3. [Payday check-in](#3-payday-check-in)
4. [Runway tab: where you stand today](#4-runway-tab-where-you-stand-today)
5. [Spend tab: recording money in and out](#5-spend-tab-recording-money-in-and-out)
6. [Bank SMS reading](#6-bank-sms-reading)
7. [Money received](#7-money-received)
8. [Daily savings: "you saved ₹58 today"](#8-daily-savings-you-saved-58-today)
9. [Bills that vary](#9-bills-that-vary)
10. [Credit cards](#10-credit-cards)
11. [Debts tab: loans and payoff plans](#11-debts-tab-loans-and-payoff-plans)
12. [Grow tab: safety nets and saving](#12-grow-tab-safety-nets-and-saving)
13. [Spending insights](#13-spending-insights)
14. [Android app extras](#14-android-app-extras)
15. [Design and behaviour principles](#15-design-and-behaviour-principles)
16. [Regulatory design](#16-regulatory-design)
17. [Current limits](#17-current-limits)

---

## Look and feel
- **Colour means something.** Screens stay calm cream and teal. The zone colours (green, careful, red), coral warnings and badges appear only when something needs you, so a red card can't be missed. Category colours never use amber or coral.
- **Solid icons:**
  - The grid icons are filled glyphs on a soft tile. A tile turns coral only when its badge is a warning (*2 due*, *3 over*).
  - Payments show a category icon in a soft circle: cart for Groceries, fork and knife for Food & dining, car for Travel, and so on. Money in and saved show in green.
- **Runway extras:**
  - a greeting (*Good morning*)
  - soft light rays on the hero card, in every zone colour
  - **This week:** a bar per day against that day's limit (dashed). A day over the limit is coral with *OVER* written on it; tap a day for its numbers, or see them as a table.
  - **Recent payments:** the latest four, with *See all*
- **Payments** (Spend → Records): rows with icon, name, category and date, and the amount. You can search by shop or category, and filter with pills: *All, Money out, Money in, Saved*. The category can still be changed, and a payment deleted, from the row.
- **Calendar** (Spend → Records): each day of the month shows what was spent, coral when over that day's limit, and money in, in green. Tap a day to see and edit its payments. Previous and next month are one tap away.

## Edit and undo
- **Edit a payment:** tap its name (the ✎) for an edit sheet.
  - Spending: amount, date, where or what, category and paid from.
  - Money received or saved: amount, date and note. A fund or loan it went to is corrected with it: ₹5,000 to a loan changed to ₹3,000 puts ₹2,000 back on the loan.
  - Bill and card payments: only the note. Their amount is tied to the bill's learned amount or the card's statement, and the sheet says so.
  - A new category for a shop is remembered for its next payments.
- **Undo:** after a delete or an edit, *Deleted · UNDO* (or *Saved · UNDO*) shows for six seconds. Undo brings back exactly what was there, including anything the payment had changed. If something else was changed since, it says it's too late, rather than undoing that too.

## Wallets and split payments
- **Wallets (Plan → Wallets):** where the money sits, as well as how much there is.
  - Types: the main bank account, other bank accounts, Cash, and UPI wallets such as Paytm.
  - Each has its own balance. The runway, today's limit and the zones still use all of it together, so nothing about the daily number changes.
  - **Move money** between wallets (an ATM withdrawal, topping up Paytm). A move is never spending and never changes the total.
  - **Update balances:** enter each wallet's balance from the start of today; together they set the total the runway starts from. With wallets, the balance fields in Plan and on Runway → Balance ask for all the money together.
  - Removing a wallet moves its payments and its money back to the main account, with undo.
- **Cash:** with a Cash wallet, an ATM withdrawal (by SMS too) moves money into Cash, and what you note as paid in cash comes out of it. Without one, an ATM withdrawal still counts as spent, as before, so nobody who doesn't note cash spends loses track of it.
- **Bank SMS to the right wallet:** add a bank account's last 4 digits and its SMS (*a/c XX1234*) are put in that wallet by themselves.
- **Paid from / Into:** the add form and the edit sheet offer each wallet as well as credit cards. Rows show the wallet, and moves show *Main bank account → Cash*.
- **Split a payment:** in the edit sheet, *Split this payment into categories*. For example, ₹530 at Blinkit becomes ₹380 groceries and ₹150 household. It saves only when the parts add up. Each part becomes its own payment, marked *Split*, so budgets, charts and leaks count each part in its own category. Undo puts it back as one payment.

## Cover, keep, goals and net worth
- **Cover an overspend (Runway → Budgets):** a budget that's over shows *Cover it from another budget*. Pick a budget with money left and the amount (filled in with what's needed). The month's total stays the same, so today's limit doesn't change; rows show *₹700 covered in* and *given to cover others*. Undo works, and moves belong to their own month.
- **Keep what's left for next month (Plan → Flexible budgets):** a tick per budget, for costs that come and go (clothes, gifts). What it doesn't use this month is added to it next month (*₹800 kept from last month*). Only a leftover carries; an overspend already came out of the money.
- **Savings goals (Grow → Savings goals):** a name, the amount needed, a date and what's saved so far. The app works out what to put aside each payday to get there in time: it comes out of the salary before the flexible budgets, like yearly costs, and is added to the goal on payday.
  - A goal added after payday starts at the next payday, so this month's budgets don't shrink for money that would never reach it.
  - Change *Saved so far* or the date any time; this month's amount stays and the new one counts from next payday.
  - If the date passes before it's reached, nothing more is put aside and the goal asks for a new date (the tile shows a warning badge).
  - Goals show in the plan summary, the payday screen and Grow's set-asides.
- **Fixed payments, recorded as paid:** a fixed payment (rent, a class fee) is expected on its due day. Paid early, late or a different amount? Record it, and it counts once, on the day it really left, at the amount really paid; that due date isn't counted again. Three ways:
  - *Runway → Coming up*: **Mark paid** on the item (amount and date).
  - An SMS payment with the same amount (within 2%) from 10 days before to 15 days after the due date: the Runway and Spend tabs ask *Is ₹9,000 on 28 Oct your "Data science class" payment?* **Yes** links it, **No** stops asking.
  - Any account payment's edit view: *Was this a fixed payment?* Pick which one.
  - It covers the nearest due date not yet recorded (paid on the 28th for the 1st, or on the 5th for the 1st). Next month's is still expected. Card payments aren't offered (the card bill pays them). *Not a fixed payment* in the edit view undoes it.
- **Bank and accounting rules** (cash in isn't income by itself, cash out isn't spending by itself):
  - **Loan EMIs paid by SMS**: an account payment of a loan's EMI near its due date is asked about (*Is ₹15,000 on 6 Nov your "Personal loan" EMI?*), or marked from the edit view or **Mark paid** in Coming up. It counts once, isn't daily spending, and shows the bank's split: that month's interest on what's owed, and the rest paid off the loan (*₹4,583 interest, ₹10,417 paid off the loan*). Card EMIs are paid through the card bill, so they aren't offered.
  - **Cash from an ATM on a credit card** is borrowing, not spending: the card owes it, the cash is in hand (in the Cash wallet when there is one), and it counts as spending when the cash is spent. It shows *Cash on credit card* and a warning that banks usually charge interest from that day plus a fee.
  - **Money back from your own savings** (an FD, the emergency fund, investments): *It came from my emergency fund* or *It came from my savings or investments*. The fund goes down by it and net worth stays the same: it's yours already, not new money.
  - **Earned income is kept apart from money in**: only salary, overtime, side income, bonus and interest are earned. Loans, money from friends, refunds, reimbursements, gifts, money of unknown kind and your own money are money in, never earned. The weekly plan gets both.
- **Maybe expenses (Runway → Maybe expenses):** costs that may come, like a wedding gift, a bike repair or a doctor's visit. Add what, about how much, roughly when (*Next week*, *Next month* or a date) and how likely.
  - *Likely*: the money is held from today's limit until payday, so you're ready if it comes. The balance and net worth don't change; *How is this calculated?* shows what's held. A likely cost next round lowers next payday's free money instead.
  - *Maybe*: nothing changes, but the page shows today's limit if the maybe ones come.
  - *Unlikely*: only listed.
  - None is counted at half: a cost comes in full or not at all.
  - When the date passes, the Runway asks *Did it come?* **Yes** links the payment (or adds it): it shows in reports with an *Expected cost* chip but isn't daily spending, because its money was held. **No** frees the money. Deleting the payment opens the cost again; *Undo* reopens an answer.
  - Over time the page shows how good the guesses were per likelihood (*came 7 of 10 times, cost 120% of the guess*), and the weekly plan gets the list and the "if they come" limit.
- **Reimbursements (Spend → Reimbursements):** a payment your office or a client pays back (work cab, client lunch). Open it and tap *Paid for work? Mark it reimbursable*: set how much comes back (all of it by default), who pays and a claim number. The payment still leaves the balance, but the part paid back isn't your spending (budgets, today's limit, reports), and until it comes back it counts as *Owed back on work expenses* in net worth.
  - When money comes in, its card asks *Is this a reimbursement?* and lists the open claims. Matching it marks each claim *Paid back*, *Partly paid back* (the rest still owed) or, after *Close: the rest is mine*, closed: what didn't come back becomes your spending in the month it was paid.
  - Paid back more than you spent: the extra counts once. Each claim chooses where it goes: *This month's spending* (adds to today's limit) or the *Side vault* (kept apart from daily money, counted in net worth). Switching back and forth never counts it twice. Money left over across several claims shows as *not matched to a claim*.
  - Deleting the payment removes its claim; deleting or unmatching the money in makes the claim owed again; changing an amount keeps every link right. An earlier month stays as it was when the money comes later.
- **Net worth (Runway → Net worth):** what you own minus what you owe: money in the account and wallets, the emergency fund and Grow savings, less loans and card dues from before the card was added. Below zero it shows in coral with *You owe more than you own*. Kept once per round (about two years), with a chart of the last 12 rounds, the change since last round, and a table of the numbers.

## Checking with the bank, smarter SMS, reports, quick budgets, what-if
- **Balance check that reconciles:** when a new balance is entered (Runway → Balance, Plan, or Wallets → Update balances), the app first compares it with its own count since the last check.
  - Within ₹100 (or 1%): *Your count matches your bank ✓*.
  - Less in the bank: *Your bank has ₹1,500 less than the app counted*. Something wasn't noted (cash, a charge, a missed SMS). **Note it as spending** in a category, or **Leave it**.
  - More in the bank: note it as money received (a refund, cashback), or leave it.
  - A noted gap is dated the day before, so it never changes today's limit, and it doesn't count against any single day on the round board. Budgets, charts and reports see it.
  - Payments up to the check are marked as checked; editing one says that it will make the count differ from the bank.
- **Bank SMS matched to what you typed:** a bank SMS for a payment you already noted by hand (same amount, within 3 days) is linked to your entry instead of being added again. Your category and note stay, and the row shows *Bank SMS ✓*.
  - To avoid wrong matches: a different shop name only matches when it's the one candidate and ₹200 or more. Two ₹100 teas stay two payments.
  - Wrong match? In the edit screen, **Not the same payment** adds the SMS as its own payment (with undo).
  - Importing past messages: matches are linked, and payments to places you've sorted before sort themselves. Only the rest wait for you.
- **Reports (Spend → Where):** pick **This round, Last round, 3 rounds or 6 rounds**. Each category shows the change from the same stretch of time just before, but only when the app has records for all of it. Budgets scale to the period. Tap a category to see its latest payments.
- **Quick budgets (Plan → Flexible budgets):** under each budget, *Last round ₹5,900* and *Average of 3 rounds ₹5,400* show what was really spent. Tap one to use it, or set all at once. Rounds with nothing recorded don't pull the average down.
- **What if I paid more? (Debts → Debt-free plans):** a slider tries extra amounts without changing anything. It shows the debt-free date, months sooner and interest saved, each loan's finish on one line, and how much less the flexible budgets would get. **Make ₹5,000 a month my plan** saves it, with undo.

## Weekly plan (AI, optional, off by default)
Every Monday, when the app is opened, a concrete plan for the week made from the person's own numbers. Runway → *Weekly plan*; settings in Profile → *AI weekly plan*.
- **Save more:** where this week's spending ran above the usual week (the 4 weeks before), little leaks and small payments, with a realistic cut in rupees. Basics (groceries, medicine, rent, school fees) are protected.
- **Clear loans sooner:** which loan to put extra on and how much, from loan options the app works out itself (*₹2,000 more a month: debt-free 6 months sooner, about ₹14,129 less interest*). Minimums on time come first.
- **Stay safe from fraud:** always included. The app checks the last 14 days on the phone, plan on or off:
  - tiny payments of ₹10 or less (how fraudsters test a card or UPI)
  - the same amount to the same place twice in a day (₹200+)
  - a big first payment to a new place (₹5,000+ and 3× the usual payment)
  - three or more new places in one day

  Flagged payments are listed with *It's mine* (never flagged again), and what to do if not: call the bank to block the card or UPI, report on **1930** or **cybercrime.gov.in**. The tile shows a red count. The plan adds one or two safety habits (OTP and UPI PIN, fake KYC calls, instant loan apps).
- **Learn about investing:** only when the emergency fund covers 30 days of basics and no loan costs 12% a year or more. Explains types only (PPF, deposits, an index fund SIP, gold through an ETF), never a named fund, stock, company or platform, always with *General information, not advice: before investing, talk to a SEBI-registered investment adviser*. The app drops this section itself if the person isn't ready.
- **Last 4 weeks (below the plan, with the plan on or off):** each full week, Monday to Sunday: spent, days within the limit, and whether that week's goal was met (✓ / ✗). The app itself spots what's gone up or down three weeks in a row (*Food & dining up three weeks in a row: ₹800 → ₹1,100 → ₹1,400*). A week with hardly anything recorded says so, and never counts toward a trend; weeks from before daily limits were kept show "–", not zero.
  - The plan gets all of this. It also gets how hard this week's goal should be: **easier** after two missed goals in a row (close to what was actually managed), **a little harder** (about 10%) after two met in a row, otherwise about the same. Goals are kept for 8 weeks.
- **Monthly review (Runway → Monthly review):** each payday, where the long run is heading: the debt-free date with your plan and how many months it moved since last payday, net worth over the last rounds, the emergency fund in months against its target, how much of your pay you saved each round, and your goals.
  - **The money ladder**, the order money goes in as banks and planners teach it: 1 basics and every minimum with nothing new borrowed, 2 a starter fund (one month of basics), 3 loans costing 12% a year or more (costliest first), 4 the full emergency fund, 5 goals, 6 learning about investing. The app works out the step from the numbers (done steps get ✓) and shows what finishing it takes, nearest milestone first (*₹3,084 more in your emergency fund reaches 7 days of basics*). The icon shows *Step 2 of 6*.
  - **The diagnosis report** (the review page, every payday): a one-line **verdict**; the **health check** (worked out by the app, each with its number and a status in words: cash flow as a share of pay, EMIs as a share of pay the way banks measure it with over 50% too much, the safety fund in days, last round's spending and saving with 20% of pay the healthy mark, or *Not enough recorded* when under half the round's days have entries); **what's behind it** (2–3 short paragraphs naming the root causes with the evidence); **if nothing changes, and with the plan** (the app's own numbers side by side, the plan being about 5% of pay on the ladder's step, plus EMIs ending within a year and the money they free); **the plan** (3 actions, each with how much, by when and what it changes); the ladder; the adviser's view; **next month we'll check** (2–3 targets, which next month's report follows up). Everything but the health check, numbers and step is written by AI once a round with the weekly plan on, under one warning; with it off, the app's parts still show. The weekly plan itself stays short.
  - It also adds **the adviser's view**: two or three things that matter most for that step, from general money knowledge for India (a costly card balance to a lower-rate EMI, term insurance before investing if someone depends on you, checking the tax regime, what rate or fee is too high for a loan). Each point is tagged *From your numbers* or *General guidance: please check*, under *Made by AI. It can be wrong or out of date… talk to a SEBI-registered investment adviser*.
  - Its rules: no bank, lender, card, fund, insurer, broker, app or person is ever named (the app also drops any point that slips one in; the names you gave your own loans and cards are fine); no new borrowing (only moving a costly balance to a cheaper one, after fees, with the card no longer used); no current rate or tax figure stated as fact (it says to check the official site); areas to invest only on the ladder's last step.
- **One goal a week**, which the app can check: keep spending under an amount, save an amount, pay an amount extra on loans, or no card spending. Progress shows during the week (*₹1,770 spent of ₹1,800 so far*), and next week's plan opens with *✓ Last week's goal met* or *A new week, a fresh try*.
- **How it's made:** the app sends a summary (`planFacts` in `core.js`) to your server (`server/`, a Cloudflare Worker holding the Anthropic key and checking invite codes), which asks **Claude Sonnet 5.5** for the plan in a fixed format (structured output) and stores nothing. The AI treats the app's numbers as correct and shows any sum it does; it never suggests borrowing or names investment products. Declines retry on Anthropic's recommended model.
- **What's sent, once a week:** totals, the monthly review (ladder step, debt-free date, net worth by round, fund in months, share of pay saved, goals), spending by category this week and usually, the last 4 weeks week by week (spent, days within the limit, saved, extra to loans, borrowed, goals), budgets, bills to come, maybe expenses by the names given, past rounds, loans, cards and goals by the names the person gave them, fraud-check counts and amounts, loan options. **Never sent:** SMS text, shop names, notes, account or card numbers. *See exactly what's sent* shows it word for word.
- **Limits:** made automatically once a week; *Make a new plan* at most once a day. *Turn off the weekly plan* stops all sending at once. With it off, fraud checks still run on the phone.
- **Privacy statements change with it:** the top chip reads *Data on this device · AI on*, and Profile → Privacy says exactly what goes where.

## Profile, tour and app lock

### Profile (the round button at the top right)
A settings list like most apps:
- **App:**
  - **Appearance:** Same as phone, Light or Dark
  - **Language & sounds**
- **Security:**
  - **App lock**
  - **Privacy & data protection:** what the app reads and never does
- **Your data:**
  - **Backup & data:** backup file, restore, example data, erase everything; it shows the last backup date or *No backup yet*
  - **Clean up SMS imports**
- **Help:**
  - **See the app tour**
  - **About Hisab Se:** the tagline *Make your salary last*, and the build number

Back, or the phone's back button, returns to the tab you came from. These settings are no longer on the Plan tab.

### First-time tour
Seven short screens the first time the app opens, with example numbers:
1. What Hisab Se does
2. Today's limit
3. The three zones and their signs
4. Days of Freedom
5. Rounds and won days
6. The way out of debt
7. Privacy

**Skip** is on every screen, and swiping moves between them. It shows once; *Profile → See the app tour* replays it any time.

### App lock (Android)
- **Unlock** with fingerprint, face or the phone's own screen lock (PIN, pattern or password), through Android's own prompt. There's no separate app password to remember or forget.
- **The data on the phone is encrypted** while the lock is on:
  - Encryption: AES-256-GCM, with a fresh IV on every save.
  - The data key is itself encrypted by a key in the Android Keystore (the phone's secure hardware). That key can be used only within 30 seconds of unlocking.
  - A copy of the app's storage shows nothing readable.
- **Turning it on is checked before anything changes:**
  - The phone wraps the key, asks you to unlock, unwraps it and compares.
  - The app then encrypts the data, decrypts it again and compares.
  - Only then is the encrypted copy written. Any failure leaves the data exactly as it was.
- **Options:**
  - Lock again: every time you leave the app, or after 1, 5 or 15 minutes away (1 minute by default).
  - Hide amounts on the widget and in SMS notifications. The widget then shows its zone colour and sign with a lock, and the notification says only *New bank payment*, opening the app behind the lock.
  - Hide Hisab Se in recent apps and screenshots.
- **The honest risk, said before turning it on:** if the phone's screen lock is ever removed, Android deletes the key and the data can't be opened again. The lock screen then explains this and offers *Start again and restore a backup*. Turning the lock off asks you to unlock, then writes the data back unencrypted.
- A new fingerprint added later doesn't lock you out. *Erase everything* also removes the lock and its key.

### Widget in zone colours
The home-screen widget takes the zone's colour and sign:
- **Green ✨ On track**
- **Yellow ⚠️ Careful**, with dark text
- **Red 🛑 Stop: basics only**

On the two-row widget the zone replaces the app name. On the one-row widget it replaces the label under the amount. Before the app has been opened today, it stays teal.

## Layout: essentials open, the rest as icons
Every tab keeps what always matters open, and shows its other cards as small icons in groups, four to a row. Tap an icon and that card opens as its own page; **Back** (or the phone's back button) returns to the icons.
- **Always open:**
  - Runway: today's limit with the zone, and Days of Freedom
  - Spend: the form to add a payment
  - Plan: *Where the salary goes*
  - Debts: the debt journey and the interest you're losing each day
  - Grow: the emergency fund
- **Warnings never fold away:**
  - red zone options
  - card bills due
  - SMS payments to check
  - payments waiting to be sorted
  - the payday check-in
  - money received to assign
  - "how did your call go?"
  - the weekly recap
  - the backup reminder
- **Icons carry live badges** so nothing important hides: *2 due* on Bills to pay, *3 over* on Budgets, the next payday's date, the debt-free month, *3 new* on Little leaks, ✓ on Backup & data, *Next* on Calls to lenders.
- **The groups:**
  - Runway: *This month* (This round, Bills to pay, Coming up, Next payday), *Check & plan* (Big expense?, Runway graph, Budgets, Insights), *Money* (Balance, Debt-free date, Credit cards)
  - Spend: *Your spending* (Where it went, When, Month by month, Little leaks), *Records* (Payments, Bills to pay, Bank SMS)
  - Plan: *Your money* (Salary, Fixed payments, Bills that vary, Yearly costs), *Your plan* (Set aside, Flexible budgets), *Settings* (Language & sounds, Privacy, Backup & data, Clean up SMS)
  - Debts: *Your loans* (Loans to beat, Loans, Debt-free plans), *Cards & calls* (Credit cards, Calls to lenders)
  - Grow: *Save* (This month's set-aside, Yearly costs, Emergency plan), *Grow & learn* (Grow, Learn the basics)

## 1. Privacy and your data

Plan → **Your privacy** lists what the app does and never does, and each line is true of the app as built:
- **Offline by default.** The app connects to the internet only for the optional **AI weekly plan**, which is off until you turn it on; with it off, nothing is ever sent. Airplane mode changes nothing else. A unit test checks that the weekly plan is the only network call in the code. Every build is installed on an emulator with Wi-Fi and data off; the download is only updated if it opens and works normally.
- **Nothing from outside:** a content security policy stops the app's screens loading any outside script, font, image or request, and the fonts are bundled. No account, no ads, no analytics, no crash reports sent by themselves, no Google services.
- **Bank SMS** are read only when you tap *Read bank SMS* or turn on alerts. Messages from phone numbers (friends, family) are skipped in the native code, before the app sees them. Only a payment's amount, date and shop are saved, never the message.
- **Android's cloud backup and device-to-device transfer are turned off** for the app's data, so not even Google gets a copy.
- Something leaves the phone only when you share it (the AI report or a backup file), to the app you pick.
- **If the phone is lost, reset, or the app is uninstalled, the data goes with it**, unless you have a backup file. The app says so plainly.

### Backup and restore
- **Make a backup file** (Plan → Your data): choose a password (6+ characters, typed twice). The file is locked with AES-256-GCM, its key made from the password by PBKDF2-SHA256 with 210,000 rounds and a random salt. Without the password nobody can open it, not even the app. The share menu opens to save it to Google Drive, or email or WhatsApp it to yourself. The card shows the date of your last backup.
- **Restore from a backup:** pick the file; it shows the backup's date and entry count, asks for the password and replaces the data on this phone. A wrong password or a file that isn't a backup is refused with a clear message. Older plain-text backups can still be pasted in.
- **Reminder:** once a month, when there's at least two weeks of data and no backup in the last 30 days, the Runway tab suggests one (*Later* hides it for a month).
- **Erase everything**, after a confirmation, removes all of it: entries and plans, the language and view settings, the home-screen widget's numbers and queue, SMS alerts, notifications and shared files. A backup file saved elsewhere is not touched.

- **Example data:** the app opens with example numbers (₹55,000 salary, rent, a bike EMI, a credit card and a personal loan, four months of spending), clearly marked. *Start with my numbers* clears them.
- **Updates keep your data.** New versions install over the old one because the app ID and signing key never change. Uninstalling deletes the data, so make a backup file first.

## 1b. First-time setup (about 3 minutes)
*Start with my numbers* opens five short steps, each unlocking something real, with a progress bar (*Step 2 of 5 · about 3 min*). Everything is saved as you go; **Finish later** keeps your place (Plan tab: *Finish setting up · step 3 of 5*).
1. **Your salary:** monthly salary in hand and payday.
2. **Money in your account now** (₹0 is fine). → **Unlocked: today's limit** (*₹774: what you can spend today and still reach payday on 1 Nov. It gets more exact with the next steps.*)
3. **Fixed payments and savings:** rent or home loan and its day, other fixed payments, savings you could use in an emergency. → **Unlocked: Days of Freedom** (*6 · At risk · 1 more day (₹174) turns it amber*)
4. **Loans and credit cards:** each loan's name, amount left, EMI and interest (about 14% if unsure); *I have credit cards* opens the card form right after; or *No loans or cards*. → **Unlocked: debt-free date**
5. **Bank SMS** (Android): first *What we read* (bank and payment-app messages, on this phone, from today), *Why* (to record payments for you) and *What we never do* (read personal chats, keep messages that aren't payments, send your messages anywhere; they never leave the phone), then *Allow SMS reading* (Android asks for permission) or *Not now*.

## 2. Plan tab: setting up your month

### Salary
- Monthly salary in hand and payday (1–31; a payday of 31 means the last day of shorter months).
- **Money in your account this morning** (optional): for starting mid-month, so the graph starts from your real balance.
- **This month's pay** line, with *Change* (see [Payday check-in](#3-payday-check-in)).
- **Your pay over the year:** a 12-month bar chart (usual, more, less, not recorded), the months that differed with their reasons and notes, and totals for 12 months in hand, extra and less.

### Fixed payments
Rent, EMIs, subscriptions: name, amount and due day. Credit cards and loans go in the Debts tab, and their minimum payments are counted automatically.

### Bills that vary
Electricity, gas, water and recharges. See [Bills that vary](#9-bills-that-vary).

### Yearly costs
Festivals, insurance, servicing, school fees: name, yearly amount and the month it's due. One-twelfth is set aside every month, so they don't turn into emergencies.

### Set aside each month
Emergency fund, extra toward debts, and the Grow budget (money to invest).
- **Automatic** by default, worked out from your own numbers:
  - about **20% of salary**, or up to 35% of what's left after fixed payments when money is tight
  - never out of daily money: at least 10% of the salary stays for food, travel and the rest; with less left than that, nothing is set aside
  - the **emergency fund** gets a share until it holds 3 (or 6) months of needs
  - **loans at 15%+ interest** get the rest before the Grow budget does
- The app explains each choice in a line ("Your Credit card costs about ₹2,975 a month in interest, so the extra goes there first").
- Edit any amount to switch to *Set by you*; *Work them out for me* switches back.

### Flexible budgets
Groceries, Food & dining, Travel, Shopping, Entertainment, Health, Personal care and Misc, plus your own categories.
- **Automatically shared** from whatever is left of the salary: Groceries 30%, Food & dining 15%, Travel 15%, Shopping 10%, Entertainment 10%, Health 5%, Personal care 5%, Misc 10%. Categories you add get 5%.
- Type in your own amount and that category becomes *Set by you*; the automatic ones re-share the rest. *Share everything out automatically* undoes your edits.
- Amounts are whole hundreds.

### Where the salary goes
A summary of salary minus fixed payments, debt minimums, bills that vary, set-asides, yearly costs and flexible budgets. It shows what's not yet assigned, or warns if the plan uses more than the salary.

### Your data
Your privacy, backup file, restore, example data, erase, and **Clean up SMS imports** (removes SMS-imported entries before a chosen date and keeps anything added by hand).

## 3. Payday check-in

- Asked in the **first week of each salary cycle**, or as soon as the bank's **salary SMS** arrives, which pre-fills the amount.
- **"Payday! How much came in this month?"** Same as usual is one tap. More than usual (overtime, a bonus) is recorded as money in to decide on; once a bank balance entered that day holds it, or the usual pay is raised to cover it, it isn't added a second time.
- **More than usual:** asks why (Bonus, Incentive or commission, Overtime, Arrears or hike arrears, Reimbursement, Other) with an optional note. The extra then goes to [Money received](#7-money-received), so you decide what it does.
- **Less than usual:** asks why (Tax deduction (TDS), PF or other deduction, Unpaid leave, Advance or loan recovery, Paid in part / late, Other) with a note. **This month's budgets are planned on what actually came in.** Other months are unaffected.
- **"This is my new usual pay from now on"** for raises or a new tax slab.
- Can be changed later from the Plan tab. Changing it undoes the old record, including a bonus entry.

### Round result (month-end report card)
When a new salary cycle starts (the payday check-in is due, or the bank's salary SMS arrived), the result of the round that just ended opens first. It also opens before *Record this month's pay* on the Plan tab, and *Last month's report card* there opens it any time.
- **Round won 🏆** (chime and confetti) when payday was reached without borrowing; otherwise **Round over**: *₹1,200 borrowed this round. The next round is a fresh start.*
- **The round's days** as tiles (won, over, not tracked), with *18 days won · 9 over · 23 of 30 days logged*. Logging the days that went over is praised: it keeps the numbers true.
- **Then and now:** Days of Freedom (*3 → 6*) and loans left (*₹2.1L → ₹2.0L*) since the round was first opened. The app notes both at the start of every round.
- **Planned and actual:** pay, daily spending against the budgets, saved and set aside against the plan, and borrowed against ₹0, each with ✓ or !.
- **Wins (green):**
  - **Card-free days:** days with no credit card spending, e.g. *29 of 30*.
  - **Saved from daily leftovers:** money moved to the emergency fund, loans or savings, with the split. Payday set-asides aren't counted.
  - **Extra paid on loans:** with the interest it saves at today's balances, and any loan cleared that month. With no loans: *Debt-free*.
- **Watch-outs (amber):**
  - **Most over budget:** the flexible category furthest over its budget, with spent vs budget.
  - **Small payment leaks:** *7 small payments under ₹200 added up to ₹1,030.* Bills don't count.
- A watch-out with nothing to report turns green: *Every category stayed within its budget.*
- **Next round:** one goal from the round: no card for daily spending (if something was borrowed), keep the category most over budget within its budget, move one day's leftover to savings, or win as many days again.
- **Start the next round** closes it and opens this month's payday check-in, then the payday reset. Shown once per cycle; Escape closes it for now.

### Weekly recap (Runway tab)
Once a week, under the round board: the last 7 days in small wins. Days won (and over), days logged, money saved (*+1 Day of Freedom*), extra paid on loans (*about 2 days closer to debt-free*: the extra ÷ what goes to loans each day), and *Nothing borrowed* or what was borrowed. **On to next week** closes it until the next one.

A day is **won** when that day's spending stayed within its limit. Moving money to savings or a loan never makes a day "over", and payday set-asides don't count against payday.

### Payday reset (3 steps)
Opens once a cycle, right after the payday check-in is saved. **Later** (or Escape) closes it at any step.
1. **What's already spoken for:** *Payday check-in (₹55,000)*: fixed payments, loan minimums and EMIs, bills that vary (monthly share), yearly costs (monthly share) → **Money free for your month**.
2. **Pay yourself first:** your plan's set-asides (emergency fund with the Days of Freedom it adds, extra toward your costliest loan, savings / investing), each editable **for this month only**, with a live total and what's left for flexible spending. **Lock in** adds them to your funds and fills the yearly-cost pots.
3. **Your safe daily runway:** *₹660 / day* until payday, the same number as *Left to spend today*. **Start my month**.

All numbers come from the same plan as the rest of the app. Locked-in money already left on payday, so it isn't taken off the balance again. If you then move it to Jar or a savings account, that SMS joins the locked-in amount instead of counting twice. The Grow tab's *I've moved this money aside* does the same lock-in.

## 4. Runway tab: where you stand today

### Borrowed this month
Under the headline: **Borrowed this month: ₹0 ✓** in green, or the amount in red, split into card spending (borrowed until the bill is paid) and loan money received.

### Before you borrow
**Big expense coming?** Enter the amount and tap *Check before you borrow*. The same check opens from the Spend tab when a payment is more than the month can spare (more than both the money above bills and basics and three days' spending). It shows the way to pay without a loan:
- **Needed now** (a repair, a hospital bill):
  1. the emergency fund first ("that's what it's for"), with Days of Freedom before and after
  2. pausing this month's Grow and extra loan payment
  3. this month's money down to bills and basics, with the daily amount from tomorrow
  - If something is still short: **borrow only the shortfall, not the full amount**. If the next salary covers it, the check says so, and shows what the shortfall would cost on a credit card at minimum payments and as a bank loan at 16%. It also warns that loan apps and Pay Later often charge far more.
  - **Use this plan** moves the fund money and pauses the set-asides. **Plan the recovery** opens Emergency mode with the amount filled in.
- **Can wait** (a purchase): whether it fits this month, what the next salary leaves free, and **save first or pay in EMIs** for 3, 6 or 12 months: *Save ₹2,500 a month, ready by Apr 2027, ₹15,000* against *EMI at 16%, ₹15,708*: **saving first keeps ₹708**. "Keep your emergency fund for emergencies."

### Zone
A zone label on the Runway card, **Green · Careful · Red**, with a headline that says what to do.

| Zone | When | What the app says |
|---|---|---|
| **Green** | At the current pace, money lasts until payday | Money left at payday, days in a row within the daily amount, card-free days |
| **Careful** | Bills and basics are covered, but this pace runs out before payday | The date money runs out, your daily pace, and the daily amount that keeps you safe |
| **Red** | The money left doesn't cover the bills still to pay plus groceries and health until payday | How much you're short, and ways out with amounts (below) |

**The pace** is your average flexible spending a day over **finished days** only; today counts as at least a usual day until it's over. So the zone doesn't change at midnight by itself: it gets better when a day ends under your usual spending, money comes in, or you move money to savings. (Emergency spending isn't part of the pace.)

**Ways out of the red:**
1. Use money from the emergency fund. One tap moves it in, rounded up so it really clears the gap.
2. Pause this month's Grow and extra debt payments until payday.
3. Spend only on basics (a daily amount for groceries and health).
4. Avoid the credit card for daily spending.

### The first screen
Each salary cycle is a **round**: reach payday without borrowing, and build Days of Freedom. Only two hero numbers, then the round:
- **A coach line first**, one friendly sentence: *Slow down a little. You're nearly at payday.*, *Today went over. Tomorrow is a fresh start.*, *You're on track. Keep it going.*, or a streak within the daily amount. Never shaming.
- **Today's limit** (win the day): **the whole card takes the zone's colour, with a banner that can't be missed**: deep green with a celebration sign (*GREEN: ON TRACK · You're winning this round*), amber with a warning sign (*CAREFUL · At this pace the money runs out before payday*), or red with a stop sign (*RED ZONE: STOP · Bills and basics aren't covered. Basics only now*). The warning and stop signs pulse twice when the screen opens (not with reduce-motion). Then the amount, a spent/left bar (with tomorrow's limit when over) and what to do. *How is this calculated?* shows the smaller of what the budget allows and what the account can cover after bills still to come, with your numbers.
- **Days of Freedom** (win the game): savings ÷ basics a day. **Red 0–6 days** (*At risk*, stop sign), **amber 7–29** (*Building*, warning sign), **green 30+** (*A month safe*; 90+ *Three months safe*, celebration sign): the card is tinted and outlined in the level's colour, with the same kind of banner. The next milestone in days and rupees: *1 more day (₹470) turns it amber.* *How is this calculated?* shows fixed payments + loan minimums + bills + groceries and health, ÷ 30, and the fund ÷ that.
- **This round:** a tile for each day: **won** (inside that day's limit, ✓), **over** (amber outline), today, days to come, and days not tracked. *Borrowed this round: ₹0 ✓*. After a day over: *Yesterday went over. Today's limit already takes it into account: keep to ₹364 and you're back on track.* Logging a bad day still counts; nothing "breaks".
- **Debt-free date** (with loans): *Minimums only* against *With your plan* (the extra each month on the costliest loan first, and each cleared loan's payment moving on), with *11 months sooner, saving about ₹35,503 in interest*, or a nudge to set an extra amount aside. *How is this calculated?* explains both.
- Then whatever needs you (payday check-in, a loan just cleared, payments to check, money received, Big expense coming?, bills to pay), and **More details** (remembered): balance and flexible spending, the runway graph, the next payday preview, budgets, what's coming before payday and what your spending says.
- **A coral + button** (every tab but Spend) opens Spend with the amount ready to type.
- **Light animation:** the limit bar moves to the new amount and the amount counts up when the app opens. Nothing loops; the phone's *reduce animations* setting turns it off. A short burst of colour marks a real win.
- **Sounds** (Plan → Language card, on by default): a tick when an expense is saved, a chime for a win, a low note when today goes over. Made on the spot (no sound files), quiet when the phone is on silent or vibrate.
- A "month" in the app always means **payday to payday** (the round), on every tab.

### Graph
Under **More details** on the Runway tab.
- Balance so far (solid line), **if you keep this pace** (dashed), **if you keep to budget** (dotted).
- **Red band:** what bills and basics still need from each day to payday. If a line dips into it, trouble is coming.
- Dots for bills and EMIs, a *Today* marker, and the date the pace line crosses ₹0.

### Tiles
- **Left to spend today** is the ring on the Runway card.
  - Today's amount is the smaller of (a) the flexible budget left divided by the days to payday, and (b) the money in the account after bills still to come, divided by the days to payday.
  - If you go over: "₹147 over today's ₹200. Tomorrow: ₹182."
- **Balance now:** worked out from your plan, or from your last balance check, with *Update*.
- **Flexible spending:** spent against the budget, including money received, since the balance check if there is one.

### Next payday preview
- **"Effective payday: ₹50,742"**: your usual pay minus what's **already borrowed against it, or about to be**:
  - **Short before payday at this pace (not borrowed yet):** a forecast. At today's pace the money runs out before payday by this much, and whatever covers the gap (card, loan, friend) comes out of the next salary. A line under it says *Nothing is borrowed yet. Keep to ₹X a day until payday and this disappears.* When this is the only item, the line under the amount says *you're on track to run short*, not *borrowed*.
  - card bills from before you added the card that fall due next month
  - card EMIs and carried card balances starting next month
- This month's card spending is **not** subtracted again, because it was already counted when it happened.
- The line under it is grey up to 20% borrowed, amber from 20% to 50%, and red above 50%. When nothing is borrowed: "Nothing borrowed against your next salary. Keep it that way."
- If borrowing uses up the whole salary: **"Next paycheck fully used up: ₹0 in hand"**, with a red banner.
- It also shows what's left after fixed payments, loan minimums and bills.

### Cards on the Runway tab (when they apply)
- Payday check-in
- Balance question ("How much money is in your account this morning?"), once per cycle, or *Update* at any time
- "N payments from SMS need a quick check"
- "What should this ₹X do?" for money received
- "You saved ₹58 yesterday"
- Card bill due within a week, or overdue, and this month's card spending
- Recovery plan in progress (after emergency mode or a red-zone pause)

### Lists
- **You can spend this cycle:** each budget with "₹X left" or "₹X over", and spent of budget. After joining mid-month it says *You can spend until payday*, with budgets scaled to the days left.
- **Coming up before payday:** fixed payments, debt minimums, bill estimates and card bills, with dates and the total.
- **What your spending says:** see [Spending insights](#13-spending-insights).

## 5. Spend tab: recording money in and out

- **Add a payment:** amount, category, date, where or what, and **Paid from**:
  - *Bank account / UPI / debit card (paid from my money)*
  - *HDFC card ••1234 (borrows from next paycheck @ 42%)* for cards at 15%+, or *(credit card @ X%)* for low-rate cards
  - Choosing a card shows a red line underneath, for example: *Borrowed money at 42% a year. Counted as spent today; it's on the bill due 25 Nov.*
- **Money in:** amount, category (Money received, Money returned, From family, Refund, Cashback, Side income, Gift), date and from whom.
- **Saved:** money you moved to savings (Jar, a recurring deposit, a SIP, gold). It isn't spending, so it doesn't count against budgets, your pace or streaks. But you can't spend it either, so it **comes off today's amount in full**: spend ₹142 and save ₹58 of a ₹200 day and *Left to spend today* is ₹0 ("Spent ₹142 + saved ₹58 of ₹200 today"). Saving more than today's amount lowers tomorrow's ("Saved ₹200 more than today's ₹200. Tomorrow: ₹175"). Moving yesterday's leftover ("You saved ₹58 yesterday") counts for yesterday, so today isn't cut twice. *Counts as* emergency fund, savings / investing, or a loan payment, and you get the matching reward message.
- **Transfers to savings apps from SMS are added automatically:** to wherever you put that app's money last time (Jar → emergency fund, for example), or the safety-first suggestion the first time. *"₹58 to Jar added to your emergency fund. Change it in Spend if needed."* Saved entries in the payments list have **Change**, and your choice is remembered for next time.
- Changing any payment's category to **Savings** turns it into a saved entry and asks where it counts: *Emergency fund*, *Savings / investing*, *Paid (loan)*, or *It was spending*.
- **Your spending, 3 ways:** one card, three views (the choice is remembered). Tap a bar or a day to see its amount; *See the numbers* shows it as a table.
  - **Where does my money go?** Basics (groceries, health, bills, emergencies) against everything else, then each category against its budget, sorted by spending, with the part past the budget line in coral (*+₹1,480 over*).
  - **When do I spend?** A calendar of this month, each day shaded by what you spent (the middle shade is about your daily amount), a coral dot for card days, and today outlined. Below it, your average day for each weekday over the last three months, with *You spend most on Sun: about ₹1,234 a day.*
  - **Am I getting better?** Spent, saved and borrowed for each of the last six months (from when you started; this month so far is marked *), with *Sep spending was 29% lower than the month before.*
  - Colours are checked for colour-blind readers in light and dark, and every bar has a label or a legend, so nothing is told by colour alone.
- **Needs your check:** payments recorded from SMS that you haven't confirmed. Change the category or Paid from, then *Looks right* or *Not a payment*. Highlighted until done.
- **Bills to pay:** bills that vary that are due, with *Paid*, plus bill payments from SMS to link to the right bill.
- **Bank SMS:** see [Bank SMS reading](#6-bank-sms-reading).
- **Family** (money for a spouse, parents or children to spend) and **Gifts** (presents, shagun) are spending categories too.
- **Payments list:** this cycle or all. Shows where entries came from (SMS or widget) and whether they were paid by card. Changing a category makes the app remember it for that shop. *Delete* also undoes what an entry changed: a loan payment goes back on the loan, a fund move comes back out of the fund, a bill's due date returns to what it was, and an EMI is removed.

## 6. Bank SMS reading

- **Android app:** reads the inbox after you allow it, **only messages from today**. Each time you open the app it checks today's new messages; messages from earlier days are never offered, even ones you didn't review, and a message today about a payment from an earlier day is left out too. You review payments before they're added.
- **Browser version:** paste messages to import them.
- **Notifications for new bank SMS** (optional, Android): see [Android app extras](#14-android-app-extras).
- Only **named senders** (such as VM-HDFCBK) are read; messages from phone numbers are ignored.
- **Understands:** amounts (Rs, INR, ₹), debits and credits, dates in common formats, and the shop or person (UPI IDs, "to …", "at …", "Info: UPI/…/SHOP").
- **HDFC formats tested on real messages:** UPI *Sent Rs… To …*, credit card UPI *Txn Rs… On HDFC Bank Card 6645 At …@… On 27-08* (a date with no year is this year, or last year if still to come), and *Credit Alert! … from VPA …*. The shop in a UPI ID drops the payment gateway (*gokhana.payu@indus* is Gokhana), QR codes show as *Paytm QR*, and senders the bank masks as *UPI \*1995*. The Android alert reader matches.
- **Card EMIs from SMS:** HDFC's *SMART EMI Loan booking* OTP and its *processed your Smart EMI request* confirmation are never payments; they become one suggestion on the card (*An EMI booked on 20 Jul: ₹36,390 in 6 EMIs*), pre-filled with the EMI, how many are left by today and the rate, to check and add. It isn't offered when an EMI of about that amount is already in Debts.
- **Skip SMS that contain…** (Bank SMS page): your own words or phrases, like *BluChips*. Any SMS with one is never offered, recorded or notified (the Android alert reader gets the same list). *Skip SMS like this* on a message in the review list suggests telling words from it to edit; each word has ✕ to count it again. At least 3 letters, so real payments aren't caught.
- **Skips:** OTPs, offers and promotional messages, and SMS with an amount that isn't money moving: reward points (*2 RP per Rs.200*), UPI payment requests, *will be debited* reminders, autopay or mandate set-ups, bonuses in a DTH or shop account (*Dear Subscriber … Bonus amount*), and offers (*pre-approved*, *lifetime free*, *per Rs.100 spent*, *T&C apply*, *apply now*). Income tax refunds are named *Income tax refund*.
- **Automatic categories:** Food & dining (Swiggy, Zomato, …), Groceries (Blinkit, Zepto, DMart, JioMart, …), Travel (Uber, Ola, Rapido, IRCTC, fuel, …), Shopping (Amazon, Flipkart, Myntra, …), Entertainment (Netflix, Spotify, BookMyShow, …), Health (pharmacies, hospitals), Personal care, **Bills** (recharges, Airtel, Jio, electricity boards, gas, broadband), and **Savings** (Jar, Groww, Zerodha, Kuvera, Upstox, mutual funds, SIP, NPS, PPF, RD/FD, digital gold; short words like *jar* and *sip* only as whole words, so *Rajarani Sweets* isn't savings). **Your corrections win** next time.
- **Savings transfers aren't counted twice:** if "You saved ₹58 → emergency fund" and the Jar SMS for ₹58 both happen (in either order, within two days), they become one entry.
- **Credit cards:** tells card from account ("Credit Card ending 1234", "Avl Limit" vs "A/c", "Debit Card") and matches the card by its last 4 digits. Card **statements** set the bill, minimum and due date. **Bill payments** are recorded as card payments, not income, and the bank's and the card's SMS for the same payment count once.
- **Salary SMS** are recognised and used for the payday check-in, not counted as extra money.
- **No duplicates:** each SMS is identified by its text, so it's never recorded twice, whether it arrives by notification, inbox reading or paste.

### Import past payments (optional)
Spend tab → Bank SMS → **Import past payments**. Only for someone with time to sort them: a payment without a category would land in Misc and make budgets and limits wrong.
- Choose **1, 3 or 6 months**. The app reads those bank and UPI messages on the phone (up to yesterday; today's are read as usual) and finds the payments it hasn't recorded yet. Credits, salary, card statements and card bill payments are left out.
- *"124 payments found. From 1 Jul to yesterday. Each one needs a category before it counts. Sorting takes about 6 min."* **Start sorting** or **Not now**.
- **Nothing counts until sorted:** imported payments wait in a *To sort* pile, outside budgets, graphs, the daily limit and reports. Stop any time (*Stop for now*); the Runway tab reminds you how many are waiting.
- **One payment at a time:** *₹450 to Ramesh Kirana · 12 Oct. Where did it go?* Big buttons for Groceries, Food & dining, Travel, Shopping, Bills and **Cash**, any other category from a list, **Not sure** (moves it to the end; it still doesn't count), and **Not a payment** (left out for good).
- **Same payee, with consent:** after a choice, *"3 more payments to Ramesh Kirana. Mark them all as Groceries? Future payments there will be marked Groceries too."* **Yes, all 4** marks them and remembers the payee; **Only this one** remembers nothing. A payee the app already knows is highlighted as a suggestion, never applied silently.
- Progress: *34 of 120 · about 6 min left*. When done: *All 120 payments sorted. Your budgets and graphs now include them.*

## 7. Money received

For a refund, money from home, money returned, cashback, side income or extra pay.
- **Money passing through:** when the same amount comes in and goes out within 3 days (₹26,000 from a friend, ₹26,000 to a brother), the app asks *Money passing through?*: **Borrowed from Rahul, lent to Amit** (both go to People, with any promised dates), **Just passed it on** (nobody owes anybody), or **No, they're separate**. Either of the first two keeps today's limit where it was.
- **People** (Debts → People): money between you and friends or family, with no EMI and no fixed schedule.
  - Each entry: *You owe Rahul ₹26,000* or *Amit owes you ₹26,000*, with a promised date only if there is one, and the balance (*You owe ₹26,000 · Owed to you ₹26,000 · Even*).
  - Paid back all at once or in parts of any size: *Got some back* / *Paid some back*, or from the money's own entry (*Amit paying back (₹26,000 left)*). A matching bank SMS is linked rather than counted twice. Interest, when agreed, is added as rupees.
  - Any money in can be marked *Borrowed: I'll pay it back*, and any payment *I lent this*.
  - It moves the balance like any money but is never income or spending, so budgets stay right. Money you promised to pay back before payday is kept aside, unless money promised back to you first covers it; money owed to you counts only once it's back. Net worth counts both sides.
  - On a promised date: *Amit promised ₹26,000 by 27 Oct. Did it come back?* **Yes, all of it** · **Part of it** · **Not yet** (then a new date). Money coming back is asked about before money going out.
  - A late promise still counts: if your brother hasn't returned the ₹26,000 yet, the ₹26,000 you promised your friend from it isn't counted as due on payday. It waits on his, until you record the money or set a new date. When his money comes in, net worth stays the same: it moves from *owed to you* to the account, and what's due to your friend today counts once.
  - **Name, date or interest** on each person: fix a name that came from an SMS (*UPI \*6127* → *Ramesh*); the entries that moved the money take the new name.
- **Yours to keep:** commission for helping a friend, Diwali money from your father, a gift: pick *Side income*, *From family* or *Gift*, then what it does: keep it for this month, the emergency fund, a loan, or **Keep it for something to buy**.
- **Keep it for something to buy** (*What is the ₹5,000 for? Diwali shopping*): it stays in the account but out of daily spending, so today's limit doesn't jump. Grow lists it (*Kept for something to buy*); when you buy it, **Use it** and pick the purchase (or *Paid from Diwali shopping* on the purchase itself). The purchase still shows where your money went, but it doesn't use your budgets or today's limit; what's left stays kept.
- It raises the balance on the day it arrives.
- **"What should this ₹X do?"** offers four choices, each with its effect in rupees:
  - **Keep it for this month:** raises today's amount, and shows the new run-out date if it changes
  - **Add to emergency fund:** the fund before and after, against its target
  - **Pay off the costliest loan:** interest saved and how many months sooner you're debt-free
  - **Set aside to invest:** with a reminder to talk to a SEBI-registered adviser
- **Suggestion order (safety first):** cover this month if money would run out → emergency fund until it covers **30 Days of Freedom** → loans at 15%+ → full emergency fund → invest. An empty fund comes before debt, because without it the next surprise goes on a card. It always explains why, and the choice is yours (one tap).
- With a loan at 15%+, *Keep it for this month* shows the badge **Extends this month's budget, but delays your debt-free date**.
- Moving money to safety gives a light vibration and a green message with true numbers, e.g. *Nice move! +2 days of freedom (8 now)* or *Saves about ₹24 in interest a year*.
- Until you choose, it counts as this month's money. You can change the choice later, and the old effect is undone.
- **Loans are not income.** Money in marked *Loan or Pay Later*, or a bank SMS for a loan payout (the word loan or disbursed, a credit line, Pay Later, or a known lending app such as KreditBee, MoneyView, Navi, LazyPay or Simpl), is counted as **borrowed**. It isn't offered for saving or investing, and the Runway asks you to **add it to Debts** so its interest and EMI are planned.

### Every saving goes somewhere you can see
A transfer to savings (Jar, a SIP, an RD, typed or from SMS) goes to one place: the **emergency fund**, one of your **savings goals**, **Grow (to invest)**, or the costliest loan. From SMS it's placed where that app's money went last time (or the app's suggestion) and says so: *₹100 saved through Jar → Emergency fund*. Every saving's row shows *Saved → Emergency fund* (or *Goal: Bike down payment*) with **Change**, which opens the places right there; moving it takes it out of one and adds it to the other, and the app remembers the choice for that app.

## 8. Daily savings: "you saved ₹58 today"

- When a day ends under its amount, the app asks (the next morning, or after 8 PM the same day): *"You spent ₹142 of your ₹200. Saving that much every day adds up to ₹1,740 a month."*
- Choices: emergency fund, pay off the costliest loan (with interest saved a year), set aside to invest, or keep it for this month. One is suggested, in the same safety-first order; when you're not in the green, keeping it is suggested.
- Moving it gives a light vibration and a green message with true numbers: *Nice move! Saves about ₹24 in interest a year. Do this daily and it's ₹1,740 a month.*
- Moving the money takes it out of this month's spending money **without lowering the days ahead**.
- The Grow tab shows the total saved from daily leftovers this month. Deleting a move undoes it.
- **Streaks:** days in a row within the daily amount, and card-free days.

## 9. Bills that vary

- Each bill has a name, an estimate, how often it's paid (**1, 2, 3, 6 or 12 months**) and its next due date.
- **Smoothing:** a share is set aside every month, so a 3-month recharge costs a third each month. In months it isn't due, the share goes to a pot on payday; in the month it's due, the pot pays the rest.
- **Paying:** enter the actual amount and how long it covers. A recharge can cover 1 month one time and 3 months the next.
- The app **learns the usual amount** from the last three payments and moves the next due date on.
- Overdue bills are counted today. Bill payments aren't flexible spending, so they don't eat into budgets.
- **Move from fixed payments** converts an existing fixed entry (such as electricity) into a bill that varies.
- **How accurate the app is** (Runway → Balance): each time you enter your bank balance, what the app had counted is compared with what the bank says. The meter shows accuracy over the last 10 checks (100% less the gaps as a share of the money: ₹200 off ₹20,000 is 99%), the average gap, and the last 5 checks (*₹200 less in the bank*, *exact*, *noted* when the gap was recorded). Below 98% it says what gaps usually are: cash, a bank charge, a payment without an SMS.
- **Last EMI of each loan**, worked out from what's still owed, the interest rate and the EMI, the way the bank does it (interest added each month, the EMI taken off): *11% a year · last EMI Mar 2031 (53 left)*. A card EMI with a set number left uses that number, on the card's due day. An EMI that doesn't even cover the month's interest is flagged: *it never ends. Check the balance and EMI.*
- **Payments left** under each fixed payment and bill, for an EMI kept there (a phone on EMI, a card bill turned into EMIs): type how many are left, the next one included, and the app works out the last date (*Last one 3 Feb 2027. Not counted after that.*). From the round after it, it's no longer in the plan, the daily limit or the payday forecast, without deleting it; a bill whose last payment is recorded ends at once (*₹6,000 paid. That was the last one.*). Blank means it doesn't end.
- A bill without an amount yet (₹0, such as a row just added in Plan) isn't shown under *Bills to pay* and sets nothing aside.

## 10. Credit cards

**Why:** card spending doesn't leave your bank account today, so a month looks better than it is, and the bill lands on next month's salary.

- **Up to 10 cards:** name, last 4 digits, limit, statement day, due day, and what you owe when adding the card (last statement, its due date, and spending since). **No interest rate to enter:** paying the whole bill on time costs nothing, and the app uses the usual Indian card figures otherwise (about 3.5% a month, 42% a year, plus 18% GST on it, and the usual late-fee slabs: ₹0 up to ₹500 due, then ₹500, ₹750, ₹950, ₹1,100, up to ₹1,300 above ₹50,000).
- **Card spending counts as spent the day it happens.** Budgets, today's amount and zones stay honest, and the money is treated as kept aside for the bill. Paying the bill only moves money to the card, so it isn't counted twice. A balance check subtracts card spending not yet paid.
- **Each card shows:** the bill and its statement date, amount paid, **amount left to pay by the due date**, spending since the statement (next bill), and **limit used**, with a note above 30% because staying under it helps your credit score.
- **Reminders** on the Runway tab a week before the due date: *Pay the whole ₹12,500 by 25 Nov and it costs nothing. Paying less, even the minimum, starts interest of about 3.5% a month plus GST.*
- **On the due date it asks: did you pay it?** (Runway and Debts tabs, once per bill)
  - **Paid in full:** the payment is recorded. No interest.
  - **Paid part** (enter how much): the rest moves to Debts as *HDFC carried balance* at 42% + GST (49.6% a year), with a 5% minimum, so the payoff plan and debt-free date include it.
  - **Missed it:** the whole bill moves to Debts the same way, **plus the late fee with GST** (charged only when not even the minimum was paid).
  - **Converted to EMI:** opens the EMI plan on the Debts tab; the EMI becomes a loan in Debts.
  - *₹20,000 moved to Debts as HDFC carried balance: about ₹873 a month in interest with GST and a late fee of about ₹1,121.*
- **Paid from a card** says: *Borrowed until you pay the bill due 25 Nov. Pay that whole bill and it's free; pay less, even the minimum, and interest of about 3.5% a month plus GST starts.*
- **Each card payment shows a warning:** "Borrowed ₹1,000 on HDFC card… next bill so far ₹3,000", plus "this lands on next month's salary" when you're not in the green.
- **Plan this payment**, with each option's real cost:
  - **Full:** no interest. Suggested whenever you're not in the red, because the money was kept aside.
  - **Minimum:** next month's interest, and how many months and how much interest it takes to clear at the minimum. Labelled "This is how the card trap starts."
  - **Part:** pay what you can.
  - **Convert to EMI:** enter the bank's amount, rate (22% default), months (3, 6, 9, 12, 18 or 24) and processing fee. The app compares it with carrying the same amount on the card ("EMI saves ₹1,563"). **Suggested only when you can't pay in full and it's clearly cheaper**, always with "An EMI is still a loan". After converting, it moves to Debts and every month's plan, **starting with the next bill**; the fee is charged on the card.
- Spending recorded before a card is added (from SMS) links to it automatically once you add it.
- **An EMI already on a card** (a bill converted before the card was added here): *Add an EMI already on this card* takes the EMI, how many are left and the rate (22% if unsure), works out what's left, and puts it in Debts, paid through the card. The card lists it (*₹6,010 a month · 4 left*).
- **EMIs left:** a loan paid through a card can say how many EMIs are left; it ends with the last one (cleared, with *keep paying yourself*), the payoff plans clear it in that month, and the card stops billing it.
- **A loan whose EMI is billed on a card** (Debts → Loans → *Billed on a credit card? Yes, on the HDFC card bill*): you pay it from your account with the card bill, so it leaves once a month, on the card's due day, as the loan's EMI. It isn't card spending, isn't added to next month again, and isn't counted again inside the card bill. The card still shows it in each bill and the amount owed, paying the bill doesn't cancel other card spending, and the loan goes down after each EMI. A loan named like a card EMI ("Credit card EMI") asks whether it's billed on the card.
- **Adding a card with the bill before last** (a due date before the last statement) is refused with the right dates; a card already added that way asks *What's due on your 14 Oct statement?* on the card.
- **A card bill noted as spending** (Bills, "Credit card") is offered in Bills to pay as *HDFC card bill → Link*: it becomes a card payment, or moves the one already recorded to its real date, so it counts once.
- Payments made before the bill the card was added with paid older bills, so they don't count toward that bill or cancel new spending.

## 11. Debts tab: loans and payoff plans

### Your way out of debt (shown when you have loans)
Three stages, each with the wins on the way and **one next move** in your own numbers:
- **Survive:** basics and every minimum paid, nothing new borrowed. Wins: 1, 7 and 30 days without borrowing (card spending and loans received count as borrowing). If you borrow, the count starts again, with your best kept: *"It happens: the count starts again, and your best is 12 days."*
  - **Salary short of the basics and minimums?** The move is closing the gap in small steps, each in rupees: ask the lender with the biggest EMI for a longer tenure (*EMI ₹4,250 → ₹3,712*), halve little leaks or cut one non-essential budget by a fifth, and add a little income for the rest. A big gap also gets one honest line: it needs a bigger change too.
- **Stabilize:** 1, then 7 Days of Freedom. The move: *"Put ₹470 in your emergency fund to reach 7 Days of Freedom."*
- **Escape:** loans cleared one at a time. The move: this month's extra on the next target, or what even ₹1,000 extra a month would do.
- Rent, food, medicine, school fees and every minimum always come first; the plan never suggests skipping them. **How is this worked out?** shows the rules with your numbers.

### Loans to beat
Each loan is a bar: what's left of its highest balance, with its rate and interest a month. Pick the order: **Highest interest first** (saves the most, with the total) or **Smallest first** (early wins, with the month the first loan goes and the extra it costs). The next target is marked. Loan EMIs now come off after each due date (the EMI less that month's interest, shown as *"−₹4,000 after the 5 Nov EMI"*); card EMIs and carried balances are paid through the card. The balance you type is the starting point, and you can correct it any time.

### Calls to your lenders
One task at a time:
1. **List every loan** with its rate, EMI and due day.
2. **One easy call:** move an EMI that leaves 10+ days after payday to just after it, or ask for a card late fee to be waived.
3. **60 days of real numbers:** log spending, the bad days too.
4. **Ask for a better deal**, costliest first: a loan at 12%+ asks for about 4 points less; a carried card balance asks to become an EMI at about 18%. While the salary is short, a loan also gets a longer-tenure ask, with the extra interest it costs.

Each call shows **what to do, why it works and what it changes** in rupees, a ready **script** with your numbers, and a **5-minute prep** list. **I made the call** is a win whatever the answer (chime and confetti). The next day (or right away) it asks **How did it go?**: *They agreed* updates the loan (new due day, rate or EMI; a waived fee comes off), *They said no* moves on, *Call back or no answer* keeps the task open. A reminder shows on the Runway tab too. Hisab Se promises the plan and honest numbers, not the lender's answer.

- **Interest leak banner** at the top: **You are losing ₹151/day to bank interest**, with the monthly total and the biggest leaks. It's red with any debt at 15%+, amber otherwise. Only money that actually costs interest counts: loans (including card EMIs and carried balances) and card bills past their due date. A card bill paid in full on time costs nothing, and 0% (no-cost) EMIs are left out.
- **Credit cards** section (above).
- **Loans:** name, balance, interest rate, monthly minimum and due day. Card EMIs and carried card balances land here too.
- Monthly **interest cost** of each loan, highlighted at 15%+.
- **When will you be debt-free?** Add an extra amount per month and compare:
  - **Minimums only**
  - **Highest interest first** (pays the least interest)
  - **Smallest balance first** (quick wins)
- Each plan shows the debt-free month, months, total interest, savings against minimums and the order loans are cleared. It warns if a minimum is smaller than the monthly interest ("never paid off").

### Keep paying yourself (when a loan ends)
When a loan's balance goes to ₹0 or it's removed, or a fixed payment with EMI or loan in its name is removed, the app asks: *"Personal loan is done 🎉 You're used to living without ₹4,100 a month. Keep paying it, to yourself."* Choices, each with its true effect:
- **Pay off your other loans faster:** *Debt-free 10 months sooner, about ₹15,449 less interest*
- **Build your emergency fund:** *+3 Days of Freedom every month*
- **Set aside to invest** (with the SEBI-registered adviser reminder)
- **Spend it:** your flexible budgets grow

The suggestion follows the usual safety-first order. A chosen amount is added to the set-asides every payday, in automatic and manual plans alike. Money kept for loans moves to the emergency fund once no loans are left. The Plan tab lists them under **Kept paying yourself**, each with **Stop**.

**A raise works the same way:** ticking *This is my new usual pay* with a higher amount asks to send **half the raise** to freedom before spending grows to match it.

## 12. Grow tab: safety nets and saving

- **This month's set-aside:** what to move aside this cycle, with *I've moved this money aside* to add it to your funds.
- **Saved from daily leftovers** this month.
- **Days of Freedom:** the emergency fund as time. *6 Days of Freedom 🛡️* means it covers your basics (fixed payments, loan minimums, bills that vary, groceries and health) for that long, at your own daily cost. Levels: **At risk** (0–6 days, red), **Building** (7–29, amber), **A month safe** (30+, green), **Three months safe** (90+). At 0 days: *Every ₹1,253 saved buys one day of complete financial security.* Until basics are set up: *Add your fixed payments and budgets to see your Days of Freedom.*
- **Emergency fund:** amount saved, target (3 or 6 months of needs) and progress. A first milestone of one month of needs, then the full target, with how long each takes.
- **Yearly costs:** progress for each.
- **Something unexpected happened? (Emergency mode)**
  - Types: Medical, Vehicle repair, Family function, Death in family, Tax payment, Penalty or fine, Home repair, Job loss, Other.
  - Enter the cost and how much to cut flexible budgets (0–50%). The plan: use the emergency fund first; the rest comes from this month; pause Grow and extra debt payments and cut budgets until recovered; keep paying all EMIs and minimums.
  - Shows the date you're back on plan and when the fund is refilled. *Apply this plan* puts it in place; *End recovery plan now* stops it.
- **Grow:** money set aside to invest. *Talk to a SEBI-registered investment adviser*, with a link to SEBI's list. The app never recommends products, funds, banks or advisers.
- **Learn the basics** (short lessons): why an emergency fund comes first, how credit card interest works, the minimum payment trap, what inflation does to savings, compounding for and against you, questions to ask an adviser, and spotting an investment scam.

## 13. Spending insights

Built from your last three salary cycles, with every point in rupees:
- Monthly interest each loan costs (highlighted at 15%+)
- Categories that average more than 10% over budget, with the yearly cost
- Categories that stayed within budget
- Many small payments (under ₹300, eight or more a month) and what halving them frees up
- **Subscriptions:** the same shop for a similar amount for three months or more, with the yearly cost
- Weekend days that cost much more than weekdays
- When 40% or more of spending happens in the first week after payday
- Before there's history: "Trends appear after your first full month"

### Little leaks (Spend tab)

Small habits that quietly cost a lot: cigarettes, liquor, tea and snacks, food delivery, betting and fantasy games, plus any leak you add yourself (for example gutkha).
- **Tag a place once:** pick a shop or payee from your recent spends and choose its leak. Every payment to that place counts from then on.
- **Suggestions with your consent:** the app spots likely leaks by shop name (Swiggy, Zomato, Dream11, paan shops, chai stalls) and asks "Count it as a little leak?" with Yes and No. Nothing is tagged without a Yes, and a No is remembered.
- **What it costs:** for each leak, this round so far, last round, and a month's worth (last round's total, or this round's pace if that's higher). The total is shown as Days of Freedom: a month of leaks ÷ what your basics cost a day.
- **Optional challenge:** cut one leak by 20%. Started mid-round, the target counts what you already spent plus the cut amount for the days left, so it is always reachable.
- Leaks stay on your phone, like everything else.

## 14. Android app extras

- **Home-screen widget "Spend today"** (3×2 by default, resizable):
  - A deep-teal card with the Hisab Se logo and name, a faint runway line in the corner, **Payday in 8 days**, and a bar showing how much of today's amount is left. Shrunk to one row (Android 12+, or after resizing), it shows a compact version: logo, amount and + Add.
  - Shows what's left to spend today. When you go over: **Over by ₹147 · Tomorrow's safe spend drops to ₹135**, in amber. This updates even for expenses added from the widget or card SMS while the app is closed.
  - **+ Add** opens a small window over the home screen (amount, category, note) to record an expense **without opening the app**. The widget's amount drops straight away, and the app saves the expense next time it opens.
  - After midnight it shows "Open app" until the app works out the new day.
- **Notifications for new bank SMS** (turn on in the Spend tab; asks for SMS and notification permission):
  - **Says what's stopping them.** Reading SMS when the app opens and a notification for each new SMS are separate. If notifications can't come, Runway, Spend and the Bank SMS page say why, with one tap to fix: *Get a notification for each bank payment* (never turned on, or off on the phone after a restore: **Turn on notifications**, or *Not now*), *Notifications need the SMS permission for new messages* (**Allow**), or *Android is blocking Hisab Se's notifications* (**Open notification settings**). When all is well: **Send a test notification**, and a tip for Samsung's Sleeping apps.
  - A payment shows *₹450 paid to Swiggy · Tap to check the category*. On a card: *₹750 paid via HDFC card · Borrowed money: tap to verify the category*.
  - Tapping opens **Check this payment**: the SMS text, category, **Paid from**, a note, and *Save* or *Not a payment*.
  - Every choice there lands where the same choice in the app does: a spending category counts in that budget (Family and Gifts too) and the shop is remembered; **Savings** goes straight to a saving place (where that app's money went last time, else the emergency fund), with *saved → place* when the app opens; **Paid from** a card counts on that card's bill; money in waits for *What should this ₹ do?* (keep it for a purchase, the emergency fund, a goal…); *Loan or Pay Later* is borrowed money.
  - **People choices** sit with the categories: *Lent to someone* (out) and *Borrowed from someone* (in) start an entry in People with the payee or payer's name; *Paying {name} back* and *{name} paying back* (one per open IOU, with what's left) count as a repayment. The app says what changed: *In People: AMIT owes you ₹3,000*, *₹3,000 still to go with Rahul*. The same choices are in the category lists in the app: reading SMS, *Needs your check* (for payments not tapped in the notification) and Payments.
  - Payments you don't check are recorded anyway and wait under **Needs your check**.
  - **Not a payment** (an OTP, a payment request, a failed or reversed payment, an offer): in *Needs your check*, or by tapping any payment from SMS. It comes out of spending with Undo, and the same SMS never comes back on a later scan; *Also skip SMS from {place}* leaves that place's SMS out from now on (listed on the Bank SMS page, each with ✕ to count it again). Deleting an SMS payment with ✕ also keeps it from coming back.
  - **Salary SMS:** *Payday! ₹57,500 credited · Tap to review your monthly plan*.
  - A salary SMS without the word *salary* (*NEFT credited by ACME PVT LTD*) is still the salary when it's close to your usual pay (80% to 150% of it), within 3 days of payday (early when payday is a holiday), and the first such credit that month. It's never counted again as money in.
  - **A refund to a card** for something bought on it this month (same shop, not more than was paid) makes that purchase smaller: the budget, reports, card bill and limit all drop as if less was spent, and it isn't income. The purchase shows *₹500 refunded*; *Not for this purchase* takes it back. A refund with no such purchase (bought last month) is money in, never earned income.
  - **A refund or reversal to the bank account** (a failed payment coming back, a returned order) for a payment from the account this round: the app asks *Is ₹500 from Amazon a refund of your ₹1,500 payment on 21 Oct?* **Yes** offsets it: not income, the payment counts ₹1,000 as spending, and the money comes back on the day it did. *Not a refund of it* in the edit view undoes it. Bank rule: a refund or reversal cancels the original, it isn't new money.
  - **Card statement:** "HDFC card bill: ₹12,500 · Tap to plan the payment".
  - Card bill payments are recorded quietly.
- **Report a problem** (Profile → Help), for the testing phase:
  - The app keeps a log on the phone of its last 500 events: taps (which button, which page), messages it showed, errors with where in the code they happened, each day's limit and how it was worked out, and for bank SMS it couldn't read, the wording with every digit hidden. With the app lock on, no text is kept, only taps and errors.
  - When something breaks, a message says once: *Something went wrong. Profile → Report a problem sends the details.*
  - **Report a problem**: write what went wrong, then **Save report file** or **Share report**. The file has the note, today's numbers, the log and the data. It isn't password-locked, so the page says to send it only to the developer. Nothing is ever sent by itself.
  - **Clear the log** empties it; **Erase everything** removes it too.
  - For the developer: `node scripts/replay-report.js HisabSe-report-….json` opens the report in the real app on its own date, goes through every page, and prints errors, odd values and the last 40 events.
- **Updates:** a new APK every **Sunday morning** (India time), only if something changed. It installs over the old one and keeps your data.

## 15. Design and behaviour principles

- **Friction only on harmful choices:** borrowing on a card gets red labels and warnings; good choices (saving, paying debt) are one tap.
- **Smart defaults, never forced:** a *Suggested* badge, always with the reason.
- **English, मराठी and हिंदी:** switch at the top of the Plan tab; the first time, the app follows the phone's language. Everything changes language: screens, help, suggestions and insights, plus the widget, the bank SMS notification and the "Check this payment" pop-up. Amounts stay in 0–9 digits (₹1,23,456); dates use the language's month names. Money words people already say in English stay: EMI, SIP, UPI, SMS, PPF, FD. Bank SMS are read the same in every language. Your data is stored the same way whatever the language, so switching never changes your numbers.
- **Numbers on screen, help on request:** cards show amounts, dates and warnings. How a feature works sits behind the **(i)** next to its title (Runway, payday, adding money, bank SMS, payments, salary, fixed payments, bills that vary, set-asides, yearly costs, flexible budgets, your data, SMS cleanup, credit cards, loans, payoff plans, emergency fund, emergencies, Grow). The SEBI adviser notice stays on the Grow tab; the *not investment advice* line is in Profile → About.
- **True numbers only:** rewards and warnings never exaggerate.
- **Colours:** freedom green `#0D7A5D` / `#2ECC71` (dark), debt red `#D32F2F` / `#F26657`, caution amber `#E67E22` for fills and `#9A5400` / `#F39C12` for text, neutral `#616161` / `#BDC3C7`, card warning background `#FFF5F5` / `#2C1E1E`. All text colours meet readability guidelines.
- **Fast and offline:** all of this is worked out on the phone from data the app already has, in well under a millisecond per calculation, with no new data stored.

## 16. Regulatory design

- The app does budgeting, debt planning and savings set-asides only. (The earlier Personal mode, which showed where to invest, and the "plan next month with an AI chat" report were removed: they were off the loan-free mission.)
- It **never suggests investment products, funds, banks, advisers or risk levels**. It points to SEBI-registered advisers, at the user's own risk.
- No referral fees or commissions, no moving money, no lending, no Account Aggregator.
- The app states facts and numbers, and the user decides.

*Have a fintech lawyer review this before a public launch.*

## 17. Current limits

- Loan balances don't go down automatically; update them from each statement. Card bills are tracked automatically.
- Fixed payments are assumed to be paid on their due date.
- Data lives on one phone or in one browser; use backup and restore to move it.
- Card SMS detection is built from common bank formats; new formats need real samples.
- Reminders for due dates show inside the app, not yet as phone notifications.
- Only Android has SMS reading and the widget; iPhone would need Account Aggregator through a licensed partner.
