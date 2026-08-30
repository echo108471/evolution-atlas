import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const PUBLIC_DIR = 'public'
const OUT_DIR = 'dist'
const GALLERY_MANIFEST = join(PUBLIC_DIR, 'gallery', 'manifest.json')

/**
 * `public/` holds two unrelated things: the gallery a hosted site publishes, and whatever
 * local `atlas*.json` or `epochs*.json` a maintainer generated from their own repository.
 * An epoch document quotes commit subjects and dates, so it leaks the same history the
 * dataset does and is excluded on the same terms. Vite copies both
 * into the build, so deploying a gallery from a working tree that has been used locally
 * would also publish private histories — contributor names and emails included. Those
 * files are gitignored, which keeps them out of the repository but not out of `dist/`.
 *
 * A build is a gallery build when a gallery manifest exists, and a personal build when it
 * does not. Only the former drops the loose datasets, so a maintainer deploying their own
 * atlas still gets the `/atlas.json` the viewer falls back to.
 */
function excludeLocalDatasetsFromGalleryBuilds(): Plugin {
  return {
    name: 'evolution-atlas:exclude-local-datasets',
    apply: 'build',
    closeBundle() {
      if (!existsSync(GALLERY_MANIFEST)) return

      const removed = readdirSync(OUT_DIR)
        .filter((entry) => /^(atlas|epochs|readings).*\.json$/.test(entry))
        .map((entry) => {
          rmSync(join(OUT_DIR, entry))
          return entry
        })

      if (removed.length > 0) {
        this.info(`gallery build: excluded ${removed.length} local dataset(s): ${removed.join(', ')}`)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), excludeLocalDatasetsFromGalleryBuilds()],
})
