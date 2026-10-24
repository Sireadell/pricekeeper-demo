def test_no_sign_in_cannot_read_shop_data():
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
    finally:
        delete_user(token)
    for col in ["items", "sales", "customers", "borrowers", "expenses"]:
        r = list_docs(f"shops/{owner}/{col}")
        assert r.status_code == 403, f"{col} readable with no sign-in: {r.status_code}"


test_no_sign_in_cannot_read_shop_data()
