// Reads the AAC sound track out of an MP4, MOV or M4A file without
// re-encoding it. Used two ways:
// - as the sound of the finished video, copied in bit for bit, so it is
//   exactly the recording (no browser audio encoder involved);
// - to decode iPhone videos Safari refuses as a whole: recent iPhones add a
//   spatial-audio (APAC) track next to the AAC one.

import { createFile } from "../vendor/mp4box/mp4box.all.mjs";
import { Muxer, ArrayBufferTarget } from "../vendor/mp4-muxer.mjs";

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function findBox(box, type, depth = 0) {
  if (!box || depth > 6) return null;
  if (box.type === type) return box;
  for (const child of box.boxes || []) { const r = findBox(child, type, depth + 1); if (r) return r; }
  return null;
}

// The AAC decoder config: from the file's esds box (inside the QuickTime
// "wave" box in .MOV files), or built for AAC-LC from rate and channels.
function audioConfig(entry, rate, channels) {
  const esds = entry.esds || findBox(entry.wave, "esds") || findBox(entry, "esds");
  const dsi = esds?.esd?.descs?.[0]?.descs?.find?.((d) => d.tag === 5);
  if (dsi?.data?.length) return new Uint8Array(dsi.data);
  const idx = Math.max(0, RATES.indexOf(rate));
  return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
}

// bytes: ArrayBuffer of the file. Resolves to
// { codec, sampleRate, channels, description, samples: [{ data, ts, dur }] }
// with times in microseconds, or rejects if there is no AAC track.
export function readAac(bytes) {
  return new Promise((resolve, reject) => {
    const file = createFile();
    file.onError = (e) => reject(new Error(String(e)));
    file.onReady = (info) => {
      const track = info.audioTracks.find((t) => t.codec.startsWith("mp4a"));
      if (!track) return reject(new Error("no AAC sound track"));
      const entry = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
      const sampleRate = track.audio.sample_rate, channels = track.audio.channel_count;
      const out = { codec: track.codec, sampleRate, channels, description: audioConfig(entry, sampleRate, channels), samples: [] };
      file.onSamples = (_id, _user, samples) => {
        const t0 = samples.length ? samples[0].cts : 0;
        for (const s of samples) {
          const us = (t) => Math.round((t / s.timescale) * 1e6);
          out.samples.push({ data: new Uint8Array(s.data), ts: us(s.cts - t0), dur: us(s.duration) });
        }
        resolve(out);
      };
      file.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
      file.start();
    };
    try {
      const buf = bytes.slice(0); // mp4box keeps a reference and expects fileStart
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
    } catch (e) { reject(e); }
  });
}

// Add the AAC frames to an mp4-muxer Muxer, up to `untilUs` microseconds.
export function addAacToMuxer(muxer, aac, untilUs = Infinity) {
  const meta = { decoderConfig: { codec: aac.codec, sampleRate: aac.sampleRate, numberOfChannels: aac.channels, description: aac.description } };
  aac.samples.forEach((s, i) => { if (s.ts < untilUs) muxer.addAudioChunkRaw(s.data, "key", s.ts, s.dur, i ? undefined : meta); });
}

// The AAC track alone as an .m4a ArrayBuffer, for decoding.
export async function extractAac(bytes) {
  const aac = await readAac(bytes);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: "aac", numberOfChannels: aac.channels, sampleRate: aac.sampleRate }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
  addAacToMuxer(muxer, aac);
  muxer.finalize();
  return muxer.target.buffer;
}
