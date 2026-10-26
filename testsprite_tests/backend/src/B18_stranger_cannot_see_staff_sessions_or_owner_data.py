def test_stranger_cannot_see_staff_sessions_or_owner_data():
    """Someone signed in must not list who is logged in as staff, or read the owner's own records."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = list_docs("sessions", token)
        assert r.status_code == 403, f"a stranger listed staff sessions: {r.status_code}"
        r = list_docs(f"users/{owner}/items", token)
        assert r.status_code == 403, f"a stranger read the owner's own records: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_see_staff_sessions_or_owner_data()
