// Day trades tab: walk-forward probability model, evaluated on sampled weeks.
import { walkForward, dailyReturns, evaluateWeeks, calibration, FEATURES } from "./lib/daytrade.js";
import { loadSeries, UNIVERSE } from "./lib/data.js";
import { LineChart, Histogram } from "./lib/chart.js";

const $ = (s) => document.querySelector(s);
const STORE = "trading-lab:day:v1";
const BENCH = "SPUS";
const DEFAULTS = {
  symbols: ["SPUS", "HLAL", "UMMA", "SPTE", "AAPL", "MSFT", "NVDA", "ADBE", "ASML", "TSM"],
  weeks: 52,
  seed: 7,
  threshold: 55,
  max: 3,
  cost: 5,
  capital: 10000,
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
const pct = (v, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;
const pctPlain = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const cls = (v) => (v >= 0 ? "up" : "down");

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
const inputs = { weeks: "#day-weeks", seed: "#day-seed", threshold: "#day-threshold", max: "#day-max", cost: "#day-cost", capital: "#day-capital" };
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
const chart = new LineChart($("#day-chart"), { height: 280, format: (v, axis) => (axis ? moneyAxis(v) : money(v)), label: "Money across the sampled weeks, strategy versus holding SPUS" });
const hist = new Histogram($("#day-hist"), { height: 160, label: "Spread of weekly returns", unit: "sampled weeks" });

/* ---------- Run ---------- */
const cache = { series: {}, source: null, asOf: null };
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
    $("#day-status").textContent = "Loading prices…";
    const need = [...new Set([...syms, BENCH])].filter((s) => !cache.series[s]);
    if (need.length) {
      const got = await loadSeries(need, { source: "auto" });
      Object.assign(cache.series, got.series);
      cache.source = got.source;
      cache.asOf = got.asOf;
    }
    $("#day-status").textContent = "Training and testing the model (a few seconds)…";
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const last = syms.reduce((m, s) => (cache.series[s].d.at(-1) > m ? cache.series[s].d.at(-1) : m), "");
    const start = new Date(Date.parse(last) - 5 * 365.25 * 864e5).toISOString().slice(0, 10);
    const key = `${syms.join(",")}|${state.cost}|${start}`;
    if (!wfCache || wfCache.key !== key) wfCache = { key, wf: walkForward(cache.series, syms, { start, costBps: state.cost }) };
    const wf = wfCache.wf;
    const threshold = state.threshold / 100;
    const daily = dailyReturns(wf, { threshold, maxPositions: state.max });
    const ev = evaluateWeeks(cache.series, syms, daily, { weeks: state.weeks, seed: state.seed, capital: state.capital, threshold, maxPositions: state.max, costBps: state.cost, benchmark: BENCH });
    const cal = calibration(wf);
    render(ev, cal, wf, { start, last });
    $("#day-status").innerHTML = `${cache.source === "live" ? "<b>Live prices</b>" : "<b>Saved price history</b>"} · ${start} → ${last} · ${ev.summary.weeks} sampled weeks · ${syms.length} stocks and funds · ran in ${Math.round(performance.now() - t0)} ms`;
  } catch (err) {
    $("#day-status").textContent = `Couldn't run: ${err.message}`;
  } finally {
    btn.disabled = false;
    running = false;
  }
}

