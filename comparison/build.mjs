// Builds the self-contained comparison package and the zip under /opt/cursor/artifacts.
// Runtime on the MSI machine does not run this. It does not install packages there.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loudRegionMs, syntheticVowelsWav } from './src/synthetic.mjs'
import { validateTiming } from './src/timing.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const cache = path.join(here, '.cache')
const out = path.join(here, 'package')
const pub = path.join(out, 'public')
const TH_COMMIT = '1563de184c19b310de4b636664d5835e2c74dbba'
const TH_RAW = `https://raw.githubusercontent.com/MarioAtoms/TalkingHead/${TH_COMMIT}`
const HELLO_PAGE = 'https://commons.wikimedia.org/wiki/File:En-uk-hello-4.ogg'
const HELLO_FILE = 'https://commons.wikimedia.org/wiki/Special:FilePath/En-uk-hello-4.ogg'
const ESBUILD = '0.25.5'
const ARTIFACT = process.env.LIPSYNC_ARTIFACT || '/opt/cursor/artifacts/lipsync-compare-windows.zip'

const TH_FILES = [
  'modules/talkinghead.mjs',
  'modules/lipsync-en.mjs',
  'modules/playback-worklet.js',
  'modules/retargeter.mjs',
  'modules/dynamicbones.mjs',
  'LICENSE',
]

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`)
}

function sha256(file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}

function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return
  run('curl', ['-fsSL', '--retry', '3', '-o', dest, url])
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function walk(dir, base = dir) {
  const files = []
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) files.push(...walk(p, base))
    else files.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return files.sort()
}

const ll = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' })
if (ll.status !== 0) throw new Error('git rev-parse failed')
const LL_COMMIT = ll.stdout.trim()

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(cache, { recursive: true })

console.log('Building LivLiv Player dist…')
run('npm', ['run', 'build'], { cwd: repo })

const thDir = path.join(cache, 'talkinghead')
for (const rel of TH_FILES) download(`${TH_RAW}/${rel}`, path.join(thDir, rel))
download(`${TH_RAW}/avatars/brunette.glb`, path.join(cache, 'brunette.glb'))
const glbStat = fs.statSync(path.join(cache, 'brunette.glb'))
if (glbStat.size !== 4721528) throw new Error(`brunette.glb size ${glbStat.size}, expected 4721528 at ${TH_COMMIT}`)

download(HELLO_FILE, path.join(cache, 'en-uk-hello-4.ogg'))
const helloWav = path.join(cache, 'en-uk-hello.wav')
run('ffmpeg', ['-y', '-i', path.join(cache, 'en-uk-hello-4.ogg'), '-af', 'highpass=f=40', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', helloWav])

const bundleDir = path.join(pub, 'talkinghead')
fs.mkdirSync(bundleDir, { recursive: true })
run('npx', ['--yes', `esbuild@${ESBUILD}`, path.join(thDir, 'modules/talkinghead.mjs'),
  '--bundle', '--format=esm', '--platform=browser', '--target=es2022',
  '--legal-comments=linked', `--outfile=${path.join(bundleDir, 'talkinghead.mjs')}`], { cwd: repo })
copyFile(path.join(thDir, 'modules/lipsync-en.mjs'), path.join(bundleDir, 'lipsync-en.mjs'))
copyFile(path.join(thDir, 'modules/playback-worklet.js'), path.join(bundleDir, 'playback-worklet.js'))
const bundleText = fs.readFileSync(path.join(bundleDir, 'talkinghead.mjs'), 'utf8')
if (!bundleText.includes('lipsync-')) throw new Error('bundle lost the dynamic lipsync import')
if (bundleText.includes('api.openai.com')) throw new Error('bundle contains an OpenAI endpoint')

const livlivOut = path.join(pub, 'livliv')
for (const name of ['index.js', 'voice.js']) copyFile(path.join(repo, 'dist', name), path.join(livlivOut, name))
const chunkDir = path.join(repo, 'dist', 'chunks')
for (const name of fs.readdirSync(chunkDir)) copyFile(path.join(chunkDir, name), path.join(livlivOut, 'chunks', name))

const character = path.join(pub, 'avatars/livliv/char06')
fs.cpSync(path.join(repo, 'characters/char06'), character, { recursive: true })
copyFile(path.join(cache, 'brunette.glb'), path.join(pub, 'avatars/brunette.glb'))

const samples = path.join(pub, 'samples')
fs.mkdirSync(samples, { recursive: true })
fs.writeFileSync(path.join(samples, 'synthetic-vowels.wav'), syntheticVowelsWav())
copyFile(helloWav, path.join(samples, 'en-uk-hello.wav'))
const region = loudRegionMs(fs.readFileSync(path.join(samples, 'en-uk-hello.wav')))
const helloTiming = {
  label: 'public-domain-hello-word-window',
  words: ['hello'],
  wtimes: [region.startMs],
  wdurations: [region.durationMs],
  note: 'The recording is the single word hello, released into the public domain by Celestianpower (Wikimedia Commons, File:En-uk-hello-4.ogg). The WAV is that file converted locally to 24 kHz mono PCM with a 40 Hz high-pass, which removes a large DC offset in the source. wtimes and wdurations are the loud region of that WAV from a relative energy gate, not a phoneme aligner. TalkingHead then scales lipsync-en visemes across that one word.',
}
const checked = validateTiming(helloTiming)
if (!checked.ok) throw new Error(checked.error)
fs.writeFileSync(path.join(samples, 'en-uk-hello.timing.json'), JSON.stringify({ ...helloTiming }, null, 2) + '\n')

for (const name of ['index.html', 'app.css', 'app.js', 'timing.mjs']) {
  copyFile(path.join(here, 'src', name), path.join(pub, name))
}

const licenses = path.join(pub, 'licenses')
fs.mkdirSync(licenses, { recursive: true })
copyFile(path.join(repo, 'LICENSE'), path.join(licenses, 'apache-2.0.txt'))
copyFile(path.join(repo, 'NOTICE'), path.join(licenses, 'livliv-notice.txt'))
copyFile(path.join(repo, 'characters/LICENSE.md'), path.join(licenses, 'livliv-characters.md'))
copyFile(path.join(thDir, 'LICENSE'), path.join(licenses, 'talkinghead-mit.txt'))
copyFile(path.join(repo, 'node_modules/three/LICENSE'), path.join(licenses, 'three-mit.txt'))
fs.writeFileSync(path.join(licenses, 'brunette-cc-by-nc.txt'), `brunette.glb

