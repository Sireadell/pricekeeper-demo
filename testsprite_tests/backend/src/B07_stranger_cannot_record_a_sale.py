def test_stranger_cannot_record_a_sale():
    """Someone signed in but with no staff session must not be able to add a sale."""
    token, uid = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = requests.post(f"{DB}/shops/{owner}/sales", headers=headers(token), timeout=30,
                          json={"fields": {"totalRevenue": {"integerValue": "800"}, "maxLineDiscount": {"integerValue": "0"}}})
        assert r.status_code == 403, f"a stranger recorded a sale: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_record_a_sale()
