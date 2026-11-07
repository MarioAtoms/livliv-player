// Cloud-side page test. Uses the built package and the machine's Chrome.
// It does not decide which engine looks more in sync.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.resolve(here, '../package')
const evidence = '/opt/cursor/artifacts/lipsync-evidence'
const port = 8877
const base = `http://127.0.0.1:${port}`

fs.mkdirSync(evidence, { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: pkg,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (b) => { serverLog += b; process.stdout.write(b) })
server.stderr.on('data', (b) => { serverLog += b; process.stderr.write(b) })

const deadline = Date.now() + 10000
while (!serverLog.includes(`listening http://127.0.0.1:${port}/`)) {
  if (Date.now() > deadline) throw new Error('server did not listen: ' + serverLog)
  await new Promise((r) => setTimeout(r, 50))
}

const external = []
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 1500 } })
page.on('request', (req) => {
  const url = new URL(req.url())
  if (url.protocol === 'blob:' || url.protocol === 'data:') return
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]' && url.hostname !== 'localhost') external.push(req.url())
})
page.on('pageerror', (err) => { console.error('PAGE', err) })
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE', msg.text())
})

const report = { external, checks: [] }
function check(name, ok, detail) {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'ok' : 'FAIL'} ${name} ${detail ?? ''}`)
  if (!ok) throw new Error(name + ' ' + (detail ?? ''))
}

try {
  const health = await fetch(`${base}/health`)
  check('health', health.ok && (await health.json()).bind === '127.0.0.1')
  const blocked = await fetch(`${base}/%2e%2e/server.mjs`)
  check('traversal', blocked.status === 403 || blocked.status === 404, String(blocked.status))
  const missing = await fetch(`${base}/nope.txt`)
  check('missing', missing.status === 404)

  const response = await page.goto(base + '/', { waitUntil: 'networkidle' })
  check('page', response.ok())
  await page.waitForFunction(() => window.__cmp?.ready === true, null, { timeout: 90000 })
  check('engines ready', await page.evaluate(() => window.__cmp.ready))
  await page.screenshot({ path: path.join(evidence, '01-loaded.png') })

  await page.click('#load-synthetic')
  await page.waitForFunction(() => window.__cmp.file?.name === 'synthetic-vowels.wav')
  const synthetic = await page.evaluate(() => {
  const f = window.__cmp.file
  return { name: f.name, bytes: f.bytes, duration: f.duration, sampleRate: f.sampleRate, channels: f.channels }
})
  check('synthetic identity', synthetic.bytes > 10000 && synthetic.duration > 2.2 && synthetic.duration < 2.6 && synthetic.channels >= 1, JSON.stringify(synthetic))

  await page.click('#play-livliv')
  await page.waitForFunction(() => {
    const m = /mouthOpen ([0-9.]+)/.exec(document.querySelector('#livliv-meter').textContent)
    return m && Number(m[1]) > 0.55
  }, null, { timeout: 8000 })
  await page.locator('#panel-livliv .stage').screenshot({ path: path.join(evidence, '02-livliv-stage.png') })
  await page.screenshot({ path: path.join(evidence, '02-livliv-synthetic.png') })
  const livlivPeak = await page.evaluate(() => ({ ...window.__cmp.peaks, frame: document.querySelector('#livliv-meter').textContent }))
  await page.waitForFunction(() => !window.__cmp.playing.livliv, null, { timeout: 8000 })
  check('livliv synthetic mouth', livlivPeak.mouthOpen > 0.45, JSON.stringify(livlivPeak))

  await page.click('#reset')
  await page.click('#play-th')
  await page.waitForFunction(() => !window.__cmp.playing.talkinghead && window.__cmp.audibleLog.includes('talkinghead'), null, { timeout: 12000 })
  const audioOnly = await page.evaluate(() => ({ ...window.__cmp.peaks, status: document.querySelector('#th-status').textContent }))
  await page.screenshot({ path: path.join(evidence, '03-talkinghead-audio-only.png') })
  check('talkinghead audio-only visemes stay down', audioOnly.viseme < 0.08, JSON.stringify(audioOnly))

  await page.check('input[name="timing"][value="fixture"]')
  await page.click('#play-th')
  await page.waitForFunction(() => {
    const m = /top viseme\s+\S+\s+([0-9.]+)/.exec(document.querySelector('#th-meter').textContent)
    return m && Number(m[1]) > 0.45
  }, null, { timeout: 8000 })
  await page.locator('#panel-th .stage').screenshot({ path: path.join(evidence, '04-talkinghead-stage.png') })
  await page.screenshot({ path: path.join(evidence, '04-talkinghead-fixture.png') })
  const fixture = await page.evaluate(() => ({ ...window.__cmp.peaks, status: document.querySelector('#th-status').textContent }))
  await page.waitForFunction(() => !window.__cmp.playing.talkinghead, null, { timeout: 8000 })
  check('talkinghead fixture visemes move', fixture.viseme > 0.4, JSON.stringify(fixture))

  await page.click('#load-hello')
  await page.waitForFunction(() => window.__cmp.file?.name === 'en-uk-hello.wav' && window.__cmp.timingMode() === 'bundled')
  await page.click('#play-livliv')
  await page.waitForFunction(() => {
    const m = /mouthOpen ([0-9.]+)/.exec(document.querySelector('#livliv-meter').textContent)
    return m && Number(m[1]) > 0.45
  }, null, { timeout: 8000 })
  await page.locator('#panel-livliv .stage').screenshot({ path: path.join(evidence, '05-livliv-hello-stage.png') })
  await page.screenshot({ path: path.join(evidence, '05-livliv-hello.png') })
  const helloMouth = await page.evaluate(() => ({ ...window.__cmp.peaks }))
  await page.waitForFunction(() => !window.__cmp.playing.livliv, null, { timeout: 8000 })
  check('livliv hello mouth', helloMouth.mouthOpen > 0.35, JSON.stringify(helloMouth))

  await page.check('input[name="timing"][value="none"]')
  await page.click('#play-th')
  await page.waitForFunction(() => !window.__cmp.playing.talkinghead && window.__cmp.audibleLog.includes('talkinghead'), null, { timeout: 12000 })
  const helloStill = await page.evaluate(() => ({ ...window.__cmp.peaks }))
  check('hello without timings leaves visemes down', helloStill.viseme < 0.08, JSON.stringify(helloStill))

  await page.check('input[name="timing"][value="bundled"]')
  await page.click('#play-th')
  await page.waitForFunction(() => {
    const m = /top viseme\s+\S+\s+([0-9.]+)/.exec(document.querySelector('#th-meter').textContent)
    return m && Number(m[1]) > 0.4
  }, null, { timeout: 8000 })
  await page.locator('#panel-th .stage').screenshot({ path: path.join(evidence, '06-talkinghead-hello-stage.png') })
  await page.screenshot({ path: path.join(evidence, '06-talkinghead-hello.png') })
  const helloViseme = await page.evaluate(() => ({ ...window.__cmp.peaks, note: document.querySelector('#timing-note').textContent }))
  await page.waitForFunction(() => !window.__cmp.playing.talkinghead, null, { timeout: 8000 })
  check('hello word window drives visemes', helloViseme.viseme > 0.4, JSON.stringify(helloViseme))

  await page.check('input[name="timing"][value="none"]')
  await page.click('#load-synthetic')
  await page.waitForFunction(() => window.__cmp.file?.name === 'synthetic-vowels.wav')
  await page.click('#play-seq')
  await page.waitForFunction(() => {
    const log = window.__cmp.audibleLog
    return log.includes('livliv') && log.includes('talkinghead') && !window.__cmp.playing.livliv && !window.__cmp.playing.talkinghead
  }, null, { timeout: 15000 })
  const seq = await page.evaluate(() => ({ log: window.__cmp.audibleLog, overlap: window.__cmp.overlap, playing: window.__cmp.playing }))
  check('sequence does not overlap', seq.overlap === false && seq.playing.livliv === false && seq.playing.talkinghead === false, JSON.stringify(seq))
  const heard = seq.log.filter(Boolean)
  check('sequence order', heard[0] === 'livliv' && heard.includes('talkinghead') && heard.indexOf('livliv') < heard.indexOf('talkinghead'), JSON.stringify(heard))

  await page.click('#reset')
  const afterReset = await page.evaluate(() => window.__cmp.playing)
  check('reset stops both', afterReset.livliv === false && afterReset.talkinghead === false)

  fs.writeFileSync(path.join(evidence, 'not-audio.txt'), 'this is not audio')
  await page.setInputFiles('#file', path.join(evidence, 'not-audio.txt'))
  await page.waitForFunction(() => document.querySelector('#error').textContent.length > 0)
  check('bad file shows an error', true, await page.locator('#error').innerText())
  await page.screenshot({ path: path.join(evidence, '07-bad-file.png') })

  check('no external requests', external.length === 0, external.join(' '))
  const assets = ['avatars/brunette.glb', 'avatars/livliv/char06/model.json', 'samples/en-uk-hello.wav', 'talkinghead/lipsync-en.mjs', 'livliv/voice.js', 'source.json']
  for (const rel of assets) {
    const res = await fetch(base + '/' + rel)
    check('asset ' + rel, res.ok, String(res.status))
  }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log('browser checks passed')
} finally {
  await browser.close().catch(() => {})
  server.kill('SIGTERM')
}
