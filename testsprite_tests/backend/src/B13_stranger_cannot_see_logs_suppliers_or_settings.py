def test_stranger_cannot_see_logs_suppliers_or_settings():
    """Someone signed in but with no staff session must not see the shop's private records."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        for col in ["activityLog", "suppliers", "supplierPrices", "contacts", "settings", "_pkDeleted"]:
            r = list_docs(f"shops/{owner}/{col}", token)
            assert r.status_code == 403, f"a stranger read {col}: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_see_logs_suppliers_or_settings()
