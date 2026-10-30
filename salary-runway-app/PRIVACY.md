# Hisab Se: privacy policy

*Last updated: 1 November 2026. Draft for review by a lawyer before the app is published on Google Play.*

Hisab Se is a budgeting app for salaried people in India. It is built so that your money data stays on your phone. This page says what the app does with data, in plain words.

**Who is responsible:** the developer of Hisab Se, contactable at the e-mail address on the app's Google Play page. [Developer name and e-mail to be filled in before publishing.]

## 1. What stays on your phone

Everything you record: payments, money received, budgets, bills, loans, cards, goals, people you lend to or borrow from, trips, notes, and the amount, date and shop of each bank SMS the app reads. It is kept in the app's private storage on your phone.

- There is no account and no sign-in. We don't have a copy of your data.
- Android's cloud backup and device-to-device transfer are turned off for the app, so Google doesn't get a copy either.
- With the app lock on, the data is encrypted on the phone.
- If the phone is lost or reset, or the app is uninstalled, the data is gone unless you made a backup file.

## 2. Bank SMS

The app reads SMS only when you tap *Read bank SMS* or turn on payment alerts. Messages from phone numbers (friends, family) are skipped before the app sees them. From a bank message, only the amount, date, shop and account type are saved, never the message itself. Nothing from SMS is sent anywhere.

## 3. What can leave your phone, and only when you choose

| What | When | What it holds | Where it goes | How long it is kept |
|---|---|---|---|---|
| **Crash reports** | Automatically after an error, **only if you said yes** (asked once; change it any time in Profile → Privacy) | The error and where in the app's code, the last screens and buttons, the Android version and phone model, the app's build, language and screen size, and how many entries of each kind you have. **No amounts, payments, names, notes, SMS or anything that says who you are.** | The app's server (Cloudflare Workers) | 90 days, then deleted automatically. No IP address is kept. |
| **Problem report** | Only when you tap *Save report file* or *Share report*, and send the file yourself | By default the same kind of details as a crash report. If you tick *Add my numbers, names hidden*: your amounts and dates, with every shop, person, account, card, loan, goal and note replaced by a random code; no SMS text, account digits or times of day. You can see the whole file before it's made. | Wherever you send it (e-mail, WhatsApp) | The developer deletes it once the problem is fixed, and within 90 days at most. |
| **AI weekly plan** | Once a week, **only if you turn it on** | A summary of numbers the app already worked out (today's limit, spending by category, budgets, bills to come, loans, cards and goals by the names you gave them). Never SMS text, shop names, notes or account numbers. You can see exactly what's sent. | The app's server, which keeps nothing, then Anthropic (the maker of Claude) to write the plan. Anthropic doesn't use it to train its models. | Not kept by the app's server. Anthropic handles it under its own privacy policy. |
| **Backup file** | Only when you make one | All your data, locked with a password you choose (AES-256). Without the password nobody can open it, not even the developer. | Where you save or share it | As long as you keep it |

Nothing else is sent: no analytics, no advertising, no tracking, no Google services.

## 4. Why, and the law

- Crash reports and problem reports are used only to find and fix bugs in the app. The AI plan's summary is used only to write your plan. None of it is used for marketing, sold or shared with anyone else.
- We collect as little as the purpose needs, and say so before anything is sent. Saying no is as easy as saying yes, and you can change your mind at any time.
- The app is built to India's Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025, and the IT Act's rules on sensitive personal data, which include financial information.
- If something were ever to go wrong with data we hold (crash reports), we would tell the people affected and the Data Protection Board of India as the law requires. Crash reports hold nothing that identifies you, which keeps this risk low.

## 5. Your choices and rights

- **Crash reports:** Profile → Privacy → *Turn off crash reports*. Reports not yet sent are deleted from the phone at once.
- **AI weekly plan:** Profile → AI weekly plan → *Turn off the weekly plan*.
- **Erase everything:** Profile → Backup & data → *Erase everything* removes all your data, the log and crash reports waiting to be sent from the phone.
- **Questions, corrections or deletion:** write to the e-mail on the Google Play page. Crash reports can't be linked to a person, so we can't find "yours"; they are deleted after 90 days in any case.

## 6. Children

Hisab Se is meant for adults (18 and over) managing their own salary.

## 7. Changes

If this policy changes, the new version will be in the app's update notes and on this page, with a new date at the top.
