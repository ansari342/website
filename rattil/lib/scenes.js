// A small drawing format for per-ayah animations, written by Claude (see
// api/rattil-scenes.js) and drawn here. Thin white line art only: no people,
// faces or animals. Everything is checked and clamped before drawing, so a
// bad scene can't break a video.
//
// Scene: { idea: "one line", elements: [Element, ...] } in a 1080x560 box.
// Element (all optional except type):
//   type: "glyph" | "path" | "circle" | "wave" | "rays" | "ripples" | "particles" | "branch" | "dots"
//   at, dur: when it draws in, as fractions of the ayah's time on screen (0-1)
//   end: fraction at which it fades away (for things that pass, break, vanish)
//   width 1-5, alpha 0.15-1
//   motion: { kind: float|sway|pulse|rise|sink|drift|spin|grow|shrink|flicker, amount 0-1, speed 0.2-3 }
//   glyph:     name (see GLYPHS), x, y, size 20-500, rotate (degrees), flip
//   path:      points [[x,y], ...] (2-16), smooth, closed
//   circle:    x, y, r, from, to (degrees, 0 = right, clockwise)
//   wave:      x0, x1, y, amp, waves, speed
//   rays:      x, y, count, inner, outer, spread (degrees), dir (degrees)
//   ripples:   x, y, count, maxR
//   particles: mode rise|fall|drift|orbit|converge|scatter|twinkle, count, region [x0,y0,x1,y1], size, speed
//   branch:    x, y, len, depth 1-6, dir (degrees, -90 = up), spread (degrees)
//   dots:      points [[x,y], ...] appearing one by one, size

const BW = 1080, BH = 560;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const num = (v, d, a, b) => (typeof v === "number" && isFinite(v) ? clamp(v, a, b) : d);
const easeOut = (x) => 1 - (1 - clamp(x, 0, 1)) ** 3;
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// ---------- glyphs: polylines in a unit box (-1..1), y down ----------
const arc = (cx, cy, r, a0, a1, n = 24, ry = r) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * ry]; });
const quad = (p0, p1, p2, n = 16) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]; });
const PI = Math.PI;

