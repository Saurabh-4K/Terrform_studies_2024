# Hisab Se: noted requests (not built yet)

Requests written down to build later. Items marked (built) are in the app; FEATURES.md describes them.

## 1. Profile screen (like standard apps) (built)
A **Profile** button in the top bar (an avatar or person icon) opens one screen that holds the settings now spread around the app:
- **Appearance:** Light, Dark, or Same as phone. Today the app only follows the phone's setting.
- **Language:** English, मराठी, हिंदी (moved here from the Plan tab).
- **Privacy and data protection:** the "Your privacy" details move here. They come off the Plan tab, so the main screens stay about money.
- **Your data:** backup file, restore, erase everything, clean up SMS imports, personal mode.
- **App lock** with fingerprint, face or the phone's screen lock (see 3).
- **See the app tour** (see 2).
- About: version and build number.

## 2. First-time tour (demo) (built)
- Shown the first time the app opens, before setup. It is a few swipeable screens explaining the main ideas:
  - today's limit
  - zones (green, careful, red)
  - Days of Freedom
  - the round board
  - the debt journey
  - SMS reading and privacy
- **Skip** on every screen.
- Anyone who skipped it can replay it from **Profile → See the app tour**.
- Uses example numbers, never the person's own.

## 3. App lock: fingerprint, face or the phone's own lock (built)
Decided: **no separate app password.** The lock uses what the phone already has:
- **Fingerprint or face unlock** through Android's own biometric prompt. It works offline.
- **The phone's screen lock (PIN, pattern or password) as the fallback**, through the same prompt, for when a finger isn't read or the phone has no fingerprint sensor.
- Nothing new to remember, so there's no forgotten-PIN problem. Whoever can unlock the phone can unlock the app.
- If the phone has no screen lock at all, the app says that one is needed to turn on the app lock, and points to the phone's settings.
- Options:
  - lock every time the app opens, or after 1, 5 or 15 minutes away
  - hide the app's contents in the recent-apps screen
- The home-screen widget and SMS notifications show amounts. Add an option to hide them while the lock is on.

## 4. Data protected even if the phone is lost (built)
- **Backup file: already encrypted.** Since build 40 it's locked with the user's password (AES-256-GCM, key from PBKDF2-SHA256, 210,000 rounds). Without the password nobody can open it, wherever the file is. Keep this, and say it clearly on the backup screen.
- **Data on the phone:** today it sits in the app's private storage. Other apps can't read it, and Android encrypts the phone's storage while the phone is locked. But someone holding an unlocked phone can open the app. To build:
  - the app lock from 3
  - encrypting the app's data on the phone with a key kept in the Android Keystore, released only after fingerprint, face or the phone's screen lock

  Then even a copied storage dump shows nothing readable.

## 5. Widget in zone colours (built)
The home-screen widget changes colour with the zone, with the same signs as the app's zone cards, so the state shows without opening the app:
- **Green** with a sparkle/celebration sign: on track.
- **Yellow (careful)** with a warning sign ⚠️: at this pace, money runs out early.
- **Red** with a stop sign 🛑: bills and basics aren't covered.

The zone label shows in bold next to the sign, with text that stays readable on each colour, in light and dark mode. The app sends the zone to the widget along with today's amount. If "hide amounts while locked" (see 3) is on, the widget still shows the colour and sign, but not the amount.

## 6. Less open at once: icon grid by category, with the essentials always open (built)
Today every card is open, so screens read like a long report. The idea (from a PhonePe-style home screen): small icons grouped by category, each opening its card only when tapped. Proposed mix, to confirm before building:
- **Always open, never collapsed:** today's limit with the zone colour and sign, and Days of Freedom. These are the pain point and must stay visible.
- **Warnings never collapse:**
  - red zone
  - a card bill due
  - "how did your call go?"
  - the backup reminder
- **The rest as a grouped icon grid**, each icon opening its card full-screen. Example for the Runway tab:
  - *This month:* Round board, Week recap, Bills to pay, Next payday
  - *Check & plan:* Big expense?, Graph, Insights, AI plan
  - *Money:* Balance, Cards, Money received
- **Live badges on icons** so nothing important hides: "2 due" on Bills, the amount on Cards, ✓ on Week recap. This is part of the design, not an extra.
- **Other tabs, same style:**
  - Plan in groups (Salary, Fixed, Budgets, Savings, Your data), each showing a one-line summary until tapped. This replaces the review item "group the Plan tab".
  - Spend: the three graph views as icons.
  - Debts: the journey card open, with loans, calls and cards as icons.
- **Hisab Se's own icons and colours** (teal, cream, mint, coral), not a copy of another app's look.

## Still pending from the review list
- A clearer Debts screen when there are no debts.
- Group the Plan tab's inputs, hide advanced settings, and show the result summary first.
- Grow tab: show the investment split only after a minimum emergency cushion exists.
- Tagline: "Make your salary last".
- Step 9 of the plan: Pro version and monetisation, after the daily flow has been used for a round or two.
