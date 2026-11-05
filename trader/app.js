import { runBacktest, defaultsOf } from "./lib/engine.js";
import { STRATEGIES } from "./lib/strategies.js";
import { summarize, summarizeSeries, bootstrapYears, splitHalves, drawdowns } from "./lib/stats.js";
import { loadSeries, UNIVERSE } from "./lib/data.js";
import { LineChart, Histogram } from "./lib/chart.js";

const $ = (s) => document.querySelector(s);
const BENCH = "SPUS";
const DEFAULT_UNIVERSE = {
  dip: ["SPUS", "HLAL", "UMMA"],
  guard: ["SPUS"],
  rotation: ["SPUS", "HLAL", "UMMA", "SPWO", "SPTE", "SPRE"],
  gap: ["SPUS", "HLAL"],
};
const UNIVERSE_HINT = {
  dip: "Each selected fund is watched for sharp dips. More funds means more chances to trade.",
  guard: "The first fund you select (marked 1) is the core holding. SPSK sukuk is added automatically as the defensive asset.",
  rotation: "The funds that compete for a spot each month. SPSK sukuk is added automatically as the defensive asset.",
  gap: "Each selected fund is watched for gap-down opens.",
};

/* ---------- Formatting ---------- */
const money = (v) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyAxis = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : `$${Math.round(v)}`);
const pct = (v, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;
const pctPlain = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const cls = (v) => (v >= 0 ? "up" : "down");

/* ---------- State ---------- */
const STORE = "trading-lab:v1";
const state = {
  strategy: "dip",
  universe: { ...DEFAULT_UNIVERSE },
  params: {},
  capital: 10000,
  period: "all",
  slippage: 5,
  purify: 3,
  source: "auto",
  seed: 1,
};
try {
  Object.assign(state, JSON.parse(localStorage.getItem(STORE) || "{}"));
} catch (_) {}
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
};
const strat = () => STRATEGIES.find((s) => s.id === state.strategy) || STRATEGIES[0];
const paramsFor = (s) => ({ ...defaultsOf(s), ...(state.params[s.id] || {}) });

/* ---------- Controls ---------- */
function renderStrategies() {
  $("#strategies").innerHTML = STRATEGIES.map(
    (s) => `<label class="strategy ${s.id === state.strategy ? "is-on" : ""}">
      <input type="radio" name="strategy" value="${s.id}" ${s.id === state.strategy ? "checked" : ""} />
      <span class="strategy__name">${s.name}${s.experimental ? '<span class="badge badge--warn">Failed test</span>' : ""}</span>
      <span class="strategy__tag">${s.tagline}</span>
    </label>`
  ).join("");
}

function renderUniverse() {
  const sel = state.universe[state.strategy] || [];
  $("#universe").innerHTML = UNIVERSE.filter((u) => !(u.sym === "SPSK" && state.strategy !== "dip" && state.strategy !== "gap"))
    .map((u) => {
      const at = sel.indexOf(u.sym);
      return `<label class="chip ${at >= 0 ? "is-on" : ""}" title="${u.name}: ${u.note}">
        <input type="checkbox" value="${u.sym}" ${at >= 0 ? "checked" : ""} />
        ${state.strategy === "guard" ? `<span class="chip__order">${at + 1}</span>` : ""}
        ${u.sym}<span class="chip__kind">${u.kind}</span>
      </label>`;
    })
    .join("");
  const hasStocks = sel.some((s) => UNIVERSE.find((u) => u.sym === s)?.kind === "Stock");
  $("#universe-hint").textContent =
    UNIVERSE_HINT[state.strategy] +
    (hasStocks ? " Stocks were chosen today, knowing how they did, so their past results look better than you could have expected at the time." : "");
}

function renderFields() {
  const s = strat();
  const p = paramsFor(s);
  $("#fields").innerHTML = s.fields
    .map((f) => `<label>${f.label}<input type="number" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${p[f.key]}" /></label>`)
    .join("");
}

function syncInputs() {
  $("#capital").value = state.capital;
  $("#period").value = state.period;
  $("#slippage").value = state.slippage;
  $("#purify").value = state.purify;
  $("#seed").value = state.seed;
  document.querySelectorAll('input[name="source"]').forEach((r) => (r.checked = r.value === state.source));
  $("#seed-wrap").hidden = state.source !== "random";
}

function renderControls() {
  renderStrategies();
  renderUniverse();
  renderFields();
  syncInputs();
}

