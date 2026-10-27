import { CircleCheck, Globe, LocateOff, MoveUpRight, Radar as RadarIcon } from 'lucide-react'
import { useState } from 'react'
import { useLiveStatus, useView } from '../../api/hooks'
import type { ActiveScanView, BodyView, LiveStatus } from '../../api/types'
import { CodexBadge } from '../../components/CodexBadge'
import { PlanetMaterials } from '../../components/PlanetMaterials'
import { SampleDots } from '../../components/SampleDots'
import { Segmented } from '../../components/Segmented'
import { SpeciesList, SpeciesValue } from '../../components/SpeciesList'
import { EmptyState, Label, ViewFallback } from '../../components/States'
import { HelpTip } from '../../guide/HelpTip'
import { t } from '../../i18n'
import { bodyLabel } from '../../lib/body'
import { formatDegrees, formatMeters, formatNumber } from '../../lib/format'
import { localOffset } from '../../lib/geo'
import { PlanetGlobe } from './globe/PlanetGlobe'
import { Radar, type RadarPoint } from './Radar'

type SurfaceMode = 'radar' | 'planet'

interface Geometry {
  points: RadarPoint[]
  nearest: number | null
  /** The nearest sample's number and its bearing from you (clockwise from north). */
  toNearest: { index: number; bearing: number } | null
  /** Your heading from Status.json. */
  heading: number | null
  /** Taken samples whose position was not recorded (taken while the app was not watching). */
  unknown: number
  canSample: boolean
  /** Metres still to walk to leave every colony circle (0 when free). */
  moveAway: number
}

type Position =
  | { kind: 'ok'; geometry: Geometry }
  | { kind: 'none' } // no lat/long or planet radius yet
  | { kind: 'otherBody'; bodyName: string } // Status.json says we are somewhere else

function computePosition(scan: ActiveScanView, status: LiveStatus | null, body: BodyView | null): Position {
  if (!status?.hasLatLong || status.lat === null || status.lon === null) return { kind: 'none' }
  if (body && status.bodyName && status.bodyName !== body.name) {
    return { kind: 'otherBody', bodyName: status.bodyName }
  }
  const radiusM = status.planetRadiusM ?? (body?.radiusKm ? body.radiusKm * 1_000 : null)
  if (!radiusM) return { kind: 'none' }
  const here = { lat: status.lat, lon: status.lon }
  const range = scan.colonyRangeM
  const taken = Math.min(scan.samples, 3)
  // Samples taken while the app was not watching live have no recorded position.
  const points = scan.points.map((p) => {
    const o = localOffset(here, p, radiusM)
    return { index: p.n, ...o, inside: o.distance < range }
  })
  const nearestPoint = points.reduce<RadarPoint | null>((n, p) => (!n || p.distance < n.distance ? p : n), null)
  const nearest = nearestPoint?.distance ?? null
  const toNearest = nearestPoint
    ? { index: nearestPoint.index, bearing: ((Math.atan2(nearestPoint.east, nearestPoint.north) * 180) / Math.PI + 360) % 360 }
    : null
  const inside = points.filter((p) => p.inside)
  const unknown = Math.max(0, taken - points.length)
  return {
    kind: 'ok',
    geometry: {
      points,
      nearest,
      toNearest,
      heading: status.heading,
      unknown,
      // With an unrecorded sample we cannot promise the spot is far enough away.
      canSample: inside.length === 0 && unknown === 0,
      moveAway: inside.length ? Math.max(...inside.map((p) => range - p.distance)) : 0,
    },
  }
}

function BigDistance({ metres }: { metres: number }) {
  const km = metres >= 1_000
  const value = km ? formatNumber(metres / 1_000, 1) : String(Math.round(metres))
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-7xl leading-none font-semibold tracking-tighter text-zinc-50 tabular-nums sm:text-8xl xl:text-9xl">
        {value}
      </span>
      <span className="text-3xl font-medium text-zinc-400 sm:text-4xl">{km ? t.units.km : t.units.m}</span>
    </span>
  )
}

