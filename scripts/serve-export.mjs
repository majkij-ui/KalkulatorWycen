/**
 * Serves the static export (`out/`, `npm run build`) on 127.0.0.1 — for checking
 * the production build in a browser (dev mode's StrictMode can fake PDF-draft
 * bugs, see PDF_EXPORT.md). Usage: `node scripts/serve-export.mjs [port]`.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../out/', import.meta.url))
const port = Number(process.argv[2] ?? process.env.PORT ?? 3010)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  let file = normalize(join(root, path))
  if (!file.startsWith(root)) return res.writeHead(403).end()
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
  } catch {
    file = `${file}.html`
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`))
