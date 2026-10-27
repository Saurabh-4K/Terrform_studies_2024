Financial Accuracy Review — Suggestions for the Developer

Purpose

These are suggestions for improving the reliability of Hisab Se's financial calculations while preserving the current product experience and local-first approach. They are not a claim that every item is a confirmed defect, and they are not a request for a large rewrite.

Please use engineering judgement, inspect the relevant production paths, and validate assumptions against the intended product behaviour before changing code. Some observations may turn out to be false positives or may already be handled elsewhere.

Suggested working approach

1. Reproduce before fixing. Trace each suspected issue through the UI, stored transaction/state, core calculation, and displayed result. Record the starting state, action, expected result, and actual result.
2. Prefer small, reviewable changes. Preserve existing history, local storage formats, and UI behaviour unless a migration is demonstrably necessary. Avoid a broad rewrite unless the current design cannot safely represent the required accounting behaviour.
3. Make financial semantics explicit. A transaction's effect on cash, spending, income, liabilities, assets, budgets, and net worth should be intentional and consistent across screens.
4. Keep recommendations conservative. If a calculation cannot be validated or its inputs are incomplete, show the assumptions or a clear “needs review” state rather than presenting an uncertain estimate as fact.
5. Run regression tests after each change. Update expected results only when the accounting rule has been reviewed and documented—not simply to make a failing test pass.

Areas worth reviewing

1. Debt payoff estimates

In "salary-runway-app/core.js", "debtFreeDates()" compares a minimum-payment simulation using "simulateDebts(debts, 0, 'avalanche', false)" with a planned simulation using "simulateDebts(debts, extra, payoffOrder(state), true)".

It may be worth checking whether both scenarios should use the same rollover assumption. When a loan is cleared, carrying its freed payment to another loan can change projected payoff dates and interest. If rollover is intended only for the planned scenario, the UI should make that difference clear; otherwise, compare like-for-like scenarios.

Suggested test cases:

- No extra payment, with one loan and with multiple loans.
- Extra payment of zero versus a positive extra payment.
- Avalanche and snowball ordering.
- Loans with fixed EMI counts and loans without them.
- A cleared loan whose minimum payment becomes available for another loan.
- A loan that cannot be paid off under the simulated budget.

Check that dates, total interest, “months sooner,” and “interest saved” follow from consistent assumptions. In particular, zero extra payment should not appear to create savings merely because the comparison uses different assumptions.

2. Transaction accounting and the money map

The files "salary-runway-app/tests/money-map.js" and "salary-runway-app/tests/money-map.test.js" define expected changes to several app metrics for representative transaction types.

A few fixture expectations may be worth verifying against the intended accounting model and the real UI flow:

- Refund to card: the fixture expects bank balance and income to rise while card debt falls. A refund credited directly to a card may not increase bank cash and normally should not be treated as new earned income. Confirm how this transaction is recorded and how refunds should affect category budgets and card obligations.
- Bank loan credit: the fixture marks a ₹10,000 transaction as borrowed but expects income and net worth to increase by ₹10,000 without creating a corresponding liability in that fixture. Confirm whether the production flow creates or links a debt elsewhere. If it does not, consider representing the liability explicitly or requiring the user to confirm the credit's classification.
- Transfers between owned accounts or wallets: verify that the source decreases and destination increases by the same amount, without creating income or spending or changing net worth.
- Card repayments: verify that repayment reduces cash and the amount owed consistently, and that the same card spending or EMI is not counted twice.
- Money received from or paid to friends/family: ensure cash movements and related IOUs, liabilities, or receivables are reflected once each without accidental income or expense classification.

These are review leads from test fixtures, not confirmed production defects. Trace the real paths before changing implementation or declaring a bug.

3. Salary allocation and cash-flow runway

Review "monthlyPlan()", "cycleEvents()", and "projectRunway()" together so the planned allocation and projected cash flow tell a consistent story.

Potential checks:

- Fixed expenses, debt minimums, variable bills, savings, goals, and flexible budgets are not allocated twice.
- Total allocated amounts reconcile to salary and clearly expose any surplus or shortfall.
- Payments owed to people that fall within the salary cycle are considered in the cash-flow plan where appropriate. Confirm whether IOU payments are represented in the allocation, events, or another reservation mechanism before adding them, to avoid double-counting.
- Due dates, overdue payments, bill pots, card payments, and payday boundaries are handled consistently.
- If actual salary differs from expected salary, recommendations recalculate using the actual amount and do not silently assume the usual salary arrived.
- Projected balances do not imply that cash is available when it is already reserved for an imminent commitment.

A useful invariant is that planned allocations and dated cash commitments must be explainable from the same inputs, with any differences clearly identified.

4. Returns and reimbursements

Consider distinguishing these related but different cases:

- A retail refund reverses or credits the original purchase category rather than automatically becoming fresh income.
- A reimbursable expense is still a real cash outflow when paid, even if the app excludes the eligible portion from a personal discretionary budget.
- A reimbursement receipt is linked to the relevant claim and does not duplicate the original expense.
- Partial, delayed, under-, and over-reimbursements are represented clearly.
- Claims and receipts spanning salary cycles remain linked and do not distort monthly income or spending reports.
- If a reimbursement has a user-selected destination (for example, monthly budget credit or a separate side-cash balance), that choice is applied once and remains consistent when a transaction is edited or reprocessed.

