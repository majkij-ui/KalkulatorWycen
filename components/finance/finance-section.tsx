'use client'

/**
 * Sekcja „Finanse" — kokpit wyniku firmy.
 *
 *   marża na realizacji (warstwa 1) = przychód − koszty bezpośrednie
 *   wynik po kosztach firmy (warstwa 2) = warstwa 1 − podatek − ZUS − stałe − sprzęt − marketing
 *
 * Liczby warstw: rejestr marży (`margin-ledger.ts`, S4) — przełącznik
 * „Rozłóż duże zakupy sprzętu" i filtr klienta / grupy zmieniają wszystko na
 * ekranie.
 *
 * Dwie zakładki (S1): „Projekty" (kafle, płatności, wykres, plan a
 * rzeczywistość) i „Koszty stałe i subskrypcje". Koszty stałe to WSZĘDZIE
 * ręczne pozycje plus raty subskrypcji liczone przy odczycie
 * (`fixedCostsInYear`, `subscriptions.ts`) — kafle, wykres i wynik też.
 *
 * Od T6 liczby projektów to NAJLEPSZA WIEDZA: faktury zamiast planu, gdy są,
 * koszty z Realizacji zamiast planowanych, gdy je wpisano; faktura liczy się
 * w miesiącu wystawienia (`money-loop.ts`). Plan to nadal ZAMROŻONA migawka z
 * chwili zapisu — dashboard nigdy nie przelicza jej z bieżącego cennika. Cała
 * matematyka siedzi w `finance-calc.ts` i `money-loop.ts` (czyste funkcje z
 * testami); ten plik tylko wybiera okres i rysuje.
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
  periodContaining,
  periodLabel,
  summarizePeriod,
  type Period,
  type PeriodKind,
} from '@/lib/finance-calc'
import { moneyLedger, moneyYears, openInvoices, paymentDays, type OpenInvoice } from '@/lib/money-loop'
import {
  companyTaxRate,
  marginSummary,
  marginTrend,
  projectIdsInScope,
  type MarginInput,
  type MarginSummary,
  type MarginTrendRow,
} from '@/lib/margin-ledger'
import { gearSpreadSettings, type GearSpreadSettings } from '@/lib/gear-costs'
import { getLoadedCompany, patchLoadedCompany } from '@/lib/company-settings-core'
import { useEquipment } from '@/lib/equipment-context'
import { useClientGroups } from '@/lib/use-client-groups'
import { clientScope, groupDirectory } from '@/lib/client-groups'
import { clientDirectory, type ClientInfo } from '@/lib/clients'
import { Switch } from '@/components/ui/switch'
import { ClientCombobox } from '@/components/projects/client-combobox'
import { pln, signedPln } from '@/lib/money-loop-labels'
import { toDateKey, toYear } from '@/lib/project-types'
import { useEvents } from '@/lib/events-context'
import { plural } from '@/lib/pl-plural'
import { fixedCostsInYear, type EffectiveFixedCost } from '@/lib/subscriptions'
import { Button } from '@/components/ui/button'
import { FixedCostsPanel } from './fixed-costs-panel'
import { GearCostsPanel } from './gear-costs-panel'
import { PaymentsPanel, PlanVsActual } from './money-loop-panels'
import { ReportTab } from './report-tab'
import { SubscriptionsPanel, type FinanceNotice } from './subscriptions-panel'
import { useFixedCosts } from './use-fixed-costs'
import { useSubscriptions } from './use-subscriptions'

/** Pierwszy rok kokpitu — wcześniejsze lata pokazujemy tylko, gdy są w nich dane. */
const FIRST_YEAR = 2026

/** Paleta wykresu — zweryfikowana walidatorem (CVD, kontrast) na tle #0b0b0c. */
const COLOR_PROFIT = '#0284c7'
const COLOR_FIXED = '#ea580c'
const COLOR_RESULT = '#f4f4f5'

/** Preferencje widoku (tylko ten komputer): przełącznik sprzętu i filtr klienta. */
const SPREAD_KEY = 'nonoise-finance-spread-gear'
const SCOPE_KEY = 'nonoise-finance-client'

function readPref(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePref(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Preferencja — brak zapisu niczego nie psuje.
  }
}

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

/** Zakładki Finansów; „Raport" (S5) to trzecia. */
const FINANCE_TABS = [
  { value: 'projects', label: 'Projekty' },
  { value: 'fixed', label: 'Koszty stałe i subskrypcje' },
  { value: 'report', label: 'Raport' },
] as const
type FinanceTab = (typeof FINANCE_TABS)[number]['value']

