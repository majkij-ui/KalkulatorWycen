'use client'

/**
 * Pętla pieniędzy w Finansach (T6): plan obok rzeczywistości w każdym
 * projekcie okresu i faktury czekające na wpłatę. Liczby z `money-loop.ts`;
 * tu tylko słowa i układ. Brak faktur czy kosztów to stan opisany słowami,
 * nigdy „0 zł".
 */

import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import type { MarginSummary, ProjectMargin } from '@/lib/margin-ledger'
import type { OpenInvoice, PaymentDays } from '@/lib/money-loop'
import {
  BASIS_LABEL,
  afterDays,
  costsText,
  days,
  dueText,
  formatDate,
  marginText,
  paymentText,
  pln,
  resultText,
  revenueText,
  shortDate,
  type Basis,
  type CellText,
} from '@/lib/money-loop-labels'
import { plural } from '@/lib/pl-plural'
import { countsTowardRevenue, type Project } from '@/lib/project-types'
import { ProjectStatusBadge } from '@/components/projects/project-status-badge'

/** Skąd jest liczba — słowem, nie samym kolorem. */
function BasisTag({ basis }: { basis: Basis }) {
  const tone =
    basis === 'plan'
      ? 'border-white/10 text-zinc-500'
      : 'border-emerald-500/30 text-emerald-300/90'
  return (
    <span className={`ml-1.5 inline-block rounded border px-1 text-[10px] font-medium leading-4 ${tone}`}>
      {BASIS_LABEL[basis]}
    </span>
  )
}

// ── Plan a rzeczywistość ─────────────────────────────────────────────────────

function Cell({ label, text, className = '' }: { label: string; text: CellText; className?: string }) {
  return (
    <div className={`min-w-0 xl:text-right ${className}`}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-600 xl:hidden">{label}</div>
      <div
        className={`tabular-nums text-sm ${
          text.muted ? 'text-zinc-500' : text.alert ? 'font-semibold text-red-300' : text.warn ? 'text-amber-300' : 'text-zinc-100'
        }`}
      >
        {text.value}
        {text.basis && <BasisTag basis={text.basis} />}
      </div>
      {text.note && (
        <div className={`mt-0.5 text-[11px] leading-snug ${text.warn && !text.muted ? 'text-amber-300/80' : 'text-zinc-500'}`}>
          {text.note}
        </div>
      )}
    </div>
  )
}

const GRID4 = 'grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]'
/** Widok roku: piąta kolumna „Po kosztach firmy" (warstwa 2 per projekt, decyzja A). */
const GRID5 = 'grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5 xl:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]'

function PlanActualRow({
  row,
  project,
  open,
  perProject,
  onOpen,
}: {
  row: ProjectMargin
  project: Project
  open: OpenInvoice[]
  perProject: boolean
  onOpen: (id: string) => void
}) {
  const GRID = perProject ? GRID5 : GRID4
  const { money } = row
  const partOfWhole = money.revenue !== null && Math.abs(row.revenue - money.revenue) >= 0.5
  return (
    <button
      type="button"
      onClick={() => onOpen(project.id)}
      className={`group ${GRID} w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5`}
    >
      <div
        className={`col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${perProject ? 'sm:col-span-5' : 'sm:col-span-4'} xl:col-span-1`}
      >
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          <span className="truncate text-sm text-zinc-200">{project.name || 'Bez nazwy'}</span>
          <ArrowRight className="size-3.5 shrink-0 text-zinc-700 transition-colors group-hover:text-zinc-300" />
        </span>
        <span className="tabular-nums text-[11px] text-zinc-500">{formatDate(money.anchor)}</span>
        <ProjectStatusBadge status={project.status} />
        {partOfWhole && (
          <span className="text-[11px] text-sky-300/80">
            {row.anchored ? 'część' : 'dodatkowa faktura'}: {pln(row.revenue)} w tym okresie
          </span>
        )}
      </div>
      <Cell label="Przychód" text={revenueText(money)} />
      <Cell label="Koszty" text={costsText(money)} />
      <Cell label="Marża na realizacji" text={marginText(row)} />
      {perProject && <Cell label="Po kosztach firmy" text={resultText(row)} />}
      <Cell label="Zapłata" text={paymentText(money, open)} />
    </button>
  )
}

