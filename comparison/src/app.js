import { Player } from './livliv/index.js'
import { createSpeech } from './livliv/voice.js'
import { TalkingHead } from './talkinghead/talkinghead.mjs'
import { SYNTHETIC_FIXTURE, validateTiming } from './timing.mjs'

const $ = (id) => document.getElementById(id)
const errorBox = $('error')

const state = {
  ready: false,
  file: null,
  bundledTiming: null,
  sidecar: null,
  sidecarError: '',
  playing: { livliv: false, talkinghead: false },
  overlap: false,
  audibleLog: [],
  peaks: { mouthOpen: 0, absVowel: 0, viseme: 0, visemeName: '', jawOpen: 0 },
  token: 0,
}

let player
let speech
let head
let frameName = '—'

function setError(text) {
  errorBox.textContent = text || ''
}

function badge(id, kind, text) {
  const el = $(id)
  el.className = 'badge ' + (kind || '')
  el.textContent = text
}

function timingMode() {
  return document.querySelector('input[name="timing"]:checked')?.value || 'none'
}

function describeTiming() {
  const mode = timingMode()
  const note = $('timing-note')
  if (mode === 'none') {
    note.textContent = 'TalkingHead will play this file and leave visemes at rest.'
    return null
  }
  if (mode === 'fixture') {
    note.textContent = SYNTHETIC_FIXTURE.note
    return { source: 'synthetic-unaligned-fixture', ...SYNTHETIC_FIXTURE }
  }
  if (mode === 'bundled') {
    if (!state.bundledTiming) {
      note.textContent = 'The bundled word window belongs to the public-domain hello clip. Load that clip, or pick None.'
      return null
    }
    note.textContent = state.bundledTiming.note || ''
    return { source: 'bundled-hello-word-window', ...state.bundledTiming }
  }
  if (state.sidecarError) {
    note.textContent = state.sidecarError
    return null
  }
  if (!state.sidecar) {
    note.textContent = 'Choose a JSON sidecar. Required: words, wtimes, wdurations (milliseconds). Optional: visemes, vtimes, vdurations, and only together with words.'
    return null
  }
  note.textContent = 'Sidecar timings will be passed to TalkingHead speakAudio. They are not checked against the audio.'
  return { source: 'sidecar', ...state.sidecar }
}

function buttons() {
  const ok = state.ready && !!state.file
  for (const id of ['play-livliv', 'play-th', 'play-seq', 'reset']) $(id).disabled = !ok
  $('play-livliv').classList.toggle('playing', state.playing.livliv)
  $('play-th').classList.toggle('playing', state.playing.talkinghead)
}

function setAudible(which) {
  const next = { livliv: which === 'livliv', talkinghead: which === 'talkinghead' }
  if (next.livliv && next.talkinghead) state.overlap = true
  if (next.livliv && state.playing.talkinghead) state.overlap = true
  if (next.talkinghead && state.playing.livliv) state.overlap = true
  state.playing = next
  state.audibleLog.push(which)
  buttons()
  const who = which === 'livliv' ? 'LivLiv' : which === 'talkinghead' ? 'TalkingHead' : 'neither engine'
  $('transport').textContent = which
    ? `Audible: ${who}. The other engine is stopped.`
    : 'Both engines are stopped. One plays at a time.'
}

function stopEngines() {
  try { speech?.stop() } catch (e) { setError(e.message || String(e)) }
  try { head?.stopSpeaking() } catch (e) { setError(e.message || String(e)) }
  setAudible(null)
}

function resetPeaks() {
  state.peaks = { mouthOpen: 0, absVowel: 0, viseme: 0, visemeName: '', jawOpen: 0 }
}

function visemeLevels() {
  const out = {}
  if (!head?.visemeNames || !head.morphs) return out
  for (const name of head.visemeNames) {
    let m = 0
    for (const mesh of head.morphs) {
      const i = mesh.morphTargetDictionary?.['viseme_' + name]
      if (i !== undefined) m = Math.max(m, mesh.morphTargetInfluences[i] || 0)
    }
    out[name] = m
  }
  return out
}

function jawOpen() {
  let m = 0
  for (const mesh of head?.morphs || []) {
    const i = mesh.morphTargetDictionary?.jawOpen
    if (i !== undefined) m = Math.max(m, mesh.morphTargetInfluences[i] || 0)
  }
  return m
}

