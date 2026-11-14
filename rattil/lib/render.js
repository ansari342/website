// Draws the recitation video one frame at a time on a 1080x1920 canvas:
// black background, Arabic in white, English in grey, and a thin white
// line animation under each ayah that echoes what it is about.
// No faces, people or animals: symbolic line motifs only.

import { arabicDigits } from "./arabic.js";
import { drawScene } from "./scenes.js";

export const W = 1080, H = 1920, FPS = 30;
const AR_FONT = '"Rattil Arabic"', EN_FONT = '"DM Sans"';
const LEAD = 0.35, XF = 0.45, AY = 1150; // text leads the voice; crossfade; animation top

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const easeOut = (x) => 1 - (1 - clamp(x)) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;

const canvas = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
};

export function headerLabel(name) {
  return ("Surah " + name).toUpperCase().split(" ").map((w) => w.split("").join(" ")).join("   ");
}

function wrapLines(ctx, text, maxW) {
  const lines = []; let cur = "";
  for (const w of text.split(" ")) {
    const t = cur ? cur + " " + w : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  return cur ? [...lines, cur] : lines;
}

// One image per screen: the Arabic of its ayahs, then their English.
// Each ayah gets a line of its own at the largest size that fits (down to
// 64px); longer ayahs wrap, and very long ones shrink until the block fits.
function textBlock(su, ayahs) {
  const meas = canvas(10, 10).getContext("2d");
  // A no-break space keeps the end-of-ayah ornament with the last word.
  const texts = ayahs.map((a) => su.ar[a] + "\u00A0\u06DD" + arabicDigits(a + 1));
  const arWrap = (size) => { meas.direction = "rtl"; meas.font = `${size}px ${AR_FONT}`; return texts.map((t) => wrapLines(meas, t, 920)); };
  const enWrap = (size) => { meas.direction = "ltr"; meas.font = `400 ${size}px ${EN_FONT}`; return ayahs.map((a) => wrapLines(meas, su.en[a], 860)); };
  const height = (ar, size, en, enSize) => ar.flat().length * size * 1.7 + 50 + en.flat().length * enSize * 1.4;

  let size = 96, enSize = 38, arLines, enLines;
  // First choice: every ayah on one line.
  for (; size >= 64; size -= 4) { arLines = arWrap(size); if (arLines.every((l) => l.length === 1)) break; }
  if (size < 64) size = 64;
  // Otherwise wrap, shrinking until it fits above the animation (760px) or,
  // for the longest ayahs, the whole screen below the header (1450px).
  for (;;) {
    arLines = arWrap(size); enLines = enWrap(enSize);
    const h = height(arLines, size, enLines, enSize);
    if (h <= 760 || (size <= 56 && h <= 1450) || (size <= 36 && enSize <= 26)) break;
    if (size > 56 || h > 1450) size -= 4;
    if (size < 64 && enSize > 26) enSize -= 2;
    if (size < 36) size = 36;
  }
  const arStep = size * 1.7, enStep = enSize * 1.4;
  const arH = arLines.flat().length * arStep, enH = enLines.flat().length * enStep;
  const c = canvas(W, Math.ceil(arH + 50 + enH + 20));
  const g = c.getContext("2d");
  g.textAlign = "center"; g.textBaseline = "middle";
  g.direction = "rtl"; g.fillStyle = "#FFFFFF"; g.font = `${size}px ${AR_FONT}`;
  let y = arStep / 2;
  for (const l of arLines.flat()) { g.fillText(l, W / 2, y); y += arStep; }
  g.direction = "ltr"; g.fillStyle = "#A6A6A6"; g.font = `400 ${enSize}px ${EN_FONT}`;
  y = arH + 50 + enStep / 2;
  for (const l of enLines.flat()) { g.fillText(l, W / 2, y); y += enStep; }
  // Same block with brighter English, for drawing over footage.
  const light = canvas(c.width, c.height), lg2 = light.getContext("2d");
  lg2.drawImage(c, 0, 0, c.width, Math.ceil(arH + 50), 0, 0, c.width, Math.ceil(arH + 50));
  lg2.textAlign = "center"; lg2.textBaseline = "middle"; lg2.direction = "ltr";
  lg2.fillStyle = "#E6E6E6"; lg2.font = `400 ${enSize}px ${EN_FONT}`;
  y = arH + 50 + enStep / 2;
  for (const l of enLines.flat()) { lg2.fillText(l, W / 2, y); y += enStep; }
  return { img: c, light, arH, h: c.height };
}

// ---------------- scenes: each draws in a 1080x560 box, t = seconds on screen ----------------

function stroke(g, w = 3, a = 1) {
  g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = `rgba(255,255,255,${a})`;
}
// Stroke the current path drawn up to fraction p of `len` pixels.
function partial(g, p, len = 4000) {
  if (p <= 0) { g.beginPath(); return; }
  g.setLineDash([len * p, len * 2]); g.stroke(); g.setLineDash([]);
}
function dot(g, x, y, r = 5, a = 1) { g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }

const SCENES = {
  streams(g, t) { // abundance, rivers: streams flowing
    for (let k = 0; k < 7; k++) {
      const off = k - 3, p = easeOut((t - (off ? 1 + Math.abs(off) * 0.35 : 0)) / 1.3);
      if (p <= 0) continue;
      const y0 = 280 + off * 38, amp = 26 - Math.abs(off) * 5;
      g.beginPath(); g.moveTo(170, y0);
      for (let x = 170; x <= 910; x += 6) {
        const u = (x - 170) / 740;
        g.lineTo(x, y0 + Math.sin(u * 4 * Math.PI - t * 2.2 + off * 0.5) * amp * Math.sin(Math.PI * u) ** 0.6);
      }
      stroke(g, off ? 2.2 : 3.2, 1 - Math.abs(off) * 0.22); partial(g, p, 900);
    }
  },
  rain(g, t) { // rain reviving dry ground
    const ground = 460;
    g.beginPath(); g.moveTo(540 - 340 * easeOut(t / 0.8), ground); g.lineTo(540 + 340 * easeOut(t / 0.8), ground); stroke(g, 2, 0.6); g.stroke();
    for (let k = 0; k < 14; k++) {
      const x = 240 + k * 46, ph = (t * 0.9 + k * 0.37) % 1.6;
      if (t < 0.6 + k * 0.08) continue;
      const y = lerp(40, ground - 12, ph / 1.6);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 22); stroke(g, 2, 0.75); g.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const p = easeOut((t - 2.4 - k * 0.3) / 1.4); if (p <= 0) continue;
      const x = 300 + k * 96, h = 70 + (k % 3) * 22;
      g.beginPath(); g.moveTo(x, ground); g.quadraticCurveTo(x - 6, ground - h * 0.5 * p, x, ground - h * p); stroke(g, 2.6); g.stroke();
      if (p > 0.6) { const q = (p - 0.6) / 0.4; g.beginPath(); g.moveTo(x, ground - h * 0.7); g.quadraticCurveTo(x + 24 * q, ground - h * 0.85, x + 30 * q, ground - h * 0.95); stroke(g, 2); g.stroke(); }
    }
  },
  light(g, t) { // revelation, mercy: light descending
    const x = 540, top = 20, bottom = 380;
    const p = easeOut(t / 1.4);
    g.beginPath(); g.moveTo(x, top); g.lineTo(x, lerp(top, bottom, p)); stroke(g, 3); g.stroke();
    if (p >= 1) {
      dot(g, x, bottom, 6 + Math.sin(t * 3) * 1.5);
      for (let k = 0; k < 7; k++) {
        const q = easeOut((t - 1.4 - k * 0.12) / 1), a = (k - 3) * 0.32;
        if (q <= 0) continue;
        g.beginPath(); g.moveTo(x + Math.sin(a) * 30, bottom + Math.cos(a) * 30); g.lineTo(x + Math.sin(a) * (30 + 110 * q), bottom + Math.cos(a) * (30 + 110 * q));
        stroke(g, 2, 0.5); g.stroke();
      }
    }
  },
  paths(g, t) { // guidance: a straight path to the light, a wandering one that never arrives
    const sx = 200, sy = 460, ex = 860, ey = 120;
    dot(g, sx, sy, 6);
    const p = easeOut((t - 0.4) / 2);
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(lerp(sx, ex, p), lerp(sy, ey, p)); stroke(g, 3.2); g.stroke();
    if (p >= 1) dot(g, ex, ey, 9 + Math.sin(t * 3) * 2);
    const q = easeOut((t - 0.8) / 3);
    g.beginPath(); g.moveTo(sx, sy);
    for (let u = 0; u <= q; u += 0.01) g.lineTo(sx + u * 520, sy - u * 120 + Math.sin(u * 14) * 60 * u);
    stroke(g, 2, 0.45); g.stroke();
  },
  scales(g, t) { // justice, reckoning: scales settling level
    const cx = 540, top = 120, base = 470;
    const a = easeOut(t / 0.8);
    g.beginPath(); g.moveTo(cx, base); g.lineTo(cx, lerp(base, top, a)); g.moveTo(cx - 90 * a, base); g.lineTo(cx + 90 * a, base); stroke(g, 3); g.stroke();
    if (t < 0.8) return;
    const tilt = 0.28 * Math.exp(-(t - 0.8) * 0.9) * Math.cos((t - 0.8) * 3);
    const arm = 260 * easeOut((t - 0.8) / 0.6);
    const lx = cx - Math.cos(tilt) * arm, ly = top + Math.sin(tilt) * arm, rx = cx + Math.cos(tilt) * arm, ry = top - Math.sin(tilt) * arm;
    g.beginPath(); g.moveTo(lx, ly); g.lineTo(rx, ry); stroke(g, 3); g.stroke();
    for (const [x, y] of [[lx, ly], [rx, ry]]) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 60, y + 140); g.moveTo(x, y); g.lineTo(x + 60, y + 140);
      g.moveTo(x - 75, y + 140); g.quadraticCurveTo(x, y + 190, x + 75, y + 140); stroke(g, 2, 0.8); g.stroke();
    }
    dot(g, cx, top, 6);
  },
  tree(g, t) { // reward, gardens: seed to tree with fruit
    const ground = 500;
    g.beginPath(); g.moveTo(540 - 260 * easeOut(t / 0.7), ground); g.lineTo(540 + 260 * easeOut(t / 0.7), ground); stroke(g, 2, 0.6); g.stroke();
    dot(g, 540, ground - 6, 5 * (1 - easeOut((t - 0.6) / 0.5)) + 0.01);
    const grow = (x, y, ang, len, depth, start) => {
      const p = easeOut((t - start) / 0.9); if (p <= 0) return;
      const x2 = x + Math.cos(ang) * len * p, y2 = y - Math.sin(ang) * len * p;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); stroke(g, 1 + depth * 0.8); g.stroke();
      if (p < 1) return;
      if (depth > 0) { grow(x2, y2, ang + 0.45, len * 0.72, depth - 1, start + 0.7); grow(x2, y2, ang - 0.45, len * 0.72, depth - 1, start + 0.7); }
      else { const f = easeOut((t - start - 1) / 0.6); if (f > 0) dot(g, x2, y2, 5 * f); }
    };
    grow(540, ground, Math.PI / 2, 150, 4, 0.6);
  },
  ripples(g, t) { // a call going out: rings from a point
    dot(g, 540, 280, 6 * easeOut(t / 0.5));
    for (let k = 0; k < 5; k++) {
      let ph = t - 0.4 - k * 0.8; if (ph <= 0) continue; ph %= 4;
      g.beginPath(); g.arc(540, 280, 14 + ph * 62, 0, Math.PI * 2); stroke(g, 1.8, clamp(1 - ph / 4) * 0.8); g.stroke();
    }
  },
  sunrise(g, t) { // dawn, the day: the sun rising over a horizon
    const hy = 400, r = 120;
    g.beginPath(); g.moveTo(540 - 380 * easeOut(t / 0.8), hy); g.lineTo(540 + 380 * easeOut(t / 0.8), hy); stroke(g, 2, 0.7); g.stroke();
    const rise = easeOut((t - 0.5) / 3) * 150;
    g.save(); g.beginPath(); g.rect(0, 0, W, hy); g.clip();
    g.beginPath(); g.arc(540, hy + r - rise, r, 0, Math.PI * 2); stroke(g, 3); g.stroke();
    for (let k = 0; k < 9; k++) {
      const q = easeOut((t - 2 - k * 0.1) / 0.8), a = Math.PI + (k + 1) * Math.PI / 10;
      if (q <= 0) continue;
      const cy = hy + r - rise;
      g.beginPath(); g.moveTo(540 + Math.cos(a) * (r + 20), cy + Math.sin(a) * (r + 20)); g.lineTo(540 + Math.cos(a) * (r + 20 + 70 * q), cy + Math.sin(a) * (r + 20 + 70 * q));
      stroke(g, 2, 0.6); g.stroke();
    }
    g.restore();
  },
  stars(g, t) { // night, the heavens: stars appear, a crescent draws
    for (let k = 0; k < 22; k++) {
      const x = 140 + ((k * 397) % 800), y = 40 + ((k * 263) % 440), a = easeOut((t - k * 0.12) / 0.6);
      if (a > 0) dot(g, x, y, 2.5, a * (0.55 + 0.45 * Math.sin(t * 2 + k)));
    }
    const p = easeOut((t - 1.2) / 1.6);
    g.beginPath(); g.arc(540, 280, 110, Math.PI * 0.6, Math.PI * 0.6 + Math.PI * 1.6 * p); stroke(g, 3); g.stroke();
    if (p > 0) { g.beginPath(); g.arc(585, 250, 95, Math.PI * 0.62, Math.PI * 0.62 + Math.PI * 1.45 * p); stroke(g, 3); g.stroke(); }
  },
  pen(g, t) { // the pen, the book: a nib writing lines right to left
    for (let k = 0; k < 3; k++) {
      const p = easeOut((t - 0.4 - k * 1.3) / 1.2); if (p <= 0) continue;
      const y = 200 + k * 90;
      g.beginPath();
      for (let u = 0; u <= p; u += 0.005) { const x = 880 - u * 680; g[u ? "lineTo" : "moveTo"](x, y + Math.sin(u * 38) * 9 * Math.sin(u * 5 + k)); }
      stroke(g, 2.4, 0.85); g.stroke();
    }
    const k = Math.min(2, Math.floor(Math.max(0, t - 0.4) / 1.3)), p = easeOut((t - 0.4 - k * 1.3) / 1.2);
    const x = 880 - p * 680, y = 200 + k * 90 - 10;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 40, y - 120); g.lineTo(x + 70, y - 105); g.closePath();
    g.moveTo(x, y); g.lineTo(x + 30, y - 70); stroke(g, 2.6); g.stroke();
  },
  infinity(g, t) { // what never ends: a lemniscate and a travelling point
    const pt = (u) => { const s = Math.sin(u), c = Math.cos(u), d = 1 + s * s; return [540 + 300 * c / d, 280 + 300 * s * c / d]; };
    const p = easeOut(t / 2);
    g.beginPath();
    for (let u = 0; u <= Math.PI * 2 * p; u += 0.02) { const [x, y] = pt(u); g[u ? "lineTo" : "moveTo"](x, y); }
    stroke(g, 3); g.stroke();
    if (p >= 1) { const [x, y] = pt(t * 1.2); dot(g, x, y, 8); }
  },
  upright(g, t) { // steadfastness: an upright line, rings from its top
    const cx = 540, base = 470, top = 150;
    const a = easeOut(t / 0.8);
    g.beginPath(); g.moveTo(cx - 220 * a, base); g.lineTo(cx + 220 * a, base); stroke(g, 2, 0.6); g.stroke();
    const p = easeOut((t - 0.4) / 1.4);
    if (p > 0) { g.beginPath(); g.moveTo(cx, base); g.lineTo(cx, lerp(base, top, p)); stroke(g, 4); g.stroke(); }
    for (let k = 0; k < 4; k++) {
      let ph = t - 2 - k * 0.9; if (ph <= 0) continue; ph %= 3.6;
      g.beginPath(); g.arc(cx, top, 10 + ph * 75, 0, Math.PI * 2); stroke(g, 1.6, clamp(1 - ph / 3.6) * 0.7); g.stroke();
    }
  },
  fade(g, t) { // what passes away: shapes that shrink and fade to one point
    for (let k = 0; k < 6; k++) {
      const x = 260 + k * 112, y = 280 + Math.sin(k * 1.7) * 80;
      const inA = easeOut((t - k * 0.2) / 0.6), out = ease((t - 2 - k * 0.35) / 1.2);
      const r = 46 * (1 - out) * inA;
      if (r > 0.5) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); stroke(g, 2.4, (1 - out) * inA); g.stroke(); }
    }
    const last = easeOut((t - 4) / 0.8); if (last > 0) dot(g, 540, 280, 5, last);
  },
  niche(g, t) { // prayer: a prayer niche, light descending to the place of prayer
    const cx = 540, base = 480;
    g.beginPath(); g.moveTo(cx - 320, base); g.lineTo(cx + 320, base); stroke(g, 2, 0.6); partial(g, easeOut(t / 0.7), 700);
    g.beginPath(); g.moveTo(cx - 150, base); g.lineTo(cx - 150, 230); g.quadraticCurveTo(cx - 150, 120, cx, 40); g.quadraticCurveTo(cx + 150, 120, cx + 150, 230); g.lineTo(cx + 150, base);
    stroke(g, 3); partial(g, easeOut((t - 0.3) / 2), 1300);
    const p = easeOut((t - 2.2) / 1);
    if (p > 0) { g.beginPath(); g.moveTo(cx, 90); g.lineTo(cx, lerp(90, base - 20, p)); stroke(g, 2, 0.8); g.stroke(); }
    if (p >= 1) dot(g, cx, base - 14, 6 + Math.sin(t * 3));
  },
  calm(g, t) { // the heart at peace: a tangle settles into a circle
    const s = ease((t - 0.6) / 2.2);
    g.beginPath();
    for (let u = 0; u <= 1.0001; u += 0.004) {
      const a = u * Math.PI * 2 * 5, r = 120 + (1 - s) * (Math.sin(u * 37) * 50 + Math.sin(u * 11 + 1) * 40);
      const x = 540 + Math.cos(a / 5 + (1 - s) * Math.sin(a) * 0.8) * r, y = 280 + Math.sin(a / 5 + (1 - s) * Math.cos(a * 0.7) * 0.8) * r;
      g[u ? "lineTo" : "moveTo"](x, y);
    }
    stroke(g, 2.4, 0.9); partial(g, easeOut(t / 0.8), 9000);
    if (s >= 1) for (let k = 0; k < 5; k++) {
      const q = easeOut((t - 2.9 - k * 0.15) / 0.8); if (q <= 0) continue;
      const x = 380 + k * 80; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 70 * q); stroke(g, 1.6, 0.5); g.stroke();
    }
  },
};

