#!/usr/bin/env python3
"""
Analyze YouTube Watch History (Shorts vs. Long Videos vs. Music)
and Instagram Exported Data dynamically for any dataset date range.

Usage:
  python3 analyze_watch_time.py [--yt path/to/watch-history.html] [--ig-dir path/to/ads_and_topics]
"""
import os
import re
import html
import json
import argparse
from datetime import datetime, timedelta, timezone
from collections import Counter

DEFAULT_YT_HTML = "data/youtube/Takeout/YouTube and YouTube Music/history/watch-history.html"
DEFAULT_IG_DIR = "data/instagram_ads/ads_information/ads_and_topics"


def parse_youtube_history(filepath):
    if not os.path.exists(filepath):
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()

    cells = text.split('<div class="outer-cell')
    records = []

    for cell in cells[1:]:
        m_url = re.search(r'Watched\s+<a href="([^"]+)">([^<]+)</a>', cell)
        if not m_url:
            continue
        url = m_url.group(1)
        title = html.unescape(m_url.group(2))
        m_chan = re.search(
            r'</a><br><a href="([^"]+)">([^<]+)</a><br>([^<]+)<br>', cell
        )
        if m_chan:
            chan_name = html.unescape(m_chan.group(2))
            dt_str = m_chan.group(3).strip()
        else:
            chan_name = "Unknown"
            m_dt = re.search(r"</a><br>([^<]+)<br></div>", cell)
            dt_str = m_dt.group(1).strip() if m_dt else ""

        dt_clean = re.sub(r"\s+[A-Z]{2,5}([+-]\d+)?$", "", dt_str.replace("\u202f", " "))
        try:
            dt = datetime.strptime(dt_clean, "%b %d, %Y, %I:%M:%S %p")
        except ValueError:
            continue

        records.append(
            {
                "url": url,
                "title": title,
                "channel": chan_name,
                "dt": dt,
                "is_music": "music.youtube.com" in url
                or '<p class="mdl-typography--title">YouTube Music' in cell,
            }
        )

    records.sort(key=lambda x: x["dt"])

    for i in range(len(records)):
        records[i]["next_delta"] = (
            (records[i + 1]["dt"] - records[i]["dt"]).total_seconds()
            if i + 1 < len(records)
            else None
        )
        records[i]["prev_delta"] = (
            (records[i]["dt"] - records[i - 1]["dt"]).total_seconds()
            if i > 0
            else None
        )

    # Align classification identically with app.js
    for r in records:
        t_low = r["title"].lower()
        has_hashtag = "#" in t_low or "shorts" in t_low or "/shorts/" in r["url"]
        nd = r["next_delta"]
        pd = r["prev_delta"]
        rapid_next = nd is not None and nd <= 90
        rapid_prev = pd is not None and pd <= 90

        if r["is_music"]:
            r["type"] = "Music"
            r["est_sec"] = max(5, nd) if (nd is not None and 0 < nd <= 420) else 210
        elif has_hashtag or rapid_next or (rapid_prev and (nd is None or nd <= 180)):
            r["type"] = "Short"
            r["est_sec"] = max(2, nd) if (nd is not None and 0 < nd <= 120) else 28
        else:
            r["type"] = "Long Video"
            r["est_sec"] = max(15, nd) if (nd is not None and 0 < nd <= 1800) else 480

    return records