function sampleMeters() {
  const mouthOpen = player?.puppet?.params?.mouthOpen || 0
  const vowel = player?.puppet?.params?.vowel || 0
  const frame = player?.puppet?.mouthFrame
  const kinds = player?.puppet?.frameKind
  frameName = kinds && frame != null ? (kinds[frame] || String(frame)) : '—'
  const vis = visemeLevels()
  let viseme = 0
  let visemeName = ''
  for (const [name, value] of Object.entries(vis)) {
    if (value > viseme) { viseme = value; visemeName = name }
  }
  const jaw = jawOpen()
  state.peaks.mouthOpen = Math.max(state.peaks.mouthOpen, mouthOpen)
  state.peaks.absVowel = Math.max(state.peaks.absVowel, Math.abs(vowel))
  if (viseme > state.peaks.viseme) {
    state.peaks.viseme = viseme
    state.peaks.visemeName = visemeName
  }
  state.peaks.jawOpen = Math.max(state.peaks.jawOpen, jaw)
  $('livliv-meter').textContent = `mouthOpen ${mouthOpen.toFixed(2)} · vowel ${vowel.toFixed(2)} · frame ${frameName} · peak mouth ${state.peaks.mouthOpen.toFixed(2)}`
  $('th-meter').textContent = `top viseme ${visemeName || '—'} ${viseme.toFixed(2)} · jawOpen ${jaw.toFixed(2)} · peak viseme ${state.peaks.visemeName || '—'} ${state.peaks.viseme.toFixed(2)}`
}

function loop() {
  sampleMeters()
  requestAnimationFrame(loop)
}

function audioBufferCopy(bytes) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', audioBufferCopy(bytes))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function describeFile(file, bytes, bundledTiming) {
  const sha = await sha256(bytes)
  let decoded = 'the browser could not decode this file'
  let duration = 0
  let sampleRate = 0
  let channels = 0
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(audioBufferCopy(bytes))
    duration = buf.duration
    sampleRate = buf.sampleRate
    channels = buf.numberOfChannels
    decoded = `${duration.toFixed(3)} s · ${sampleRate} Hz · ${channels} ch`
  } catch (e) {
    decoded = e.message || 'decode failed'
  } finally {
    await ctx.close().catch(() => {})
  }
  state.file = duration ? { name: file.name, bytes: bytes.byteLength, sha, duration, sampleRate, channels, blob: new Blob([bytes], { type: file.type || 'audio/wav' }), raw: bytes } : null
  state.bundledTiming = bundledTiming
  $('timing-bundled').disabled = !bundledTiming
  if (!bundledTiming && timingMode() === 'bundled') document.querySelector('input[name="timing"][value="none"]').checked = true
  $('id-name').textContent = file.name
  $('id-bytes').textContent = String(bytes.byteLength)
  $('id-sha').textContent = sha
  $('id-audio').textContent = decoded
  if (!state.file) setError(decoded)
  else setError('')
  describeTiming()
  buttons()
}

async function loadBlob(name, type, blob, bundledTiming) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  await describeFile({ name, type }, bytes, bundledTiming)
}

$('file').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0]
  if (!file) return
  state.token++
  stopEngines()
  try {
    await loadBlob(file.name, file.type, file, null)
  } catch (e) {
    setError(e.message || String(e))
  }
})

$('load-hello').addEventListener('click', async () => {
  state.token++
  stopEngines()
  try {
    const [audio, timingRes] = await Promise.all([
      fetch('samples/en-uk-hello.wav'),
      fetch('samples/en-uk-hello.timing.json'),
    ])
    if (!audio.ok || !timingRes.ok) throw new Error('bundled hello files are missing')
    const timingJson = await timingRes.json()
    const checked = validateTiming(timingJson)
    if (!checked.ok) throw new Error(checked.error)
    await loadBlob('en-uk-hello.wav', 'audio/wav', await audio.blob(), { ...checked.timing, note: timingJson.note || '' })
    document.querySelector('input[name="timing"][value="bundled"]').checked = true
    describeTiming()
  } catch (e) {
    setError(e.message || String(e))
  }
})

