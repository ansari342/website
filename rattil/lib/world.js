// "Sky" style: one continuous world behind the text instead of separate
// scenes. The camera starts among the stars and a nebula and drifts down to
// a mountain horizon; across the screens the light moves through
// night -> dawn -> (day -> golden hour) -> blue hour, with clouds and mist,
// so every ayah's background grows out of the one before it. Everything is
// drawn in code (no footage), with no people or faces.

const W = 1080, H = 1920;
const WH = 3400, HZ = 2760;       // world height; horizon line in world coords
const TEX_W = 1300, NEB_H = 2500, CW = 3200;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

const canvas = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
};

// ---------- noise ----------
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

// A smooth mountain ridge line, CW samples long.
function ridge(seed, baseY, amp) {
  const r = rng(seed), out = new Float32Array(CW);
  let a = 1, tot = 0;
  for (const step of [560, 280, 140, 64, 30, 12]) {
    const knots = Array.from({ length: Math.ceil(CW / step) + 3 }, r);
    for (let x = 0; x < CW; x++) { const f = x / step, i = f | 0, t = f - i, u = t * t * (3 - 2 * t); out[x] += (knots[i] + (knots[i + 1] - knots[i]) * u) * a; }
    tot += a; a *= 0.5;
  }
  let mn = Infinity, mx = -Infinity;
  for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const p = new Path2D(); p.moveTo(0, H * 4);
  for (let x = 0; x < CW; x += 4) p.lineTo(x, baseY - ((out[x] - mn) / (mx - mn)) * amp);
  p.lineTo(CW, H * 4); p.closePath();
  return { path: p, mean: baseY - amp / 2 };
}

function toCanvas(w, h, fill) {
  const c = canvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h);
  fill(img.data); g.putImageData(img, 0, 0); return c;
}

// Built once per page: about half a second of work.
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
  // Stars: tiny points, a few with a soft glow; they thin out toward the horizon.
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
  // White masks for clouds and mist; their colour is applied per frame.
  const mask = (h, seed, cut, gain) => {
    const n = fbm(CW, h, 3, 7, seed);
    return toCanvas(CW, h, (d) => {
      for (let i = 0, y = 0; y < h; y++) {
        const prof = Math.sin((Math.PI * y) / h) ** 1.5;
        for (let x = 0; x < CW; x++, i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255 * clamp((n[i] - cut) * gain) * prof; }
      }
    });
  };
  TEX = {
    neb, stars,
    cloud: mask(700, 21, 0.55, 4),
    fog: mask(520, 41, 0.42, 2.2),
    ridges: [ridge(31, HZ + 60, 420), ridge(32, HZ + 230, 330), ridge(33, HZ + 420, 260), ridge(34, HZ + 600, 200)],
    tint: canvas(W, 700),
  };
  return TEX;
}

// ---------- light states ----------
// sky: colour stops by height above the horizon (0 = horizon, 1 = top of the world).
const LIGHT = {
  night: { sky: [[0, [26, 26, 56]], [0.25, [10, 13, 33]], [1, [3, 3, 9]]], ridges: [[18, 20, 41], [13, 15, 31], [9, 10, 20], [5, 5, 13]],
           cloud: [[41, 41, 71], 0.35], neb: 1, stars: 1, sun: 0, sunY: 60, fog: 0.05 },
  dawn:  { sky: [[0, [255, 204, 133]], [0.06, [250, 148, 92]], [0.22, [102, 77, 128]], [0.6, [20, 23, 61]], [1, [5, 5, 18]]], ridges: [[92, 64, 97], [61, 41, 69], [33, 23, 41], [15, 13, 20]],
           cloud: [[255, 179, 148], 0.85], neb: 0.12, stars: 0.15, sun: 1, sunY: -100, fog: 0.12 },
  day:   { sky: [[0, [214, 228, 240]], [0.15, [150, 190, 228]], [0.5, [70, 120, 190]], [1, [25, 50, 110]]], ridges: [[120, 140, 165], [88, 104, 126], [58, 70, 88], [32, 40, 52]],
           cloud: [[250, 250, 255], 0.8], neb: 0, stars: 0, sun: 0.45, sunY: -1100, fog: 0.15 },
  golden: { sky: [[0, [255, 196, 120]], [0.1, [240, 150, 90]], [0.3, [150, 100, 120]], [0.7, [45, 45, 90]], [1, [12, 14, 34]]], ridges: [[110, 72, 70], [78, 50, 54], [46, 30, 36], [22, 15, 20]],
           cloud: [[255, 170, 120], 0.8], neb: 0.05, stars: 0.05, sun: 0.9, sunY: -40, fog: 0.2 },
  blue:  { sky: [[0, [102, 120, 153]], [0.2, [43, 56, 94]], [0.6, [13, 18, 41]], [1, [3, 5, 15]]], ridges: [[61, 74, 102], [43, 54, 79], [28, 36, 56], [15, 20, 33]],
           cloud: [[107, 122, 153], 0.55], neb: 0.3, stars: 0.55, sun: 0, sunY: 80, fog: 0.65 },
};
const PATHS = { 1: ["night"], 2: ["night", "dawn"], 3: ["night", "dawn", "blue"], 4: ["night", "dawn", "golden", "blue"] };
const pathFor = (n) => PATHS[n] || ["night", "dawn", "day", "golden", "blue"];

