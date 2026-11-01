"""Backend tests for edit-in-place profile card (iter96).
Covers:
- /api/org-listing/mine returns logo/cover + originals + max_photos
- PUT /api/org-listing persists logo_url+logo_original_url, cover_url+cover_original_url, photos[{url,original,caption}]
- Tier clamping (CP = 6, regular = 1)
- GET /api/u/{handle} returns cover_url + photos with originals STRIPPED
"""
import os
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com"
API = BASE + "/api"
PSSS_TOKEN = "test_session_iter96_psss_1791571778820"
WTYC_TOKEN = "test_session_iter96_wtyc_1791571778820"

# Tiny valid data URL (1x1 PNG) + another distinct 1x1
PNG_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
PNG_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _client(tok):
    s = requests.Session()
    s.cookies.set("session_token", tok, domain="boat-community-1.preview.emergentagent.com")
    return s


@pytest.fixture
def psss():
    return _client(PSSS_TOKEN)


@pytest.fixture
def wtyc():
    return _client(WTYC_TOKEN)


# --- GET /org-listing/mine shape ---
def test_mine_shape_psss(psss):
    r = psss.get(f"{API}/org-listing/mine")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["max_photos"] == 6
    assert d["is_community_partner"] is True
    l = d["listing"]
    assert "logo_url" in l and "logo_original_url" in l
    assert "cover_url" in l and "cover_original_url" in l
    assert isinstance(l.get("photos"), list)


def test_mine_shape_wtyc(wtyc):
    r = wtyc.get(f"{API}/org-listing/mine")
    assert r.status_code == 200
    d = r.json()
    assert d["max_photos"] == 1
    assert d["is_community_partner"] is False


# --- PUT persists logo+original ---
def test_put_logo_persists(psss):
    # Save original state
    orig = psss.get(f"{API}/org-listing/mine").json()["listing"]
    try:
        r = psss.put(f"{API}/org-listing", json={"logo_url": PNG_A, "logo_original_url": PNG_B})
        assert r.status_code == 200, r.text
        l = r.json()["listing"]
        assert l["logo_url"] == PNG_A
        assert l["logo_original_url"] == PNG_B
        # Verify via GET
        l2 = psss.get(f"{API}/org-listing/mine").json()["listing"]
        assert l2["logo_url"] == PNG_A
        assert l2["logo_original_url"] == PNG_B
    finally:
        psss.put(f"{API}/org-listing", json={
            "logo_url": orig.get("logo_url") or "",
            "logo_original_url": orig.get("logo_original_url") or "",
        })


# --- PUT persists cover+original ---
def test_put_cover_persists(psss):
    orig = psss.get(f"{API}/org-listing/mine").json()["listing"]
    try:
        r = psss.put(f"{API}/org-listing", json={"cover_url": PNG_A, "cover_original_url": PNG_B})
        assert r.status_code == 200, r.text
        l = r.json()["listing"]
        assert l["cover_url"] == PNG_A
        assert l["cover_original_url"] == PNG_B
    finally:
        psss.put(f"{API}/org-listing", json={
            "cover_url": orig.get("cover_url") or "",
            "cover_original_url": orig.get("cover_original_url") or "",
        })


# --- photos clamped to tier max ---
def test_photos_clamp_cp(psss):
    orig = psss.get(f"{API}/org-listing/mine").json()["listing"]
    try:
        # Send 10 unique photos -> should clamp to 6
        photos = [{"url": PNG_A[:-10] + f"ab{i:02d}abc==", "original": PNG_B, "caption": f"c{i}"} for i in range(10)]
        r = psss.put(f"{API}/org-listing", json={"photos": photos})
        assert r.status_code == 200, r.text
        assert len(r.json()["listing"]["photos"]) == 6
    finally:
        psss.put(f"{API}/org-listing", json={"photos": orig.get("photos") or []})


def test_photos_clamp_regular(wtyc):
    orig = wtyc.get(f"{API}/org-listing/mine").json()["listing"]
    try:
        photos = [{"url": PNG_A[:-10] + f"xy{i:02d}abc==", "original": PNG_B, "caption": f"c{i}"} for i in range(5)]
        r = wtyc.put(f"{API}/org-listing", json={"photos": photos})
        assert r.status_code == 200
        assert len(r.json()["listing"]["photos"]) == 1
    finally:
        wtyc.put(f"{API}/org-listing", json={"photos": orig.get("photos") or []})


# --- Photo entry preserves url, original, caption separately ---
def test_photo_entry_persists_fields(psss):
    orig = psss.get(f"{API}/org-listing/mine").json()["listing"]
    try:
        p = {"url": PNG_A, "original": PNG_B, "caption": "Dock view"}
        r = psss.put(f"{API}/org-listing", json={"photos": [p]})
        assert r.status_code == 200
        got = r.json()["listing"]["photos"][0]
        assert got["url"] == PNG_A
        assert got["original"] == PNG_B
        assert got["caption"] == "Dock view"
    finally:
        psss.put(f"{API}/org-listing", json={"photos": orig.get("photos") or []})


# --- Public GET strips originals ---
def test_public_handle_strips_originals():
    r = requests.get(f"{API}/u/pugetsoundsailingsoc")
    assert r.status_code == 200
    u = r.json()["user"]
    assert "cover_url" in u  # present
    for p in (u.get("photos") or []):
        assert "original" not in p, f"Public response leaked original: {p}"
        assert "url" in p


# --- Clear (empty-string) support ---
def test_clear_logo_and_cover(psss):
    orig = psss.get(f"{API}/org-listing/mine").json()["listing"]
    try:
        psss.put(f"{API}/org-listing", json={"logo_url": PNG_A, "logo_original_url": PNG_B,
                                             "cover_url": PNG_A, "cover_original_url": PNG_B})
        r = psss.put(f"{API}/org-listing", json={"logo_url": "", "logo_original_url": "",
                                                 "cover_url": "", "cover_original_url": ""})
        assert r.status_code == 200
        l = r.json()["listing"]
        assert not l.get("logo_url")
        assert not l.get("cover_url")
    finally:
        psss.put(f"{API}/org-listing", json={
            "logo_url": orig.get("logo_url") or "",
            "logo_original_url": orig.get("logo_original_url") or "",
            "cover_url": orig.get("cover_url") or "",
            "cover_original_url": orig.get("cover_original_url") or "",
            "photos": orig.get("photos") or [],
        })
