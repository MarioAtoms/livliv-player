// Local static server for the lip-sync comparison. No dependencies.
// Listens on loopback only. Refuses VoiceStudio's port and the other reserved local port.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ROOT, 'public')
const PID_FILE = path.join(ROOT, 'server.pid')
export const RESERVED_PORTS = new Set([3900, 8790])
export const DEFAULT_PORT = 8877

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

export function portAllowed(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535 && !RESERVED_PORTS.has(port)
}

function readPid() {
  try {
    const text = fs.readFileSync(PID_FILE, 'utf8')
    const pid = Number(text.trim().split(/\s+/)[0])
    const port = Number(text.trim().split(/\s+/)[1] || DEFAULT_PORT)
    return { pid, port }
  } catch {
    return null
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function stop() {
  const cur = readPid()
  if (!cur) {
    console.log('No server.pid. Nothing to stop.')
    return 0
  }
  if (!alive(cur.pid)) {
    fs.rmSync(PID_FILE, { force: true })
    console.log(`Stale pid ${cur.pid} removed. The server is not running.`)
    return 0
  }
  process.kill(cur.pid, 'SIGTERM')
  fs.rmSync(PID_FILE, { force: true })
  console.log(`Stopped pid ${cur.pid} (port ${cur.port}).`)
  return 0
}

function safeFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel === '/') rel = '/index.html'
  if (rel.includes('\0')) return null
  const file = path.resolve(PUBLIC, '.' + rel)
  const root = path.resolve(PUBLIC)
  if (file !== root && !file.startsWith(root + path.sep)) return null
  return file
}

function hostOk(req, port) {
  const host = req.headers.host
  if (!host) return true
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ])
  return allowed.has(host)
}

function createHandler(port) {
  return (req, res) => {
    if (!hostOk(req, port)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('This server answers 127.0.0.1 only.\n')
      return
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, bind: '127.0.0.1', port }))
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    const file = safeFile(url.pathname)
    if (!file) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Forbidden\n')
      return
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Not found\n')
        return
      }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
      res.writeHead(200, {
        'content-type': type,
        'content-length': st.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      if (req.method === 'HEAD') { res.end(); return }
      fs.createReadStream(file).pipe(res)
    })
  }
}

function listen(port) {
  const handler = createHandler(port)
  const v4 = http.createServer(handler)
  const v6 = http.createServer(handler)
  v4.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop that process or set PORT to another free port. Do not use 3900 or 8790.`
      : `Could not bind 127.0.0.1:${port}: ${err.message}`)
    process.exit(1)
  })
  v4.listen({ host: '127.0.0.1', port }, () => {
    fs.writeFileSync(PID_FILE, `${process.pid} ${port}\n`)
    console.log(`listening http://127.0.0.1:${port}/`)
    v6.on('error', (err) => {
      console.log(`::1 was not bound (${err.code || err.message}). Use http://127.0.0.1:${port}/`)
    })
    v6.listen({ host: '::1', port, ipv6Only: true }, () => {
      console.log(`listening http://[::1]:${port}/`)
    })
  })
  const shutdown = () => {
    fs.rmSync(PID_FILE, { force: true })
    v4.close()
    v6.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.includes('--stop')) process.exit(stop())
  const port = Number(process.env.PORT || DEFAULT_PORT)
  if (!portAllowed(port)) {
    console.error(`Refusing port ${port}. VoiceStudio uses 3900 and another local service uses 8790. Those stay untouched. Pick another port, for example 8877.`)
    process.exit(1)
  }
  if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) {
    console.error(`Missing ${path.join(PUBLIC, 'index.html')}. Run the comparison build first.`)
    process.exit(1)
  }
  const cur = readPid()
  if (cur && alive(cur.pid)) {
    console.error(`Already running as pid ${cur.pid} on port ${cur.port}. Stop it before starting another.`)
    process.exit(1)
  }
  listen(port)
}
