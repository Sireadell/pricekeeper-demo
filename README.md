# PriceKeeper

[![maths](https://github.com/Sireadell/pricekeeper-demo/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/Sireadell/pricekeeper-demo/actions/workflows/unit-tests.yml)

PriceKeeper is a stock and sales app for market traders in Nigeria that keeps working when the signal drops.

I built it because market signal comes and goes all day, and a trader can't stop selling and wait for it.

On one pull request, TestSprite caught five problems I didn't know were there. One was in the offline part: a sale made with no signal disappeared from the screen when the app was closed and opened again. All five are fixed, and the last run passed 43 of 43.

There was a worse hole in the database rules: anyone who knew a staff name could get into the shop without the PIN. The database now checks the PIN itself. I wrote six break-in checks and ran them against the live database: two failed before the fix, and all six pass now.

Live demo: https://pricekeeper-demo.web.app

Demo video (under 3 minutes): https://youtu.be/1wRCmbF73bI

Built for TestSprite Hackathon Season 4, Project Track.

## How this fits the judging

| What you score | Open this | What you'll see |
|---|---|---|
| Project quality (40) | https://pricekeeper-demo.web.app, sign in as `robot` / `4821` | Turn the network off and make a sale. It goes through, waits with an hourglass, and sends when the signal is back. |
| Tests that run themselves (40): browser | [PR #21, last run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d6eab849-b2dd-451d-9b05-a85b13bc9bb6) | TestSprite runs 45 browser tests on a preview copy of every pull request. PR #21 passed all 45. Since 2026-10-25 it's a required check on main, and the block applies to me as admin too, so a red pull request can't go in. |
| Tests that run themselves (40): the trail | [LOOP.md](LOOP.md), table "Red, then green" | Every pull request, every commit and TestSprite's verdict, pulled from the GitHub API by `scripts/loop-ledger.mjs`. Nobody types it. 20 pull requests and 58 TestSprite runs so far. Six pull requests went red, then green: #1, #3, #6, #10, #12 and #13. Pull requests #15 to #20 show as red in the ledger. They were throwaway planted-bug branches and were never merged. |
| Tests that run themselves (40): database | [`.github/workflows/server-tests.yml`](.github/workflows/server-tests.yml) | 12 server tests (B01 to B12) go straight to the live database, skipping the app's screens. They run through the TestSprite command line after a merge. On Oct 24 that run passed 12 of 12. The three runs on Oct 25 passed 1 of 12 and each stopped within seconds. Each of those stopped on a 429 from the database: the free plan's daily read limit had run out after a day of test runs. The first six were also run by hand: 4 passed and 2 failed before the PIN fix, and all 6 passed after. |
| Tests that run themselves (40): maths | `npm test` | 85 unit tests run on every pull request. One of them, [`tests/oracle.test.js`](tests/oracle.test.js), works out the money a second, separate way, in whole kobo and exact fractions, and checks the app against it. It walks 4,920 mixes of trade totals and payment lists (payments, refunds, removed payments), 320 average-cost cases and 40 stock-conversion cases. All agree with the app. |
| How good the tests are | `node scripts/mutation.mjs` | It makes 138 one-change versions of the three money-maths files and checks the tests notice. They catch 132, which is 95.7 percent. The 6 left can't change any result. Saved in [docs/mutation.json](docs/mutation.json). |
| Innovation (20) | [`tests/offline-model.test.js`](tests/offline-model.test.js) | Thousands of made-up shop days, the same ones every run, checked against a plain hand-written version of the rules: what stays on screen offline, what a sale still owes, where a customer's payment goes, and average cost. |
| Engagement | [TestSprite CLI issue #630](https://github.com/TestSprite/testsprite-cli/issues/630) | My write-up for other builders on cutting the network inside a TestSprite test. |

### Why the numbers moved

The mutation score started at 77.5 percent. I went through the 31 changes the tests missed and wrote 11 edge-case tests for them, in [`tests/maths-edges.test.js`](tests/maths-edges.test.js). That's how it got to 95.7.

TestSprite's robot can't switch the internet off. So the app has a hidden switch, `?offline-switch=1`, that cuts its link to the database. The offline tests run on every pull request.

The reopen test sells offline, closes the app, then opens it again still offline. It went red when I ran it, I fixed the app, and it passed on the pull request runs after the fix. On PR #10 a test caught a minus 500 payment being saved as ₦1,300 of debt. That's fixed too.

Early on, two stock breaks I planted, on PR #3 and PR #6, went red, then green. Two got past the suite: a void that didn't give stock back (PR #2) and a credit receipt that showed paid (PR #10). I wrote TS45 and TS44 for those two.

Then I planted six bugs, each on its own throwaway pull request, #15 to #20. On clean solo re-runs, the two key ones were caught: the void that gives no stock back, and a minus amount counted as money received. The full account, including what I can't claim, is in [Breaks I made on purpose](#breaks-i-made-on-purpose).

**Has run:** the plain-words failure note on a red pull request. It appeared on all six planted-bug pull requests and on the re-runs.

**Built, has not run yet:** self-fix.

**Morning check on the live site:** built, and it has run, but it does not pass yet. On its last run one browser test passed, two were blocked by out-of-date saved test scripts, and the server test was refused with a quota error. It opened a GitHub issue by itself, which is the part that works. I am not counting it as a working check.

## Receipts

| What | Count | Where to check |
|---|---|---|
| Browser tests saved in TestSprite | 45 | [Last run: 45 of 45 passed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d6eab849-b2dd-451d-9b05-a85b13bc9bb6) |
| Problems TestSprite caught on one pull request, all fixed | 5 | [Five problems it caught](#five-problems-it-caught) |
| Server tests in TestSprite that go straight to the database: 2 failed before the PIN fix, all 6 pass now | 6 | [Testing the database](#testing-the-database) |
| Offline tests | 3 | [Testing offline](#testing-offline) |
| Browser tests set to run on the live site every morning: built, not passing yet | 3 | [What runs on its own](#what-runs-on-its-own) |
| Bugs planted on throwaway pull requests #15 to #20, and how many a clean solo run caught | 6 planted, 2 caught on a clean run | [Breaks I made on purpose](#breaks-i-made-on-purpose) |
| Unit tests on the money maths | 85 | `tests/` folder, the "maths" check |
| Cases where a second, separate way of working out the money agrees with the app | 4,920 payment mixes, 320 average-cost, 40 stock-conversion | [`tests/oracle.test.js`](tests/oracle.test.js) |
| Changes made on purpose to the money maths, and how many the tests caught | 138 changes, 132 caught (95.7%) | [docs/mutation.json](docs/mutation.json) |
| Pull requests merged | 11 | [Merged pull requests](https://github.com/Sireadell/pricekeeper-demo/pulls?q=is%3Apr+is%3Amerged) |

## Five problems it caught

All five came up on [pull request #10](https://github.com/Sireadell/pricekeeper-demo/pull/10). Each row links the run that went red and the first run where the same test passed after the fix.

| What went wrong | Fix | Red | Green |
|---|---|---|---|
| A trader typed -500 as the amount received on an ₦800 sale. The app saved ₦1,300 as debt. It now counts a minus amount as ₦0, so the debt is ₦800. | [5bf2ef6](https://github.com/Sireadell/pricekeeper-demo/commit/5bf2ef6) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9b97e840-3a06-4cf9-8394-b982d9a816f8) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a9a67e16-518a-4989-9f24-e94856c5fdee) |
| Saving an item whose name was already in stock updated that item, but the form stayed open and went blank. It looked as if the save had failed, and the sale test got stuck there. The form now closes and says the item was updated. | [f228f71](https://github.com/Sireadell/pricekeeper-demo/commit/f228f71) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/070003b3-7503-4d2c-b3fd-67f79b03990b) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/cc0b7b71-8bc5-416a-b2ee-572c6d714792) |
| **Offline.** A staff member made a sale with no signal, then closed and opened the app, still with no signal. The sale was gone from the screen and the item's stock jumped back up. Sales waiting to be sent now show on staff screens after a reopen. | [1cefe61](https://github.com/Sireadell/pricekeeper-demo/commit/1cefe61) | From the command line, see [Testing offline](#testing-offline) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/351e133d-e129-4688-a5e9-3d6681005ef6) |
| Typing 0 pieces and pressing Add quietly put 1 piece in the cart. A 0 or a minus number is now refused with a message. | [9057fee](https://github.com/Sireadell/pricekeeper-demo/commit/9057fee) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/675ed041-288c-4af2-9af9-b746005bc34d) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/4561c122-f5fc-4c6e-8166-ca302e829c0a) |
| Deleting an item used the browser's own "Are you sure?" pop-up. That froze the page for the test robot, and the delete test failed twice. This one hurt the robot more than a trader. Delete now asks inside the page, like the rest of the app. | [4b50685](https://github.com/Sireadell/pricekeeper-demo/commit/4b50685) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/b36fe793-8a2e-43bf-b7ed-26e3fd29df91) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/070003b3-7503-4d2c-b3fd-67f79b03990b) |

Pull request #10 started with a bug I planted on purpose: the receipt showed a sale on credit as paid in full. No test caught that one. I took it out in the same commit as the minus payment fix. Later I wrote TS44 for it and planted it again on PR #16. More in [PROOF.md](PROOF.md).

## The PIN hole

Staff sign in with a name and a 4-digit PIN. The page checked the PIN, but the database never did. So someone who skipped the page and talked to the database directly could open a staff session with just a name.

The fix is in `firestore.rules`: the database itself now turns away a session unless it comes with the right PIN. Seven checks on a copy of the database on my own computer pass. Six try to break in, and one makes sure the right PIN still opens a session and a wrong one doesn't.

Then I saved the six break-in checks as TestSprite server tests and ran them against the live database, before the fix went live. Four passed and two failed: a stranger with only the name `robot` became staff, and the staff record handed out the stored PIN fingerprint. After the fix went live, all six passed. [Red run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/c474b925-8e42-47b8-a1fc-7c828dd273bd/execution/4f8055ac-db58-4b59-a9a4-d639438b6111), [green run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/c474b925-8e42-47b8-a1fc-7c828dd273bd/execution/5e34a933-0590-46a9-8d11-45f18ba5bda8).

| What went wrong | Fix | Red | Green |
|---|---|---|---|
| A staff session opened with only a staff name, no PIN | [8d3c5f0](https://github.com/Sireadell/pricekeeper-demo/commit/8d3c5f0) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/c474b925-8e42-47b8-a1fc-7c828dd273bd/execution/4f8055ac-db58-4b59-a9a4-d639438b6111) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/c474b925-8e42-47b8-a1fc-7c828dd273bd/execution/5e34a933-0590-46a9-8d11-45f18ba5bda8) |

The PIN never sits in the database as typed. It's stored as a one-way fingerprint that can't be turned back into the PIN, and one of the local checks makes sure the fingerprint is never handed out.

## Offline in one minute

Use a computer with Chrome, or a phone.

1. Open https://pricekeeper-demo.web.app. Tap **Skip** on the intro, then **Staff Login**. Sign in with name `robot` and PIN `4821`.
2. Turn the network off. In Chrome, press F12, open the **Network** tab and change **No throttling** to **Offline**. On a phone, turn on airplane mode.
3. Look at the top of the screen. An amber bar says the app is offline and will sync when it's back online. The bar shows on every screen.
4. Go to **Trade**, start a new trade, add an item and complete the sale. It goes through as normal. In Trade history the sale has a small hourglass, which means it's waiting to be sent. The bar counts the changes waiting.
5. Turn the network back on (set **No throttling** again, or turn airplane mode off). The bar says it's syncing, then shows "All synced" for a few seconds and goes away. The hourglass on the sale goes too.

Please don't reload the page while the network is fully off. The app is built to open from the copy saved on the phone, but no test covers that yet.

## Judge it in two minutes

1. Open https://pricekeeper-demo.web.app, sign in as `robot` / `4821`, go offline and make a sale.
2. Open [LOOP.md](LOOP.md) and read the "Red, then green" table.
3. Click the [PR #21 run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d6eab849-b2dd-451d-9b05-a85b13bc9bb6) to see all 45 browser tests pass, one by one.
4. In the project folder, run `npm test` (85 tests), then `node scripts/mutation.mjs` (95.7 percent).

The shop, its items and its customers are made up. Other judges use the same shop, and I may reset the data.

## How offline works

Every save goes through one gate in the app. If the phone is online, the save goes straight to the database. If it's offline, the save waits in a queue on the phone, and the screen shows it at once.

That covers sales, stock changes, customers and expenses.

The app doesn't trust the phone's own "online" flag, because it can be wrong. It also checks every 30 seconds that it can really reach the database.

When the signal is back, the queue sends its saves one at a time, oldest first. A save that fails is tried again up to 5 times, with a longer wait each time. If it still fails, it's set aside for the owner to look at, and the rest of the queue carries on. One bad save never holds up the others.

When a customer pays toward an earlier sale, the payment and its line in their credit record are sent together, so they can't land at different times.

## Testing offline

This is the part I care about most, and it was the hardest to test.

A test robot can't pull the plug on the internet in the middle of a run. My first try cut the network from inside a saved test with Playwright, the browser tool TestSprite runs on. That worked from the TestSprite command line, and I wrote it up for other builders as a docs suggestion: [issue #630](https://github.com/TestSprite/testsprite-cli/issues/630). On the pull request runs, the same tests came back blocked.

So the app has a pretend-offline switch for tests. It only appears when the address ends in `?offline-switch=1`. Pressing it cuts the app's link to the database, so saves wait in the queue and the amber bar shows, the same as when the signal drops. Pressing it again reconnects, and the queue sends.

Three tests use it, and all three passed in the last run:

| Test | What it does | What it checks |
|---|---|---|
| Offline banner | Signs in, goes offline, comes back | The bar appears and says offline, then clears |
| Offline sale | Adds a new item, goes offline, sells 2 pieces to a customer, comes back | The sale is in Trade history, and its hourglass clears once it's sent |
| Offline reopen | Adds an item with 10 pieces, goes offline, sells 2, then closes and reopens the app while still offline | The sale is still in Trade history, marked as waiting, and the item still shows 8 pieces. Once back online, the waiting mark clears |

The reopen test is the one that found the offline bug above. I wrote it, ran it from the command line, and it failed. After the fix it passed, and it passed on the pull request runs after the fix.

Each sale test makes its own item with a new name, so it doesn't depend on what's already in the shop.

## Testing the database

The browser tests see the app the way a cashier does. These checks skip the page and send requests straight to the database, the way someone trying to break in would. They live in TestSprite as server tests. Against the live database, four passed and two failed before the fix, and all six pass now. On a copy of the database, the same six pass, along with a seventh that makes sure the right PIN still works.

| Test | What it tries |
|---|---|
| No sign-in | Read sales and stock without signing in at all |
| A stranger | Sign in as a visitor with no staff session and read the shop |
| Staff list | List every staff member and every shop code |
| Made-up session | Write a staff session by hand and use it |
| No PIN | Open a staff session with a real staff name but no PIN |
| Fingerprint | Read the stored PIN fingerprint |

The plan from here: on every pull request, a "database rules" check runs the same checks against a copy of the database on GitHub's own machine, so they cost nothing and touch no real data. Once a change is merged, TestSprite runs them as server tests against the live database. The GitHub check runs on every pull request.

## What runs on its own

| When | What happens | Has it run yet? |
|---|---|---|
| Every pull request | TestSprite runs all 45 browser tests on a preview copy, and the 85 unit tests run next to it. A "database rules" check is set up to run beside them. | Yes for all three. The database rules check has passed on every pull request since #12. |
| A test fails | A comment appears on the pull request saying which test failed, the step it stopped on and what TestSprite saw, in plain words, with a link to the recording. It's meant to turn green by itself once the next run passes. | Yes. It appeared on all six planted-bug pull requests (#15 to #20) and on the re-runs. |
| After every merge | TestSprite is set up to run the twelve server tests against the live database. | Ran after a merge on Oct 24: 12 of 12 passed (all twelve server tests, not just the first six). The three Oct 25 runs passed 1 of 12 and stopped within seconds, because the database's free daily read limit had run out. |
| Every morning, 8:30 am Lagos time | Three browser tests are set to run on the live site: the offline banner, the offline sale and the wrong PIN. The no-PIN server test runs with them. If one fails, an issue opens on GitHub by itself. | Built. It has run three times and failed each time, and the failure opened an issue as designed. Last run: 1 of 3 browser tests passed, 2 blocked by out-of-date saved scripts, and the server test hit a quota error. Not working yet. |
| On a red pull request, if I ask | I add the label `self-fix`. Claude Code reads the failure notes and changes the app to fix it. It isn't allowed to touch the tests or the workflows. The change goes back on the same pull request, TestSprite tests it again, and I read it before I merge. | Built, has not run yet |

## What it does

A customer buys 5 pieces and pays for 3. Here's what the trader does in PriceKeeper:

1. Pick the item and the quantity, and choose the customer.
2. Type the amount received. The app works out what's still owed.
3. Confirm. Stock goes down by 5, and the unpaid part goes on that customer's balance.
4. The dashboard now shows the money owed to the shop and any item running low.

If the sale was a mistake, the trader voids it and the stock comes back.

It runs in the phone browser and installs like an app. It's plain JavaScript on Firebase, with no framework.

## How the testing loop works

1. I open a pull request.
2. GitHub builds a preview copy of the app.
3. TestSprite runs all 45 saved browser tests against that preview and posts the result on the pull request as "TestSprite V3".
4. At the same time, the "maths" check runs 85 unit tests in a few seconds.
5. A third check, "database rules", is set up to run the database checks against a copy of the database. It runs on every pull request.
6. I merge once the checks pass. Since 2026-10-25 GitHub won't let me merge without them, admin included: "TestSprite V3" and "maths" are required checks on main.

The browser tests click through the app like a cashier would: selling, selling on credit, part payments, voids, receipts, stock alerts, staff login, wrong PINs and the three offline tests.

The unit tests check the sums behind the screens, like average cost, margin and how a payment is shared across a customer's debts. A wrong figure can hide behind a screen that looks fine.

To run the unit tests yourself, install Node 22 or newer and run `npm test` in the project folder.

## Breaks I made on purpose

Before pull request #10, I broke stock tracking on purpose three times to see if the tests would notice. Twice the check went red, and it went green once I put things right. The third time, on pull request #2, I made voiding a sale stop putting the stock back, and no test caught it.

| Pull request | What I broke | Red run | Green run |
|---|---|---|---|
| [#3](https://github.com/Sireadell/pricekeeper-demo/pull/3) | Removed the line that takes sold items out of stock | [5 failed, 3 of them stock tests](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a66f2860-07a5-4fb1-8241-a8decc0185b5) | [24 of 24 passed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/7bc6aa85-f9f6-4033-bd2e-d122d8fb5a49) |
| [#6](https://github.com/Sireadell/pricekeeper-demo/pull/6) | Made every sale take twice the stock | [21 passed, 3 failed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d50ec602-0006-4dca-a698-825e312bef0a) | [24 of 24 passed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/ddc06f18-ebf9-45f1-ab51-e2b027b35a2a) |

The suite was 24 tests then. It's 45 now. The full trail is in [PROOF.md](PROOF.md).

### Six more, on pull requests #15 to #20

Later I planted six bugs, each on its own throwaway pull request. I started all six at the same time, and they shared one test database, so the runs got in each other's way. I don't trust that shared round on its own. So I re-ran the two key ones alone, one at a time.

| Pull request | What I planted | Result |
|---|---|---|
| #15 | Voiding a sale gives no stock back | Caught on a clean solo run. TS43 and TS45 failed, 43 of 45 passed. Stock stayed at 15 instead of going back to 20. |
| #20 | A minus amount counted as money received | Caught on a clean solo run. TS03 failed: typing -500 wasn't blocked, and ₦1,300 was saved as debt on an ₦800 sale. |
| #16 | The receipt shows a credit sale as paid | Failed TS44 in the shared run. That looks caught, but it's one run, and not a clean one. |
| #17, #18, #19 | Three more | The results were unclear, so I claim nothing about them. A clean solo re-run of each would settle it. |

None of these six was merged. They show as red in [LOOP.md](LOOP.md).

## What this is not

- **Not a full accounting system.** It keeps stock, sales and who owes what.
- **No real payments.** It records the money the trader received. It doesn't move any money.
- **Demo data.** The shop, items and customers are made up, and the data may be reset.
- **The offline tests use a switch, not a dead network.** The switch cuts the app's link to the database. When the reopen test reloads the page, the app's own files still come from the internet.
- **Opening the app with no signal at all isn't tested.** The app keeps a copy of its files on the phone for that, but no test covers it yet.
- **Not every red run was a bug.** Getting to 43 of 43 took 11 runs on pull request #10. Some red runs were the robot mixing up look-alike test items in the shared demo shop. I cleared out old test data and named test items more clearly.
- **Early on, it missed two of my planted bugs.** On pull request #2, a void that no longer put stock back. On pull request #10, a receipt that showed a credit sale as paid in full. I wrote tests for both. The void bug was caught on a clean solo run on #15. The receipt bug has only one shared run on #16, not a clean one. See [PROOF.md](PROOF.md).
- **Only two of the six later planted bugs have a clean catch.** Three of them (#17, #18, #19) are unclear, and I claim nothing about them.
- **Stock after a sale needs the live database,** so the unit tests don't cover it. The browser tests do.
- **The database checks aren't in TestSprite yet.** Today they run on a copy of the database on my own computer. The plan is TestSprite server tests after a merge, not on the pull request, because the database has one set of rules for the whole project, so a pull request can't have its own.
- **Self-fix hasn't run yet.** It's built and in the repo.
- **The morning check on the live site:** it does not pass yet, so it is not a safety net. It runs, it fails, and it reports the failure, but I have not got a clean green morning run.
- **Self-fix proposes, it doesn't decide.** Its change still has to pass every check, and I read it before I merge.
- **The merge lock is new.** Pull request #8 went in while its check was red, before the lock existed. Since 2026-10-25 a red pull request can't be merged.

## Links

- Demo video: https://youtu.be/1wRCmbF73bI
- Pull request #10, the five fixes: https://github.com/Sireadell/pricekeeper-demo/pull/10
- Offline testing recipe: [TestSprite CLI issue #630](https://github.com/TestSprite/testsprite-cli/issues/630)
- Every red and green run: [PROOF.md](PROOF.md)
- Live app: https://pricekeeper-demo.web.app
