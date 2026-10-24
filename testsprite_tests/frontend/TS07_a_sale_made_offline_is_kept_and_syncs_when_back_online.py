import asyncio
import re
import random
NAME = "Offline Sale Item %04d" % random.randint(1000, 9999)
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
        
        # -> Open the visible account control to check the staff sign-in state.
        # @@ts-step {"i":10,"type":"action","action":"click","selector":"xpath=/html/body/header/div[2]/div/button","desc":"Click 'T Test ADMIN button'","input":null,"field":"103"}
        # T Test ADMIN button
        elem = page.get_by_role("button", name="Test")
        await elem.click(timeout=10000)
        
        # -> Open the Inventory page to create the requested item.
        # @@ts-step {"i":11,"type":"action","action":"click","selector":"xpath=/html/body/header/nav/button[2]","desc":"Click '\ud83d\uded2 Inventory button'","input":null,"field":"100"}
        # 🛒 Inventory button
        elem = page.get_by_role("button", name="Inventory")
        await elem.click(timeout=10000)
        
        # -> Open the “Add Item” form and inspect the item details fields.
        # @@ts-step {"i":12,"type":"action","action":"click","selector":"xpath=/html/body/div[2]/div/div/div[3]/button[3]","desc":"Click '\uff0b Add Item button'","input":null,"field":"125"}
        # ＋ Add Item button
        elem = page.get_by_role("button", name="Add Item")
        await elem.click(timeout=10000)
        
        # -> Set the item’s buying unit to Piece and inspect the updated pricing fields.
        # @@ts-step {"i":13,"type":"action","action":"click","selector":"xpath=/html/body/div[2]/div/div[2]/div/div[2]/div[3]/div/div/div/label","desc":"Click 'Piece'","input":null,"field":"797"}
        # Piece
        elem = page.locator("label").filter(has_text="Piece").first
        await elem.click(timeout=10000)
        
        # -> Fill in the new item’s name, cost, selling price, and stock quantity.
        # @@ts-step {"i":14,"type":"action","action":"fill","selector":"xpath=/html/body/div[2]/div/div[2]/div/div[2]/div/div/input","desc":"Fill 'Offline Sale Item 4827' into e.g. Jumbo Waffers text field","input":NAME,"field":"15"}
        # e.g. Jumbo Waffers text field
        elem = page.get_by_role("textbox", name="e.g. Jumbo Waffers")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(NAME)
        
        # -> Fill in the new item’s name, cost, selling price, and stock quantity.
        # @@ts-step {"i":15,"type":"action","action":"fill","selector":"xpath=/html/body/div[2]/div/div[2]/div/div[2]/div/div[2]/input","desc":"Fill '300' into e.g. 3750 number field","input":"300","field":"16"}
        # e.g. 3750 number field
        elem = page.get_by_placeholder("e.g. 3750")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("300")
        
        # -> Fill in the new item’s name, cost, selling price, and stock quantity.
        # @@ts-step {"i":16,"type":"action","action":"fill","selector":"xpath=/html/body/div[2]/div/div[2]/div/div[2]/div[3]/div[2]/div/div[2]/span[3]/input","desc":"Fill '500' into sell number field","input":"500","field":"25"}
        # sell number field
        elem = page.locator("#iSell")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("500")
        
        # -> Fill in the new item’s name, cost, selling price, and stock quantity.
        # @@ts-step {"i":17,"type":"action","action":"fill","selector":"xpath=/html/body/div[2]/div/div[2]/div/div[2]/div[4]/div[2]/div[2]/div/div/input","desc":"Fill '10' into e.g. 22 number field","input":"10","field":"29"}
        # e.g. 22 number field
        elem = page.get_by_placeholder("e.g. 22")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("10")
        
        # -> Save “Offline Sale Item 4827” and verify that it appears in inventory with 10 pieces.
        # @@ts-step {"i":18,"type":"action","action":"click","selector":"xpath=/html/body/div[2]/div/div[2]/div/div[3]/button[2]","desc":"Click '\uff0b Save to Inventory button'","input":null,"field":"135"}
        # ＋ Save to Inventory button
        elem = page.get_by_role("button", name="＋ Save to Inventory")
        await elem.click(timeout=10000)
        
        # -> Search Inventory for “Offline Sale Item 4827” and verify its stock.
        # @@ts-step {"i":19,"type":"action","action":"fill","selector":"xpath=/html/body/div[2]/div/div[4]/div/div/input","desc":"Fill 'Offline Sale Item 4827' into Search items, category\u2026 text field","input":NAME,"field":"35"}
        # Search items, category… text field
        elem = page.get_by_role("textbox", name="Search items, category…")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(NAME)
        
        # -> Let the item save finish and its form close before the signal drops.
        await expect(page.locator('#addItemOverlay')).to_be_hidden(timeout=20000)
        await asyncio.sleep(3)
        # -> Cut the browser network, as a shop would lose signal, then sell.
        await context.set_offline(True)
        await page.evaluate("window.dispatchEvent(new Event('offline'))")
        await asyncio.sleep(3)

        # -> Open the Trade page to start a sale of the verified item.
        # @@ts-step {"i":20,"type":"action","action":"click","selector":"xpath=/html/body/header/nav/button[3]","desc":"Click '\ud83d\udcbc Trade button'","input":null,"field":"9"}
        # 💼 Trade button
        elem = page.get_by_role("button", name="Trade")
        await elem.click(timeout=10000)
        
        # -> Search trade history for “Offline Sale Item 4827” and verify the matching sale.
        # @@ts-step {"i":21,"type":"action","action":"fill","selector":"xpath=/html/body/div[3]/div/div[2]/div/input","desc":"Fill 'Offline Sale Item 4827' into Search trade ID, customer, item\u2026 text field","input":NAME,"field":"38"}
        # Search trade ID, customer, item… text field
        elem = page.get_by_role("textbox", name="Search trade ID, customer,")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(NAME)
        
        # -> Clear the item-name search on the Trade page so the new-sale workflow can be opened.
        # @@ts-step {"i":22,"type":"action","action":"click","selector":"xpath=/html/body/div[3]/div/div[2]/div/button","desc":"Click 'Clear search button'","input":null,"field":"156"}
        # Clear search button
        elem = page.locator("#tradeSearchClear")
        await elem.click(timeout=10000)
        
        # -> Open the “New Trade” workflow to create the required sale.
        # @@ts-step {"i":23,"type":"action","action":"click","selector":"xpath=/html/body/div[3]/div/div/div[2]/button[4]","desc":"Click '\uff0b New Trade button'","input":null,"field":"155"}
        # ＋ New Trade button
        elem = page.get_by_role("button", name="New Trade")
        await elem.click(timeout=10000)
        
        # -> Choose Mama Nkechi in the customer field for the new sale.
        # @@ts-step {"i":24,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div/div/div/div/button","desc":"Click '\u2014 Select customer \u2014 \u25bc button'","input":null,"field":"90340"}
        # — Select customer — ▼ button
        elem = page.get_by_role("button", name="— Select customer — ▼")
        await elem.click(timeout=10000)
        
        # -> Select Mama Nkechi as the customer for the new sale.
        # @@ts-step {"i":25,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div/div/div/div/div/div[2]/div[5]","desc":"Click '\u26a0\ufe0f Mama Nkechi \u00b7 owes \u20a636,300'","input":null,"field":"97961"}
        # ⚠️ Mama Nkechi · owes ₦36,300
        elem = page.get_by_text("⚠️ Mama Nkechi · owes ₦")
        await elem.click(timeout=10000)
        
        # -> Search the New Trade item list for “Offline Sale Item 4827” so the correct item can be added to the sale.
        # @@ts-step {"i":26,"type":"action","action":"fill","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div[3]/div/div/input","desc":"Fill 'Offline Sale Item 4827' into Type item name\u2026 or 'indomie 2 row' text field","input":NAME,"field":"90362"}
        # Type item name… or 'indomie 2 row' text field
        elem = page.get_by_role("textbox", name="Type item name… or 'indomie 2")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(NAME)
        
        # -> Set the quantity for “Offline Sale Item 4827” to 2 pieces before adding it to Mama Nkechi’s cart.
        # @@ts-step {"i":27,"type":"action","action":"fill","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div[5]/div[11]/div[2]/input","desc":"Fill '2' into text field","input":"2","field":"122901"}
        # text field
        elem = page.locator("input[id^=\"nt2-resqty-\"]").first
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("2")
        
        # -> Add the two-piece “Offline Sale Item 4827” row to the cart and review the sale total and payment options.
        # @@ts-step {"i":28,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div/div[5]/div[11]/div[2]/button","desc":"Click '\uff0b Add button'","input":null,"field":"122902"}
        # ＋ Add button
        elem = page.locator("#ntmItemList div").filter(has_text=f"{NAME} ✓ 10 pcs PCS₦500ROW—CTN— ＋ Add").get_by_role("button").nth(3)
        await elem.click(timeout=10000)
        
        # -> Expand the payment options and choose the exact full-payment option for the 1,000 sale.
        # @@ts-step {"i":29,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div[2]/div[3]/button","desc":"Click '\ud83d\udcb3 Pay now, on this page \u25bc expand button'","input":null,"field":"128308"}
        # 💳 Pay now, on this page ▼ expand button
        elem = page.get_by_role("button", name="💳 Pay now, on this page ▼")
        await elem.click(timeout=10000)
        
        # -> Choose “Exact” so the full ₦1,000 sale is marked as paid.
        # @@ts-step {"i":30,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div[2]/div[3]/div[4]/div/button","desc":"Click 'Exact button'","input":null,"field":"135327"}
        # Exact button
        elem = page.get_by_role("button", name="Exact")
        await elem.click(timeout=10000)
        
        # -> Complete the paid 1,000 sale using the visible “Complete · 1,000” button.
        # @@ts-step {"i":31,"type":"action","action":"click","selector":"xpath=/html/body/div[16]/div/div/div[3]/div/div[2]/div[3]/button[2]","desc":"Click 'Complete \u00b7 \u20a6 1,000 button'","input":null,"field":"135339"}
        # Complete · ₦ 1,000 button
        elem = page.get_by_role("button", name="Complete · ₦")
        await elem.click(timeout=10000)
        
        # -> Close the completed-sale receipt to return to the Trade history page.
        # @@ts-step {"i":32,"type":"action","action":"click","selector":"xpath=/html/body/div[17]/div/div/div[2]/button","desc":"Click 'Close button'","input":null,"field":"144417"}
        # Close button
        elem = page.get_by_role("button", name="Close")
        await elem.click(timeout=10000)
        
        # -> Search Trade history for “Offline Sale Item 4827” and verify the matching trade’s quantity and total.
        # -> Network comes back; give the sync a moment to push the sale.
        await context.set_offline(False)
        await page.evaluate("window.dispatchEvent(new Event('online'))")
        await asyncio.sleep(12)

        # @@ts-step {"i":33,"type":"action","action":"fill","selector":"xpath=/html/body/div[3]/div/div[2]/div/input","desc":"Fill 'Offline Sale Item 4827' into Search trade ID, customer, item\u2026 text field","input":NAME,"field":"38"}
        # Search trade ID, customer, item… text field
        elem = page.get_by_role("textbox", name="Search trade ID, customer,")
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(NAME)
        
        # --> Assertions to verify final state
        await asyncio.sleep(3)
        # The history search is on the item name, so exactly one trade must be listed for it.
        await expect(page.locator("#page-trade").get_by_text("1 trades")).to_be_visible(timeout=20000), "The sale made offline should appear in the trade history."
        await expect(page.locator("#page-trade tbody tr")).to_have_count(1, timeout=15000), "Exactly one trade should match the item."
        await expect(page.locator("#page-trade tbody tr").first).to_contain_text("Mama Nkechi", timeout=15000), "The trade should belong to the chosen customer."
        await asyncio.sleep(2)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    