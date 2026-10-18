// Engineers on the galaxy map: an orange ring per workshop, filled once you have unlocked them,
// dim until you have met them. Named on hover (thirty of them crowd the bubble).

import { memo } from 'react'
import { Marker } from '../../route/map/layers'
import { ENGINEER_COLOR } from './colors'
import type { EngineerPoint } from './engineers'

export const EngineerMarks = memo(function EngineerMarks({ points }: { points: readonly EngineerPoint[] }) {
  return (
    <>
      {points.map((p) => {
        const progress = p.engineer.progress
        return (
          <group key={p.key}>
            <Marker pos={p.pos} color={ENGINEER_COLOR} size={p.size} inner={0.6} opacity={progress ? 0.95 : 0.5} order={4} />
            {progress === 'unlocked' && <Marker pos={p.pos} color={ENGINEER_COLOR} size={5} shape="disc" order={4} />}
          </group>
        )
      })}
    </>
  )
})
