// ScrollAudit — 100% Client-Side, CSP-Locked Analyzer
// Zero external network requests (enforced via Content-Security-Policy: connect-src 'none')

let ytRecords = [];
let igRecords = [];
let loadedBadges = [];
let selectedDays = 7; // 7, 30, or 0 (all)
let chartMetric = 'count'; // 'count' or 'time'

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024; // 250 MB safety limit

// HTML Escape helper to prevent DOM XSS from untrusted channel/creator/title strings
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

function toggleGuideModal() {
  const el = document.getElementById('guide-modal');
  if (el) el.classList.toggle('hidden');
}

function addBadge(label, color) {
  loadedBadges.push({ label, color });
  const wrap = document.getElementById('loaded-files-badges');
  if (!wrap) return;
  wrap.innerHTML = loadedBadges.map(b =>
    `<span class="px-2.5 py-1 text-xs font-semibold rounded-full border ${esc(b.color)}">✓ ${esc(b.label)}</span>`
  ).join('');
}

function setStatus(msg, isError = false) {
  const banner = document.getElementById('status-banner');
  const txt = document.getElementById('status-text');
  if (!banner || !txt) return;
  banner.classList.remove('hidden');
  txt.textContent = msg;
  txt.className = isError ? 'text-rose-400 font-medium' : 'text-slate-300';
}

function resetAll() {
  ytRecords = [];
  igRecords = [];
  loadedBadges = [];
  document.getElementById('loaded-files-badges').innerHTML = '';
  document.getElementById('status-banner').classList.add('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

// Parse Tar buffer (from decompressed .tgz)
function extractFilesFromTarBuffer(uint8) {
  const files = [];
  let offset = 0;
  const decoder = new TextDecoder('utf-8');

  while (offset + 512 <= uint8.length) {
    const header = uint8.subarray(offset, offset + 512);
    let isZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) { isZero = false; break; }
    }
    if (isZero) break;

    let name = decoder.decode(header.subarray(0, 100)).replace(/\0+$/, '');
    const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0+$/, '');
    if (prefix) name = prefix + '/' + name;

    const sizeOctal = decoder.decode(header.subarray(124, 136)).replace(/\0+$/, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const typeFlag = header[156];

    offset += 512;
    if (size > 0 && (typeFlag === 48 || typeFlag === 0)) {
      const contentBytes = uint8.subarray(offset, offset + size);
      if (name.endsWith('.html') || name.endsWith('.json')) {
        files.push({
          name,
          text: decoder.decode(contentBytes)
        });
      }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

// Stream-decompress .tgz/.gz with a strict byte ceiling to prevent gzip-bomb tab crashes
function gunzipWithLimit(uint8, maxBytes) {
  const inflator = new pako.Inflate();
  const chunks = [];
  let total = 0;

  inflator.onData = chunk => {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`Decompressed archive exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)} MB safety limit.`);
    }
    chunks.push(new Uint8Array(chunk));
  };

  const CHUNK_SIZE = 64 * 1024;
  for (let offset = 0; offset < uint8.byteLength; offset += CHUNK_SIZE) {
    const slice = uint8.subarray(offset, Math.min(offset + CHUNK_SIZE, uint8.byteLength));
    const isLast = (offset + CHUNK_SIZE) >= uint8.byteLength;
    inflator.push(slice, isLast);
    if (inflator.err) {
      throw new Error(inflator.msg || 'Gzip decompression error');
    }
  }

  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  for (const file of fileList) {
    if (file.size > MAX_ARCHIVE_BYTES) {
      setStatus(
        `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 250 MB in-browser safety limit. Please extract and drop watch-history.html or videos_watched.json directly.`,
        true
      );
      return;
    }
  }

  setStatus('Reading and extracting uploaded files locally in your browser...');

  for (const file of fileList) {
    const fname = file.name.toLowerCase();
    try {
      if (fname.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);
        for (const [relPath, entry] of Object.entries(zip.files)) {
          if (entry.dir) continue;
          const lowPath = relPath.toLowerCase();
          if (
            lowPath.endsWith('watch-history.html') ||
            lowPath.endsWith('watch-history.json') ||
            lowPath.endsWith('videos_watched.json') ||
            lowPath.endsWith('posts_viewed.json') ||
            lowPath.endsWith('ads_viewed.json')
          ) {
            const txt = await entry.async('string');
            processExtractedFile(lowPath, txt);
          }
        }
      } else if (fname.endsWith('.tgz') || fname.endsWith('.tar.gz') || fname.endsWith('.gz')) {
        const buf = await file.arrayBuffer();
        const decompressed = gunzipWithLimit(new Uint8Array(buf), MAX_ARCHIVE_BYTES * 2);
        const tarFiles = extractFilesFromTarBuffer(decompressed);
        for (const tf of tarFiles) {
          const lowPath = tf.name.toLowerCase();
          if (
            lowPath.endsWith('watch-history.html') ||
            lowPath.endsWith('watch-history.json') ||
            lowPath.endsWith('videos_watched.json') ||
            lowPath.endsWith('posts_viewed.json') ||
            lowPath.endsWith('ads_viewed.json')
          ) {
            processExtractedFile(lowPath, tf.text);
          }
        }
      } else if (fname.endsWith('.html') || fname.endsWith('.json')) {
        const txt = await file.text();
        processExtractedFile(fname, txt);
      }
    } catch (err) {
      console.error('Error parsing file:', file.name, err);
      setStatus(`Error reading ${file.name}: ${err.message}`, true);
      return;
    }
  }

  finalizeAndRender();
}

