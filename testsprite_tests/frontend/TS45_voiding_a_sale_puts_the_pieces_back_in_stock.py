import asyncio
import random
from playwright import async_api
from playwright.async_api import expect

NAME = "Void Check Item %04d" % random.randint(1000, 9999)
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
        await page.get_by_placeholder("e.g. 22").fill("20")
        await page.get_by_role("button", name="＋ Save to Inventory").click(timeout=10000)
        await expect(page.locator("#addItemOverlay")).to_be_hidden(timeout=20000)
        await asyncio.sleep(3)

        # Sell 5 pieces to Mama Nkechi.
        await page.get_by_role("button", name="Trade").click(timeout=10000)
        await page.get_by_role("button", name="New Trade").first.click(timeout=10000)
        await page.get_by_role("button", name="— Select customer — ▼").click(timeout=10000)
        await page.get_by_text("Mama Nkechi · owes ₦").first.click(timeout=10000)
        await page.get_by_role("textbox", name="Type item name… or 'indomie 2").fill(NAME)
        row = page.locator(".nt2-result").filter(has_text=NAME).first
        await row.wait_for(state="visible", timeout=10000)
        await row.locator("input[id^='nt2-resqty-']").fill("5")
        await row.locator("button.nt2-add-btn", has_text="Add").click(timeout=10000)
        await page.get_by_role("button", name="💳 Pay now, on this page ▼").click(timeout=10000)
        await page.get_by_role("button", name="Exact").click(timeout=10000)
        await page.get_by_role("button", name="Complete · ₦").click(timeout=10000)
        await page.get_by_role("button", name="Close").click(timeout=15000)
        await asyncio.sleep(2)

        await page.get_by_role("textbox", name="Search trade ID, customer,").fill(NAME)
        await asyncio.sleep(2)
        trade_rows = page.locator("#page-trade tbody tr")
        await expect(trade_rows).to_have_count(1, timeout=20000)

        # Stock drops from 20 to 15.
        await page.get_by_role("button", name="Inventory").click(timeout=10000)
        await page.get_by_role("textbox", name="Search items, category…").fill(NAME)
        await asyncio.sleep(2)
        await expect(page.locator("#page-inventory").get_by_text("15 pcs").first).to_be_visible(timeout=15000)

        # Void the sale with a reason.
        await page.get_by_role("button", name="Trade").click(timeout=10000)
        await page.get_by_role("textbox", name="Search trade ID, customer,").fill(NAME)
        await asyncio.sleep(2)
        await expect(trade_rows).to_have_count(1, timeout=20000)
        await trade_rows.first.get_by_label("Void trade").click(timeout=10000)
        await page.locator("#pkVoidReasonInput").fill("wrong item")
        await page.locator("#pkVoidReasonConfirm").click(timeout=10000)
        await expect(page.locator("#pkVoidReasonBox")).to_have_count(0, timeout=10000)
        await asyncio.sleep(2)

        # The 5 pieces are back: 20 pcs, not 15.
        await page.get_by_role("button", name="Inventory").click(timeout=10000)
        await page.get_by_role("textbox", name="Search items, category…").fill(NAME)
        await asyncio.sleep(2)
        inventory = page.locator("#page-inventory")
        await expect(inventory.get_by_text("20 pcs").first).to_be_visible(timeout=15000)
        await expect(inventory.get_by_text("15 pcs")).to_have_count(0, timeout=5000)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()


asyncio.run(run_test())
