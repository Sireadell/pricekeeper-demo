def test_stranger_cannot_add_themselves_as_staff():
    """Someone with no staff session must not be able to create a staff record."""
    token, uid = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = requests.patch(f"{DB}/shops/{owner}/staff/pk_intruder", headers=headers(token), timeout=30,
                           json={"fields": {"username": {"stringValue": "pk_intruder"},
                                            "role": {"stringValue": "admin"}}})
        assert r.status_code == 403, f"a stranger added themselves as staff: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_add_themselves_as_staff()
