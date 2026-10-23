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
        
        # -> Dismiss the onboarding screen using its visible “Skip” control to reach the home page.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"198"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Open the Staff Login form from the home dashboard.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"98"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Enter the provided staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'robot' into e.g. aminu text field","input":"robot","field":"57"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("robot")
        
        # -> Enter the provided staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"58"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Enter the provided staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"59"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Enter the provided staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"60"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Enter the provided staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"61"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the Staff Login form and confirm the staff dashboard opens.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"192"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        
        # -> Open the Business navigation menu and locate the Customers page.
        # @@ts-step {"i":10,"type":"action","action":"click","selector":"xpath=/html/body/header/nav/button[4]","desc":"Click '\u229f Business button'","input":null,"field":"11"}
        # ⊟ Business button
        elem = page.get_by_role("button", name="Business")
        await elem.click(timeout=10000)
        
        # -> Refresh the Customers page and wait for it to finish loading before searching for Mama Nkechi.
        # @@ts-step {"i":11,"type":"action","action":"click","selector":"xpath=/html/body/div[4]/div/button","desc":"Click 'Refresh button'","input":null,"field":"10464"}
        # Refresh button
        elem = page.get_by_role("button", name="Refresh")
        await elem.click(timeout=10000)
        
        # -> Wait for the refreshed Customers page to settle, then search for “Nkechi”.
        # @@ts-step {"i":12,"type":"action","action":"fill","selector":"xpath=/html/body/div[4]/div[2]/div/div/div/div/div/input","desc":"Fill 'Nkechi' into Search customers by name or phone\u2026 text field","input":"Nkechi","field":"14894"}
        # Search customers by name or phone… text field
        elem = page.get_by_role("textbox", name="Search customers by name or")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Nkechi")
        
        # -> Open Mama Nkechi’s customer record from the filtered customer list.
        # @@ts-step {"i":13,"type":"action","action":"click","selector":"xpath=/html/body/div[4]/div[2]/div/div/div/div[4]/div/div/div[2]/div","desc":"Click 'Mama Nkechi Champion \ud83d\udcb8 owes \u20a62,400'","input":null,"field":"20090"}
        # Mama Nkechi Champion 💸 owes ₦2,400
        elem = page.get_by_text("Mama Nkechi Champion 💸 owes ₦")
        await elem.click(timeout=10000)
        
        # -> Open the Edit form for Mama Nkechi’s customer record.
        # @@ts-step {"i":14,"type":"action","action":"click","selector":"xpath=/html/body/div[4]/div[2]/div/div/div/div[4]/div/div[2]/div[2]/button[4]","desc":"Click '\u270e Edit button'","input":null,"field":"20159"}
        # ✎ Edit button
        elem = page.get_by_role("button", name="✎ Edit")
        await elem.click(timeout=10000)
        
        # -> Interact with the visible Edit Customer modal container to see whether its form controls become available.
        # @@ts-step {"i":15,"type":"action","action":"click","selector":"xpath=/html/body/div[9]","desc":"Click '\u270f\ufe0f Edit Customer Customer Name * Phone / Contact...'","input":null,"field":"180"}
        # ✏️ Edit Customer Customer Name * Phone / Contact...
        elem = page.locator("#custOverlay")
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Mama Nkechi’s customer details show the requested phone number 0803 555 0142.
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: Expected Mama Nkechi’s customer details to show phone number 0803 555 0142.
        await expect(page.locator("#custOverlay").nth(0)).to_contain_text("0803 555 0142", timeout=15000), "Expected Mama Nkechi\u2019s customer details to show phone number 0803 555 0142."
        
        # --> Test blocked by environment/access constraints during agent run
        # Reason: TEST BLOCKED The contact-number edit could not be completed because the form’s visible Phone / Contact field and Save Customer button were not available as interactable page controls. The requested number was not saved or verified. Observations: - Mama Nkechi’s Edit Customer form is open and shows the existing number 08053334444. - The form visibly includes a Phone / Contact field and a Save Cu...
        raise AssertionError("Test blocked during agent run: " + "TEST BLOCKED The contact-number edit could not be completed because the form\u2019s visible Phone / Contact field and Save Customer button were not available as interactable page controls. The requested number was not saved or verified. Observations: - Mama Nkechi\u2019s Edit Customer form is open and shows the existing number 08053334444. - The form visibly includes a Phone / Contact field and a Save Cu..." + " — the exported script cannot reproduce a PASS in this environment.")
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())