'use client'

/**
 * Sekcja „Finanse" — kokpit wyniku firmy.
 *
 *   wynik firmy = zysk projektów (won/done) − koszty stałe okresu
 *
 * Cała matematyka siedzi w `finance-calc.ts` (czyste funkcje z testami); ten
 * plik tylko wybiera okres i rysuje. Liczby projektów to ZAMROŻONE migawki z
 * chwili zapisu — dashboard nigdy nie przelicza ich z bieżącego cennika.
 */

import { useMemo, useState } from 'react'
import { ArrowRight, Loader2, Sparkles } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useProjectHub } from '@/lib/project-hub-context'
import {
  isInPeriod,
  monthlyTrend,
  periodContaining,
  summarizePeriod,
  type Period,
  type PeriodKind,
  type PeriodSummary,
} from '@/lib/finance-calc'
import { countsTowardRevenue, toDateKey, toYear, type Project } from '@/lib/project-types'
import { useEvents } from '@/lib/events-context'
import { paymentSplit, paymentState, type PaymentEvent, type PaymentSplit } from '@/lib/payments'
import { plural } from '@/lib/pl-plural'
import { ProjectStatusBadge } from '@/components/projects/project-status-badge'
import { Button } from '@/components/ui/button'
import { FixedCostsPanel } from './fixed-costs-panel'
import { useFixedCosts } from './use-fixed-costs'

/** Pierwszy rok kokpitu — wcześniejsze lata pokazujemy tylko, gdy są w nich dane. */
const FIRST_YEAR = 2026

/** Paleta wykresu — zweryfikowana walidatorem (CVD, kontrast) na tle #0b0b0c. */
const COLOR_PROFIT = '#0284c7'
const COLOR_FIXED = '#ea580c'
const COLOR_RESULT = '#f4f4f5'

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

const KIND_LABELS: Record<Exclude<PeriodKind, 'month'>, string> = {
  year: 'Rok',
  half: 'Półrocze',
  quarter: 'Kwartał',
}

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

function compactPln(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 1000) return `${(amount / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 0 })}k`
  return String(Math.round(amount))
}

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

// ── Wybór okresu ─────────────────────────────────────────────────────────────

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-white/10 bg-black/30 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function PeriodPicker({
  period,
  years,
  onChange,
}: {
  period: Period
  years: number[]
  onChange: (next: Period) => void
}) {
  const kind = period.kind === 'month' ? 'year' : period.kind
  const indexOptions =
    kind === 'half'
      ? [1, 2].map((i) => ({ value: i, label: `H${i}` }))
      : kind === 'quarter'
        ? [1, 2, 3, 4].map((i) => ({ value: i, label: `Q${i}` }))
        : []

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Rodzaj okresu"
        value={kind}
        options={(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) => ({
          value: k,
          label: KIND_LABELS[k],
        }))}
        onChange={(nextKind) => {
          // Zmiana typu okresu zostaje w tym samym roku, na okresie z „dziś"
          // (gdy to bieżący rok) albo na pierwszym okresie roku.
          const today = new Date()
          const base = periodContaining(today, nextKind)
          onChange(base.year === period.year ? base : { kind: nextKind, year: period.year, index: nextKind === 'year' ? undefined : 1 })
        }}
      />
      <select
        value={period.year}
        onChange={(e) => onChange({ ...period, year: Number(e.target.value) })}
        aria-label="Rok"
        className="h-8 rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-medium text-zinc-200"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      {indexOptions.length > 0 && (
        <Segmented
          label={kind === 'half' ? 'Półrocze' : 'Kwartał'}
          value={period.index ?? 1}
          options={indexOptions}
          onChange={(index) => onChange({ ...period, index })}
        />
      )}
    </div>
  )
}

// ── Baner uzupełniania finansów ──────────────────────────────────────────────

