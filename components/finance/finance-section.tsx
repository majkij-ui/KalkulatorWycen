'use client'

/**
 * Sekcja „Finanse" — kokpit wyniku firmy.
 *
 *   marża na realizacji (warstwa 1) = przychód − koszty bezpośrednie
 *   zysk po wszystkich kosztach (warstwa 2) = warstwa 1 − podatek − ZUS − stałe − sprzęt − marketing
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
import { gearSpreadSettings, gearViewLabel, type GearSpreadSettings } from '@/lib/gear-costs'
import { getLoadedCompany, patchLoadedCompany } from '@/lib/company-settings-core'
import { useEquipment } from '@/lib/equipment-context'
import { useClientGroups } from '@/lib/use-client-groups'
import { clientScope, groupDirectory } from '@/lib/client-groups'
import { clientDirectory, type ClientInfo } from '@/lib/clients'
import { Switch } from '@/components/ui/switch'
import { ClientCombobox } from '@/components/projects/client-combobox'
import { pln } from '@/lib/money-loop-labels'
import { toDateKey, toYear } from '@/lib/project-types'
import { useEvents } from '@/lib/events-context'
import { plural } from '@/lib/pl-plural'
import {
  activityLabel,
  inProgressInPeriod,
  overdueAwaiting,
  periodActivity,
  periodElapsedMonths,
  periodPayments,
  type PeriodActivity,
} from '@/lib/finance-summary'
import { fixedCostsInYear, type EffectiveFixedCost } from '@/lib/subscriptions'
import { Button } from '@/components/ui/button'
import { FixedCostsPanel } from './fixed-costs-panel'
import { ExtraSalesPanel } from './extra-sales-panel'
import { GearCostsPanel } from './gear-costs-panel'
import { RentalsPanel } from './rentals-panel'
import { PaymentsPanel, PlanVsActual } from './money-loop-panels'
import { InfoTip } from './info-tip'
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

/** Preferencje widoku (tylko ten komputer): przełącznik sprzętu, „Zakończone projekty" i filtr klienta. */
const SPREAD_KEY = 'nonoise-finance-spread-gear'
const DONE_ONLY_KEY = 'nonoise-finance-done-only'
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

const pctOf = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : null)

/** „59,1%" — procent od przychodu z jednym miejscem po przecinku; „—" bez przychodu. */
const pct1 = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—'

/** „wstępnie" — okres jeszcze trwa; jedna odznaka przy wyborze okresu, nie na kaflach. */
function Provisional() {
  return (
    <span
      className="rounded border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90"
      title="Okres jeszcze trwa — projekty w realizacji z planu, koszty firmy do bieżącego miesiąca"
    >
      wstępnie
    </span>
  )
}

const TIP_PERIOD_COSTS = 'W trwającym okresie koszty firmy liczone do bieżącego miesiąca.'

/** Podpowiedzi (i) przy kaflach, które nie zależą od widoku ani filtra. */
const TILE_HELP = {
  revenue:
    'Wartość netto projektów z tego okresu: kwota z faktury, a bez niej zatwierdzona cena. Dni zdjęciowe: z kalendarza, a bez wpisów z wyceny.',
  ebbt: 'Przychód netto − koszty bezpośrednie − podatek − ZUS: to, czego nie da się pominąć. Taki sam w obu widokach sprzętu.',
  margin: 'Przychód − koszty bezpośrednie. Po podatku: minus podatek. Twoja praca nie jest kosztem. Procent liczony od przychodu.',
  inProgress:
    'Projekty w toku i wyceny z tego okresu. Projekty w toku są wliczone w przychód, chyba że włączysz „Zakończone projekty". Wyceny nie są wliczone nigdzie.',
  awaiting: 'Przychód tego okresu, który jeszcze nie wpłynął.',
} as const

/** Dwie duże liczby obok siebie: marża przed i po podatku (procent od przychodu, pod spodem kwota). */
function MarginPair({ before, after, revenue, redWhenNegative }: { before: number; after: number; revenue: number; redWhenNegative?: boolean }) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-2">
      {[
        { label: 'przed podatkiem', value: before },
        { label: 'po podatku', value: after },
      ].map((column) => (
        <div key={column.label} className="min-w-0">
          <div
            className={`tabular-nums text-lg font-bold sm:text-xl ${redWhenNegative && column.value < -0.5 ? 'text-red-300' : 'text-zinc-100'}`}
          >
            {pct1(column.value, revenue)}
          </div>
          <div className="text-[11px] text-zinc-500">{column.label}</div>
          <div className="tabular-nums text-xs text-zinc-400">{pln(column.value)}</div>
        </div>
      ))}
    </div>
  )
}

