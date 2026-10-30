/** Bounded loopback static preview server for generated Vite output. */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/** One running preview server owned by the verifier. */
export interface PreviewServer {
  readonly url: string
  /** Stop listening and wait until all owned connections are released. */
  close(): Promise<void>
}

/**
 * Serve one built project from an OS-assigned loopback port.
 * @param workspace - generated project root containing `dist/`.
 * @returns a ready server with an owned URL and quiescent close operation.
 */
export async function startPreviewServer(workspace: string): Promise<PreviewServer> {
  const root = resolve(workspace, 'dist')
  const server = createServer((request, response) => {
    void serveRequest(root, request, response)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  const address = server.address() as AddressInfo
  let closed = false
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return
      closed = true
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error === undefined) {
            resolveClose()
            return
          }
          rejectClose(error)
        })
        server.closeAllConnections()
      })
    },
  }
}

/** Serve one request with SPA navigation fallback and workspace confinement. */
async function serveRequest(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const pathname = decodeURIComponent(requestUrl.pathname)
    let target = resolve(root, `.${pathname}`)
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden')
      return
    }
    const metadata = await stat(target).catch(() => undefined)
    if (metadata?.isDirectory() === true) target = resolve(target, 'index.html')
    if (metadata === undefined || metadata.isDirectory()) {
      if (extname(pathname) !== '') {
        response.writeHead(404).end('Not found')
        return
      }
      target = resolve(root, 'index.html')
    }
    const body = await readFile(target)
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    })
    response.end(body)
  } catch {
    response.writeHead(500).end('Preview server failed')
  }
}
