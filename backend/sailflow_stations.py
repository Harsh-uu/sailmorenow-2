"""Market → SailFlow station mapping (EDIT HERE).

One editable config for the home-screen SailFlow weather widget. Each PNW
market maps to the nearest SailFlow station on/near a body of water. The clients
render a link card that opens `url` in a new tab / external browser.

To change a station: update `station` (display name) and `url` (SailFlow page).
Add `lat`/`lng` only if you later want to switch to a live iframe embed.

LIVE WIND EMBED (optional): add an `embed_url` to any station to show a live
SailFlow wind widget inline (iframe on web, WebView on mobile) instead of just
the link card. Get the value from SailFlow: open the station's page on desktop →
click "Widgets" → choose "Live Wind" → copy the iframe `src` and paste it as
`embed_url`. Stations without `embed_url` keep the link card.
"""
from __future__ import annotations
from typing import Dict, Any, Optional

# Fallback used when a market is set but unknown.
DEFAULT_MARKET = "Greater Seattle"

# Shown on the signed-out home screen before any port/market has been chosen.
NO_MARKET_STATION = {
    "station": "Shilshole Bay — Puget Sound",
    "url": "https://sailflow.com/spot/480",
}

SAILFLOW_STATIONS: Dict[str, Dict[str, Any]] = {
    "Portland/Vancouver": {
        "station": "Columbia River — Portland",
        "url": "https://sailflow.com/spot/707302",
    },
    "Hood River": {
        "station": "Hood River Event Site (DB1)",
        "url": "https://sailflow.com/spot/7565",
    },
    "Eugene": {
        "station": "Fern Ridge Reservoir (forecast only)",
        "url": "https://sailflow.com/spot/1253",
    },
    "Olympia": {
        "station": "Budd Inlet, Olympia",
        "url": "https://sailflow.com/spot/42128",
    },
    "Tacoma": {
        "station": "Commencement Bay, Tacoma",
        "url": "https://sailflow.com/spot/42926",
    },
    "Greater Seattle": {
        "station": "West Point Light / Shilshole (Puget Sound)",
        "url": "https://ww.sailflow.com/windAndWhere.iws?regionID=119&siteID=293",
        # To enable the live inline widget, paste a SailFlow "Live Wind" widget
        # iframe src here (desktop sailflow.com → station → Widgets → Live Wind):
        # "embed_url": "https://widgets.sailflow.com/widgets/web/liveWind?...&sid=...",
    },
    "Kirkland": {
        "station": "Lake Washington",
        "url": "https://sailflow.com/spot/472",
    },
    "Everett": {
        "station": "Port Gardner, Everett",
        "url": "https://sailflow.com/spot/174987",
    },
    "Anacortes/San Juan Islands": {
        "station": "Anacortes / San Juan Islands",
        "url": "https://sailflow.com/spot/164756",
    },
    "Bellingham": {
        "station": "Bellingham Bay (Bellingham Cold Storage)",
        "url": "https://ww.sailflow.com/windandwhere.iws?regionID=133&siteID=1495",
    },
}


def station_for(market: Optional[str]) -> Dict[str, Any]:
    """Return {market, station, url, embed_url, is_default} for a market,
    falling back to the default market's station when unknown/empty."""
    if not (market and market.strip()):
        # No port chosen yet (e.g. signed-out home) → fixed default station.
        return {
            "market": "Pacific Northwest",
            "station": NO_MARKET_STATION["station"],
            "url": NO_MARKET_STATION["url"],
            "embed_url": None,
            "is_default": True,
        }
    key = market if market in SAILFLOW_STATIONS else DEFAULT_MARKET
    entry = SAILFLOW_STATIONS.get(key, {})
    return {
        "market": key,
        "station": entry.get("station"),
        "url": entry.get("url"),
        "embed_url": entry.get("embed_url"),
        "is_default": key != market,
    }
