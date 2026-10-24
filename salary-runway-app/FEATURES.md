# Salary Runway: complete feature list

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

## 1. Privacy and your data

- **Everything stays on your device.** There is no server and no account, and nothing is uploaded.
- In the Android app, fonts are bundled, so the app makes no network requests. Android's cloud backup and device-to-device transfer are **turned off** for the app's data.
- **Backup:** Plan → Your data → *Show backup* → *Copy backup* gives you your whole data as text. Keep it somewhere safe.
- **Restore:** paste a backup into *Restore from backup*.
- **Erase everything**, after a confirmation.
- **Example data:** the app opens with example numbers (₹55,000 salary, rent, a bike EMI, a credit card and a personal loan, four months of spending), clearly marked. *Start with my numbers* clears them.
- **Updates keep your data.** New versions install over the old one because the app ID and signing key never change. Uninstalling deletes the data, so take a backup first.

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
Backup, restore, example data, erase, and **Clean up SMS imports** (removes SMS-imported entries before a chosen date and keeps anything added by hand).

## 3. Payday check-in

- Asked in the **first week of each salary cycle**, or as soon as the bank's **salary SMS** arrives, which pre-fills the amount.
- **"Payday! How much came in this month?"** Same as usual is one tap.
- **More than usual:** asks why (Bonus, Incentive or commission, Overtime, Arrears or hike arrears, Reimbursement, Other) with an optional note. The extra then goes to [Money received](#7-money-received), so you decide what it does.
- **Less than usual:** asks why (Tax deduction (TDS), PF or other deduction, Unpaid leave, Advance or loan recovery, Paid in part / late, Other) with a note. **This month's budgets are planned on what actually came in.** Other months are unaffected.
- **"This is my new usual pay from now on"** for raises or a new tax slab.
- Can be changed later from the Plan tab. Changing it undoes the old record, including a bonus entry.

### Payday reset (3 steps)
Opens once a cycle, right after the payday check-in is saved. **Later** (or Escape) closes it at any step.
1. **What's already spoken for:** *Payday check-in (₹55,000)*: fixed payments, loan minimums and EMIs, bills that vary (monthly share), yearly costs (monthly share) → **Money free for your month**.
2. **Pay yourself first:** your plan's set-asides (emergency fund with the Days of Freedom it adds, extra toward your costliest loan, savings / investing), each editable **for this month only**, with a live total and what's left for flexible spending. **Lock in** adds them to your funds and fills the yearly-cost pots.
3. **Your safe daily runway:** *₹660 / day* until payday, the same number as *Left to spend today*. **Start my month**.

All numbers come from the same plan as the rest of the app. Locked-in money already left on payday, so it isn't taken off the balance again. If you then move it to Jar or a savings account, that SMS joins the locked-in amount instead of counting twice. The Grow tab's *I've moved this money aside* does the same lock-in.

## 4. Runway tab: where you stand today

### Zone
A three-part meter, **Green · Careful · Red**, with a headline that says what to do.

| Zone | When | What the app says |
|---|---|---|
| **Green** | At the current pace, money lasts until payday | Money left at payday, days in a row within the daily amount, card-free days |
| **Careful** | Bills and basics are covered, but this pace runs out before payday | The date money runs out, your daily pace, and the daily amount that keeps you safe |
| **Red** | The money left doesn't cover the bills still to pay plus groceries and health until payday | How much you're short, and ways out with amounts (below) |

**Ways out of the red:**
1. Use money from the emergency fund. One tap moves it in, rounded up so it really clears the gap.
2. Pause this month's Grow and extra debt payments until payday.
3. Spend only on basics (a daily amount for groceries and health).
4. Avoid the credit card for daily spending.

### Graph
- Balance so far (solid line), **if you keep this pace** (dashed), **if you keep to budget** (dotted).
- **Red band:** what bills and basics still need from each day to payday. If a line dips into it, trouble is coming.
- Dots for bills and EMIs, a *Today* marker, and the date the pace line crosses ₹0.

### Tiles
- **Left to spend today:** today's amount, minus what you've spent today.
  - Today's amount is the smaller of (a) the flexible budget left divided by the days to payday, and (b) the money in the account after bills still to come, divided by the days to payday.
  - If you go over: "₹147 over today's ₹200. Tomorrow: ₹182."
- **Balance now:** worked out from your plan, or from your last balance check, with *Update*.
- **Next salary:** days to payday.
- **Flexible spending:** spent against the budget, including money received, since the balance check if there is one.

### Next payday preview
- **"Effective payday: ₹50,742"**: your usual pay minus what's **already borrowed against it**:
  - this month's shortfall at your current pace (it ends up borrowed)
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
- **Needs your check:** payments recorded from SMS that you haven't confirmed. Change the category or Paid from, then *Looks right* or *Not a payment*. Highlighted until done.
- **Bills to pay:** bills that vary that are due, with *Paid*, plus bill payments from SMS to link to the right bill.
- **Bank SMS:** see [Bank SMS reading](#6-bank-sms-reading).
- **Payments list:** this cycle or all. Shows where entries came from (SMS or widget) and whether they were paid by card. Changing a category makes the app remember it for that shop. *Delete* also undoes what an entry changed: a loan payment goes back on the loan, a fund move comes back out of the fund, a bill's due date returns to what it was, and an EMI is removed.

## 6. Bank SMS reading

- **Android app:** reads the inbox after you allow it, **starting from the day you give permission**. After that it checks for new messages each time you open the app. You review payments before they're added.
- **Browser version:** paste messages to import them.
- **Notifications for new bank SMS** (optional, Android): see [Android app extras](#14-android-app-extras).
- Only **named senders** (such as VM-HDFCBK) are read; messages from phone numbers are ignored.
- **Understands:** amounts (Rs, INR, ₹), debits and credits, dates in common formats, and the shop or person (UPI IDs, "to …", "at …", "Info: UPI/…/SHOP").
- **Skips:** OTPs, offers and promotional messages.
- **Automatic categories:** Food & dining (Swiggy, Zomato, …), Groceries (Blinkit, Zepto, DMart, JioMart, …), Travel (Uber, Ola, Rapido, IRCTC, fuel, …), Shopping (Amazon, Flipkart, Myntra, …), Entertainment (Netflix, Spotify, BookMyShow, …), Health (pharmacies, hospitals), Personal care, **Bills** (recharges, Airtel, Jio, electricity boards, gas, broadband), and **Savings** (Jar, Groww, Zerodha, Kuvera, Upstox, mutual funds, SIP, NPS, PPF, RD/FD, digital gold; short words like *jar* and *sip* only as whole words, so *Rajarani Sweets* isn't savings). **Your corrections win** next time.
- **Savings transfers aren't counted twice:** if "You saved ₹58 → emergency fund" and the Jar SMS for ₹58 both happen (in either order, within two days), they become one entry.
- **Credit cards:** tells card from account ("Credit Card ending 1234", "Avl Limit" vs "A/c", "Debit Card") and matches the card by its last 4 digits. Card **statements** set the bill, minimum and due date. **Bill payments** are recorded as card payments, not income, and the bank's and the card's SMS for the same payment count once.
- **Salary SMS** are recognised and used for the payday check-in, not counted as extra money.
- **No duplicates:** each SMS is identified by its text, so it's never recorded twice, whether it arrives by notification, inbox reading or paste.

## 7. Money received

For a refund, money from home, money returned, cashback, side income or extra pay.
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

## 10. Credit cards

**Why:** card spending doesn't leave your bank account today, so a month looks better than it is, and the bill lands on next month's salary.

- **Up to 10 cards:** name, last 4 digits, limit, statement day, due day, interest rate (42% if unknown), and what you owe when adding the card (last statement, its due date, and spending since).
- **Card spending counts as spent the day it happens.** Budgets, today's amount and zones stay honest, and the money is treated as kept aside for the bill. Paying the bill only moves money to the card, so it isn't counted twice. A balance check subtracts card spending not yet paid.
- **Each card shows:** the bill and its statement date, amount paid, **amount left to pay by the due date**, spending since the statement (next bill), and **limit used**, with a note above 30% because staying under it helps your credit score.
- **Reminders** on the Runway tab a week before the due date, and when overdue.
- **Each card payment shows a warning:** "Borrowed ₹1,000 on HDFC card… next bill so far ₹3,000", plus "this lands on next month's salary" when you're not in the green.
- **Plan this payment**, with each option's real cost:
  - **Full:** no interest. Suggested whenever you're not in the red, because the money was kept aside.
  - **Minimum:** next month's interest, and how many months and how much interest it takes to clear at the minimum. Labelled "This is how the card trap starts."
  - **Part:** pay what you can.
  - **Convert to EMI:** enter the bank's amount, rate (22% default), months (3, 6, 9, 12, 18 or 24) and processing fee. The app compares it with carrying the same amount on the card ("EMI saves ₹1,563"). **Suggested only when you can't pay in full and it's clearly cheaper**, always with "An EMI is still a loan". After converting, it moves to Debts and every month's plan, **starting with the next bill**; the fee is charged on the card.
- **Overdue bill:** shows the monthly interest it now costs, with *Move to loans* for a payoff plan.
- Spending recorded before a card is added (from SMS) links to it automatically once you add it.

## 11. Debts tab: loans and payoff plans

- **Interest leak banner** at the top: **You are losing ₹151/day to bank interest**, with the monthly total and the biggest leaks. It's red with any debt at 15%+, amber otherwise. Only money that actually costs interest counts: loans (including card EMIs and carried balances) and card bills past their due date. A card bill paid in full on time costs nothing, and 0% (no-cost) EMIs are left out.
- **Credit cards** section (above).
- **Loans:** name, balance, interest rate, monthly minimum and due day. Card EMIs and carried card balances land here too.
- Monthly **interest cost** of each loan, highlighted at 15%+.
- **When will you be debt-free?** Add an extra amount per month and compare:
  - **Minimums only**
  - **Highest interest first** (pays the least interest)
  - **Smallest balance first** (quick wins)
- Each plan shows the debt-free month, months, total interest, savings against minimums and the order loans are cleared. It warns if a minimum is smaller than the monthly interest ("never paid off").

## 12. Grow tab: safety nets and saving

- **This month's set-aside:** what to move aside this cycle, with *I've moved this money aside* to add it to your funds.
- **Saved from daily leftovers** this month.
- **Days of Freedom:** the emergency fund as time. *6 Days of Freedom 🛡️* means it covers your basics (fixed payments, loan minimums, bills that vary, groceries and health) for that long, at your own daily cost. Badges: **Unprotected** (0 days), **Starter shield** (1–14), **Incident proof** (15–89), **Unshakeable** (90+). At 0 days: *Every ₹1,253 saved buys one day of complete financial security.* Until basics are set up: *Add your fixed payments and budgets to see your Days of Freedom.*
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

## 14. Android app extras

- **Home-screen widget "Spend today"** (3×1):
  - Shows what's left to spend today. When you go over: **Over by ₹147 · Tomorrow's safe spend drops to ₹135**, in amber. This updates even for expenses added from the widget or card SMS while the app is closed.
  - **+ Add** opens a small window over the home screen (amount, category, note) to record an expense **without opening the app**. The widget's amount drops straight away, and the app saves the expense next time it opens.
  - After midnight it shows "Open app" until the app works out the new day.
- **Notifications for new bank SMS** (turn on in the Spend tab; asks for SMS and notification permission):
  - A payment shows *₹450 paid to Swiggy · Tap to check the category*. On a card: *₹750 paid via HDFC card · Borrowed money: tap to verify the category*.
  - Tapping opens **Check this payment**: the SMS text, category, **Paid from**, a note, and *Save* or *Not a payment*.
  - Payments you don't check are recorded anyway and wait under **Needs your check**.
  - **Salary SMS:** *Payday! ₹57,500 credited · Tap to review your monthly plan*.
  - **Card statement:** "HDFC card bill: ₹12,500 · Tap to plan the payment".
  - Card bill payments are recorded quietly.
- **Updates:** a new APK every **Sunday morning** (India time), only if something changed. It installs over the old one and keeps your data.

## 15. Design and behaviour principles

- **Friction only on harmful choices:** borrowing on a card gets red labels and warnings; good choices (saving, paying debt) are one tap.
- **Smart defaults, never forced:** a *Suggested* badge, always with the reason.
- **Numbers on screen, help on request:** cards show amounts, dates and warnings. How a feature works sits behind the **(i)** next to its title (Runway, payday, adding money, bank SMS, payments, salary, fixed payments, bills that vary, set-asides, yearly costs, flexible budgets, your data, SMS cleanup, credit cards, loans, payoff plans, emergency fund, emergencies, Grow). The SEBI adviser notice on the Grow tab and the footer disclaimer stay visible.
- **True numbers only:** rewards and warnings never exaggerate.
- **Colours:** freedom green `#0D7A5D` / `#2ECC71` (dark), debt red `#D32F2F` / `#F26657`, caution amber `#E67E22` for fills and `#9A5400` / `#F39C12` for text, neutral `#616161` / `#BDC3C7`, card warning background `#FFF5F5` / `#2C1E1E`. All text colours meet readability guidelines.
- **Fast and offline:** all of this is worked out on the phone from data the app already has, in well under a millisecond per calculation, with no new data stored.

## 16. Regulatory design

- The app does budgeting, debt planning and savings set-asides only.
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