function processExtractedFile(path, text) {
  if (path.endsWith('watch-history.html')) {
    const countBefore = ytRecords.length;
    parseYouTubeHTML(text);
    const added = ytRecords.length - countBefore;
    if (added > 0) addBadge(`YouTube HTML (${added.toLocaleString()} videos)`, 'bg-rose-500/15 text-rose-400 border-rose-500/30');
  } else if (path.endsWith('watch-history.json')) {
    const countBefore = ytRecords.length;
    parseYouTubeJSON(text);
    const added = ytRecords.length - countBefore;
    if (added > 0) addBadge(`YouTube JSON (${added.toLocaleString()} videos)`, 'bg-rose-500/15 text-rose-400 border-rose-500/30');
  } else if (path.endsWith('videos_watched.json')) {
    const added = parseInstagramJSON(text, 'Reel');
    if (added > 0) addBadge(`Instagram Reels (${added.toLocaleString()} watched)`, 'bg-purple-500/15 text-purple-400 border-purple-500/30');
  } else if (path.endsWith('posts_viewed.json')) {
    const added = parseInstagramJSON(text, 'Post');
    if (added > 0) addBadge(`Instagram Posts (${added.toLocaleString()} viewed)`, 'bg-purple-500/15 text-purple-400 border-purple-500/30');
  } else if (path.endsWith('ads_viewed.json')) {
    const added = parseInstagramJSON(text, 'Ad');
    if (added > 0) addBadge(`Instagram Ads (${added.toLocaleString()} viewed)`, 'bg-purple-500/15 text-purple-400 border-purple-500/30');
  } else if (path.endsWith('.json')) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data) && data.length > 0 && data[0].titleUrl && data[0].time) {
        const countBefore = ytRecords.length;
        parseYouTubeJSON(text);
        addBadge(`YouTube JSON (${(ytRecords.length - countBefore).toLocaleString()} videos)`, 'bg-rose-500/15 text-rose-400 border-rose-500/30');
      } else if (Array.isArray(data) && data.length > 0 && data[0].label_values) {
        const added = parseInstagramJSON(text, 'Reel');
        addBadge(`Instagram Log (${added.toLocaleString()} items)`, 'bg-purple-500/15 text-purple-400 border-purple-500/30');
      }
    } catch (e) {}
  }
}

function decodeEntities(str) {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function parseYouTubeHTML(htmlText) {
  const cells = htmlText.split('<div class="outer-cell');
  const urlRegex = /Watched\s+<a href="([^"]+)">([^<]+)<\/a>/;
  const chanRegex = /<\/a><br><a href="([^"]+)">([^<]+)<\/a><br>([^<]+)<br>/;
  const fallbackDtRegex = /<\/a><br>([^<]+)<br><\/div>/;

  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i];
    const mUrl = urlRegex.exec(cell);
    if (!mUrl) continue;
    const url = mUrl[1];
    const title = decodeEntities(mUrl[2]);
    let chanName = 'Unknown';
    let dtStr = '';
    const mChan = chanRegex.exec(cell);
    if (mChan) {
      chanName = decodeEntities(mChan[2]);
      dtStr = mChan[3].trim();
    } else {
      const mDt = fallbackDtRegex.exec(cell);
      if (mDt) dtStr = mDt[1].trim();
    }
    const cleanDt = dtStr.replace(/\u202f/g, ' ').replace(/\s+[A-Z]{2,5}([+-]\d+)?$/, '');
    const parsedMs = Date.parse(cleanDt);
    if (isNaN(parsedMs)) continue;

    const isMusic = url.includes('music.youtube.com') || cell.includes('>YouTube Music<');
    ytRecords.push({
      url,
      title,
      channel: chanName,
      dt: new Date(parsedMs),
      isMusic
    });
  }
}