function BackfillBanner() {
  const { missingFinancialsCount, backfillFinancials } = useProjectHub()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (missingFinancialsCount === 0 && !message) return null

  const run = async () => {
    setBusy(true)
    const { filledCount, skippedCount } = await backfillFinancials()
    setBusy(false)
    setMessage(
      skippedCount > 0
        ? `Policzono finanse ${filledCount} ${plural(filledCount, 'projektu', 'projektów', 'projektów')}. ${skippedCount} ${plural(skippedCount, 'projekt nie ma', 'projekty nie mają', 'projektów nie ma')} danych wyceny — otwórz i zapisz je ręcznie.`
        : `Policzono finanse ${filledCount} ${plural(filledCount, 'projektu', 'projektów', 'projektów')}.`
    )
  }

  return (
    <div className="mb-6 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
      {message ? (
        <p className="text-sm text-sky-200/90">{message}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-sky-200">
              {missingFinancialsCount}{' '}
              {plural(missingFinancialsCount, 'projekt nie ma', 'projekty nie mają', 'projektów nie ma')}{' '}
              policzonych finansów
            </p>
            <p className="mt-0.5 text-xs text-sky-200/70">
              Zwykle to przeniesione wyceny. Policzymy je z ich własnego, zapisanego cennika —
              tak jak plan w zakładce Realizacja. Już policzone projekty zostają nietknięte.
            </p>
          </div>
          <Button onClick={run} disabled={busy} className="shrink-0 gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Policz brakujące
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Kafle KPI ────────────────────────────────────────────────────────────────

function KpiTiles({ summary, split }: { summary: PeriodSummary; split: PaymentSplit }) {
  const negative = summary.netResult < 0
  const tone =
    summary.netResult === 0
      ? { box: 'border-white/5 bg-zinc-900/40', text: 'text-zinc-100' }
      : negative
        ? { box: 'border-red-500/30 bg-red-500/5', text: 'text-red-300' }
        : { box: 'border-emerald-500/30 bg-emerald-500/5', text: 'text-emerald-300' }
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Przychód netto</div>
        <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(summary.revenue)}</div>
        <div className="mt-1 text-xs text-zinc-500">
          {summary.projectCount} {plural(summary.projectCount, 'projekt', 'projekty', 'projektów')}
        </div>
        {/* Odhaczenie „Zapłacone" na liście projektów — ta sama reguła. */}
        {summary.projectCount > 0 && (
          <div className="mt-0.5 text-xs tabular-nums">
            <span className="text-emerald-400/80">wpłynęło {pln(split.paid.revenue)}</span>
            {split.awaiting.count > 0 && (
              <span className="text-amber-300/80"> · czeka {pln(split.awaiting.revenue)}</span>
            )}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Zysk z projektów</div>
        <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(summary.projectProfit)}</div>
        <div className="mt-1 text-xs text-zinc-500">
          po kosztach {pln(summary.productionCosts)} i podatku {pln(summary.tax)}
        </div>
      </div>
      <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Koszty stałe</div>
        <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(summary.fixedCosts.total)}</div>
        <div className="mt-1 text-xs text-zinc-500">
          ZUS {pln(summary.fixedCosts.zus)} · mark. {pln(summary.fixedCosts.marketing)} · inne{' '}
          {pln(summary.fixedCosts.other)}
        </div>
      </div>
      <div className={`rounded-xl border p-4 ${tone.box}`}>
        <div className="text-[11px] uppercase tracking-wide text-zinc-400">Wynik firmy</div>
        <div className={`mt-1 tabular-nums text-xl font-bold ${tone.text}`}>
          {pln(summary.netResult)}
        </div>
        <div className="mt-1 text-xs text-zinc-400">
          {summary.revenue > 0 ? `marża ${Math.round(summary.marginPct)}%` : 'brak przychodu'}
          {summary.quoteCount > 0 && ` · w wycenach ${pln(summary.pipelineValue)}`}
        </div>
      </div>
    </div>
  )
}

// ── Wykres trendu ────────────────────────────────────────────────────────────

interface TrendRow {
  month: string
  inPeriod: boolean
  projectProfit: number
  fixedCosts: number
  netResult: number
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendRow }[] }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold text-zinc-100">{row.month}</div>
      {[
        { label: 'Zysk z projektów', value: row.projectProfit, color: COLOR_PROFIT },
        { label: 'Koszty stałe', value: row.fixedCosts, color: COLOR_FIXED },
        { label: 'Wynik', value: row.netResult, color: COLOR_RESULT },
      ].map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="size-2 rounded-sm" style={{ background: item.color }} />
            {item.label}
          </span>
          <span className="tabular-nums text-zinc-100">{pln(item.value)}</span>
        </div>
      ))}
    </div>
  )
}

