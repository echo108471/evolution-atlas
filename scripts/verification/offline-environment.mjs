import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const OFFLINE_PRELOAD = fileURLToPath(new URL('./offline-preload.cjs', import.meta.url))

/** Keep local tooling usable without inheriting provider, GitHub, proxy, or Git credentials. */
export function createOfflineEnvironment({ home, environment = process.env } = {}) {
  if (!home) throw new Error('An isolated HOME is required for offline validation')
  const allowed = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
    'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PLAYWRIGHT_BROWSERS_PATH']
  return {
    ...Object.fromEntries(allowed.filter(key => environment[key] !== undefined).map(key => [key, environment[key]])),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    NODE_OPTIONS: `--require=${JSON.stringify(OFFLINE_PRELOAD)}`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'file',
    NPM_CONFIG_OFFLINE: 'true',
    NPM_CONFIG_USERCONFIG: join(home, '.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: join(home, 'global-npmrc'),
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
  }
}
