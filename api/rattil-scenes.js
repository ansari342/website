// POST /api/rattil-scenes
// Asks Claude to design the per-ayah line animations for Rattil videos.
//
//   { surah, from, to }                    -> { plan }    passage theme, recurring thread, one idea per ayah
//   { surah, from, to, plan, ayahs: [n] }  -> { scenes }  full scenes for those ayahs (up to 4)
//
// The ayah text is read from the bundled Quran data, never taken from the
// request, so this can't be used as a general-purpose AI endpoint. Needs
// ANTHROPIC_API_KEY in Vercel; without it the page uses its built-in motifs.

import { readFileSync } from "node:fs";
import { MODEL, planPrompt, scenesPrompt, parseJson, cleanPlan } from "../lib/rattil-prompt.js";


let quran = null;
const loadQuran = () => (quran ||= JSON.parse(readFileSync(new URL("../rattil/data/quran.json", import.meta.url), "utf8")));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function ask({ system, user }, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return parseJson(data.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "not configured" }, 503);
  // Only this site's pages may call it.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return json({ error: "forbidden" }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const q = loadQuran();
  const surah = Number(body.surah), from = Number(body.from), to = Number(body.to);
  const su = q.surahs[surah - 1];
  if (!su || !(from >= 1 && to >= from && to <= su.ar.length && to - from < 60)) return json({ error: "bad range" }, 400);
  const passage = { surah, name: su.name, from, to, ayahs: [] };
  for (let n = from; n <= to; n++) passage.ayahs.push({ n, ar: su.ar[n - 1], en: su.en[n - 1] });

  try {
    if (!body.plan) {
      const plan = cleanPlan(await ask(planPrompt(passage), 4000), from, to);
      return json({ plan });
    }
    const plan = cleanPlan(body.plan, from, to);
    const ns = [...new Set((body.ayahs || []).map(Number))].filter((n) => n >= from && n <= to).slice(0, 4);
    if (!ns.length) return json({ error: "no ayahs" }, 400);
    const out = await ask(scenesPrompt(passage, plan, ns), 12000);
    const scenes = (out.scenes || []).filter((s) => ns.includes(Number(s?.ayah)));
    return json({ scenes });
  } catch (err) {
    return json({ error: String(err.message || err).slice(0, 300) }, 502);
  }
}
