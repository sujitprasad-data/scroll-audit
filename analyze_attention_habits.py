#!/usr/bin/env python3
import json
from datetime import datetime, timedelta
from collections import Counter, defaultdict
from analyze_watch_time import parse_youtube_history, parse_instagram_history, YOUTUBE_HTML

yt = parse_youtube_history(YOUTUBE_HTML)
ig = parse_instagram_history()

# 1. Attention span / Dwell time distribution on YT Shorts (consecutive deltas <= 90s)
yt_short_deltas = [
    r["next_delta"]
    for r in yt
    if r["type"] == "Short" and r["next_delta"] is not None and 0 <= r["next_delta"] <= 90
]
ig_reel_deltas = [
    r["next_delta"]
    for r in ig
    if r["kind"] == "Reel" and r["next_delta"] is not None and 0 <= r["next_delta"] <= 90
]


def dist_stats(arr, name):
    n = len(arr)
    under_3 = sum(1 for x in arr if x <= 3)
    under_5 = sum(1 for x in arr if x <= 5)
    under_10 = sum(1 for x in arr if x <= 10)
    under_15 = sum(1 for x in arr if x <= 15)
    under_30 = sum(1 for x in arr if x <= 30)
    over_30 = sum(1 for x in arr if x > 30)
    s_arr = sorted(arr)
    median = s_arr[n // 2] if n else 0
    avg = sum(arr) / n if n else 0
    print(f"=== {name} Dwell Time / Attention Span (n={n}) ===")
    print(f"  Mean: {avg:.1f}s | Median: {median:.1f}s")
    print(f"  Instant Swipe (<= 3 sec) : {under_3:4d} ({under_3*100/n:.1f}%)")
    print(f"  Fast Reject   (<= 5 sec) : {under_5:4d} ({under_5*100/n:.1f}%)")
    print(f"  Quick Bail    (<= 10 sec): {under_10:4d} ({under_10*100/n:.1f}%)")
    print(f"  Short Attention(<=15 sec): {under_15:4d} ({under_15*100/n:.1f}%)")
    print(f"  Watched <= 30 sec        : {under_30:4d} ({under_30*100/n:.1f}%)")
    print(f"  Full Watch    (> 30 sec) : {over_30:4d} ({over_30*100/n:.1f}%)")


dist_stats(yt_short_deltas, "YouTube Shorts (All 48d)")
dist_stats(ig_reel_deltas, "Instagram Reels (Last 7d)")

# 2. Has attention span degraded over the last 7 weeks on YouTube?
print("\n=== Weekly Attention Span Trend on YouTube Shorts ===")
start_dt = datetime(2026, 8, 31)
for w in range(7):
    w_start = start_dt + timedelta(days=w * 7)
    w_end = w_start + timedelta(days=7)
    w_shorts = [r for r in yt if w_start <= r["dt"] < w_end and r["type"] == "Short"]
    w_deltas = [
        r["next_delta"]
        for r in w_shorts
        if r["next_delta"] is not None and 0 <= r["next_delta"] <= 90
    ]
    if w_deltas:
        s_w = sorted(w_deltas)
        med = s_w[len(s_w) // 2]
        avg = sum(w_deltas) / len(w_deltas)
        fast5 = sum(1 for x in w_deltas if x <= 5) * 100 / len(w_deltas)
        fast10 = sum(1 for x in w_deltas if x <= 10) * 100 / len(w_deltas)
        s_str = w_start.strftime("%b %d")
        e_str = (w_end - timedelta(days=1)).strftime("%b %d")
        print(
            f"  Week {w+1} ({s_str} - {e_str}): {len(w_shorts):3d} Shorts | Avg Dwell: {avg:4.1f}s | Median: {med:4.1f}s | <=5s Swipe: {fast5:4.1f}% | <=10s Swipe: {fast10:4.1f}%"
        )

# 3. Attention span on LONG videos (when you click a full video and then click another video within < 30 mins)
long_deltas = [
    r["next_delta"]
    for r in yt
    if r["type"] == "Long Video"
    and r["next_delta"] is not None
    and 0 <= r["next_delta"] <= 1800
]
print("\n=== Long Video Abandonment / Hopping Analysis ===")
n_l = len(long_deltas)
b_30s = sum(1 for x in long_deltas if x <= 30)
b_1m = sum(1 for x in long_deltas if x <= 60)
b_2m = sum(1 for x in long_deltas if x <= 120)
b_5m = sum(1 for x in long_deltas if x <= 300)
print(f"  Out of {n_l} consecutive Long Video plays:")
print(f"  Abandoned within 30 sec : {b_30s} ({b_30s*100/n_l:.1f}%)")
print(f"  Abandoned within 1 min  : {b_1m} ({b_1m*100/n_l:.1f}%)")
print(f"  Abandoned within 2 mins : {b_2m} ({b_2m*100/n_l:.1f}%)")
print(f"  Abandoned within 5 mins : {b_5m} ({b_5m*100/n_l:.1f}%)")
print(f"  Median time before hopping to next video: {sorted(long_deltas)[n_l//2]:.0f} sec ({sorted(long_deltas)[n_l//2]/60:.1f} mins)")

# 4. Binge / Rabbit-Hole Sessions (longest unbroken chains of videos with gap <= 5 mins)
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
    if gap <= 300:  # 5 min max gap between clicks
        cur.append(e)
    else:
        sessions.append(cur)
        cur = [e]
sessions.append(cur)

print("\n=== Top 12 Most Extreme Binge / Doomscroll Sessions ===")
sessions_by_count = sorted(sessions, key=lambda s: len(s), reverse=True)
for s in sessions_by_count[:12]:
    dur_min = ((s[-1]["dt"] - s[0]["dt"]).total_seconds() + s[-1]["est_sec"]) / 60.0
    plats = Counter(x["kind"] for x in s)
    s_time = s[0]["dt"].strftime("%b %d %I:%M %p")
    e_time = s[-1]["dt"].strftime("%I:%M %p")
    print(
        f"  {s_time} -> {e_time}: {len(s):3d} items in {dur_min:5.1f} mins ({len(s)/max(dur_min,1):.1f} vids/min) | {dict(plats)}"
    )

# 5. Sleep / Circadian Disruption (Late night 11 PM - 5 AM & First thing in morning 5 AM - 8 AM)
late_night = [e for e in all_events if e["dt"].hour in (23, 0, 1, 2, 3, 4)]
print(
    f"\nLate night (11 PM - 4:59 AM) items: {len(late_night)} ({len(late_night)*100/len(all_events):.1f}% of all activity)"
)
print("Late night breakdown by hour:", dict(sorted(Counter(e["dt"].hour for e in late_night).items())))

graveyard_days = defaultdict(list)
for e in all_events:
    if e["dt"].hour in (1, 2, 3, 4):
        graveyard_days[e["dt"].date()].append(
            e["dt"].strftime("%I:%M %p") + " (" + e["kind"] + ")"
        )
print(f"\nDays with 1 AM - 5 AM 'Graveyard' Scrolling ({len(graveyard_days)} days):")
for d, evs in sorted(graveyard_days.items()):
    print(f"  {d}: {len(evs):3d} items — {evs[0]} to {evs[-1]}")

# 6. First dopamine hit upon waking up vs Last hit before sleeping
by_date_events = defaultdict(list)
for e in all_events:
    by_date_events[e["dt"].date()].append(e)

morning_reflex = []
for d, evs in sorted(by_date_events.items()):
    morn = [e for e in evs if 5 <= e["dt"].hour <= 9]
    if morn:
        morning_reflex.append((d, morn[0]["dt"].strftime("%I:%M %p"), morn[0]["platform"], morn[0]["kind"], len(morn)))

print(f"\nMorning Dopamine Reflex (5 AM - 9 AM activity on {len(morning_reflex)}/{len(by_date_events)} days):")
for m in morning_reflex[-10:]:
    print(f"  {m[0]}: First hit at {m[1]} on {m[2]} ({m[3]}) — {m[4]} items watched before 10 AM")

# 7. App Ping-Pong (Switching between Instagram and YouTube within 15 minutes in the last 7 days)
switches = []
last7_events = [e for e in all_events if e["dt"] >= datetime(2026, 10, 11)]
for i in range(1, len(last7_events)):
    if last7_events[i]["platform"] != last7_events[i - 1]["platform"]:
        gap = (last7_events[i]["dt"] - last7_events[i - 1]["dt"]).total_seconds()
        if gap <= 900:  # switched apps within 15 mins
            switches.append(
                (
                    last7_events[i - 1]["dt"],
                    last7_events[i - 1]["platform"],
                    last7_events[i]["platform"],
                    gap,
                )
            )
print(
    f"\nRapid App Switches (IG <-> YT within 15 mins in last 7 days): {len(switches)} switches"
)
for sw in switches:
    t_str = sw[0].strftime("%b %d %I:%M:%S %p")
    print(f"  {t_str}: {sw[1]} -> {sw[2]} in {sw[3]:.0f} sec")

# 8. Fragmented Workday (9 AM - 6 PM on weekdays)
work_sessions = [s for s in sessions if s[0]["dt"].weekday() < 5 and 9 <= s[0]["dt"].hour < 18]
print(f"\nWeekday Work-Hour (9 AM - 6 PM) Micro-Sessions: {len(work_sessions)} total sessions across 34 weekdays ({len(work_sessions)/34:.1f} interruptions/workday)")
