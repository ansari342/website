// "Sky" style: one continuous drawn world behind the text instead of
// separate scenes. Each screen has a "moment" (sky colours, sun, moon,
// stars, nebula, aurora, clouds, mist, rain, a landscape and a camera
// height), and the renderer blends smoothly from one moment to the next, so
// every ayah's background grows out of the one before it. The camera opens
// among the stars and drifts down to the first moment.
//
// The default moments are a journey from night to dawn to blue hour.
// Claude can also design moments for a passage's meaning (see
// worldPrompt in lib/rattil-prompt.js); cleanWorld() checks them.
// Everything is drawn in code: no footage, no people, faces or animals.

const W = 1080, H = 1920;
const WH = 3400, HZ = 2760;       // world height; horizon line in world coords
const TEX_W = 1300, NEB_H = 2500, CW = 3200;
const LAYER_BASE = [60, 230, 420, 600];   // ridge baselines below the horizon, far to near

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hex = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || "").trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };

// ---------- moments ----------
export const LANDS = ["mountains", "hills", "dunes", "mesas", "plain", "sea", "space"];
const NUM = {   // field: [default, min, max]
  sun: [0, 0, 1], sunHeight: [0.05, -0.1, 0.9], moon: [0, 0, 1], stars: [0.3, 0, 1], nebula: [0, 0, 1], nebulaHue: [0, -180, 180],
  aurora: [0, 0, 1], auroraHue: [150, 0, 360], clouds: [0.4, 0, 1], mist: [0.1, 0, 1], rain: [0, 0, 1], altitude: [0.03, 0, 1],
};

const PRESETS = {
  night:  { sky: ["#1a1a38", "#151633", "#0a0d21", "#030309"], stars: 1, nebula: 1, clouds: 0.35, cloudColor: "#29294a", mist: 0.05, land: "mountains", landColor: "#07070f" },
  dawn:   { sky: ["#ffcc85", "#fa945c", "#664d80", "#050512"], sun: 1, sunHeight: -0.02, stars: 0.15, nebula: 0.12, clouds: 0.85, cloudColor: "#ffb394", mist: 0.12, land: "mountains", landColor: "#0f0d14" },
  day:    { sky: ["#d6e4f0", "#a8c8e6", "#4678be", "#193270"], sun: 0.45, sunHeight: 0.4, stars: 0, clouds: 0.8, cloudColor: "#fafaff", mist: 0.15, land: "mountains", landColor: "#202834" },
  golden: { sky: ["#ffc478", "#f0965a", "#966478", "#0c0e22"], sun: 0.9, sunHeight: 0.02, stars: 0.05, nebula: 0.05, clouds: 0.8, cloudColor: "#ffaa78", mist: 0.2, land: "mountains", landColor: "#160f14" },
  blue:   { sky: ["#667899", "#4a5a85", "#0d1229", "#03050f"], stars: 0.55, nebula: 0.3, clouds: 0.55, cloudColor: "#6b7a99", mist: 0.65, land: "mountains", landColor: "#0f1421" },
};
const PATHS = { 1: ["night"], 2: ["night", "dawn"], 3: ["night", "dawn", "blue"], 4: ["night", "dawn", "golden", "blue"] };

// Fill in defaults and keep every value in range. Returns null for junk.
export function cleanMoment(m) {
  if (!m || typeof m !== "object") return null;
  const out = { idea: String(m.idea || "").replace(/\s+/g, " ").slice(0, 200) };
  for (const [k, [d, lo, hi]] of Object.entries(NUM)) out[k] = typeof m[k] === "number" && isFinite(m[k]) ? clamp(m[k], lo, hi) : d;
  const sky = Array.isArray(m.sky) ? m.sky.map(hex) : [];
  out.sky = sky.length === 4 && sky.every(Boolean) ? sky : PRESETS.night.sky.map(hex);
  out.cloudColor = hex(m.cloudColor) || [200, 200, 215];
  out.landColor = hex(m.landColor) || [10, 10, 18];
  out.land = LANDS.includes(m.land) ? m.land : "mountains";
  return out;
}

// world: { frames: [{ ayah, ...moment }] } -> { [ayah]: moment }, or null.
export function cleanWorld(world, from, to) {
  if (!world || !Array.isArray(world.frames)) return null;
  const out = {};
  for (const f of world.frames) {
    const n = Number(f?.ayah);
    if (!(n >= from && n <= to) || out[n]) continue;
    const c = cleanMoment(f);
    if (c) out[n] = c;
  }
  return Object.keys(out).length ? out : null;
}