function TrendChart({ trend, period }: { trend: PeriodSummary[]; period: Period }) {
  const rows: TrendRow[] = trend.map((s, i) => ({
    month: MONTH_SHORT[i],
    inPeriod: isInPeriod(`${period.year}-${String(i + 1).padStart(2, '0')}`, period),
    projectProfit: s.projectProfit,
    fixedCosts: s.fixedCosts.total,
    netResult: s.netResult,
  }))
  const empty = rows.every((r) => r.projectProfit === 0 && r.fixedCosts === 0)

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          Miesiące {period.year}
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COLOR_PROFIT }} />
            Zysk z projektów
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COLOR_FIXED }} />
            Koszty stałe
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR_RESULT }} />
            Wynik firmy
          </span>
        </div>
      </div>

      {empty ? (
        <div className="flex h-48 items-center justify-center text-sm text-zinc-600">
          Brak danych w {period.year} — zapisz projekt jako „W realizacji" albo dodaj koszty stałe.
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#71717a', fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickFormatter={compactPln}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="projectProfit" radius={[4, 4, 0, 0]} maxBarSize={18}>
                {rows.map((r) => (
                  <Cell key={r.month} fill={COLOR_PROFIT} fillOpacity={r.inPeriod ? 1 : 0.3} />
                ))}
              </Bar>
              <Bar dataKey="fixedCosts" radius={[4, 4, 0, 0]} maxBarSize={18}>
                {rows.map((r) => (
                  <Cell key={r.month} fill={COLOR_FIXED} fillOpacity={r.inPeriod ? 1 : 0.3} />
                ))}
              </Bar>
              <Line
                type="linear"
                dataKey="netResult"
                stroke={COLOR_RESULT}
                strokeWidth={2}
                dot={{ r: 3, fill: COLOR_RESULT, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

// ── Projekty okresu ──────────────────────────────────────────────────────────

function ProjectRow({
  project,
  onOpen,
  paid,
}: {
  project: Project
  onOpen: (id: string) => void
  /** Tylko dla projektów, które się liczą; `undefined` = nie dotyczy (wycena). */
  paid?: boolean
}) {
  // Jak na liście projektów: pełny kolor i pogrubienie tylko dla kwot, które
  // się liczą do wyniku. Otwarta wycena jest szara.
  const counts = countsTowardRevenue(project.status)
  return (
    <button
      type="button"
      onClick={() => onOpen(project.id)}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5"
    >
      <span className="w-20 shrink-0 tabular-nums text-xs text-zinc-500">{formatDate(project.date)}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{project.name || 'Bez nazwy'}</span>
      <ProjectStatusBadge status={project.status} />
      <span className="w-20 shrink-0 text-right text-[11px]">
        {paid === true && <span className="text-emerald-400/80">zapłacone</span>}
        {paid === false && <span className="text-amber-300/80">czeka</span>}
      </span>
      {project.financials ? (
        <span className="w-44 shrink-0 text-right tabular-nums text-xs">
          <span className={counts ? 'text-zinc-300' : 'text-zinc-500'}>{pln(project.financials.sumaNetto)}</span>
          <span className="text-zinc-600"> · zysk </span>
          <span
            className={
              !counts ? 'text-zinc-500' : project.financials.zysk < 0 ? 'font-semibold text-red-300' : 'font-semibold text-zinc-100'
            }
          >
            {pln(project.financials.zysk)}
          </span>
        </span>
      ) : (
        <span className="w-44 shrink-0 text-right text-xs text-amber-400/80">nie policzono</span>
      )}
      <ArrowRight className="size-3.5 shrink-0 text-zinc-700 transition-colors group-hover:text-zinc-300" />
    </button>
  )
}

function PeriodProjects({
  projects,
  events,
  onOpenProject,
}: {
  projects: Project[]
  events: PaymentEvent[]
  onOpenProject: (id: string) => void
}) {
  const today = toDateKey(new Date())
  const realized = projects.filter((p) => countsTowardRevenue(p.status))
  const pipeline = projects.filter((p) => p.status === 'quote')

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Projekty w okresie</h2>
      {realized.length === 0 ? (
        <p className="px-3 py-2 text-sm text-zinc-600">
          Żaden projekt nie jest „W realizacji" ani „Zrealizowany" w tym okresie.
        </p>
      ) : (
        <div className="flex flex-col">
          {realized.map((p) => (
            <ProjectRow key={p.id} project={p} onOpen={onOpenProject} paid={paymentState(events, p.id, today).paid} />
          ))}
        </div>
      )}

      {pipeline.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
            Wyceny (niewliczone)
          </h3>
          <div className="flex flex-col">
            {pipeline.map((p) => (
              <ProjectRow key={p.id} project={p} onOpen={onOpenProject} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// ── Sekcja ───────────────────────────────────────────────────────────────────

export function FinanceSection({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { projects, isLoading } = useProjectHub()
  const fixed = useFixedCosts()
  const [period, setPeriod] = useState<Period>(() => periodContaining(new Date(), 'year'))

  const years = useMemo(() => {
    const set = new Set<number>([FIRST_YEAR, new Date().getFullYear(), period.year])
    projects.forEach((p) => {
      const y = toYear(p.date)
      if (y !== null) set.add(y)
    })
    fixed.costs.forEach((c) => {
      const y = toYear(c.month)
      if (y !== null) set.add(y)
    })
    const min = Math.min(...set)
    const max = Math.max(...set)
    return Array.from({ length: max - min + 1 }, (_, i) => max - i)
  }, [projects, fixed.costs, period.year])

  const summary = useMemo(
    () => summarizePeriod(projects, fixed.costs, period),
    [projects, fixed.costs, period]
  )
  const trend = useMemo(
    () => monthlyTrend(projects, fixed.costs, period.year),
    [projects, fixed.costs, period.year]
  )
  const { events } = useEvents()
  const split = useMemo(
    () => paymentSplit(projects.filter((p) => isInPeriod(p.date, period)), events, toDateKey(new Date())),
    [projects, events, period]
  )
  const periodProjects = useMemo(
    () => projects.filter((p) => isInPeriod(p.date, period)),
    [projects, period]
  )

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Finanse</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Zysk projektów „W realizacji" i „Zrealizowanych" minus koszty stałe. Wyceny nie
            wchodzą do wyniku.
          </p>
        </div>
        <PeriodPicker period={period} years={years} onChange={setPeriod} />
      </header>

      <BackfillBanner />

      {isLoading || fixed.isLoading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          <KpiTiles summary={summary} split={split} />
          <TrendChart trend={trend} period={period} />
          <PeriodProjects projects={periodProjects} events={events} onOpenProject={onOpenProject} />
          <FixedCostsPanel period={period} {...fixed} />
        </>
      )}
    </div>
  )
}
