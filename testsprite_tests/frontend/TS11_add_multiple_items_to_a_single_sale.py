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
        
        # -> Dismiss the onboarding introduction using the visible 'Skip' option so the staff login flow is accessible.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"2452"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Open the Staff Login form to sign in with the provided staff credentials.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"17"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Sign in through the Staff Login dialog using the provided username and PIN.
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'robot' into e.g. aminu text field","input":"robot","field":"1727"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("robot")
        
        # -> Sign in through the Staff Login dialog using the provided username and PIN.
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"1737"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Sign in through the Staff Login dialog using the provided username and PIN.
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"1739"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Sign in through the Staff Login dialog using the provided username and PIN.
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"1741"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Sign in through the Staff Login dialog using the provided username and PIN.
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"1743"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the Staff Login form and confirm the staff dashboard is accessible.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"121"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        
        # -> Start a sale using the dashboard’s “New Sale” quick action.
        # @@ts-step {"i":10,"type":"action","action":"click","selector":"xpath=/html/body/div/div/div[4]/div[2]/button","desc":"Click 'New Sale button'","input":null,"field":"7563"}
        # New Sale button
        elem = page.get_by_role("button", name="New Sale")
        await elem.click(timeout=10000)
        
        # -> Add one Gino Tomato Paste Tin and one QA New Stock 20261019 A to the sale cart.
        # @@ts-step {"i":11,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div[5]/div/div[2]/button","desc":"Click '\uff0b Add button'","input":null,"field":"8794"}
        # ＋ Add button
        elem = page.locator("#ntmItemList div").filter(has_text="Gino Tomato Paste Tin ✓ 146 pcs PCS₦200ROW—CTN— ＋ Add").get_by_role("button").nth(3)
        await elem.click(timeout=10000)
        
        # -> Add one Gino Tomato Paste Tin and one QA New Stock 20261019 A to the sale cart.
        # @@ts-step {"i":12,"type":"action","action":"click","selector":"xpath=/html/body/div[17]/div/div/div[3]/div/div[1]/div[5]/div[2]/div[2]/button","desc":"Click '\uff0b Add button'","input":null,"field":"8813"}
        # ＋ Add button
        elem = page.locator("xpath=/html/body/div[17]/div/div/div[3]/div/div[1]/div[5]/div[2]/div[2]/button").nth(0)
        await elem.click(timeout=10000)
        
        # -> Complete the sale using the visible “Complete” button and verify the transaction confirmation.
        # @@ts-step {"i":13,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div[2]/div[3]/button[2]","desc":"Click 'Complete \u00b7 \u20a6 1,700 button'","input":null,"field":"11647"}
        # Complete · ₦ 1,700 button
        elem = page.get_by_role("button", name="Complete · ₦")
        await elem.click(timeout=10000)
        
        # -> Select an available customer in the Customer field to meet the checkout requirement.
        # @@ts-step {"i":14,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div/div/div/div/button","desc":"Click '\u2014 Select customer \u2014 \u25bc button'","input":null,"field":"8716"}
        # — Select customer — ▼ button
        elem = page.get_by_role("button", name="— Select customer — ▼")
        await elem.click(timeout=10000)
        
        # -> Select Ibrahim Stores as the customer for the two-item sale.
        # @@ts-step {"i":15,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div/div/div/div/div/div[2]/div[2]","desc":"Click 'Ibrahim Stores \u00b7 08075556666'","input":null,"field":"14175"}
        # Ibrahim Stores · 08075556666
        elem = page.get_by_text("Ibrahim Stores ·")
        await elem.click(timeout=10000)
        
        # -> Complete the ₦1,700 sale and verify the transaction confirmation and its multiple sold items.
        # @@ts-step {"i":16,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div[2]/div[3]/button[2]","desc":"Click 'Complete \u00b7 \u20a6 1,700 button'","input":null,"field":"11647"}
        # Complete · ₦ 1,700 button
        elem = page.get_by_role("button", name="Complete · ₦")
        await elem.click(timeout=10000)
        
        # -> Choose “Exact” for the ₦1,700 payment and check the payment dialog before confirming.
        # @@ts-step {"i":17,"type":"action","action":"click","selector":"xpath=/html/body/div[17]/div/div/div[2]/div[5]/button","desc":"Click 'Exact button'","input":null,"field":"21856"}
        # Exact button
        elem = page.get_by_role("button", name="Exact")
        await elem.click(timeout=10000)
        
        # -> Confirm the ₦1,700 payment and verify the completed multi-item sale.
        # @@ts-step {"i":18,"type":"action","action":"click","selector":"xpath=/html/body/div[17]/div/div/div[2]/button","desc":"Click 'Confirm Payment \u2713 button'","input":null,"field":"21858"}
        # Confirm Payment ✓ button
        elem = page.get_by_role("button", name="Confirm Payment ✓")
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> The sale was completed and marked Paid in Full.
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: The sale receipt is marked Paid in Full.
        await expect(page.locator("xpath=/html/body/div[19]/div").nth(0)).to_contain_text("Paid in Full", timeout=15000), "The sale receipt is marked Paid in Full."
        
        # --> The completed transaction contains both sold items.
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: The receipt includes Gino Tomato Paste Tin.
        await expect(page.locator("xpath=/html/body/div[19]/div").nth(0)).to_contain_text("Gino Tomato Paste Tin", timeout=15000), "The receipt includes Gino Tomato Paste Tin."
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: The receipt includes QA New Stock 20261019 A.
        await expect(page.locator("xpath=/html/body/div[19]/div").nth(0)).to_contain_text("QA New Stock 20261019 A", timeout=15000), "The receipt includes QA New Stock 20261019 A."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())