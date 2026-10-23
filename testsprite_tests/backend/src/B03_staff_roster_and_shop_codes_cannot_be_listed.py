def test_staff_roster_and_shop_codes_cannot_be_listed():
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = list_docs(f"shops/{owner}/staff", token)
        assert r.status_code == 403, f"staff roster listed by a stranger: {r.status_code}"
        r = list_docs("businesses", token)
        assert r.status_code == 403, f"every shop code listed by a stranger: {r.status_code}"
    finally:
        delete_user(token)


test_staff_roster_and_shop_codes_cannot_be_listed()