// Blend two cleaned moments; the landscape blends as a pair of types.
function mixMoment(A, B, f) {
  const m = { idea: f < 0.5 ? A.idea : B.idea };
  for (const k of Object.keys(NUM)) m[k] = lerp(A[k], B[k], f);
  m.sky = A.sky.map((c, i) => mixC(c, B.sky[i], f));
  m.cloudColor = mixC(A.cloudColor, B.cloudColor, f);
  m.landColor = mixC(A.landColor, B.landColor, f);
  m.lands = { a: A.land, b: B.land, f };
  m.land = f < 0.5 ? A.land : B.land;
  return m;
}

// The default journey for n screens: night -> dawn -> (day -> golden) -> blue.
export function defaultMoments(n) {
  const path = (PATHS[n] || ["night", "dawn", "day", "golden", "blue"]).map((k) => cleanMoment(PRESETS[k]));
  return Array.from({ length: n }, (_, i) => {
    const p = n === 1 ? 0 : (i * (path.length - 1)) / (n - 1), k = Math.min(Math.floor(p), path.length - 2);
    return path.length === 1 ? path[0] : mixMoment(path[k], path[k + 1], p - k);
  });
}

// For the prompt: the field list with ranges.
export const MOMENT_FIELDS = Object.entries(NUM).map(([k, [, lo, hi]]) => `${k} ${lo}..${hi}`).join(", ");
export const presetExample = () => ({ ayah: 1, idea: "a starlit night over dark mountains", ...PRESETS.night, ...Object.fromEntries(Object.entries(NUM).filter(([k]) => !(k in PRESETS.night)).map(([k, [d]]) => [k, d])) });

// ---------- noise and textures ----------
const canvas = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
};
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Fractal value noise on a w x h grid, values 0..1.
function fbm(w, h, base, octaves, seed) {
  const r = rng(seed), out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const gh = base * 2 ** o + 2, gw = Math.ceil((base * 2 ** o * w) / h) + 2;
    const g = new Float32Array(gw * gh); for (let i = 0; i < g.length; i++) g[i] = r();
    const sx = (gw - 1.001) / w, sy = (gh - 1.001) / h;
    for (let y = 0; y < h; y++) {
      const fy = y * sy, y0 = fy | 0, ty = fy - y0, uy = ty * ty * (3 - 2 * ty), r0 = y0 * gw, r1 = r0 + gw;
      for (let x = 0; x < w; x++) {
        const fx = x * sx, x0 = fx | 0, tx = fx - x0, ux = tx * tx * (3 - 2 * tx);
        const a = g[r0 + x0] + (g[r0 + x0 + 1] - g[r0 + x0]) * ux;
        const b = g[r1 + x0] + (g[r1 + x0 + 1] - g[r1 + x0]) * ux;
        out[y * w + x] += (a + (b - a) * uy) * amp;
      }
    }
    tot += amp; amp *= 0.5;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) { const v = out[i] / tot; out[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
  return out;
}

// 1D smooth noise, 0..1, CW samples.
function line(seed, steps) {
  const r = rng(seed), out = new Float32Array(CW);
  let a = 1, tot = 0;
  for (const step of steps) {
    const knots = Array.from({ length: Math.ceil(CW / step) + 3 }, r);
    for (let x = 0; x < CW; x++) { const f = x / step, i = f | 0, t = f - i, u = t * t * (3 - 2 * t); out[x] += (knots[i] + (knots[i + 1] - knots[i]) * u) * a; }
    tot += a; a *= 0.5;
  }
  let mn = Infinity, mx = -Infinity;
  for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  return out.map((v) => (v - mn) / (mx - mn));
}

// Height profiles (pixels above each layer's baseline) for every landscape type.
function profiles() {
  const P = {};
  const amps = [420, 330, 260, 200];
  for (const land of LANDS) P[land] = amps.map((amp, k) => {
    const m = line(31 + k, [560, 280, 140, 64, 30, 12]);
    switch (land) {
      case "mountains": return m.map((v) => v * amp);
      case "hills": { const h = line(71 + k, [900, 450, 225]); return h.map((v) => v * amp * 0.42); }
      case "dunes": {
        const per = line(91 + k, [1200, 600]);
        return m.map((_, x) => { const ph = (x / (260 + per[x] * 220) + k * 0.37) % 1; const s = ph < 0.72 ? ph / 0.72 : (1 - ph) / 0.28; return (0.35 + 0.65 * s ** 1.5) * amp * 0.32 * (0.6 + 0.4 * per[x]); });
      }
      case "mesas": return m.map((v) => (Math.round(v * 3) / 3) * amp * 0.62 + v * 12);
      case "plain": return m.map((v) => v * amp * 0.07);
      case "sea": return new Float32Array(CW);
      case "space": return m.map((v) => v * amp - 1700);   // the land sinks away out of view
    }
  });
  return P;
}

function toCanvas(w, h, fill) {
  const c = canvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h);
  fill(img.data); g.putImageData(img, 0, 0); return c;
}

