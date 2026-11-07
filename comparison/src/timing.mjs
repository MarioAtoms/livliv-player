// TalkingHead speakAudio (pinned module) only builds a viseme track when `words` is set.
// Viseme arrays alone sit inside that same branch, so they do not play without words.
// This check refuses inputs the engine would silently ignore. It does not invent timings.

export const OCULUS_VISEMES = ['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH', 'sil']

/** Not aligned to any recording. Proves the viseme path only. */
export const SYNTHETIC_FIXTURE = {
  label: 'synthetic-unaligned-fixture',
  words: ['hello'],
  wtimes: [300],
  wdurations: [1500],
  note: 'Fixed word window over the synthetic tone. It is not a transcription and it is not aligned to the bursts. Visemes come from TalkingHead lipsync-en rules scaled across this window.',
}

function nums(name, value, n) {
  if (!Array.isArray(value) || value.length !== n) return `${name} must have ${n} finite numbers`
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'number' || !Number.isFinite(value[i])) return `${name}[${i}] is not a finite number`
  }
  return ''
}

export function validateTiming(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Timing file must be a JSON object.' }
  }
  const visemeFields = input.visemes != null || input.vtimes != null || input.vdurations != null
  if (!Array.isArray(input.words) || input.words.length === 0) {
    if (visemeFields) {
      return {
        ok: false,
        error: 'This file has visemes without words. TalkingHead speakAudio applies visemes only when words is also set, so those visemes would be ignored. They were not applied.',
      }
    }
    return { ok: false, error: 'words must be a non-empty array of strings. Audio alone does not produce TalkingHead visemes.' }
  }
  if (input.words.some((w) => typeof w !== 'string' || w.length === 0)) {
    return { ok: false, error: 'every word must be a non-empty string' }
  }
  const n = input.words.length
  const wt = nums('wtimes', input.wtimes, n)
  if (wt) return { ok: false, error: wt }
  const wd = nums('wdurations', input.wdurations, n)
  if (wd) return { ok: false, error: wd }
  if (input.wdurations.some((d) => d <= 0)) return { ok: false, error: 'wdurations must be greater than 0 milliseconds' }
  if (input.wtimes.some((t) => t < 0)) return { ok: false, error: 'wtimes must be >= 0 milliseconds' }

  let visemes
  let vtimes
  let vdurations
  if (visemeFields) {
    if (!Array.isArray(input.visemes) || input.visemes.length === 0) {
      return { ok: false, error: 'visemes must be a non-empty array when viseme timings are present' }
    }
    for (let i = 0; i < input.visemes.length; i++) {
      if (!OCULUS_VISEMES.includes(input.visemes[i])) {
        return { ok: false, error: `visemes[${i}] must be an Oculus viseme id (${OCULUS_VISEMES.join(', ')})` }
      }
    }
    const vn = input.visemes.length
    const vt = nums('vtimes', input.vtimes, vn)
    if (vt) return { ok: false, error: vt }
    const vd = nums('vdurations', input.vdurations, vn)
    if (vd) return { ok: false, error: vd }
    if (input.vdurations.some((d) => d <= 0)) return { ok: false, error: 'vdurations must be greater than 0 milliseconds' }
    visemes = input.visemes.slice()
    vtimes = input.vtimes.slice()
    vdurations = input.vdurations.slice()
  }

  return {
    ok: true,
    timing: {
      words: input.words.slice(),
      wtimes: input.wtimes.slice(),
      wdurations: input.wdurations.slice(),
      ...(visemes ? { visemes, vtimes, vdurations } : {}),
    },
  }
}
