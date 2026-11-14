// Turns the renderer's frames plus the person's audio into a video file.
//
// Fast path (Chrome, Edge, Safari 16.4+): frames are encoded with WebCodecs
// H.264 and written to an MP4. The sound is the recording's own AAC frames
// copied in unchanged when the upload has them (MP4, MOV, M4A); otherwise it
// is encoded with WebCodecs AAC. For the over-my-video style each frame of
// the upload is reached by seeking, so the result is frame-exact.
//
// Fallback (older browsers): record the canvas while it plays, in real time.

import { Muxer, ArrayBufferTarget } from "../vendor/mp4-muxer.mjs";
import { addAacToMuxer } from "./extract.js";
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

async function resampled(buffer, rate) {
  if (buffer.sampleRate === rate) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * rate), rate);
  const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(ctx.destination); src.start();
  return ctx.startRendering();
}

// Move a <video> to time t and wait until that frame is ready to draw.
function seek(video, t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-3 && !video.seeking && video.readyState >= 2) return resolve();
    const done = () => { clearTimeout(timer); video.removeEventListener("seeked", done); resolve(); };
    const timer = setTimeout(done, 1500);
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

// job: { renderer, buffer: AudioBuffer, aac: readAac() result or null,
//        video: <video> for the overlay style or null, duration, audioContext }
// audioContext must be created in the click handler (Safari only lets a
// context play after a tap); it is only used by the real-time fallback.
export async function encode(job, onProgress = () => {}) {
  const vConf = await pickVideo();
  const aConf = job.aac ? null : await pickAudio(job.buffer);
  if (vConf && (job.aac || aConf)) return encodeFast(job, vConf, aConf, onProgress);
  return encodeRealtime(job, onProgress);
}

async function encodeFast({ renderer, buffer, aac, video, duration }, vConf, aConf, onProgress) {
  const audio = aac ? { codec: "aac", numberOfChannels: aac.channels, sampleRate: aac.sampleRate } : { codec: "aac", numberOfChannels: aConf.numberOfChannels, sampleRate: aConf.sampleRate };
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: FPS }, audio, fastStart: "in-memory", firstTimestampBehavior: "offset" });
  let failed = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failed = e) });
  venc.configure(vConf);

  if (aac) addAacToMuxer(muxer, aac, duration * 1e6);
  else {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failed = e) });
    aenc.configure(aConf);
    const pcm = await resampled(buffer, aConf.sampleRate);
    const ch = aConf.numberOfChannels, n = Math.min(pcm.length, Math.ceil(duration * aConf.sampleRate));
    const planes = Array.from({ length: ch }, (_, c) => pcm.getChannelData(Math.min(c, pcm.numberOfChannels - 1)));
    for (let i = 0; i < n; i += 1024) {
      const len = Math.min(1024, n - i), data = new Float32Array(len * ch);
      for (let c = 0; c < ch; c++) data.set(planes[c].subarray(i, i + len), c * len);
      const ad = new AudioData({ format: "f32-planar", sampleRate: aConf.sampleRate, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round(i / aConf.sampleRate * 1e6), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush();
  }

  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const frames = Math.round(duration * FPS);
  if (video) video.pause();
  for (let f = 0; f < frames; f++) {
    if (failed) throw failed;
    const t = f / FPS;
    if (video) await seek(video, Math.min(t, video.duration - 0.001));
    renderer.draw(ctx, t);
    const vf = new VideoFrame(cv, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close();
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (f % 15 === 0) { onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush();
  if (failed) throw failed;
  muxer.finalize();
  onProgress(1);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

// Real time: draw while the sound plays and record both. For the overlay
// style the muted video plays along and is drawn underneath.
async function encodeRealtime({ renderer, buffer, video, duration, audioContext }, onProgress) {
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const ac = audioContext || new (window.AudioContext || window.webkitAudioContext)();
  await ac.resume();
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = buffer; src.connect(dest);
  const stream = new MediaStream([...cv.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 192_000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  if (video) { video.muted = true; await seek(video, 0); }
  renderer.draw(ctx, 0);
  rec.start(500);
  if (video) await video.play();
  const t0 = ac.currentTime + 0.05;
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
  await new Promise((r) => setTimeout(r, 200));
  rec.stop(); await stopped;
  try { src.stop(); } catch {}
  if (video) video.pause();
  if (!audioContext) ac.close?.();
  return new Blob(parts, { type: type.split(";")[0] });
}