// Built once per page: about a second of work.
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const n1 = fbm(TEX_W, NEB_H, 3, 7, 1), n2 = fbm(TEX_W, NEB_H, 4, 6, 2), n3 = fbm(TEX_W, NEB_H, 2, 5, 3), dust = fbm(TEX_W, NEB_H, 5, 6, 9);
  const neb = toCanvas(TEX_W, NEB_H, (d) => {
    for (let i = 0, y = 0; y < NEB_H; y++) {
      const fade = clamp((HZ - 500 - y) / 900);
      for (let x = 0; x < TEX_W; x++, i++) {
        let c = clamp((n1[i] - 0.38) * 2.2) ** 1.6 * clamp((n3[i] - 0.25) * 2);
        c *= (1 - clamp((dust[i] - 0.55) * 3) * 0.7) * fade;
        const m = n2[i], hot = c ** 3 * 0.7;
        d[i * 4] = 255 * clamp(c * 1.6 * (0.35 * (1 - m) + 0.10 * m) + hot);
        d[i * 4 + 1] = 255 * clamp(c * 1.6 * (0.12 * (1 - m) + 0.45 * m) + hot * 0.75);
        d[i * 4 + 2] = 255 * clamp(c * 1.6 * (0.55 * (1 - m) + 0.75 * m) + hot * 0.85);
        d[i * 4 + 3] = 255;
      }
    }
  });
  const stars = canvas(TEX_W, WH), sg = stars.getContext("2d"), r = rng(5);
  sg.fillStyle = "#000"; sg.fillRect(0, 0, TEX_W, WH);
  for (let i = 0; i < 9000; i++) {
    const x = r() * TEX_W, y = r() * (HZ - 150), f = clamp((HZ - 150 - y) / 700), b = (r() ** 3 * 0.9 + 0.15) * f;
    sg.fillStyle = `rgba(255,255,255,${b})`; sg.fillRect(x, y, r() < 0.1 ? 2 : 1.3, r() < 0.1 ? 2 : 1.3);
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * TEX_W, y = r() * (HZ - 600), g = sg.createRadialGradient(x, y, 0, x, y, 14);
    g.addColorStop(0, "rgba(255,250,240,0.9)"); g.addColorStop(0.15, "rgba(255,245,235,0.35)"); g.addColorStop(1, "rgba(255,240,230,0)");
    sg.fillStyle = g; sg.fillRect(x - 14, y - 14, 28, 28);
  }
  const mask = (h, seed, cut, gain) => {
    const n = fbm(CW, h, 3, 7, seed);
    return toCanvas(CW, h, (d) => {
      for (let i = 0, y = 0; y < h; y++) {
        const prof = Math.sin((Math.PI * y) / h) ** 1.5;
        for (let x = 0; x < CW; x++, i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255 * clamp((n[i] - cut) * gain) * prof; }
      }
    });
  };
  TEX = { neb, stars, cloud: mask(700, 21, 0.55, 4), fog: mask(520, 41, 0.42, 2.2), land: profiles(), tint: canvas(W, 700), strip: canvas(4, 420) };
  return TEX;
}

