def test_guest_cannot_claim_a_shop_code_or_shop_link():
    """A guest sign-in must not grab a new shop code or public shop link, even pointed at itself."""
    token, uid = sign_in_anonymously()
    try:
        r = requests.patch(f"{DB}/businesses/PKTST9?currentDocument.exists=false",
                           headers=headers(token), timeout=30,
                           json={"fields": {"ownerUid": {"stringValue": uid}}})
        assert r.status_code == 403, f"a guest claimed a shop code: {r.status_code}"
        r = requests.patch(f"{DB}/storefronts/pk-test-slug?currentDocument.exists=false",
                           headers=headers(token), timeout=30,
                           json={"fields": {"uid": {"stringValue": uid}}})
        assert r.status_code == 403, f"a guest claimed a public shop link: {r.status_code}"
    finally:
        delete_user(token)


test_guest_cannot_claim_a_shop_code_or_shop_link()