export const GLYPHS = {
  mountain: () => [[[-1, 0.8], [-0.15, -0.75], [0.15, -0.45], [0.45, -0.85], [1, 0.8]]],
  mountains: () => [[[-1, 0.8], [-0.55, -0.2], [-0.25, 0.25], [0.15, -0.8], [0.55, 0.1], [0.75, -0.2], [1, 0.8]]],
  sun: () => [arc(0, 0, 0.5, 0, 2 * PI, 40), ...Array.from({ length: 12 }, (_, i) => { const a = i * PI / 6; return [[Math.cos(a) * 0.68, Math.sin(a) * 0.68], [Math.cos(a) * 0.95, Math.sin(a) * 0.95]]; })],
  crescent: () => [[...arc(0, 0, 0.8, PI * 0.3, PI * 1.7, 36), ...arc(0.32, 0, 0.62, PI * 1.62, PI * 0.38, 30)]],
  star: () => [Array.from({ length: 11 }, (_, i) => { const a = -PI / 2 + i * PI / 5, r = i % 2 ? 0.4 : 1; return [Math.cos(a) * r, Math.sin(a) * r]; })],
  cloud: () => [[...arc(-0.5, 0.15, 0.35, PI * 0.5, PI * 1.5, 12), ...arc(-0.1, -0.15, 0.45, PI, PI * 1.9, 14), ...arc(0.45, 0.05, 0.4, PI * 1.3, PI * 2.5, 14), [-0.5, 0.5]]],
  boat: () => [[[-1, 0.1], [-0.65, 0.55], [0.65, 0.55], [1, 0.1], [-1, 0.1]], [[0, 0.1], [0, -0.95]], [[0, -0.9], [0.6, -0.1], [0, -0.1]]],
  tree: () => [[[0, 1], [0, -0.1]], [[0, 0.3], [-0.45, -0.25]], [[0, 0.15], [0.5, -0.35]], arc(0, -0.45, 0.55, 0, 2 * PI, 36)],
  palm: () => [quad([0, 1], [0.15, 0.2], [0, -0.55]), quad([0, -0.55], [-0.5, -0.85], [-0.95, -0.35]), quad([0, -0.55], [0.5, -0.85], [0.95, -0.35]), quad([0, -0.55], [-0.3, -0.95], [-0.55, -0.95]), quad([0, -0.55], [0.3, -0.95], [0.55, -0.95])],
  seed: () => [[...arc(0, 0.1, 0.28, 0, 2 * PI, 24, 0.4)], quad([0, -0.3], [0.1, -0.6], [0.3, -0.75])],
  sprout: () => [[[0, 1], [0, -0.2]], quad([0, -0.1], [-0.6, -0.3], [-0.7, -0.75]), quad([-0.7, -0.75], [-0.2, -0.65], [0, -0.1]), quad([0, -0.3], [0.5, -0.5], [0.6, -0.9]), quad([0.6, -0.9], [0.15, -0.8], [0, -0.3])],
  flower: () => [[[0, 1], [0, 0]], ...Array.from({ length: 6 }, (_, i) => { const a = i * PI / 3; return arc(Math.cos(a) * 0.32, -0.45 + Math.sin(a) * 0.32, 0.25, 0, 2 * PI, 16); }), arc(0, -0.45, 0.12, 0, 2 * PI, 12)],
  leaf: () => [[...quad([-0.9, 0.6], [-0.4, -0.9], [0.9, -0.6]), ...quad([0.9, -0.6], [0.4, 0.9], [-0.9, 0.6])], [[-0.9, 0.6], [0.6, -0.4]]],
  book: () => [[[0, -0.6], [-0.95, -0.75], [-0.95, 0.65], [0, 0.8], [0.95, 0.65], [0.95, -0.75], [0, -0.6], [0, 0.8]], [[-0.75, -0.4], [-0.2, -0.32]], [[-0.75, -0.1], [-0.2, -0.02]], [[0.2, -0.32], [0.75, -0.4]], [[0.2, -0.02], [0.75, -0.1]]],
  scroll: () => [[[-0.75, -0.8], [0.75, -0.8], [0.75, 0.8], [-0.75, 0.8], [-0.75, -0.8]], arc(-0.75, -0.8, 0.12, 0, 2 * PI, 12), arc(0.75, 0.8, 0.12, 0, 2 * PI, 12), [[-0.45, -0.4], [0.45, -0.4]], [[-0.45, -0.1], [0.45, -0.1]], [[-0.45, 0.2], [0.3, 0.2]]],
  pen: () => [[[0, 1], [-0.3, 0.1], [-0.15, -1], [0.15, -1], [0.3, 0.1], [0, 1]], [[0, 1], [0, 0.25]]],
  scales: () => [[[0, 1], [0, -0.85]], [[-0.4, 1], [0.4, 1]], [[-0.85, -0.7], [0.85, -0.7]], [[-0.85, -0.7], [-1, 0.05]], [[-0.85, -0.7], [-0.7, 0.05]], quad([-1.05, 0.05], [-0.85, 0.35], [-0.65, 0.05]), [[0.85, -0.7], [0.7, 0.05]], [[0.85, -0.7], [1, 0.05]], quad([0.65, 0.05], [0.85, 0.35], [1.05, 0.05])],
  gate: () => [[[-0.7, 1], [-0.7, -0.3], ...arc(0, -0.3, 0.7, PI, 2 * PI, 20), [0.7, 1]], [[-0.45, 1], [-0.45, -0.25], ...arc(0, -0.25, 0.45, PI, 2 * PI, 16), [0.45, 1]]],
  door: () => [[[-0.5, 1], [-0.5, -0.9], [0.5, -0.9], [0.5, 1]], arc(0.3, 0.1, 0.06, 0, 2 * PI, 8)],
  niche: () => [[[-0.6, 1], [-0.6, -0.1], ...quad([-0.6, -0.1], [-0.6, -0.7], [0, -1]), ...quad([0, -1], [0.6, -0.7], [0.6, -0.1]), [0.6, 1]]],
  lamp: () => [[[0, -1], [0, -0.55]], [[-0.35, -0.55], [0.35, -0.55], [0.5, 0.2], ...arc(0, 0.2, 0.5, 0, PI, 16), [-0.35, -0.55]], quad([0, -0.25], [-0.15, 0], [0, 0.12]), quad([0, 0.12], [0.15, 0], [0, -0.25])],
  flame: () => [[...quad([0, 1], [-0.75, 0.4], [-0.2, -0.3]), ...quad([-0.2, -0.3], [0.05, -0.55], [0, -1]), ...quad([0, -1], [0.75, -0.2], [0.45, 0.45]), ...quad([0.45, 0.45], [0.3, 0.9], [0, 1])]],
  wind: () => [[[-1, -0.4], ...quad([-1, -0.4], [0.4, -0.4], [0.5, -0.65]), ...arc(0.3, -0.65, 0.2, 0, -PI * 1.3, 10)], [[-0.8, 0.05], [0.7, 0.05], ...arc(0.7, 0.3, 0.25, -PI / 2, PI * 0.6, 10)], [[-1, 0.5], [0.2, 0.5]]],
  globe: () => [arc(0, 0, 0.9, 0, 2 * PI, 40), arc(0, 0, 0.4, 0, 2 * PI, 30, 0.9), [[-0.9, 0], [0.9, 0]], arc(0, -0.45, 0.78, 0, PI, 20, 0.08).map(([x, y]) => [x, y]).slice(0), arc(0, 0.45, 0.78, 0, PI, 20, 0.08)],
  house: () => [[[-0.75, 1], [-0.75, -0.1], [0, -0.85], [0.75, -0.1], [0.75, 1], [-0.75, 1]], [[-0.2, 1], [-0.2, 0.35], [0.2, 0.35], [0.2, 1]]],
  towers: () => [[[-1, 1], [-1, -0.2], [-0.6, -0.2], [-0.6, -0.8], [-0.2, -0.8], [-0.2, 0.1], [0.2, 0.1], [0.2, -0.55], [0.6, -0.55], [0.6, -0.1], [1, -0.1], [1, 1]]],
  fruit: () => [[...arc(0, 0.15, 0.7, -PI * 0.42, PI * 1.42, 32)], quad([0, -0.45], [0.05, -0.75], [0.25, -0.95])],
  cube: () => [[[-0.7, -0.35], [0, -0.7], [0.7, -0.35], [0.7, 0.55], [0, 0.9], [-0.7, 0.55], [-0.7, -0.35], [0, 0], [0.7, -0.35]], [[0, 0], [0, 0.9]]],
  hourglass: () => [[[-0.6, -1], [0.6, -1]], [[-0.6, 1], [0.6, 1]], [[-0.5, -1], [0, -0.05], [0.5, -1]], [[-0.5, 1], [0, 0.05], [0.5, 1]]],
  staff: () => [[...quad([0.1, 1], [0, 0], [0, -0.75]), ...arc(0.2, -0.75, 0.2, PI, PI * 2.2, 10)]],
  stone: () => [[[-0.7, 0.4], [-0.5, -0.4], [0.1, -0.6], [0.7, -0.2], [0.6, 0.5], [-0.1, 0.6], [-0.7, 0.4]]],
  horn: () => [[[-1, -0.15], ...quad([-1, -0.15], [0.2, -0.2], [0.8, -0.75]), [0.9, 0.55], ...quad([0.8, 0.45], [0.2, 0.15], [-1, 0.15]), [-1, -0.15]]],
  tablet: () => [[[-0.6, 1], [-0.6, -0.55], ...arc(0, -0.55, 0.6, PI, 2 * PI, 16), [0.6, 1], [-0.6, 1]], [[-0.35, -0.3], [0.35, -0.3]], [[-0.35, 0.05], [0.35, 0.05]], [[-0.35, 0.4], [0.35, 0.4]]],
  key: () => [arc(-0.55, 0, 0.35, 0, 2 * PI, 20), [[-0.2, 0], [1, 0]], [[0.7, 0], [0.7, 0.3]], [[0.9, 0], [0.9, 0.3]]],
  well: () => [arc(0, -0.2, 0.75, 0, 2 * PI, 30, 0.22), [[-0.75, -0.2], [-0.75, 0.75]], [[0.75, -0.2], [0.75, 0.75]], arc(0, 0.75, 0.75, 0, PI, 16, 0.22)],
  heart: () => [[...quad([0, 0.9], [-1.1, 0], [-0.55, -0.65]), ...quad([-0.55, -0.65], [-0.1, -0.85], [0, -0.35]), ...quad([0, -0.35], [0.1, -0.85], [0.55, -0.65]), ...quad([0.55, -0.65], [1.1, 0], [0, 0.9])]],
  whirl: () => [arc(0, 0, 0.9, 0, PI * 1.6, 30), arc(0, 0, 0.6, PI * 0.4, PI * 2, 24), arc(0, 0, 0.3, PI, PI * 2.6, 16)],
  chain: () => [0, 1, 2].map((k) => arc(-0.66 + k * 0.66, 0, 0.42, 0, 2 * PI, 20, 0.25)),
  shield: () => [[[-0.7, -0.8], [0.7, -0.8], [0.7, 0], ...quad([0.7, 0], [0.6, 0.65], [0, 1]), ...quad([0, 1], [-0.6, 0.65], [-0.7, 0]), [-0.7, -0.8]]],
  ring: () => [arc(0, 0, 0.85, 0, 2 * PI, 40)],
  seal: () => [arc(0, 0, 0.85, 0, 2 * PI, 40), arc(0, 0, 0.6, 0, 2 * PI, 32), [[-0.3, 0], [0.3, 0]], [[0, -0.3], [0, 0.3]]],
};
export const GLYPH_NAMES = Object.keys(GLYPHS);

