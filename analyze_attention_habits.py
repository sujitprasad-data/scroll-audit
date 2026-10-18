#!/usr/bin/env python3
"""
Analyze Inter-View Gaps, Cross-App Switches, and Viewing Habits
dynamically for any YouTube & Instagram dataset.

Usage:
  python3 analyze_attention_habits.py [--yt path/to/watch-history.html] [--ig-dir path/to/ads_and_topics]
"""
import argparse
from datetime import datetime, timedelta
from collections import Counter, defaultdict
from analyze_watch_time import (
    parse_youtube_history,
    parse_instagram_history,
    DEFAULT_YT_HTML,
    DEFAULT_IG_DIR,
)


def dist_stats(arr, name):
    n = len(arr)
    if n == 0:
        print(f"=== {name} (n=0) ===")
        return
    under_3 = sum(1 for x in arr if x <= 3)
    under_5 = sum(1 for x in arr if x <= 5)
    under_10 = sum(1 for x in arr if x <= 10)
    under_15 = sum(1 for x in arr if x <= 15)
    under_30 = sum(1 for x in arr if x <= 30)
    over_30 = sum(1 for x in arr if x > 30)
    s_arr = sorted(arr)
    median = s_arr[n // 2]
    avg = sum(arr) / n
    print(f"=== {name} Inter-View Gap Distribution (n={n}) ===")
    print(f"  Mean: {avg:.1f}s | Median: {median:.1f}s")
    print(f"  Gap <= 3 sec  : {under_3:4d} ({under_3*100/n:.1f}%)")
    print(f"  Gap <= 5 sec  : {under_5:4d} ({under_5*100/n:.1f}%)")
    print(f"  Gap <= 10 sec : {under_10:4d} ({under_10*100/n:.1f}%)")
    print(f"  Gap <= 15 sec : {under_15:4d} ({under_15*100/n:.1f}%)")
    print(f"  Gap <= 30 sec : {under_30:4d} ({under_30*100/n:.1f}%)")
    print(f"  Gap > 30 sec  : {over_30:4d} ({over_30*100/n:.1f}%)")


def run_diagnostics(yt_path=DEFAULT_YT_HTML, ig_dir=DEFAULT_IG_DIR):
    yt = parse_youtube_history(yt_path)
    ig = parse_instagram_history(ig_dir)

    all_dates = [r["dt"] for r in yt] + [r["dt"] for r in ig]
    if not all_dates:
        print("No records found. Pass --yt or --ig-dir.")
        return

    max_dt = max(all_dates)
    cutoff_7d = datetime(max_dt.year, max_dt.month, max_dt.day) - timedelta(days=6)

    yt_short_deltas = [
        r["next_delta"]
        for r in yt
        if r["type"] == "Short" and r["next_delta"] is not None and 0 <= r["next_delta"] <= 90
    ]
    ig_reel_deltas = [
        r["next_delta"]
        for r in ig
        if r["kind"] == "Reel" and r["next_delta"] is not None and 0 < r["next_delta"] <= 90
    ]

    dist_stats(yt_short_deltas, "YouTube Shorts (All Loaded Days)")
    dist_stats(ig_reel_deltas, "Instagram Reels (Consecutive Non-Zero Intervals)")

    all_events = []
    for r in yt:
        all_events.append(
            {
                "dt": r["dt"],
                "platform": "YouTube",
                "kind": r["type"],
                "title": r["title"],
                "est_sec": r["est_sec"],
            }
        )
    for r in ig:
        all_events.append(
            {
                "dt": r["dt"],
                "platform": "Instagram",
                "kind": "IG " + r["kind"],
                "title": r["owner"],
                "est_sec": r["est_sec"],
            }
        )
    all_events.sort(key=lambda x: x["dt"])

    sessions = []
    cur = [all_events[0]]
    for e in all_events[1:]:
        gap = (e["dt"] - cur[-1]["dt"]).total_seconds()
        if gap <= 300:
            cur.append(e)
        else:
            sessions.append(cur)
            cur = [e]
    sessions.append(cur)

    print("\n=== Top 10 Longest Continuous Viewing Sessions (<=5m gap) ===")
    for s in sorted(sessions, key=lambda s: len(s), reverse=True)[:10]:
        dur_min = ((s[-1]["dt"] - s[0]["dt"]).total_seconds() + s[-1]["est_sec"]) / 60.0
        plats = Counter(x["kind"] for x in s)
        s_time = s[0]["dt"].strftime("%b %d %I:%M %p")
        e_time = s[-1]["dt"].strftime("%I:%M %p")
        print(
            f"  {s_time} -> {e_time}: {len(s):3d} items in {dur_min:5.1f} mins ({len(s)/max(dur_min,1):.1f} items/min) | {dict(plats)}"
        )

    late_night = [e for e in all_events if e["dt"].hour in (23, 0, 1, 2, 3, 4)]
    print(
        f"\nLate night (11 PM - 4:59 AM) items: {len(late_night)} ({len(late_night)*100/len(all_events):.1f}% of all views)"
    )

    switches = []
    last7_events = [e for e in all_events if e["dt"] >= cutoff_7d]
    for i in range(1, len(last7_events)):
        if last7_events[i]["platform"] != last7_events[i - 1]["platform"]:
            gap = (last7_events[i]["dt"] - last7_events[i - 1]["dt"]).total_seconds()
            if gap <= 900:
                switches.append(
                    (
                        last7_events[i - 1]["dt"],
                        last7_events[i - 1]["platform"],
                        last7_events[i]["platform"],
                        gap,
                    )
                )
    print(
        f"\nCross-App Switches (IG <-> YT within 15 mins in last 7 days): {len(switches)} transitions"
    )
    for sw in switches[:10]:
        t_str = sw[0].strftime("%b %d %I:%M:%S %p")
        print(f"  {t_str}: {sw[1]} -> {sw[2]} in {sw[3]:.0f} sec")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run behavioral diagnostics on exports")
    parser.add_argument("--yt", default=DEFAULT_YT_HTML, help="Path to watch-history.html")
    parser.add_argument("--ig-dir", default=DEFAULT_IG_DIR, help="Path to ads_and_topics folder")
    args = parser.parse_args()
    run_diagnostics(args.yt, args.ig_dir)
