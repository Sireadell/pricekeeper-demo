def test_stranger_cannot_change_stock():
    """Someone with no staff session must not be able to set an item's stock."""
    token, uid = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = requests.patch(f"{DB}/shops/{owner}/items/pk-test-item?updateMask.fieldPaths=stockQty",
                           headers=headers(token), timeout=30,
                           json={"fields": {"stockQty": {"integerValue": "999"}}})
        assert r.status_code == 403, f"a stranger changed an item's stock: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_change_stock()