$("#strategies").addEventListener("change", (e) => {
  state.strategy = e.target.value;
  save();
  renderControls();
  run();
});
$("#universe").addEventListener("change", (e) => {
  const sym = e.target.value;
  const list = [...(state.universe[state.strategy] || [])];
  const i = list.indexOf(sym);
  if (e.target.checked && i < 0) list.push(sym);
  if (!e.target.checked && i >= 0) list.splice(i, 1);
  state.universe[state.strategy] = list;
  save();
  renderUniverse();
});
$("#fields").addEventListener("change", (e) => {
  const key = e.target.dataset.key;
  if (!key) return;
  const v = Number(e.target.value);
  if (!Number.isFinite(v)) return;
  state.params[state.strategy] = { ...(state.params[state.strategy] || {}), [key]: v };
  save();
});
$("#reset").addEventListener("click", () => {
  delete state.params[state.strategy];
  state.universe[state.strategy] = [...DEFAULT_UNIVERSE[state.strategy]];
  save();
  renderControls();
  run();
});
for (const [id, key] of [["capital", "capital"], ["period", "period"], ["slippage", "slippage"], ["purify", "purify"], ["seed", "seed"]]) {
  $(`#${id}`).addEventListener("change", (e) => {
    state[key] = key === "period" ? e.target.value : Number(e.target.value);
    save();
  });
}
document.querySelectorAll('input[name="source"]').forEach((r) =>
  r.addEventListener("change", () => {
    state.source = r.value;
    $("#seed-wrap").hidden = state.source !== "random";
    save();
  })
);
$("#controls").addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});
$("#compare").addEventListener("click", () => compareAll());

/* ---------- Data ---------- */
const cache = new Map();
async function getData(symbols) {
  const key = state.source === "random" ? `random:${state.seed}` : "real";
  const have = cache.get(key) || { series: {}, source: null, asOf: null };
  const missing = symbols.filter((s) => !have.series[s]);
  if (missing.length) {
    const got = await loadSeries(missing, { source: state.source, seed: state.seed });
    Object.assign(have.series, got.series);
    have.source = got.source;
    have.asOf = have.asOf && have.asOf > (got.asOf || "") ? have.asOf : got.asOf;
    cache.set(key, have);
  }
  return have;
}

function startDate(series) {
  if (state.period === "all") return "2020-01-02";
  const last = Object.values(series).reduce((m, s) => (s.d.at(-1) > m ? s.d.at(-1) : m), "");
  const d = new Date(last);
  d.setUTCFullYear(d.getUTCFullYear() - Number(state.period));
  return d.toISOString().slice(0, 10);
}

function simulate(s, symbols, data) {
  return runBacktest({
    series: data.series,
    symbols,
    strategy: s,
    params: paramsFor(s),
    capital: Math.max(100, state.capital || 10000),
    slippageBps: Math.max(0, state.slippage || 0),
    startDate: startDate(data.series),
    benchmark: BENCH,
  });
}

/* ---------- Charts ---------- */
const equityChart = new LineChart($("#equity-chart"), { height: 320, format: (v, axis) => (axis ? moneyAxis(v) : money(v)), label: "Account value over time, strategy versus buy and hold" });
const ddChart = new LineChart($("#dd-chart"), { height: 130, area: true, format: (v, axis) => (axis ? `${Math.round(v * 100)}%` : pct(v)), label: "Drawdown over time" });
const hist = new Histogram($("#hist-chart"), { height: 180, label: "Distribution of simulated one-year returns" });
const COLORS = () => {
  const cs = getComputedStyle(document.documentElement);
  return [cs.getPropertyValue("--series-1").trim(), cs.getPropertyValue("--series-2").trim()];
};

/* ---------- Run ---------- */
let last = null;
let running = false;

async function run() {
  if (running) return;
  running = true;
  stopReplay();
  const s = strat();
  const symbols = state.universe[s.id] || [];
  const btn = $("#run");
  btn.disabled = true;
  $("#status").textContent = "Running…";
  try {
    if (!symbols.length) throw new Error("Select at least one fund to trade.");
    const p = paramsFor(s);
    const need = [...new Set([...symbols, ...(s.requires ? s.requires(p) : []), BENCH])];
    const data = await getData(need);
    const t0 = performance.now();
    const result = simulate(s, symbols, data);
    const stats = summarize(result);
    const bench = summarizeSeries(result.benchmark, result.dates, result.capital);
    const odds = bootstrapYears(result.equity);
    const benchOdds = bootstrapYears(result.benchmark);
    const halves = splitHalves(result.equity, result.dates);
    last = { s, symbols, result, stats, bench, odds, benchOdds, halves, data };
    const ms = Math.round(performance.now() - t0);
    const src =
      data.source === "random"
        ? `<b>Random market</b> (seed ${state.seed})`
        : data.source === "live"
        ? `<b>Live prices</b> to ${data.asOf}`
        : `<b>Saved price history</b> to ${data.asOf}`;
    $("#status").innerHTML = `${src} · ${result.dates[0]} → ${result.dates.at(-1)} · ${result.dates.length.toLocaleString()} trading days · ran in ${ms} ms`;
    render();
  } catch (err) {
    $("#status").textContent = `Couldn't run: ${err.message}`;
  } finally {
    btn.disabled = false;
    running = false;
  }
}

