# Salary Runway (prototype)

Shows the date your salary runs out and helps you plan your money with budgets, a debt payoff plan and an emergency mode.

**All data stays on your device.** The app has no server and no account. Everything is saved in your browser's local storage.

## Try it

Open `index.html` in a browser, or serve the folder:

```bash
cd salary-runway-app
python3 -m http.server 8080   # then open http://localhost:8080 (or your computer's IP on your phone)
```

It opens with **example numbers** (₹55,000 salary, rent, a bike EMI, a credit card and a personal loan, plus four months of spending). Tap **Start with my numbers** to enter your own.

## Install on Android

A new APK is released **once a week, on Sunday morning** (about 8:50 AM India time), and only if something changed that week. Pushing code doesn't build anything. For an urgent fix, open the repository's **Actions** tab, choose **Salary Runway Android APK**, then **Run workflow**.

On your phone:

1. Open **https://github.com/Saurabh-4K/Terrform_studies_2024/releases/tag/salary-runway-latest** and tap **SalaryRunway.apk**.
2. When Android asks, allow your browser to install apps ("Install unknown apps").
3. Open **Salary Runway**. On the Spend tab, tap **Read bank SMS** and allow SMS access to record payments from bank and UPI alerts.

New builds install over the old one and keep your data, because every build is signed with the same key (`android/app/salary-runway.keystore`). That key is in the repo for convenience, so it only suits personal sideloading. Publishing to the Play Store needs a private key kept out of the repo.

Uninstalling the app deletes its data. Copy a backup from the Plan tab first.

