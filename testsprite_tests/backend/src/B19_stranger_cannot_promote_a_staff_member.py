def test_stranger_cannot_promote_a_staff_member():
    """Someone with no staff session must not raise a staff member's role or change their PIN salt."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        for field, value in [("role", "admin"), ("pinSalt", "00" * 32)]:
            r = requests.patch(f"{DB}/shops/{owner}/staff/robot?currentDocument.exists=true"
                               f"&updateMask.fieldPaths={field}",
                               headers=headers(token), timeout=30,
                               json={"fields": {field: {"stringValue": value}}})
            assert r.status_code == 403, f"a stranger changed a staff {field}: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_promote_a_staff_member()