function render() {
  const { s, result, stats, bench, odds, benchOdds, halves } = last;
  const [c1, c2] = COLORS();
  const benchLabel = `Buy & hold ${BENCH}`;

  // KPIs
  const kpi = (label, value, sub, klass = "") =>
    `<div class="kpi"><div class="kpi__label mono">${label}</div><div class="kpi__value ${klass}">${value}</div><div class="kpi__sub">${sub}</div></div>`;
  $("#kpis").innerHTML = [
    kpi("Ending value", money(stats.endValue), `from ${money(result.capital)}`),
    kpi("Total return", pct(stats.totalReturn), `${benchLabel}: ${pct(bench.totalReturn)}`, cls(stats.totalReturn)),
    kpi("Per year", pct(stats.cagr), `${benchLabel}: ${pct(bench.cagr)}`, cls(stats.cagr)),
    kpi("Worst drop", pct(stats.maxDrawdown), `${benchLabel}: ${pct(bench.maxDrawdown)}`, "down"),
    kpi("Win rate", stats.trades ? pctPlain(stats.winRate) : "—", stats.trades ? `95% likely range ${pctPlain(stats.winCI[0])}–${pctPlain(stats.winCI[1])} · ${stats.trades} trades` : "No closed trades"),
    kpi("Average trade", stats.trades ? pct(stats.expectancy, 2) : "—", stats.trades ? `wins ${pct(stats.avgWin, 1)} · losses ${pct(stats.avgLoss, 1)} · avg ${stats.avgDays.toFixed(1)} days` : "—", stats.trades ? cls(stats.expectancy) : ""),
    kpi("Return per unit of risk", stats.sharpe.toFixed(2), `Sharpe ratio · ${benchLabel}: ${bench.sharpe.toFixed(2)}`),
    kpi("Time invested", pctPlain(stats.exposure), "The rest sits in cash, earning no interest"),
  ].join("");

  // Charts
  const equitySeries = [
    { name: s.name, color: c1, values: result.equity },
    { name: benchLabel, color: c2, values: result.benchmark },
  ];
  $("#legend").innerHTML = equitySeries.map((x) => `<span><i class="swatch" style="background:${x.color}"></i>${x.name}</span>`).join("");
  equityChart.setData({ dates: result.dates, series: equitySeries });
  ddChart.setData({ dates: result.dates, series: [{ name: s.name, color: c1, values: drawdowns(result.equity) }], zero: 0 });

  // Odds
  if (odds) {
    hist.setData(odds.outcomes);
    $("#odds-text").innerHTML = `
      <div><span class="big">${pctPlain(odds.pGain)}</span> chance a year made money <span class="muted">(${benchLabel}: ${pctPlain(benchOdds.pGain)})</span></div>
      <div>Typical year <b>${pct(odds.p50)}</b>. A bad year (1 in 20) <b>${pct(odds.p5)}</b>; a good year (1 in 20) <b>${pct(odds.p95)}</b>.</div>
      <div>Chance of losing more than 10% in a year: <b>${pctPlain(odds.pLoss10)}</b> <span class="muted">(${benchLabel}: ${pctPlain(benchOdds.pLoss10)})</span></div>
      <div class="muted">Reality check: ${pct(halves[0].cagr)} a year in ${halves[0].from.slice(0, 4)}–${halves[0].to.slice(0, 4)}, ${pct(halves[1].cagr)} a year in ${halves[1].from.slice(0, 4)}–${halves[1].to.slice(0, 4)}. Similar halves mean the result isn't down to one lucky stretch.</div>`;
  } else {
    $("#odds-text").innerHTML = `<div class="muted">Not enough history in this period to estimate the odds.</div>`;
  }

  renderHalal();
  renderExplain();
  renderTrades();
}

