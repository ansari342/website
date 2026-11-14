// Rattil: recitation clip in, vertical video out. Everything runs on the
// visitor's device: the speech model in a worker, the video via WebCodecs.

import { breathGroups, toMono16k } from "./lib/audio.js";
import { buildIndex, matchRecitation } from "./lib/match.js";
import { createRenderer, W, H } from "./lib/render.js";
import { encode } from "./lib/encode.js";
import { readAac, extractAac } from "./lib/extract.js";
import { cleanScene } from "./lib/scenes.js";
import { arabicDigits } from "./lib/arabic.js";

const $ = (id) => document.getElementById(id);

// Show any unexpected error on the page, so a failure is never silent.
function showError(message) {
  const a = $("alert");
  a.textContent = `Something went wrong: ${message}`;
  a.hidden = false;
}
window.addEventListener("error", (e) => showError(e.message || "unknown error"));
window.addEventListener("unhandledrejection", (e) => showError(e.reason?.message || String(e.reason)));
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const state = { quran: null, index: null, buffer: null, groups: [], segments: [], result: null, renderer: null, file: null, video: null, hasVideo: false, style: "animation", aac: null, scenes: null, sceneKey: "" };

// Signed in (allowlisted) visitors get AI-designed animations; everyone else
// gets the built-in ones. Making videos needs no account.
const signedIn = fetch("/api/google/me").then((r) => r.json()).then((d) => d.email || null).catch(() => null);
signedIn.then((email) => {
  const a = $("account");
  if (email) { a.textContent = "Sign out"; a.href = "/api/google/logout"; a.title = email; }
});

const quranReady = fetch("data/quran.json").then((r) => r.json()).then((q) => { state.quran = q; fillSurahs(); return q; });
const fontsReady = Promise.all([document.fonts.load('96px "Rattil Arabic"', "بِسۡمِ"), document.fonts.load('38px "DM Sans"', "In")]);

// ---------- upload ----------
const drop = $("drop");
$("file").addEventListener("change", (e) => e.target.files[0] && start(e.target.files[0]));
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); e.dataTransfer.files[0] && start(e.dataTransfer.files[0]); });

const STEPS = ["Reading the audio", "Finding the reciter's pauses", "Loading the Quran recognition model", "Listening", "Matching to the Quran text"];
function setStep(i, note = "") {
  $("progress").innerHTML = STEPS.map((s, k) => `<li class="${k < i ? "done" : k === i ? "now" : ""}">${s}</li>`).join("");
  $("listen-note").textContent = note;
}
const setBar = (f) => ($("bar").style.width = `${Math.round(f * 100)}%`);

async function start(file) {
  state.file = file;
  $("alert").hidden = true;
  for (const id of ["step-review", "step-video"]) $(id).hidden = true;
  $("download").hidden = $("share").hidden = true;
  $("file-info").textContent = `${file.name} · ${(file.size / 1e6).toFixed(1)} MB`;
  $("step-listen").hidden = false;
  loadVideo(file);
  setStep(0); setBar(0);
  try {
    const bytes = await file.arrayBuffer();
    state.buffer = await decodeAudio(bytes);
    // The recording's own AAC frames, copied into the video unchanged (MP4/MOV/M4A).
    state.aac = await readAac(bytes).catch(() => null);
  } catch (err) {
    setStep(0, "This file's audio could not be read. Try an MP4, MOV, M4A, MP3 or WAV file.");
    showError(`couldn't read the audio (${err?.message || err || "unsupported format"})`);
    return;
  }
  if (state.buffer.duration > 600) { setStep(0, "Please use a clip under 10 minutes."); return; }
  $("file-info").textContent += ` · ${fmt(state.buffer.duration)}`;

  setStep(1);
  const mono = await to16k(state.buffer);
  state.groups = breathGroups(mono, 16000);
  if (!state.groups.length) { setStep(1, "No recitation was heard in this file."); return; }
  await quranReady;
  listen(mono);
}

// Keep the upload as a <video> too, for the over-my-video style.
function loadVideo(file) {
  if (state.video) { URL.revokeObjectURL(state.video.src); state.video.remove(); }
  const v = Object.assign(document.createElement("video"), { muted: true, playsInline: true, preload: "auto" });
  v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
  v.hidden = true; document.body.append(v);
  state.video = v; state.hasVideo = false;
  v.addEventListener("loadedmetadata", () => { state.hasVideo = v.videoWidth > 0; updateStyles(); });
  v.addEventListener("error", () => { state.hasVideo = false; updateStyles(); });
  v.src = URL.createObjectURL(file);
  v.load();
}

