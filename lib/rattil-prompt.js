// Prompts for Rattil's per-ayah animations (used by api/rattil-scenes.js).
// Two steps: a short plan for the whole passage, then full scenes for a few
// ayahs at a time, each written with the plan and whole passage in view.

import { GLYPH_NAMES } from "../rattil/lib/scenes.js";

export const MODEL = "claude-sonnet-5-5";

const RULES = `Strict rules, never broken:
- Thin white line art on black only. Abstract, symbolic, calm and reverent.
- Never depict people, prophets, angels, jinn, faces, eyes, bodies, hands or any animal (including birds, fish, whales, elephants, insects, cattle, camels). Show them only through symbols: an army as a dense mass of particles, birds as falling dots of stone, a whale as an enclosing curve under waves, a people as a cluster of small dots, a messenger's mission as a path or a light.
- Never depict or suggest an image of Allah. Divine action is shown only indirectly: light descending, a path made clear, rain, growth, order emerging.
- No letters, words, numbers or calligraphy.
- Nothing graphic: punishment and destruction are shown abstractly (things fading, crumbling, scattering, darkness), never violently.`;

const PASSAGE = (p) => p.ayahs.map((a) => `[${a.n}] ${a.ar}\n${a.en}`).join("\n\n");

export function planPrompt(p) {
  return {
    system: `You design short abstract line animations for Quran recitation videos: one scene under each ayah while it is recited.\n\n${RULES}`,
    user: `Surah ${p.name} (${p.surah}), ayahs ${p.from}-${p.to}:\n\n${PASSAGE(p)}

Plan the animations for this passage as a connected visual story.
1. In one or two sentences, say what this passage is about and where it sits in the surah's message (draw on its context and the classical understanding of the surah).
2. Choose one recurring visual thread that runs through all the scenes and changes as the passage unfolds (for example a horizon that darkens then dawns, a seed that becomes a tree, a path that splits, a light that grows).
3. For every ayah, give one sentence: what that ayah specifically says, and the image that will express it, including how the recurring thread appears in it. Each ayah's image must be distinct; no two scenes should share the same central image.

Reply with JSON only, in this shape:
{"theme": "...", "thread": "...", "ayahs": [{"n": 1, "meaning": "...", "image": "..."}]}`,
  };
}

const FORMAT = `Scene format. The canvas is 1080 wide x 560 tall (x right, y down). Keep content inside x 60-1020, y 30-530.
A scene is {"ayah": n, "idea": "one line", "elements": [ ... 4 to 12 elements ... ]}.
Every element has "type" and may have:
  "at": 0-1, when it starts drawing, as a fraction of the ayah's time on screen; "dur": 0.05-0.6, how long it takes to draw (same units);
  "end": 0-1, when it fades away (use for things that pass, perish or are replaced);
  "width": 1-5 (line thickness), "alpha": 0.15-1;
  "motion": {"kind": float|sway|pulse|rise|sink|drift|spin|grow|shrink|flicker, "amount": 0-1, "speed": 0.2-3}.
Types:
  {"type":"glyph","name": one of [${GLYPH_NAMES.join(", ")}], "x","y" (centre), "size": 20-500, "rotate": degrees, "flip": true|false}
  {"type":"path","points":[[x,y],...2-16 points],"smooth":true|false,"closed":true|false}  (horizons, rivers, roads, outlines of anything not in the glyph list)
  {"type":"circle","x","y","r","from","to"}  (degrees, 0 = right, clockwise; partial arcs allowed)
  {"type":"wave","x0","x1","y","amp","waves","speed"}  (water, sound, breath, wind over ground)
  {"type":"rays","x","y","count","inner","outer","spread","dir"}  (dir in degrees: 90 = down, -90 = up)
  {"type":"ripples","x","y","count","maxR"}
  {"type":"particles","mode": rise|fall|drift|orbit|converge|scatter|twinkle,"count": 1-120,"region":[x0,y0,x1,y1],"size": 1-10,"speed"}
  {"type":"branch","x","y","len","depth": 1-6,"dir","spread"}  (trees, roots, rivers branching, lightning)
  {"type":"dots","points":[[x,y],...],"size"}  (dots appearing one after another)
Craft:
- Build the scene in stages over the ayah: stagger "at" from 0 to about 0.7 so it unfolds while the ayah is recited, and resolves near the end.
- Compose with intent: use the whole width, vary scale and placement, layer thin (1-2) and bold (3-4) lines, and use motion so it feels alive. Avoid one glyph alone in the middle.
- Carry the passage's recurring thread into every scene, changed to match the moment.`;

