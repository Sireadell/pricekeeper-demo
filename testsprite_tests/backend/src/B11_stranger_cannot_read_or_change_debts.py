def test_stranger_cannot_read_or_change_debts():
    """Someone with no staff session must not see or edit what customers owe."""
    token, uid = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        r = list_docs(f"shops/{owner}/borrowers", token)
        assert r.status_code == 403, f"a stranger read customer debts: {r.status_code}"
        r = requests.patch(f"{DB}/shops/{owner}/borrowers/pk-test-debt", headers=headers(token), timeout=30,
                           json={"fields": {"balance": {"integerValue": "0"}}})
        assert r.status_code == 403, f"a stranger wrote a customer debt: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_read_or_change_debts()