// ---------- style ----------
function updateStyles() {
  const overlay = $("style-overlay");
  overlay.disabled = !state.hasVideo;
  $("overlay-note").textContent = state.hasVideo ? "Your footage behind the text" : "Needs a video file, not audio";
  if (!state.hasVideo && state.style === "overlay") setStyle("animation");
}
function setStyle(style) {
  state.style = style;
  document.querySelectorAll(".style").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.style === style)));
  if (state.result) buildVideo();
}
document.querySelectorAll(".style").forEach((b) => b.addEventListener("click", () => !b.disabled && setStyle(b.dataset.style)));

// Decode the file's sound. If the browser refuses the file as a whole (iPhone
// videos with a spatial-audio track, in Safari), copy out just the AAC track
// and decode that.
async function decodeAudio(bytes) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  // Callback form as well as the promise, for older Safari.
  const decode = (b) => new Promise((ok, fail) => { const p = ac.decodeAudioData(b, ok, fail); if (p && p.then) p.then(ok, fail); });
  try {
    return await decode(bytes.slice(0)); // decoding detaches the buffer, so pass a copy
  } catch (first) {
    let m4a;
    try { m4a = await extractAac(bytes); } catch { throw first; }
    return await decode(m4a);
  } finally {
    ac.close?.();
  }
}

// Down-mix and resample with the browser's own filter.
async function to16k(buffer) {
  try {
    const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16000), 16000);
    const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(ctx.destination); src.start();
    return (await ctx.startRendering()).getChannelData(0);
  } catch {
    // Some Safari versions only allow 44.1/48 kHz offline contexts.
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    return toMono16k(chans, buffer.sampleRate);
  }
}

function listen(mono) {
  setStep(2, "About 100 MB the first time; after that it loads from your browser.");
  const worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "download") { setBar(data.loaded / data.total); $("listen-note").textContent = `${(data.loaded / 1e6).toFixed(0)} of ${(data.total / 1e6).toFixed(0)} MB`; }
    else if (data.type === "ready") { setStep(3, `0 of ${state.groups.length} breaths`); setBar(0); }
    else if (data.type === "group") { setBar(data.done / data.total); $("listen-note").textContent = `${data.done} of ${data.total} breaths`; }
    else if (data.type === "done") { worker.terminate(); state.segments = data.segments; recognise(); }
    else if (data.type === "error") failed(data.message);
  };
  // A module worker that can't load its imports fails here rather than posting a message.
  worker.onerror = (e) => { e.preventDefault?.(); failed(e.message); };
  function failed(message) {
    worker.terminate();
    console.warn("Rattil recognition failed:", message);
    state.segments = state.groups.map(([s, e]) => ({ start: s, end: e, text: "" }));
    setStep(3, "The recognition model couldn't load here. Pick the surah and ayahs below and the video will follow the reciter's pauses.");
    showReview(null, true);
  }
  worker.postMessage({ audio: mono, groups: state.groups });
}

function recognise() {
  setStep(4);
  state.index ||= buildIndex(state.quran);
  const r = matchRecitation(state.quran, state.index, state.segments);
  setStep(5);
  showReview(r);
}

// ---------- review ----------
function fillSurahs() {
  $("surah").innerHTML = state.quran.surahs.map((s) => `<option value="${s.n}">${s.n}. ${s.name}</option>`).join("");
  $("surah").addEventListener("change", () => fillAyahs(1, Math.min(7, state.quran.surahs[$("surah").value - 1].ar.length)));
  $("from").addEventListener("change", () => { if (+$("to").value < +$("from").value) $("to").value = $("from").value; });
  fillAyahs(1, 7);
}
function fillAyahs(from, to) {
  const n = state.quran.surahs[$("surah").value - 1].ar.length;
  const opts = Array.from({ length: n }, (_, i) => `<option>${i + 1}</option>`).join("");
  $("from").innerHTML = opts; $("to").innerHTML = opts;
  $("from").value = from; $("to").value = Math.min(to, n);
}

