import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        # @@ts-step {"i":1,"type":"action","action":"navigate","selector":null,"desc":"Navigate to https://pricekeeper-demo-preview.web.app","input":"https://pricekeeper-demo-preview.web.app","field":null}
        await page.goto("https://pricekeeper-demo-preview.web.app")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Dismiss the onboarding introduction by choosing “Skip” so the staff login flow can be reached.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"200"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Open the staff sign-in form using the “Staff Login” button.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"100"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Sign in with the staff username “VAR_{username}” and PIN “VAR_{password}”.
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'VAR_{username}' into e.g. aminu text field","input":"VAR_{username}","field":"57"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("VAR_{username}")
        
        # -> Sign in with the staff username “VAR_{username}” and PIN “VAR_{password}”.
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"58"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Sign in with the staff username “VAR_{username}” and PIN “VAR_{password}”.
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"59"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Sign in with the staff username “VAR_{username}” and PIN “VAR_{password}”.
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"60"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Sign in with the staff username “VAR_{username}” and PIN “VAR_{password}”.
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"61"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the staff sign-in form using the “Log in” button.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"194"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        

        # A fresh item name each run, so search finds exactly this item
        import random
        item_name = f"Neg Pay Item {random.randint(1000, 9999)}"

        # -> Open Inventory and add the test item: buy 500, sell 800, 10 pieces
        await page.get_by_role("button", name="Inventory").click(timeout=10000)
        # Give the shop's items a moment to load, then use the toolbar button
        # (an empty-shop prompt shows a second "Add Item" while loading)
        try:
            await page.locator(".pk-inv-empty").wait_for(state="hidden", timeout=15000)
        except Exception:
            pass
        await page.locator("button.pk-inv-btn--primary").filter(has_text="Add Item").click(timeout=10000)
        await page.locator("label").filter(has_text="Piece").first.click(timeout=10000)
        elem = page.get_by_role("textbox", name="e.g. Jumbo Waffers")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(item_name)
        await page.get_by_placeholder("e.g. 3750").fill("500")
        await page.locator("#iSell").fill("800")
        await page.get_by_placeholder("e.g. 22").fill("10")
        await page.get_by_role("button", name="＋ Save to Inventory").click(timeout=10000)
        await page.get_by_role("button", name="✕").click(timeout=10000)

        # -> Open Trade, start a new trade for Mama Nkechi
        await page.get_by_role("button", name="Trade").click(timeout=10000)
        await page.get_by_role("button", name="New Trade").click(timeout=10000)
        await page.get_by_role("button", name="— Select customer — ▼").click(timeout=10000)
        await page.get_by_text("Mama Nkechi · owes ₦").first.click(timeout=10000)

        # -> Find the item just created and add one piece
        elem = page.get_by_role("textbox", name="Type item name… or 'indomie 2")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(item_name)
        row = page.locator(".nt2-result").filter(has_text=item_name).first
        await row.wait_for(state="visible", timeout=10000)
        await row.locator("button.nt2-add-btn", has_text="Add").click(timeout=10000)

        # -> Pay now on this page, type -500 as the amount received, Complete
        await page.get_by_role("button", name="💳 Pay now, on this page ▼").click(timeout=10000)
        elem = page.locator("#nt2PayInlineAmount")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("-500")
        await page.get_by_role("button", name="Complete · ₦").click(timeout=10000)

        # --> Assertions on the receipt the shop would hand over
        receipt = page.locator("#receiptModal .rm-paper")
        await receipt.wait_for(state="visible", timeout=20000)
        receipt_text = await receipt.inner_text()
        print("RECEIPT:", receipt_text.replace("\n", " | "))

        def naira(text):
            # "₦-500" -> -500.0, "₦1,300" -> 1300.0
            m = re.search(r"-?[\d,]+(?:\.\d+)?", text)
            return float(m.group(0).replace(",", "")) if m else 0.0

        paid_text = await receipt.locator(".rm-payment-row.paid span").nth(1).inner_text()
        paid = naira(paid_text)
        assert paid >= 0, f"Receipt shows a negative amount paid: {paid_text.strip()}"

        balance_rows = receipt.locator(".rm-payment-row.balance span")
        if await balance_rows.count() > 0:
            balance_text = await balance_rows.nth(1).inner_text()
            balance = naira(balance_text)
            assert balance <= 800, f"Receipt shows more owed than the ₦800 sale: {balance_text.strip()}"

        assert "1,300" not in receipt_text, "Receipt shows ₦1,300, the -500 was added to the debt"

        # Nothing real was paid, so the receipt must say ₦0 paid and ₦800 owed,
        # and paid plus owed must add up to the ₦800 total
        assert paid == 0, f"Receipt says {paid_text.strip()} was paid, but no money was received"
        owed = naira(balance_text) if await balance_rows.count() > 0 else 0.0
        assert paid + owed == 800, f"Paid {paid_text.strip()} plus owed ₦{owed:,.0f} does not add up to the ₦800 total"

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
