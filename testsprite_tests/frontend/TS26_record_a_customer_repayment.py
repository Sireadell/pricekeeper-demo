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
        
        # -> Dismiss the onboarding introduction using the visible Skip control so the staff sign-in flow can be reached.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/button","desc":"Click 'Skip \u2192 button'","input":null,"field":"204"}
        # Skip → button
        elem = page.get_by_role("button", name="Skip →")
        await elem.click(timeout=10000)
        
        # -> Open the staff sign-in flow using the visible “Staff Login” control.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/button","desc":"Click 'Staff Login button'","input":null,"field":"103"}
        # Staff Login button
        elem = page.get_by_role("button", name="Staff Login")
        await elem.click(timeout=10000)
        
        # -> Enter the staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":4,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[4]/input","desc":"Fill 'robot' into e.g. aminu text field","input":"robot","field":"57"}
        # e.g. aminu text field
        elem = page.get_by_role("textbox", name="e.g. aminu")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("robot")
        
        # -> Enter the staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":5,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input","desc":"Fill '4' into password field","input":"4","field":"58"}
        # password field
        elem = page.locator("input[type=\"password\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("4")
        
        # -> Enter the staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":6,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[2]","desc":"Fill '8' into password field","input":"8","field":"59"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(1)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("8")
        
        # -> Enter the staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":7,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[3]","desc":"Fill '2' into password field","input":"2","field":"60"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(2)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Enter the staff username and PIN, then submit the Staff Login form.
        # @@ts-step {"i":8,"type":"action","action":"fill","selector":"xpath=/html/body/div[12]/div/div[2]/div[5]/input[4]","desc":"Fill '1' into password field","input":"1","field":"61"}
        # password field
        elem = page.locator("input[type=\"password\"]").nth(3)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("1")
        
        # -> Submit the Staff Login form and verify that the signed-in dashboard appears.
        # @@ts-step {"i":9,"type":"action","action":"click","selector":"xpath=/html/body/div[12]/div/div[2]/button","desc":"Click 'Log in \u2192 button'","input":null,"field":"198"}
        # Log in → button
        elem = page.get_by_role("button", name="Log in →")
        await elem.click(timeout=10000)
        

        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), asyncio.ensure_future(d.dismiss())))

        async def ada_owed():
            await page.locator('nav.tab-nav button[data-tab="business"]').click(timeout=10000)
            box = page.locator("#page-business")
            await box.wait_for(state="visible", timeout=15000)
            await asyncio.sleep(3)
            await box.get_by_role("button", name="Refresh").click(timeout=10000)
            row = box.get_by_text(re.compile(r"Ada Okafor")).and_(page.locator(":visible")).first
            await row.wait_for(state="visible", timeout=20000)
            await row.click(timeout=10000)
            await page.get_by_role("button", name="💰 Record payment").wait_for(state="visible", timeout=15000)
            text = await box.inner_text()
            m = re.search(r"Ada Okafor[\s\S]{0,80}?owes\s*₦\s*([\d,]+)", text)
            assert m, "Could not read how much Ada owes"
            return int(m.group(1).replace(",", ""))

        # --> Read what Ada owes now
        before = await ada_owed()
        print("OWED BEFORE:", before)
        assert before >= 200, "Ada owes less than 200, so a 200 repayment would be more than she owes"

        # --> Record a payment of 200, once
        await page.get_by_role("button", name="💰 Record payment").click(timeout=10000)
        amt = page.locator("#txAmount")
        await amt.wait_for(state="visible", timeout=10000)
        await amt.fill("200")
        await page.get_by_role("button", name="Save", exact=True).click(timeout=10000)
        try:
            await amt.wait_for(state="hidden", timeout=8000)
        except Exception:
            pass  # the form may linger; the balance check below is the real proof
        assert not dialogs, f"A pop-up appeared: {dialogs}"
        await asyncio.sleep(3)

        # --> Ada's balance must be exactly 200 lower
        await page.locator('nav.tab-nav button[data-tab="trade"]').click(timeout=10000)
        after = await ada_owed()
        for _ in range(4):
            if after == before - 200:
                break
            await asyncio.sleep(3)
            await page.locator('nav.tab-nav button[data-tab="trade"]').click(timeout=10000)
            after = await ada_owed()
        print("OWED AFTER:", after)
        assert after == before - 200, f"Expected {before - 200}, saw {after}"

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