function KpiTiles({
  summary,
  scopeName,
  pipeline,
  inProgress,
  gearMonths,
  activity,
  open,
  today,
  onOpenFixed,
}: {
  summary: MarginSummary
  /** Nazwa klienta / grupy z filtra; `null` = cała firma. */
  scopeName: string | null
  /** Wyceny okresu (niewliczone nigdzie). */
  pipeline: { count: number; value: number }
  /** „W realizacji": projekty `won` okresu i filtra — zawsze z pełnego rejestru. */
  inProgress: { count: number; revenue: number }
  /** Na ile miesięcy rozkładamy duże zakupy sprzętu (ustawienie). */
  gearMonths: number
  /** „N projektów · M klientów · D dni zdjęciowych" okresu i filtra. */
  activity: PeriodActivity
  /** Faktury czekające na wpłatę — „po terminie" zawęża do projektów okresu. */
  open: OpenInvoice[]
  today: string
  onOpenFixed: () => void
}) {
  const { money, company, totals, scoped, perProject } = summary
  const view = scoped ?? totals
  const result = scoped ? scoped.result : totals.result
  const ebbt = scoped ? scoped.ebbt : totals.ebbt
  const negative = result !== null && result < 0
  const tone =
    result === null || Math.abs(result) < 0.5
      ? { box: 'border-white/5 bg-zinc-900/40', text: 'text-zinc-100' }
      : negative
        ? { box: 'border-red-500/30 bg-red-500/5', text: 'text-red-300' }
        : { box: 'border-emerald-500/30 bg-emerald-500/5', text: 'text-emerald-300' }
  const gearView = gearViewLabel(summary.spread, gearMonths)
  const elapsed = periodElapsedMonths(summary.period, today)
  // Z filtrem klienta liczymy z kawałków przychodu jego projektów; bez filtra — gotowe sumy okresu.
  const payments = scoped
    ? periodPayments(summary.projects, summary.period)
    : { paid: money.paid.revenue, awaiting: money.awaiting.revenue }
  const overdue = overdueAwaiting(open, new Set(summary.projects.map((row) => row.money.id)), summary.period)

  // Całkowite koszty: bez filtra wszystko; z filtrem klienta — jego koszty, podatek i (tylko w roku) udział w kosztach firmy.
  const costRows: { label: string; value: number }[] = scoped
    ? [
        { label: 'Koszty bezpośrednie', value: scoped.costs },
        { label: 'Podatek PIT', value: scoped.tax },
        ...(perProject && scoped.overhead !== null ? [{ label: 'Udział w kosztach firmy', value: scoped.overhead }] : []),
      ]
    : [
        { label: 'Koszty bezpośrednie', value: totals.costs },
        { label: 'Podatek PIT', value: company.tax },
        { label: 'ZUS', value: company.zus },
        { label: 'Koszty stałe i subskrypcje', value: company.fixed },
        { label: 'Marketing', value: company.marketing },
        { label: 'Sprzęt', value: company.gear },
      ]
  const totalCosts = costRows.reduce((total, row) => total + row.value, 0)

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Rząd 1 */}
        <div className={`rounded-xl border p-3 sm:p-4 ${tone.box}`}>
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">
            Zysk po wszystkich kosztach{' '}
            <InfoTip title="Zysk po wszystkich kosztach">
              <p>
                Przychód netto minus wszystkie koszty: bezpośrednie, podatek, ZUS, stałe i subskrypcje, marketing, sprzęt. To, co
                zostaje dla Ciebie. {TIP_PERIOD_COSTS}
              </p>
              <p className="mt-1.5 text-zinc-400">Widok sprzętu: {gearView}.</p>
            </InfoTip>
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
              <div className="mt-1 text-xs tabular-nums text-zinc-400">
                {view.revenue > 0 ? `${pct1(result, view.revenue)} przychodu` : 'brak przychodu'}
                {elapsed !== null && ` · ~${pln(result / elapsed)}/mies.`}
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Przychód netto <InfoTip title="Przychód netto">{TILE_HELP.revenue}</InfoTip>
          </div>
          <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(view.revenue)}</div>
          <div className="mt-1.5 text-sm font-semibold leading-snug tabular-nums text-zinc-300" data-testid="finance-activity">
            {activityLabel(activity)}
          </div>
          {scoped && totals.revenue > 0 && (
            <div className="mt-1 text-xs text-zinc-500">{pctOf(view.revenue, totals.revenue)} przychodu firmy</div>
          )}
        </div>

        {/* Cała karta otwiera koszty stałe myszą; z klawiatury i czytnika — strzałka (prawdziwy przycisk, bo w tytule jest (i)). */}
        <div
          onClick={onOpenFixed}
          className="group cursor-pointer rounded-xl border border-white/5 bg-zinc-900/40 p-3 sm:p-4 text-left transition-colors hover:border-white/15"
        >
          <div className="flex items-start justify-between gap-1 text-[11px] uppercase tracking-wide text-zinc-500">
            <span>
              Całkowite koszty{' '}
              <InfoTip title="Całkowite koszty">
                {scoped ? (
                  perProject ? (
                    <p>
                      Dla {scopeName}: koszty bezpośrednie i podatek PIT jego projektów oraz jego udział w kosztach firmy (ZUS, stałe i
                      subskrypcje, marketing, sprzęt) — wg udziału w przychodzie roku. Sprzęt: {gearView}. {TIP_PERIOD_COSTS}
                    </p>
                  ) : (
                    <p>
                      Dla {scopeName}: koszty bezpośrednie i podatek PIT jego projektów. Udział w kosztach firmy jest liczony tylko w
                      widoku roku.
                    </p>
                  )
                ) : (
                  <>
                    <p>Wszystko, co kosztuje, razem:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      <li>koszty bezpośrednie: ekipa, wynajem, dojazd… (z Realizacji, a bez niej z planu),</li>
                      <li>podatek PIT: ryczałt od przychodu,</li>
                      <li>ZUS,</li>
                      <li>koszty stałe i subskrypcje: oprogramowanie, bank, biuro, telefon, ubezpieczenia,</li>
                      <li>marketing: kampanie,</li>
                      <li>sprzęt: zakupy z katalogu i spoza niego ({gearView}).</li>
                    </ul>
                    <p className="mt-1.5 text-zinc-400">{TIP_PERIOD_COSTS}</p>
                  </>
                )}
              </InfoTip>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenFixed()
              }}
              aria-label="Całkowite koszty — koszty stałe i subskrypcje"
              className="shrink-0 rounded text-zinc-700 transition-colors group-hover:text-zinc-300 focus-visible:text-zinc-300"
            >
              <ArrowRight className="size-3.5" />
            </button>
          </div>
          <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(totalCosts)}</div>
          <dl className="mt-1.5 space-y-0.5 text-xs">
            {costRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2">
                <dt className="min-w-0 text-zinc-500">{row.label}</dt>
                <dd className="shrink-0 text-right tabular-nums text-zinc-300">{pln(row.value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* U1 (§17.2): EBBT obok zysku — to samo w obu widokach sprzętu; różnica = pole do optymalizacji. */}
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            EBBT <InfoTip title="EBBT">{TILE_HELP.ebbt}</InfoTip>
          </div>
          {ebbt === null ? (
            <>
              <div className="mt-1 text-xl font-bold text-zinc-500">—</div>
              <div className="mt-1 text-xs text-zinc-500">dla klienta tylko w widoku roku · cała firma {pln(totals.ebbt ?? 0)}</div>
            </>
          ) : (
            <>
              <div className={`mt-1 tabular-nums text-xl font-bold ${ebbt < -0.5 ? 'text-red-300' : 'text-zinc-100'}`}>{pln(ebbt)}</div>
              {result !== null && (
                <div className="mt-1 text-xs text-sky-300/80">
                  pole do optymalizacji {pln(ebbt - result)} — sprzęt, subskrypcje i stałe, marketing
                </div>
              )}
            </>
          )}
        </div>

        {/* Rząd 2 */}
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Marża na realizacji <InfoTip title="Marża na realizacji">{TILE_HELP.margin}</InfoTip>
          </div>
          <MarginPair before={view.margin} after={view.margin - view.tax} revenue={view.revenue} />
        </div>

        {/* R2 (D2, V1): suma marż producenckich projektów — marża na realizacji minus wartość mojej pracy. */}
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Marża producencka{' '}
            <InfoTip title="Marża producencka">
              {view.ownWork > 0.5 ? (
                <>
                  Marża na realizacji − wartość Twojej pracy ({pln(view.ownWork)}): co zostaje, gdyby ktoś inny zrobił Twoją
                  robotę. Procent liczony od przychodu.
                </>
              ) : (
                <>
                  Marża na realizacji − wartość Twojej pracy: co zostaje, gdyby ktoś inny zrobił Twoją robotę. W tym okresie nic nie
                  oznaczono jako „Moja praca", więc marża producencka jest równa marży na realizacji. Procent liczony od przychodu.
                </>
              )}
            </InfoTip>
          </div>
          <MarginPair
            before={view.producerMargin}
            after={view.producerMargin - view.tax}
            revenue={view.revenue}
            redWhenNegative
          />
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            W realizacji <InfoTip title="W realizacji">{TILE_HELP.inProgress}</InfoTip>
          </div>
          <div className="mt-1 tabular-nums text-xl font-bold text-zinc-100">{pln(inProgress.revenue)}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {inProgress.count} {plural(inProgress.count, 'projekt', 'projekty', 'projektów')}
          </div>
          {pipeline.count > 0 && (
            <div className="mt-0.5 text-xs tabular-nums text-zinc-500">
              w wycenach {pln(pipeline.value)} · {pipeline.count}
            </div>
          )}
        </div>

        {/* Ta sama reguła co odhaczenie „Zapłacone" na liście projektów, per faktura. */}
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Czeka na wpłatę <InfoTip title="Czeka na wpłatę">{TILE_HELP.awaiting}</InfoTip>
          </div>
          <div className={`mt-1 tabular-nums text-xl font-bold ${payments.awaiting > 0.5 ? 'text-amber-300' : 'text-zinc-100'}`}>
            {pln(payments.awaiting)}
          </div>
          {overdue > 0.5 && (
            <div className="mt-1 text-xs tabular-nums text-red-300/80">z czego po terminie {pln(overdue)}</div>
          )}
          <div className={`${overdue > 0.5 ? 'mt-0.5' : 'mt-1'} text-xs tabular-nums text-emerald-400/80`}>
            wpłynęło {pln(payments.paid)}
          </div>
        </div>
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

/** „Zakończone projekty": liczby zależne od projektów (kafle, wykres, tabele) tylko ze statusu „Zakończony". Raport go nie czyta. */
function DoneOnlyToggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="cursor-pointer text-sm text-zinc-300">
        Zakończone projekty
      </label>
      <InfoTip title="Zakończone projekty">
        Włączone: kafle, wykres i tabele liczą tylko projekty ze statusem „Zakończony". Koszty firmy (ZUS, stałe, marketing, sprzęt)
        zostają w całości. Raportu to nie dotyczy.
      </InfoTip>
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
  doneOnly,
  onDoneOnly,
}: {
  directory: ClientInfo[]
  scopeName: string
  memberNames: string[]
  onScope: (value: string) => void
  spread: boolean
  onSpread: (next: boolean) => void
  settings: GearSpreadSettings
  onThreshold: (value: number) => void
  doneOnly: boolean
  onDoneOnly: (next: boolean) => void
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
      <DoneOnlyToggle id="finance-done-only" checked={doneOnly} onChange={onDoneOnly} />
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
        { label: 'Zysk po wszystkich kosztach', value: row.result, color: COLOR_RESULT },
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
            Zysk po wszystkich kosztach{scoped && ' (cała firma)'}
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
  const [doneOnly, setDoneOnly] = useState<boolean>(() => readPref(DONE_ONLY_KEY) === 'on')
  const [scopeValue, setScopeValue] = useState<string>(() => readPref(SCOPE_KEY) ?? '')
  const [settings, setSettings] = useState<GearSpreadSettings>(() => gearSpreadSettings(getLoadedCompany()))
  const today = toDateKey(new Date())
  const taxRate = companyTaxRate(getLoadedCompany())

  // Pieniądze projektów liczone raz; okresy i wykres tylko je dzielą.
  const ledger = useMemo(() => moneyLedger(projects, events, today, taxRate), [projects, events, today, taxRate])
  const ledgerById = useMemo(() => new Map(ledger.map((m) => [m.id, m])), [ledger])
  const statusById = useMemo(() => new Map(projects.map((p) => [p.id, p.status])), [projects])
  // „Zakończone projekty": liczby zależne od projektów (kafle, wykres, tabele, płatności) tylko z projektów `done`.
  // Koszty firmy zostają w całości; „W realizacji" i Raport czytają pełny rejestr.
  const viewLedger = useMemo(
    () => (doneOnly ? ledger.filter((m) => statusById.get(m.id) === 'done') : ledger),
    [ledger, statusById, doneOnly]
  )
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
    () => ({ ledger: viewLedger, fixedCosts: yearCosts, equipment, spread, settings, today, scope: scopeIds }),
    [viewLedger, yearCosts, equipment, spread, settings, today, scopeIds]
  )
  const margin = useMemo(() => marginSummary(marginInput, period), [marginInput, period])
  const trend = useMemo(() => marginTrend(marginInput, period.year), [marginInput, period.year])
  // Podsumowanie nad kaflami: te same projekty co w kaflach (okres + filtr klienta).
  const activity = useMemo(
    () => periodActivity({ projectIds: margin.projects.map((row) => row.money.id), projects, events, groups, period }),
    [margin.projects, projects, events, groups, period]
  )

  const changeSpread = (next: boolean) => {
    setSpread(next)
    writePref(SPREAD_KEY, next ? 'on' : 'off')
  }
  const changeDoneOnly = (next: boolean) => {
    setDoneOnly(next)
    writePref(DONE_ONLY_KEY, next ? 'on' : 'off')
  }
  const changeScope = (value: string) => {
    setScopeValue(value)
    writePref(SCOPE_KEY, value)
  }
  const changeThreshold = (thresholdPln: number) => {
    patchLoadedCompany({ gearSpreadThresholdPln: thresholdPln })
    setSettings((prev) => ({ ...prev, thresholdPln }))
  }
  const inProgress = useMemo(
    () => inProgressInPeriod(ledger, statusById, scopeIds, period),
    [ledger, statusById, scopeIds, period]
  )
  // Wyceny nie mają faktur — w okresie leżą po dacie księgowej, jak dotąd.
  const pipelineSummary = useMemo(() => summarizePeriod(projects, [], period, ledgerById), [projects, period, ledgerById])
  const pipeline = useMemo(
    () =>
      projects.filter(
        (p) => p.status === 'quote' && isInPeriod(p.date, period) && (!scopeIds || scopeIds.has(p.id))
      ),
    [projects, period, scopeIds]
  )
  const open = useMemo(() => openInvoices(viewLedger, today), [viewLedger, today])
  const openByProject = useMemo(() => {
    const map = new Map<string, OpenInvoice[]>()
    open.forEach((invoice) => map.set(invoice.projectId, [...(map.get(invoice.projectId) ?? []), invoice]))
    return map
  }, [open])
  const days = useMemo(() => paymentDays(viewLedger, period), [viewLedger, period])
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
          {/* Zakładka Projekty: objaśnienia siedzą w (i) przy kaflach, nie w akapicie. */}
          {tab !== 'projects' && (
            <p className="mt-1 text-sm text-zinc-500">
              {tab === 'fixed' ? (
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
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'projects' && margin.provisional && <Provisional />}
          <PeriodPicker period={period} years={years} onChange={setPeriod} />
        </div>
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
            doneOnly={doneOnly}
            onDoneOnly={changeDoneOnly}
          />
          <KpiTiles
            summary={margin}
            scopeName={selectedClient?.name ?? null}
            pipeline={{ count: pipelineSummary.quoteCount, value: pipelineSummary.pipelineValue }}
            inProgress={inProgress}
            gearMonths={settings.months}
            activity={activity}
            open={open}
            today={today}
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
            moneyById={ledgerById}
            onOpenProject={onOpenProject}
          />
          <ExtraSalesPanel summary={margin} periodLabel={periodLabel(period)} scoped={!!scopeIds} />
          <RentalsPanel summary={margin} projectsById={projectsById} periodLabel={periodLabel(period)} onOpenProject={onOpenProject} />
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
