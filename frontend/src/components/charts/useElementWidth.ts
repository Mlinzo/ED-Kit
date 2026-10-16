import { useCallback, useEffect, useState } from 'react'

/**
 * Measures an element's content width (px) with a ResizeObserver.
 * Charts render their SVG at exactly this width so marks and text stay crisp at 1:1.
 */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  const ref = useCallback((el: T | null) => setNode(el), [])

  useEffect(() => {
    if (!node) return
    // A momentary 0 (container hidden or mid-relayout) keeps the last width instead of unmounting the chart.
    const update = () => {
      const w = Math.round(node.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])

  return [ref, width]
}