const KEYWORDS = {
  rain: ["rain", "revive", "dead earth", "lifeless", "sprout", "vegetation", "crops", "cloud"],
  streams: ["river", "rivers", "water", "abundance", "kawthar", "flow", "spring", "fountain", "sea", "drink"],
  light: ["light", "reveal", "sent down", "mercy", "merciful", "lamp", "glow"],
  paths: ["path", "way", "guide", "guided", "guidance", "astray", "straight", "stray", "lost", "misguid"],
  scales: ["weigh", "scale", "balance", "justice", "just", "measure", "deeds", "account", "judgement", "recompense", "reckon"],
  tree: ["tree", "garden", "fruit", "grow", "paradise", "reward", "seed", "grain", "palm", "harvest"],
  sunrise: ["dawn", "morning", "sun", "daybreak", "forenoon", "brightness", "day"],
  stars: ["night", "star", "sky", "heaven", "moon", "constellation", "darkness"],
  pen: ["pen", "write", "written", "book", "record", "scripture", "inscribe", "recite", "read", "qur'an"],
  infinity: ["eternal", "forever", "abide", "everlasting", "uninterrupted", "endless", "eternity", "never end"],
  upright: ["character", "firm", "steadfast", "patient", "patience", "upright", "establish", "stand"],
  fade: ["perish", "destroy", "die", "death", "cut off", "ruin", "vanish", "scattered", "crushed", "loss", "fire"],
  niche: ["pray", "prostrat", "worship", "sacrifice", "bow"],
  calm: ["heart", "peace", "tranquil", "doubt", "mind", "madman", "whisper", "refuge", "fear"],
};
const DEFAULTS = ["ripples", "streams", "light", "stars", "calm"];

