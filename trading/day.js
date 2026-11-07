// Quick trades tab: the probability trader, run over 5 years and scored on
// randomly sampled weeks against random entries, Dip Buyer and holding SPUS.
import { walkForward, evaluate, calibration, FEATURES } from "./lib/daytrade.js";
import { dipBuyer } from "./lib/strategies.js";
import { loadSeries, UNIVERSE } from "./lib/data.js";
import { LineChart, Histogram } from "./lib/chart.js";

const $ = (s) => document.querySelector(s);
const STORE = "trading-lab:prob:v1";
let BENCH = "SPUS";
const DEFAULTS = {
  symbols: ["SPUS", "HLAL", "UMMA", "SPTE", "AAPL", "MSFT", "NVDA", "ADBE", "ASML", "TSM"],
  threshold: 75,
  max: 10,
  hold: 10,
  stop: 10,
  size: 10,
  exit: 5,
  cost: 5,
  capital: 10000,
  weeks: 52,
  seed: 7,
};
const state = { ...DEFAULTS };
try {
  Object.assign(state, JSON.parse(localStorage.getItem(STORE) || "{}"));
} catch (_) {}
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
};

const money = (v) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyAxis = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : `$${Math.round(v)}`);
const pct = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const pctPlain = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const cls = (v) => (v == null ? "" : v >= 0 ? "up" : "down");

/* ---------- Controls ---------- */
const choices = UNIVERSE.filter((u) => u.sym !== "SPSK");
function renderUniverse() {
  $("#day-universe").innerHTML = choices
    .map((u) => `<label class="chip ${state.symbols.includes(u.sym) ? "is-on" : ""}" title="${u.name}: ${u.note}"><input type="checkbox" value="${u.sym}" ${state.symbols.includes(u.sym) ? "checked" : ""} />${u.sym}<span class="chip__kind">${u.kind}</span></label>`)
    .join("");
}
$("#day-universe").addEventListener("change", (e) => {
  const s = e.target.value;
  state.symbols = e.target.checked ? [...new Set([...state.symbols, s])] : state.symbols.filter((x) => x !== s);
  save();
  renderUniverse();
});
const inputs = { threshold: "#day-threshold", max: "#day-max", hold: "#day-hold", stop: "#day-stop", size: "#day-size", exit: "#day-exit", cost: "#day-cost", capital: "#day-capital", weeks: "#day-weeks", seed: "#day-seed" };
for (const [k, sel] of Object.entries(inputs)) {
  $(sel).value = state[k];
  $(sel).addEventListener("change", (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) state[k] = v;
    save();
  });
}
renderUniverse();

/* ---------- Charts ---------- */
const chart = new LineChart($("#day-chart"), { height: 300, format: (v, axis) => (axis ? moneyAxis(v) : money(v)), label: "Account value over 5 years, probability trader versus holding SPUS" });
const hist = new Histogram($("#day-hist"), { height: 160, label: "Spread of sampled weekly returns", unit: "sampled weeks" });

/* ---------- Run ---------- */
const cache = { series: {}, source: null };
let wfCache = null;
let running = false;

async function run() {
  if (running) return;
  running = true;
  const btn = $("#day-run");
  btn.disabled = true;
  try {
    const syms = state.symbols.filter((s) => choices.some((u) => u.sym === s));
    if (syms.length < 2) throw new Error("Pick at least two stocks or funds.");
    // Compare crypto with Bitcoin, everything else with SPUS.
    BENCH = syms.every((s) => s.endsWith("-USD")) ? "BTC-USD" : "SPUS";
    $("#day-status").textContent = "Loading prices…";
    const need = [...new Set([...syms, BENCH])].filter((s) => !cache.series[s]);
    if (need.length) {
      const got = await loadSeries(need, { source: "auto" });
      Object.assign(cache.series, got.series);
      cache.source = got.source;
    }
    $("#day-status").textContent = "Training and testing the model (a few seconds)…";
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const last = syms.reduce((m, s) => (cache.series[s].d.at(-1) > m ? cache.series[s].d.at(-1) : m), "");
    const start = new Date(Date.parse(last) - 5 * 365.25 * 864e5).toISOString().slice(0, 10);
    const opts = { start, costBps: state.cost, maxHold: state.hold, stopPct: state.stop / 100, exitLen: state.exit };
    const key = JSON.stringify([syms, opts]);
    if (!wfCache || wfCache.key !== key) wfCache = { key, wf: walkForward(cache.series, syms, opts) };
    const wf = wfCache.wf;
    const series = { ...cache.series };
    const ev = evaluate(series, syms, wf, {
      threshold: state.threshold / 100,
      maxPositions: state.max,
      size: state.size / 100,
      weeks: state.weeks,
      seed: state.seed,
      capital: state.capital,
      benchmark: BENCH,
      dipBuyer,
    });
    render(ev, calibration(wf), wf);
    $("#day-status").innerHTML = `${cache.source === "live" ? "<b>Live prices</b>" : "<b>Saved price history</b>"} · ${wf.dates[0]} → ${last} · ${ev.summary.weeks} sampled weeks · ${syms.length} stocks and funds · ran in ${Math.round(performance.now() - t0)} ms`;
  } catch (err) {
    $("#day-status").textContent = `Couldn't run: ${err.message}`;
  } finally {
    btn.disabled = false;
    running = false;
  }
}

