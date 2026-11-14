// Turns the renderer's frames plus the person's audio into a video file.
// Fast path: WebCodecs H.264 + AAC into an MP4 (Chrome, Edge, recent Safari),
// faster than real time. Fallback: record the canvas while it plays, which
// takes as long as the recitation and gives MP4 on Safari, WebM elsewhere.

import { Muxer, ArrayBufferTarget } from "../vendor/mp4-muxer.mjs";
import { W, H, FPS } from "./render.js";

// H.264 + AAC in MP4 plays everywhere; a bare "video/mp4" can mean VP9 + Opus, so WebM is preferred over it.
const RECORDER_TYPES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm"];
const VIDEO_CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42003e", "avc1.640033"];

async function pickVideo() {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of VIDEO_CODECS) {
    const config = { codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, avc: { format: "avc" } };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch {}
  }
  return null;
}

async function pickAudio(buffer) {
  if (typeof AudioEncoder === "undefined") return null;
  const channels = Math.min(2, buffer.numberOfChannels);
  for (const sampleRate of [buffer.sampleRate, 48000, 44100]) {
    const config = { codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate: 192_000 };
    try { if ((await AudioEncoder.isConfigSupported(config)).supported) return config; } catch {}
  }
  return null;
}

// Resample to the encoder's rate when the file's rate is not supported.
async function resampled(buffer, rate) {
  if (buffer.sampleRate === rate) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * rate), rate);
  const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(ctx.destination); src.start();
  return ctx.startRendering();
}

export async function canEncodeFast(buffer) {
  return !!((await pickVideo()) && (await pickAudio(buffer)));
}

// renderer: { draw(ctx, t) }, buffer: AudioBuffer of the person's audio.
// onProgress(fraction). Resolves to a Blob.
export async function encode(renderer, buffer, duration, onProgress = () => {}) {
  const vConf = await pickVideo(), aConf = await pickAudio(buffer);
  if (vConf && aConf) return encodeWebCodecs(renderer, buffer, duration, vConf, aConf, onProgress);
  return encodeRealtime(renderer, buffer, duration, onProgress);
}

async function encodeWebCodecs(renderer, buffer, duration, vConf, aConf, onProgress) {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: FPS },
    audio: { codec: "aac", numberOfChannels: aConf.numberOfChannels, sampleRate: aConf.sampleRate },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failed = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failed = e) });
  venc.configure(vConf);
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failed = e) });
  aenc.configure(aConf);

  // Audio: whole buffer in 1024-sample planar chunks.
  const audio = await resampled(buffer, aConf.sampleRate);
  const ch = aConf.numberOfChannels, n = Math.min(audio.length, Math.ceil(duration * aConf.sampleRate));
  const planes = Array.from({ length: ch }, (_, c) => audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)));
  for (let i = 0; i < n; i += 1024) {
    const len = Math.min(1024, n - i), data = new Float32Array(len * ch);
    for (let c = 0; c < ch; c++) data.set(planes[c].subarray(i, i + len), c * len);
    const ad = new AudioData({ format: "f32-planar", sampleRate: aConf.sampleRate, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round(i / aConf.sampleRate * 1e6), data });
    aenc.encode(ad); ad.close();
  }

  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const frames = Math.round(duration * FPS);
  for (let f = 0; f < frames; f++) {
    if (failed) throw failed;
    renderer.draw(ctx, f / FPS);
    const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close();
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (f % 15 === 0) { onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush(); await aenc.flush();
  if (failed) throw failed;
  muxer.finalize();
  onProgress(1);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

async function encodeRealtime(renderer, buffer, duration, onProgress) {
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = buffer; src.connect(dest);
  const stream = new MediaStream([...cv.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  renderer.draw(ctx, 0);
  rec.start(500);
  const t0 = ac.currentTime + 0.1;
  src.start(t0);
  await new Promise((resolve) => {
    const tick = () => {
      const t = ac.currentTime - t0;
      renderer.draw(ctx, Math.max(0, t));
      onProgress(Math.min(1, t / duration));
      if (t >= duration) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop(); await stopped; src.stop(); ac.close();
  return new Blob(parts, { type: type.split(";")[0] });
}

// Over-the-video style: play the person's video (muted) and record the
// canvas as each frame is drawn with the text on top. The sound comes from
// the decoded audio, started together with the video. Takes as long as the
// clip.
export async function encodeOverVideo(renderer, video, buffer, duration, onProgress = () => {}) {
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  await ac.resume();
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = buffer; src.connect(dest);
  const stream = new MediaStream([...cv.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10_000_000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  video.pause(); video.muted = true; video.currentTime = 0;
  if (video.seeking || video.readyState < 2) await new Promise((r) => { video.addEventListener("seeked", r, { once: true }); video.addEventListener("canplay", r, { once: true }); });
  renderer.draw(ctx, 0);
  rec.start(500);
  await video.play();
  const t0 = ac.currentTime - video.currentTime;
  src.start(0, Math.max(0, video.currentTime));
  await new Promise((resolve) => {
    const tick = () => {
      const t = video.currentTime;
      renderer.draw(ctx, t);
      onProgress(Math.min(1, t / duration));
      if (video.ended || ac.currentTime - t0 >= duration) resolve(); else requestAnimationFrame(tick);
    };
    video.addEventListener("ended", resolve, { once: true });
    requestAnimationFrame(tick);
  });
  renderer.draw(ctx, duration);
  await new Promise((r) => setTimeout(r, 200));
  rec.stop(); await stopped;
  video.pause(); try { src.stop(); } catch {}
  ac.close?.();
  return new Blob(parts, { type: type.split(";")[0] });
}