// ---------- polyline helpers ----------
function lengthOf(lines) { let L = 0; for (const l of lines) for (let i = 1; i < l.length; i++) L += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return L; }
// Stroke the polylines up to fraction p of their total length.
function strokePartial(g, lines, p) {
  if (p <= 0) return;
  const total = lengthOf(lines); let left = total * clamp(p, 0, 1);
  g.beginPath();
  for (const l of lines) {
    if (left <= 0) break;
    g.moveTo(l[0][0], l[0][1]);
    for (let i = 1; i < l.length && left > 0; i++) {
      const [x0, y0] = l[i - 1], [x1, y1] = l[i], d = Math.hypot(x1 - x0, y1 - y0);
      if (d <= left) { g.lineTo(x1, y1); left -= d; }
      else { const f = left / d; g.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f); left = 0; }
    }
  }
  g.stroke();
}
function smoothPoints(pts, closed) {
  if (pts.length < 3) return pts;
  const out = [], n = pts.length, P = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < 10; k++) {
      const t = k / 10, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(closed ? pts[0] : pts[n - 1]);
  return out;
}
// Deterministic pseudo-random for particles.
const rand = (i, k = 0) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- validation ----------
const TYPES = new Set(["glyph", "path", "circle", "wave", "rays", "ripples", "particles", "branch", "dots"]);
const MOTIONS = new Set(["float", "sway", "pulse", "rise", "sink", "drift", "spin", "grow", "shrink", "flicker"]);
const MODES = new Set(["rise", "fall", "drift", "orbit", "converge", "scatter", "twinkle"]);
const pt = (p) => Array.isArray(p) && p.length >= 2 ? [num(p[0], BW / 2, -100, BW + 100), num(p[1], BH / 2, -100, BH + 100)] : null;

