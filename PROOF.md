# Proof: the tests caught two real bugs, then went green

To prove the test suite does its job, I broke the app on purpose twice and watched what happened. Both breaks were in stock tracking, and each was a different kind of mistake.

The first time, I removed the one line that takes sold items out of stock. The TestSprite check on the pull request turned red. I put the line back, the check turned green, and only then did the change merge.

The second time, the line stayed but took off the wrong amount: every sale took twice the stock off the shelf. The check turned red again, with 3 failures, and went green once I fixed the line.

Every run below happened in TestSprite against a live copy of the app, from a GitHub pull request. Each link opens the full run.

Further down there is a third proof, for the offline unit tests that check the money maths.

## First proof: the stock line removed

| Step | What I did | Result | Links |
|---|---|---|---|
| Baseline | First check on a clean change | 12 of 12 passed | [PR #1](https://github.com/Sireadell/pricekeeper-demo/pull/1), [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/78a6cc60-f691-4d7b-81d9-f104af505d07) |
| Red | Removed the line that lowers stock after a sale ([28bed78](https://github.com/Sireadell/pricekeeper-demo/pull/3/commits/28bed78)) | 5 failed. 3 of them were the stock tests | [PR #3](https://github.com/Sireadell/pricekeeper-demo/pull/3), [red run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a66f2860-07a5-4fb1-8241-a8decc0185b5) |
| Fix | Put the line back ([08558e4](https://github.com/Sireadell/pricekeeper-demo/pull/3/commits/08558e4)) | Stock tests pass again | same PR |
| Green | Full check on the final version, then merged | 24 of 24 passed | [green run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/7bc6aa85-f9f6-4033-bd2e-d122d8fb5a49), merged as [56a0f34](https://github.com/Sireadell/pricekeeper-demo/commit/56a0f34a83f8619090b87f4881e39106dd03ea01) |

## What the red run caught

With the stock line gone, a sale still went through and the till looked fine. The shelf count was wrong, and three tests noticed:

- **Sell one piece.** Stock should drop from 20 to 19. It stayed at 20.
- **Sell five pieces.** Stock should drop from 20 to 15. It stayed at 20.
- **Sell until stock runs low.** The item should show in the low-stock list. It never did.

This is the bug a shop owner would find weeks later, when the shelf is empty and the app says otherwise.

## The other two failures

Two more tests failed in the red run, and neither was about stock. The wrong-PIN login test passed in every run after it. The add-customer test was removed from the suite because the test agent could not fill in the New Customer box. That is a limit of the agent, not a bug in the app.

## Second proof: every sale took twice the stock

This one is a different mistake in the same part of the app. Nothing was missing this time. The stock line was there, it just took off the wrong amount.

| Step | What I did | Result | Links |
|---|---|---|---|
| Red | Changed one line in `js/trade-payment.js` so every sale took twice the stock off the shelf ([faf7639](https://github.com/Sireadell/pricekeeper-demo/pull/6/commits/faf7639)) | 21 passed, 3 failed | [PR #6](https://github.com/Sireadell/pricekeeper-demo/pull/6), [red run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d50ec602-0006-4dca-a698-825e312bef0a) |
| Fix | Put the line back ([536c1bf](https://github.com/Sireadell/pricekeeper-demo/pull/6/commits/536c1bf)). The file now matches main exactly | | same PR |
| Green | Full check on the fixed version | 24 of 24 passed | [green run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/ddc06f18-ebf9-45f1-ab51-e2b027b35a2a) |

## What the second red run caught

Stock still went down after a sale, so a quick look would say it worked. The numbers were wrong, and three tests noticed:

- **Sell one piece.** Stock should drop from 20 to 19. It dropped to 18.
- **Sell until stock runs low.** The item should show in the low-stock list. It never did.
- **Sell five, then void the sale.** Stock should be back at 20. It was 15.

This was the first time the void test caught a real fault.

## Unit tests: the money maths, checked on every push

Next to the 24 TestSprite browser tests, there are 64 small unit tests in five files in the `tests/` folder. They check the sums behind the screens: average cost, price and margin, stock units, week and month keys, dead-stock and profit-leak warnings, the customer debt book and how a payment is shared across debts, plus a few small helpers. The browser tests only see these numbers through the page, so a wrong figure can hide behind a screen that looks fine.

They run on Node's built-in test runner, with no packages to install. A GitHub Action called "Unit tests" runs them on every push and pull request and finishes in seconds. They cost nothing to run, and they pass in four time zones: UTC, Lagos, Los Angeles and Auckland.

To check they catch real mistakes, I broke the source 19 different ways on purpose. All 19 breaks made a test fail.

Then I did one break in the open, on a throwaway branch (`proof/break-average-cost`) with no pull request:

| Step | What I did | Result | Links |
|---|---|---|---|
| Red | Changed the average-cost line in `js/inventory-math.js` so it divided by the old pieces only ([39691d9](https://github.com/Sireadell/pricekeeper-demo/commit/39691d9)) | 3 of 64 failed | [red run](https://github.com/Sireadell/pricekeeper-demo/actions/runs/39551977546) |
| Green | Put the line back ([59e91b9](https://github.com/Sireadell/pricekeeper-demo/commit/59e91b9)) | 64 of 64 passed | [green run](https://github.com/Sireadell/pricekeeper-demo/actions/runs/39552047945) |
| Main | Left alone the whole time ([25805e7](https://github.com/Sireadell/pricekeeper-demo/commit/25805e7)) | Green | [main run](https://github.com/Sireadell/pricekeeper-demo/actions/runs/39551611116) |

Average cost is what every price and profit figure in the app starts from, so this is a break that would quietly spread to every screen.

## What the unit tests do not cover

Taking stock off the shelf after a sale needs the live database (Firebase), so it cannot run offline. That part is covered only by the TestSprite tests above.

## Rules I kept

- The break was on purpose, to show the suite catches it.
- Nothing merged while the check was red. During the two proofs above I held that rule myself. Since October 21, GitHub enforces it: the `main` branch will not accept a merge until the TestSprite check and the unit tests both pass.
