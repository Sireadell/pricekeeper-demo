def test_stranger_cannot_write_a_fake_activity_log_entry():
    """Someone with no staff session must not be able to add a log entry blaming the owner."""
    token, _ = sign_in_anonymously()
    try:
        owner = owner_uid(token)
        actor = {"mapValue": {"fields": {"username": {"stringValue": "owner"},
                                         "role": {"stringValue": "owner"}}}}
        r = requests.patch(f"{DB}/shops/{owner}/activityLog/pk-test-log?currentDocument.exists=false",
                           headers=headers(token), timeout=30,
                           json={"fields": {"action": {"stringValue": "sale_deleted"}, "performedBy": actor}})
        assert r.status_code == 403, f"a stranger wrote to the activity log: {r.status_code}"
    finally:
        delete_user(token)


test_stranger_cannot_write_a_fake_activity_log_entry()
