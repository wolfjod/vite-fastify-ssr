import {buildServer} from "./buildServer.js";

const port = process.env.PORT || 5173
// Start http server
const fastify = await buildServer()

fastify.get('/hello', (request, reply) => {
  reply.send({ hello: 'world' })
})

fastify.listen({ port }, (err, address) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
  console.log(`Server started at http://localhost:${port}`)
})