function SampleState({ scan, position }: { scan: ActiveScanView; position: Position }) {
  if (scan.samples >= 3) {
    return (
      <div className="rounded-3xl bg-emerald-500/10 p-6 ring-1 ring-emerald-500/30">
        <p className="flex items-center gap-3 text-2xl font-semibold text-emerald-300">
          <CircleCheck className="size-7" aria-hidden />
          {t.surface.analysing}
        </p>
      </div>
    )
  }
  if (position.kind !== 'ok') {
    const other = position.kind === 'otherBody'
    return (
      <div className="rounded-3xl bg-zinc-900/60 p-6 ring-1 ring-zinc-800">
        <p className="flex items-center gap-3 text-2xl font-semibold text-zinc-300">
          <LocateOff className="size-7 shrink-0 text-zinc-500" aria-hidden />
          {other ? t.surface.otherBody : t.surface.noPosition}
        </p>
        <p className="mt-2 text-sm break-words text-zinc-500">
          {other ? t.surface.otherBodyHint(position.bodyName) : t.surface.noPositionHint}
        </p>
      </div>
    )
  }

  const geometry = position.geometry
  const { canSample, nearest, toNearest, heading, moveAway, unknown } = geometry
  const blockedByUnknown = !canSample && moveAway === 0 && unknown > 0
  return (
    <div
      className={`rounded-3xl p-6 ring-1 transition-colors duration-300 ${
        canSample ? 'bg-emerald-500/10 ring-emerald-500/30' : 'bg-amber-500/10 ring-amber-500/30'
      }`}
    >
      {nearest !== null && (
        <>
          <Label>{t.surface.nearest}</Label>
          <div className="mt-2">
            <BigDistance metres={nearest} />
          </div>
        </>
      )}
      {(heading !== null || toNearest) && (
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-400">
          {heading !== null && (
            <span>
              {t.surface.heading} <span className="font-semibold text-zinc-100 tabular-nums">{formatDegrees(heading)}</span>
            </span>
          )}
          {toNearest && (
            <span>
              {t.surface.toSample(toNearest.index)} <span className="font-semibold text-zinc-100 tabular-nums">{formatDegrees(toNearest.bearing)}</span>
            </span>
          )}
        </p>
      )}
      <p
        className={`mt-4 flex items-center gap-3 text-[28px] leading-tight font-semibold tracking-tight sm:text-4xl ${
          canSample ? 'text-emerald-300' : 'text-amber-300'
        }`}
      >
        {canSample ? (
          <CircleCheck className="size-8 shrink-0" aria-hidden />
        ) : (
          <MoveUpRight className="size-8 shrink-0" aria-hidden />
        )}
        <span className="tabular-nums">
          {canSample
            ? t.surface.canSample
            : blockedByUnknown
              ? t.surface.unknownSpot
              : t.surface.moveAway(formatMeters(Math.ceil(moveAway)))}
        </span>
      </p>
      {unknown > 0 && (
        <p className="mt-3 text-sm text-zinc-400">
          {t.surface.unknownSamples(unknown, formatMeters(scan.colonyRangeM))}
        </p>
      )}
      {/* Announce only state flips, not every metre. */}
      <span className="sr-only" aria-live="polite">
        {canSample ? t.surface.canSample : blockedByUnknown ? t.surface.unknownSpot : t.surface.tooClose}
      </span>
    </div>
  )
}

