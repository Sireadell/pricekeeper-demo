def test_stranger_cannot_change_staff_permissions():
    """Someone with no staff session must not be able to give cashiers more powers."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        perms = {"mapValue": {"fields": {"canDelete": {"booleanValue": True},
                                         "canDiscount": {"booleanValue": True}}}}
        r = requests.patch(f"{DB}/shops/{owner}/settings/pk-test-perms?currentDocument.exists=false",
                           headers=headers(token), timeout=30, json={"fields": {"cashier": perms}})
        assert r.status_code == 403, f"a stranger changed staff permissions: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_change_staff_permissions()
