# PriceKeeper

[![maths](https://github.com/Sireadell/pricekeeper-demo/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/Sireadell/pricekeeper-demo/actions/workflows/unit-tests.yml)

PriceKeeper is a stock and sales app for market traders in Nigeria that keeps working when the signal drops.

I built it because market signal comes and goes all day, and a trader can't stop selling and wait for it.

On one pull request, TestSprite caught five problems I didn't know were there. One was in the offline part: a sale made with no signal disappeared from the screen when the app was closed and opened again. All five are fixed, and the last run passed 43 of 43.

There was a worse hole in the database rules: anyone who knew a staff name could get into the shop without the PIN. The database now checks the PIN itself. TestSprite server tests proved the hole on the live database, then proved the fix closed it.

Live demo: https://pricekeeper-demo.web.app

Built for TestSprite Hackathon Season 4, Project Track.

## Receipts

| What | Count | Where to check |
|---|---|---|
| Browser tests saved in TestSprite | 43 | [Last run: 43 of 43 passed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/4561c122-f5fc-4c6e-8166-ca302e829c0a) |
| Problems TestSprite caught on one pull request, all fixed | 5 | [Five problems it caught](#five-problems-it-caught) |
| Server tests in TestSprite that go straight to the database: 2 failed before the PIN fix, all 6 pass now | 6 | [Testing the database](#testing-the-database) |
| Offline tests | 3 | [Testing offline](#testing-offline) |
| Browser tests set to run on the live site every morning, not run yet | 3 | [What runs on its own](#what-runs-on-its-own) |
| Breaks I made on purpose: 2 caught, 2 missed | 4 | [PROOF.md](PROOF.md) |
| Unit tests on the money maths | 64 | `tests/` folder, the "maths" check |
| Pull requests merged | 6 | [Merged pull requests](https://github.com/Sireadell/pricekeeper-demo/pulls?q=is%3Apr+is%3Amerged) |

## Five problems it caught

All five came up on [pull request #10](https://github.com/Sireadell/pricekeeper-demo/pull/10). Each row links the run that went red and the first run where the same test passed after the fix.

| What went wrong | Fix | Red | Green |
|---|---|---|---|
| A trader typed -500 as the amount received on an ₦800 sale. The app saved ₦1,300 as debt. It now counts a minus amount as ₦0, so the debt is ₦800. | [5bf2ef6](https://github.com/Sireadell/pricekeeper-demo/commit/5bf2ef6) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9b97e840-3a06-4cf9-8394-b982d9a816f8) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a9a67e16-518a-4989-9f24-e94856c5fdee) |
| Saving an item whose name was already in stock updated that item, but the form stayed open and went blank. It looked as if the save had failed, and the sale test got stuck there. The form now closes and says the item was updated. | [f228f71](https://github.com/Sireadell/pricekeeper-demo/commit/f228f71) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/070003b3-7503-4d2c-b3fd-67f79b03990b) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/cc0b7b71-8bc5-416a-b2ee-572c6d714792) |
| **Offline.** A staff member made a sale with no signal, then closed and opened the app, still with no signal. The sale was gone from the screen and the item's stock jumped back up. Sales waiting to be sent now show on staff screens after a reopen. | [1cefe61](https://github.com/Sireadell/pricekeeper-demo/commit/1cefe61) | From the command line, see [Testing offline](#testing-offline) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/351e133d-e129-4688-a5e9-3d6681005ef6) |
| Typing 0 pieces and pressing Add quietly put 1 piece in the cart. A 0 or a minus number is now refused with a message. | [9057fee](https://github.com/Sireadell/pricekeeper-demo/commit/9057fee) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/675ed041-288c-4af2-9af9-b746005bc34d) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/4561c122-f5fc-4c6e-8166-ca302e829c0a) |
| Deleting an item used the browser's own "Are you sure?" pop-up. That froze the page for the test robot, and the delete test failed twice. This one hurt the robot more than a trader. Delete now asks inside the page, like the rest of the app. | [4b50685](https://github.com/Sireadell/pricekeeper-demo/commit/4b50685) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/b36fe793-8a2e-43bf-b7ed-26e3fd29df91) | [run](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/070003b3-7503-4d2c-b3fd-67f79b03990b) |

Pull request #10 started with a bug I planted on purpose: the receipt showed a sale on credit as paid in full. No test caught that one. I took it out in the same commit as the minus payment fix. More in [PROOF.md](PROOF.md).

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

## Judge it in one minute

1. Open https://pricekeeper-demo.web.app and sign in as staff with `robot` and `4821`.
2. Open [pull request #10](https://github.com/Sireadell/pricekeeper-demo/pull/10). Its commits are the five fixes, and its checks show the last run at 43 of 43.
3. Click any red or green link in [Five problems it caught](#five-problems-it-caught). It opens the full TestSprite run, test by test.

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

The reopen test is the one that found the offline bug above. I wrote it, ran it from the command line, and it failed. After the fix it passed, and it has passed in every pull request run since.

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

The plan from here: on every pull request, a "database rules" check runs the same checks against a copy of the database on GitHub's own machine, so they cost nothing and touch no real data. Once a change is merged, TestSprite runs them as server tests against the live database. The GitHub check is written but hasn't run yet.

## What runs on its own

| When | What happens | Has it run yet? |
|---|---|---|
| Every pull request | TestSprite runs all 43 browser tests on a preview copy, and the 64 unit tests run next to it. A "database rules" check is set up to run beside them. | Yes for TestSprite and the unit tests. Not yet for the database rules check. |
| A test fails | A comment is set up to appear on the pull request saying which test failed, the step it stopped on and what TestSprite saw, in plain words, with a link to the recording. It's meant to turn green by itself once the next run passes. | Not yet |
| After every merge | TestSprite is set up to run the six server tests against the live database. | Not after a merge yet. I've run them by hand twice: 4 of 6 before the PIN fix, 6 of 6 after. |
| Every morning, 8:30 am Lagos time | Three browser tests are set to run on the live site: the offline banner, the offline sale and the wrong PIN. The no-PIN server test runs with them. If one fails, an issue opens on GitHub by itself. | Not yet |
| On a red pull request, if I ask | I add the label `self-fix`. Claude Code reads the failure notes and changes the app to fix it. It isn't allowed to touch the tests or the workflows. The change goes back on the same pull request, TestSprite tests it again, and I read it before I merge. | Not yet |

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
3. TestSprite runs all 43 saved browser tests against that preview and posts the result on the pull request as "TestSprite V3".
4. At the same time, the "maths" check runs 64 unit tests in a few seconds.
5. A third check, "database rules", is set up to run the database checks against a copy of the database. It hasn't run on GitHub yet.
6. I merge once the checks pass. GitHub doesn't stop me merging a red one, so that part is on me.

The browser tests click through the app like a cashier would: selling, selling on credit, part payments, voids, receipts, stock alerts, staff login, wrong PINs and the three offline tests.

The unit tests check the sums behind the screens, like average cost, margin and how a payment is shared across a customer's debts. A wrong figure can hide behind a screen that looks fine.

To run the unit tests yourself, install Node 22 or newer and run `npm test` in the project folder.

## Breaks I made on purpose

Before pull request #10, I broke stock tracking on purpose three times to see if the tests would notice. Twice the check went red, and it went green once I put things right. The third time, on pull request #2, I made voiding a sale stop putting the stock back, and no test caught it.

| Pull request | What I broke | Red run | Green run |
|---|---|---|---|
| [#3](https://github.com/Sireadell/pricekeeper-demo/pull/3) | Removed the line that takes sold items out of stock | [5 failed, 3 of them stock tests](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a66f2860-07a5-4fb1-8241-a8decc0185b5) | [24 of 24 passed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/7bc6aa85-f9f6-4033-bd2e-d122d8fb5a49) |
| [#6](https://github.com/Sireadell/pricekeeper-demo/pull/6) | Made every sale take twice the stock | [21 passed, 3 failed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d50ec602-0006-4dca-a698-825e312bef0a) | [24 of 24 passed](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/ddc06f18-ebf9-45f1-ab51-e2b027b35a2a) |

The suite was 24 tests then. It's 43 now. The full trail is in [PROOF.md](PROOF.md).

## What this is not

- **Not a full accounting system.** It keeps stock, sales and who owes what.
- **No real payments.** It records the money the trader received. It doesn't move any money.
- **Demo data.** The shop, items and customers are made up, and the data may be reset.
- **The offline tests use a switch, not a dead network.** The switch cuts the app's link to the database. When the reopen test reloads the page, the app's own files still come from the internet.
- **Opening the app with no signal at all isn't tested.** The app keeps a copy of its files on the phone for that, but no test covers it yet.
- **Not every red run was a bug.** Getting to 43 of 43 took 11 runs on pull request #10. Some red runs were the robot mixing up look-alike test items in the shared demo shop. I cleared out old test data and named test items more clearly.
- **It missed two of my planted bugs.** On pull request #2, a void that no longer put stock back. On pull request #10, a receipt that showed a credit sale as paid in full. See [PROOF.md](PROOF.md).
- **Stock after a sale needs the live database,** so the unit tests don't cover it. The browser tests do.
- **The database checks aren't in TestSprite yet.** Today they run on a copy of the database on my own computer. The plan is TestSprite server tests after a merge, not on the pull request, because the database has one set of rules for the whole project, so a pull request can't have its own.
- **The morning check, the failure notes and self-fix haven't run yet.** They're written and in the repo.
- **Self-fix proposes, it doesn't decide.** Its change still has to pass every check, and I read it before I merge.
- **Merges aren't locked.** GitHub doesn't stop me merging a red pull request, and pull request #8 went in while its check was red.

## Links

- Demo video: VIDEO_LINK
- Pull request #10, the five fixes: https://github.com/Sireadell/pricekeeper-demo/pull/10
- Offline testing recipe: [TestSprite CLI issue #630](https://github.com/TestSprite/testsprite-cli/issues/630)
- Every red and green run: [PROOF.md](PROOF.md)
- Live app: https://pricekeeper-demo.web.app
