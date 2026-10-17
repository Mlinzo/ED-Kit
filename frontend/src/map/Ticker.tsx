import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

/**
 * Idle frame rate. The maps run next to the game, often on the same GPU: slow ambient motion
 * (orbits, twinkle, pulses) does not need 60 fps. Interaction and camera flights request their
 * own frames and run at the full rate.
 */
export function Ticker({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const id = window.setInterval(() => invalidate(), 1_000 / fps)
    return () => window.clearInterval(id)
  }, [fps, invalidate])
  return null
}
