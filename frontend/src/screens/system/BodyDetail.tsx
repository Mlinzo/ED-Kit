import { Check, Leaf, Map as MapIcon, MapPin, Route, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import type { BodyView, BookmarkCategory } from '../../api/types'
import { ReasonChips, type RouteTarget } from '../../components/BodyBadges'
import { BookmarkBox } from '../../components/Bookmark'
import { bookmarkName, type BookmarkTarget } from '../../components/bookmarks'
import { CodexSummary } from '../../components/CodexBadge'
import { CreditRange, Credits } from '../../components/Credits'
import { communityText, isCommunity } from '../../components/source'
import { CommunityGlyph, CommunityNotice, SourceList, SourceTag } from '../../components/SourceBadge'
import { SpeciesList } from '../../components/SpeciesList'
import { Label } from '../../components/States'
import { HelpTip } from '../../guide/HelpTip'
import { t } from '../../i18n'
import type { TopicId } from '../../guide/topics'
import { bodyLabel } from '../../lib/body'
import { formatMass, formatGravity, formatKelvin, formatKm, formatLs } from '../../lib/format'

function Section({
  title,
  help,
  aside,
  children,
}: {
  title: string
  help?: TopicId
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Label>{title}</Label>
          {help && <HelpTip topic={help} />}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Fact({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] break-words text-zinc-100">{children}</dd>
    </div>
  )
}

function Row({ label, help, children }: { label: string; help?: TopicId; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="flex items-center gap-1.5 text-sm text-zinc-500">
        {label}
        {help && <HelpTip topic={help} />}
      </dt>
      <dd className="text-right text-[15px] text-zinc-100">{children}</dd>
    </div>
  )
}

function ValueTile({
  label,
  children,
  tone = 'text-zinc-100',
  className = '',
}: {
  label: string
  children: ReactNode
  tone?: string
  className?: string
}) {
  return (
    <div className={`rounded-xl bg-zinc-900/70 px-3 py-2.5 ring-1 ring-zinc-800 ${className}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tracking-tight ${tone}`}>{children}</div>
    </div>
  )
}

/** One line of the progress panel: icon, what, and its state on the right. */
function ProgressRow({
  icon: Icon,
  label,
  complete,
  state,
  children,
}: {
  icon: typeof Leaf
  label: string
  complete: boolean
  state: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${
            complete ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' : 'bg-zinc-800/80 text-zinc-300 ring-zinc-700/60'
          }`}
        >
          <Icon className="size-4" strokeWidth={2.25} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm text-zinc-300">{label}</span>
        <span className={`text-right text-[15px] font-semibold ${complete ? 'text-emerald-300' : 'text-zinc-100'}`}>{state}</span>
      </div>
      {children && <div className="mt-2.5 pl-11">{children}</div>}
    </div>
  )
}

/** Bio signals by state: analysed, being sampled, still to do. */
function bioCounts(body: BodyView) {
  const total = body.signals.bio
  const done = Math.min(body.bioDone, total)
  const sampling = Math.min(total - done, body.species.filter((s) => s.status === 'sampling').length)
  return { total, done, sampling, left: total - done - sampling }
}

const BIO_STATES = [
  { key: 'done', dot: 'bg-emerald-400', label: t.progress.analysed },
  { key: 'sampling', dot: 'bg-accent', label: t.progress.legendSampling },
  { key: 'left', dot: 'bg-zinc-600', label: t.progress.legendLeft },
] as const

/**
 * One segment per bio signal (analysed emerald, being sampled accent, to do grey) and its legend.
 * The species themselves, with their state, are listed once, in the Biology section below.
 */
function BioSegments({ body }: { body: BodyView }) {
  const counts = bioCounts(body)
  return (
    <>
      <div className="flex h-1.5 gap-0.5" aria-hidden>
        {Array.from({ length: counts.total }, (_, i) => (
          <span
            key={i}
            className={`h-full flex-1 first:rounded-l-full last:rounded-r-full ${
              i < counts.done ? 'bg-emerald-400' : i < counts.done + counts.sampling ? 'bg-accent' : 'bg-zinc-800'
            }`}
          />
        ))}
      </div>
      {/* All analysed: the header already says "N из N ✓", a one-entry legend would repeat it. */}
      {counts.done < counts.total && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
          {BIO_STATES.filter((st) => counts[st.key] > 0).map((st) => (
            <li key={st.key} className="inline-flex items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
              {st.label}
              <span className="font-medium text-zinc-200 tabular-nums">{counts[st.key]}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** What is already collected here: DSS map and exobiology, each species with its state. */
function ProgressPanel({ body }: { body: BodyView }) {
  const showDss = body.kind === 'planet' && (body.worthMapping || body.mappedByMe)
  const bio = body.signals.bio
  if (!showDss && bio === 0) return null
  const speciesKnown = body.species.some((s) => s.status !== 'predicted' || s.certain)
  const bioComplete = bio > 0 && body.bioDone >= bio

  return (
    <section
      aria-labelledby="progress-title"
      className={`rounded-2xl p-4 ring-1 ${body.done ? 'bg-emerald-500/[0.06] ring-emerald-500/25' : 'bg-zinc-900/70 ring-zinc-800'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <Label as="h3" id="progress-title">
          {t.progress.title}
        </Label>
        {body.done && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-400/30 ring-inset">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
            {t.progress.done}
          </span>
        )}
      </div>
      <div className="divide-y divide-zinc-800/70">
        {showDss && (
          <ProgressRow
            icon={MapIcon}
            label={t.progress.dss}
            complete={body.mappedByMe}
            state={
              body.mappedByMe ? (
                <span className="inline-flex items-center gap-1">
                  {t.progress.mapped}
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                </span>
              ) : (
                <span className="text-sm font-medium text-zinc-300">{t.progress.worthMapping}</span>
              )
            }
          >
            {!body.mappedByMe && <p className="text-xs text-zinc-500">{t.body.worthMappingHint}</p>}
          </ProgressRow>
        )}
        {bio > 0 && (
          <ProgressRow
            icon={Leaf}
            label={t.progress.bio}
            complete={bioComplete}
            state={
              <span className="inline-flex items-center gap-1 tabular-nums" title={t.progress.bioTitle(body.bioDone, bio)}>
                {t.progress.bioOf(Math.min(body.bioDone, bio), bio)}
                {bioComplete && <Check className="size-4" strokeWidth={3} aria-hidden />}
              </span>
            }
          >
            <BioSegments body={body} />
            {!speciesKnown && !bioComplete && <p className="mt-2 text-xs text-zinc-500">{t.progress.bioSpeciesUnknown}</p>}
          </ProgressRow>
        )}
      </div>
    </section>
  )
}

/** The tag a new bookmark on this body starts with: what it is most likely kept for. */
function suggestedTag(body: BodyView): BookmarkCategory {
  if (body.signals.bio > 0 || body.species.length > 0) return 'bio'
  if (body.signals.mining > 0) return 'mining'
  if (body.signals.geo > 0) return 'geo'
  return 'other'
}

export function BodyDetail({
  body,
  headingId,
  isCurrent,
  routeTarget = null,
  bookmarkTarget = null,
}: {
  body: BodyView
  headingId: string
  isCurrent: boolean
  /** The stored route counts on this body. */
  routeTarget?: RouteTarget | null
  /** What your bookmark on this body marks (null: none, e.g. no system address). */
  bookmarkTarget?: BookmarkTarget | null
}) {
  const hasBio = body.signals.bio > 0 || body.species.length > 0
  const isPlanet = body.kind === 'planet'
  const otherSignals = [
    { label: t.body.signalGeo, n: body.signals.geo },
    { label: t.body.signalMining, n: body.signals.mining },
    { label: t.body.signalHuman, n: body.signals.human },
    { label: t.body.signalOther, n: body.signals.other },
  ].filter((s) => s.n > 0)
  // Bio data from a community database on a body you scanned yourself (a database body says so
  // once, in the notice under the header).
  const signalsFromDb = !isCommunity(body.source) && isCommunity(body.signalsSource) ? body.signalsSource : null
  const genusesFromDb = !isCommunity(body.source) && isCommunity(body.genusesSource) ? body.genusesSource : null

  return (
    <article aria-labelledby={headingId} className="space-y-7">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          {body.kind === 'star' && <Sun className="size-4 text-zinc-400" aria-hidden />}
          <span>{body.subtype}</span>
        </div>
        <h2 id={headingId} className="text-3xl font-semibold tracking-tight text-zinc-50 proportional-nums">
          {bodyLabel(body)}
        </h2>
        <p className="text-sm text-zinc-500 proportional-nums">
          {body.name} · {formatLs(body.distanceLs)}
        </p>
        {(isCurrent || routeTarget) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {isCurrent && (
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                <MapPin className="size-4" aria-hidden />
                {t.system.youAreHere}
              </p>
            )}
            {routeTarget && (
              <p
                className={`inline-flex items-center gap-1.5 text-sm font-medium ${routeTarget === 'done' ? 'text-zinc-500' : 'text-accent'}`}
                title={t.system.route.targetHint}
              >
                <Route className="size-4" aria-hidden />
                {routeTarget === 'done' ? t.badges.routeTargetDone : t.badges.routeTarget}
              </p>
            )}
          </div>
        )}
        {body.reasons.length > 0 && (
          <div className="pt-1">
            <h3 className="sr-only">{t.reasons.title}</h3>
            <ReasonChips reasons={body.reasons} />
          </div>
        )}
        {body.species.length > 0 && (
          <div className="pt-1">
            <CodexSummary body={body} />
          </div>
        )}
        {isCommunity(body.source) && (
          <div className="pt-1">
            <CommunityNotice body={body} />
          </div>
        )}
        {bookmarkTarget && (
          <div className="pt-1">
            <BookmarkBox key={body.id64} bookmark={body.bookmark} target={bookmarkTarget} suggest={suggestedTag(body)} />
          </div>
        )}
        {bookmarkTarget && body.places.length > 0 && (
          <div className="pt-1">
            <p className="text-xs text-zinc-500">{t.bookmarks.places}</p>
            <ul className="mt-1.5 space-y-2">
              {body.places.map((p) => (
                <li key={p.id}>
                  <p className="mb-1 text-xs text-zinc-400 tabular-nums">{bookmarkName(p)}</p>
                  <BookmarkBox bookmark={p} target={{ ...bookmarkTarget, kind: 'place', lat: p.lat, lon: p.lon }} compact />
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <ProgressPanel body={body} />

      <Section
        title={t.body.values}
        help="dss"
        aside={
          <span className="text-sm text-zinc-500">
            {t.body.total} <Credits value={body.totalValue} className="font-semibold text-zinc-200" />
          </span>
        }
      >
        <div className="grid grid-cols-4 gap-2">
          <ValueTile label={t.system.fss}>
            <Credits value={body.fssValue} />
          </ValueTile>
          <ValueTile label={t.system.dss} tone={body.worthMapping ? 'text-emerald-300' : 'text-zinc-100'}>
            {isPlanet && body.dssValue > 0 ? <Credits value={body.dssValue} /> : t.common.unknown}
          </ValueTile>
          <ValueTile
            label={t.system.bio}
            tone={body.bioValueMax > 0 ? 'text-emerald-300' : 'text-zinc-500'}
            className="col-span-2"
          >
            {body.bioValueMax > 0 ? <CreditRange min={body.bioValueMin} max={body.bioValueMax} /> : t.common.unknown}
          </ValueTile>
        </div>
      </Section>

      {hasBio && (
        <Section
          title={t.body.biology}
          help="bio"
          aside={
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-300/90">
              {t.body.bioSignals(body.signals.bio)}
              {signalsFromDb && (
                <span title={`${t.source.bioSignals}: ${communityText(signalsFromDb)}`} className="inline-flex">
                  <CommunityGlyph className="size-3.5" />
                  <span className="sr-only">{communityText(signalsFromDb)}</span>
                </span>
              )}
            </span>
          }
        >
          {body.genuses.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <ul className="contents" aria-label={t.body.genuses}>
                {body.genuses.map((g) => (
                  <li key={g} className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-xs font-medium text-zinc-300">
                    {g}
                  </li>
                ))}
              </ul>
              {genusesFromDb && (
                <SourceTag
                  className="ml-1 text-xs"
                  marker={{
                    scope: 'bio',
                    source: genusesFromDb,
                    title: `${t.source.genuses}: ${communityText(genusesFromDb)}`,
                  }}
                />
              )}
            </div>
          )}
          {body.species.length > 0 ? (
            <SpeciesList species={body.species} />
          ) : (
            <p className="text-sm text-zinc-500">
              {t.body.noSpecies}. {t.body.noSpeciesHint}
            </p>
          )}
        </Section>
      )}

      <Section title={t.body.physical}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {isPlanet && <Fact label={t.body.gravity}>{formatGravity(body.gravityG)}</Fact>}
          <Fact label={t.body.temperature}>{formatKelvin(body.temperatureK)}</Fact>
          <Fact label={t.body.radius}>{formatKm(body.radiusKm)}</Fact>
          <Fact label={t.body.mass}>
            <span title={isPlanet ? t.body.massEarthHint : t.body.massSolarHint}>
              {formatMass(isPlanet ? body.visual.massEm : body.visual.stellarMass, body.kind)}
            </span>
          </Fact>
          {isPlanet && (
            <>
              <Fact label={t.body.atmosphere} className="col-span-2 sm:col-span-3">
                {body.atmosphere || t.body.noAtmosphere}
              </Fact>
              <Fact label={t.body.landable}>{body.landable ? t.common.yes : t.common.no}</Fact>
              <Fact label={t.body.terraformable}>{body.terraformable ? t.common.yes : t.common.no}</Fact>
            </>
          )}
        </dl>
      </Section>

      <Section title={t.body.discovery} help="firsts">
        <dl className="divide-y divide-zinc-800/70">
          <Row label={t.body.discoveredLabel}>
            <span className={body.wasDiscovered === false ? 'text-accent' : undefined}>
              {t.body.discoveredBy(body.wasDiscovered)}
            </span>
          </Row>
          {isPlanet && (
            <>
              <Row label={t.body.mappedLabel}>
                <span className={body.mappedByMe && body.wasMapped === false ? 'text-emerald-300' : undefined}>
                  {t.body.mappedBy(body.wasMapped, body.mappedByMe)}
                </span>
              </Row>
              {body.landable && (
                <Row label={t.body.footfallLabel} help="footfall">
                  {!body.footfallByMe && body.footfallTaken ? (
                    <span
                      className="text-zinc-500"
                      title={body.footfallTaken === 'populated' ? t.body.footfallPopulatedHint : t.body.footfallMappedHint}
                    >
                      {body.footfallTaken === 'populated' ? t.body.footfallPopulated : t.body.footfallMapped}
                    </span>
                  ) : (
                    <span className={body.footfallClaimable || body.footfallByMe ? 'text-emerald-300' : undefined}>
                      {t.body.footfallBy(body.wasFootfalled, body.footfallByMe)}
                    </span>
                  )}
                </Row>
              )}
            </>
          )}
        </dl>
      </Section>

      {otherSignals.length > 0 && (
        <Section title={t.body.signals}>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {otherSignals.map((s) => (
              <Fact key={s.label} label={s.label}>
                {s.n}
              </Fact>
            ))}
          </dl>
        </Section>
      )}

      <Section title={t.source.title}>
        <SourceList body={body} />
      </Section>
    </article>
  )
}