export function PlanVsActual({
  summary,
  projectsById,
  openByProject,
  pipeline,
  moneyById,
  onOpenProject,
}: {
  summary: MarginSummary
  projectsById: Map<string, Project>
  openByProject: Map<string, OpenInvoice[]>
  /** Wyceny okresu — pokazywane szaro, poza wynikiem. */
  pipeline: Project[]
  /** U1: pieniądze projektów z pętli — kwota wyceny jak w Finansach projektu. */
  moneyById: ReadonlyMap<string, { revenue: number | null }>
  onOpenProject: (id: string) => void
}) {
  const rows = summary.projects.filter((row) => projectsById.has(row.money.id))
  const { perProject } = summary
  const GRID = perProject ? GRID5 : GRID4

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Plan a rzeczywistość</h2>
        <p className="text-[11px] text-zinc-500">
          Faktury zastępują plan, gdy są; koszty — gdy wpisano je w Realizacji. Marża na realizacji jest przed
          podatkiem.{' '}
          {perProject
            ? 'Po kosztach firmy: minus ryczałt i część kosztów firmy wg udziału w przychodzie roku.'
            : 'Wynik po kosztach firmy per projekt — w widoku roku.'}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-2 text-sm text-zinc-600">
          Żaden projekt nie jest „W realizacji" ani „Zrealizowany" w tym okresie.
        </p>
      ) : (
        <div className="flex flex-col">
          <div className={`${GRID} hidden px-3 pb-1 text-[11px] text-zinc-500 xl:grid`}>
            <span>Projekt</span>
            <span className="text-right">Przychód</span>
            <span className="text-right">Koszty</span>
            <span className="text-right">Marża na realizacji</span>
            {perProject && <span className="text-right">Po kosztach firmy</span>}
            <span className="text-right">Zapłata</span>
          </div>
          {rows.map((row) => (
            <PlanActualRow
              key={row.money.id}
              row={row}
              project={projectsById.get(row.money.id)!}
              open={openByProject.get(row.money.id) ?? []}
              perProject={perProject}
              onOpen={onOpenProject}
            />
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
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5"
              >
                <span className="w-20 shrink-0 tabular-nums text-xs text-zinc-500">{formatDate(p.date)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{p.name || 'Bez nazwy'}</span>
                <ProjectStatusBadge status={p.status} />
                <span className="w-24 shrink-0 text-right tabular-nums text-xs text-zinc-500">
                  {(() => {
                    const value = moneyById.get(p.id)?.revenue ?? null
                    return value === null ? (p.quote ? 'nie policzono' : 'brak wyceny') : pln(value)
                  })()}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-zinc-700 transition-colors group-hover:text-zinc-300" />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// ── Płatności ────────────────────────────────────────────────────────────────

function OpenInvoiceRow({
  invoice,
  project,
  onOpen,
}: {
  invoice: OpenInvoice
  project: Project
  onOpen: (id: string) => void
}) {
  const late = invoice.daysOverdue > 0
  return (
    <button
      type="button"
      onClick={() => onOpen(project.id)}
      className={`group flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
        late ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-white/5'
      }`}
    >
      <span className="min-w-0 basis-full truncate text-sm text-zinc-200 sm:basis-0 sm:flex-1">
        {project.name || 'Bez nazwy'}
        <span className="ml-2 text-xs text-zinc-500">
          {invoice.number ? `FV ${invoice.number}` : 'Faktura'} z {shortDate(invoice.sent)}
        </span>
      </span>
      {/* Faktura na wycenie albo nieprzyjętej to raczej pomyłka w statusie — widać to od razu. */}
      {!countsTowardRevenue(project.status) && <ProjectStatusBadge status={project.status} />}
      <span className={`text-xs tabular-nums ${late ? 'font-semibold text-red-300' : 'text-zinc-400'}`}>
        {dueText(invoice)}
      </span>
      <span className="ml-auto w-24 text-right text-sm tabular-nums text-zinc-100">
        {invoice.amount === null ? <span className="text-xs text-amber-300/80">bez kwoty</span> : pln(invoice.amount)}
      </span>
      <ArrowRight className="hidden size-3.5 shrink-0 self-center text-zinc-700 transition-colors group-hover:text-zinc-300 sm:block" />
    </button>
  )
}

export function PaymentsPanel({
  open,
  stats,
  periodLabel,
  projectsById,
  onOpenProject,
}: {
  open: OpenInvoice[]
  stats: PaymentDays
  periodLabel: string
  projectsById: Map<string, Project>
  onOpenProject: (id: string) => void
}) {
  const shown = open.filter((invoice) => projectsById.has(invoice.projectId))
  const late = shown.filter((invoice) => invoice.daysOverdue > 0)
  const waiting = shown.filter((invoice) => invoice.daysOverdue <= 0)
  const lateSum = late.reduce((sum, invoice) => sum + (invoice.amount ?? 0), 0)

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4" aria-label="Płatności">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Płatności</h2>
        <p className="text-xs text-zinc-400">
          {stats.paidCount === 0 ? (
            <>Faktury z {periodLabel}: żadna nie jest jeszcze opłacona</>
          ) : (
            <>
              Faktury z {periodLabel}: zapłacone po{' '}
              <span className="font-semibold tabular-nums text-zinc-100">
                {afterDays(Math.round(stats.medianDays ?? 0))}
              </span>{' '}
              (mediana z {stats.paidCount}) · najdłużej {days(stats.maxDays ?? 0)}
              {stats.lateCount > 0 && ` · ${stats.lateCount} po terminie`}
            </>
          )}
        </p>
      </div>

      {late.length > 0 && (
        <div className="mb-2">
          <h3 className="mb-1 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-red-300">
            <AlertTriangle className="size-3.5" />
            Po terminie: {late.length} {plural(late.length, 'faktura', 'faktury', 'faktur')}
            {lateSum > 0 && <span className="normal-case tracking-normal"> · {pln(lateSum)}</span>}
          </h3>
          {late.map((invoice, i) => (
            <OpenInvoiceRow
              key={`${invoice.projectId}-${invoice.number ?? i}-${invoice.sent}`}
              invoice={invoice}
              project={projectsById.get(invoice.projectId)!}
              onOpen={onOpenProject}
            />
          ))}
        </div>
      )}

      {waiting.length > 0 && (
        <div>
          <h3 className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Czekają, w terminie
          </h3>
          {waiting.map((invoice, i) => (
            <OpenInvoiceRow
              key={`${invoice.projectId}-${invoice.number ?? i}-${invoice.sent}`}
              invoice={invoice}
              project={projectsById.get(invoice.projectId)!}
              onOpen={onOpenProject}
            />
          ))}
        </div>
      )}

      {shown.length === 0 && (
        <p className="flex items-center gap-2 px-3 py-1 text-sm text-zinc-500">
          <CheckCircle2 className="size-4 text-emerald-400/70" />
          Żadna wysłana faktura nie czeka na wpłatę.
        </p>
      )}
      <p className="mt-2 px-3 text-[11px] text-zinc-600">Lista faktur: stan na dziś, niezależnie od wybranego okresu.</p>
    </section>
  )
}
