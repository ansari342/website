// Tuning tab: hill-climb results (tuned on 2021–24, tested on 2024–26).
// Clicking a row re-runs those settings on the test period and charts it.
import { runBacktest } from "./lib/engine.js";
import { summarize } from "./lib/stats.js";
import { walkForward, probabilityStrategy, filteredDipStrategy } from "./lib/daytrade.js";
import { dipBuyer, trendGuard } from "./lib/strategies.js";
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
  useDefensive: () => null,
};
const describe = (p) => Object.entries(p).map(([k, v]) => (PARAM_LABELS[k] ? PARAM_LABELS[k](v) : `${k} ${v}`)).filter(Boolean).join(" · ");

// Did tuning survive contact with unseen data?
function verdict(r) {
  const t = r.test;
  const beatsHold = t.cagr / Math.max(Math.abs(t.maxDrawdown), 0.1) > t.bench.cagr / Math.max(Math.abs(t.bench.maxDrawdown), 0.1);
  if (t.cagr <= 0) return { tag: "bad", text: "Lost money in testing" };
  if (r.train.cagr < 0.03) return { tag: "warn", text: "Inconsistent: weak while tuning, so the test result may be luck" };
  if (r.train.score > 0 && t.score < r.train.score * 0.4) return { tag: "warn", text: "Faded in testing" };
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

  // Headline findings, from the numbers.
  // Rank by the weaker of the two periods: a strategy has to work in both.
  const best = data.results
    .filter((r) => r.test.cagr > 0 && verdict(r).tag === "good")
    .map((r) => ({ r, s: Math.min(r.train.score, r.test.score) }))
    .sort((a, b) => b.s - a.s);
  const faded = data.results.filter((r) => verdict(r).tag !== "good");
  $("#tune-findings").innerHTML = best.length
    ? `<b>Worked in both periods:</b> ${best.map(({ r }) => `${r.name} on ${r.universeLabel.toLowerCase()} (${pct(r.test.cagr)} a year, worst drop ${pct(r.test.maxDrawdown)}; holding ${r.benchmark.replace("-USD", "")}: ${pct(r.test.bench.cagr)}, ${pct(r.test.bench.maxDrawdown)})`).join("; ")}. ${faded.length} of ${data.results.length} tuned strategies faded, lost money, or did worse for the risk than simply holding once tested on unseen years. Past results don't guarantee future ones.`
    : "None of the tuned strategies made money in the test period.";

  $("#tune-tables").innerHTML = Object.entries(groups)
    .map(([u, rows]) => {
      const bench = rows[0].benchmark.replace("-USD", "");
      return `<section class="card">
        <h3>${rows[0].universeLabel}</h3>
        <p class="hint" style="margin:0 0 12px">${rows[0].symbols.map((s) => s.replace("-USD", "")).join(", ")} · trading cost ${rows[0].costBps / 100}% per fill · compared with holding ${bench}${u === "crypto" ? " · <b>scholars differ on whether crypto is permissible</b>" : ""}${u === "stocks" ? " · stocks chosen with hindsight, which flatters results" : ""}</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Strategy and tuned settings</th><th class="num">Tuning years<br/>per year · worst drop</th><th class="num">Test years<br/>per year · worst drop</th><th class="num">Test trades<br/>won</th><th class="num">Test, default settings</th><th class="num">Test at 2.5× costs</th><th>Verdict</th></tr></thead>
          <tbody>${rows
            .map((r) => {
              const v = verdict(r);
              return `<tr data-u="${r.universe}" data-f="${r.family}" tabindex="0">
                <td><b>${r.name}</b><small>${describe(r.tuned)}</small></td>
                <td class="num"><span class="${cls(r.train.cagr)}">${pct(r.train.cagr)}</span> · ${pct(r.train.maxDrawdown)}</td>
                <td class="num"><span class="${cls(r.test.cagr)}">${pct(r.test.cagr)}</span> · ${pct(r.test.maxDrawdown)}</td>
                <td class="num">${r.test.trades}<small>${r.test.trades ? pctPlain(r.test.winRate) : "—"}</small></td>
                <td class="num"><span class="${cls(r.defaultTest.cagr)}">${pct(r.defaultTest.cagr)}</span> · ${pct(r.defaultTest.maxDrawdown)}</td>
                <td class="num ${cls(r.testHighCost.cagr)}">${pct(r.testHighCost.cagr)}</td>
                <td><span class="tag tag--${v.tag}">${v.text}</span></td>
              </tr>`;
            })
            .join("")}
            <tr><td><b>Hold ${bench}</b><small>buy once, never sell</small></td><td class="num">${pct(rows[0].train.bench.cagr)} · ${pct(rows[0].train.bench.maxDrawdown)}</td><td class="num">${pct(rows[0].test.bench.cagr)} · ${pct(rows[0].test.bench.maxDrawdown)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td></td></tr>
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
  document.querySelectorAll("#tune-tables tr.is-current").forEach((t) => t.classList.remove("is-current"));
  document.querySelector(`#tune-tables tr[data-u="${u}"][data-f="${f}"]`)?.classList.add("is-current");
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
    let strategy;
    let params = {};
    let symbols = r.symbols;
    if (f === "prob" || f === "dipmodel") {
      const wf = walkForward(series, r.symbols, { start: data.tune[0], end: to, maxHold: p.maxHold, stopPct: p.stopPct, exitLen: p.exitLen, costBps: r.costBps });
      strategy = f === "prob" ? probabilityStrategy(wf, p) : filteredDipStrategy(wf, p);
    } else if (f === "dip") {
      strategy = dipBuyer;
      params = p;
    } else {
      strategy = trendGuard;
      params = p;
      symbols = [r.benchmark];
    }
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
