import Fastify from 'fastify'
import fs from 'node:fs/promises'
import { createViteRuntime } from 'vite'
import {fileURLToPath} from "node:url";
import { dirname } from 'node:path'

// Constants
const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 5173
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const base = __dirname

// Cached production assets
const templateHtml = isProduction
    ? await fs.readFile('./dist/client/index.html', 'utf-8')
    : ''
const ssrManifest = isProduction
    ? await fs.readFile('./dist/client/.vite/ssr-manifest.json', 'utf-8')
    : undefined

export async function buildServer() {
  // Create http server
  const app = Fastify()

  // Add Vite or respective production middlewares
  let vite
  if (!isProduction) {
    // We instantiate Vite's development server and integrate its middleware to our server.
    // ! We instantiate it only in development. (It isn't needed in production, and it
    // would unnecessarily bloat our production server.)
    const { createServer } = await import('vite')
    vite = await createServer({
      server: { middlewareMode: true },
      appType: 'custom',
      root: base,
    })
    const viteDevMiddleware = vite.middlewares

    // this is middleware for vite's dev server
    app.addHook('onRequest', async (request, reply) => {
      const next = () =>
        new Promise(resolve => {
          viteDevMiddleware(request.raw, reply.raw, () => resolve())
        })
      await next()
    })
  } else {
    // In production, we need to serve our static assets ourselves.
    // (In dev, Vite's middleware serves our static assets.)

    /* [TODO] Move this to Nginx */
    await app.register(import('@fastify/compress'))

    await app.register(import('@fastify/static'), {
      root: `${base}/dist/client`,
    })
  }

  // Serve HTML
  app.get('/', async (req, reply) => {
    try {
      const url = req.raw.url.replace(base, '')

      let template
      let render
      if (!isProduction) {
        // Always read fresh template in development
        template = await fs.readFile('./index.html', 'utf-8')
        template = await vite.transformIndexHtml(url, template)
        const runtime = await createViteRuntime(vite)
        render = (await runtime.executeEntrypoint('/src/entry-server.tsx'))
          .render
      } else {
        template = templateHtml
        render = (await import('./dist/server/entry-server.js')).render
      }

      const rendered = await render(url, ssrManifest)

      const html = template
        .replace('<!--app-head-->', rendered.head ?? '')
        .replace('<!--app-html-->', rendered.html ?? '')

      reply
        .code(200)
        .headers({
          'Content-Type': 'text/html',
          'Cache-Control': 'no-store, max-age=0',
        })
        .send(html)
    } catch (e) {
      vite?.ssrFixStacktrace(e)
      reply.code(500).send(e.stack)
    }
  })
  return app
}
