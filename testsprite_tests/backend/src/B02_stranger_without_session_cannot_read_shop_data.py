def test_stranger_without_session_cannot_read_shop_data():
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        for col in ["items", "sales", "customers", "borrowers", "expenses", "suppliers"]:
            r = list_docs(f"shops/{owner}/{col}", token)
            assert r.status_code == 403, f"a signed-in stranger read {col}: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_without_session_cannot_read_shop_data()
