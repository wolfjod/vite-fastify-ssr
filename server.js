import fs from 'node:fs/promises'
import Fastify from "fastify";

// Constants
const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 5173
const base = process.env.BASE || '/'

// Cached production assets
const templateHtml = isProduction
  ? await fs.readFile('./dist/client/index.html', 'utf-8')
  : ''
const ssrManifest = isProduction
  ? await fs.readFile('./dist/client/.vite/ssr-manifest.json', 'utf-8')
  : undefined

async function buildServer() {
  // Create http server
  const app = Fastify()

// Add Vite or respective production middlewares
  let vite
  if (!isProduction) {
    // We instantiate Vite's development server and integrate its middleware to our server.
    // ⚠️ We instantiate it only in development. (It isn't needed in production, and it
    // would unnecessarily bloat our production server.)
    const { createServer } = await import("vite");
    vite = (
        await createServer({
          server: { middlewareMode: true },
          appType: 'custom',
          base
        })
    );
    const viteDevMiddleware = vite.middlewares;

    // this is middleware for vite's dev server
    app.addHook("onRequest", async (request, reply) => {
      const next = () =>
          new Promise((resolve) => {
            viteDevMiddleware(request.raw, reply.raw, () => resolve());
          });
      await next();
    });
  } else {
    // In production, we need to serve our static assets ourselves.
    // (In dev, Vite's middleware serves our static assets.)

    await app.register(import('@fastify/compress'), { global: true })
    await app.register(import('@fastify/static'), {
      root: `${base}/dist/client`,
      prefix: "/assets/",
    });
  }

// Serve HTML
  app.get('*', async (req, reply) => {
    try {
      const url = req.raw.url.replace(base, '')

      let template
      let render
      if (!isProduction) {
        // Always read fresh template in development
        template = await fs.readFile('./index.html', 'utf-8')
        template = await vite.transformIndexHtml(url, template)
        render = (await vite.ssrLoadModule('/src/entry-server.tsx')).render
      } else {
        template = templateHtml
        render = (await import('./dist/server/entry-server.js')).render
      }

      const rendered = await render(url, ssrManifest)

      const html = template
          .replace(`<!--app-head-->`, rendered.head ?? '')
          .replace(`<!--app-html-->`, rendered.html ?? '')

      reply.code(200).headers({ 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control':'no-store, max-age=0' }).send(html)
    } catch (e) {
      vite?.ssrFixStacktrace(e)
      res.status(500).end(e.stack)
    }
  })
  return app;
}

// Start http server
const fastify = await buildServer();

fastify.listen({ port }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Server started at http://localhost:${port}`)
});
