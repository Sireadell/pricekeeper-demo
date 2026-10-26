# Shared setup pasted at the top of every backend test. TestSprite runs each
# file on its own, so scripts/build-backend-tests.py copies this block into
# each one instead of importing it.
import os
import requests

API_KEY = "AIzaSyB1beGLasHA2ektxlDW62LNyYjVg0mBsDA"  # public web key of the test database
PROJECT = "pricekeeper-demo-4"  # test database; the live site uses pricekeeper-demo-3
# PK_EMULATOR=1 points the same tests at a local Firebase emulator (scripts/rules-check.py).
_LOCAL = os.environ.get("PK_EMULATOR")
DB = (f"http://127.0.0.1:8080/v1/projects/{PROJECT}/databases/(default)/documents" if _LOCAL
      else f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents")
AUTH = ("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts" if _LOCAL
        else "https://identitytoolkit.googleapis.com/v1/accounts")
BUSINESS_CODE = "8U36R9"  # the demo shop's code, also in js/staff-auth.js


def sign_in_anonymously():
    """A brand-new stranger: signed in, but no staff session and no PIN."""
    r = requests.post(f"{AUTH}:signUp?key={API_KEY}", json={"returnSecureToken": True}, timeout=30)
    assert r.status_code == 200, f"anonymous sign-in failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    return body["idToken"], body["localId"]


def delete_user(token):
    requests.post(f"{AUTH}:delete?key={API_KEY}", json={"idToken": token}, timeout=30)


def headers(token=None):
    return {"Authorization": f"Bearer {token}"} if token else {}


def owner_uid(token):
    r = requests.get(f"{DB}/businesses/{BUSINESS_CODE}", headers=headers(token), timeout=30)
    assert r.status_code == 200, f"business code lookup failed: {r.status_code} {r.text[:200]}"
    return r.json()["fields"]["ownerUid"]["stringValue"]


def list_docs(path, token=None):
    return requests.get(f"{DB}/{path}?pageSize=1", headers=headers(token), timeout=30)


def create_session(token, uid, owner, username, role, extra=None):
    fields = {
        "ownerUid": {"stringValue": owner},
        "staffUsername": {"stringValue": username},
        "role": {"stringValue": role},
        "createdAt": {"integerValue": "0"},
    }
    fields.update(extra or {})
    return requests.patch(f"{DB}/sessions/{uid}", headers=headers(token), json={"fields": fields}, timeout=30)


def delete_session(token, uid):
    requests.delete(f"{DB}/sessions/{uid}", headers=headers(token), timeout=30)


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
