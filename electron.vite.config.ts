import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // TOOM_API_URL / TOOM_ENTITLEMENT_PUBLIC_KEY from the environment or .env files (see .env.example)
  const env = { ...loadEnv(mode, process.cwd(), 'TOOM_'), ...process.env }
  return {
    main: {
      resolve: { alias: { '@shared': resolve('src/shared') } },
      define: {
        __TOOM_API_URL__: JSON.stringify(env.TOOM_API_URL ?? ''),
        __TOOM_ENTITLEMENT_PUBLIC_KEY__: JSON.stringify(env.TOOM_ENTITLEMENT_PUBLIC_KEY ?? '')
      },
      // native module: must stay in node_modules so it can find its prebuilt binary
      build: { externalizeDeps: { include: ['uiohook-napi', 'electron-liquid-glass', 'electron-updater'] } }
    },
    preload: {
      resolve: { alias: { '@shared': resolve('src/shared') } }
    },
    renderer: {
      resolve: {
        alias: {
          '@shared': resolve('src/shared'),
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [
        react(),
        tailwindcss(),
        {
          // the dev server needs websockets and localhost; shipped builds don't
          name: 'toom-csp-production',
          apply: 'build',
          transformIndexHtml: (html: string) => html.replace(' ws: http://localhost:*', '')
        }
      ]
    }
  }
})
