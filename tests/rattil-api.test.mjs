import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/scenes-kawthar.json", import.meta.url), "utf8"));
const { POST } = await import("../api/rattil-scenes.js");
const req = (body, origin = "https://site.test") => new Request("https://site.test/api/rattil-scenes", { method: "POST", headers: { host: "site.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });

// Pretend to be the Claude API: reply with the fixture's plan or scenes.
function fakeClaude(seen) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    const isPlan = /Plan the animations/.test(body.messages[0].content);
    const reply = isPlan ? fixture.plan : { scenes: fixture.scenes };
    return new Response(JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(reply) + "\n```" }] }));
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
  } finally { globalThis.fetch = real; }
});

test("bad ranges and other sites are refused", async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  assert.equal((await POST(req({ surah: 115, from: 1, to: 2 }))).status, 400);
  assert.equal((await POST(req({ surah: 108, from: 2, to: 9 }))).status, 400);
  assert.equal((await POST(req({ surah: 108, from: 1, to: 3 }, "https://evil.test"))).status, 403);
});