function parseYouTubeJSON(jsonText) {
  const arr = JSON.parse(jsonText);
  for (const item of arr) {
    if (!item.titleUrl || !item.time) continue;
    const title = (item.title || '').replace(/^Watched\s+/, '');
    const chanName = (item.subtitles && item.subtitles[0] && item.subtitles[0].name) ? item.subtitles[0].name : 'Unknown';
    const dt = new Date(item.time);
    if (isNaN(dt.getTime())) continue;
    const isMusic = item.header === 'YouTube Music' || item.titleUrl.includes('music.youtube.com');
    ytRecords.push({
      url: item.titleUrl,
      title,
      channel: chanName,
      dt,
      isMusic
    });
  }
}

function parseInstagramJSON(jsonText, defaultKind) {
  let data = JSON.parse(jsonText);
  if (!Array.isArray(data) && typeof data === 'object') {
    const firstArr = Object.values(data).find(v => Array.isArray(v));
    if (firstArr) data = firstArr;
  }
  if (!Array.isArray(data)) return 0;

  let count = 0;
  for (const x of data) {
    let ts = x.timestamp;
    let owner = 'Unknown';
    let url = '';

    if (x.string_map_data) {
      const tObj = x.string_map_data['Time'] || Object.values(x.string_map_data).find(v => v && v.timestamp);
      if (tObj) ts = tObj.timestamp;
      const aObj = x.string_map_data['Author'];
      if (aObj && aObj.value) owner = '@' + aObj.value;
    } else if (Array.isArray(x.label_values)) {
      for (const lv of x.label_values) {
        if (lv.label === 'URL' && lv.value) url = lv.value;
        if (lv.title === 'Owner' && Array.isArray(lv.dict)) {
          for (const sub of lv.dict) {
            if (Array.isArray(sub.dict)) {
              for (const s2 of sub.dict) {
                if (s2.label === 'Username' && s2.value) owner = '@' + s2.value;
                else if (s2.label === 'Name' && s2.value && owner === 'Unknown') owner = s2.value;
              }
            }
          }
        }
      }
    }

    if (!ts) continue;
    igRecords.push({
      dt: new Date(ts * 1000),
      kind: defaultKind,
      owner,
      url
    });
    count++;
  }
  return count;
}

function finalizeAndRender() {
  if (ytRecords.length === 0 && igRecords.length === 0) {
    setStatus('No valid YouTube or Instagram watch records found in the uploaded file(s). Make sure you upload watch-history.html/.json or videos_watched.json.', true);
    return;
  }

  // Sort & compute deltas for YouTube (aligned identically with Python scripts)
  ytRecords.sort((a, b) => a.dt - b.dt);
  for (let i = 0; i < ytRecords.length; i++) {
    const nd = (i + 1 < ytRecords.length) ? (ytRecords[i + 1].dt - ytRecords[i].dt) / 1000 : null;
    const pd = (i > 0) ? (ytRecords[i].dt - ytRecords[i - 1].dt) / 1000 : null;
    ytRecords[i].nextDelta = nd;
    ytRecords[i].prevDelta = pd;

    const tLow = ytRecords[i].title.toLowerCase();
    const hasHashtag = tLow.includes('#') || tLow.includes('shorts') || ytRecords[i].url.includes('/shorts/');
    const rapidNext = (nd !== null && nd <= 90);
    const rapidPrev = (pd !== null && pd <= 90);

    if (ytRecords[i].isMusic) {
      ytRecords[i].type = 'Music';
      ytRecords[i].estSec = (nd !== null && nd > 0 && nd <= 420) ? Math.max(5, nd) : 210;
    } else if (hasHashtag || rapidNext || (rapidPrev && (nd === null || nd <= 180))) {
      ytRecords[i].type = 'Short';
      ytRecords[i].estSec = (nd !== null && nd > 0 && nd <= 120) ? Math.max(2, nd) : 28;
    } else {
      ytRecords[i].type = 'Long Video';
      ytRecords[i].estSec = (nd !== null && nd > 0 && nd <= 1800) ? Math.max(15, nd) : 480;
    }
  }

  // Sort & compute deltas for Instagram
  igRecords.sort((a, b) => a.dt - b.dt);
  for (let i = 0; i < igRecords.length; i++) {
    const nd = (i + 1 < igRecords.length) ? (igRecords[i + 1].dt - igRecords[i].dt) / 1000 : null;
    igRecords[i].nextDelta = nd;
    if (igRecords[i].kind === 'Reel') {
      igRecords[i].estSec = (nd !== null && nd > 0 && nd <= 90) ? Math.max(3, nd) : 22;
    } else {
      igRecords[i].estSec = (nd !== null && nd > 0 && nd <= 45) ? Math.max(2, nd) : 8;
    }
  }

  setStatus(`Loaded ${ytRecords.length.toLocaleString()} YouTube records & ${igRecords.length.toLocaleString()} Instagram records. 100% processed locally in your browser.`);
  document.getElementById('dashboard').classList.remove('hidden');
  setPeriod(7);
  setMetric('count');
}