// Pick a motif for each screen from the words of its English translation.
export function chooseScenes(texts) {
  const out = [];
  texts.forEach((text, i) => {
    const s = " " + text.toLowerCase().replace(/[^a-z' ]/g, " ") + " ";
    let best = null, score = 0;
    for (const [name, keys] of Object.entries(KEYWORDS)) {
      let n = 0;
      for (const k of keys) if (s.includes(" " + k)) n += k.length > 4 ? 1.2 : 1;
      if (name === out[i - 1]) n *= 0.6; // vary consecutive screens
      if (n > score) { score = n; best = name; }
    }
    if (!best) best = DEFAULTS.find((d) => d !== out[i - 1] && !out.slice(-3).includes(d)) || DEFAULTS[i % DEFAULTS.length];
    out.push(best);
  });
  return out;
}

// Draw a video frame to fill the 9:16 canvas (cropping the sides or top).
export function drawCover(ctx, video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = Math.max(W / vw, H / vh), w = vw * s, h = vh * s;
  ctx.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
}

// plan: { surah: {name, ar, en}, units: [{ start, ayahs }], duration,
//         style: "animation" | "overlay", video: <video> for the overlay style,
//         scenes: { [0-based ayah]: scene } designed per ayah (see scenes.js) }
// Ayahs without a designed scene use the built-in motifs.
// In the overlay style the person's footage is the background, darkened so
// the text stays readable, and the line animations are left out.
export function createRenderer(plan) {
  const overlay = plan.style === "overlay" && plan.video;
  const blocks = plan.units.map((u) => textBlock(plan.surah, u.ayahs));
  const scenes = chooseScenes(plan.units.map((u) => u.ayahs.map((a) => plan.surah.en[a]).join(" "))).map((n) => SCENES[n]);
  const label = headerLabel(plan.surah.name);
  const layer = canvas(W, 560), lg = layer.getContext("2d");
  // Darkening for the overlay style: an even layer, stronger behind the text.
  const scrim = canvas(W, H), sg = scrim.getContext("2d");
  sg.fillStyle = "rgba(0,0,0,0.38)"; sg.fillRect(0, 0, W, H);
  const grad = sg.createLinearGradient(0, 180, 0, 1400);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(0.2, "rgba(0,0,0,0.42)"); grad.addColorStop(0.75, "rgba(0,0,0,0.42)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  sg.fillStyle = grad; sg.fillRect(0, 0, W, H);

  function weight(i, t) {
    const start = plan.units[i].start - LEAD;
    const end = i + 1 < plan.units.length ? plan.units[i + 1].start - LEAD : plan.duration + 1;
    return clamp((t - start) / XF) * (1 - clamp((t - end) / XF));
  }

  return {
    scenes: scenes.map((f) => Object.keys(SCENES).find((k) => SCENES[k] === f)),
    draw(ctx, t) {
      ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      if (overlay) { drawCover(ctx, plan.video); ctx.drawImage(scrim, 0, 0); }
      ctx.globalAlpha = ease(t / 0.8);
      ctx.fillStyle = overlay ? "#C8C8C8" : "#6E6E6E"; ctx.font = `400 28px ${EN_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = "ltr";
      ctx.fillText(label, W / 2, 300);
      for (let i = 0; i < blocks.length; i++) {
        const a = weight(i, t);
        if (a <= 0) continue;
        const b = blocks[i], dy = (1 - ease(a)) * 14;
        // Arabic centred on y=640 when it fits; taller blocks stay between the header and the animation.
        let top = 640 - b.arH / 2;
        top = Math.max(370, Math.min(top, 1120 - b.h));
        ctx.globalAlpha = a; ctx.drawImage(overlay ? b.light : b.img, 0, top + dy);
        if (overlay) continue;
        // The animation sits under the text; the longest ayahs fill the screen and go without one.
        const sceneTop = Math.max(AY, top + b.h + 30);
        if (sceneTop > H - 420) continue;
        lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalAlpha = 1; lg.clearRect(0, 0, W, 560);
        const designed = plan.scenes?.[plan.units[i].ayahs[0]];
        const since = t - (plan.units[i].start - LEAD);
        if (designed) {
          const len = (i + 1 < plan.units.length ? plan.units[i + 1].start : plan.duration) - plan.units[i].start;
          drawScene(lg, designed, since, len);
        } else scenes[i](lg, since);
        ctx.drawImage(layer, 0, sceneTop);
      }
      ctx.globalAlpha = 1;
    },
  };
}
