import secrets


def test_made_up_pin_fingerprint_is_refused():
    """A staff session that carries a guessed PIN fingerprint must be turned away."""
    token, uid = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        staff = requests.get(f"{DB}/shops/{owner}/staff/robot", headers=headers(token), timeout=30)
        assert staff.status_code == 200, f"staff record lookup failed: {staff.status_code}"
        role = staff.json()["fields"]["role"]["stringValue"]
        r = create_session(token, uid, owner, "robot", role,
                           {"pinProof": {"stringValue": secrets.token_hex(32)}})
        assert r.status_code == 403, f"a made-up PIN fingerprint opened a session: {r.status_code}"
    finally:
        delete_session(token, uid)
        delete_user(token)


test_made_up_pin_fingerprint_is_refused()
