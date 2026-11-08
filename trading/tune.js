// Tuning tab: hill-climb results (tuned on 2021–24, tested on 2024–26).
// Clicking a row re-runs those settings on the test period and charts it.
import { runBacktest } from "./lib/engine.js";
import { summarize } from "./lib/stats.js";
import { walkForward } from "./lib/daytrade.js";
import { family, setup } from "./lib/catalog.js";
import { loadSeries } from "./lib/data.js";
import { LineChart } from "./lib/chart.js";

const $ = (s) => document.querySelector(s);
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const pctPlain = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const cls = (v) => (v == null ? "" : v >= 0 ? "up" : "down");
const money = (v) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyAxis = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : `$${Math.round(v)}`);

const PARAM_LABELS = {
  threshold: (v) => `buy at ≥ ${Math.round(v * 100)}% chance`,
  maxPositions: (v) => `up to ${v} at once`,
  size: (v) => `${Math.round(v * 100)}% each`,
  maxHold: (v) => `sell after ≤ ${v} days`,
  stopPct: (v) => `stop ${v < 1 ? Math.round(v * 1000) / 10 : v}%`,
  exitLen: (v) => `sell above ${v}-day avg`,
  entryRsi: (v) => `buy when 2-day RSI < ${v}`,
  trendLen: (v) => `trend: ${v}-day avg`,
  band: (v) => `buffer ${v}%`,
  useDefensive: (v) => (v ? "sukuk when defensive" : null),
  entryLen: (v) => `buy a ${v}-day high`,
  fast: (v) => `fast avg ${v} days`,
  slow: (v) => `slow avg ${v} days`,
  targetVol: (v) => `target volatility ${v}%`,
  volLen: (v) => `volatility over ${v} days`,
  buffer: (v) => `resize if off by > ${v}%`,
  top: (v) => `hold top ${v}`,
  topK: (v) => `only top ${v} by momentum`,
  lookback: (v) => `lookback ${v} days`,
  len: (v) => `bands over ${v} days`,
  k: (v) => `${v} std devs`,
  coreWeight: (v) => `${v}% in the core`,
  coreTrend: (v) => `core trend ${v}-day avg`,
};
const KIND = { original: "Original", new: "New idea", permutation: "Variation" };
const describe = (p) => Object.entries(p).map(([k, v]) => (PARAM_LABELS[k] ? PARAM_LABELS[k](v) : `${k} ${v}`)).filter(Boolean).join(" · ");

// Did tuning survive contact with unseen data?
function verdict(r) {
  const t = r.test;
  const beatsHold = t.cagr / Math.max(Math.abs(t.maxDrawdown), 0.1) > t.bench.cagr / Math.max(Math.abs(t.bench.maxDrawdown), 0.1);
  if (t.cagr <= 0) return { tag: "bad", text: "Lost money in testing" };
  if (r.train.cagr < 0.03) return { tag: "warn", text: "Inconsistent: weak while tuning, so the test result may be luck" };
  if (r.train.score > 0 && t.score < r.train.score * 0.4) return { tag: "warn", text: "Faded in testing" };
  const nb = r.neighbours;
  if (beatsHold && nb && nb.beatHold / nb.n < 0.5) return { tag: "warn", text: "Fragile: most nearby settings did worse than holding" };
  if (beatsHold) return { tag: "good", text: "Held up; better return for the risk than holding" };
  return { tag: "warn", text: "Held up, but holding did better for the risk" };
}

let data = null;
async function load() {
  if (data) return data;
  const res = await fetch("data/hillclimb.json");
  if (!res.ok) throw new Error("Tuning results aren't available.");
  data = await res.json();
  return data;
}

