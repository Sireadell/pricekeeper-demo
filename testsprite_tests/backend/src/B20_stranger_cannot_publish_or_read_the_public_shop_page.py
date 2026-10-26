def test_stranger_cannot_publish_or_read_the_public_shop_page():
    """Someone signed in must not publish prices to the shop's public page."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = requests.patch(f"{DB}/shops/{owner}/public/pk-test-page?currentDocument.exists=false",
                           headers=headers(token), timeout=30,
                           json={"fields": {"items": {"stringValue": "fake prices"}}})
        assert r.status_code == 403, f"a stranger published the public shop page: {r.status_code}"
        r = list_docs(f"shops/{owner}/public", token)
        assert r.status_code == 403, f"the locked public page was readable: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_publish_or_read_the_public_shop_page()