function render(ev, cal, wf, { start, last }) {
  const s = ev.summary;
  const css = getComputedStyle(document.documentElement);
  const c1 = css.getPropertyValue("--series-1").trim();
  const c2 = css.getPropertyValue("--series-2").trim();

  // Verdict
  const edge = s.tradedWeeks >= 10 && s.meanCI[0] > 0;
  const v = $("#day-verdict");
  v.hidden = false;
  v.className = `verdict-box ${edge ? "good" : ""}`;
  v.innerHTML = edge
    ? `<b>Positive in these weeks.</b> The average sampled week made ${pct(s.meanWeekly)}, and the 95% likely range (${pct(s.meanCI[0])} to ${pct(s.meanCI[1])}) stays above zero. Try other random seeds and settings before trusting it.`
    : `<b>No reliable edge.</b> The average sampled week made ${pct(s.meanWeekly)}, with a 95% likely range of ${pct(s.meanCI[0])} to ${pct(s.meanCI[1])}, which ${s.meanCI[1] < 0 ? "is below zero" : "includes zero"}. Holding ${BENCH} through the same weeks averaged ${pct(s.meanHold)} a week.`;

  // KPIs
  const kpi = (label, value, sub, klass = "") => `<div class="kpi"><div class="kpi__label mono">${label}</div><div class="kpi__value ${klass}">${value}</div><div class="kpi__sub">${sub}</div></div>`;
  $("#day-kpis").innerHTML = [
    kpi("Average week", pct(s.meanWeekly), `95% likely range ${pct(s.meanCI[0])} to ${pct(s.meanCI[1])}`, cls(s.meanWeekly)),
    kpi("Weeks that made money", s.tradedWeeks ? `${s.upWeeks} of ${s.tradedWeeks}` : "—", s.tradedWeeks ? `${pctPlain(s.upRate)} of weeks with trades · ${s.weeks - s.tradedWeeks} weeks with no trades` : "No trades"),
    kpi("Total profit", money(s.totalPnl), `${money(state.capital)} traded each sampled week`, cls(s.totalPnl)),
    kpi("Winning trades", s.trades ? pctPlain(s.winRate) : "—", s.trades ? `95% likely range ${pctPlain(s.winCI[0])}–${pctPlain(s.winCI[1])} · ${s.trades} trades` : "No trades"),
    kpi(`Holding ${BENCH}`, pct(s.meanHold), "Average sampled week, bought Monday open and sold Friday close", cls(s.meanHold)),
    kpi("Coin-flip trades", pct(s.meanCoin), `Same number of trades, random stocks · the model beat it in ${pctPlain(s.beatCoin)} of weeks`, cls(s.meanCoin)),
    kpi("Trade everything", pct(s.meanEvery), "Day-trade every stock every day, no model", cls(s.meanEvery)),
    kpi("Best / worst week", `${pct(s.bestWeek, 1)}`, `worst ${pct(s.worstWeek, 1)}`),
  ].join("");

  // Chained growth across sampled weeks.
  let a = state.capital;
  let b = state.capital;
  const eqA = [];
  const eqB = [];
  for (const r of ev.rows) {
    a *= 1 + r.ret;
    b *= 1 + (r.hold ?? 0);
    eqA.push(a);
    eqB.push(b);
  }
  const series = [
    { name: "Day-trading model", color: c1, values: eqA },
    { name: `Holding ${BENCH}`, color: c2, values: eqB },
  ];
  $("#day-legend").innerHTML = series.map((x) => `<span><i class="swatch" style="background:${x.color}"></i>${x.name}</span>`).join("");
  chart.setData({ dates: ev.rows.map((r) => r.week), series });
  hist.setData(ev.rows.map((r) => r.ret).sort((x, y) => x - y));

  // Calibration
  $("#day-cal").innerHTML = `<thead><tr><th>Model said</th><th class="num">Stock-days</th><th class="num">Actually rose</th><th class="num">Avg after costs</th></tr></thead><tbody>${cal
    .map((c) => `<tr><td>${pctPlain(c.lo)}–${pctPlain(c.hi)} <span class="muted">(avg ${pctPlain(c.predicted)})</span></td><td class="num">${c.n.toLocaleString()}</td><td class="num"><span class="calbar" style="width:${Math.round(c.actual * 60)}px"></span>${pctPlain(c.actual)}</td><td class="num ${cls(c.avgNet)}">${pct(c.avgNet, 3)}</td></tr>`)
    .join("")}</tbody>`;

  // Weights from the latest refit.
  const m = wf.models.at(-1);
  if (m) {
    const max = Math.max(...m.weights.map(Math.abs), 1e-9);
    const order = FEATURES.map((f, i) => ({ f, w: m.weights[i] })).sort((x, y) => Math.abs(y.w) - Math.abs(x.w));
    $("#day-weights").innerHTML = `<div class="weights">${order
      .map(({ f, w }) => {
        const width = (Math.abs(w) / max) * 50;
        const left = w >= 0 ? 50 : 50 - width;
        return `<div class="w"><span>${f.label}</span><span class="bar"><i style="left:${left}%;width:${width}%"></i></span></div>`;
      })
      .join("")}</div><p class="hint">Refit on ${m.from} using ${m.n.toLocaleString()} past stock-days, of which ${pctPlain(m.base)} were worthwhile up days.</p>`;
  }

  // Weekly table
  $("#day-count").textContent = `${ev.rows.length} weeks`;
  $("#day-weeks-table").innerHTML = `<thead><tr><th>Week of</th><th class="num">Trades</th><th class="num">Won</th><th class="num">Model</th><th class="num">Profit</th><th class="num">Coin flip</th><th class="num">Hold ${BENCH}</th></tr></thead><tbody>${ev.rows
    .map((r) => `<tr><td>${r.week}</td><td class="num">${r.trades}</td><td class="num">${r.trades ? `${r.wins}/${r.trades}` : "—"}</td><td class="num ${cls(r.ret)}">${pct(r.ret)}</td><td class="num ${cls(r.pnl)}">${money(r.pnl)}</td><td class="num ${cls(r.coin)}">${pct(r.coin)}</td><td class="num ${r.hold == null ? "" : cls(r.hold)}">${r.hold == null ? "—" : pct(r.hold)}</td></tr>`)
    .join("")}</tbody>`;
}

$("#day-controls").addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});
let ranOnce = false;
document.addEventListener("mode", (e) => {
  if (e.detail === "day" && !ranOnce) {
    ranOnce = true;
    run();
  }
});