function render() {
  $("#tune-train").textContent = `${data.tune[0]} to ${data.tune[1]}`;
  $("#tune-test").textContent = `${data.tune[1]} to ${data.test[1]}`;
  const groups = {};
  for (const r of data.results) (groups[r.universe] ||= []).push(r);

  // Leaderboard: rank by the weaker of the two periods, so a strategy has to
  // work both while tuning and on the unseen years.
  const robust = (r) => Math.min(r.train.score, r.test.score);
  const ranked = [...data.results].sort((a, b) => robust(b) - robust(a));
  const good = ranked.filter((r) => verdict(r).tag === "good");
  const pick = (u) => good.find((r) => r.universe === u);
  const line = (r) => r ? `<b>${r.name}</b> (${pct(r.test.cagr)} a year, worst drop ${pct(r.test.maxDrawdown)} on the test years; holding ${r.benchmark.replace("-USD", "")}: ${pct(r.test.bench.cagr)}, ${pct(r.test.bench.maxDrawdown)}${r.neighbours ? `; ${r.neighbours.beatHold} of ${r.neighbours.n} nearby settings also beat holding` : ""})` : "nothing held up";
  $("#tune-findings").innerHTML = `
    <p><b>Best with no hindsight (halal ETFs only):</b> ${line(pick("etfs"))}.</p>
    <p><b>Best on the hand-picked halal stocks:</b> ${line(pick("stocks"))}. These stocks were chosen knowing they did well, which flatters every result on them.</p>
    <p><b>Best on crypto:</b> ${line(pick("crypto"))}. Scholars differ on whether crypto is permissible.</p>
    <p class="muted">${good.length} of ${data.results.length} tuned strategy-and-market pairs held up on the unseen years, beat simply holding for the risk taken, and weren't fragile. Past results don't guarantee future ones.</p>`;

  $("#tune-board").innerHTML = `<thead><tr><th class="num">#</th><th>Strategy</th><th>Market</th><th class="num">Tuning years<br/>per year · drop</th><th class="num">Test years<br/>per year · drop</th><th class="num">Nearby settings<br/>beating holding</th><th>Verdict</th></tr></thead><tbody>${ranked
    .map((r, i) => {
      const v = verdict(r);
      return `<tr data-u="${r.universe}" data-f="${r.family}" tabindex="0"><td class="num">${i + 1}</td><td><b>${r.name}</b><small>${KIND[r.kind] || ""}</small></td><td>${r.universeLabel.replace(" (no stock picking)", "").replace(" (spot only)", "")}</td><td class="num"><span class="${cls(r.train.cagr)}">${pct(r.train.cagr)}</span> · ${pct(r.train.maxDrawdown)}</td><td class="num"><span class="${cls(r.test.cagr)}">${pct(r.test.cagr)}</span> · ${pct(r.test.maxDrawdown)}</td><td class="num">${r.neighbours ? `${r.neighbours.beatHold}/${r.neighbours.n}` : "—"}</td><td><span class="tag tag--${v.tag}">${v.text}</span></td></tr>`;
    })
    .join("")}</tbody>`;

  const ORDER = ["etfs", "stocks", "crypto"];
  $("#tune-tables").innerHTML = Object.entries(groups)
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([u, rows]) => {
      const bench = rows[0].benchmark.replace("-USD", "");
      return `<section class="card">
        <h3>${rows[0].universeLabel}</h3>
        <p class="hint" style="margin:0 0 12px">${rows[0].symbols.map((s) => s.replace("-USD", "")).join(", ")} · trading cost ${rows[0].costBps / 100}% per fill · compared with holding ${bench}${u === "crypto" ? " · <b>scholars differ on whether crypto is permissible</b>" : ""}${u === "stocks" ? " · stocks chosen with hindsight, which flatters results" : ""}</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Strategy and tuned settings</th><th class="num">Tuning years<br/>per year · worst drop</th><th class="num">Test years<br/>per year · worst drop</th><th class="num">Test trades<br/>won</th><th class="num">Test, default settings</th><th class="num">Test at 2.5× costs</th><th class="num">Nearby settings<br/>beating holding</th><th>Verdict</th></tr></thead>
          <tbody>${rows
            .map((r) => {
              const v = verdict(r);
              return `<tr data-u="${r.universe}" data-f="${r.family}" tabindex="0">
                <td><b>${r.name}</b> <span class="muted mono">${KIND[r.kind] || ""}</span><small>${describe(r.tuned)}</small></td>
                <td class="num"><span class="${cls(r.train.cagr)}">${pct(r.train.cagr)}</span> · ${pct(r.train.maxDrawdown)}</td>
                <td class="num"><span class="${cls(r.test.cagr)}">${pct(r.test.cagr)}</span> · ${pct(r.test.maxDrawdown)}</td>
                <td class="num">${r.test.trades}<small>${r.test.trades ? pctPlain(r.test.winRate) : "—"}</small></td>
                <td class="num"><span class="${cls(r.defaultTest.cagr)}">${pct(r.defaultTest.cagr)}</span> · ${pct(r.defaultTest.maxDrawdown)}</td>
                <td class="num ${cls(r.testHighCost.cagr)}">${pct(r.testHighCost.cagr)}</td>
                <td class="num">${r.neighbours ? `${r.neighbours.beatHold}/${r.neighbours.n}` : "—"}</td>
                <td><span class="tag tag--${v.tag}">${v.text}</span></td>
              </tr>`;
            })
            .join("")}
            <tr><td><b>Hold ${bench}</b><small>buy once, never sell</small></td><td class="num">${pct(rows[0].train.bench.cagr)} · ${pct(rows[0].train.bench.maxDrawdown)}</td><td class="num">${pct(rows[0].test.bench.cagr)} · ${pct(rows[0].test.bench.maxDrawdown)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td></td></tr>
          </tbody></table></div>
      </section>`;
    })
    .join("");
}