export function cleanScene(scene) {
  if (!scene || !Array.isArray(scene.elements)) return null;
  const elements = [];
  for (const e of scene.elements.slice(0, 16)) {
    if (!e || !TYPES.has(e.type)) continue;
    const c = {
      type: e.type,
      at: num(e.at, 0, 0, 0.95), dur: num(e.dur, 0.25, 0.02, 1),
      end: typeof e.end === "number" ? clamp(e.end, 0.05, 1) : null,
      width: num(e.width, 2.5, 1, 5), alpha: num(e.alpha, 1, 0.15, 1),
      x: num(e.x, BW / 2, -50, BW + 50), y: num(e.y, BH / 2, -50, BH + 50),
    };
    if (e.motion && MOTIONS.has(e.motion.kind)) c.motion = { kind: e.motion.kind, amount: num(e.motion.amount, 0.4, 0, 1), speed: num(e.motion.speed, 1, 0.2, 3) };
    switch (e.type) {
      case "glyph":
        if (!GLYPHS[e.name]) continue;
        Object.assign(c, { name: e.name, size: num(e.size, 160, 20, 500), rotate: num(e.rotate, 0, -360, 360), flip: !!e.flip }); break;
      case "path": case "dots": {
        const pts = (Array.isArray(e.points) ? e.points : []).slice(0, 16).map(pt).filter(Boolean);
        if (pts.length < (e.type === "path" ? 2 : 1)) continue;
        Object.assign(c, { points: pts, smooth: !!e.smooth, closed: !!e.closed, size: num(e.size, 5, 1.5, 14) }); break;
      }
      case "circle": Object.assign(c, { r: num(e.r, 100, 4, 400), from: num(e.from, 0, -720, 720), to: num(e.to, 360, -720, 720) }); break;
      case "wave": Object.assign(c, { x0: num(e.x0, 140, -50, BW + 50), x1: num(e.x1, 940, -50, BW + 50), amp: num(e.amp, 24, 0, 160), waves: num(e.waves, 3, 0.5, 12), speed: num(e.speed, 1, 0, 4) }); break;
      case "rays": Object.assign(c, { count: Math.round(num(e.count, 9, 2, 36)), inner: num(e.inner, 30, 0, 300), outer: num(e.outer, 140, 10, 560), spread: num(e.spread, 180, 5, 360), dir: num(e.dir, 90, -360, 360) }); break;
      case "ripples": Object.assign(c, { count: Math.round(num(e.count, 4, 1, 8)), maxR: num(e.maxR, 240, 20, 560) }); break;
      case "particles": Object.assign(c, { mode: MODES.has(e.mode) ? e.mode : "drift", count: Math.round(num(e.count, 24, 1, 120)), region: Array.isArray(e.region) && e.region.length === 4 ? [num(e.region[0], 0, -50, BW), num(e.region[1], 0, -50, BH), num(e.region[2], BW, 0, BW + 50), num(e.region[3], BH, 0, BH + 50)] : [100, 40, 980, 520], size: num(e.size, 3, 1, 10), speed: num(e.speed, 1, 0.1, 4) }); break;
      case "branch": Object.assign(c, { len: num(e.len, 140, 20, 300), depth: Math.round(num(e.depth, 4, 1, 6)), dir: num(e.dir, -90, -360, 360), spread: num(e.spread, 28, 5, 80) }); break;
    }
    elements.push(c);
  }
  return elements.length ? { idea: String(scene.idea || "").slice(0, 200), elements } : null;
}