$('load-synthetic').addEventListener('click', async () => {
  state.token++
  stopEngines()
  try {
    const audio = await fetch('samples/synthetic-vowels.wav')
    if (!audio.ok) throw new Error('synthetic sample is missing')
    document.querySelector('input[name="timing"][value="none"]').checked = true
    await loadBlob('synthetic-vowels.wav', 'audio/wav', await audio.blob(), null)
  } catch (e) {
    setError(e.message || String(e))
  }
})

$('sidecar').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0]
  state.sidecar = null
  state.sidecarError = ''
  if (!file) { describeTiming(); return }
  try {
    const checked = validateTiming(JSON.parse(await file.text()))
    if (!checked.ok) state.sidecarError = checked.error
    else state.sidecar = checked.timing
  } catch (e) {
    state.sidecarError = 'Timing file is not JSON. ' + (e.message || '')
  }
  document.querySelector('input[name="timing"][value="sidecar"]').checked = true
  describeTiming()
})

for (const input of document.querySelectorAll('input[name="timing"]')) {
  input.addEventListener('change', () => describeTiming())
}

function playLivliv(my) {
  return new Promise((resolve, reject) => {
    if (!speech || !state.file) { reject(new Error('LivLiv is not ready')); return }
    let settled = false
    const finish = () => { if (settled) return; settled = true; resolve() }
    speech.onIdle = () => {
      if (my !== state.token) { finish(); return }
      setAudible(null)
      $('livliv-status').textContent = `Played. Peak mouthOpen ${state.peaks.mouthOpen.toFixed(2)}, peak |vowel| ${state.peaks.absVowel.toFixed(2)}. This is the envelope and vowel cue, not phonemes.`
      finish()
    }
    try {
      setAudible('livliv')
      $('livliv-status').textContent = 'Playing. Mouth follows the decoded clip.'
      speech.unlock()
      speech.say(state.file.blob)
    } catch (e) {
      setAudible(null)
      reject(e)
      return
    }
    const timer = setInterval(() => { if (my !== state.token) { clearInterval(timer); finish() } }, 40)
    setTimeout(() => {
      clearInterval(timer)
      if (my === state.token && state.playing.livliv) {
        speech.stop()
        setAudible(null)
        finish()
      }
    }, (state.file.duration + 3) * 1000)
  })
}

function playTalkingHead(my) {
  return new Promise(async (resolve, reject) => {
    if (!head?.audioCtx || !state.file) { reject(new Error('TalkingHead is not ready')); return }
    const chosen = describeTiming()
    if (timingMode() !== 'none' && !chosen) {
      reject(new Error($('timing-note').textContent || 'Timings are not valid'))
      return
    }
    let settled = false
    const finish = () => { if (settled) return; settled = true; resolve() }
    try {
      await head.audioCtx.resume()
      const audio = await head.audioCtx.decodeAudioData(audioBufferCopy(state.file.raw))
      head.stopSpeaking()
      const payload = { audio }
      if (chosen) Object.assign(payload, chosen)
      setAudible('talkinghead')
      const modeText = chosen
        ? `Playing with ${chosen.source}. Visemes are the engine’s, from the supplied timings.`
        : 'Playing audio only. Visemes are not driven. No amplitude fallback is applied.'
      $('th-status').textContent = modeText
      head.speakAudio(payload, { isRaw: true, lipsyncLang: 'en' })
    } catch (e) {
      setAudible(null)
      reject(e)
      return
    }
    let saw = false
    const timer = setInterval(() => {
      if (my !== state.token) { clearInterval(timer); finish(); return }
      const on = !!(head.isSpeaking || head.isAudioPlaying)
      if (on) saw = true
      if (saw && !on) {
        clearInterval(timer)
        setAudible(null)
        const driven = timingMode() !== 'none'
        $('th-status').textContent = driven
          ? `Played. Peak viseme ${state.peaks.visemeName || '—'} ${state.peaks.viseme.toFixed(2)}. That peak is the viseme track, not a loudness mouth.`
          : `Played audio only. Peak viseme ${state.peaks.viseme.toFixed(2)}. A value near zero means the mouth visemes stayed at rest.`
        finish()
      }
    }, 40)
    setTimeout(() => {
      clearInterval(timer)
      if (my === state.token && state.playing.talkinghead) {
        try { head.stopSpeaking() } catch { /* already stopped */ }
        setAudible(null)
        finish()
      }
    }, (state.file.duration + 4) * 1000)
  })
}

