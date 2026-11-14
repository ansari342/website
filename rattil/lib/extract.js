// Copies the AAC sound track out of an MP4 or MOV video into a small
// audio-only MP4 (.m4a) that every browser can decode.
//
// Needed for recent iPhone videos: next to the normal AAC track they carry a
// spatial-audio track (APAC) and QuickTime-style headers, and Safari's
// decodeAudioData refuses the whole file. Nothing is re-encoded; the AAC
// frames are only moved into a new container.

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

// bytes: ArrayBuffer of the whole video. Resolves to an ArrayBuffer (.m4a),
// or rejects if the file has no AAC track.
export function extractAac(bytes) {
  return new Promise((resolve, reject) => {
    const file = createFile();
    file.onError = (e) => reject(new Error(String(e)));
    file.onReady = (info) => {
      const track = info.audioTracks.find((t) => t.codec.startsWith("mp4a"));
      if (!track) return reject(new Error("no AAC sound track in this video"));
      const entry = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
      const rate = track.audio.sample_rate, channels = track.audio.channel_count;
      const description = audioConfig(entry, rate, channels);
      const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: "aac", numberOfChannels: channels, sampleRate: rate }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
      const meta = { decoderConfig: { codec: track.codec, sampleRate: rate, numberOfChannels: channels, description } };
      file.onSamples = (_id, _user, samples) => {
        samples.forEach((s, i) => {
          const us = (t) => Math.round((t / s.timescale) * 1e6);
          muxer.addAudioChunkRaw(new Uint8Array(s.data), "key", us(s.cts), us(s.duration), i ? undefined : meta);
        });
        muxer.finalize();
        resolve(muxer.target.buffer);
      };
      file.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
      file.start();
    };
    const buf = bytes.slice(0); // mp4box keeps a reference and expects fileStart
    buf.fileStart = 0;
    file.appendBuffer(buf);
    file.flush();
  });
}
