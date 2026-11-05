const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Console: San Francisco time ---------- */
const consoleEl = document.getElementById("console");
const tick = () => {
  const t = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
  consoleEl.textContent = `San Francisco — ${t} PT — Product @ YouTube`;
};
tick();
setInterval(tick, 15_000);

document.getElementById("year").textContent = new Date().getFullYear();

/* ---------- Title: split into letters and fit to width ---------- */
const title = document.getElementById("title");
title.querySelectorAll(".title__word").forEach((word, w) => {
  const text = word.textContent;
  word.textContent = "";
  word.setAttribute("aria-label", text);
  [...text].forEach((c, i) => {
    const s = document.createElement("span");
    s.className = "ch";
    s.setAttribute("aria-hidden", "true");
    s.textContent = c;
    s.style.animationDelay = `${0.15 + (w * text.length + i) * 0.045}s`;
    word.appendChild(s);
  });
});

const fitTitle = () => {
  title.style.setProperty("--title-size", "100px");
  const style = getComputedStyle(title);
  const avail = title.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const natural = [...title.children].reduce((w, el) => w + el.getBoundingClientRect().width, 0);
  const gaps = parseFloat(style.columnGap || 0) * (title.children.length - 1);
  const size = Math.floor((100 * avail) / (natural + gaps) * 0.985);
  title.style.setProperty("--title-size", `${size}px`);
};
document.fonts.ready.then(fitTitle);
fitTitle();
window.addEventListener("resize", fitTitle);

/* ---------- Hero field: contour lines that bend away from the cursor ---------- */
const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, dpr = 1;
const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
let visible = true;
let start = performance.now();

const resize = () => {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const setPointer = (clientX, clientY) => {
  const r = canvas.getBoundingClientRect();
  mouse.tx = clientX - r.left;
  mouse.ty = clientY - r.top;
  if (!mouse.active) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
  mouse.active = true;
};
canvas.parentElement.addEventListener("pointermove", (e) => setPointer(e.clientX, e.clientY));
canvas.parentElement.addEventListener("pointerleave", () => { mouse.active = false; });

const ACCENT = [255, 77, 46];
const FG = [242, 235, 225];

const draw = (now) => {
  const t = (now - start) / 1000;
  ctx.clearRect(0, 0, W, H);

  // Ease the pointer for a soft, trailing feel; drift it away when idle.
  if (!mouse.active) { mouse.tx = W * (0.5 + 0.35 * Math.sin(t * 0.25)); mouse.ty = H * (0.5 + 0.3 * Math.cos(t * 0.33)); }
  mouse.x += (mouse.tx - mouse.x) * 0.08;
  mouse.y += (mouse.ty - mouse.y) * 0.08;

  const gap = W < 600 ? 14 : 18;
  const rows = Math.ceil(H / gap) + 2;
  const step = 8;
  const radius = Math.min(W, H) * (W < 600 ? 0.45 : 0.32);
  const intro = reduceMotion ? 1 : Math.min(1, t / 1.6);
  const ease = 1 - Math.pow(1 - intro, 3);

  for (let r = 0; r < rows; r++) {
    const baseY = r * gap - gap;
    ctx.beginPath();
    let near = 0;
    for (let x = 0; x <= W + step; x += step) {
      // Layered sines stand in for noise: slow swells plus finer ripples.
      const n =
        Math.sin(x * 0.006 + r * 0.35 + t * 0.6) * 6 +
        Math.sin(x * 0.017 - r * 0.21 + t * 0.9) * 3 +
        Math.sin(x * 0.0021 + t * 0.2) * 10;
      const dx = x - mouse.x;
      const dy = baseY - mouse.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = Math.max(0, 1 - d / radius);
      const push = f * f * (dy >= 0 ? 1 : -1) * gap * 2.4;
      near = Math.max(near, f);
      const y = baseY + n * ease + push;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // Lines near the pointer warm toward the accent color.
    const k = Math.min(1, near * 1.4);
    const c = FG.map((v, i) => Math.round(v + (ACCENT[i] - v) * k));
    const a = (0.12 + 0.55 * k) * ease;
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
};

const loop = (now) => {
  if (visible) draw(now);
  if (!reduceMotion) requestAnimationFrame(loop);
};

resize();
window.addEventListener("resize", resize);
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
}
if (reduceMotion) draw(start + 4000); else requestAnimationFrame(loop);

/* ---------- Section reveal ---------- */
const items = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !reduceMotion) {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }),
    { threshold: 0.1 }
  );
  items.forEach((el) => io.observe(el));
} else {
  items.forEach((el) => el.classList.add("in"));
}
