# PriceKeeper Demo

PriceKeeper is a point-of-sale and stock app for small shops in Nigeria. It runs in the phone browser, keeps working when the internet drops, and tracks sales, stock, debts and profit.

This is a demo copy with made-up shop data.

Live demo: https://pricekeeper-demo.web.app

## Tested by TestSprite

24 browser tests run against the live app on every pull request. To prove they work, I broke stock tracking on purpose. The check went red, I fixed it, the check went green, and only then did it merge. Full trail with every run link: [PROOF.md](PROOF.md).

| Run | Result |
|---|---|
| Red, stock line removed | 3 stock tests failed |
| Green, line restored | 24 of 24 passed, merged |