### Android app details
- Built with [Capacitor](https://capacitorjs.com/): the same web app in an Android shell, plus a small native plugin (`SmsInboxPlugin.java`) that reads the SMS inbox.
- Only messages from named senders (such as `VM-HDFCBK`) are read for payments. Reading starts from the day you allow SMS access, so you can categorise payments the same day. After that it checks for new messages each time you open it, and you review each payment before it is added.
- **Notifications for new bank SMS** (optional, Spend tab): each bank or UPI SMS is recorded as it arrives and a notification asks you to check its category. Tapping it opens a small "Check this payment" window (change category, or mark *Not a payment*). Payments you don't check are recorded anyway and highlighted under **Needs your check** until you confirm them. Messages are matched by their text, so one SMS is never recorded twice. The Android side (`SmsReceiver`, `SmsParser.java`) mirrors the app's own SMS reader; `tests/` pins the shared message key.
- **Home-screen widget** "Spend today": what's left to spend today, and **+ Add** to record an expense from a small window without opening the app.
- Fonts are bundled. The app makes no network requests, and Android cloud backup is turned off for its data.

To build locally (needs the Android SDK and JDK 21):

```bash
npm install
npm run android:apk   # APK at android/app/build/outputs/apk/debug/app-debug.apk
```

## What it does

| Tab | What it does |
|---|---|
| **Runway** | Payday check-in, the **green / careful / red zone**, the balance graph (with the red band for bills and basics), *left to spend today*, "you saved ₹58" prompts, card bill reminders, what's left in each budget, coming bills and insights from your spending. |
| **Spend** | Payments and money received (by hand, from bank SMS, or from the home-screen widget), **Needs your check** for SMS payments, bills to pay, the "what should this money do?" card, and *Paid from* (account or card). Categories are learned per shop. |
| **Plan** | Salary, payday and **pay over the year**, fixed payments, **bills that vary**, yearly costs, monthly set-asides and flexible budgets (worked out automatically; edit any amount and the rest adjust), and your data (backup, restore, SMS cleanup). |
| **Debts** | **Credit cards** (bill, due date, limit used, pay full / minimum / part / EMI with real costs) and **loans** with a payoff plan: *minimums only*, *highest interest first*, *smallest balance first*. |
| **Grow** | Savings from daily leftovers, monthly set-aside check-in, emergency fund, yearly costs, **emergency mode**, money set aside to invest (with a pointer to SEBI-registered advisers), and short lessons. |

### Credit cards: staying out of the card trap
Card spending doesn't leave your bank account today, so it makes a month look better than it is, and the bill lands on next month's salary. The app closes that gap.

- **Up to 10 cards** (Debts tab): name, last 4 digits, limit, statement day, due day, interest rate, and what you owe right now.
- **Card spending counts as spent the day it happens**, so budgets, safe-to-spend and zones stay honest. The money is treated as kept aside for the bill; paying the bill only moves it to the card.
- **Card or account?** Read from the SMS ("Credit Card ending 1234", "Avl Limit" vs "A/c", "Debit Card"); the last 4 digits pick the card. When unsure, the check pop-up and "Needs your check" ask **Paid from**. Statement SMS update the bill (total, minimum, due date); bill payments are recorded as card payments, not income, and the bank's and the card's SMS for one payment count once.
- **Each card shows** the bill, what's paid, what's left by the due date, spending since the statement, and how much of the limit is used (with a note above 30%). The Runway tab reminds you a week before the due date.
- **Paying the bill is your choice**, with each option's real cost:
  - *Full*: suggested whenever you're not in the red (the money was kept aside).
  - *Minimum*: shows next month's interest and how long and how much it takes to clear at the minimum.
  - *Part*: pay what you can.
  - *Convert to EMI*: enter the bank's rate, months and fee; the app compares it with carrying the same amount on the card. Suggested only when you can't pay in full **and** it's clearly cheaper. It's added to Debts and every month's plan, starting with the next bill; the fee is charged on the card.
- An unpaid bill past its due date shows the interest it now costs and can be moved to Debts for a payoff plan.
- **Card-free days** are counted alongside the within-budget streak, and each card payment shows "Borrowed ₹1,000 on HDFC card".

### Zones: never touch ₹0 before payday
The Runway tab shows which zone you're in, and the graph shades a red band for what bills and basics still need:

- **Green:** at your current pace, money lasts until payday. It also counts your days in a row within the daily amount.
- **Careful (amber):** bills and basics are covered, but this pace runs out before payday. It shows the daily amount that keeps you safe.
- **Red:** the money left doesn't cover the bills still to pay plus groceries and health until payday. It shows how short you are and the ways out: use the emergency fund (one tap moves it in), pause this month's Grow and extra debt payments, spend only on basics, avoid the credit card.

### You saved ₹58 today
When a day ends under its amount, the app asks (the next morning, or after 8 PM) what the leftover should do: emergency fund, pay off the costliest loan, set aside to invest, or keep it for this month. Moved money leaves this month's spending money without lowering the days ahead.

### Bills that vary
Electricity, gas, water and recharges get an estimate, how many months one payment covers, and a next due date. A share is set aside every month, so a 3-month recharge costs the same each month. When you pay, you enter the real amount and how long it covers (a recharge can be 1 month one time and 3 the next); the app learns the usual amount from the last three payments. Bill payments from SMS can be linked to the right bill.

### Payday: what came in this month
Pay isn't the same every month. In the first week of each salary cycle (or when the bank's salary SMS arrives, which pre-fills the amount) the Runway tab asks what came in:

- **More than usual:** why (bonus, incentive, overtime, arrears, reimbursement), then "what should this extra do?" (emergency fund, a loan, invest, or keep it).
- **Less than usual:** why (tax deduction, PF or other deduction, unpaid leave, advance recovery, paid in part). This month's budgets are planned on what actually came in.
- **A lasting change** (a raise, a new tax slab): tick "This is my new usual pay".

The Plan tab shows this month's pay and **your pay over the year**: a 12-month chart with good and bad months coloured, the reasons, and totals for extra and less.

### Automatic budgets
1. **Set-asides** come out first: about 20% of salary (less when money is tight). The emergency fund gets a share until it holds 3 or 6 months of needs. Debts at 15%+ interest get the rest before the Grow budget does.
2. **Flexible budgets** share everything left by default weights: Groceries 30%, Food & dining 15%, Travel 15%, Shopping 10%, Entertainment 10%, Health 5%, Personal care 5%, Misc 10%. Categories you add get 5%.
3. Type in your own amount and that category is marked *Set by you*; the automatic ones are re-shared from what remains. **Share everything out automatically** undoes your edits.

