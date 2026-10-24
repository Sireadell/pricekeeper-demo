import asyncio
import random
import time
import re
from playwright import async_api
from playwright.async_api import expect

NAME = "Credit Receipt Item %d" % (int(time.time() * 1000) % 10000000)
BASE = "https://pricekeeper-demo-preview.web.app"


async def run_test():
    pw = None
    browser = None
    context = None
    try:
        pw = await async_api.async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )
        context = await browser.new_context()
        context.set_default_timeout(15000)
        page = await context.new_page()

        # Sign in as staff.
        await page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        await page.get_by_role("button", name="Skip →").click(timeout=10000)
        await page.get_by_role("button", name="Staff Login").click(timeout=10000)
        await page.get_by_role("textbox", name="e.g. aminu").fill("VAR_{username}")
        for i, digit in enumerate("4821"):
            await page.locator("input[type=\"password\"]").nth(i).fill(digit)
        await page.get_by_role("button", name="Log in →").click(timeout=10000)

        await expect(page.get_by_role("button", name="Inventory")).to_be_visible(timeout=60000)
        await asyncio.sleep(3)

        # A new item, so old test data can't affect the result.
        await page.get_by_role("button", name="Inventory").click(timeout=10000)
        try:
            await page.locator(".pk-inv-empty").wait_for(state="hidden", timeout=15000)
        except Exception:
            pass
        await page.locator("button.pk-inv-btn--primary").filter(has_text="Add Item").click(timeout=10000)
        await page.locator("label").filter(has_text="Piece").first.click(timeout=10000)
        await page.get_by_role("textbox", name="e.g. Jumbo Waffers").fill(NAME)
        await page.get_by_placeholder("e.g. 3750").fill("300")
        await page.locator("#iSell").fill("500")
        await page.get_by_placeholder("e.g. 22").fill("10")
        await page.get_by_role("button", name="＋ Save to Inventory").click(timeout=10000)
        await expect(page.locator("#addItemOverlay")).to_be_hidden(timeout=20000)
        await asyncio.sleep(3)

        # Sell 3 pieces to Mama Nkechi.
        await page.get_by_role("button", name="Trade").click(timeout=10000)
        await page.get_by_role("button", name="New Trade").first.click(timeout=10000)
        await page.get_by_role("button", name="— Select customer — ▼").click(timeout=10000)
        await page.get_by_text("Mama Nkechi · owes ₦").first.click(timeout=10000)
        await page.get_by_role("textbox", name="Type item name… or 'indomie 2").fill(NAME)
        row = page.locator(".nt2-result").filter(has_text=NAME).first
        await row.wait_for(state="visible", timeout=10000)
        await row.locator("input[id^='nt2-resqty-']").fill("3")
        await row.locator("button.nt2-add-btn", has_text="Add").click(timeout=10000)
        await page.get_by_role("button", name="💳 Pay now, on this page ▼").click(timeout=10000)
        await page.get_by_role("button", name="Full Credit").click(timeout=10000)
        await page.get_by_role("button", name="Complete · ₦").click(timeout=10000)
        await page.get_by_role("button", name="Close").click(timeout=15000)
        await asyncio.sleep(2)

        await page.get_by_role("textbox", name="Search trade ID, customer,").fill(NAME)
        await asyncio.sleep(2)
        trade_rows = page.locator("#page-trade tbody tr")
        await expect(trade_rows).to_have_count(1, timeout=20000)

        # The receipt of a sale with nothing paid must say Paid ₦0, not the total.
        await trade_rows.first.locator("td").nth(1).locator("span").first.click(timeout=10000)
        receipt = page.locator("#receiptModal")
        await expect(receipt).to_contain_text(re.compile(r"TOTAL\s*₦\s*1,500"), timeout=15000)
        await expect(receipt).to_contain_text(re.compile(r"Paid\s*₦\s*0(?![\d,])"), timeout=10000)
        await expect(receipt).not_to_contain_text(re.compile(r"Paid\s*₦\s*1,500"), timeout=5000)
        await expect(receipt).to_contain_text(re.compile(r"Balance Owing\s*₦\s*1,500"), timeout=10000)
        await expect(receipt).to_contain_text("Credit / Unpaid", timeout=10000)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()


asyncio.run(run_test())
