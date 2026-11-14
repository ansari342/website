import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession } from "../lib/google-auth.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/scenes-kawthar.json", import.meta.url), "utf8"));
const { POST } = await import("../api/rattil-scenes.js");
process.env.AUTH_SECRET = "s3cret";
const owner = `rattil_session=${await createSession("ansari342@gmail.com", "s3cret")}`;
const req = (body, origin = "https://site.test", cookie = owner) => new Request("https://site.test/api/rattil-scenes", { method: "POST", headers: { host: "site.test", origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

// Stand-in for the Upstash REST API, keeping totals in memory.
const store = new Map();
process.env.KV_REST_API_URL = "https://redis.test"; process.env.KV_REST_API_TOKEN = "t";
async function fakeRedisFetch(init) {
  const [cmd, key, n] = JSON.parse(init.body);
  if (cmd === "INCRBY") store.set(key, (store.get(key) || 0) + Number(n));
  return new Response(JSON.stringify({ result: cmd === "INCRBY" ? store.get(key) : 1 }));
}

// Pretend to be the Claude API: reply with the fixture's plan or scenes.
function fakeClaude(seen) {
  return async (url, init) => {
    if (url === "https://redis.test") return fakeRedisFetch(init);
    const body = JSON.parse(init.body);
    seen.push(body);
    const isPlan = /Plan the animations/.test(body.messages[0].content);
    const reply = isPlan ? fixture.plan : { scenes: fixture.scenes };
    return new Response(JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(reply) + "\n```" }], usage: { input_tokens: 3000, output_tokens: 2000 } }));
  };
}

test("without a key the endpoint says it isn't configured", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await POST(req({ surah: 108, from: 1, to: 3 }))).status, 503);
});

test("plan, then scenes for the asked ayahs only, with text from the bundled data", async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  const seen = [], real = globalThis.fetch;
  globalThis.fetch = fakeClaude(seen);
  try {
    const plan = await (await POST(req({ surah: 108, from: 1, to: 3 }))).json();
    assert.equal(plan.plan.ayahs.length, 3);
    assert.match(seen[0].messages[0].content, /ٱلۡكَوۡثَرَ/);
    const out = await (await POST(req({ surah: 108, from: 1, to: 3, plan: plan.plan, ayahs: [2, 3] }))).json();
    assert.deepEqual(out.scenes.map((s) => s.ayah), [2, 3]);
    assert.equal(seen[1].model, "claude-sonnet-5-5");
    // Two calls of 3000 in + 2000 out tokens = $0.052, recorded in micro-dollars.
    assert.equal([...store.values()][0], 52000);
  } finally { globalThis.fetch = real; }
});

test("only the signed-in owner can call it", async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  assert.equal((await POST(req({ surah: 108, from: 1, to: 3 }, "https://site.test", ""))).status, 401);
  const other = `rattil_session=${await createSession("someone@gmail.com", "s3cret")}`;
  assert.equal((await POST(req({ surah: 108, from: 1, to: 3 }, "https://site.test", other))).status, 401);
});

test("bad ranges and other sites are refused", async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  assert.equal((await POST(req({ surah: 115, from: 1, to: 2 }))).status, 400);
  assert.equal((await POST(req({ surah: 108, from: 2, to: 9 }))).status, 400);
  assert.equal((await POST(req({ surah: 108, from: 1, to: 3 }, "https://evil.test"))).status, 403);
});
