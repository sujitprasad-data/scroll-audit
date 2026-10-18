# ⚡ ScrollAudit — YouTube Shorts & Instagram Reels Attention Span Analyzer

A **100% client-side, CSP-locked** web application and Python toolkit that analyzes your raw **Google Takeout (YouTube)** and **Meta (Instagram)** activity exports to measure:
- **Short-Form vs. Long-Form Watch Counts & Estimated Time Spent** (YouTube Shorts, Instagram Reels, Full Videos, and YouTube Music)
- **Inter-View Gap & Swipe Speed Distribution** (median timestamp gap between consecutive Shorts/Reels, $\le 5\text{s}$ gap rate, $\le 10\text{s}$ gap rate)
- **Cross-App Transitions** (detects rapid switches between YouTube and Instagram within 15 minutes)
- **24-Hour Activity Clock & Late-Night Views** (11 PM – 5 AM activity percentage)
- **Longest Continuous Viewing Sessions** (unbroken chains of views with $\le 5\text{m}$ gaps)

---

## 🔒 Browser-Enforced Privacy & Security Architecture

- **Strict Content-Security-Policy (`connect-src 'none'`)**: `index.html` enforces `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`. The browser itself blocks any outbound `fetch`, `XHR`, `WebSocket`, or `sendBeacon` request.
- **Zero Third-Party CDNs**: All CSS (`styles.css` precompiled with Tailwind CLI) and archive decompression libraries (`vendor/jszip.min.js`, `vendor/pako.min.js`) are self-hosted directly in the repository.
- **In-Memory Parsing with Size Guardrails**: Archives up to 250 MB are unpacked strictly in browser RAM and cleared as soon as the tab is closed.

---

## 📐 Methodology & Caveats

1. **Start-Timestamp Proxies**: Neither Google Takeout (`watch-history.html` / `watch-history.json`) nor Instagram (`videos_watched.json`) exports the exact duration a video played. Instead, each event logs when a view *started*. ScrollAudit uses the timestamp delta to the next view (`next_delta`) during active sessions as a relative proxy for how long you stayed on an item.
2. **YouTube Shorts Heuristic**: Because Google Takeout uses standard `youtube.com/watch?v=...` URLs for both Shorts and horizontal videos, an item (excluding YouTube Music) is classified as a Short if:
   - Its title contains `#` or `shorts`, or its URL contains `/shorts/`, **or**
   - It occurs within a rapid scrolling chain ($\le 90\text{s}$ gap to the next or previous item).
   Because timing is part of the heuristic when titles lack hashtags, inter-view gap statistics (computed across consecutive Short intervals $\le 90\text{s}$) should be interpreted as relative behavioral indicators rather than exact stopwatch measurements.
3. **Export Window Differences**: Google Takeout includes multi-month/multi-year YouTube history, whereas Meta typically purges granular `videos_watched.json` impression logs after a rolling 7–14 day window. Use the **Last 7 Days** view in the dashboard for an apples-to-apples cross-platform comparison.

---

## 📖 How to Export Your Data (Takes ~2 Minutes)

### 1. YouTube Watch History (Google Takeout)
1. Go to [Google Takeout](https://takeout.google.com/) and click **Deselect all**.
2. Scroll to the bottom and check **YouTube and YouTube Music**.
3. Click **All YouTube data included** $\rightarrow$ **Deselect all** $\rightarrow$ check only **`history`** $\rightarrow$ **OK**.
4. Create export, download the `.tgz` or `.zip` file, and drop it straight into ScrollAudit!

### 2. Instagram Watched Reels (Meta Accounts Center)
1. Go to [Instagram Accounts Center $\rightarrow$ Download your information](https://accountscenter.instagram.com/info_and_permissions/dyi/).
2. Select **Some of your information**.
3. Scroll to the bottom under *Ads information* and check **`Ads and topics`** *(this is where Meta stores `videos_watched.json` and `posts_viewed.json`)*.
4. Choose **Format: JSON**, download the `.zip` file, and drop it straight into ScrollAudit!

---

## 🐍 Running the Python CLI Scripts Locally

```bash
python3 analyze_watch_time.py --yt path/to/watch-history.html --ig-dir path/to/ads_and_topics
python3 analyze_attention_habits.py --yt path/to/watch-history.html --ig-dir path/to/ads_and_topics
```

## 📄 License

MIT License — see [LICENSE](LICENSE).
