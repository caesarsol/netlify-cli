const cliPath = require('./cli-path')
const path = require('path')
const getPort = require('get-port')
const seedrandom = require('seedrandom')
const execa = require('execa')
const pidtree = require('pidtree')

// each process gets a starting port based on the pid
const rng = seedrandom(`${process.pid}`)
function getRandomPortStart(rng) {
  const startPort = Math.floor(rng() * RANDOM_PORT_SHIFT) + RANDOM_PORT_SHIFT
  return startPort
}

// To avoid collisions with frameworks ports
const RANDOM_PORT_SHIFT = 1e4
const FRAMEWORK_PORT_SHIFT = 1e3

let currentPort = getRandomPortStart(rng)

const startServer = async ({ cwd, env = {}, args = [] }) => {
  const tryPort = currentPort++
  const port = await getPort({ port: tryPort })
  const host = 'localhost'
  const url = `http://${host}:${port}`
  console.log(`Starting dev server on port: ${port} in directory ${path.basename(cwd)}`)
  const ps = execa(cliPath, ['dev', '-p', port, '--staticServerPort', port + FRAMEWORK_PORT_SHIFT, ...args], {
    cwd,
    env: { BROWSER: 'none', ...env },
  })
  return new Promise((resolve, reject) => {
    let selfKilled = false
    ps.stdout.on('data', (data) => {
      if (data.toString().includes('Server now ready on')) {
        resolve({
          url,
          host,
          port,
          close: async () => {
            selfKilled = true
            const pids = await pidtree(ps.pid).catch(() => [])
            pids.forEach((pid) => {
              try {
                process.kill(pid)
              } catch (error) {
                // no-op
              }
            })
            ps.kill()
            await Promise.race([ps.catch(() => {}), new Promise((resolve) => setTimeout(resolve, SERVER_EXIT_TIMEOUT))])
          },
        })
      }
    })
    ps.catch((error) => !selfKilled && reject(error))
  })
}

// One second
const SERVER_EXIT_TIMEOUT = 1e3

const startDevServer = async (options) => {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const server = await startServer(options)
      return server
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error
      }
      console.warn('Retrying startDevServer', error)
    }
  }
}

const withDevServer = async (options, testHandler) => {
  let server
  try {
    server = await startDevServer(options)
    return await testHandler(server)
  } finally {
    if (server) {
      await server.close()
    }
  }
}

module.exports = {
  withDevServer,
  startDevServer,
}