// ---------- drawing ----------
// g: 2D context for the 1080x560 box. t: seconds on screen. L: the ayah's
// time on screen in seconds (scene timing is relative to it).
export function drawScene(g, scene, t, L) {
  L = Math.max(3, L);
  for (const e of scene.elements) {
    const start = e.at * L, dur = clamp(e.dur * L, 0.4, 4.5);
    const p = easeOut((t - start) / dur);
    if (p <= 0) continue;
    let a = e.alpha;
    if (e.end !== null) { const fe = e.end * L; a *= 1 - ease((t - fe) / 0.8); if (a <= 0.01) continue; }
    const age = t - start;
    g.save();
    // Motion
    let ox = 0, oy = 0, rot = 0, sc = 1;
    if (e.motion) {
      const { kind, amount: m, speed: s } = e.motion, w = age * s;
      if (kind === "float") oy = Math.sin(w * 1.6) * 14 * m;
      else if (kind === "sway") rot = Math.sin(w * 1.4) * 0.12 * m;
      else if (kind === "pulse") sc = 1 + Math.sin(w * 2.4) * 0.07 * m;
      else if (kind === "rise") oy = -Math.min(age * 22 * s, 260) * m;
      else if (kind === "sink") oy = Math.min(age * 22 * s, 260) * m;
      else if (kind === "drift") ox = Math.min(age * 26 * s, 360) * (m * 2 - 1 || 0.5);
      else if (kind === "spin") rot = w * 0.6 * (m || 0.5);
      else if (kind === "grow") sc = 1 + Math.min(age * 0.12 * s, 0.6) * m;
      else if (kind === "shrink") sc = Math.max(0.05, 1 - Math.min(age * 0.15 * s, 0.95) * m);
      else if (kind === "flicker") a *= 0.65 + 0.35 * Math.sin(w * 9 + Math.sin(w * 3) * 2);
    }
    g.translate(e.x + ox, e.y + oy); g.rotate(rot); g.scale(sc, sc); g.translate(-e.x, -e.y);
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = `rgba(255,255,255,${a})`; g.fillStyle = `rgba(255,255,255,${a})`; g.lineWidth = e.width;
    DRAW[e.type](g, e, p, age, L);
    g.restore();
  }
}

