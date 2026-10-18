# ⚡ ScrollAudit — YouTube Shorts & Instagram Reels Attention Span Analyzer

A **100% client-side, privacy-first** web application and Python toolkit that analyzes your raw **Google Takeout (YouTube)** and **Meta (Instagram)** activity exports to measure:
- **Short-Form vs. Long-Form Watch Counts & Time Spent** (YouTube Shorts, Instagram Reels, Full Videos, and YouTube Music)
- **Attention Span & Swipe Speed Distribution** (median dwell time per Short/Reel, $\le 5\text{s}$ instant reject rate, $\le 10\text{s}$ bail rate)
- **Long-Form Video Hopping** (how often you abandon full-length videos in under 5 minutes)
- **Cross-App "Ping-Pong" Detector** (detects rapid muscle-memory switching between YouTube and Instagram within seconds)
- **24-Hour Dopamine Clock & Circadian Hijack** (11 PM – 5 AM graveyard scrolling & 5 AM – 9 AM wake-up reflex)
- **Top "Doomscroll Trance" Sessions** (longest unbroken scrolling chains)

🔒 **100% Private**: The web app (`index.html`) unpacks `.tgz` and `.zip` exports directly in your browser's memory using `JSZip` and `pako`. Zero data is ever uploaded to any server.

---

## 🚀 Try It Live or Run Locally

1. Open `index.html` in any browser (or visit the GitHub Pages deployment).
2. Click **✨ Try Demo Dataset** to explore a sample dashboard immediately, or drag-and-drop your own raw `.tgz` / `.zip` exports onto the page.

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
