# The test loop, pull request by pull request

Every pull request, every commit on it, and the result the TestSprite V3 check posted for that commit.
Generated from the GitHub API by `scripts/loop-ledger.mjs`, so nothing here is typed by hand.

20 pull requests · 58 TestSprite runs · 49 red · 9 green

## Red, then green

Pull requests where TestSprite failed a commit and a later commit on the same pull request passed.

| Pull request | Red commit | TestSprite said | Green commit | TestSprite said |
|---|---|---|---|---|
| [#1](https://github.com/Sireadell/pricekeeper-demo/pull/1) Add live demo link to the README | [eba4862](https://github.com/Sireadell/pricekeeper-demo/commit/eba48625b8a60557f087858a2495e2d789a69de5) | 8/14 passed · 3 failed · 3 blocked | [c474b6d](https://github.com/Sireadell/pricekeeper-demo/commit/c474b6dd73f2b8f0b9b50c34661a2f3ef3ff7d92) | All 12 tests passed |
| [#3](https://github.com/Sireadell/pricekeeper-demo/pull/3) Skip the stock update when a sale is completed | [28bed78](https://github.com/Sireadell/pricekeeper-demo/commit/28bed7806944703188ab2d6705535ebacda96a31) | 20/25 passed · 5 failed | [accc6a1](https://github.com/Sireadell/pricekeeper-demo/commit/accc6a13fc0ad765a50ad164dd66f978e9964baf) | All 24 tests passed |
| [#6](https://github.com/Sireadell/pricekeeper-demo/pull/6) Count each sale's stock twice | [faf7639](https://github.com/Sireadell/pricekeeper-demo/commit/faf763910dd2e44e8fa0b2cfabbd53b5a518ad42) | 21/24 passed · 3 failed | [536c1bf](https://github.com/Sireadell/pricekeeper-demo/commit/536c1bfb9e855c0ee8d86aed59583d5102f33184) | All 24 tests passed |
| [#10](https://github.com/Sireadell/pricekeeper-demo/pull/10) Planted bug: receipt shows a credit sale as paid in full | [9fd0e3a](https://github.com/Sireadell/pricekeeper-demo/commit/9fd0e3a41f802481637deb58c62ad1e9bb2330d6) | 36/42 passed · 3 failed · 3 blocked | [9057fee](https://github.com/Sireadell/pricekeeper-demo/commit/9057fee173c9204a5222027c9cbf757c972b5598) | All 43 tests passed |
| [#12](https://github.com/Sireadell/pricekeeper-demo/pull/12) More database tests, and tests for voiding a sale and the credit receipt | [48c4023](https://github.com/Sireadell/pricekeeper-demo/commit/48c4023ce129fc64a2fa92936694f687e645ee46) | 44/45 passed · 1 failed | [995f260](https://github.com/Sireadell/pricekeeper-demo/commit/995f2600a720a875b32c49e56fe95db2796fffd6) | All 45 tests passed |
| [#13](https://github.com/Sireadell/pricekeeper-demo/pull/13) Judging guide, random-day model test and a mutation score for the money maths | [2d35d32](https://github.com/Sireadell/pricekeeper-demo/commit/2d35d32f83385ce14c40920df42f22ab484423a3) | 44/45 passed · 1 failed | [bf037eb](https://github.com/Sireadell/pricekeeper-demo/commit/bf037ebe2f8077c6ca0ffa066e407d7eeb6825a2) | All 45 tests passed |

## Every pull request

### #1 Add live demo link to the README

merged 2026-10-20 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/1)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [79764f6](https://github.com/Sireadell/pricekeeper-demo/commit/79764f62c24a9947fefdd3aeb496beec73c64599) Add live demo link to the README | not run |  |
| [d75187f](https://github.com/Sireadell/pricekeeper-demo/commit/d75187fca579d47bdfe0b0993c5c1bca28918945) Deploy a preview of every pull request and the live site on merge | not run |  |
| [02710cc](https://github.com/Sireadell/pricekeeper-demo/commit/02710cc7255d28c8ee8852b829e1452fe9c65ebe) Deploy each pull request to a separate preview site with a fixed address | not run |  |
| [eba4862](https://github.com/Sireadell/pricekeeper-demo/commit/eba48625b8a60557f087858a2495e2d789a69de5) Re-run checks on the pull request | 8/14 passed · 3 failed · 3 blocked | [9dde1f65](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9dde1f65-e6d6-445f-a9aa-04037835dcf9) |
| [bd65cc6](https://github.com/Sireadell/pricekeeper-demo/commit/bd65cc6f21375a09084740bff3e1ab6ba88a3877) Re-run checks after adding sample customers | 10/14 passed · 3 failed · 1 blocked | [bfd6b89b](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/bfd6b89b-c544-431d-93cf-fbc265ad7fb3) |
| [9e8fc73](https://github.com/Sireadell/pricekeeper-demo/commit/9e8fc73c9a05e3daac080f7f6ee9599b501a99a1) Re-run checks | 11/12 passed · 1 failed | [e0bcd558](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/e0bcd558-a5bc-4e97-bef3-94d29cfb79f6) |
| [5adb0a0](https://github.com/Sireadell/pricekeeper-demo/commit/5adb0a0dc30f70e7bb7a05adc357c4d27fbbb4f7) Re-run checks | 10/12 passed · 2 failed | [1884fb11](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/1884fb11-a01f-4f7e-80e2-841d041d7fca) |
| [6149001](https://github.com/Sireadell/pricekeeper-demo/commit/614900126bc2f4ff6096cfa038bb52bddd252dcc) Re-run checks | 10/12 passed · 1 failed · 1 blocked | [78bf4022](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/78bf4022-3ef9-4412-a800-969283463caf) |
| [9c50e16](https://github.com/Sireadell/pricekeeper-demo/commit/9c50e16cc119b983ead0203a252e37df24d2a1c2) Re-run checks | 10/12 passed · 1 failed · 1 blocked | [13a28450](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/13a28450-cde8-41e0-814c-a32932f367a6) |
| [4d98a0e](https://github.com/Sireadell/pricekeeper-demo/commit/4d98a0e0712c18ef4f05d22056bdb2e4a09feb43) Re-run checks | 10/12 passed · 2 failed | [e1dce871](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/e1dce871-c69f-4492-904a-e4f54d495189) |
| [44e9c02](https://github.com/Sireadell/pricekeeper-demo/commit/44e9c025e448117daa142ade13022d3d1e67fe6a) Re-run checks | 11/12 passed · 1 failed | [ca77a567](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/ca77a567-fedf-4aaa-b95a-bfc988bea0cc) |
| [bdc0a49](https://github.com/Sireadell/pricekeeper-demo/commit/bdc0a49bc49a44e32e7d94a78dbadb191575e446) Re-run checks | 11/12 passed · 1 blocked | [b86a3987](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/b86a3987-723a-4c6b-b659-6e5e7dcca0b4) |
| [578428a](https://github.com/Sireadell/pricekeeper-demo/commit/578428ab9fcbb91887c2b358b4eeb1d71838ee29) Re-run checks | 11/12 passed · 1 failed | [2aa81e39](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/2aa81e39-fa3c-4091-9f07-5eb5a3a23cbf) |
| [cce5ce6](https://github.com/Sireadell/pricekeeper-demo/commit/cce5ce64a97e9f4511d13421cc5283a8a58a4ce1) Re-run checks | 11/12 passed · 1 blocked | [23fe88b5](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/23fe88b5-4f3d-409d-b686-c852a722c186) |
| [c474b6d](https://github.com/Sireadell/pricekeeper-demo/commit/c474b6dd73f2b8f0b9b50c34661a2f3ef3ff7d92) Focus the name box when the customer dialog opens | All 12 tests passed | [78a6cc60](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/78a6cc60-f691-4d7b-81d9-f104af505d07) |

### #2 Stop touching stock when a sale is voided

closed · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/2)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [c125939](https://github.com/Sireadell/pricekeeper-demo/commit/c125939b8d1cc221cad4557fb8fab8c24f855f35) Stop touching stock when a sale is voided | 12/13 passed · 1 failed | [3770e2f8](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/3770e2f8-5b89-4aaa-9f3c-5f63448ea1e5) |
| [361f28a](https://github.com/Sireadell/pricekeeper-demo/commit/361f28af34382cc7b8853d0924583fd423f91258) Re-run checks | 24/25 passed · 1 blocked | [f2e4020e](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/f2e4020e-c38a-4257-950b-636edcf31f70) |

### #3 Skip the stock update when a sale is completed

merged 2026-10-20 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/3)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [28bed78](https://github.com/Sireadell/pricekeeper-demo/commit/28bed7806944703188ab2d6705535ebacda96a31) Skip the stock update when a sale is completed | 20/25 passed · 5 failed | [a66f2860](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a66f2860-07a5-4fb1-8241-a8decc0185b5) |
| [08558e4](https://github.com/Sireadell/pricekeeper-demo/commit/08558e4e7d62eccc20c8a6e815d4160006f46273) Update stock when a sale is completed again | 24/25 passed · 1 failed | [1030c263](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/1030c263-9432-45c3-9c86-fdc9fe9b0db3) |
| [eba5598](https://github.com/Sireadell/pricekeeper-demo/commit/eba5598f6428711a619ba44243b5736b09c36a21) Re-run checks | 25/26 passed · 1 blocked | [19f022a6](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/19f022a6-e16d-4a58-b320-64c26c5d5e69) |
| [0e1f969](https://github.com/Sireadell/pricekeeper-demo/commit/0e1f9692eacaad4f45994d3854fd9083b5bd3385) Re-run checks | 24/25 passed · 1 failed | [1f1c2e97](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/1f1c2e97-f71a-45bc-b02f-7f9064102f08) |
| [4232a82](https://github.com/Sireadell/pricekeeper-demo/commit/4232a829e9c4367e6385f18338803143986804ac) Re-run checks | 22/25 passed · 3 blocked | [fda695c5](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/fda695c5-7c5b-45ff-b438-8a6b7f09aabf) |
| [dc6b043](https://github.com/Sireadell/pricekeeper-demo/commit/dc6b04375e228ffe6bd6019fcc51f7e0e9c9ba01) Ask for the void reason in an on-page box instead of a browser pop-up | 23/24 passed · 1 failed | [9e9f8406](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9e9f8406-1830-4248-9f84-839a8f7d8603) |
| [accc6a1](https://github.com/Sireadell/pricekeeper-demo/commit/accc6a13fc0ad765a50ad164dd66f978e9964baf) Re-run checks | All 24 tests passed | [7bc6aa85](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/7bc6aa85-f9f6-4033-bd2e-d122d8fb5a49) |

### #4 Ask for the void reason in an on-page box

closed · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/4)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [c7fb130](https://github.com/Sireadell/pricekeeper-demo/commit/c7fb130c8ead9d1d5d4422db7eda3ac596cf6c1a) Ask for the void reason in an on-page box instead of a browser pop-up | 22/25 passed · 3 failed | [4f7e4d66](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/4f7e4d66-5688-4e3b-a332-1b808a1e2f95) |

### #5 Save the row price as the piece cost

closed · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/5)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [4d5cb6b](https://github.com/Sireadell/pricekeeper-demo/commit/4d5cb6b613592e03c059272f6c5d427cdf884629) Save the row price as the piece cost | 24/26 passed · 1 failed · 1 blocked | [2006c0fb](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/2006c0fb-9f6a-45d4-8256-0b8c8571d31e) |

### #6 Count each sale's stock twice

merged 2026-10-21 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/6)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [faf7639](https://github.com/Sireadell/pricekeeper-demo/commit/faf763910dd2e44e8fa0b2cfabbd53b5a518ad42) Count each sale's stock twice | 21/24 passed · 3 failed | [d50ec602](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d50ec602-0006-4dca-a698-825e312bef0a) |
| [536c1bf](https://github.com/Sireadell/pricekeeper-demo/commit/536c1bfb9e855c0ee8d86aed59583d5102f33184) Count each sale's stock once | All 24 tests passed | [ddc06f18](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/ddc06f18-ebf9-45f1-ab51-e2b027b35a2a) |

### #7 Reword the README intro

merged 2026-10-21 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/7)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [047326a](https://github.com/Sireadell/pricekeeper-demo/commit/047326a956c7f709ec3f6902c785af886f0eb596) Reword the README intro | All 24 tests passed | [1853fed2](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/1853fed2-c05f-4b70-b27d-b2e27d34617a) |

### #8 Add how to run the unit tests to the README

merged 2026-10-21 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/8)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [8ac2d8b](https://github.com/Sireadell/pricekeeper-demo/commit/8ac2d8bc403ec6919b54b274140db81cc0cb2bd5) Add how to run the unit tests to the README | 34/40 passed · 3 failed · 3 blocked | [a2f430dd](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a2f430dd-36f6-49c1-8125-422b8e5d5749) |
| [6843b1b](https://github.com/Sireadell/pricekeeper-demo/commit/6843b1bde8cc561a40fc495d619eb6f4bf648aba) Stop sales of less than one piece and correct the Node version in the README | 38/40 passed · 2 blocked | [0ef6fe43](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/0ef6fe43-6102-4e81-b5c5-82fcf4ba146f) |

### #9 Reject a negative amount received on a sale

open · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/9)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [5b00f58](https://github.com/Sireadell/pricekeeper-demo/commit/5b00f5811ed08d6c4f956192e36f542706abdf0c) Update the browser test count in the README to 39 | 35/39 passed · 2 failed · 2 blocked | [c2c30d5d](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/c2c30d5d-f89f-4f36-af9a-cc8b803e3670) |
| [98e1503](https://github.com/Sireadell/pricekeeper-demo/commit/98e1503151d733131f6463ad2f9955252620dfb5) Update the browser test count in the README to 40 | 37/40 passed · 1 failed · 2 blocked | [3dfc713b](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/3dfc713b-8346-4d5c-9063-f0393c97dc24) |

### #10 Planted bug: receipt shows a credit sale as paid in full

merged 2026-10-23 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/10)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [9fd0e3a](https://github.com/Sireadell/pricekeeper-demo/commit/9fd0e3a41f802481637deb58c62ad1e9bb2330d6) Planted bug: receipt shows a credit sale as paid in full | 36/42 passed · 3 failed · 3 blocked | [9b97e840](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9b97e840-3a06-4cf9-8394-b982d9a816f8) |
| [5bf2ef6](https://github.com/Sireadell/pricekeeper-demo/commit/5bf2ef66de247eb7243a81380f55653f81e5e262) Remove the planted receipt bug and refuse negative payments | 38/42 passed · 2 failed · 2 blocked | [b36fe793](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/b36fe793-8a2e-43bf-b7ed-26e3fd29df91) |
| [6abf224](https://github.com/Sireadell/pricekeeper-demo/commit/6abf224d53c7f2cffa603ab45df4814171347029) Add a test-only offline switch | 41/42 passed · 1 failed | [a9a67e16](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/a9a67e16-518a-4989-9f24-e94856c5fdee) |
| [4b50685](https://github.com/Sireadell/pricekeeper-demo/commit/4b50685c5a91cf8dde9567c946385c10b8c19528) Confirm item deletes in the page instead of a browser pop-up | 40/42 passed · 1 failed · 1 blocked | [070003b3](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/070003b3-7503-4d2c-b3fd-67f79b03990b) |
| [f228f71](https://github.com/Sireadell/pricekeeper-demo/commit/f228f7103b5fc835c2bc5a8bb8543c98522d61dc) Close the add-item form when the name is already in stock | 41/42 passed · 1 blocked | [cc0b7b71](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/cc0b7b71-8bc5-416a-b2ee-572c6d714792) |
| [1cefe61](https://github.com/Sireadell/pricekeeper-demo/commit/1cefe6113cabb989e091d7d08a52c006b594fa82) Keep offline sales on screen for staff after the app is reopened | 41/43 passed · 1 failed · 1 blocked | [351e133d](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/351e133d-e129-4688-a5e9-3d6681005ef6) |
| [c45146e](https://github.com/Sireadell/pricekeeper-demo/commit/c45146e971dcf7268662b7c4ff2932ab26473a40) Open the staff sign-in right after a staff member signs out | 42/43 passed · 1 failed | [3e6286de](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/3e6286de-9196-4a87-b00d-2a92b36357af) |
| [8ec16dc](https://github.com/Sireadell/pricekeeper-demo/commit/8ec16dc525d58d05be5d37ab327af6c9e3d655da) Hide the shop screen fully behind the staff sign-in | not run |  |
| [6975881](https://github.com/Sireadell/pricekeeper-demo/commit/6975881e6b91ccc0705928772d659faa656f5820) Keep the welcome tour off the staff sign-in after a staff sign-out | 42/43 passed · 1 failed | [65b84008](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/65b84008-c95b-4b71-a9b5-be730c828187) |
| [97e8e39](https://github.com/Sireadell/pricekeeper-demo/commit/97e8e399bdc05f59a1c1b3a75b581523342f1031) Hide the shop screen from view and from screen readers while staff sign-in is open | 41/43 passed · 2 blocked | [b1adede2](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/b1adede2-406e-4924-81be-a2c97f0238e8) |
| [d10dded](https://github.com/Sireadell/pricekeeper-demo/commit/d10dded6ed4ccd40f0586d0183fa74d7022fccd5) Run browser checks against the cleaned demo shop | 42/43 passed · 1 failed | [675ed041](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/675ed041-288c-4af2-9af9-b746005bc34d) |
| [9057fee](https://github.com/Sireadell/pricekeeper-demo/commit/9057fee173c9204a5222027c9cbf757c972b5598) Refuse a zero or minus quantity when adding an item to a sale | All 43 tests passed | [4561c122](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/4561c122-f5fc-4c6e-8166-ca302e829c0a) |

### #11 Server tests, database PIN check and test tooling

merged 2026-10-24 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/11)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [4b28cd0](https://github.com/Sireadell/pricekeeper-demo/commit/4b28cd062993130de273025bb80a5074029b1659) Keep the TestSprite tests in the repo and list every run per pull request | not run |  |
| [8d3c5f0](https://github.com/Sireadell/pricekeeper-demo/commit/8d3c5f0d940812b31120d605a15b4f7e0392404b) Check the staff PIN in the database rules, not in the page | not run |  |
| [5fd595e](https://github.com/Sireadell/pricekeeper-demo/commit/5fd595eafbea42674e361066e2e3e7956bd8d09d) Run the server tests on every pull request and against the live database after a merge | not run |  |
| [00c3657](https://github.com/Sireadell/pricekeeper-demo/commit/00c36573f49eb64d00d6cc97a1a2b2732aea13ae) Explain each failed TestSprite test on the pull request in plain words | not run |  |
| [5cabea0](https://github.com/Sireadell/pricekeeper-demo/commit/5cabea0ad75f3ca3b2c104e62e7cb186e60edd28) Run a daily check on the live site and open an issue when it fails | not run |  |
| [a85906c](https://github.com/Sireadell/pricekeeper-demo/commit/a85906c1df55a5e3c19f6769e7e36afcc13b2427) Add a checks page listing every test, bug and result | not run |  |
| [b7159d4](https://github.com/Sireadell/pricekeeper-demo/commit/b7159d4820ffeeaced60746f6a288fe32a135536) Add a self-fix workflow that proposes a fix for a red pull request, for a person to review | not run |  |
| [a950158](https://github.com/Sireadell/pricekeeper-demo/commit/a9501587f9c2a751061a184d0832959ab99b0993) Correct how the PIN fix is described | not run |  |
| [991874a](https://github.com/Sireadell/pricekeeper-demo/commit/991874ae76147a0c3f2d56d41f11cd4da8e6c1a5) Add the server tests to TestSprite and record their first live run | not run |  |
| [ec29caf](https://github.com/Sireadell/pricekeeper-demo/commit/ec29caf4dc63e04e1d82cc111b0aee5f1cf99ace) Record the passing server test run after the PIN fix went live | not run |  |
| [497bc10](https://github.com/Sireadell/pricekeeper-demo/commit/497bc10394e5e4e3c5a73db6c0e992d6d6a7cee7) Describe the server tests now that they run in TestSprite | not run |  |
| [128d4c0](https://github.com/Sireadell/pricekeeper-demo/commit/128d4c002586949cbcdb18122d06e20e5dddd241) Shorten the PIN section | All 43 tests passed | [026fb53f](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/026fb53f-089f-4367-a802-b79746b5954f) |

### #12 More database tests, and tests for voiding a sale and the credit receipt

merged 2026-10-25 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/12)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [03cbc8b](https://github.com/Sireadell/pricekeeper-demo/commit/03cbc8b7cf962ec8946b22f35e7358a97b310078) Add server tests for writes: sales, stock, staff, shop code, debts, guessed PIN | not run |  |
| [48c4023](https://github.com/Sireadell/pricekeeper-demo/commit/48c4023ce129fc64a2fa92936694f687e645ee46) Add tests for voiding a sale and for the receipt of a credit sale | 44/45 passed · 1 failed | [13d79f7a](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/13d79f7a-38cd-466b-a80a-42be4bd814ac) |
| [64d7439](https://github.com/Sireadell/pricekeeper-demo/commit/64d7439252a1d8d2e1cd39243315299e89f02120) Run the browser checks again | 42/45 passed · 2 failed · 1 blocked | [1fedad4b](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/1fedad4b-2a45-41f0-b7de-6a171d406a71) |
| [2430d09](https://github.com/Sireadell/pricekeeper-demo/commit/2430d09add367940c0586311f8bdd29428769122) Make the trade search, credit sale and low stock tests steady | 44/45 passed · 1 failed | [4cf1951b](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/4cf1951b-60b0-4b9a-b6e6-105408bb304c) |
| [0ac8976](https://github.com/Sireadell/pricekeeper-demo/commit/0ac8976aa2c745440c743951badcd7a2f6d750b4) Give each test item a name that never repeats across runs | 41/45 passed · 4 failed | [3e1531ea](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/3e1531ea-621f-44cd-adce-d8bed6022f1b) |
| [995f260](https://github.com/Sireadell/pricekeeper-demo/commit/995f2600a720a875b32c49e56fe95db2796fffd6) Run the browser checks again | All 45 tests passed | [06e07921](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/06e07921-e958-4c1e-b99c-f12fc1180b71) |

### #13 Judging guide, random-day model test and a mutation score for the money maths

merged 2026-10-25 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/13)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [3edb252](https://github.com/Sireadell/pricekeeper-demo/commit/3edb252726dae6f435e18a0a5cffa78770c47a4b) Add a random-day model test, edge-case tests and a mutation score for the money maths | not run |  |
| [2d35d32](https://github.com/Sireadell/pricekeeper-demo/commit/2d35d32f83385ce14c40920df42f22ab484423a3) Add a judging guide, update test counts and the merge lock note in the README | 44/45 passed · 1 failed | [2538d9a3](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/2538d9a3-e75f-48ee-974c-4bb471a244a6) |
| [bf037eb](https://github.com/Sireadell/pricekeeper-demo/commit/bf037ebe2f8077c6ca0ffa066e407d7eeb6825a2) Run the browser checks again | All 45 tests passed | [23543208](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/23543208-01af-4e3b-88f8-1f01dd692ff4) |

### #15 Planted bug: voiding a sale no longer puts the stock back

open · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/15)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [eac0a6e](https://github.com/Sireadell/pricekeeper-demo/commit/eac0a6ef64cf7bf148a0d4f1a0de8785930306e1) Planted bug: voiding a sale no longer puts the stock back | 41/45 passed · 3 failed · 1 blocked | [5e7f63a1](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/5e7f63a1-af32-4cb8-bc5a-9e562f000df7) |
| [213c3d3](https://github.com/Sireadell/pricekeeper-demo/commit/213c3d32c90e4d930b65e94cf8c2d3b52b9c024b) Run the browser checks again | 43/45 passed · 2 failed | [41e6fd5a](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/41e6fd5a-57a3-4421-a639-86c4c3527f8e) |

### #16 Planted bug: receipt shows a credit sale as paid in full

open · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/16)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [ed96192](https://github.com/Sireadell/pricekeeper-demo/commit/ed96192309652019e33dffde9e624881f21ebcd6) Planted bug: receipt shows a credit sale as paid in full | 37/45 passed · 6 failed · 2 blocked | [0ecacdeb](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/0ecacdeb-b2b7-452c-b37c-bbc499e309a3) |

### #17 Planted bug: a sale with several items only takes stock for the first

open · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/17)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [b8baa4f](https://github.com/Sireadell/pricekeeper-demo/commit/b8baa4fd38399bced08c1025e6b2cf14befb298d) Planted bug: a sale with several items only takes stock for the first | 39/45 passed · 3 failed · 3 blocked | [e022701f](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/e022701f-d051-4a77-a1bd-07f73c91f051) |

### #18 Planted bug: an item at exactly its low-stock level is not flagged low

open · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/18)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [f51f6a1](https://github.com/Sireadell/pricekeeper-demo/commit/f51f6a1ab8eadc5b3bf265c1577093209083afa7) Planted bug: an item at exactly its low-stock level is not flagged low | 33/45 passed · 10 failed · 2 blocked | [9d9e2362](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/9d9e2362-99c2-4d3f-9aa8-a447cee555f3) |

### #19 Planted bug: a repayment bigger than the debt is counted in full

open · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/19)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [88c2cba](https://github.com/Sireadell/pricekeeper-demo/commit/88c2cba45b460eadf2d7d6e3b87c74a79c10c7d2) Planted bug: a repayment bigger than the debt is counted in full | 36/45 passed · 6 failed · 3 blocked | [fb5a9275](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/fb5a9275-a36a-4718-b817-ac4750943227) |

### #20 Planted bug: a minus amount received counts as money received

open · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/20)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [6d14a26](https://github.com/Sireadell/pricekeeper-demo/commit/6d14a26f3257ca87e2494b9858b6fc200abd0a57) Planted bug: a minus amount received counts as money received | 36/45 passed · 5 failed · 4 blocked | [49065fe2](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/49065fe2-b375-4001-9142-451a636baf26) |
| [caff8b0](https://github.com/Sireadell/pricekeeper-demo/commit/caff8b0a979e13c16b3d92682e6824d0d7dd7dba) Run the browser checks again | 43/45 passed · 2 failed | [20f7cec3](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/20f7cec3-a067-435d-bdbc-b6015a58d217) |

### #21 Fix the morning check

merged 2026-10-25 · [pull request](https://github.com/Sireadell/pricekeeper-demo/pull/21)

| Commit | TestSprite V3 | Run |
|---|---|---|
| [4f238b0](https://github.com/Sireadell/pricekeeper-demo/commit/4f238b0db757a834a9694d89dd194a26c9c9c119) Fix the morning check: run browser tests one at a time and retry the server test once | All 45 tests passed | [d6eab849](https://www.testsprite.com/dashboard-v3/o/72d2167f-323a-581a-9306-129f59967c74/projects/81dc7004-270e-42bb-96d2-a47ea8b1b818/execution/d6eab849-b2dd-451d-9b05-a85b13bc9bb6) |

### Pushed to main without a pull request

The first four set the project up before any checks existed. The rest changed only the README, PROOF.md, unit tests or their setup, never the app itself.

| Commit | Date |
|---|---|
| [70ea99f](https://github.com/Sireadell/pricekeeper-demo/commit/70ea99f4165bdb1a853fde82458887255ee6f1ec) PriceKeeper demo: point-of-sale and stock app for small shops | 2026-10-19 |
| [b3fc054](https://github.com/Sireadell/pricekeeper-demo/commit/b3fc0543e727eb68d344601a732a9a477063198e) Add Firebase hosting and database rules setup | 2026-10-19 |
| [b62666d](https://github.com/Sireadell/pricekeeper-demo/commit/b62666dd7f90d8b2b85bfbf0adfb79649e611ba1) Keep repository folders out of the hosted site | 2026-10-19 |
| [880d47a](https://github.com/Sireadell/pricekeeper-demo/commit/880d47af53499d104387512be7de44634818ad99) Demo shop: staff sign in with name and PIN only | 2026-10-19 |
| [c7996b8](https://github.com/Sireadell/pricekeeper-demo/commit/c7996b873e00b4bee6dc53544a6a07dca22407eb) Add test proof page | 2026-10-21 |
| [d3d2b7d](https://github.com/Sireadell/pricekeeper-demo/commit/d3d2b7d37e1f208909d5fe5cc16ee031a1325590) Add offline unit tests for price and stock maths | 2026-10-21 |
| [25805e7](https://github.com/Sireadell/pricekeeper-demo/commit/25805e78666887371f407c8e9b50eeecadd01791) Add unit tests for insights, ledger and helpers | 2026-10-21 |
| [aa665d5](https://github.com/Sireadell/pricekeeper-demo/commit/aa665d5f650185c239a98b56ac8c5c074451f19a) Add second TestSprite proof and unit test results | 2026-10-21 |
| [d6a7805](https://github.com/Sireadell/pricekeeper-demo/commit/d6a780510c06bbf7cec4e0088dcf294cb0a5d8b9) Note that main now requires the checks to pass | 2026-10-21 |
| [646d576](https://github.com/Sireadell/pricekeeper-demo/commit/646d576b082733930f5941d8bb67ad4d7471956f) Lead the README with the five bugs TestSprite caught and offline | 2026-10-23 |
| [73d028d](https://github.com/Sireadell/pricekeeper-demo/commit/73d028dad8b35863efc47d2aed2d94abe42245c4) Add the demo sign-in to the README | 2026-10-23 |
