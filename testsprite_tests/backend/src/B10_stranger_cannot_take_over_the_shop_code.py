def test_stranger_cannot_take_over_the_shop_code():
    """Someone signed in must not be able to point the shop code at themselves."""
    token, uid = sign_in_anonymously()
    try:
        r = requests.patch(f"{DB}/businesses/{BUSINESS_CODE}?updateMask.fieldPaths=ownerUid",
                           headers=headers(token), timeout=30,
                           json={"fields": {"ownerUid": {"stringValue": uid}}})
        assert r.status_code == 403, f"a stranger took over the shop code: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_take_over_the_shop_code()
