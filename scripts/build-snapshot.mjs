// Build the bundled price snapshot used when live data is unavailable.
// Usage: node scripts/build-snapshot.mjs <dir with Yahoo chart JSON files>
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeYahoo } from "../lib/yahoo.js";

const src = process.argv[2];
if (!src) throw new Error("Pass the folder that holds the downloaded Yahoo JSON files");
const index = {};
for (const f of readdirSync(src).filter((f) => f.endsWith(".json"))) {
  const s = normalizeYahoo(JSON.parse(readFileSync(join(src, f), "utf8")));
  writeFileSync(new URL(`../trader/data/${s.symbol}.json`, import.meta.url), JSON.stringify(s));
  index[s.symbol] = { name: s.name, from: s.d[0], to: s.d.at(-1), bars: s.d.length };
}
writeFileSync(new URL("../trader/data/index.json", import.meta.url), JSON.stringify(index, null, 1));
console.log(index);
