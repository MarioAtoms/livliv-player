import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { loudRegionMs, pcm16FromWav, syntheticVowelsWav } from '../src/synthetic.mjs'
import { SYNTHETIC_FIXTURE, validateTiming } from '../src/timing.mjs'
import { envelope } from '../../src/runtime/speech.ts'
import { vowelTrack } from '../../src/runtime/vowel.ts'
import { RESERVED_PORTS, portAllowed } from '../server.mjs'

const speechSrc = fs.readFileSync(new URL('../../src/runtime/speech.ts', import.meta.url), 'utf8')
const FPS = Number(speechSrc.match(/const FPS = (\d+)/)[1])
const LEAD = Number(speechSrc.match(/const LEAD = (\d+)/)[1])

test('reserved ports stay refused', () => {
  assert.equal(portAllowed(3900), false)
  assert.equal(portAllowed(8790), false)
  assert.equal(portAllowed(8877), true)
  assert.equal(portAllowed(0), false)
  for (const port of RESERVED_PORTS) assert.equal(portAllowed(port), false)
})

test('synthetic tones drive the LivLiv envelope and vowel cue', () => {
  const wav = syntheticVowelsWav()
  const { pcm, sampleRate } = pcm16FromWav(wav)
  const env = envelope(pcm, sampleRate)
  let peak = 0
  for (const v of env) peak = Math.max(peak, v)
  assert.ok(peak > 0.55, `envelope peak ${peak}`)
  const vowel = vowelTrack(pcm, sampleRate, env, FPS, LEAD)
  const at = (sec) => vowel[Math.round(sec * FPS)] || 0
  const ah = at(0.62)
  const ee = at(1.6)
  assert.ok(ah < -0.35, `ah vowel ${ah} (round cue should be negative)`)
  assert.ok(ee > 0.35, `ee vowel ${ee} (wide cue should be positive)`)
  const region = loudRegionMs(wav)
  assert.ok(region.durationMs < 2200)
  assert.ok(region.durationMs > 800)
})

test('timing validation matches the TalkingHead speakAudio gate', () => {
  assert.equal(validateTiming({ words: ['hello'], wtimes: [0], wdurations: [400] }).ok, true)
  const visemeOnly = validateTiming({ visemes: ['aa'], vtimes: [0], vdurations: [200] })
  assert.equal(visemeOnly.ok, false)
  assert.match(visemeOnly.error, /words/)
  assert.equal(validateTiming({ words: ['hello'], wtimes: [0], wdurations: [0] }).ok, false)
  assert.equal(validateTiming({
    words: ['hello'], wtimes: [0], wdurations: [400],
    visemes: ['nope'], vtimes: [0], vdurations: [100],
  }).ok, false)
  assert.equal(validateTiming(SYNTHETIC_FIXTURE).ok, true)
})