$("apply").addEventListener("click", () => {
  const force = { surah: +$("surah").value, from: +$("from").value, to: +$("to").value };
  if (force.to < force.from) [force.from, force.to] = [force.to, force.from];
  showReview(matchRecitation(state.quran, state.index ||= buildIndex(state.quran), state.segments, force), false, true);
});

function showReview(r, failed = false, manual = false) {
  $("step-review").hidden = false;
  state.result = r;
  if (!r) {
    $("verdict").innerHTML = failed ? "Choose the surah and ayahs that were recited." : "These ayahs couldn't be recognised. Choose the surah and ayahs that were recited.";
    $("screens").innerHTML = ""; $("step-video").hidden = true;
    $("step-review").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const su = state.quran.surahs[r.surah - 1];
  $("surah").value = r.surah; fillAyahs(r.from, r.to);
  const range = r.from === r.to ? `ayah ${r.from}` : `ayahs ${r.from}–${r.to}`;
  const sure = manual ? "" : r.coverage > 0.6 ? " Recognised with good confidence." : " Some words were unclear, so check the range.";
  $("verdict").innerHTML = `${manual ? "Using" : "This sounds like"} <strong>Surah ${su.name}, ${range}</strong>.${sure} If it's wrong, change it below.`;
  $("screens").innerHTML = r.units.map((u) => `<li><span class="t mono">${fmt(u.start)}</span><span class="ar">${u.ayahs.map((a) => su.ar[a] + " \u06DD" + arabicDigits(a + 1)).join(" ")}</span><span class="en">${u.ayahs.map((a) => `${a + 1}. ${su.en[a]}`).join("<br>")}</span></li>`).join("");
  buildVideo();
  designScenes(r);
}

// ---------- per-ayah animations designed by Claude ----------
// A plan for the whole passage, then scenes a few ayahs at a time in
// parallel. Kept in this browser so the same passage is free next time.
async function designScenes(r) {
  const key = `rattil-scenes:v1:${r.surah}:${r.from}-${r.to}`;
  if (state.sceneKey === key && state.scenes) return;
  state.sceneKey = key; state.scenes = null;
  const note = (s) => { if (state.sceneKey === key) $("scene-note").textContent = s; };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  if (saved) return applyScenes(key, saved, note);
  if (!(await signedIn)) {
    $("scene-note").innerHTML = 'Built-in animations. <a href="/rattil/login.html">Sign in</a> for a unique AI-designed animation for every ayah.';
    return;
  }
  note("Designing an animation for each ayah…");
  const call = async (body) => {
    const res = await fetch("/api/rattil-scenes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surah: r.surah, from: r.from, to: r.to, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
    return data;
  };
  try {
    const { plan } = await call({});
    const ns = Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i);
    const chunks = [];
    for (let i = 0; i < ns.length; i += 3) chunks.push(ns.slice(i, i + 3));
    const found = {};
    let done = 0, limitHit = false;
    // At most 4 requests at a time.
    const queue = [...chunks];
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
      while (queue.length) {
        const part = queue.shift();
        try { for (const s of (await call({ plan, ayahs: part })).scenes || []) found[s.ayah] = s; } catch (err) { if (err.status === 429) limitHit = true; }
        done += part.length;
        note(`Designing an animation for each ayah… ${done} of ${ns.length}`);
      }
    }));
    const result = { theme: plan.theme, scenes: found };
    // Save only a complete set, so missing ayahs are retried next time.
    if (Object.keys(found).length === ns.length) { try { localStorage.setItem(key, JSON.stringify(result)); } catch {} }
    applyScenes(key, result, note);
    if (limitHit) note(`${$("scene-note").textContent} Today's AI budget ran out partway; the rest use built-in animations.`);
  } catch (err) {
    const why = err.status === 401 ? "your sign-in has expired; reload to sign in again"
      : err.status === 429 ? `today's $${err.data?.limit ?? 1} AI budget is used up; it resets at midnight Pacific`
      : err.message === "not configured" ? "AI scenes aren't set up on this site yet"
      : `couldn't design scenes: ${err.message}`;
    note(`Using built-in animations (${why}).`);
  }
}

function applyScenes(key, result, note) {
  if (state.sceneKey !== key) return;
  const map = {};
  for (const [n, s] of Object.entries(result.scenes || {})) { const c = cleanScene(s); if (c) map[Number(n) - 1] = c; }
  const count = Object.keys(map).length, total = state.result.to - state.result.from + 1;
  state.scenes = map;
  note(count === total ? "Each ayah has its own animation." : `${count} of ${total} ayahs have their own animation; the rest use built-in ones.`);
  buildVideo();
}

