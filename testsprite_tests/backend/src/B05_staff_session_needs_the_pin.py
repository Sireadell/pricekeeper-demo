def test_staff_session_needs_the_pin():
    """A stranger who knows a staff name, but not the PIN, must not become that staff member."""
    token, uid = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        staff = requests.get(f"{DB}/shops/{owner}/staff/robot", headers=headers(token), timeout=30)
        assert staff.status_code == 200, f"staff record lookup failed: {staff.status_code}"
        role = staff.json()["fields"]["role"]["stringValue"]

        r = create_session(token, uid, owner, "robot", role)
        assert r.status_code == 403, (
            f"a stranger became staff '{role}' without the PIN (session accepted: {r.status_code})"
        )
        r = list_docs(f"shops/{owner}/sales", token)
        assert r.status_code == 403, f"a stranger read the shop's sales without the PIN: {r.status_code}"
    finally:
        delete_session(token, uid)
        delete_user(token)


test_staff_session_needs_the_pin()
