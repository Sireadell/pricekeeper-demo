def test_pin_hash_is_not_handed_out():
    """The stored PIN fingerprint must not be readable, or a 4-digit PIN can be guessed offline in seconds."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = requests.get(f"{DB}/shops/{owner}/staff/robot", headers=headers(token), timeout=30)
        assert r.status_code == 200, f"staff record lookup failed: {r.status_code}"
        fields = r.json().get("fields", {})
        assert "pinHash" not in fields, "the staff record hands its PIN fingerprint to any stranger"
    finally:
        delete_user(token)


test_pin_hash_is_not_handed_out()
