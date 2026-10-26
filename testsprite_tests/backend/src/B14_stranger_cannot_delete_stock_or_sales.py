def test_stranger_cannot_delete_stock_or_sales():
    """Someone with no staff session must not be able to delete items, sales or debts."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        for col in ["items", "sales", "borrowers", "customers"]:
            r = requests.delete(f"{DB}/shops/{owner}/{col}/pk-test-delete", headers=headers(token), timeout=30)
            assert r.status_code == 403, f"a stranger deleted from {col}: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_delete_stock_or_sales()
