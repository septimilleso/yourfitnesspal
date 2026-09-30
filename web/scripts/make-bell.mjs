import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Original sound synthesized here; no third-party recordings or licenses are used.
const sampleRate = 22_050;
const durationSeconds = 1.6;
const sampleCount = Math.round(sampleRate * durationSeconds);
const strikes = [0, 0.45];
const partialRatios = [1, 2, 2.76, 5.4];
const partialGains = [1, 0.52, 0.3, 0.16];
const partialDecaySeconds = [0.48, 0.36, 0.28, 0.2];
const attackSeconds = 0.002;
const samples = new Float64Array(sampleCount);

for (const strike of strikes) {
  for (let i = 0; i < sampleCount; i += 1) {
    const elapsed = i / sampleRate - strike;
    if (elapsed < 0) continue;
    const attack = Math.min(1, elapsed / attackSeconds);
    let value = 0;
    for (let partial = 0; partial < partialRatios.length; partial += 1) {
      const frequency = 1_320 * partialRatios[partial];
      value +=
        partialGains[partial] *
        Math.sin(2 * Math.PI * frequency * elapsed) *
        Math.exp(-elapsed / partialDecaySeconds[partial]);
    }
    samples[i] += value * attack;
  }
}

let peak = 0;
for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
const targetPeak = 10 ** (-1 / 20);
const normalization = peak === 0 ? 0 : targetPeak / peak;
const pcm = Buffer.alloc(sampleCount * 2);
for (let i = 0; i < sampleCount; i += 1) {
  const value = Math.max(-1, Math.min(1, samples[i] * normalization));
  pcm.writeInt16LE(Math.round(value * 32_767), i * 2);
}

const wav = Buffer.alloc(44 + pcm.length);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);

const outputPath = join(dirname(fileURLToPath(import.meta.url)), "../public/sounds/rest-bell.wav");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, wav);
console.log(`Wrote ${outputPath} (${wav.length} bytes)`);