function render(ev, cal, wf) {
  const s = ev.summary;
  const css = getComputedStyle(document.documentElement);
  const c1 = css.getPropertyValue("--series-1").trim();
  const c2 = css.getPropertyValue("--series-2").trim();
  const perYear = s.trades / s.years;

  // Verdict
  const edge = s.weeks - s.flatWeeks >= 10 && s.meanCI[0] > 0;
  const v = $("#day-verdict");
  v.hidden = false;
  v.className = `verdict-box ${edge ? "good" : ""}`;
  const tradeLine = s.trades
    ? ` Its ${s.trades} trades won ${pctPlain(s.winRate)} of the time (95% likely range ${pctPlain(s.winCI[0])}–${pctPlain(s.winCI[1])}) and averaged ${pct(s.avgTrade)} after costs, over about ${s.avgDays.toFixed(1)} days each. But it found only about ${perYear.toFixed(0)} trades a year, so the money was invested ${pctPlain(s.exposure)} of the time.`
    : " It made no trades: the model never reached this bar.";
  v.innerHTML = edge
    ? `<b>Positive in these weeks.</b> The average sampled week made ${pct(s.meanWeekly)}, and the 95% likely range (${pct(s.meanCI[0])} to ${pct(s.meanCI[1])}) stays above zero.${tradeLine}`
    : `<b>No reliable weekly edge.</b> The average sampled week made ${pct(s.meanWeekly)} (95% likely range ${pct(s.meanCI[0])} to ${pct(s.meanCI[1])}); holding ${BENCH} averaged ${pct(s.meanHold)}.${tradeLine}`;

  // KPIs
  const kpi = (label, value, sub, klass = "") => `<div class="kpi"><div class="kpi__label mono">${label}</div><div class="kpi__value ${klass}">${value}</div><div class="kpi__sub">${sub}</div></div>`;
  $("#day-kpis").innerHTML = [
    kpi("Average sampled week", pct(s.meanWeekly), `95% likely range ${pct(s.meanCI[0])} to ${pct(s.meanCI[1])}`, cls(s.meanWeekly)),
    kpi("Weeks that made money", `${s.upWeeks} of ${s.weeks}`, `${s.flatWeeks} weeks had no positions at all`),
    kpi("Winning trades", s.trades ? pctPlain(s.winRate) : "—", s.trades ? `95% likely range ${pctPlain(s.winCI[0])}–${pctPlain(s.winCI[1])} · ${s.trades} trades in 5 years` : "No trades"),
    kpi("Average trade", s.trades ? pct(s.avgTrade) : "—", s.trades ? `after costs · held ${s.avgDays.toFixed(1)} days on average` : "—", s.trades ? cls(s.avgTrade) : ""),
    kpi("Per year (5 years)", pct(s.cagr, 1), `Holding ${BENCH}: ${pct(s.holdCagr, 1)} · invested ${pctPlain(s.exposure)} of the time`, cls(s.cagr)),
    kpi("Worst drop", pct(s.maxDrawdown, 1), `Holding ${BENCH}: ${pct(s.holdDrawdown, 1)}`, "down"),
    kpi("Random entries", pct(s.randomCagr, 1), "per year · same exits and number of trades, but random picks", cls(s.randomCagr)),
    kpi("Dip Buyer rule", pct(s.dipCagr, 1), "per year on the same stocks, with its own settings", cls(s.dipCagr)),
  ].join("");

  // 5-year growth
  const lines = [
    { name: "Probability trader", color: c1, values: ev.model.equity },
    { name: `Holding ${BENCH}`, color: c2, values: ev.model.benchmark },
  ];
  $("#day-legend").innerHTML = lines.map((x) => `<span><i class="swatch" style="background:${x.color}"></i>${x.name}</span>`).join("");
  chart.setData({ dates: ev.model.dates, series: lines });
  hist.setData(ev.rows.map((r) => r.ret).sort((a, b) => a - b));

  // Calibration
  $("#day-cal").innerHTML = `<thead><tr><th>Model said</th><th class="num">Stock-days</th><th class="num">Trade made money</th><th class="num">Avg trade</th></tr></thead><tbody>${cal
    .map((c) => `<tr class="${c.lo >= state.threshold / 100 - 1e-9 ? "is-current" : ""}"><td>${pctPlain(c.lo)}–${pctPlain(c.hi)} <span class="muted">(avg ${pctPlain(c.predicted)})</span></td><td class="num">${c.n.toLocaleString()}</td><td class="num"><span class="calbar" style="width:${Math.round(c.actual * 60)}px"></span>${pctPlain(c.actual)}</td><td class="num ${cls(c.avgNet)}">${pct(c.avgNet)}</td></tr>`)
    .join("")}</tbody>`;

  // Weights
  const m = wf.models.at(-1);
  if (m) {
    const max = Math.max(...m.weights.map(Math.abs), 1e-9);
    const order = FEATURES.map((f, i) => ({ f, w: m.weights[i] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    $("#day-weights").innerHTML = `<div class="weights">${order
      .map(({ f, w }) => {
        const width = (Math.abs(w) / max) * 50;
        const left = w >= 0 ? 50 : 50 - width;
        return `<div class="w"><span>${f.label}</span><span class="bar"><i style="left:${left}%;width:${width}%"></i></span></div>`;
      })
      .join("")}</div><p class="hint">Refit on ${m.from} using ${m.n.toLocaleString()} finished past trades, of which ${pctPlain(m.base)} made money.</p>`;
  }

  // Sampled weeks
  $("#day-count").textContent = `${ev.rows.length} weeks`;
  $("#day-weeks-table").innerHTML = `<thead><tr><th>Week of</th><th class="num">Trades opened</th><th class="num">Won</th><th class="num">Model</th><th class="num">Profit</th><th class="num">Random</th><th class="num">Dip Buyer</th><th class="num">Hold ${BENCH}</th></tr></thead><tbody>${ev.rows
    .map((r) => `<tr><td>${r.week}</td><td class="num">${r.opened}</td><td class="num">${r.opened ? `${r.won}/${r.opened}` : "—"}</td><td class="num ${cls(r.ret)}">${pct(r.ret)}</td><td class="num ${cls(r.pnl)}">${money(r.pnl)}</td><td class="num ${cls(r.random)}">${pct(r.random)}</td><td class="num ${cls(r.dip)}">${pct(r.dip)}</td><td class="num ${cls(r.hold)}">${pct(r.hold)}</td></tr>`)
    .join("")}</tbody>`;

  // Recent trades
  const trades = [...ev.model.trades].reverse().slice(0, 40);
  $("#day-trade-count").textContent = `${ev.model.trades.length} closed · ${ev.model.open.length} open`;
  $("#day-trades").innerHTML = `<thead><tr><th>Bought</th><th>Stock</th><th class="num">Buy</th><th>Sold</th><th class="num">Sell</th><th class="num">Days</th><th class="num">Return</th><th>Why</th></tr></thead><tbody>${trades
    .map((t) => `<tr><td>${t.entryDate}</td><td>${t.sym}</td><td class="num">${t.entryPrice.toFixed(2)}</td><td>${t.exitDate}</td><td class="num">${t.exitPrice.toFixed(2)}</td><td class="num">${t.days}</td><td class="num ${cls(t.ret)}">${pct(t.ret)}</td><td>${t.entryReason} → ${t.exitReason}</td></tr>`)
    .join("")}</tbody>`;
}

$("#day-controls").addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});
// The Tuning tab can hand over a set of settings to try here.
document.addEventListener("apply-prob", (e) => {
  Object.assign(state, e.detail);
  for (const [k, sel] of Object.entries(inputs)) $(sel).value = state[k];
  save();
  renderUniverse();
  ranOnce = true;
  run();
});

let ranOnce = false;
document.addEventListener("mode", (e) => {
  if (e.detail === "day" && !ranOnce) {
    ranOnce = true;
    run();
  }
});
