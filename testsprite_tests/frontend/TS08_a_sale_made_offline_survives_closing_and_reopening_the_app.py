import asyncio
import re
import random
import time
NAME = "Reopen Offline Item %d" % (int(time.time() * 1000) % 10000000)
BASE = "https://pricekeeper-demo-preview.web.app"
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
        await page.goto(BASE + "/?offline-switch=1")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Dismiss the onboarding introduction using the visible 'Skip' control so the staff login flow can be accessed.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"202"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Open the Staff Login form to sign in with the provided staff credentials.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"101"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Enter the provided staff username and PIN in the Staff Login form and sign in.
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'VAR_{username}' into e.g. aminu text field","input":"VAR_{username}","field":"57"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("VAR_{username}")
        
        # -> Enter the provided staff username and PIN in the Staff Login form and sign in.
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"58"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Enter the provided staff username and PIN in the Staff Login form and sign in.
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"59"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Enter the provided staff username and PIN in the Staff Login form and sign in.
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"60"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Enter the provided staff username and PIN in the Staff Login form and sign in.
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"61"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the Staff Login form and confirm that the staff dashboard becomes accessible.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"196"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        

        # -> Add a fresh item with 10 pieces while the connection is on
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

        # -> Turn the connection off with the test switch
        switch = page.locator("#pkOfflineSwitch")
        await switch.click(timeout=10000)
        await expect(switch).to_contain_text("Turn internet back on", timeout=10000)
        await expect(page.locator("#obxBanner")).to_contain_text("OFFLINE", timeout=10000)

        # -> Sell 2 pieces to Mama Nkechi while offline, paid in full
        await page.get_by_role("button", name="Trade").click(timeout=10000)
        await page.get_by_role("button", name="New Trade").click(timeout=10000)
        await page.get_by_role("button", name="— Select customer — ▼").click(timeout=10000)
        await page.get_by_text("Mama Nkechi · owes ₦").first.click(timeout=10000)
        await page.get_by_role("textbox", name="Type item name… or 'indomie 2").fill(NAME)
        row = page.locator(".nt2-result").filter(has_text=NAME).first
        await row.wait_for(state="visible", timeout=10000)
        await row.locator("input[id^='nt2-resqty-']").fill("2")
        await row.locator("button.nt2-add-btn", has_text="Add").click(timeout=10000)
        await page.get_by_role("button", name="💳 Pay now, on this page ▼").click(timeout=10000)
        await page.get_by_role("button", name="Exact").click(timeout=10000)
        await page.get_by_role("button", name="Complete · ₦").click(timeout=10000)
        await page.get_by_role("button", name="Close").click(timeout=15000)
        await asyncio.sleep(2)

        # -> Close and reopen the app while still offline
        await page.reload()
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(6)
        await expect(switch).to_contain_text("Turn internet back on", timeout=15000)
        await expect(page.locator("#obxBanner")).to_contain_text("OFFLINE", timeout=15000)

        # --> The offline sale is still there after reopening, marked as waiting to sync
        await page.get_by_role("button", name="Trade").click(timeout=10000)
        await page.get_by_role("textbox", name="Search trade ID, customer,").fill(NAME)
        await asyncio.sleep(2)
        trade_rows = page.locator("#page-trade tbody tr")
        await expect(trade_rows).to_have_count(1, timeout=20000)
        await expect(trade_rows.first).to_contain_text("Mama Nkechi", timeout=10000)
        await expect(trade_rows.first).to_contain_text("waiting to sync", timeout=10000)

        # --> Stock went down by 2 and stayed down after reopening
        await page.get_by_role("button", name="Inventory").click(timeout=10000)
        await page.get_by_role("textbox", name="Search items, category…").fill(NAME)
        await asyncio.sleep(2)
        await expect(page.locator("#page-inventory").get_by_text("8 pcs").first).to_be_visible(timeout=15000)

        # -> Connection back on: the sale is sent to the database
        await switch.click(timeout=10000)
        await expect(switch).to_contain_text("Go offline", timeout=15000)
        await asyncio.sleep(15)
        await page.get_by_role("button", name="Trade").click(timeout=10000)
        await page.get_by_role("textbox", name="Search trade ID, customer,").fill(NAME)
        await asyncio.sleep(2)
        await expect(trade_rows).to_have_count(1, timeout=20000)
        await expect(trade_rows.first).not_to_contain_text("waiting to sync", timeout=30000)
        await expect(page.locator("#obxBanner")).not_to_contain_text("OFFLINE", timeout=15000)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