Fetched byte-for-byte from
${TH_RAW}/avatars/brunette.glb
(commit ${TH_COMMIT} of https://github.com/MarioAtoms/TalkingHead).

The TalkingHead README at that commit says:
"Example avatar \\"brunette.glb\\" was created at Ready Player Me
(https://readyplayer.me/). The avatar is free to all developers for
non-commercial use under the CC BY-NC 4.0 DEED
(https://creativecommons.org/licenses/by-nc/4.0/)."

The same README says these example assets are not part of the TalkingHead
class license. The GLB is not MIT. This package does not modify it.
Credit: Ready Player Me, via MarioAtoms/TalkingHead.

Non-commercial use only. Give attribution and link the license.
https://creativecommons.org/licenses/by-nc/4.0/
`)
fs.writeFileSync(path.join(licenses, 'hello-public-domain.txt'), `en-uk-hello.wav

Source page: ${HELLO_PAGE}
File: ${HELLO_FILE}

Wikimedia Commons states that Celestianpower released "En-uk-hello-4.ogg"
into the public domain on 17 June 2006, with a fallback grant of use for any
purpose if a public-domain dedication is not possible locally.

This package converts that Ogg to 24 kHz mono 16-bit PCM and applies a 40 Hz
high-pass because the source has a large DC offset. The spoken word is still hello.
The word window in en-uk-hello.timing.json is an energy gate around that word,
not a phoneme transcription.

SHA-256 of the Ogg we fetched: ${sha256(path.join(cache, 'en-uk-hello-4.ogg'))}
SHA-256 of the WAV: ${sha256(path.join(samples, 'en-uk-hello.wav'))}
Loud region used as the single word window: start ${region.startMs} ms, duration ${region.durationMs} ms, peak RMS ${region.peak.toFixed(4)}.
`)

const third = path.join(out, 'third_party/talkinghead')
fs.cpSync(path.join(thDir, 'modules'), path.join(third, 'modules'), { recursive: true })
copyFile(path.join(thDir, 'LICENSE'), path.join(third, 'LICENSE'))
copyFile(path.join(cache, 'en-uk-hello-4.ogg'), path.join(out, 'third_party/hello/en-uk-hello-4.ogg'))

const threePkg = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules/three/package.json'), 'utf8'))
const source = {
  builtAt: new Date().toISOString(),
  livlivPlayer: {
    repo: 'https://github.com/MarioAtoms/livliv-player',
    commit: LL_COMMIT,
    license: 'Apache-2.0',
    runtime: 'public/livliv (vite build of this commit: index.js, voice.js, chunks)',
    character: 'characters/char06 Aoi, copied unchanged',
  },
  talkingHead: {
    repo: 'https://github.com/MarioAtoms/TalkingHead',
    commit: TH_COMMIT,
    license: 'MIT',
    note: 'Code only. The brunette.glb avatar is CC BY-NC 4.0, not MIT.',
    bundled: 'public/talkinghead/talkinghead.mjs includes talkinghead.mjs, retargeter.mjs, dynamicbones.mjs, and three',
    lipsync: 'public/talkinghead/lipsync-en.mjs is the upstream file, loaded at runtime',
    sources: 'third_party/talkinghead',
  },
  three: { name: 'three', version: threePkg.version, license: 'MIT', bundled: true },
  esbuild: ESBUILD,
  hello: { page: HELLO_PAGE, wav: 'public/samples/en-uk-hello.wav', timing: helloTiming },
  notIncluded: [
    'HeadAudio',
    'a phoneme aligner or speech recognizer',
    'the MSI clip C:\\\\Users\\\\Mario\\\\slgirl-work\\\\slgirl-morning-2026-10-26\\\\11.wav',
    'npm packages for the MSI machine to install',
  ],
}
fs.writeFileSync(path.join(pub, 'source.json'), JSON.stringify(source, null, 2) + '\n')
fs.copyFileSync(path.join(pub, 'source.json'), path.join(out, 'SOURCE.json'))

const deps = `# Dependency manifest

This package runs with Node's built-in modules and the files inside it.
The MSI machine does not need \`npm install\`, a checkout, Python, or ffprobe.

| Piece | Version or commit | License | Where |
|---|---|---|---|
| Node.js | 24.22.1 already on the machine | Node's license | runs \`server.mjs\` |
| LivLiv Player | ${LL_COMMIT} | Apache-2.0 | \`public/livliv\` |
| Aoi (\`char06\`) | same LivLiv commit, unchanged | LivLiv Featured Characters License 1.0 | \`public/avatars/livliv/char06\` |
| TalkingHead | ${TH_COMMIT} | MIT | \`public/talkinghead\`, sources in \`third_party/talkinghead\` |
| lipsync-en | same TalkingHead commit | MIT | \`public/talkinghead/lipsync-en.mjs\` |
| three | ${threePkg.version} | MIT | bundled into \`talkinghead.mjs\` |
| meshoptimizer decoder | as shipped inside three ${threePkg.version} | MIT | bundled, wasm embedded, no download |
| brunette.glb | same TalkingHead commit, ${glbStat.size} bytes | CC BY-NC 4.0, Ready Player Me | \`public/avatars/brunette.glb\` |
| en-uk-hello | Wikimedia Commons File:En-uk-hello-4.ogg | Public domain, Celestianpower | \`public/samples/en-uk-hello.wav\` |
| esbuild ${ESBUILD} | build machine only | MIT | not included |

Reserved ports that this server refuses: 3900 (VoiceStudio) and 8790.
Default listen address: 127.0.0.1 port 8877, plus ::1 when the OS allows it.
`
fs.writeFileSync(path.join(out, 'DEPENDENCIES.md'), deps)

copyFile(path.join(here, 'README.md'), path.join(out, 'README.md'))
copyFile(path.join(here, 'server.mjs'), path.join(out, 'server.mjs'))
for (const name of ['START-WINDOWS.cmd', 'STOP-WINDOWS.cmd']) {
  const text = fs.readFileSync(path.join(here, name), 'utf8').replace(/\r?\n/g, '\r\n')
  fs.writeFileSync(path.join(out, name), text)
}

const sums = walk(out).filter((rel) => rel !== 'SHA256SUMS.txt').map((rel) => `${sha256(path.join(out, rel))}  ${rel}`)
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n')

fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true })
if (fs.existsSync(ARTIFACT)) fs.rmSync(ARTIFACT)
run('zip', ['-r', '-X', ARTIFACT, '.'], { cwd: out })
const zipHash = sha256(ARTIFACT)
fs.writeFileSync(ARTIFACT + '.sha256', `${zipHash}  ${path.basename(ARTIFACT)}\n`)
console.log(`package ${out}`)
console.log(`zip ${ARTIFACT}`)
console.log(`zip sha256 ${zipHash}`)
console.log(`hello window ${region.startMs} ms + ${region.durationMs} ms`)