function setPeriod(days) {
  selectedDays = days;
  const map = { 7: 'btn-7d', 30: 'btn-30d', 0: 'btn-all' };
  Object.entries(map).forEach(([d, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (Number(d) === days) {
      btn.className = 'px-3 py-1.5 text-xs font-semibold rounded-md bg-rose-500 text-white transition';
    } else {
      btn.className = 'px-3 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-white transition';
    }
  });
  updateDashboard();
}

function setMetric(m) {
  chartMetric = m;
  ['count', 'time'].forEach(id => {
    const btn = document.getElementById('metric-' + id);
    if (!btn) return;
    if (id === m) {
      btn.className = 'px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-500 text-white';
    } else {
      btn.className = 'px-2.5 py-1 text-xs font-medium rounded-md text-slate-400 hover:text-white';
    }
  });
  updateDashboard();
}

function formatDateKey(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function updateDashboard() {
  const allDates = [...ytRecords.map(r => r.dt), ...igRecords.map(r => r.dt)];
  if (allDates.length === 0) return;
  const maxDt = new Date(Math.max(...allDates));
  const minDtAll = new Date(Math.min(...allDates));

  let cutoffDt = minDtAll;
  let daysSpan = Math.max(1, Math.round((maxDt - minDtAll) / (1000 * 3600 * 24)) + 1);

  if (selectedDays > 0) {
    cutoffDt = new Date(maxDt.getFullYear(), maxDt.getMonth(), maxDt.getDate() - (selectedDays - 1), 0, 0, 0);
    daysSpan = selectedDays;
  }

  const ytSub = ytRecords.filter(r => r.dt >= cutoffDt);
  const igSub = igRecords.filter(r => r.dt >= cutoffDt);

  document.getElementById('dash-subtitle').textContent =
    `Showing ${daysSpan} days (${cutoffDt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${maxDt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}) • ${ytSub.length.toLocaleString()} YouTube events & ${igSub.length.toLocaleString()} Instagram events`;

  const ytShorts = ytSub.filter(r => r.type === 'Short');
  const ytLong = ytSub.filter(r => r.type === 'Long Video');
  const ytMusic = ytSub.filter(r => r.type === 'Music');
  const igReels = igSub.filter(r => r.kind === 'Reel');

  const ytShortsSec = ytShorts.reduce((s, r) => s + r.estSec, 0);
  const ytLongSec = ytLong.reduce((s, r) => s + r.estSec, 0);
  const ytMusicSec = ytMusic.reduce((s, r) => s + r.estSec, 0);
  const igTotalSec = igSub.reduce((s, r) => s + r.estSec, 0);
  const igReelSec = igReels.reduce((s, r) => s + r.estSec, 0);

  const sfCount = ytShorts.length + igReels.length;
  const sfSec = ytShortsSec + igReelSec;
  const grandTotalSec = ytShortsSec + ytLongSec + ytMusicSec + igTotalSec;

  // Update KPI Cards
  document.getElementById('kpi-sf-cnt').textContent = sfCount.toLocaleString();
  document.getElementById('kpi-sf-day').textContent = `(${(sfCount / daysSpan).toFixed(1)} / day)`;
  document.getElementById('kpi-sf-time').textContent = `~${(sfSec / 3600).toFixed(1)} hrs (${(sfSec / 60 / daysSpan).toFixed(1)}m/day)`;

  document.getElementById('kpi-ig-cnt').textContent = `${igReels.length.toLocaleString()} Reels`;
  document.getElementById('kpi-ig-day').textContent = `(${(igReels.length / daysSpan).toFixed(1)} / day)`;
  document.getElementById('kpi-ig-time').textContent = `~${(igTotalSec / 3600).toFixed(1)} hrs (${(igTotalSec / 60 / daysSpan).toFixed(1)}m/day)`;

  document.getElementById('kpi-yts-cnt').textContent = `${ytShorts.length.toLocaleString()} Shorts`;
  document.getElementById('kpi-yts-day').textContent = `(${(ytShorts.length / daysSpan).toFixed(1)} / day)`;
  document.getElementById('kpi-yts-time').textContent = `~${(ytShortsSec / 3600).toFixed(1)} hrs (${(ytShortsSec / 60 / daysSpan).toFixed(1)}m/day)`;

  const dailyTotMin = Math.round((grandTotalSec / 60) / daysSpan);
  const dHrs = Math.floor(dailyTotMin / 60);
  const dMins = dailyTotMin % 60;
  document.getElementById('kpi-tot-time').textContent = `~${(grandTotalSec / 3600).toFixed(1)} hrs`;
  document.getElementById('kpi-tot-day').textContent = `(${dHrs}h ${dMins}m / day)`;
  document.getElementById('kpi-long-time').textContent = `~${((ytLongSec + ytMusicSec) / 3600).toFixed(1)} hrs (${ytLong.length} vids)`;

  // Attention Span Diagnostics — dynamically computed from YouTube Shorts OR Instagram Reels
  const ytShortDeltas = ytShorts
    .filter(r => r.nextDelta !== null && r.nextDelta >= 0 && r.nextDelta <= 90)
    .map(r => r.nextDelta)
    .sort((a, b) => a - b);

  const igReelDeltas = igReels
    .filter(r => r.nextDelta !== null && r.nextDelta > 0 && r.nextDelta <= 90)
    .map(r => r.nextDelta)
    .sort((a, b) => a - b);

  const activeDeltas = ytShortDeltas.length > 0 ? ytShortDeltas : igReelDeltas;
  const activeSourceLabel = ytShortDeltas.length > 0 ? 'consecutive Short swipes' : 'consecutive IG Reel intervals';

  if (activeDeltas.length > 0) {
    const med = activeDeltas[Math.floor(activeDeltas.length / 2)];
    const u5 = activeDeltas.filter(x => x <= 5).length;
    const u10 = activeDeltas.filter(x => x <= 10).length;
    const u15 = activeDeltas.filter(x => x <= 15).length;
    const u30 = activeDeltas.filter(x => x <= 30).length;
    const n = activeDeltas.length;

    document.getElementById('diag-median-short').textContent = `${med.toFixed(1)} seconds`;
    document.getElementById('diag-short-sub').innerHTML =
      `<strong>${((u10 / n) * 100).toFixed(1)}%</strong> next-view gap ≤10s; <strong>${((u30 / n) * 100).toFixed(1)}%</strong> ≤30s.`;

    document.getElementById('dwell-sample-size').textContent = `${n.toLocaleString()} ${activeSourceLabel}`;
    const p5 = ((u5 / n) * 100).toFixed(1);
    const p10 = (((u10 - u5) / n) * 100).toFixed(1);
    const p15 = (((u15 - u10) / n) * 100).toFixed(1);
    const p30 = (((u30 - u15) / n) * 100).toFixed(1);
    const pFull = (((n - u30) / n) * 100).toFixed(1);

    document.getElementById('dwell-bar').innerHTML = `
      <div style="width:${p5}%" class="bg-rose-600 flex items-center justify-center overflow-hidden" title="≤5s gap: ${p5}%">≤5s (${Math.round(p5)}%)</div>
      <div style="width:${p10}%" class="bg-orange-500 flex items-center justify-center overflow-hidden" title="6-10s gap: ${p10}%">6–10s (${Math.round(p10)}%)</div>
      <div style="width:${p15}%" class="bg-amber-500 flex items-center justify-center overflow-hidden" title="11-15s gap: ${p15}%">11–15s (${Math.round(p15)}%)</div>
      <div style="width:${p30}%" class="bg-blue-500 flex items-center justify-center overflow-hidden" title="16-30s gap: ${p30}%">16–30s (${Math.round(p30)}%)</div>
      <div style="width:${pFull}%" class="bg-emerald-500 flex items-center justify-center overflow-hidden" title=">30s gap: ${pFull}%">&gt;30s (${Math.round(pFull)}%)</div>
    `;
  } else {
    document.getElementById('diag-median-short').textContent = `N/A`;
    document.getElementById('diag-short-sub').textContent = `Not enough consecutive short-form timestamps in this window.`;
    document.getElementById('dwell-sample-size').textContent = `0 swipes analyzed`;
    document.getElementById('dwell-bar').innerHTML = '';
  }

  // Long-form gap analysis (labelled accurately as gap to next video)
  const longDeltas = ytLong
    .filter(r => r.nextDelta !== null && r.nextDelta >= 0 && r.nextDelta <= 1800)
    .map(r => r.nextDelta)
    .sort((a, b) => a - b);
  if (longDeltas.length > 0) {
    const gap5m = longDeltas.filter(x => x <= 300).length;
    const medL = longDeltas[Math.floor(longDeltas.length / 2)];
    document.getElementById('diag-long-bail').textContent = `${((gap5m / longDeltas.length) * 100).toFixed(1)}% < 5 mins`;
    document.getElementById('diag-long-sub').innerHTML =
      `Median gap before starting next video (within 30m): <strong>${Math.floor(medL / 60)}m ${Math.round(medL % 60)}s</strong>.`;
  } else {
    document.getElementById('diag-long-bail').textContent = `N/A`;
    document.getElementById('diag-long-sub').textContent = `Upload YouTube history to measure intervals between full videos.`;
  }

  // Merge all events for App Switches, Late-Night, and Binge Sessions
  const combined = [
    ...ytSub.map(r => ({ dt: r.dt, platform: 'YouTube', kind: r.type, title: r.title, estSec: r.estSec })),
    ...igSub.map(r => ({ dt: r.dt, platform: 'Instagram', kind: 'IG ' + r.kind, title: r.owner, estSec: r.estSec }))
  ].sort((a, b) => a.dt - b.dt);

  let switches = 0;
  let fastestSwitch = 9999;
  for (let i = 1; i < combined.length; i++) {
    if (combined[i].platform !== combined[i - 1].platform) {
      const gap = (combined[i].dt - combined[i - 1].dt) / 1000;
      if (gap <= 900) {
        switches++;
        if (gap > 0 && gap < fastestSwitch) fastestSwitch = gap;
      }
    }
  }
  document.getElementById('diag-pingpong').textContent = `${switches} App Switches`;
  document.getElementById('diag-pingpong-sub').innerHTML = switches > 0
    ? `Cross-app transitions within 15m (fastest switch: <strong>${Math.round(fastestSwitch)}s</strong>).`
    : `Upload both YouTube & Instagram files to detect cross-app transitions.`;

  const lateNight = combined.filter(e => [23, 0, 1, 2, 3, 4].includes(e.dt.getHours()));
  const lnPct = combined.length > 0 ? ((lateNight.length / combined.length) * 100).toFixed(1) : '0.0';
  document.getElementById('diag-latenight').textContent = `${lnPct}% Late Night`;
  document.getElementById('diag-latenight-sub').innerHTML =
    `<strong>${lateNight.length.toLocaleString()} views</strong> started between 11 PM and 5 AM.`;

  // Render Daily Chart (up to last 30 days of selected window)
  const chartDays = Math.min(daysSpan, 30);
  const dailyData = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date(maxDt.getFullYear(), maxDt.getMonth(), maxDt.getDate() - i);
    const key = formatDateKey(d);
    dailyData.push({
      key,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      igReels: 0, igPosts: 0, igMin: 0,
      ytShorts: 0, ytShortsMin: 0,
      ytLong: 0, ytLongMin: 0,
      ytMusic: 0, ytMusicMin: 0
    });
  }
  const dayMap = Object.fromEntries(dailyData.map(d => [d.key, d]));
  for (const r of ytSub) {
    const k = formatDateKey(r.dt);
    if (!dayMap[k]) continue;
    if (r.type === 'Short') { dayMap[k].ytShorts++; dayMap[k].ytShortsMin += r.estSec / 60; }
    else if (r.type === 'Long Video') { dayMap[k].ytLong++; dayMap[k].ytLongMin += r.estSec / 60; }
    else { dayMap[k].ytMusic++; dayMap[k].ytMusicMin += r.estSec / 60; }
  }
  for (const r of igSub) {
    const k = formatDateKey(r.dt);
    if (!dayMap[k]) continue;
    if (r.kind === 'Reel') dayMap[k].igReels++;
    else dayMap[k].igPosts++;
    dayMap[k].igMin += r.estSec / 60;
  }

  renderDailyBars(dailyData);
  renderHourlyBars(ytShorts, igReels);
  renderBingeSessions(combined);
  renderTopCreators(igReels, ytShorts, ytLong);
}

function renderDailyBars(dailyData) {
  const container = document.getElementById('daily-chart');
  container.innerHTML = '';
  const maxVal = Math.max(...dailyData.map(d =>
    chartMetric === 'count'
      ? (d.igReels + d.ytShorts + d.ytLong + d.ytMusic)
      : (d.igMin + d.ytShortsMin + d.ytLongMin + d.ytMusicMin)
  ), 1);

  dailyData.forEach(d => {
    const igV = chartMetric === 'count' ? d.igReels : d.igMin;
    const ysV = chartMetric === 'count' ? d.ytShorts : d.ytShortsMin;
    const ylV = chartMetric === 'count' ? d.ytLong : d.ytLongMin;
    const ymV = chartMetric === 'count' ? d.ytMusic : d.ytMusicMin;

    const col = document.createElement('div');
    col.className = 'flex-1 flex flex-col justify-end items-center h-full group cursor-pointer';
    col.addEventListener('mouseenter', () => {
      const totM = (d.igMin + d.ytShortsMin + d.ytLongMin + d.ytMusicMin).toFixed(1);
      document.getElementById('daily-tooltip').innerHTML =
        `<strong>${esc(d.label)}:</strong> ` +
        `<span class="text-purple-400 font-semibold">${d.igReels} IG Reels (+${d.igPosts} Posts, ${d.igMin.toFixed(1)}m)</span> • ` +
        `<span class="text-rose-400 font-semibold">${d.ytShorts} YT Shorts (${d.ytShortsMin.toFixed(1)}m)</span> • ` +
        `<span class="text-blue-400 font-semibold">${d.ytLong} Full Vids (${d.ytLongMin.toFixed(1)}m)</span> — Total: <strong>${totM} mins</strong>`;
    });

    const wrap = document.createElement('div');
    wrap.className = 'w-full max-w-[36px] flex flex-col justify-end h-full rounded-t overflow-hidden group-hover:opacity-80 transition';

    const addSeg = (val, cls) => {
      if (val <= 0) return;
      const seg = document.createElement('div');
      seg.style.height = `${(val / maxVal) * 100}%`;
      seg.className = `w-full ${cls}`;
      wrap.appendChild(seg);
    };
    addSeg(ymV, 'bg-emerald-500');
    addSeg(ylV, 'bg-blue-500');
    addSeg(ysV, 'bg-rose-500');
    addSeg(igV, 'bg-purple-500');

    col.appendChild(wrap);
    if (dailyData.length <= 10) {
      const lbl = document.createElement('span');
      lbl.className = 'text-xs text-slate-400 mt-1 truncate';
      lbl.textContent = d.label;
      col.appendChild(lbl);
    }
    container.appendChild(col);
  });
}

function renderHourlyBars(ytShorts, igReels) {
  const container = document.getElementById('hourly-chart');
  container.innerHTML = '';
  const hYT = Array(24).fill(0);
  const hIG = Array(24).fill(0);
  ytShorts.forEach(r => hYT[r.dt.getHours()]++);
  igReels.forEach(r => hIG[r.dt.getHours()]++);

  const maxH = Math.max(...hYT.map((v, i) => v + hIG[i]), 1);
  for (let hr = 0; hr < 24; hr++) {
    const col = document.createElement('div');
    col.className = 'flex-1 flex flex-col justify-end items-center h-full';
    col.title = `${hr}:00 — ${hIG[hr]} IG Reels, ${hYT[hr]} YT Shorts`;

    const wrap = document.createElement('div');
    wrap.className = 'w-full flex flex-col justify-end h-full rounded-t overflow-hidden';

    if (hYT[hr] > 0) {
      const b = document.createElement('div');
      b.style.height = `${Math.max((hYT[hr] / maxH) * 100, 3)}%`;
      b.className = 'w-full bg-rose-500';
      wrap.appendChild(b);
    }
    if (hIG[hr] > 0) {
      const b = document.createElement('div');
      b.style.height = `${Math.max((hIG[hr] / maxH) * 100, 3)}%`;
      b.className = 'w-full bg-purple-500';
      wrap.appendChild(b);
    }
    col.appendChild(wrap);
    container.appendChild(col);
  }
}

function renderBingeSessions(combined) {
  const listEl = document.getElementById('binge-list');
  listEl.innerHTML = '';
  if (combined.length === 0) return;

  const sessions = [];
  let cur = [combined[0]];
  for (let i = 1; i < combined.length; i++) {
    const gap = (combined[i].dt - cur[cur.length - 1].dt) / 1000;
    if (gap <= 300) cur.push(combined[i]);
    else { sessions.push(cur); cur = [combined[i]]; }
  }
  sessions.push(cur);

  sessions.sort((a, b) => b.length - a.length);
  sessions.slice(0, 4).forEach(s => {
    const durMin = Math.max(1, ((s[s.length - 1].dt - s[0].dt) / 1000 + s[s.length - 1].estSec) / 60);
    const startStr = s[0].dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const endStr = s[s.length - 1].dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const rate = (s.length / durMin).toFixed(1);
    const mainPlat = s.filter(x => x.platform === 'Instagram').length > s.length / 2 ? 'Instagram' : 'YouTube';
    const badgeColor = mainPlat === 'Instagram' ? 'text-purple-400' : 'text-rose-400';

    const li = document.createElement('li');
    li.className = 'flex items-center justify-between p-2.5 rounded-lg bg-[#0d0f16] border border-[#222634]';
    li.innerHTML = `
      <div>
        <span class="font-semibold ${badgeColor}">${s.length} items in ${durMin.toFixed(1)} mins (${esc(mainPlat)})</span>
        <div class="text-slate-400">${esc(startStr)} → ${esc(endStr)}</div>
      </div>
      <span class="font-mono font-semibold text-slate-200">${esc(rate)} / min</span>
    `;
    listEl.appendChild(li);
  });
}

function topCounts(arr, keyFn, limit = 6) {
  const counts = {};
  arr.forEach(x => {
    const k = keyFn(x);
    if (!k || k === 'Unknown') return;
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function renderTopCreators(igReels, ytShorts, ytLong) {
  const fill = (elId, items, unit) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (items.length === 0) {
      el.innerHTML = `<li class="text-slate-500">No data in this window</li>`;
      return;
    }
    el.innerHTML = items.map(([name, cnt]) =>
      `<li class="flex items-center justify-between py-1 border-b border-[#222634]">
        <span class="truncate pr-2 text-slate-200">${esc(name)}</span>
        <span class="font-semibold text-slate-400">${Number(cnt)} ${esc(unit)}</span>
      </li>`
    ).join('');
  };

  fill('top-ig-creators', topCounts(igReels, r => r.owner), 'Reels');
  fill('top-yt-shorts', topCounts(ytShorts, r => r.channel), 'Shorts');
  fill('top-yt-long', topCounts(ytLong, r => r.channel), 'vids');
}

function loadDemoData() {
  resetAll();
  const now = new Date(2026, 9, 17, 20, 0, 0);
  const sampleYTChans = ['Fireship', 'Marques Brownlee', 'Cleo Abram', 'Veritasium', 'TED-Ed', 'Daily Dose Of Internet'];
  const sampleLongChans = ['3Blue1Brown', 'Lex Fridman', 'Andrej Karpathy', 'Two Minute Papers', 'Computerphile'];
  const sampleIGOwners = ['@mkbhd', '@natgeo', '@nasa', '@designmilk', '@mit_csail', '@wired'];

  for (let d = 29; d >= 0; d--) {
    const dayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    let t = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 6, 15, 0);
    for (let i = 0; i < 18; i++) {
      t = new Date(t.getTime() + (8 + (i * 7) % 32) * 1000);
      ytRecords.push({ url: 'https://youtube.com/shorts/demo', title: 'Demo Short #shorts', channel: sampleYTChans[i % sampleYTChans.length], dt: t, isMusic: false });
    }
    t = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 16, 10, 0);
    for (let i = 0; i < 28; i++) {
      t = new Date(t.getTime() + (5 + (i * 11) % 38) * 1000);
      ytRecords.push({ url: 'https://youtube.com/shorts/demo', title: 'Afternoon Short #shorts', channel: sampleYTChans[(i + 2) % sampleYTChans.length], dt: t, isMusic: false });
    }
    for (let i = 0; i < 12; i++) {
      t = new Date(t.getTime() + (180 + (i * 95) % 420) * 1000);
      ytRecords.push({ url: 'https://youtube.com/watch?v=demo', title: 'Deep Dive Architecture Tutorial', channel: sampleLongChans[i % sampleLongChans.length], dt: t, isMusic: false });
    }
    if (d < 7) {
      let igT = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 14, 0, 0);
      for (let j = 0; j < 44; j++) {
        igT = new Date(igT.getTime() + (10 + (j * 9) % 28) * 1000);
        igRecords.push({ dt: igT, kind: 'Reel', owner: sampleIGOwners[j % sampleIGOwners.length], url: '' });
      }
      for (let j = 0; j < 19; j++) {
        igT = new Date(igT.getTime() + 12 * 1000);
        igRecords.push({ dt: igT, kind: 'Post', owner: sampleIGOwners[j % sampleIGOwners.length], url: '' });
      }
    }
  }
  addBadge('Demo YouTube Dataset (30 Days)', 'bg-rose-500/15 text-rose-400 border-rose-500/30');
  addBadge('Demo Instagram Dataset (7 Days)', 'bg-purple-500/15 text-purple-400 border-purple-500/30');
  finalizeAndRender();
}

// Wire up all DOM event listeners without inline handlers so script-src 'self' CSP works strictly
window.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => handleFiles(e.target.files));

    ['dragenter', 'dragover'].forEach(evt => {
      dropzone.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('drop-active');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drop-active');
      });
    });
    dropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  document.getElementById('btn-demo')?.addEventListener('click', loadDemoData);
  document.getElementById('btn-guide')?.addEventListener('click', toggleGuideModal);
  document.getElementById('btn-close-guide')?.addEventListener('click', toggleGuideModal);
  document.getElementById('btn-reset')?.addEventListener('click', resetAll);

  document.getElementById('btn-7d')?.addEventListener('click', () => setPeriod(7));
  document.getElementById('btn-30d')?.addEventListener('click', () => setPeriod(30));
  document.getElementById('btn-all')?.addEventListener('click', () => setPeriod(0));

  document.getElementById('metric-count')?.addEventListener('click', () => setMetric('count'));
  document.getElementById('metric-time')?.addEventListener('click', () => setMetric('time'));
});
