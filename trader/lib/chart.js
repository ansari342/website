// Small canvas charts: a line chart with a crosshair tooltip, and a histogram.
// Marks follow the site's chart spec: 2px lines, hairline recessive grid,
// ~10% area wash, 8px end markers with a surface ring, labels in text colors.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceStep(range, target = 5) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function setup(container, height) {
  container.classList.add("chart");
  const canvas = document.createElement("canvas");
  const tip = document.createElement("div");
  tip.className = "chart__tip";
  tip.hidden = true;
  container.append(canvas, tip);
  canvas.style.height = `${height}px`;
  return { canvas, tip };
}

function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export class LineChart {
  constructor(container, { height = 300, format = (v) => v.toFixed(0), area = false, label } = {}) {
    Object.assign(this, setup(container, height));
    this.container = container;
    this.format = format;
    this.area = area;
    this.data = null;
    this.end = 0;
    this.hover = -1;
    if (label) this.canvas.setAttribute("aria-label", label);
    this.canvas.setAttribute("role", "img");
    this.canvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.canvas.addEventListener("pointerleave", () => { this.hover = -1; this.tip.hidden = true; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(container);
  }

  setData(data) {
    this.data = data;
    this.end = data.dates.length;
    const all = data.series.flatMap((s) => s.values).filter(Number.isFinite);
    let lo = Math.min(...all, data.zero ?? Infinity);
    let hi = Math.max(...all, data.zero ?? -Infinity);
    if (hi === lo) { hi += 1; lo -= 1; }
    const step = niceStep(hi - lo);
    this.yMin = Math.floor(lo / step) * step;
    this.yMax = Math.ceil(hi / step) * step;
    this.yStep = step;
    this.draw();
  }

  setEnd(n) {
    this.end = Math.max(1, Math.min(n, this.data.dates.length));
    this.draw();
  }

  geom() {
    const { w, h } = { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
    const pad = { l: 64, r: 16, t: 12, b: 26 };
    const n = this.data.dates.length;
    const x = (i) => pad.l + (i / Math.max(n - 1, 1)) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - this.yMin) / (this.yMax - this.yMin)) * (h - pad.t - pad.b);
    return { w, h, pad, x, y, n };
  }

  draw() {
    if (!this.data) return;
    const { ctx, w, h } = fit(this.canvas);
    const { pad, x, y } = this.geom();
    const grid = css("--grid");
    const muted = css("--muted");
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px 'JetBrains Mono', monospace";

    // Grid and y ticks.
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let v = this.yMin; v <= this.yMax + this.yStep / 2; v += this.yStep) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.stroke();
      ctx.fillText(this.format(v, true), pad.l - 10, yy);
    }

    // X ticks: one per year.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const dates = this.data.dates;
    let lastYear = null;
    dates.forEach((d, i) => {
      const yr = d.slice(0, 4);
      if (yr !== lastYear) {
        if (lastYear !== null || i === 0) {
          const xx = x(i);
          if (xx > pad.l + 20 && xx < w - pad.r - 20) ctx.fillText(yr, xx, h - pad.b + 8);
        }
        lastYear = yr;
      }
    });

    // Zero line, if any.
    if (this.data.zero != null) {
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(pad.l, Math.round(y(this.data.zero)) + 0.5);
      ctx.lineTo(w - pad.r, Math.round(y(this.data.zero)) + 0.5);
      ctx.stroke();
    }

    const end = this.end;
    for (const s of [...this.data.series].reverse()) {
      if (this.area) {
        ctx.beginPath();
        ctx.moveTo(x(0), y(this.data.zero ?? this.yMin));
        for (let i = 0; i < end; i++) ctx.lineTo(x(i), y(s.values[i]));
        ctx.lineTo(x(end - 1), y(this.data.zero ?? this.yMin));
        ctx.closePath();
        ctx.fillStyle = s.color + "1f";
        ctx.fill();
      }
      ctx.beginPath();
      for (let i = 0; i < end; i++) i ? ctx.lineTo(x(i), y(s.values[i])) : ctx.moveTo(x(i), y(s.values[i]));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.stroke();
    }

    // End markers (or hover markers).
    const at = this.hover >= 0 ? this.hover : end - 1;
    if (this.hover >= 0) {
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(at)) + 0.5, pad.t);
      ctx.lineTo(Math.round(x(at)) + 0.5, h - pad.b);
      ctx.stroke();
    }
    for (const s of this.data.series) {
      ctx.beginPath();
      ctx.arc(x(at), y(s.values[at]), 4, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.lineWidth = 2;
      ctx.strokeStyle = css("--bg");
      ctx.fill();
      ctx.stroke();
    }
  }

  onMove(e) {
    if (!this.data) return;
    const r = this.canvas.getBoundingClientRect();
    const { pad, x, n, w } = this.geom();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / (w - pad.l - pad.r)) * (n - 1));
    this.hover = Math.max(0, Math.min(this.end - 1, i));
    this.draw();
    const d = this.data;
    this.tip.innerHTML =
      `<div class="chart__tip-date">${d.dates[this.hover]}</div>` +
      d.series
        .map((s) => `<div class="chart__tip-row"><span class="swatch" style="background:${s.color}"></span>${s.name}<b>${this.format(s.values[this.hover])}</b></div>`)
        .join("");
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    const left = x(this.hover) + 14 + tw > w ? x(this.hover) - 14 - tw : x(this.hover) + 14;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${pad.t + 4}px`;
  }
}

export class Histogram {
  constructor(container, { height = 200, label } = {}) {
    Object.assign(this, setup(container, height));
    this.canvas.setAttribute("role", "img");
    if (label) this.canvas.setAttribute("aria-label", label);
    this.bins = [];
    this.hover = -1;
    this.canvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.canvas.addEventListener("pointerleave", () => { this.hover = -1; this.tip.hidden = true; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(container);
  }

  setData(sortedOutcomes) {
    const v = sortedOutcomes;
    const lo = v[Math.floor(v.length * 0.01)];
    const hi = v[Math.floor(v.length * 0.99)];
    const step = niceStep(hi - lo, 28);
    const start = Math.floor(lo / step) * step;
    const count = Math.max(1, Math.ceil((hi - start) / step));
    const bins = Array.from({ length: count }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, n: 0 }));
    for (const x of v) {
      const i = Math.min(count - 1, Math.max(0, Math.floor((x - start) / step)));
      bins[i].n++;
    }
    this.total = v.length;
    this.bins = bins;
    this.draw();
  }

  geom() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const pad = { l: 8, r: 8, t: 8, b: 26 };
    const bw = (w - pad.l - pad.r) / this.bins.length;
    return { w, h, pad, bw };
  }

  draw() {
    if (!this.bins.length) return;
    const { ctx, w, h } = fit(this.canvas);
    const { pad, bw } = this.geom();
    const max = Math.max(...this.bins.map((b) => b.n));
    ctx.clearRect(0, 0, w, h);
    const gain = css("--series-1");
    const loss = css("--muted");
    this.bins.forEach((b, i) => {
      const bh = (b.n / max) * (h - pad.t - pad.b);
      const x0 = pad.l + i * bw + 1;
      const width = Math.min(Math.max(bw - 2, 1), 24);
      const xx = x0 + (bw - 2 - width) / 2;
      const yy = h - pad.b - bh;
      ctx.fillStyle = b.to <= 0 ? loss : gain;
      ctx.globalAlpha = this.hover === -1 || this.hover === i ? 1 : 0.45;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(xx, yy, width, bh, [Math.min(4, width / 2), Math.min(4, width / 2), 0, 0]);
      else ctx.rect(xx, yy, width, bh);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    // Axis labels at a few bin edges, plus zero.
    ctx.fillStyle = css("--muted");
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const every = Math.ceil(this.bins.length / 6);
    this.bins.forEach((b, i) => {
      if (i % every === 0) ctx.fillText(`${Math.round(b.from * 100)}%`, pad.l + i * bw, h - pad.b + 8);
    });
    const zi = this.bins.findIndex((b) => b.from <= 0 && b.to > 0);
    if (zi >= 0) {
      const zx = Math.round(pad.l + (zi + (0 - this.bins[zi].from) / (this.bins[zi].to - this.bins[zi].from)) * bw) + 0.5;
      ctx.strokeStyle = css("--fg");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(zx, pad.t);
      ctx.lineTo(zx, h - pad.b);
      ctx.stroke();
    }
  }

  onMove(e) {
    if (!this.bins.length) return;
    const r = this.canvas.getBoundingClientRect();
    const { pad, bw, w } = this.geom();
    const i = Math.floor((e.clientX - r.left - pad.l) / bw);
    if (i < 0 || i >= this.bins.length) { this.hover = -1; this.tip.hidden = true; this.draw(); return; }
    this.hover = i;
    this.draw();
    const b = this.bins[i];
    const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
    this.tip.innerHTML = `<div class="chart__tip-date">${pct(b.from)} to ${pct(b.to)}</div><div class="chart__tip-row">${((b.n / this.total) * 100).toFixed(1)}% of simulated years</div>`;
    this.tip.hidden = false;
    const x = pad.l + i * bw;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${x + bw + tw + 10 > w ? x - tw - 6 : x + bw + 6}px`;
    this.tip.style.top = "8px";
  }
}