function renderHalal() {
  const { result, symbols } = last;
  const kinds = symbols.map((s) => UNIVERSE.find((u) => u.sym === s)?.kind);
  const stocks = symbols.filter((_, i) => kinds[i] === "Stock");
  const maxExposure = Math.max(...result.exposure);
  const item = (ok, text, note) => `<li class="${ok ? "ok" : "warn"}"><span class="ic">${ok ? "✓" : "!"}</span><span>${text}<small>${note}</small></span></li>`;
  $("#checks").innerHTML = [
    item(true, "Long only", "Only buys and later sells shares it owns. No short selling."),
    item(maxExposure <= 1.0001, "No borrowing or leverage", `At most ${pctPlain(maxExposure)} of the account was invested at any time.`),
    item(true, "No options, futures or other derivatives", "Ordinary shares of funds only."),
    item(true, "No interest", "Uninvested cash earns nothing. In live trading, the broker's cash interest must be turned off or given away."),
    stocks.length
      ? item(false, "Shariah screening: check the stocks", `${stocks.join(", ")} must be checked against a current screen (for example Zoya or Musaffa) before trading. Status can change every quarter.`)
      : item(true, "Shariah-screened funds", "Every fund here follows a published Shariah standard with a supervisory board."),
  ].join("");
  const rate = Math.max(0, state.purify || 0) / 100;
  $("#purify-box").innerHTML = `<span class="mono muted">Purification estimate</span>
    <span class="amount">${money(result.dividends * rate)}</span>
    <span class="muted">${pctPlain(rate, 1)} of ${money(result.dividends)} in dividends received. Use each fund's published purification ratio, and give the amount to charity.</span>`;
}

function renderExplain() {
  const { s, stats, odds } = last;
  const evidence =
    stats.trades > 0
      ? `In this run it made <b>${stats.trades}</b> trades and won <b>${pctPlain(stats.winRate)}</b> of them (95% likely range ${pctPlain(stats.winCI[0])}–${pctPlain(stats.winCI[1])}). The average trade returned <b>${pct(stats.expectancy, 2)}</b> after costs.${odds ? ` In the resampled years it made money ${pctPlain(odds.pGain)} of the time.` : ""}${stats.trades < 30 ? " That's a small number of trades, so treat the win rate with caution." : ""}`
      : "No trades closed in this period.";
  $("#explain").innerHTML = `
    <span class="mono muted">How ${s.name} works</span>
    <h2 class="name">${s.name}</h2>
    <p class="idea">${s.idea}</p>
    <ol>${s.rules.map((r) => `<li>${r}</li>`).join("")}</ol>
    <p class="evidence">${evidence}</p>
    ${s.verdict ? `<p class="verdict"><b>Verdict:</b> ${s.verdict}</p>` : ""}`;
}

let showAllTrades = false;
function renderTrades() {
  const { result } = last;
  const rows = [...result.trades].reverse();
  const shown = showAllTrades ? rows : rows.slice(0, 40);
  $("#trade-count").textContent = `${result.trades.length} closed · ${result.open.length} open`;
  const openRows = result.open
    .map((o) => `<tr><td>${o.entryDate}</td><td>${o.sym}</td><td class="num">${o.entryPrice.toFixed(2)}</td><td>open</td><td class="num">${o.price.toFixed(2)}</td><td class="num">—</td><td class="num ${cls(o.ret)}">${pct(o.ret, 2)}</td><td class="num">${money(o.value)}</td><td>still held</td></tr>`)
    .join("");
  $("#trades").innerHTML = `<thead><tr><th>Bought</th><th>Fund</th><th class="num">Buy</th><th>Sold</th><th class="num">Sell</th><th class="num">Days</th><th class="num">Return</th><th class="num">Profit</th><th>Why</th></tr></thead>
    <tbody>${openRows}${shown
      .map(
        (t) => `<tr><td>${t.entryDate}</td><td>${t.sym}</td><td class="num">${t.entryPrice.toFixed(2)}</td><td>${t.exitDate}</td><td class="num">${t.exitPrice.toFixed(2)}</td><td class="num">${t.days}</td><td class="num ${cls(t.ret)}">${pct(t.ret, 2)}</td><td class="num ${cls(t.pnl)}">${money(t.pnl)}</td><td>${t.entryReason} → ${t.exitReason}</td></tr>`
      )
      .join("")}</tbody>`;
  $("#more-trades").hidden = showAllTrades || rows.length <= 40;
}
$("#more-trades").addEventListener("click", () => {
  showAllTrades = true;
  renderTrades();
});

