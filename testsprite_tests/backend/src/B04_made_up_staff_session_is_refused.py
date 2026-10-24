def test_made_up_staff_session_is_refused():
    token, uid = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = create_session(token, uid, owner, "nobody_here", "admin")
        assert r.status_code == 403, f"session for a staff member who does not exist was accepted: {r.status_code}"
        r = create_session(token, uid, "not-a-real-shop", "robot", "admin")
        assert r.status_code == 403, f"session for a shop that does not exist was accepted: {r.status_code}"
    finally:
        delete_session(token, uid)
        delete_user(token)


test_made_up_staff_session_is_refused()
