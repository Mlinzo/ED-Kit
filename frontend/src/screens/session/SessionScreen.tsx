import { Clock, Leaf, Map as MapIcon, Route, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useView } from '../../api/hooks'
import { Credits } from '../../components/Credits'
import { Label, ViewFallback } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { ru } from '../../i18n/ru'
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format'

function Card({
  icon: Icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon
  title: string
  value: ReactNode
  detail: ReactNode
  tone: string
}) {
  return (
    <section className="rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
      <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-400">
        <Icon className={`size-4 ${tone}`} aria-hidden />
        {title}
      </h2>
      <div className={`mt-2 text-4xl font-semibold tracking-tight sm:text-5xl ${tone}`}>{value}</div>
      <div className="mt-2 text-sm text-zinc-400">{detail}</div>
    </section>
  )
}

function Metric({
  value,
  label,
  title,
  className = '',
}: {
  value: ReactNode
  label: string
  title?: string
  className?: string
}) {
  // dt before dd in the DOM (valid <dl>), value shown on top.
  return (
    <div className={`flex min-w-0 flex-col-reverse ${className}`} title={title}>
      <dt className="mt-1 text-sm text-zinc-500">{label}</dt>
      <dd className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">{value}</dd>
    </div>
  )
}

export function SessionScreen() {
  const { data, error, refetch } = useView('session')
  const now = useNow()

  if (!data) return <ViewFallback error={error} onRetry={refetch} />

  const atRisk = data.atRiskValue
  const risky = atRisk > 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {data.commander && (
        <p className="text-sm text-zinc-500 md:hidden">
          {ru.common.commander} <span className="font-medium text-zinc-200">{data.commander}</span>
        </p>
      )}

      <section
        aria-labelledby="risk-title"
        className={`rounded-3xl p-6 ring-1 sm:p-8 ${
          risky ? 'bg-amber-500/10 ring-amber-500/30' : 'bg-emerald-500/10 ring-emerald-500/30'
        }`}
      >
        <h1
          id="risk-title"
          className={`flex items-center gap-2 text-sm font-medium tracking-wide uppercase ${
            risky ? 'text-amber-200/80' : 'text-emerald-200/80'
          }`}
        >
          {risky ? <ShieldAlert className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
          {ru.session.atRisk}
        </h1>
        <div
          className={`mt-3 text-7xl leading-none font-semibold tracking-tighter sm:text-8xl ${
            risky ? 'text-amber-300' : 'text-emerald-300'
          }`}
        >
          <Credits value={atRisk} />
        </div>
        <p className="mt-4 text-sm text-zinc-400">{risky ? ru.session.atRiskHint : ru.session.allSold}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          icon={Leaf}
          title={ru.session.bio}
          tone="text-emerald-300"
          value={<Credits value={data.unsoldBioValue} />}
          detail={`${ru.session.bioCount(data.unsoldBioCount)} ${ru.session.unsold}`}
        />
        <Card
          icon={MapIcon}
          title={ru.session.carto}
          tone="text-zinc-50"
          value={<Credits value={data.unsoldCartoValue} />}
          detail={`${ru.session.cartoBodies(data.unsoldCartoBodies)} · ${ru.session.cartoSystems(data.unsoldCartoSystems)}`}
        />
      </div>

      <section aria-labelledby="since-title" className="rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
        <Label as="h2" id="since-title" className="flex items-center gap-2">
          <Route className="size-4" aria-hidden />
          {ru.session.sinceSale}
        </Label>
        <dl className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-3">
          <Metric value={formatNumber(data.jumps)} label={ru.session.jumps(data.jumps)} />
          <Metric
            value={formatNumber(data.distanceLy, data.distanceLy < 100 ? 1 : 0)}
            label={`${ru.units.ly} ${ru.session.distance}`}
          />
          <Metric
            className="col-span-2 sm:col-span-1"
            value={
              <span className="inline-flex items-center gap-2">
                <Clock className="size-6 text-zinc-500" aria-hidden />
                {data.lastSaleAt ? formatRelative(data.lastSaleAt, now) : ru.session.never}
              </span>
            }
            label={data.lastSaleAt ? `${ru.session.lastSale} · ${formatDateTime(data.lastSaleAt)}` : ru.session.lastSale}
            title={data.lastSaleAt ?? undefined}
          />
        </dl>
      </section>
    </div>
  )
}
