// Runs the Quran speech model in the background so the page stays responsive.
// Model: Tarteel AI's whisper-base-ar-quran, as an 8-bit browser build.
// The files (about 100 MB) download once and the browser caches them.

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";

const MODEL = "nael239/tasme3-whisper-base-ar-quran-web";
env.allowLocalModels = false;

let asr = null;

async function load() {
  if (asr) return asr;
  const files = new Map();
  const progress = (p) => {
    if (p.status !== "progress" || !p.total) return;
    files.set(p.file, [p.loaded, p.total]);
    let loaded = 0, total = 0;
    for (const [l, t] of files.values()) { loaded += l; total += t; }
    postMessage({ type: "download", loaded, total });
  };
  const opts = { dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, progress_callback: progress };
  // WebAssembly runs these 8-bit weights everywhere, phones included.
  asr = await pipeline("automatic-speech-recognition", MODEL, { ...opts, device: "wasm" });
  return asr;
}

// { audio: Float32Array at 16 kHz, groups: [[start, end], ...] seconds }
onmessage = async ({ data }) => {
  try {
    const model = await load();
    postMessage({ type: "ready" });
    const out = [];
    for (let i = 0; i < data.groups.length; i++) {
      const [s, e] = data.groups[i];
      // A little padding so first and last letters are not clipped.
      const clip = data.audio.subarray(Math.max(0, Math.floor((s - 0.15) * 16000)), Math.min(data.audio.length, Math.ceil((e + 0.15) * 16000)));
      const r = await model(clip, { language: "arabic", task: "transcribe" });
      out.push({ start: s, end: e, text: (r.text || "").trim() });
      postMessage({ type: "group", done: i + 1, total: data.groups.length, text: out[i].text });
    }
    postMessage({ type: "done", segments: out });
  } catch (err) {
    postMessage({ type: "error", message: String(err?.message || err) });
  }
};