Document the intended behaviour before implementation, because budgeting treatment and actual cash movement are separate concepts.

5. SMS imports and duplicate protection

Where bank SMS parsing feeds transaction records, check that:

- Reprocessing the same SMS does not create duplicate financial entries.
- Ambiguous loan credits, card refunds, transfers, reversals, and card payments are flagged for confirmation instead of confidently misclassified.
- Parsed date, amount, account/card, and transaction direction are validated.
- Editing or correcting a parsed transaction updates all affected calculations without leaving stale derived values.
- Parsing rules are covered by examples from supported banks, with sensitive message content excluded from committed test fixtures.

Suggested accounting invariants

These examples can be converted into automated tests and adjusted to the app's exact definitions:

- Own-account transfer: source cash decreases by ₹5,000 and destination cash increases by ₹5,000. Combined cash and net worth do not change.
- New borrowing: cash increases by ₹10,000 and the related liability increases by ₹10,000. Net worth and earned income do not increase solely because of the borrowing.
- Repayment of a recorded liability: cash and outstanding liability decrease consistently. Do not record the same principal payment as a new purchase expense. Handle interest and fees separately according to the app's reporting rules.
- Card purchase: the purchase is counted once in spending and the card obligation increases. Available bank cash follows the app's documented card-reservation model.
- Card refund: the card obligation and/or original spending category is adjusted according to the actual refund destination; it is not automatically new earned income.
- Internal savings movement: moving money between the user's own cash and savings buckets does not by itself change net worth. Funds held outside the main account should be treated consistently across balances and reports.
- Deleting or editing a transaction: all affected totals return to the values implied by the remaining records; no orphaned debt, reimbursement, or savings adjustment remains.

These examples are starting points, not a complete accounting specification. Confirm the expected semantics and current app definitions before treating any example as an acceptance criterion.

Definition of done for a financial fix

For each fix, please aim to provide:

- The reproduced scenario and root cause.
- The agreed accounting rule and why it matches product behaviour.
- A regression test covering the original issue.
- Relevant edge cases, including editing/deleting and reprocessing where applicable.
- Evidence that related screens and totals remain consistent.
- A brief note about any migration or compatibility risk.

Reference material

These projects may be useful as design references, not as code to copy wholesale:

- Actual Budget: envelope/zero-sum budgeting and returns/reimbursements concepts.
- MoneyMatter: explicit relationships between refunds and original transactions, and between transfers and accounts.
- Firefly III: double-entry accounting discipline and transaction consistency.

Please review current licences and compatibility requirements before reusing any third-party code. For this local-first app, the goal is to adopt clear accounting rules and strong tests without adding a server or unnecessary architectural complexity.


Reference Repositories — For Further Study

The following open-source projects may offer useful ideas for improving financial accuracy, transaction modelling, budgeting, and testing. These are references for exploration, not instructions to copy their implementation.

1. Actual Budget

Repository: https://github.com/actualbudget/actual

Useful areas to explore:

- Envelope budgeting and allocating available income.
- Handling returns and reimbursements.
- Credit-card budgeting and category balances.
- Keeping budgeted amounts consistent with available funds.

Suggested application: Review whether Hisab Se's salary allocation and refund handling could benefit from similarly explicit budgeting rules.

2. Firefly III

Repository: https://github.com/firefly-iii/firefly-iii

Useful areas to explore:

- Double-entry accounting concepts.
- Consistent treatment of transfers, expenses, income, and liabilities.
- Transaction rules and financial reporting.
- Data integrity and reconciliation.

Suggested application: Identify accounting invariants that can be tested in Hisab Se without introducing unnecessary architectural complexity or requiring a server.

3. MoneyMatter

Repository: https://github.com/letehaha/moneymatter

Useful areas to explore:

- Relationships between refunds and original transactions.
- Explicit modelling of transfers between accounts.
- Refund validation and transaction consistency.
- Edge cases involving transaction relationships.

Suggested application: Review how Hisab Se can represent refunds, transfers, and their original transactions more clearly, with appropriate validation and regression tests.

4. Awesome Open Source Boilerplates

Repository: https://github.com/EinGuterWaran/awesome-opensource-boilerplates

Useful areas to explore:

- Potentially relevant open-source project structures and development patterns.
- Testing, maintainability, and tooling ideas from suitable projects in the collection.

Suggested application: Use this as a discovery resource only if a specific project addresses a current engineering need. It is not a financial-accounting authority.

Guidance for Using These References

- Study the relevant source code and documentation before drawing conclusions.
- Prefer learning from established accounting concepts and adapting them to Hisab Se's requirements.
- Do not assume another project's behaviour is automatically correct for this app.
- Check each repository's current licence and compatibility requirements before copying or adapting code.
- Prefer independently implemented, well-tested solutions where that is simpler and safer.
- Document the accounting rule, expected behaviour, and regression test for any adopted idea.

These repositories are intended to support engineering judgement. Their presence here does not imply that Hisab Se has the same defects, that their implementations are error-free, or that any particular change is required.

Closing note

This document is a set of suggestions for investigation, not an authoritative audit or a substitute for developer verification. AI-assisted analysis can be incomplete or mistaken. Please independently confirm each point against the current source, reproduce any suspected issue, and use the project's intended accounting rules before implementing a change.