/* ---------- Detail chart for one row ---------- */
const chart = new LineChart($("#tune-chart"), { height: 300, format: (v, axis) => (axis ? moneyAxis(v) : money(v)), label: "Test-period account value for the tuned settings versus holding" });
const seriesCache = {};
async function showDetail(u, f) {
  const r = data.results.find((x) => x.universe === u && x.family === f);
  if (!r) return;
  document.querySelectorAll(".tune tr.is-current").forEach((t) => t.classList.remove("is-current"));
  document.querySelectorAll(`.tune tr[data-u="${u}"][data-f="${f}"]`).forEach((t) => t.classList.add("is-current"));
  const box = $("#tune-detail");
  box.hidden = false;
  $("#tune-detail-title").textContent = `${r.name} · ${r.universeLabel} · test years`;
  $("#tune-detail-status").textContent = "Running these settings on the test years…";
  $("#tune-params").innerHTML = "";
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  await new Promise((res) => setTimeout(res, 30));
  try {
    const need = [...new Set([...r.symbols, r.benchmark, "SPSK"])].filter((s) => !seriesCache[s]);
    if (need.length) Object.assign(seriesCache, (await loadSeries(need, { source: "auto" })).series);
    const series = seriesCache;
    const [from, to] = data.test;
    const p = r.tuned;
    const F = family(f);
    const wf = F.needsModel ? walkForward(series, r.symbols, { start: data.tune[0], end: to, maxHold: p.maxHold, stopPct: p.stopPct, exitLen: p.exitLen, costBps: r.costBps }) : null;
    const { strategy, params, symbols } = setup(F, p, r.symbols, r.benchmark, wf);
    const res = runBacktest({ series, symbols, strategy, params, capital: 10000, slippageBps: r.costBps, startDate: from, endDate: to, benchmark: r.benchmark });
    const s = summarize(res);
    const css = getComputedStyle(document.documentElement);
    const lines = [
      { name: `${r.name} (tuned)`, color: css.getPropertyValue("--series-1").trim(), values: res.equity },
      { name: `Holding ${r.benchmark.replace("-USD", "")}`, color: css.getPropertyValue("--series-2").trim(), values: res.benchmark },
    ];
    $("#tune-legend").innerHTML = lines.map((x) => `<span><i class="swatch" style="background:${x.color}"></i>${x.name}</span>`).join("");
    chart.setData({ dates: res.dates, series: lines });
    $("#tune-detail-status").textContent = `${from} → ${to} · ${money(10000)} grew to ${money(res.equity.at(-1))} · ${pct(s.cagr)} a year · worst drop ${pct(s.maxDrawdown)} · ${res.trades.length} trades`;
    $("#tune-params").innerHTML =
      Object.entries(p)
        .map(([k, v]) => (PARAM_LABELS[k] && PARAM_LABELS[k](v) ? `<span class="chip">${PARAM_LABELS[k](v)}</span>` : ""))
        .join("") +
      (f === "prob" ? ` <button type="button" class="btn btn--small" id="tune-apply">Try in Quick trades →</button>` : "");
    $("#tune-apply")?.addEventListener("click", () => {
      document.querySelector('.tab[data-mode="day"]').click();
      document.dispatchEvent(
        new CustomEvent("apply-prob", {
          detail: { symbols: r.symbols, threshold: Math.round(p.threshold * 1000) / 10, max: p.maxPositions, size: Math.round(p.size * 100), hold: p.maxHold, stop: Math.round(p.stopPct * 1000) / 10, exit: p.exitLen, cost: r.costBps },
        })
      );
    });
  } catch (err) {
    $("#tune-detail-status").textContent = `Couldn't run: ${err.message}`;
  }
}

$("#tune-board").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-f]");
  if (tr) showDetail(tr.dataset.u, tr.dataset.f);
});
$("#tune-tables").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-f]");
  if (tr) showDetail(tr.dataset.u, tr.dataset.f);
});
$("#tune-tables").addEventListener("keydown", (e) => {
  const tr = e.target.closest("tr[data-f]");
  if (tr && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    showDetail(tr.dataset.u, tr.dataset.f);
  }
});

let shown = false;
document.addEventListener("mode", async (e) => {
  if (e.detail !== "tune" || shown) return;
  shown = true;
  try {
    await load();
    render();
  } catch (err) {
    $("#tune-tables").textContent = err.message;
  }
});