async function run(which) {
  if (!state.file) return
  const my = ++state.token
  setError('')
  resetPeaks()
  state.audibleLog = []
  stopEngines()
  try {
    if (which === 'livliv' || which === 'seq') await playLivliv(my)
    if (my !== state.token) return
    if (which === 'talkinghead' || which === 'seq') await playTalkingHead(my)
  } catch (e) {
    if (my === state.token) {
      setAudible(null)
      setError(e.message || String(e))
    }
  }
}

$('play-livliv').addEventListener('click', () => run('livliv'))
$('play-th').addEventListener('click', () => run('talkinghead'))
$('play-seq').addEventListener('click', () => run('seq'))
$('reset').addEventListener('click', () => {
  state.token++
  stopEngines()
  resetPeaks()
  $('livliv-status').textContent = state.ready ? 'Reset. The clip is still loaded.' : $('livliv-status').textContent
  $('th-status').textContent = state.ready ? 'Reset. Visemes cleared. The clip is still loaded.' : $('th-status').textContent
  $('transport').textContent = 'Reset. Both engines are stopped.'
})

async function bootLivliv() {
  try {
    if (!Player.isSupported()) throw new Error('This browser has no WebGL2, so LivLiv Player cannot draw.')
    player = new Player($('livliv-canvas'), { idle: true, followPointer: false, maxPixelRatio: 1 })
    const info = await player.load('avatars/livliv/char06/')
    speech = createSpeech(player, { motion: 0 })
    badge('badge-livliv', 'ready', 'ready')
    $('livliv-status').textContent = `${info.name} loaded. Talk-motion is off so the comparison watches the mouth. Idle blink and sway stay on.`
  } catch (e) {
    badge('badge-livliv', 'error', 'error')
    $('livliv-status').textContent = e.message || String(e)
    setError(e.message || String(e))
  }
}

async function bootTalkingHead() {
  const stage = $('th-stage')
  try {
    head = new TalkingHead(stage, {
      ttsEndpoint: '',
      lipsyncModules: ['en'],
      lipsyncLang: 'en',
      cameraView: 'upper',
      cameraRotateEnable: true,
      cameraZoomEnable: false,
      avatarMood: 'neutral',
      avatarIdleEyeContact: 0,
      avatarIdleHeadMove: 0,
      avatarSpeakingEyeContact: 0,
      avatarSpeakingHeadMove: 0,
      modelMovementFactor: 0,
      modelPixelRatio: 1,
      lightSpotIntensity: 0,
    })
    await head.showAvatar({
      url: 'avatars/brunette.glb',
      body: 'F',
      avatarMood: 'neutral',
      lipsyncLang: 'en',
      avatarIdleEyeContact: 0,
      avatarIdleHeadMove: 0,
      avatarSpeakingEyeContact: 0,
      avatarSpeakingHeadMove: 0,
    }, (ev) => {
      if (ev.lengthComputable) $('th-status').textContent = `Loading avatar ${Math.min(100, Math.round(ev.loaded / ev.total * 100))}%`
    })
    const t0 = performance.now()
    while (!head.lipsync?.en) {
      if (performance.now() - t0 > 10000) throw new Error('English lip-sync module did not load from lipsync-en.mjs')
      await new Promise((r) => setTimeout(r, 30))
    }
    head.setView('upper')
    const canvas = stage.querySelector('canvas')
    if (!canvas || canvas.width < 2 || canvas.height < 2) {
      throw new Error('TalkingHead canvas has no pixels')
    }
    badge('badge-th', 'ready', 'ready')
    $('th-status').textContent = 'Avatar loaded. English rules are loaded. Visemes stay at rest until a play uses timings. Head-view expression twitches are not visemes.'
  } catch (e) {
    badge('badge-th', 'error', 'error')
    $('th-status').textContent = e.message || String(e)
    setError(e.message || String(e))
  }
}

window.__cmp = state
state.visemeLevels = visemeLevels
state.timingMode = timingMode

await Promise.all([bootLivliv(), bootTalkingHead()])
state.ready = $('badge-livliv').classList.contains('ready') && $('badge-th').classList.contains('ready')
buttons()
describeTiming()
loop()