const rand = (i, k = 0) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- drawing ----------
// units: [{ start }] in seconds; moments: one cleaned moment per unit
// (defaults to the night -> dawn -> blue journey); lead: how early text appears.
export function createWorld(units, duration, lead = 0.35, moments = null) {
  const T = textures(), n = units.length;
  const M = moments && moments.length === n ? moments : defaultMoments(n);
  const descendEnd = n > 1 ? units[1].start : duration * 0.6;

  function momentAt(t) {
    let p = 0;
    for (let i = 1; i < n; i++) {
      const gap = units[i].start - units[i - 1].start;
      const dur = Math.min(2.6, Math.max(0.8, gap * 0.8));
      p += ease((t - (units[i].start - lead - dur * 0.6)) / dur);
    }
    const i = Math.min(Math.floor(p), n - 1), f = p - i;
    return i >= n - 1 ? mixMoment(M[n - 1], M[n - 1], 0) : mixMoment(M[i], M[i + 1], f);
  }

  return function draw(ctx, t) {
    const m = momentAt(t);
    // Open among the stars, settle to the moment's own camera height.
    const alt = lerp(1, m.altitude, ease((t - 0.2) / Math.max(1, descendEnd + 0.6)));
    const cam = (1 - alt) * (WH - H) + 0.03 * (WH - H) * ease((t - descendEnd) / 8) * (1 - alt);
    const skyAt = (d) => {
      const s = [0, 0.08, 0.3, 1];
      for (let k = 1; k < 4; k++) if (d <= s[k]) return mixC(m.sky[k - 1], m.sky[k], (d - s[k - 1]) / (s[k] - s[k - 1]));
      return m.sky[3];
    };
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    // Sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    for (let k = 0; k <= 12; k++) g.addColorStop(k / 12, rgb(skyAt(clamp((HZ - ((k / 12) * H + cam)) / HZ))));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Nebula, stars and aurora, added on top
    const xo = 100 + t * 5;
    ctx.globalCompositeOperation = "lighter";
    if (m.nebula > 0.01 && cam < NEB_H) {
      if (Math.abs(m.nebulaHue) > 2) ctx.filter = `hue-rotate(${m.nebulaHue}deg)`;
      ctx.globalAlpha = m.nebula; ctx.drawImage(T.neb, xo, cam, W, Math.min(H, NEB_H - cam), 0, 0, W, Math.min(H, NEB_H - cam));
      ctx.filter = "none";
    }
    if (m.stars > 0.01) { ctx.globalAlpha = m.stars * (0.85 + 0.15 * Math.sin(t * 3)); ctx.drawImage(T.stars, xo / 2, cam, W, H, 0, 0, W, H); }
    if (m.aurora > 0.01) {
      const sg = T.strip.getContext("2d"), grad = sg.createLinearGradient(0, 420, 0, 0);
      const c1 = `hsla(${m.auroraHue},85%,62%,1)`, c2 = `hsla(${(m.auroraHue + 60) % 360},80%,60%,0)`;
      grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(0.08, c1); grad.addColorStop(0.45, `hsla(${m.auroraHue},85%,55%,0.35)`); grad.addColorStop(1, c2);
      sg.clearRect(0, 0, 4, 420); sg.fillStyle = grad; sg.fillRect(0, 0, 4, 420);
      for (let j = 0; j < 3; j++) for (let x = 0; x < W; x += 5) {
        const y = HZ - 1180 + j * 110 - cam + Math.sin(x * 0.004 + t * 0.35 + j * 1.7) * 90 + Math.sin(x * 0.011 - t * 0.5) * 30;
        if (y < -420 || y > H) continue;
        ctx.globalAlpha = m.aurora * 0.34 * (0.45 + 0.55 * Math.sin(x * 0.017 + t * 0.9 + j * 2) ** 2);
        ctx.drawImage(T.strip, x, y - 420, 6, 420);
      }
    }
    // Sun and moon
    if (m.sun > 0.01) {
      const sy = HZ + 40 - m.sunHeight * (HZ - 600) - 60 * ease(t / Math.max(4, duration)) - cam;
      ctx.globalAlpha = m.sun;
      const sg = ctx.createRadialGradient(540, sy, 0, 540, sy, 520);
      sg.addColorStop(0, "rgba(255,245,225,1)"); sg.addColorStop(0.08, "rgba(255,225,170,0.85)"); sg.addColorStop(0.35, "rgba(255,180,120,0.35)"); sg.addColorStop(1, "rgba(255,160,110,0)");
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = "source-over";
    if (m.moon > 0.01) {
      const mx = 790, my = HZ - 1180 - cam + 30 * Math.sin(t * 0.05);
      ctx.globalAlpha = m.moon * 0.4;
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 240);
      mg.addColorStop(0, "rgba(240,236,220,0.6)"); mg.addColorStop(1, "rgba(240,236,220,0)");
      ctx.fillStyle = mg; ctx.fillRect(mx - 240, my - 240, 480, 480);
      ctx.globalAlpha = m.moon; ctx.fillStyle = "#F2EEDF"; ctx.beginPath(); ctx.arc(mx, my, 44, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(skyAt(clamp((HZ - (my + cam)) / HZ))); ctx.beginPath(); ctx.arc(mx + 20, my - 8, 40, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Clouds and mist: white masks tinted per frame
    const tint = (mask, srcX, h, colour, alpha, dy) => {
      const tg = T.tint.getContext("2d");
      tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, W, 700);
      tg.drawImage(mask, srcX, 0, W, h, 0, 0, W, h);
      tg.globalCompositeOperation = "source-in"; tg.fillStyle = rgb(colour); tg.fillRect(0, 0, W, h);
      ctx.globalAlpha = alpha; ctx.drawImage(T.tint, 0, 0, W, h, 0, dy, W, h); ctx.globalAlpha = 1;
    };
    const cloudY = HZ - 1150 - cam;
    if (m.clouds > 0.01 && cloudY < H && cloudY > -700) tint(T.cloud, (t * 18) % (CW - W), 700, m.cloudColor, m.clouds, cloudY);
    // Landscape: four layers, hazier with distance; blends between types
    const L = m.lands || { a: m.land, b: m.land, f: 0 };
    const haze = mixC(m.sky[1], m.sky[2], 0.6), fogColour = mixC(m.sky[0], [0, 0, 0], 0.1);
    let seaTop = null;
    for (let k = 0; k < 4; k++) {
      const pa = T.land[L.a][k], pb = T.land[L.b][k], ox = Math.floor(200 + t * (3 + k * 4));
      const base = HZ + LAYER_BASE[k] - cam;
      ctx.beginPath(); ctx.moveTo(-10, H + 10);
      let top = Infinity;
      for (let x = -6; x <= W + 6; x += 6) {
        const i = ((ox + x) % CW + CW) % CW, y = base - lerp(pa[i], pb[i], L.f);
        ctx.lineTo(x, y); if (y < top) top = y;
      }
      ctx.lineTo(W + 10, H + 10); ctx.closePath();
      ctx.fillStyle = rgb(mixC(m.landColor, haze, [0.62, 0.42, 0.22, 0][k])); ctx.fill();
      if (k === 0) seaTop = base;
      if (m.mist > 0.02) {
        const fy = base - 260;
        if (fy < H && fy > -520) tint(T.fog, (t * (12 + k * 7)) % (CW - W), 520, fogColour, m.mist, fy);
      }
    }
    // Water shimmer when the landscape is sea
    const seaW = (L.a === "sea" ? 1 - L.f : 0) + (L.b === "sea" ? L.f : 0);
    if (seaW > 0.01 && seaTop < H) {
      const light = clamp(m.sun + m.moon * 0.6 + 0.15);
      ctx.strokeStyle = rgb(mixC(m.sky[0], [255, 255, 255], 0.5)); ctx.lineWidth = 2;
      for (let i = 0; i < 140; i++) {
        const y = seaTop + 8 + rand(i) ** 1.7 * (H - seaTop);
        const near = (y - seaTop) / Math.max(1, H - seaTop), len = 14 + near * 70;
        const x = ((rand(i, 1) * (W + 200) + t * (10 + near * 30)) % (W + 200)) - 100;
        const c = Math.abs(x - 540) < 160 + near * 120 ? light : light * 0.35;
        ctx.globalAlpha = seaW * c * (0.25 + 0.35 * Math.sin(t * 2 + i) ** 2);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Rain
    if (m.rain > 0.01) {
      ctx.strokeStyle = "rgba(210,220,235,1)"; ctx.lineWidth = 1.6;
      for (let i = 0; i < 220; i++) {
        const x = ((rand(i, 3) * (W + 300) + t * 160) % (W + 300)) - 150, y = ((rand(i, 4) * (H + 200) + t * (1300 + rand(i, 5) * 500)) % (H + 200)) - 100;
        ctx.globalAlpha = m.rain * (0.12 + 0.25 * rand(i, 6));
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y + 48); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };
}