export function SurfaceScreen() {
  const { data, error, refetch } = useView('surface')
  const status = useLiveStatus()
  // The radar while you sample; the planet is one tap away (and alone when you do not sample).
  const [mode, setMode] = useState<SurfaceMode>('radar')

  if (!data) return <ViewFallback error={error} onRetry={refetch} />

  const { body, activeScan, globe } = data
  const others = body?.species.filter((s) => s.species !== activeScan?.species) ?? []

  if (!activeScan && body && globe) {
    return (
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-x-10">
        <section aria-labelledby="surface-title" className="space-y-5 lg:col-start-2 lg:row-start-1">
          <div>
            <Label>{bodyLabel(body)}</Label>
            <h1 id="surface-title" className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              {t.surface.noScan}
            </h1>
            <p className="mt-2 text-sm text-zinc-500">{t.surface.noScanHint}</p>
          </div>
          {body.species.length > 0 && (
            <div>
              <Label as="h2">{t.surface.bodySpecies}</Label>
              <div className="mt-1">
                <SpeciesList species={body.species} />
              </div>
            </div>
          )}
          {body.materials.length > 0 && (
            <div>
              <Label as="h2">{t.body.materials}</Label>
              <div className="mt-2">
                <PlanetMaterials materials={body.materials} />
              </div>
            </div>
          )}
        </section>
        <section className="lg:col-start-1 lg:row-start-1">
          <PlanetGlobe globe={globe} body={body} status={status} />
        </section>
      </div>
    )
  }

  if (!activeScan) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState icon={<RadarIcon className="size-10" />} title={t.surface.noScan} hint={t.surface.noScanHint} />
        {body && body.species.length > 0 && (
          <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-zinc-800">
            <Label>
              {t.surface.bodySpecies} · <span className="normal-case">{bodyLabel(body)}</span>
            </Label>
            <div className="mt-2">
              <SpeciesList species={body.species} />
            </div>
          </section>
        )}
      </div>
    )
  }

  const position = computePosition(activeScan, status, body)
  const geometry = position.kind === 'ok' ? position.geometry : null
  const radarLabel = t.surface.radarLabel(geometry?.nearest != null ? formatMeters(geometry.nearest) : t.common.unknown)

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-10">
      {/* Species + state (phone: top; desktop: right column) */}
      <section aria-labelledby="scan-title" className="space-y-5 lg:col-start-2 lg:row-start-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label>{activeScan.genus}</Label>
            <h1 id="scan-title" className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              {activeScan.species}
              {activeScan.colour && <span className="font-normal text-zinc-400"> · {activeScan.colour}</span>}
            </h1>
            <CodexBadge status={activeScan.codex} size="md" className="mt-2" />
            <p className="mt-2 text-sm text-zinc-500">
              {body ? `${bodyLabel(body)} · ` : ''}
              {t.species.colonyRange} {formatMeters(activeScan.colonyRangeM)}
              <HelpTip topic="colony" className="ml-1.5" />
            </p>
          </div>
          <SpeciesValue s={activeScan} className="shrink-0 text-2xl font-semibold text-emerald-300 sm:text-3xl" />
        </div>
        <div className="flex items-center gap-3">
          <SampleDots samples={activeScan.samples} size="lg" />
          <span className="text-lg font-semibold text-zinc-200">{t.species.samples(activeScan.samples)}</span>
          <HelpTip topic="sampling" />
        </div>
        <SampleState scan={activeScan} position={position} />
        {body && body.materials.length > 0 && (
          <div>
            <Label as="h2">{t.body.materials}</Label>
            <div className="mt-2">
              <PlanetMaterials materials={body.materials} />
            </div>
          </div>
        )}
      </section>

      {/* Radar or planet (desktop: left, spans both rows) */}
      <section className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
        {globe && body && (
          <div className="mb-4 flex justify-center">
            <Segmented
              label={t.globe.view}
              value={mode}
              options={[
                { id: 'radar', label: t.globe.radar, icon: RadarIcon },
                { id: 'planet', label: t.globe.planet, icon: Globe },
              ]}
              onChange={setMode}
            />
          </div>
        )}
        {mode === 'planet' && globe && body ? (
          <PlanetGlobe globe={globe} body={body} status={status} />
        ) : (
          <div className="mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-9rem))]">
            {geometry ? (
              <Radar
                points={geometry.points}
                rangeM={activeScan.colonyRangeM}
                heading={status?.heading ?? null}
                canSample={geometry.canSample}
                label={radarLabel}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-full bg-zinc-900/40 ring-1 ring-zinc-800">
                <LocateOff className="size-10 text-zinc-700" aria-hidden />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Other species on this body */}
      <section aria-labelledby="others-title" className="lg:col-start-2 lg:row-start-2">
        <Label as="h2" id="others-title">
          {t.surface.otherSpecies}
        </Label>
        {others.length > 0 ? (
          <div className="mt-1">
            <SpeciesList species={others} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">{t.surface.noOtherSpecies}</p>
        )}
      </section>
    </div>
  )
}
