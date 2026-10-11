import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { publicationAssetsPlugin } from './scripts/lib/build-publication.mjs'

export default defineConfig(({ command }) => ({
  // Development can inspect local data. Production includes only approved snapshots.
  publicDir: command === 'build' ? false : 'public',
  build: { copyPublicDir: false, emptyOutDir: true },
  plugins: [react(), publicationAssetsPlugin()],
}))
