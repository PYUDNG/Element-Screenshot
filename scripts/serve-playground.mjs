import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = process.cwd()
const port = Number(process.env.PLAYGROUND_PORT || 4176)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
}

const files = new Map([
  ['/', join(root, 'playground/index.html')],
  ['/index.html', join(root, 'playground/index.html')],
  ['/gm-stub.js', join(root, 'playground/gm-stub.js')],
  ['/sample.svg', join(root, 'playground/sample.svg')],
  ['/element-shot.user.js', join(root, 'packages/userscript/dist/element-shot.user.js')],
  ['/settings-iife.html', join(root, 'playground/settings-iife.html')],
  ['/settings-iife.js', join(root, 'packages/settings/dist/iife/userscript-settings.iife.js')],
  ['/settings-esm.html', join(root, 'playground/settings-esm.html')],
  ['/vue-esm.js', join(root, 'node_modules/vue/dist/vue.esm-browser.prod.js')]
])

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  let file = files.get(url.pathname)

  if (!file && url.pathname.startsWith('/settings-dist/')) {
    file = join(root, 'packages/settings/dist', url.pathname.slice('/settings-dist/'.length))
  }

  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }

  const resolved = normalize(file)
  if (!resolved.startsWith(root) || !existsSync(resolved)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }

  const stats = statSync(resolved)
  response.writeHead(200, {
    'content-type': MIME[extname(resolved)] || 'application/octet-stream',
    'content-length': stats.size,
    'cache-control': 'no-store'
  })
  createReadStream(resolved).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`playground: http://127.0.0.1:${port}/`)
})
