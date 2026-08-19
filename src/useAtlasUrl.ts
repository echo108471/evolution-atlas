import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { parseAtlasUrl, serializeAtlasUrl, type AtlasUrlState } from './urlState'

/**
 * `history.pushState` and `history.replaceState` deliberately do not fire `popstate`, so
 * our own writes announce themselves on this event. Every subscriber then re-reads the
 * one source of truth: the address bar.
 */
const URL_CHANGE_EVENT = 'atlas:urlchange'

function subscribe(onStoreChange: () => void) {
  window.addEventListener('popstate', onStoreChange)
  window.addEventListener(URL_CHANGE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('popstate', onStoreChange)
    window.removeEventListener(URL_CHANGE_EVENT, onStoreChange)
  }
}

function getSearchSnapshot() {
  return window.location.search
}

function getServerSearchSnapshot() {
  return ''
}

export interface AtlasUrlWriteOptions {
  /** Rewrite the current entry instead of adding one. Use it for scrubbing and filters. */
  replace?: boolean
}

/**
 * Reads navigation state from the query string and writes patches back to it. There is no
 * mirrored copy in React state: the URL is the state, so links, reloads, and the browser's
 * back button all agree by construction.
 */
export function useAtlasUrl(): [
  AtlasUrlState,
  (patch: Partial<AtlasUrlState>, options?: AtlasUrlWriteOptions) => void,
] {
  const search = useSyncExternalStore(subscribe, getSearchSnapshot, getServerSearchSnapshot)
  const state = useMemo(() => parseAtlasUrl(search), [search])

  const setUrl = useCallback(
    (patch: Partial<AtlasUrlState>, options?: AtlasUrlWriteOptions) => {
      // Read at call time rather than closing over `state`, so two patches in one event
      // handler compose instead of the second overwriting the first.
      const nextSearch = serializeAtlasUrl({ ...parseAtlasUrl(window.location.search), ...patch })
      if (nextSearch === window.location.search) return
      const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`
      if (options?.replace) {
        window.history.replaceState(null, '', nextUrl)
      } else {
        window.history.pushState(null, '', nextUrl)
      }
      window.dispatchEvent(new Event(URL_CHANGE_EVENT))
    },
    [],
  )

  return [state, setUrl]
}
