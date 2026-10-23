# Auto-injected credentials — redacted for security; set TESTSPRITE_AUTH_CREDENTIAL to run this locally
__AUTH_CREDENTIAL__ = __import__("os").environ.get("TESTSPRITE_AUTH_CREDENTIAL", "")
__AUTH_TYPE__ = "public"
__EXTRA_HEADERS__ = {}
__AUTH_HEADERS__ = {}
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
        
        # -> Dismiss the onboarding introduction using the visible “Skip” option so the staff login flow can be accessed.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"199"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Open the Staff Login flow from the dashboard.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"99"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Enter the staff username and four-digit PIN in the Staff Login dialog, then select “Log in.”
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'robot' into e.g. aminu text field","input":"robot","field":"58"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("robot")
        
        # -> Enter the staff username and four-digit PIN in the Staff Login dialog, then select “Log in.”
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"59"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Enter the staff username and four-digit PIN in the Staff Login dialog, then select “Log in.”
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"60"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Enter the staff username and four-digit PIN in the Staff Login dialog, then select “Log in.”
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"61"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Enter the staff username and four-digit PIN in the Staff Login dialog, then select “Log in.”
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"62"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the Staff Login form and verify whether the staff dashboard opens.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"193"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        
        # -> Open the “Inventory” view to add Stock Check Item.
        # @@ts-step {"i":10,"type":"action","action":"click","selector":"xpath=/html/body/header/nav/button[2]","desc":"Click '\ud83d\uded2 Inventory button'","input":null,"field":"98"}
        # 🛒 Inventory button
        elem = page.get_by_role("button", name="Inventory")
        await elem.click(timeout=10000)
        
        # -> Open the Trade area and check whether the sales history records the Stock Check Item sale.
        # @@ts-step {"i":11,"type":"action","action":"click","selector":"xpath=/html/body/header/nav/button[3]","desc":"Click '\ud83d\udcbc Trade button'","input":null,"field":"9"}
        # 💼 Trade button
        elem = page.get_by_role("button", name="Trade")
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> A Mama Nkechi trade is listed in the sales history.
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: Expected the sales history to show a trade for Mama Nkechi.
        await expect(page.locator("tbody").nth(0)).to_contain_text("Mama Nkechi", timeout=15000), "Expected the sales history to show a trade for Mama Nkechi."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())