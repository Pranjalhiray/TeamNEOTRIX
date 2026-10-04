import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(frontendRoot, '..')
const artifactPath = resolve(projectRoot, 'artifacts', 'bundle.joblib')
const windows = process.platform === 'win32'
const localPython = resolve(projectRoot, '.venv', windows ? 'Scripts/python.exe' : 'bin/python')
const python = existsSync(localPython) ? localPython : (windows ? 'python' : 'python3')

function availablePort(start, end) {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    let port = start

    const tryPort = () => {
      if (port > end) {
        reject(new Error(`No free local port was found between ${start} and ${end}.`))
        return
      }

      server.once('error', () => {
        port += 1
        tryPort()
      })
      server.listen(port, '127.0.0.1', () => {
        const selected = port
        server.close((error) => error ? reject(error) : resolvePort(selected))
      })
    }

    tryPort()
  })
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ error }))
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))

async function waitForApi(child, url) {
  const deadline = Date.now() + 120_000
  let spawnError
  child.once('error', (error) => { spawnError = error })

  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Could not start Python API: ${spawnError.message}`)
    if (child.exitCode !== null) throw new Error(`Python API exited during startup (code ${child.exitCode}).`)

    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) {
        const health = await response.json()
        if (health.status === 'ok' && health.artifacts_loaded) return
      }
    } catch {
      // The API can take a while to load the local model bundle.
    }
    await sleep(500)
  }

  throw new Error('The Python API did not finish loading its model bundle within two minutes.')
}

async function main() {
  if (!existsSync(artifactPath)) {
    throw new Error('The model bundle is missing. From the project root, run: python src/build_artifacts.py')
  }

  const apiPort = await availablePort(8000, 8010)
  const frontendPort = await availablePort(5173, 5183)
  const apiUrl = `http://127.0.0.1:${apiPort}`

  console.log(`Starting the local analysis API at ${apiUrl} ...`)
  const api = spawn(python, [
    '-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', String(apiPort),
  ], { cwd: projectRoot, stdio: 'inherit' })
  const apiExited = waitForExit(api)

  let frontend
  let interrupted = false
  const stopChildren = () => {
    if (frontend && frontend.exitCode === null) frontend.kill()
    if (api.exitCode === null) api.kill()
  }
  const handleSignal = () => {
    interrupted = true
    stopChildren()
  }
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)

  try {
    await waitForApi(api, apiUrl)
    console.log(`Local analysis API ready. Starting dashboard at http://127.0.0.1:${frontendPort} ...`)

    frontend = spawn(process.execPath, [
      resolve(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort',
    ], {
      cwd: frontendRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: apiUrl,
        VITE_PORT: String(frontendPort),
      },
    })

    const result = await Promise.race([waitForExit(frontend), apiExited])
    if (result.error) throw result.error
    if (interrupted) process.exitCode = 130
    else process.exitCode = result.code ?? 1
  } finally {
    stopChildren()
    process.removeListener('SIGINT', handleSignal)
    process.removeListener('SIGTERM', handleSignal)
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`)
  process.exitCode = 1
})