const skyAt = (stops, d) => {
  for (let i = 1; i < stops.length; i++) if (d <= stops[i][0]) return mixC(stops[i - 1][1], stops[i][1], (d - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1];
};
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// units: [{ start }] in seconds; lead: how early each screen's text appears.
export function createWorld(units, duration, lead = 0.35) {
  const T = textures();
  const path = pathFor(units.length), n = units.length;
  // Where along the light path each screen sits (0 .. path.length - 1).
  const pos = units.map((_, i) => (n === 1 ? 0 : (i * (path.length - 1)) / (n - 1)));
  const descendEnd = n > 1 ? units[1].start : duration * 0.6;

  function lightAt(t) {
    let p = pos[0];
    for (let i = 1; i < n; i++) {
      const gap = units[i].start - units[i - 1].start;
      const dur = Math.min(2.6, Math.max(0.8, gap * 0.8));
      p += (pos[i] - pos[i - 1]) * ease((t - (units[i].start - lead - dur * 0.6)) / dur);
    }
    const i = Math.min(Math.floor(p), path.length - 2), f = path.length === 1 ? 0 : p - i;
    const A = LIGHT[path[Math.max(0, i)]], B = LIGHT[path[Math.min(path.length - 1, i + 1)]];
    const L = {};
    for (const k of ["neb", "stars", "sun", "sunY", "fog"]) L[k] = lerp(A[k], B[k], f);
    L.cloud = [mixC(A.cloud[0], B.cloud[0], f), lerp(A.cloud[1], B.cloud[1], f)];
    L.ridges = A.ridges.map((c, k) => mixC(c, B.ridges[k], f));
    L.skyAt = (d) => mixC(skyAt(A.sky, d), skyAt(B.sky, d), f);
    return L;
  }

  return function draw(ctx, t) {
    const L = lightAt(t);
    const cam = (WH - H) * (ease((t - 0.2) / Math.max(1, descendEnd + 0.6)) * 0.97 + 0.03 * ease((t - descendEnd) / 8));
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    // Sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    for (let k = 0; k <= 12; k++) { const y = (k / 12) * H; g.addColorStop(k / 12, rgb(L.skyAt(clamp((HZ - (y + cam)) / HZ)))); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Nebula and stars, added on top and drifting slowly sideways
    const xo = 100 + t * 5;
    ctx.globalCompositeOperation = "lighter";
    if (L.neb > 0.01 && cam < NEB_H) { ctx.globalAlpha = L.neb; ctx.drawImage(T.neb, xo, cam, W, Math.min(H, NEB_H - cam), 0, 0, W, Math.min(H, NEB_H - cam)); }
    if (L.stars > 0.01) { ctx.globalAlpha = L.stars * (0.85 + 0.15 * Math.sin(t * 3)); ctx.drawImage(T.stars, xo / 2, cam, W, H, 0, 0, W, H); }
    // Sun glow behind the ridges
    if (L.sun > 0.01) {
      const sy = HZ + L.sunY - 120 * ease(t / Math.max(4, duration)) - cam;
      ctx.globalAlpha = L.sun;
      const sg = ctx.createRadialGradient(540, sy, 0, 540, sy, 520);
      sg.addColorStop(0, "rgba(255,245,225,1)"); sg.addColorStop(0.08, "rgba(255,225,170,0.85)"); sg.addColorStop(0.35, "rgba(255,180,120,0.35)"); sg.addColorStop(1, "rgba(255,160,110,0)");
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    // Clouds above the horizon, tinted for the time of day
    const tint = (mask, srcX, w, h, colour, alpha, dy) => {
      const tg = T.tint.getContext("2d");
      tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, W, 700);
      tg.drawImage(mask, srcX, 0, w, h, 0, 0, w, h);
      tg.globalCompositeOperation = "source-in"; tg.fillStyle = rgb(colour); tg.fillRect(0, 0, W, h);
      ctx.globalAlpha = alpha; ctx.drawImage(T.tint, 0, 0, W, h, 0, dy, W, h); ctx.globalAlpha = 1;
    };
    const cloudY = HZ - 1150 - cam;
    if (cloudY < H && cloudY > -700) tint(T.cloud, (t * 18) % (CW - W), W, 700, L.cloud[0], L.cloud[1], cloudY);
    // Mountain ridges, near ones moving faster, with mist drifting between them
    const fogColour = mixC(L.skyAt(0.02), [0, 0, 0], 0.1);
    T.ridges.forEach((r, k) => {
      ctx.save(); ctx.translate(-(200 + t * (3 + k * 4)), -cam);
      ctx.fillStyle = rgb(L.ridges[k]); ctx.fill(r.path); ctx.restore();
      const fy = r.mean - 260 - cam;
      if (L.fog > 0.02 && fy < H && fy > -520) tint(T.fog, (t * (12 + k * 7)) % (CW - W), W, 520, fogColour, L.fog, fy);
    });
    ctx.restore();
  };
}
