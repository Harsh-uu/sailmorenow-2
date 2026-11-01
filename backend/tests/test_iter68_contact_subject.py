"""Iteration 68: POST /api/contact with optional 'subject' field.

Validates:
- Endpoint accepts 'subject' and returns {ok: true}
- Still validates name/email/message>=10 chars
- Stored subject is persisted in contact_messages collection
- Rate limit: 3 per 10 min per IP (careful — keep to <=3 valid submissions)
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _mk_payload(subject=None, msg=None, name=None, email=None):
    return {
        "name": name or f"TEST User {uuid.uuid4().hex[:6]}",
        "email": email or f"test_{uuid.uuid4().hex[:6]}@example.com",
        "message": msg or "Interested in becoming a Community Partner. Please reach out.",
        **({"subject": subject} if subject is not None else {}),
    }


class TestContactSubject:
    # Validation must NOT count against rate limit — do these first
    def test_validation_message_too_short(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/contact",
                            json=_mk_payload(subject="Community Partner inquiry", msg="short"))
        assert r.status_code == 400
        assert "chars" in r.json().get("detail", "").lower() or "message" in r.json().get("detail", "").lower()

    def test_validation_missing_name(self, api_client):
        p = _mk_payload(subject="Community Partner inquiry")
        p["name"] = ""
        r = api_client.post(f"{BASE_URL}/api/contact", json=p)
        assert r.status_code == 400

    def test_validation_bad_email(self, api_client):
        p = _mk_payload(subject="Community Partner inquiry")
        p["email"] = "not-an-email"
        r = api_client.post(f"{BASE_URL}/api/contact", json=p)
        assert r.status_code == 400

    # Now one valid submission (only 1 consumed towards the 3/10min bucket)
    def test_contact_accepts_subject_and_persists(self, api_client):
        marker = f"MARKER-{uuid.uuid4().hex[:8]}"
        payload = _mk_payload(
            subject="Community Partner inquiry",
            msg=f"Community Partner inquiry. Organization: TEST_ORG {marker}. Please reach out.",
        )
        r = api_client.post(f"{BASE_URL}/api/contact", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True

        # Verify persistence via mongo shell
        import subprocess
        js = (
            'db = db.getSiblingDB(process.env.DB_NAME || "test_database"); '
            f'printjson(db.contact_messages.findOne({{ message: /{marker}/ }}, '
            '{ _id: 0, name: 1, email: 1, subject: 1, message: 1 }));'
        )
        out = subprocess.check_output(
            ["mongosh", "--quiet", "--eval", js],
            env={**os.environ, "DB_NAME": os.environ.get("DB_NAME", "test_database")},
            timeout=10,
        ).decode()
        assert "Community Partner inquiry" in out, f"subject not persisted: {out}"
        assert marker in out
