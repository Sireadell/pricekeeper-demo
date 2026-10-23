# Runs the backend tests against a local Firebase emulator, with no credits
# and no reads on the live database. Seeds a tiny demo shop first, then also
# checks the happy path: the right PIN still opens a staff session.
#   npx firebase emulators:exec --only firestore,auth --project pricekeeper-demo "python scripts/rules-check.py"
import hashlib
import os
import subprocess
import sys
from pathlib import Path

import requests

os.environ["PK_EMULATOR"] = "1"
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "testsprite_tests" / "backend"))
from _common import DB, sign_in_anonymously, delete_user, headers, create_session, list_docs  # noqa: E402

ADMIN = {"Authorization": "Bearer owner"}  # the emulator's skip-the-rules token
OWNER = "demoOwnerUid0000000000000000"
SALT = "ab" * 32
PIN = "4821"


def proof(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100000, 32).hex()


def put(path, fields):
    r = requests.patch(f"{DB}/{path}", headers=ADMIN, json={"fields": fields}, timeout=30)
    assert r.status_code == 200, f"seed {path}: {r.status_code} {r.text[:200]}"


def seed():
    s = lambda v: {"stringValue": v}
    put("businesses/8U36R9", {"ownerUid": s(OWNER)})
    put(f"shops/{OWNER}/staff/robot", {"username": s("robot"), "role": s("admin"),
                                       "pinSalt": s(SALT), **({"pinHash": s(proof(PIN, SALT))} if os.environ.get("PK_OLD_DATA") else {}), "revoked": {"booleanValue": False}})
    put(f"shops/{OWNER}/staffPins/robot/proofs/{proof(PIN, SALT)}", {"createdAt": {"integerValue": "0"}})
    put(f"shops/{OWNER}/sales/s1", {"total": {"integerValue": "800"}})
    put(f"shops/{OWNER}/items/i1", {"name": s("Rice")})


def happy_path():
    token, uid = sign_in_anonymously()
    try:
        r = create_session(token, uid, OWNER, "robot", "admin", {"pinProof": {"stringValue": proof("0000", SALT)}})
        assert r.status_code == 403, f"wrong PIN opened a session: {r.status_code}"
        r = create_session(token, uid, OWNER, "robot", "admin", {"pinProof": {"stringValue": proof(PIN, SALT)}})
        assert r.status_code == 200, f"right PIN was refused: {r.status_code} {r.text[:200]}"
        r = list_docs(f"shops/{OWNER}/sales", token)
        assert r.status_code == 200, f"signed-in staff could not read sales: {r.status_code}"
        r = list_docs(f"shops/{OWNER}/staffPins/robot/proofs", token)
        assert r.status_code == 403, f"staff could list PIN fingerprints: {r.status_code}"
    finally:
        delete_user(token)


seed()
failed = 0
for test in sorted((ROOT / "testsprite_tests" / "backend").glob("B*.py")):
    r = subprocess.run([sys.executable, str(test)], capture_output=True, text=True)
    ok = r.returncode == 0
    failed += not ok
    print(("PASS " if ok else "FAIL ") + test.name + ("" if ok else "\n     " + r.stderr.strip().splitlines()[-1]))
try:
    happy_path()
    print("PASS right PIN still opens a session, wrong PIN does not")
except AssertionError as e:
    failed += 1
    print(f"FAIL happy path\n     {e}")
sys.exit(1 if failed else 0)
