// 100 lab tab: results of scripts/lab100.mjs (tuned, then picked, then tested).
import { LineChart } from "./lib/chart.js";

const $ = (s) => document.querySelector(s);
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const pctPlain = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const cls = (v) => (v == null ? "" : v >= 0 ? "up" : "down");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const LABELS = {
  stop: (v) => (v ? `stop ${+(v * 100).toFixed(1)}%` : "no stop"),
  take: (v) => (v ? `take profit ${+(v * 100).toFixed(1)}%` : "no profit target"),
  hold: (v) => (v ? `sell after ${v} bars` : "no time limit"),
  thr: (v) => `buy at ≥ ${Math.round(v * 100)}% chance`,
  h: (v) => `hold ${v} days`,
};
const describe = (p) => Object.entries(p).map(([k, v]) => (LABELS[k] ? LABELS[k](v) : `${k} ${v}`)).join(" · ");

// How a strategy did on the final test, against simply holding the same assets.
function verdict(r) {
  const t = r.test;
  if (!t) return { tag: "warn", text: "Not enough data" };
  if (t.trades < 5) return { tag: "warn", text: "Barely traded in the test" };
  if (t.ret > 0 && t.ret > t.hold) return { tag: "good", text: "Made money and beat holding" };
  if (t.ret > 0) return { tag: "warn", text: "Made money, but holding did better" };
  if (t.ret > t.hold) return { tag: "warn", text: "Lost money, but less than holding" };
  return { tag: "bad", text: "Lost money and did worse than holding" };
}