const DRAW = {
  glyph(g, e, p) {
    const s = e.size / 2, r = (e.rotate * PI) / 180, cos = Math.cos(r), sin = Math.sin(r), fx = e.flip ? -1 : 1;
    const lines = GLYPHS[e.name]().map((l) => l.map(([x, y]) => { x *= fx; return [e.x + (x * cos - y * sin) * s, e.y + (x * sin + y * cos) * s]; }));
    strokePartial(g, lines, p);
  },
  path(g, e, p) { strokePartial(g, [e.smooth ? smoothPoints(e.points, e.closed) : e.closed ? [...e.points, e.points[0]] : e.points], p); },
  circle(g, e, p) { strokePartial(g, [arc(e.x, e.y, e.r, (e.from * PI) / 180, (e.to * PI) / 180, 48)], p); },
  wave(g, e, p, age) {
    const pts = [];
    for (let i = 0; i <= 80; i++) { const u = i / 80, x = e.x0 + (e.x1 - e.x0) * u; pts.push([x, e.y + Math.sin(u * e.waves * 2 * PI - age * e.speed * 2) * e.amp * Math.sin(PI * u) ** 0.5]); }
    strokePartial(g, [pts], p);
  },
  rays(g, e, p) {
    const lines = [];
    for (let i = 0; i < e.count; i++) {
      const a = ((e.dir + (e.count > 1 ? (i / (e.count - 1) - 0.5) * e.spread : 0)) * PI) / 180;
      lines.push([[e.x + Math.cos(a) * e.inner, e.y + Math.sin(a) * e.inner], [e.x + Math.cos(a) * (e.inner + (e.outer - e.inner) * p), e.y + Math.sin(a) * (e.inner + (e.outer - e.inner) * p)]]);
    }
    strokePartial(g, lines, 1);
  },
  ripples(g, e, p, age) {
    for (let k = 0; k < e.count; k++) {
      let ph = age - k * 0.7; if (ph <= 0) continue; ph %= e.count * 0.7 + 1;
      const f = ph / (e.count * 0.7 + 1);
      g.globalAlpha = 1 - f; g.beginPath(); g.arc(e.x, e.y, 8 + f * e.maxR, 0, 2 * PI); g.stroke();
    }
    g.globalAlpha = 1;
  },
  particles(g, e, p, age) {
    const [x0, y0, x1, y1] = e.region, w = x1 - x0, h = y1 - y0, n = Math.round(e.count * p);
    for (let i = 0; i < n; i++) {
      const rx = rand(i, 1), ry = rand(i, 2), sp = (0.5 + rand(i, 3)) * e.speed;
      let x = x0 + rx * w, y = y0 + ry * h, al = 1;
      switch (e.mode) {
        case "rise": y = y1 - ((ry * h + age * 40 * sp) % h); al = Math.sin(PI * (y1 - y) / h); break;
        case "fall": y = y0 + ((ry * h + age * 60 * sp) % h); al = Math.sin(PI * (y - y0) / h); break;
        case "drift": x = x0 + ((rx * w + age * 30 * sp) % w); y += Math.sin(age * sp + i) * 10; break;
        case "orbit": { const cx = x0 + w / 2, cy = y0 + h / 2, r = (0.2 + 0.8 * rx) * Math.min(w, h) / 2, a = ry * 2 * PI + age * 0.6 * sp; x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r; break; }
        case "converge": { const cx = x0 + w / 2, cy = y0 + h / 2, f = clamp(age * 0.25 * sp, 0, 1); x = x + (cx - x) * ease(f); y = y + (cy - y) * ease(f); break; }
        case "scatter": { const cx = x0 + w / 2, cy = y0 + h / 2, f = clamp(age * 0.3 * sp, 0, 1); x = cx + (x - cx) * ease(f); y = cy + (y - cy) * ease(f); al = 1 - f * 0.5; break; }
        case "twinkle": al = 0.35 + 0.65 * Math.abs(Math.sin(age * 1.5 * sp + i * 1.7)); break;
      }
      g.globalAlpha = clamp(al, 0, 1); g.beginPath(); g.arc(x, y, e.size * (0.6 + rand(i, 4) * 0.6), 0, 2 * PI); g.fill();
    }
    g.globalAlpha = 1;
  },
  branch(g, e, p) {
    const lines = [];
    const grow = (x, y, ang, len, d) => {
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      lines.push([[x, y], [x2, y2]]);
      if (d > 1) { const s = (e.spread * PI) / 180; grow(x2, y2, ang - s, len * 0.72, d - 1); grow(x2, y2, ang + s, len * 0.72, d - 1); }
    };
    grow(e.x, e.y, (e.dir * PI) / 180, e.len, e.depth);
    // Draw level by level so the tree grows outward.
    strokePartial(g, lines, p);
  },
  dots(g, e, p) {
    const n = e.points.length;
    e.points.forEach(([x, y], i) => { const q = clamp(p * n - i, 0, 1); if (q > 0) { g.beginPath(); g.arc(x, y, e.size * q, 0, 2 * PI); g.fill(); } });
  },
};
