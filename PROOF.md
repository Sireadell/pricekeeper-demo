# Proof: every red run and every green run

This file has the full trail behind the README. It starts with pull request #10, where TestSprite found five problems I didn't know about. Below that are the two planted bugs it missed, the two breaks it caught, and the unit tests.

Every TestSprite run below happened against a live preview copy of the app, from a GitHub pull request, unless it says otherwise. Each link opens the full run.

## Pull request #10: five problems, then 43 of 43

[Pull request #10](https://github.com/Sireadell/pricekeeper-demo/pull/10) began as a planted bug: I made the receipt show a sale on credit as paid in full. No test caught it. What the first run did catch was a real bug I hadn't planted: a minus amount received turned into extra debt. From there I kept fixing what each run found until the whole suite passed.

These are all 11 runs on that pull request, in order.

| Commit | Result | What it found or proved |
|---|---|---|
| [9fd0e3a](https://github.com/Sireadell/pricekeeper-demo/commit/9fd0e3a) | [36 of 42 passed, 3 failed, 3 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9b97e840-3a06-4cf9-8394-b982d9a816f8) | **Bug 1.** Typing -500 as the amount received on an ₦800 sale saved ₦1,300 as debt. The planted receipt bug went through unnoticed. Two dashboard tests failed on how falling figures were shown. The two offline tests came back blocked. |
| [5bf2ef6](https://github.com/Sireadell/pricekeeper-demo/commit/5bf2ef6) | [38 of 42 passed, 2 failed, 2 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/b36fe793-8a2e-43bf-b7ed-26e3fd29df91) | Fixed bug 1, took out the planted bug, and gave falling dashboard figures a minus sign. **Bug 2.** The delete test failed on the browser's own pop-up. The minus amount test failed again, but the run shows the app got it right (₦800 owing). The robot had checked a different item with a similar name. The offline tests were blocked again. |
| [6abf224](https://github.com/Sireadell/pricekeeper-demo/commit/6abf224) | [41 of 42 passed, 1 failed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a9a67e16-518a-4989-9f24-e94856c5fdee) | Added the pretend-offline switch. Both offline tests passed. Bug 1's test passed. The delete test failed on the pop-up again. |
| [4b50685](https://github.com/Sireadell/pricekeeper-demo/commit/4b50685) | [40 of 42 passed, 1 failed, 1 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/070003b3-7503-4d2c-b3fd-67f79b03990b) | Delete now asks inside the page, and its test passed. **Bug 3.** The sale test got stuck: saving an item whose name was already in stock left the form open and blank. The failed test was the robot checking a look-alike item. |
| [f228f71](https://github.com/Sireadell/pricekeeper-demo/commit/f228f71) | [41 of 42 passed, 1 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/cc0b7b71-8bc5-416a-b2ee-572c6d714792) | The form now closes and says the item was updated. The sale test passed. The low-stock test was blocked, and it passed in every run after. |
| [1cefe61](https://github.com/Sireadell/pricekeeper-demo/commit/1cefe61) | [41 of 43 passed, 1 failed, 1 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/351e133d-e129-4688-a5e9-3d6681005ef6) | Fixed **bug 4**, the offline reopen (see below). The new reopen test joined the suite and passed. The log-out test failed: after a staff sign-out, the sign-in didn't open straight away. The repayment test was blocked. |
| [c45146e](https://github.com/Sireadell/pricekeeper-demo/commit/c45146e) | [42 of 43 passed, 1 failed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/3e6286de-9196-4a87-b00d-2a92b36357af) | The sign-in now opens right after a sign-out, and the log-out test passed. The wrong-PIN test failed: the shop showed faintly through the sign-in box. |
| [6975881](https://github.com/Sireadell/pricekeeper-demo/commit/6975881) | [42 of 43 passed, 1 failed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/65b84008-c95b-4b71-a9b5-be730c828187) | The sign-in box is now solid. The wrong-PIN test still failed, because the shop's text was still in the page under the box. |
| [97e8e39](https://github.com/Sireadell/pricekeeper-demo/commit/97e8e39) | [41 of 43 passed, 2 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/b1adede2-406e-4924-81be-a2c97f0238e8) | The shop is now hidden for real while the sign-in is open, and the wrong-PIN test passed. Two tests were blocked because the robot picked the wrong item among hundreds of old test items. I cleared those out of the demo shop. |
| [d10dded](https://github.com/Sireadell/pricekeeper-demo/commit/d10dded) | [42 of 43 passed, 1 failed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/675ed041-288c-4af2-9af9-b746005bc34d) | A fresh run on the cleaned shop. **Bug 5.** Typing 0 pieces and pressing Add put 1 piece in the cart. |
| [9057fee](https://github.com/Sireadell/pricekeeper-demo/commit/9057fee) | [43 of 43 passed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/4561c122-f5fc-4c6e-8166-ca302e829c0a) | A 0 or minus number of pieces is now refused. Merged. |

### Bug 4, the offline reopen

This one was found from the TestSprite command line, not on the pull request. I wrote a new test: add an item with 10 pieces, go offline, sell 2, then close and reopen the app while still offline. It should still show the sale, marked as waiting to be sent, and 8 pieces left.

It failed. After the reopen, the sale was gone from a staff member's screen and the stock was back at 10. The sale was waiting to be sent, but the staff screens didn't show sales that were still waiting. I fixed that in [1cefe61](https://github.com/Sireadell/pricekeeper-demo/commit/1cefe61), the command-line run passed, and the test has passed in every pull request run since.

The command-line runs were against a private preview link, so they aren't linked here. The first pull request run with the fix is the 1cefe61 row above.

## Two planted bugs it missed

I planted four bugs on purpose in all. The tests caught two of them (below). These are the two they missed.

| Pull request | What I planted | What the run showed |
|---|---|---|
| [#2](https://github.com/Sireadell/pricekeeper-demo/pull/2) | Voiding a sale stopped putting the stock back | [24 of 25 passed, 1 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/f2e4020e-c38a-4257-950b-636edcf31f70). No test failed, so the break went through unnoticed. I closed the pull request without merging it. |
| [#10](https://github.com/Sireadell/pricekeeper-demo/pull/10) | The receipt showed a sale on credit as paid in full | [36 of 42 passed, 3 failed, 3 blocked](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9b97e840-3a06-4cf9-8394-b982d9a816f8). None of the failures was about the receipt. I took the plant out in [5bf2ef6](https://github.com/Sireadell/pricekeeper-demo/commit/5bf2ef6). |

## Two breaks it caught

These are the two planted breaks the tests caught. Both were in stock tracking, and each was a different kind of mistake.

The first time, I removed the one line that takes sold items out of stock. The TestSprite check on the pull request turned red. I put the line back, the check turned green, and only then did the change merge.

The second time, the line stayed but took off the wrong amount: every sale took twice the stock off the shelf. The check turned red again, with 3 failures, and went green once I fixed the line.

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

Next to the 43 TestSprite browser tests, there are 64 small unit tests in five files in the `tests/` folder. They check the sums behind the screens: average cost, price and margin, stock units, week and month keys, dead-stock and profit-leak warnings, the customer debt book and how a payment is shared across debts, plus a few small helpers. The browser tests only see these numbers through the page, so a wrong figure can hide behind a screen that looks fine.

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
- Nothing merged while the check was red during the two proofs above. I held that rule myself. GitHub doesn't enforce it: pull request #8 merged while its check was red.