/* ---------- Compare ---------- */
async function compareAll() {
  const btn = $("#compare");
  btn.disabled = true;
  $("#compare-card").hidden = false;
  $("#compare-table").innerHTML = `<tbody><tr><td>Running…</td></tr></tbody>`;
  try {
    const need = [...new Set(Object.values(DEFAULT_UNIVERSE).flat().concat("SPSK", BENCH))];
    const data = await getData(need);
    const rows = [];
    let benchRow = null;
    for (const s of STRATEGIES) {
      const r = simulate(s, state.universe[s.id]?.length ? state.universe[s.id] : DEFAULT_UNIVERSE[s.id], data);
      const st = summarize(r);
      const o = bootstrapYears(r.equity);
      rows.push({ s, st, o });
      if (!benchRow) benchRow = { st: summarizeSeries(r.benchmark, r.dates, r.capital), o: bootstrapYears(r.benchmark) };
    }
    const tr = (name, st, o, extra = "", current = false) =>
      `<tr class="${current ? "is-current" : ""}"><td>${name}</td><td class="num ${cls(st.cagr)}">${pct(st.cagr)}</td><td class="num">${pct(st.maxDrawdown)}</td><td class="num">${st.sharpe.toFixed(2)}</td><td class="num">${extra || (st.trades ? pctPlain(st.winRate) : "—")}</td><td class="num">${st.trades || "—"}</td><td class="num">${o ? pctPlain(o.pGain) : "—"}</td><td class="num">${o ? pctPlain(o.pLoss10) : "—"}</td><td class="num">${pctPlain(st.exposure)}</td></tr>`;
    $("#compare-table").innerHTML = `<thead><tr><th>Strategy</th><th class="num">Per year</th><th class="num">Worst drop</th><th class="num">Sharpe</th><th class="num">Win rate</th><th class="num">Trades</th><th class="num">Year up</th><th class="num">Year &lt; −10%</th><th class="num">Invested</th></tr></thead>
      <tbody>${rows.map(({ s, st, o }) => tr(s.name + (s.experimental ? " (failed test)" : ""), st, o, "", s.id === state.strategy)).join("")}
      ${tr(`Buy & hold ${BENCH}`, benchRow.st, benchRow.o, "—")}</tbody>`;
    $("#compare-note").textContent = `Same money, period and costs · each with its own funds`;
  } catch (err) {
    $("#compare-table").innerHTML = `<tbody><tr><td>Couldn't compare: ${err.message}</td></tr></tbody>`;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Replay ---------- */
let raf = 0;
function stopReplay() {
  cancelAnimationFrame(raf);
  raf = 0;
  $("#ticker").hidden = true;
  $("#replay").textContent = "▶ Watch it grow";
  if (last) {
    equityChart.setEnd(last.result.dates.length);
    ddChart.setEnd(last.result.dates.length);
  }
}
$("#replay").addEventListener("click", () => {
  if (!last) return;
  if (raf) return stopReplay();
  const n = last.result.dates.length;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const perSec = 140 * Number($("#speed").value || 2);
  const t0 = performance.now();
  $("#ticker").hidden = false;
  $("#replay").textContent = "■ Stop";
  const step = (now) => {
    const k = reduce ? n : Math.min(n, Math.max(1, Math.floor(((now - t0) / 1000) * perSec)));
    equityChart.setEnd(k);
    ddChart.setEnd(k);
    $("#ticker-date").textContent = last.result.dates[k - 1];
    $("#ticker-value").textContent = money(last.result.equity[k - 1]);
    if (k < n) raf = requestAnimationFrame(step);
    else { raf = 0; $("#replay").textContent = "↺ Replay"; }
  };
  raf = requestAnimationFrame(step);
});

/* ---------- Mode, user, sign out ---------- */
document.querySelectorAll(".tab[data-mode]").forEach((tab) =>
  tab.addEventListener("click", () => {
    const mode = tab.dataset.mode;
    document.querySelectorAll(".tab[data-mode]").forEach((t) => {
      t.classList.toggle("is-active", t === tab);
      t.setAttribute("aria-pressed", String(t === tab));
    });
    $("#sim").hidden = mode !== "sim";
    $("#live").hidden = mode !== "live";
  })
);
$("#signout").addEventListener("click", async () => {
  try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch (_) {}
  location.href = "/trader/login.html";
});
fetch("/api/me", { credentials: "same-origin" })
  .then((r) => (r.ok ? r.json() : null))
  .then((me) => { $("#who").textContent = me ? `Trading lab · ${me.email}` : "Trading lab · local preview"; })
  .catch(() => { $("#who").textContent = "Trading lab · local preview"; });

renderControls();
run();
