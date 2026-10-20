import { useMemo } from 'react'
import { encode } from 'uqr'

/**
 * A QR code for a phone camera: dark modules on white with a quiet zone, whatever the theme
 * (phone scanners want that contrast).
 */
export function QrCode({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 })
    let d = ''
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { size: qr.size, path: d }
  }, [text])

  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label} className={className}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#09090b" />
    </svg>
  )
}