const KIND_LABELS: Record<Exclude<PeriodKind, 'month'>, string> = {
  year: 'Rok',
  half: 'Półrocze',
  quarter: 'Kwartał',
}

function compactPln(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 1000) return `${(amount / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 0 })}k`
  return String(Math.round(amount))
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

/** „plan 159 613 zł · +1 500 zł" — albo „zgodnie z planem", gdy różnicy nie ma. */
function vsPlan(actual: number, plan: number): string {
  const delta = signedPln(actual - plan)
  return delta ? `plan ${pln(plan)} · ${delta}` : 'zgodnie z planem'
}

const pctOf = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : null)

/** „wstępnie" — okres trwa, koszty firmy do jego końca są z planu. */
function Provisional() {
  return (
    <span className="ml-1.5 rounded border border-amber-400/30 px-1 text-[10px] font-medium normal-case tracking-normal text-amber-300/90">
      wstępnie
    </span>
  )
}

function KpiTiles({
  summary,
  scopeName,
  pipeline,
  plannedFixed,
  onOpenFixed,
}: {
  summary: MarginSummary
  /** Nazwa klienta / grupy z filtra; `null` = cała firma. */
  scopeName: string | null
  pipeline: { count: number; value: number }
  /** Raty subskrypcji z miesięcy po bieżącym, wliczone w okres. */
  plannedFixed: number
  onOpenFixed: () => void
}) {
  const { money, company, totals, scoped, perProject, provisional } = summary
  const view = scoped ?? totals
  const result = scoped ? scoped.result : totals.result
  const negative = result !== null && result < 0
  const tone =
    result === null || Math.abs(result) < 0.5
      ? { box: 'border-white/5 bg-zinc-900/40', text: 'text-zinc-100' }
      : negative
        ? { box: 'border-red-500/30 bg-red-500/5', text: 'text-red-300' }
        : { box: 'border-emerald-500/30 bg-emerald-500/5', text: 'text-emerald-300' }
  const { coverage } = money
  const projectCount = view.projects
  const fromPlan = money.revenue - money.invoicedRevenue
  const planMargin = money.plan.revenue - money.plan.costs
  const gearView = summary.spread ? 'sprzęt rozłożony' : 'sprzęt w całości'
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Przychód netto</div>
        <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(view.revenue)}</div>
        <div className="mt-1 text-xs text-zinc-500">
          {projectCount} {plural(projectCount, 'projekt', 'projekty', 'projektów')}
          {scoped
            ? totals.revenue > 0 && ` · ${pctOf(view.revenue, totals.revenue)} przychodu firmy`
            : coverage.partial > 0 && ` · ${coverage.partial} w toku`}
        </div>
        {!scoped && money.revenue > 0 && (
          <div className="mt-0.5 text-xs text-zinc-500">
            {money.invoicedRevenue === 0
              ? 'brak faktur — wszystko z planu'
              : fromPlan < 0.5
                ? `wszystko z faktur`
                : `z faktur ${pln(money.invoicedRevenue)} · z planu ${pln(fromPlan)}`}
          </div>
        )}
        {!scoped && coverage.projects > 0 && (
          <div className="mt-0.5 text-xs text-zinc-500">{vsPlan(money.revenue, money.plan.revenue)}</div>
        )}
        {/* Ta sama reguła co odhaczenie „Zapłacone" na liście projektów, per faktura. */}
        {!scoped && money.revenue > 0 && (
          <div className="mt-0.5 text-xs tabular-nums">
            <span className="text-emerald-400/80">wpłynęło {pln(money.paid.revenue)}</span>
            {money.awaiting.revenue > 0.5 && (
              <span className="text-amber-300/80"> · czeka {pln(money.awaiting.revenue)}</span>
            )}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Marża na realizacji</div>
        <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(view.margin)}</div>
        <div className="mt-1 text-xs text-zinc-500">
          przychód − koszty bezpośrednie {pln(view.costs)} · przed podatkiem
          {view.revenue > 0 && ` · ${pctOf(view.margin, view.revenue)}`}
        </div>
        {!scoped && coverage.projects > 0 && (
          <div className="mt-0.5 text-xs text-zinc-500">
            {vsPlan(totals.margin, planMargin)} ·{' '}
            {coverage.withCosts === 0
              ? 'brak kosztów z Realizacji'
              : `koszty z Realizacji ${coverage.withCosts} z ${coverage.projects}`}
          </div>
        )}
      </div>
      {/* R2 (D2): suma marż producenckich projektów — po podatku i po wartości mojej pracy. */}
      <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Marża producencka</div>
        <div className={`mt-1 tabular-nums text-xl font-bold ${view.producerMargin < -0.5 ? 'text-red-300' : 'text-zinc-100'}`}>
          {pln(view.producerMargin)}
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          marża − podatek {pln(view.tax)} − Twoja praca {pln(view.ownWork)}
          {view.revenue > 0 && ` · ${pctOf(view.producerMargin, view.revenue)}`}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {view.ownWork > 0.5 ? 'gdybyś tylko produkował, a na plan wysłał kogoś innego' : 'nic nie oznaczono jako „Moja praca"'}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenFixed}
        className="group rounded-xl border border-white/5 bg-zinc-900/40 p-4 text-left transition-colors hover:border-white/15"
        aria-label="Koszty firmy — koszty stałe i subskrypcje"
      >
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-zinc-500">
          <span>
            Koszty firmy
            {provisional && <Provisional />}
          </span>
          <ArrowRight className="size-3.5 text-zinc-700 transition-colors group-hover:text-zinc-300" />
        </div>
        <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(company.total)}</div>
        <div className="mt-1 text-xs text-zinc-500">
          podatek {pln(company.tax)} · ZUS {pln(company.zus)}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          stałe i subskrypcje {pln(company.fixed)} · marketing {pln(company.marketing)}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {gearView} {pln(company.gear)}
        </div>
        {plannedFixed > 0.5 && (
          <div className="mt-0.5 text-xs text-zinc-500">w tym plan subskrypcji na kolejne miesiące {pln(plannedFixed)}</div>
        )}
        {scoped && perProject && scoped.overhead !== null && (
          <div className="mt-0.5 text-xs text-sky-300/80">
            na {scopeName}: {pln(scoped.overhead + scoped.tax)} (udział w przychodzie roku)
          </div>
        )}
      </button>
      <div className={`col-span-2 rounded-xl border p-4 lg:col-span-1 ${tone.box}`}>
        <div className="text-[11px] uppercase tracking-wide text-zinc-400">
          Wynik po kosztach firmy
          {provisional && <Provisional />}
        </div>
        {result === null ? (
          <>
            <div className="mt-1 text-xl font-bold text-zinc-500">—</div>
            <div className="mt-1 text-xs text-zinc-400">
              dla klienta tylko w widoku roku · cała firma {pln(totals.result ?? 0)}
            </div>
          </>
        ) : (
          <>
            <div className={`mt-1 tabular-nums text-xl font-bold ${tone.text}`}>{pln(result)}</div>
            <div className="mt-1 text-xs text-zinc-400">
              {view.revenue > 0 ? `${pctOf(result, view.revenue)} przychodu` : 'brak przychodu'} · {gearView}
              {!scoped && pipeline.count > 0 && ` · w wycenach ${pln(pipeline.value)}`}
            </div>
            {!scoped && summary.unallocated > 0.5 && perProject && (
              <div className="mt-0.5 text-xs text-zinc-500">brak projektów, na które dałoby się rozłożyć koszty</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Pasek: filtr klienta, sprzęt ─────────────────────────────────────────────

function ThresholdEditor({
  settings,
  onSave,
}: {
  settings: GearSpreadSettings
  onSave: (thresholdPln: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(String(settings.thresholdPln))
          setEditing(true)
        }}
        className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-200"
        title="Zmień próg rozkładania"
      >
        od {pln(settings.thresholdPln)} na {settings.months} mies.
      </button>
    )
  }
  const commit = () => {
    const value = Number(text.replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(value) && value >= 0) onSave(value)
    setEditing(false)
  }
  return (
    <span className="flex items-center gap-1 text-xs text-zinc-500">
      od
      <input
        autoFocus
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        aria-label="Próg rozkładania zakupów sprzętu (zł netto)"
        className="h-7 w-20 rounded-md border border-white/15 bg-black/40 px-2 text-right tabular-nums text-zinc-100 outline-none focus:border-white/40"
      />
      zł netto
    </span>
  )
}

/** Przełącznik „Rozłóż duże zakupy sprzętu" z progiem — w Projektach i w Raporcie. */
function GearToggle({
  id,
  spread,
  onSpread,
  settings,
  onThreshold,
}: {
  id: string
  spread: boolean
  onSpread: (next: boolean) => void
  settings: GearSpreadSettings
  onThreshold: (value: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Switch id={id} checked={spread} onCheckedChange={onSpread} />
      <label htmlFor={id} className="cursor-pointer text-sm text-zinc-300">
        Rozłóż duże zakupy sprzętu
      </label>
      {spread && <ThresholdEditor settings={settings} onSave={onThreshold} />}
    </div>
  )
}

function FinanceToolbar({
  directory,
  scopeName,
  memberNames,
  onScope,
  spread,
  onSpread,
  settings,
  onThreshold,
}: {
  directory: ClientInfo[]
  scopeName: string
  memberNames: string[]
  onScope: (value: string) => void
  spread: boolean
  onSpread: (next: boolean) => void
  settings: GearSpreadSettings
  onThreshold: (value: number) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ClientCombobox
          value={scopeName}
          directory={directory}
          onCommit={(_, picked) => onScope(picked?.key ?? '')}
          placeholder="Wszyscy klienci"
          ariaLabel="Filtr klienta w Finansach"
          className="w-56 max-w-full"
        />
        {memberNames.length > 0 && <span className="text-xs text-zinc-500">grupa: {memberNames.join(', ')}</span>}
      </div>
      <GearToggle id="finance-spread-gear" spread={spread} onSpread={onSpread} settings={settings} onThreshold={onThreshold} />
    </div>
  )
}

// ── Wykres trendu ────────────────────────────────────────────────────────────

interface TrendRow {
  month: string
  inPeriod: boolean
  margin: number
  companyCosts: number
  result: number
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendRow }[] }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold text-zinc-100">{row.month}</div>
      {[
        { label: 'Marża na realizacji', value: row.margin, color: COLOR_PROFIT },
        { label: 'Koszty firmy', value: row.companyCosts, color: COLOR_FIXED },
        { label: 'Wynik po kosztach firmy', value: row.result, color: COLOR_RESULT },
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

function TrendChart({ trend, period, scoped }: { trend: MarginTrendRow[]; period: Period; scoped: boolean }) {
  const rows: TrendRow[] = trend.map((s, i) => ({
    month: MONTH_SHORT[i],
    inPeriod: isInPeriod(`${period.year}-${String(i + 1).padStart(2, '0')}`, period),
    margin: s.margin,
    companyCosts: s.companyCosts,
    result: s.result,
  }))
  const empty = trend.every((s) => s.margin === 0 && s.companyCosts === 0)

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          Miesiące {period.year}
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COLOR_PROFIT }} />
            Marża na realizacji{scoped && ' (filtr)'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COLOR_FIXED }} />
            Koszty firmy
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: COLOR_RESULT }} />
            Wynik po kosztach firmy{scoped && ' (cała firma)'}
          </span>
        </div>
      </div>

      {empty ? (
        <div className="flex h-48 items-center justify-center text-sm text-zinc-600">
          Brak danych w {period.year} — zapisz projekt jako „W realizacji" albo dodaj koszty stałe lub subskrypcje.
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
              <Bar dataKey="margin" radius={[4, 4, 0, 0]} maxBarSize={18}>
                {rows.map((r) => (
                  <Cell key={r.month} fill={COLOR_PROFIT} fillOpacity={r.inPeriod ? 1 : 0.3} />
                ))}
              </Bar>
              <Bar dataKey="companyCosts" radius={[4, 4, 0, 0]} maxBarSize={18}>
                {rows.map((r) => (
                  <Cell key={r.month} fill={COLOR_FIXED} fillOpacity={r.inPeriod ? 1 : 0.3} />
                ))}
              </Bar>
              <Line
                type="linear"
                dataKey="result"
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

// ── Sekcja ───────────────────────────────────────────────────────────────────

function FinanceTabs({ tab, onChange }: { tab: FinanceTab; onChange: (next: FinanceTab) => void }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-white/5" role="tablist" aria-label="Zakładki finansów">
      {FINANCE_TABS.map(({ value, label }) => {
        const active = value === tab
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** „Usunięto … Cofnij" — wspólny dla subskrypcji i kosztów. */
function NoticeBar({ notice, onDone }: { notice: FinanceNotice; onDone: () => void }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
      role="status"
    >
      <span className="min-w-0 flex-1">{notice.message}</span>
      {notice.undo && (
        <button
          type="button"
          onClick={async () => {
            const undo = notice.undo
            onDone()
            await undo?.()
          }}
          className="font-semibold text-primary outline-none hover:underline focus-visible:underline"
        >
          Cofnij
        </button>
      )}
      <button type="button" onClick={onDone} className="text-zinc-500 hover:text-zinc-200" aria-label="Zamknij komunikat">
        ×
      </button>
    </div>
  )
}

export function FinanceSection({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { projects, isLoading } = useProjectHub()
  const fixed = useFixedCosts()
  const subs = useSubscriptions()
  const { events } = useEvents()
  const [tab, setTab] = useState<FinanceTab>('projects')
  const [notice, setNotice] = useState<FinanceNotice | null>(null)
  const [period, setPeriod] = useState<Period>(() => periodContaining(new Date(), 'year'))
  const { allItems: equipment } = useEquipment()
  const { groups } = useClientGroups()
  const [spread, setSpread] = useState<boolean>(() => readPref(SPREAD_KEY) !== 'off')
  const [scopeValue, setScopeValue] = useState<string>(() => readPref(SCOPE_KEY) ?? '')
  const [settings, setSettings] = useState<GearSpreadSettings>(() => gearSpreadSettings(getLoadedCompany()))
  const today = toDateKey(new Date())
  const currentMonth = today.slice(0, 7)
  const taxRate = companyTaxRate(getLoadedCompany())

  // Pieniądze projektów liczone raz; okresy i wykres tylko je dzielą.
  const ledger = useMemo(() => moneyLedger(projects, events, today, taxRate), [projects, events, today, taxRate])
  // Koszty stałe roku: ręczne + raty subskrypcji (bez podwójnego liczenia).
  const yearCosts: EffectiveFixedCost[] = useMemo(
    () => fixedCostsInYear(fixed.costs, subs.subscriptions, period.year),
    [fixed.costs, subs.subscriptions, period.year]
  )

  const years = useMemo(() => {
    const set = new Set<number>([FIRST_YEAR, new Date().getFullYear(), period.year, ...moneyYears(ledger)])
    projects.forEach((p) => {
      const y = toYear(p.date)
      if (y !== null) set.add(y)
    })
    fixed.costs.forEach((c) => {
      const y = toYear(c.month)
      if (y !== null) set.add(y)
    })
    subs.subscriptions.forEach((s) => {
      const y = toYear(s.startDate)
      if (y !== null) set.add(y)
    })
    const min = Math.min(...set)
    const max = Math.max(...set)
    return Array.from({ length: max - min + 1 }, (_, i) => max - i)
  }, [projects, fixed.costs, subs.subscriptions, period.year, ledger])

  // Filtr klienta / grupy (S2): ta sama lista co w Projektach.
  const clients = useMemo(() => clientDirectory(projects), [projects])
  const directory = useMemo(() => [...clients, ...groupDirectory(groups, clients)], [clients, groups])
  const selectedClient = directory.find((c) => c.key === scopeValue) ?? null
  const scope = clientScope(selectedClient?.key, groups)
  const scopeIds = useMemo(
    () => projectIdsInScope(projects, scope ? new Set(scope.keys) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, scope?.value, scope?.keys.join('|')]
  )
  const memberNames =
    scope?.kind === 'group' ? scope.keys.map((key) => clients.find((c) => c.key === key)?.name ?? key) : []

  // Rejestr marży (S4): warstwa 1, koszty firmy, warstwa 2 — jedno źródło liczb ekranu.
  const marginInput: MarginInput = useMemo(
    () => ({ ledger, fixedCosts: yearCosts, equipment, spread, settings, today, scope: scopeIds }),
    [ledger, yearCosts, equipment, spread, settings, today, scopeIds]
  )
  const margin = useMemo(() => marginSummary(marginInput, period), [marginInput, period])
  const trend = useMemo(() => marginTrend(marginInput, period.year), [marginInput, period.year])

  const changeSpread = (next: boolean) => {
    setSpread(next)
    writePref(SPREAD_KEY, next ? 'on' : 'off')
  }
  const changeScope = (value: string) => {
    setScopeValue(value)
    writePref(SCOPE_KEY, value)
  }
  const changeThreshold = (thresholdPln: number) => {
    patchLoadedCompany({ gearSpreadThresholdPln: thresholdPln })
    setSettings((prev) => ({ ...prev, thresholdPln }))
  }
  const plannedFixed = useMemo(
    () =>
      yearCosts
        .filter((c) => c.derived && c.month > currentMonth && isInPeriod(c.month, period))
        .reduce((sum, c) => sum + c.amount, 0),
    [yearCosts, currentMonth, period]
  )
  // Wyceny nie mają faktur — w okresie leżą po dacie księgowej, jak dotąd.
  const pipelineSummary = useMemo(() => summarizePeriod(projects, [], period), [projects, period])
  const pipeline = useMemo(
    () =>
      projects.filter(
        (p) => p.status === 'quote' && isInPeriod(p.date, period) && (!scopeIds || scopeIds.has(p.id))
      ),
    [projects, period, scopeIds]
  )
  const open = useMemo(() => openInvoices(ledger, today), [ledger, today])
  const openByProject = useMemo(() => {
    const map = new Map<string, OpenInvoice[]>()
    open.forEach((invoice) => map.set(invoice.projectId, [...(map.get(invoice.projectId) ?? []), invoice]))
    return map
  }, [open])
  const days = useMemo(() => paymentDays(ledger, period), [ledger, period])
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const switchTab = (next: FinanceTab) => {
    setTab(next)
    setNotice(null)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Finanse</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {tab === 'projects' ? (
              <>
                Marża na realizacji = przychód − koszty bezpośrednie, przed podatkiem. Wynik po kosztach firmy = marża −
                podatek, ZUS, subskrypcje i koszty stałe, sprzęt, marketing. Przychód z faktur (w miesiącu wystawienia), a
                gdzie ich brak — z planu; koszty z Realizacji, a gdzie ich brak — z planu. Wyceny nie wchodzą do wyniku.
              </>
            ) : tab === 'fixed' ? (
              <>
                Subskrypcje liczą się same w każdym miesiącu cyklu; miesiąc, który był inny, poprawiasz na liście
                miesięcy. Wszystko tutaj wchodzi do wyniku firmy w zakładce Projekty.
              </>
            ) : (
              <>
                Raport za wybrany okres: przychód i obie warstwy marży (per projekt i klient), płatności, koszty firmy,
                marketing, sprzęt i ekipa — obok poprzedniego okresu. PDF i plik Markdown z JSON-em mają te same liczby co ekran.
              </>
            )}
          </p>
        </div>
        <PeriodPicker period={period} years={years} onChange={setPeriod} />
      </header>

      <FinanceTabs tab={tab} onChange={switchTab} />

      {isLoading || fixed.isLoading || subs.isLoading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : tab === 'projects' ? (
        <>
          <BackfillBanner />
          <FinanceToolbar
            directory={directory}
            scopeName={selectedClient?.name ?? ''}
            memberNames={memberNames}
            onScope={changeScope}
            spread={spread}
            onSpread={changeSpread}
            settings={settings}
            onThreshold={changeThreshold}
          />
          <KpiTiles
            summary={margin}
            scopeName={selectedClient?.name ?? null}
            pipeline={{ count: pipelineSummary.quoteCount, value: pipelineSummary.pipelineValue }}
            plannedFixed={plannedFixed}
            onOpenFixed={() => switchTab('fixed')}
          />
          <PaymentsPanel
            open={open}
            stats={days}
            periodLabel={periodLabel(period)}
            projectsById={projectsById}
            onOpenProject={onOpenProject}
          />
          <TrendChart trend={trend} period={period} scoped={!!scopeIds} />
          <PlanVsActual
            summary={margin}
            projectsById={projectsById}
            openByProject={openByProject}
            pipeline={pipeline}
            onOpenProject={onOpenProject}
          />
          <GearCostsPanel gear={margin.gear} periodLabel={periodLabel(period)} />
        </>
      ) : tab === 'report' ? (
        <ReportTab
          period={period}
          projects={projects}
          events={events}
          fixedCosts={fixed.costs}
          subscriptions={subs.subscriptions}
          equipment={equipment}
          groups={groups}
          spread={spread}
          settings={settings}
          taxRatePercent={taxRate}
          today={today}
          gearToggle={
            <GearToggle id="report-spread-gear" spread={spread} onSpread={changeSpread} settings={settings} onThreshold={changeThreshold} />
          }
        />
      ) : (
        <>
          {notice && <NoticeBar notice={notice} onDone={() => setNotice(null)} />}
          <SubscriptionsPanel
            subs={subs}
            fixed={fixed}
            yearCosts={yearCosts}
            year={period.year}
            ledger={ledger}
            today={today}
            onNotice={setNotice}
          />
          <FixedCostsPanel
            period={period}
            today={today}
            yearCosts={yearCosts}
            subscriptions={subs.subscriptions}
            fixed={fixed}
            onNotice={setNotice}
          />
        </>
      )}
    </div>
  )
}
