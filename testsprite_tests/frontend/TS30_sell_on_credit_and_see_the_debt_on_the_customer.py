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
        # @@ts-step {"i":1,"type":"action","action":"navigate","selector":null,"desc":"Navigate to https://pricekeeper-demo.web.app","input":"https://pricekeeper-demo.web.app","field":null}
        await page.goto("https://pricekeeper-demo.web.app")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Dismiss the onboarding screen using the visible “Skip” control so the app’s staff login flow can be accessed.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"198"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Open the Staff Login flow from the dashboard.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"98"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Enter the staff username and PIN, then select “Log in”.
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'robot' into e.g. aminu text field","input":"robot","field":"57"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("robot")
        
        # -> Enter the staff username and PIN, then select “Log in”.
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"58"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Enter the staff username and PIN, then select “Log in”.
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"59"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Enter the staff username and PIN, then select “Log in”.
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"60"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Enter the staff username and PIN, then select “Log in”.
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"61"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the staff login form with “Log in” and verify that the signed-in dashboard appears.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"192"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        
        # -> Open the Business section to find the Customers page.
        # @@ts-step {"i":10,"type":"action","action":"click","selector":"xpath=/html/body/header/nav/button[4]","desc":"Click '\u229f Business button'","input":null,"field":"11"}
        # ⊟ Business button
        elem = page.get_by_role("button", name="Business")
        await elem.click(timeout=10000)
        
        # -> Open the “Add Customer” form and inspect its visible fields.
        # @@ts-step {"i":11,"type":"action","action":"click","selector":"xpath=/html/body/div[4]/div[2]/div/div/div/div/button[2]","desc":"Click '\uff0b Add Customer button'","input":null,"field":"11041"}
        # ＋ Add Customer button
        elem = page.get_by_role("button", name="＋ Add Customer")
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        elem = page.locator("text=New Customer").nth(0)
        await elem.scroll_into_view_if_needed()
        # Assert: The New Customer dialog is open on the Customers page
        assert await elem.is_visible(), "The New Customer dialog should be open so a customer can be added."
        elem = page.locator("text=Customer Name").nth(0)
        await elem.scroll_into_view_if_needed()
        # Assert: The customer form shows the Customer Name field
        assert await elem.is_visible(), "The customer form should show the Customer Name field for entering the new customer's name."
        elem = page.locator("text=Phone / Contact").nth(0)
        await elem.scroll_into_view_if_needed()
        # Assert: The customer form shows the Phone / Contact field
        assert await elem.is_visible(), "The customer form should show the optional Phone / Contact field."
        elem = page.locator("text=Save Customer").nth(0)
        await elem.scroll_into_view_if_needed()
        # Assert: The customer form shows the Save Customer control
        assert await elem.is_visible(), "The customer form should show the Save Customer control."
        
        # --> Test blocked by environment/access constraints during agent run
        # Reason: TEST BLOCKED The test could not be completed because the New Customer form is visible, but its fields and save button are not available as interactive controls. The credit-sale behavior was not reached. Observations: - The Customers page and New Customer dialog are open. - The dialog shows Customer Name and Phone / Contact fields, plus Cancel and Save Customer. - The available interactive eleme...
        raise AssertionError("Test blocked during agent run: " + "TEST BLOCKED The test could not be completed because the New Customer form is visible, but its fields and save button are not available as interactive controls. The credit-sale behavior was not reached. Observations: - The Customers page and New Customer dialog are open. - The dialog shows Customer Name and Phone / Contact fields, plus Cancel and Save Customer. - The available interactive eleme..." + " — the exported script cannot reproduce a PASS in this environment.")
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())