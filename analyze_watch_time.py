#!/usr/bin/env python3
"""
Analyze YouTube Watch History (Shorts vs. Long Videos vs. Music)
and Instagram Exported Data.
"""
import re
import html
import json
from datetime import datetime, timedelta
from collections import Counter, defaultdict

YOUTUBE_HTML = "data/youtube/Takeout/YouTube and YouTube Music/history/watch-history.html"
IG_LINK_HISTORY = "data/instagram/logged_information/link_history/link_history.json"


def parse_youtube_history(filepath):
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

        dt_clean = dt_str.replace("\u202f", " ").replace(" IST", "")
        dt = datetime.strptime(dt_clean, "%b %d, %Y, %I:%M:%S %p")
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

    for r in records:
        t_low = r["title"].lower()
        has_hashtag = "#" in t_low or "shorts" in t_low
        nd = r["next_delta"]
        pd = r["prev_delta"]
        rapid_next = nd is not None and nd <= 90
        rapid_prev = pd is not None and pd <= 90

        if r["is_music"]:
            r["type"] = "Music"
        elif has_hashtag or rapid_next or (rapid_prev and (nd is None or nd <= 180)):
            r["type"] = "Short"
        else:
            r["type"] = "Long Video"

        if r["type"] == "Short":
            r["est_sec"] = max(2, nd) if (nd is not None and nd <= 120) else 28
        elif r["type"] == "Music":
            r["est_sec"] = max(5, nd) if (nd is not None and nd <= 420) else 210
        else:
            r["est_sec"] = max(15, nd) if (nd is not None and nd <= 1800) else 480

    return records


def parse_instagram_history():
    from datetime import timezone
    IST = timezone(timedelta(hours=5, minutes=30))
    base = "data/instagram_ads/ads_information/ads_and_topics"

    def load_file(fn, kind):
        with open(f"{base}/{fn}", "r", encoding="utf-8") as f:
            d = json.load(f)
        items = []
        for x in d:
            ts = x.get("timestamp")
            if not ts:
                continue
            dt = datetime.fromtimestamp(ts, IST).replace(tzinfo=None)
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


def build_summary():
    records = parse_youtube_history(YOUTUBE_HTML)
    ig_records = parse_instagram_history()

    reel_deltas = [
        x["next_delta"]
        for x in ig_records
        if x["kind"] == "Reel"
        and x["next_delta"] is not None
        and 0 < x["next_delta"] <= 120
    ]
    print(
        f"Avg seconds per IG Reel in active scroll session: {sum(reel_deltas)/len(reel_deltas):.1f}s"
    )

    print("\n=== Daily Instagram Breakdown (Oct 04 - Oct 17, 2026) ===")
    for d_idx in range(14):
        day = (datetime(2026, 10, 4) + timedelta(days=d_idx)).date()
        day_ig = [x for x in ig_records if x["dt"].date() == day]
        c = Counter(x["kind"] for x in day_ig)
        r_min = sum(x["est_sec"] for x in day_ig if x["kind"] == "Reel") / 60.0
        tot_min = sum(x["est_sec"] for x in day_ig) / 60.0
        print(
            f"  {day}: {c['Reel']:3d} Reels ({r_min:4.1f}m) | {c['Post']:3d} Posts | {c['Ad']:2d} Ads | Total IG Time: {tot_min:4.1f}m"
        )

    last7_ig = [x for x in ig_records if x["dt"] >= datetime(2026, 10, 11)]
    c7 = Counter(x["kind"] for x in last7_ig)
    rsec7 = sum(x["est_sec"] for x in last7_ig if x["kind"] == "Reel")
    sec7 = sum(x["est_sec"] for x in last7_ig)
    print("\n=== Instagram Last 7 Days (Oct 11 - Oct 17) ===")
    print(
        f"  Reels Watched: {c7['Reel']} ({c7['Reel']/7:.1f}/day) | Est. Reel Time: {rsec7/60:.1f} mins ({rsec7/60/7:.1f} min/day)"
    )
    print(
        f"  Posts Viewed : {c7['Post']} ({c7['Post']/7:.1f}/day) | Ads Viewed: {c7['Ad']} ({c7['Ad']/7:.1f}/day)"
    )
    print(
        f"  Total IG Time: {sec7/60:.1f} mins ({sec7/3600:.2f} hrs, {sec7/60/7:.1f} min/day)"
    )

    c14 = Counter(x["kind"] for x in ig_records)
    rsec14 = sum(x["est_sec"] for x in ig_records if x["kind"] == "Reel")
    sec14 = sum(x["est_sec"] for x in ig_records)
    print("\n=== Instagram Full 14-Day Window (Oct 04 - Oct 17) ===")
    print(
        f"  Reels Watched: {c14['Reel']} ({c14['Reel']/14:.1f}/day) | Est. Reel Time: {rsec14/60:.1f} mins ({rsec14/60/14:.1f} min/day)"
    )
    print(
        f"  Posts Viewed : {c14['Post']} ({c14['Post']/14:.1f}/day) | Ads Viewed: {c14['Ad']} ({c14['Ad']/14:.1f}/day)"
    )
    print(
        f"  Total IG Time: {sec14/60:.1f} mins ({sec14/3600:.2f} hrs, {sec14/60/14:.1f} min/day)"
    )

    print("\nTop IG Reel Creators (14d):")
    print(
        Counter(
            x["owner"]
            for x in ig_records
            if x["kind"] == "Reel" and x["owner"] != "Unknown"
        ).most_common(10)
    )
    print("\nIG Reels by Hour of Day (0-23):")
    print([sum(1 for x in ig_records if x["kind"] == "Reel" and x["dt"].hour == h) for h in range(24)])


if __name__ == "__main__":
    build_summary()

