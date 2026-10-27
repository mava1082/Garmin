import base64
import json

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from garmin_dashboard.build_static import apply_settings_file, encrypt
from garmin_dashboard.db import Database


def decrypt(enc: dict, password: str) -> bytes:
    """Same steps as decryptBundle() in app.js."""
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(enc["salt"]),
                     iterations=enc["iter"]).derive(password.encode())
    return AESGCM(key).decrypt(base64.b64decode(enc["iv"]), base64.b64decode(enc["data"]), None)


def test_encrypt_roundtrip_and_no_plaintext():
    payload = json.dumps({"resting_hr": 47}).encode()
    enc = encrypt(payload, "rätt-lösenord")
    assert b"resting_hr" not in json.dumps(enc).encode()
    assert decrypt(enc, "rätt-lösenord") == payload
    try:
        decrypt(enc, "fel")
        raise AssertionError("wrong password must fail")
    except Exception as e:
        assert type(e).__name__ == "InvalidTag"


def test_settings_file(tmp_path):
    db = Database(":memory:")
    f = tmp_path / "settings.json"
    f.write_text(json.dumps({"weekly_goal_hours": 8, "max_hr": None, "resting_hr": None, "evil": 1}))
    apply_settings_file(db, f)
    s = db.settings()
    assert s["weekly_goal_hours"] == 8 and s["hr_auto"] is True and "evil" not in s

    f.write_text(json.dumps({"max_hr": 185}))
    apply_settings_file(db, f)
    s = db.settings()
    assert s["max_hr"] == 185 and s["hr_auto"] is False
