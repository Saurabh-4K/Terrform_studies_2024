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

## What it does

| Tab | What it does |
|---|---|
| **Runway** | Graph of your balance through the salary cycle, with two projections: *at this pace* and *if you keep to budget*. Shows the date money runs out, a daily "safe to spend" amount, how much is left to spend in each budget, upcoming bills and insights from your spending history. |
| **Spend** | Add payments by hand, or **paste bank/UPI SMS** to import them. Payments are categorised automatically (Swiggy goes to Food, Uber to Travel). When you correct a category, the app remembers it for that shop. |
| **Plan** | Salary and payday, fixed payments, yearly costs (festivals, insurance), monthly set-asides and flexible budgets. **Set-asides and budgets are worked out automatically** from what is left of the salary; edit any amount and the automatic ones adjust to fit. |
| **Debts** | Loans and cards with interest rates. Shows the monthly interest each one costs, and compares *minimums only*, *highest interest first* and *smallest balance first*: debt-free date, total interest and savings. |
| **Grow** | Monthly set-aside check-in, emergency fund progress, yearly costs, **emergency mode** (medical bill, car repair, family function, and so on), Grow budget, and short lessons. |

### Automatic budgets
1. **Set-asides** come out first: about 20% of salary (less when money is tight). The emergency fund gets a share until it holds 3 or 6 months of needs. Debts at 15%+ interest get the rest before the Grow budget does.
2. **Flexible budgets** share everything left by default weights: Groceries 30%, Food & dining 15%, Travel 15%, Shopping 10%, Entertainment 10%, Health 5%, Personal care 5%, Misc 10%. Categories you add get 5%.
3. Type in your own amount and that category is marked *Set by you*; the automatic ones are re-shared from what remains. **Share everything out automatically** undoes your edits.

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
core.js           all calculations: cycles, runway, insights, debt payoff, emergency plan, SMS parser
demo.js           example data
app.js            user interface
tests/            unit tests for core.js
```

Run the tests (Node 18+):

```bash
npm test
```

## Roadmap to a phone app

1. **Android app** (Flutter or React Native) that reuses the logic in `core.js`, with automatic reading of bank SMS (Google Play allows the SMS permission for money-management apps after review) or notification access as a fallback.
2. Encrypted on-device database, app lock (fingerprint/PIN), and optional encrypted backup.
3. Parsing rules for more banks' SMS formats; learn from corrections.
4. Reminders before bills and EMIs are due.
5. Later, with a licensed partner: Account Aggregator for iPhone users and more accurate data.

## Known limits of the prototype

- Debt balances don't go down automatically; update them from each statement.
- Fixed payments are assumed to be paid on their due date.
- Data lives in one browser. Use **Show backup** on the Plan tab to copy it to another device.
- Fonts load from Google Fonts. The phone app would bundle them so it makes no network requests.