def parse_instagram_history(ig_dir=DEFAULT_IG_DIR):
    local_tz = datetime.now().astimezone().tzinfo or timezone(timedelta(hours=5, minutes=30))

    def load_file(fn, kind):
        p = os.path.join(ig_dir, fn)
        if not os.path.exists(p):
            return []
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            for v in d.values():
                if isinstance(v, list):
                    d = v
                    break
        if not isinstance(d, list):
            return []
        items = []
        for x in d:
            ts = x.get("timestamp")
            if not ts:
                continue
            dt = datetime.fromtimestamp(ts, local_tz).replace(tzinfo=None)
            url = ""
            owner = "Unknown"
            for lv in x.get("label_values", []):
                if lv.get("label") == "URL":
                    url = lv.get("value", "")
                if lv.get("title") == "Owner":
                    for sub in lv.get("dict", []):
                        for s2 in sub.get("dict", []):
                            if s2.get("label") == "Username" and s2.get("value"):
                                owner = "@" + s2.get("value")
                            elif (
                                s2.get("label") == "Name"
                                and s2.get("value")
                                and owner == "Unknown"
                            ):
                                owner = s2.get("value")
            items.append({"dt": dt, "kind": kind, "url": url, "owner": owner})
        return items

    vids = load_file("videos_watched.json", "Reel")
    posts = load_file("posts_viewed.json", "Post")
    ads = load_file("ads_viewed.json", "Ad")

    all_ig = sorted(vids + posts + ads, key=lambda x: x["dt"])
    for i in range(len(all_ig)):
        nd = (
            (all_ig[i + 1]["dt"] - all_ig[i]["dt"]).total_seconds()
            if i + 1 < len(all_ig)
            else None
        )
        all_ig[i]["next_delta"] = nd
        if all_ig[i]["kind"] == "Reel":
            all_ig[i]["est_sec"] = max(3, nd) if (nd is not None and 0 < nd <= 90) else 22
        else:
            all_ig[i]["est_sec"] = max(2, nd) if (nd is not None and 0 < nd <= 45) else 8

    return all_ig


def build_summary(yt_path=DEFAULT_YT_HTML, ig_dir=DEFAULT_IG_DIR):
    records = parse_youtube_history(yt_path)
    ig_records = parse_instagram_history(ig_dir)

    all_dates = [r["dt"] for r in records] + [r["dt"] for r in ig_records]
    if not all_dates:
        print("No YouTube or Instagram records found. Pass --yt or --ig-dir.")
        return

    max_dt = max(all_dates)
    cutoff_7d = datetime(max_dt.year, max_dt.month, max_dt.day) - timedelta(days=6)

    if records:
        yt_7d = [r for r in records if r["dt"] >= cutoff_7d]
        c_yt7 = Counter(r["type"] for r in yt_7d)
        yt_sec7 = sum(r["est_sec"] for r in yt_7d)
        print(f"=== YouTube Last 7 Days ({cutoff_7d.date()} to {max_dt.date()}) ===")
        print(
            f"  Shorts: {c_yt7['Short']} ({c_yt7['Short']/7:.1f}/day) | Full Videos: {c_yt7['Long Video']} | Music: {c_yt7['Music']}"
        )
        print(f"  Est. Total YouTube Time: {yt_sec7/3600:.2f} hrs ({yt_sec7/60/7:.1f} min/day)")

    if ig_records:
        ig_7d = [x for x in ig_records if x["dt"] >= cutoff_7d]
        c_ig7 = Counter(x["kind"] for x in ig_7d)
        rsec7 = sum(x["est_sec"] for x in ig_7d if x["kind"] == "Reel")
        sec7 = sum(x["est_sec"] for x in ig_7d)
        print(f"\n=== Instagram Last 7 Days ({cutoff_7d.date()} to {max_dt.date()}) ===")
        print(
            f"  Reels Watched: {c_ig7['Reel']} ({c_ig7['Reel']/7:.1f}/day) | Est. Reel Time: {rsec7/60:.1f} mins ({rsec7/60/7:.1f} min/day)"
        )
        print(
            f"  Posts Viewed : {c_ig7['Post']} ({c_ig7['Post']/7:.1f}/day) | Ads Viewed: {c_ig7['Ad']} ({c_ig7['Ad']/7:.1f}/day)"
        )
        print(
            f"  Est. Total IG Time: {sec7/60:.1f} mins ({sec7/3600:.2f} hrs, {sec7/60/7:.1f} min/day)"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze YouTube & Instagram exports")
    parser.add_argument("--yt", default=DEFAULT_YT_HTML, help="Path to watch-history.html")
    parser.add_argument("--ig-dir", default=DEFAULT_IG_DIR, help="Path to ads_and_topics folder")
    args = parser.parse_args()
    build_summary(args.yt, args.ig_dir)
