// Local test audio. Not speech, and not the MSI recording.
// Two voiced bursts sit in the band LivLiv's envelope uses (about 150-1500 Hz),
// with a second formant placed so the spectral vowel cue can tell them apart.

const attack = 0.03
const release = 0.04

function env(t, a, b) {
  const up = Math.min(1, Math.max(0, (t - a) / attack))
  const down = Math.min(1, Math.max(0, (b - t) / release))
  return Math.min(up, down)
}

function tone(t, hz) {
  return Math.sin(2 * Math.PI * hz * t)
}

/** 24 kHz mono PCM WAV: silence, an /a/-like burst, silence, an /i/-like burst, silence. */
export function syntheticVowelsWav(sampleRate = 24000) {
  const seconds = 2.4
  const n = Math.round(sampleRate * seconds)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    let s = 0
    if (t >= 0.3 && t < 0.95) {
      const e = env(t, 0.3, 0.95)
      s += e * (0.34 * tone(t, 140) + 0.42 * tone(t, 730) + 0.22 * tone(t, 1150))
    }
    if (t >= 1.25 && t < 1.95) {
      const e = env(t, 1.25, 1.95)
      s += e * (0.28 * tone(t, 190) + 0.46 * tone(t, 340) + 0.2 * tone(t, 2700))
    }
    const y = Math.max(-1, Math.min(1, s))
    pcm[i] = (y * 32000) | 0
  }
  return wavFromPcm16(pcm, sampleRate)
}

export function wavFromPcm16(pcm, sampleRate) {
  const dataSize = pcm.length * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const write = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)) }
  write(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  write(36, 'data')
  v.setUint32(40, dataSize, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true)
  return new Uint8Array(buf)
}

/** PCM16 mono samples from a canonical WAV (no extra chunks). */
export function pcm16FromWav(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV')
  let o = 12
  let rate = 0
  let channels = 0
  let dataAt = -1
  let dataSize = 0
  while (o + 8 <= b.length) {
    const id = tag(o)
    const size = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      if (v.getUint16(o + 8, true) !== 1 || v.getUint16(o + 22, true) !== 16) throw new Error('WAV is not 16-bit PCM')
      channels = v.getUint16(o + 10, true)
      rate = v.getUint32(o + 12, true)
    } else if (id === 'data') {
      dataAt = o + 8
      dataSize = size
      break
    }
    o += 8 + size + (size & 1)
  }
  if (dataAt < 0 || channels < 1) throw new Error('WAV data chunk missing')
  const frames = Math.floor(dataSize / (2 * channels))
  const pcm = new Float32Array(frames)
  for (let i = 0; i < frames; i++) pcm[i] = v.getInt16(dataAt + i * 2 * channels, true) / 32768
  return { pcm, sampleRate: rate, channels }
}

/** Loud region of a PCM16 WAV, in milliseconds. Speech-band energy only (about 150-1500 Hz).
 *  A relative gate, not a phoneme aligner. */
export function loudRegionMs(bytes) {
  const { pcm, sampleRate } = pcm16FromWav(bytes)
  const lp = 1 - Math.exp((-2 * Math.PI * 1500) / sampleRate)
  const hp = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate)
  let low = 0
  let band = 0
  const filtered = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    low += (pcm[i] - low) * lp
    band += (low - band) * hp
    filtered[i] = low - band
  }
  const hop = Math.max(1, Math.round(sampleRate * 0.02))
  const rms = []
  for (let i = 0; i < filtered.length; i += hop) {
    let s = 0
    const n = Math.min(hop, filtered.length - i)
    for (let j = 0; j < n; j++) s += filtered[i + j] * filtered[i + j]
    rms.push(Math.sqrt(s / n))
  }
  const peak = rms.reduce((m, x) => Math.max(m, x), 0)
  const thr = Math.max(0.01, peak * 0.28)
  let a = -1
  let b = -1
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= thr) {
      if (a < 0) a = i
      b = i
    }
  }
  if (a < 0) return { startMs: 0, durationMs: Math.round(pcm.length / sampleRate * 1000), peak }
  const startMs = Math.max(0, Math.round(a * 20 - 30))
  const endMs = Math.min(Math.round(pcm.length / sampleRate * 1000), Math.round((b + 1) * 20 + 30))
  return { startMs, durationMs: Math.max(1, endMs - startMs), peak }
}