let data = null;
let ranked = [];
const chart = new LineChart($("#lab-chart"), { height: 300, format: (v, axis) => (axis ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v).toLocaleString("en-US")}`), label: "Account value over the picking and final-test periods versus holding" });

function findings() {
  const ok = ranked.filter((r) => r.test && r.val);
  const eligible = ok.filter((r) => r.val.trades >= 10);
  const winner = eligible[0];
  const top10 = eligible.slice(0, 10);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const madeMoney = ok.filter((r) => r.test.ret > 0).length;
  const beatHold = ok.filter((r) => r.test.ret > r.test.hold).length;
  const both = ok.filter((r) => r.test.ret > 0 && r.test.ret > r.test.hold).length;
  const survived2x = ok.filter((r) => r.testDoubleCost > 0).length;
  const fast = ok.filter((r) => r.market === "c5");
  const fastUp = fast.filter((r) => r.test.ret > 0).length;
  const M = (k) => ok.find((r) => r.key === k);
  const mlLine = (mk, label) => {
    const a = M(`${mk}:mlprice`), b = M(`${mk}:mlalt`);
    return a && b ? `${label}: prices only ${pct(a.test.ret)}, with the extra data ${pct(b.test.ret)} (holding: ${pct(a.test.hold)})` : "";
  };
  const bestTest = [...ok].filter((r) => r.test.trades >= 10).sort((a, b) => b.test.ret - a.test.ret)[0];
  const m = (r) => data.markets[r.market].label.replace(/^Crypto/, "crypto").replace(/^Halal/, "halal");
  $("#lab-findings").innerHTML = `
    <p><b>The pick:</b> ${esc(winner.name)} on ${m(winner)} had the best picking-period return (${pct(winner.val.ret)}). On the untouched final test it returned <b>${pct(winner.test.ret)}</b>, against ${pct(winner.test.hold)} for simply holding the same assets.</p>
    <p><b>Spreading across the 10 best picks</b> would have returned ${pct(mean(top10.map((r) => r.test.ret)))} on the final test (holding: ${pct(mean(top10.map((r) => r.test.hold)))}).</p>
    <p><b>Of all 100 on the final test:</b> ${madeMoney} made money, ${beatHold} beat holding, ${both} did both, and ${survived2x} still made money at double the trading costs.</p>
    <p><b>The pick within each market</b> (best picking-period return → final test · holding): ${Object.keys(data.markets).map((mk) => { const r = eligible.find((x) => x.market === mk); return r ? `${esc(data.markets[mk].label)}: ${esc(r.name)} ${pct(r.test.ret)} · ${pct(r.test.hold)}` : ""; }).filter(Boolean).join("; ")}.</p>
    <p><b>Minute-level trading:</b> ${fastUp} of the ${fast.length} five-minute crypto strategies made money on the final test (average ${pct(mean(fast.map((r) => r.test.ret)))}; holding: ${pct(mean(fast.map((r) => r.test.hold)))}).</p>
    <p><b>Did extra data help the model?</b> ${[mlLine("ed", "Halal ETFs"), mlLine("cd", "Crypto")].filter(Boolean).join(". ")}.</p>
    <p class="muted">Best final-test result in hindsight: ${esc(bestTest.name)} on ${m(bestTest)} (${pct(bestTest.test.ret)}). That's shown for interest only; picking by the test result is exactly the mistake the three-way split avoids. Past results don't guarantee future ones.</p>`;
}

function board() {
  const mk = $("#lab-market").value;
  const rows = ranked.filter((r) => !mk || r.market === mk);
  $("#lab-board").innerHTML = `<thead><tr><th class="num">#</th><th>Strategy</th><th>Market</th><th class="num">Tuning<br/>per year</th><th class="num">Picking period<br/>return · holding</th><th class="num">Final test<br/>return · holding</th><th class="num">Test trades<br/>won</th><th class="num">Test<br/>worst drop</th><th class="num">Test at<br/>2× costs</th><th>Final-test verdict</th></tr></thead><tbody>${rows
    .map((r) => {
      const v = verdict(r);
      return `<tr data-key="${r.key}" tabindex="0"><td class="num">${ranked.indexOf(r) + 1}</td><td><b>${esc(r.name)}</b><small>${esc(r.group)} · ${esc(r.data)}</small></td><td>${esc(data.markets[r.market].label)}</td>
        <td class="num ${cls(r.tune?.yearly)}">${pct(r.tune?.yearly)}</td>
        <td class="num"><span class="${cls(r.val?.ret)}">${pct(r.val?.ret)}</span> · ${pct(r.val?.hold)}</td>
        <td class="num"><span class="${cls(r.test?.ret)}">${pct(r.test?.ret)}</span> · ${pct(r.test?.hold)}</td>
        <td class="num">${r.test?.trades ?? "—"}<small>${r.test?.trades ? pctPlain(r.test.winRate) : ""}</small></td>
        <td class="num">${pct(r.testDrop)}</td><td class="num ${cls(r.testDoubleCost)}">${pct(r.testDoubleCost)}</td>
        <td><span class="tag tag--${v.tag}">${v.text}</span></td></tr>`;
    })
    .join("")}</tbody>`;
}

function markets() {
  $("#lab-markets").innerHTML = `<thead><tr><th>Market</th><th>Traded</th><th class="num">Cost per fill</th><th>Tuned on</th><th>Picked on</th><th>Final test</th><th class="num">Strategies</th></tr></thead><tbody>${Object.entries(data.markets)
    .map(([k, m]) => `<tr><td>${esc(m.label)}</td><td>${m.assets.join(", ")}</td><td class="num">${(m.cost * 100).toFixed(2)}%</td><td>${m.splits[0]} → ${m.splits[1]}</td><td>${m.splits[1]} → ${m.splits[2]}</td><td>${m.splits[2]} → ${m.splits[3]}</td><td class="num">${data.rows.filter((r) => r.market === k).length}</td></tr>`)
    .join("")}</tbody>`;
  $("#lab-market").innerHTML = `<option value="">All markets</option>${Object.entries(data.markets).map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join("")}`;
}

function detail(key) {
  const r = data.rows.find((x) => x.key === key);
  if (!r) return;
  document.querySelectorAll("#lab-board tr.is-current").forEach((t) => t.classList.remove("is-current"));
  document.querySelector(`#lab-board tr[data-key="${key}"]`)?.classList.add("is-current");
  const m = data.markets[r.market];
  $("#lab-detail").hidden = false;
  $("#lab-detail-title").textContent = `${r.name} · ${m.label}`;
  $("#lab-params").innerHTML = `<span class="muted">${esc(r.idea)}</span>` + Object.entries(r.tuned).map(([k, v]) => `<span class="chip">${esc(LABELS[k] ? LABELS[k](v) : `${k} ${v}`)}</span>`).join("");
  if (!r.curve) { $("#lab-detail-status").textContent = "No chart: not enough data in this market's later periods."; return; }
  const css = getComputedStyle(document.documentElement);
  const dates = r.curve.days.map((d) => new Date(d * 864e5).toISOString().slice(0, 10));
  const lines = [
    { name: r.name, color: css.getPropertyValue("--series-1").trim(), values: r.curve.strat.map((v) => v * 10000) },
    { name: `Holding ${m.assets.length > 3 ? "the same assets" : m.assets.join(", ")}`, color: css.getPropertyValue("--series-2").trim(), values: r.curve.hold.map((v) => v * 10000) },
  ];
  $("#lab-legend").innerHTML = lines.map((x) => `<span><i class="swatch" style="background:${x.color}"></i>${esc(x.name)}</span>`).join("");
  chart.setData({ dates, series: lines });
  $("#lab-detail-status").textContent = `$10,000 from ${m.splits[1]} · picking period to ${m.splits[2]}: ${pct(r.val.ret)} · final test to ${m.splits[3]}: ${pct(r.test.ret)} (holding ${pct(r.test.hold)}) · settings: ${describe(r.tuned)}`;
  $("#lab-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("#lab-market").addEventListener("change", board);
$("#lab-board").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-key]"); if (tr) detail(tr.dataset.key); });
$("#lab-board").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-key]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); detail(tr.dataset.key); } });

let shown = false;
document.addEventListener("mode", async (e) => {
  if (e.detail !== "lab" || shown) return;
  shown = true;
  try {
    const res = await fetch("data/lab100.json");
    if (!res.ok) throw new Error("Lab results aren't available.");
    data = await res.json();
    // Rank by the picking (validation) period; strategies that barely traded there go last.
    ranked = [...data.rows].sort((a, b) => ((b.val?.trades ?? 0) >= 10) - ((a.val?.trades ?? 0) >= 10) || (b.val?.ret ?? -9) - (a.val?.ret ?? -9));
    markets();
    findings();
    board();
  } catch (err) {
    $("#lab-findings").textContent = err.message;
  }
});