export function scenesPrompt(p, plan, ns) {
  const want = plan.ayahs.filter((a) => ns.includes(a.n)).map((a) => `[${a.n}] meaning: ${a.meaning}\n     image: ${a.image}`).join("\n");
  return {
    system: `You design short abstract line animations for Quran recitation videos, as JSON scenes drawn by a small renderer.\n\n${RULES}\n\n${FORMAT}`,
    user: `Surah ${p.name} (${p.surah}), ayahs ${p.from}-${p.to}:\n\n${PASSAGE(p)}

Plan for the passage:
Theme: ${plan.theme}
Recurring thread: ${plan.thread}
Scene ideas:
${plan.ayahs.map((a) => `[${a.n}] ${a.image}`).join("\n")}

Now write the full scenes for these ayahs only:
${want}

Reply with JSON only: {"scenes": [ ...one scene per ayah listed above, in order... ]}`,
  };
}

// The first JSON object in a model reply.
export function parseJson(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(start, end + 1));
}

// Keep a plan to the expected shape and size before it is reused in a prompt.
export function cleanPlan(plan, from, to) {
  const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").slice(0, n);
  if (!plan || !Array.isArray(plan.ayahs)) throw new Error("bad plan");
  const ayahs = [];
  for (let n = from; n <= to; n++) {
    const a = plan.ayahs.find((x) => Number(x?.n) === n) || {};
    ayahs.push({ n, meaning: s(a.meaning, 300), image: s(a.image, 400) });
  }
  return { theme: s(plan.theme, 500), thread: s(plan.thread, 300), ayahs };
}

// ---------- Sky style: one continuous drawn world ----------
// Claude picks a "moment" per ayah (sky colours, light, weather and
// landscape) and the renderer blends between them; see rattil/lib/world.js.

const WORLD_RULES = `Strict rules, never broken:
- Only sky, space, weather and landscape: stars, nebulae, aurora, sun, moon, clouds, mist, rain, mountains, hills, dunes, mesas, plains, sea.
- No people, prophets, angels, faces, bodies, animals, buildings, objects, letters or numbers (the renderer cannot draw them anyway).
- Never suggest an image of Allah. Divine action is felt only through light, rain, dawn, clearing skies and growth.
- Calm and reverent. Warnings and judgement are shown through weather and light (storm darkness, rain, a red dusk, the land sinking away), never anything graphic.`;

export function worldPrompt(p, fields, example, avoid = "") {
  return {
    system: `You design the background for Quran recitation videos: one continuous drawn world of sky, space and landscape behind the text. For each ayah you choose a "moment"; the renderer blends smoothly from each moment to the next, so the whole passage plays as one unbroken shot.\n\n${WORLD_RULES}`,
    user: `Surah ${p.name} (${p.surah}), ayahs ${p.from}-${p.to}:\n\n${PASSAGE(p)}

Design one moment per ayah so the world changes with the meaning: for example night and stars for the unseen or for night oaths, dawn for hope and revelation, rain over land for revival, a storm or red dusk for warning, golden light over hills for paradise and reward, the camera rising into space for the heavens and the vastness of creation, the sea for provision or for the stories of the sea.
- Think of the passage as one journey with a clear arc and a recurring thread. Neighbouring moments should be related, changing a few things at a time, so the blends feel natural.
- Each ayah should still have its own distinct moment that a viewer could feel matches what is being recited.
- Text sits over the middle of the screen in white, so keep the middle of the sky reasonably dark or soft (avoid a pure white sky).
${avoid ? `- Make this a different design from the previous one, whose theme was: "${avoid.slice(0, 300)}".\n` : ""}
Fields for every moment:
  "ayah": number, "idea": one short line on what this moment shows and why,
  "sky": four hex colours from the horizon up: [horizon, just above it, high sky, top of the sky],
  "cloudColor", "landColor" (the nearest ridge; far ridges fade toward the sky colour): hex colours,
  "land": one of mountains, hills, dunes, mesas, plain, sea, space ("space" sinks the land out of view; use it with a high altitude),
  numbers: ${fields}
  (sunHeight is how high the sun sits above the horizon, as a fraction of the sky; negative is just below the ridges. altitude is the camera: 0 = standing at the horizon, 1 = up among the stars; the land is out of view above about 0.5.)

Example of one moment: ${JSON.stringify(example)}

Reply with JSON only: {"theme": "one or two sentences on the passage and the journey you chose", "frames": [ one moment per ayah, in order ]}`,
  };
}
