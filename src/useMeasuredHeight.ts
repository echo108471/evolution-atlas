import { useCallback, useRef } from 'react'

/**
 * Publishes an element's height as a CSS custom property on the document root, so
 * layout that has to clear sticky chrome can reference the real measurement rather
 * than a constant that drifts the moment that chrome wraps or its type scale moves.
 *
 * This is a callback ref rather than an effect over an object ref: the measured
 * element often mounts later than its owner — the product header only exists once
 * the dataset resolves — and an effect keyed on nothing would have run once against
 * a null ref and never looked again.
 */
export function useMeasuredHeight(property: string) {
  const observerRef = useRef<ResizeObserver | null>(null)

  return useCallback(
    (element: HTMLElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null

      if (!element) {
        // Back to the declared fallback, so a view without this chrome is not left
        // clearing room for something that is no longer on screen.
        document.documentElement.style.removeProperty(property)
        return
      }

      const publish = () => {
        const { height } = element.getBoundingClientRect()
        document.documentElement.style.setProperty(property, `${Math.round(height)}px`)
      }

      publish()
      const observer = new ResizeObserver(publish)
      observer.observe(element)
      observerRef.current = observer
    },
    [property],
  )
}
