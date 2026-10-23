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
        
        # -> Open the staff login flow from the PriceKeeper home page.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"17"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Dismiss the onboarding tour using the visible “Skip” control so the staff login form can be accessed.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"2452"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Enter the supplied staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'robot' into e.g. aminu text field","input":"robot","field":"1727"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("robot")
        
        # -> Enter the supplied staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"1737"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Enter the supplied staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"1739"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Enter the supplied staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"1741"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Enter the supplied staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"1743"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the Staff Login form using the “Log in” button and check for the signed-in dashboard.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"121"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        
        # -> Start a new sale using the dashboard’s “New Sale” action.
        # @@ts-step {"i":10,"type":"action","action":"click","selector":"xpath=/html/body/div/div/div[4]/div[2]/button","desc":"Click 'New Sale button'","input":null,"field":"8581"}
        # New Sale button
        elem = page.get_by_role("button", name="New Sale")
        await elem.click(timeout=10000)
        
        # -> Add one unit of the in-stock “Gino Tomato Paste Tin” to the sale.
        # @@ts-step {"i":11,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div[5]/div/div[2]/button","desc":"Click '\uff0b Add button'","input":null,"field":"10053"}
        # ＋ Add button
        elem = page.locator("#ntmItemList div").filter(has_text="Gino Tomato Paste Tin ✓ 146 pcs PCS₦200ROW—CTN— ＋ Add").get_by_role("button").nth(3)
        await elem.click(timeout=10000)
        
        # -> Complete the ₦200 sale using the visible “Complete” button.
        # @@ts-step {"i":12,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div[2]/div[3]/button[2]","desc":"Click 'Complete \u00b7 \u20a6 200 button'","input":null,"field":"11209"}
        # Complete · ₦ 200 button
        elem = page.get_by_role("button", name="Complete · ₦")
        await elem.click(timeout=10000)
        
        # -> Choose a customer from the “Select customer” field to satisfy the checkout requirement.
        # @@ts-step {"i":13,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div/div/div/div/button","desc":"Click '\u2014 Select customer \u2014 \u25bc button'","input":null,"field":"9975"}
        # — Select customer — ▼ button
        elem = page.get_by_role("button", name="— Select customer — ▼")
        await elem.click(timeout=10000)
        
        # -> Select Ibrahim Stores from the customer list to satisfy the checkout requirement.
        # @@ts-step {"i":14,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div/div/div/div/div/div[2]/div[2]","desc":"Click 'Ibrahim Stores \u00b7 08075556666'","input":null,"field":"12972"}
        # Ibrahim Stores · 08075556666
        elem = page.get_by_text("Ibrahim Stores ·")
        await elem.click(timeout=10000)
        
        # -> Complete the ₦200 sale and check the page for a successful sale confirmation.
        # @@ts-step {"i":15,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div[2]/div[3]/button[2]","desc":"Click 'Complete \u00b7 \u20a6 200 button'","input":null,"field":"11209"}
        # Complete · ₦ 200 button
        elem = page.get_by_role("button", name="Complete · ₦")
        await elem.click(timeout=10000)
        
        # -> Choose the “Exact” payment option for the ₦200 sale and check the amount received.
        # @@ts-step {"i":16,"type":"action","action":"click","selector":"xpath=/html/body/div[17]/div/div/div[2]/div[5]/button","desc":"Click 'Exact button'","input":null,"field":"14612"}
        # Exact button
        elem = page.get_by_role("button", name="Exact")
        await elem.click(timeout=10000)
        
        # -> Confirm the ₦200 payment and verify the successful sale confirmation.
        # @@ts-step {"i":17,"type":"action","action":"click","selector":"xpath=/html/body/div[17]/div/div/div[2]/button","desc":"Click 'Confirm Payment \u2713 button'","input":null,"field":"14614"}
        # Confirm Payment ✓ button
        elem = page.get_by_role("button", name="Confirm Payment ✓")
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> The sale confirmation shows the sale as paid in full.
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: The sale confirmation shows the sale as paid in full.
        await expect(page.locator("xpath=/html/body/div[19]/div").nth(0)).to_contain_text("Paid in Full", timeout=15000), "The sale confirmation shows the sale as paid in full."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())