### Money received
Money returned by a friend, money from home, refunds, cashback or side income can be added on the Spend tab (**Money in**) or from bank "credited" SMS. Salary credits are recognised and left out, since salary is already counted. For each amount the app asks what it should do and shows the effect of each choice:

- **Keep it for this month**: raises the balance and today's spending amount
- **Add to emergency fund**
- **Pay off the costliest loan**: interest saved and how much sooner you're debt-free
- **Set aside to invest**: with a reminder to talk to a SEBI-registered adviser

It suggests one: cover this month first if money would run out, then one month of emergency fund, then loans at 15%+ interest, then the full emergency fund, then investing. A choice can be changed later from the payments list.

### Emergency mode
Enter what happened and what it costs. The app:
1. uses the emergency fund first,
2. takes the rest from this month's money,
3. pauses the Grow budget and extra debt payments and cuts flexible budgets by the percentage you choose, until the gap is made back,
4. shows when you're back on plan and when the emergency fund is refilled.

## Regulatory design: no SEBI or RBI licence needed

The prototype is deliberately limited to **budgeting and debt planning**:

- It **never suggests investment types, products, funds, banks or risk levels**. The Grow budget only sets aside an amount, and the app tells the user to consult a **SEBI-registered investment adviser**, at their own risk.
- No referral fees or commissions from any financial company.
- It **never moves money**: no payments, wallets or bill payment. It only reminds.
- No lending and no loan offers.
- It doesn't use Account Aggregator (that needs a regulated partner). Bank SMS reading is used instead.
- Wording in the app states facts ("your card costs ₹2,975 a month in interest"), not instructions.

*This is a design intent, not legal advice. Have a fintech lawyer review it before a public launch.*

## Files

```
index.html        page shell
styles.css        styles (light and dark themes)
core.js           all calculations: cycles, runway, zones, pay, bills, cards, debts, insights, SMS reader
demo.js           example data
app.js            user interface
tests/            unit tests for core.js
scripts/build-www.js              prepares the web files for the Android app
capacitor.config.json             Android app settings
android/app/src/main/java/com/salaryrunway/app/
  MainActivity.java               starts the app and registers the plugins below
  SmsInboxPlugin.java             reads the SMS inbox; turns new-SMS alerts on and off
  SmsReceiver.java                catches bank SMS as they arrive and shows the notification
  SmsParser.java                  reads one SMS (a copy of parseSms() in core.js; keep in step)
  SmsAlertStore.java              SMS caught while the app is closed, waiting for the app
  SmsConfirmActivity.java         the "Check this payment" pop-up
  SpendWidgetProvider.java        the "Spend today" home-screen widget
  QuickAddActivity.java           the widget's "Add an expense" window
  SpendWidgetPlugin.java, WidgetStore.java   widget data shared with the app
.github/workflows/salary-runway-android.yml  weekly APK build (Sunday morning)
```

The app ID `com.salaryrunway.app` and the signing key must never change: either change makes Android treat it as a different app, and installing it wouldn't keep anyone's data. The app's visible name and icon can change freely.

Run the tests (Node 18+):

```bash
npm test
```

## Roadmap to a phone app

Done: Android app, SMS reading and notifications, home-screen widget, zones, bills that vary, credit cards, payday check-in.

Next:
1. A new name and icon (in progress; the app ID stays the same).
2. Encrypted on-device storage, app lock (fingerprint/PIN), and optional encrypted backup.
3. More banks' SMS formats, from real samples.
4. Phone notifications before bills, EMIs and card due dates (today they show inside the app).
5. Before a Play Store release: Google's review of the SMS permissions, and a private signing key kept out of the repo.
6. Later, with a licensed partner: Account Aggregator for iPhone users and more accurate data.

## Known limits of the prototype

- Debt balances don't go down automatically; update them from each statement.
- Fixed payments are assumed to be paid on their due date.
- Data lives in one browser or one phone. Use **Show backup** on the Plan tab to copy it to another device.
- The browser version loads fonts from Google Fonts; the Android app bundles them.