// ---------- preview + export ----------
let playing = null;
async function buildVideo() {
  await fontsReady;
  stopPreview();
  const r = state.result, su = state.quran.surahs[r.surah - 1];
  const overlay = state.style === "overlay" && state.hasVideo;
  if (overlay && state.video.readyState < 2) await new Promise((ok) => { state.video.addEventListener("loadeddata", ok, { once: true }); setTimeout(ok, 3000); });
  state.renderer = createRenderer({ surah: su, units: r.units, duration: state.buffer.duration, style: overlay ? "overlay" : "animation", video: state.video, scenes: state.scenes });
  updateStyles();
  $("step-video").hidden = false;
  $("download").hidden = $("share").hidden = true;
  $("make-note").textContent = `${fmt(state.buffer.duration)} · 1080×1920`;
  const firstText = r.units[0].start + 0.6;
  if (overlay) {
    state.video.currentTime = firstText;
    await new Promise((ok) => { state.video.addEventListener("seeked", ok, { once: true }); setTimeout(ok, 2000); });
  }
  state.renderer.draw($("preview").getContext("2d"), firstText);

}

function stopPreview() {
  if (!playing) return;
  try { playing.src.stop(); } catch {}
  playing.ac.close(); cancelAnimationFrame(playing.raf); playing = null;
  state.video?.pause();
  $("play").textContent = "▶";
}
$("play").addEventListener("click", () => {
  if (playing) return stopPreview();
  const ac = new (window.AudioContext || window.webkitAudioContext)(), src = ac.createBufferSource();
  src.buffer = state.buffer; src.connect(ac.destination);
  const ctx = $("preview").getContext("2d");
  playing = { ac, src, raf: 0 };
  src.onended = stopPreview;
  const overlay = state.style === "overlay" && state.hasVideo;
  if (overlay) {
    // The muted video is the clock; the decoded sound starts with it.
    const v = state.video;
    v.currentTime = 0;
    v.play().then(() => { if (playing) src.start(0, v.currentTime); }).catch(stopPreview);
    const tick = () => { if (!playing) return; state.renderer.draw(ctx, v.currentTime); playing.raf = requestAnimationFrame(tick); };
    tick();
  } else {
    const t0 = ac.currentTime + 0.05; src.start(t0);
    const tick = () => { if (!playing) return; state.renderer.draw(ctx, Math.max(0, ac.currentTime - t0)); playing.raf = requestAnimationFrame(tick); };
    tick();
  }
  $("play").textContent = "❚❚";
});

$("make").addEventListener("click", async () => {
  stopPreview();
  // Created during the tap: Safari only lets an audio context play after one.
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioContext.resume();
  const bar = $("make-bar"), make = $("make");
  make.disabled = true; bar.hidden = false;
  $("make-note").textContent = "Making the video…";
  try {
    const progress = (f) => (bar.firstElementChild.style.width = `${Math.round(f * 100)}%`);
    const overlay = state.style === "overlay" && state.hasVideo;
    const blob = await encode({ renderer: state.renderer, buffer: state.buffer, aac: state.aac, video: overlay ? state.video : null, duration: state.buffer.duration, audioContext }, progress);
    const r = state.result, ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const name = `rattil-${state.quran.surahs[r.surah - 1].name.toLowerCase()}-${r.from}-${r.to}${state.style === "overlay" ? "-overlay" : ""}.${ext}`;
    const a = $("download");
    if (a.href) URL.revokeObjectURL(a.href);
    a.href = URL.createObjectURL(blob); a.download = name; a.hidden = false;
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      $("share").hidden = false;
      $("share").onclick = () => navigator.share({ files: [file] }).catch(() => {});
    }
    $("make-note").textContent = `Ready · ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()}${ext === "webm" ? " (this browser can't make MP4 with sound; Safari, or Chrome on a Mac, Windows or Android, can)" : ""}`;
  } catch (err) {
    $("make-note").textContent = `The video couldn't be made in this browser: ${err.message}`;
  } finally {
    if (audioContext.state !== "closed") audioContext.close().catch(() => {});
    make.disabled = false; bar.hidden = true;
  }
});

// Test hook for automated checks: window.rattil.
window.rattil = { state, W, H };
