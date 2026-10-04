import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function offlineAssetManifest(): Plugin {
  return {
    name: 'offline-asset-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .filter((entry) => entry.type === 'chunk' || !entry.fileName.endsWith('.html'))
        .map((entry) => `/${entry.fileName}`)

      this.emitFile({
        type: 'asset',
        fileName: 'offline-assets.json',
        source: JSON.stringify([...new Set(assets)]),
      })
    },
  }
}

async function localApiTarget(waitForApi: boolean) {
  const override = process.env.VITE_API_PROXY_TARGET
  if (override) return override

  // A production build needs no running API. During development, wait for the
  // local model service to finish loading instead of silently proxying to 8000.
  if (!waitForApi) return 'http://127.0.0.1:8000'

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const targets = await Promise.all(Array.from({ length: 11 }, (_, index) => {
      const target = `http://127.0.0.1:${8000 + index}`
      return fetch(`${target}/health`, { signal: AbortSignal.timeout(700) })
        .then(async (response) => {
          if (!response.ok) return null
          const health = await response.json() as { status?: string; artifacts_loaded?: boolean }
          return health.status === 'ok' && health.artifacts_loaded ? target : null
        })
        .catch(() => null)
    }))
    const target = targets.find((candidate): candidate is string => candidate !== null)
    if (target) return target

    await new Promise((resolve) => setTimeout(resolve, 750))
  }

  throw new Error(
    'The local analysis API did not become ready on ports 8000–8010. Start it with run_dev.ps1, or set VITE_API_PROXY_TARGET to its local URL.',
  )
}

// https://vite.dev/config/
export default defineConfig(async ({ command }) => {
  const apiTarget = await localApiTarget(command === 'serve')
  console.info(`[offline dashboard] Local API proxy: ${apiTarget}`)
  return {
    plugins: [react(), offlineAssetManifest()],
    server: {
      host: '127.0.0.1',
      port: Number(process.env.VITE_PORT || 5173),
      strictPort: true,
      hmr: {
        host: '127.0.0.1',
      },
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
      },
    },
  }
})
