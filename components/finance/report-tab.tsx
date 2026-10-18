'use client'

/**
 * Zakładka „Raport" w Finansach (S5): raport za kwartał, półrocze albo rok
 * (okres z nagłówka Finansów) i przełącznik sprzętu z zakładki Projekty.
 *
 * Nic tu nie liczy pieniędzy: `buildPeriodReport` (`period-report.ts`) składa
 * raport z modułów hubu, `reportSections` robi z niego tabele — te same, które
 * idą do PDF i do pliku Markdown. Ten plik tylko je układa i zapisuje.
 *
 * PDF: ukryty arkusz A4 → html2canvas-pro → jsPDF → „Zapisz jako…" (droga
 * call sheetu). Markdown: plik z definicjami, „Do wyjaśnienia", tabelami i
 * blokiem JSON, do wklejenia w rozmowę z asystentem.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { FileDown, FileText, Loader2 } from 'lucide-react'
import type { ClientGroup } from '@/lib/client-groups'
import { useCrew } from '@/lib/crew-context'
import { exportReportMarkdown, exportReportPdf } from '@/lib/export-report'
import type { Period } from '@/lib/finance-calc'
import type { TimelineEvent } from '@/lib/event-types'
import type { GearSpreadSettings } from '@/lib/gear-costs'
import { pln } from '@/lib/money-loop-labels'
import { getPdfTextsConfig } from '@/lib/pdf-texts-config'
import { buildPeriodReport, type PeriodReport, type ReportMetric } from '@/lib/period-report'
import {
  noteLines,
  reportSections,
  reportSubtitle,
  reportTitle,
  signed,
  type ReportSection,
  type ReportTable,
} from '@/lib/period-report-sections'
import { plural } from '@/lib/pl-plural'
import type { EquipmentItem, FixedCost, Project } from '@/lib/project-types'
import type { Subscription } from '@/lib/subscription-types'
import { useCampaigns } from '@/components/marketing/use-campaigns'
import { PrintableReport } from './printable-report'

export interface ReportTabProps {
  period: Period
  projects: Project[]
  events: TimelineEvent[]
  /** Ręczne koszty stałe z pliku (bez rat subskrypcji). */
  fixedCosts: FixedCost[]
  subscriptions: Subscription[]
  equipment: EquipmentItem[]
  groups: ClientGroup[]
  spread: boolean
  settings: GearSpreadSettings
  taxRatePercent: number
  today: string
  /** Przełącznik „Rozłóż duże zakupy sprzętu" z Finansów. */
  gearToggle: ReactNode
}

// ── Tabele na ekranie ────────────────────────────────────────────────────────

function ScreenTable({ table }: { table: ReportTable }) {
  return (
    <div className="mt-3 first:mt-0">
      {table.caption && <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{table.caption}</div>}
      <div className="overflow-x-auto rounded-lg border border-white/5">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-white/[0.03] text-[10px] uppercase tracking-wide text-zinc-500">
              {table.head.map((cell, i) => (
                <th key={i} className={`px-3 py-1.5 font-medium ${table.align[i] === 'r' ? 'text-right' : 'text-left'}`}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className={`border-t border-white/5 ${table.strong.includes(r) ? 'bg-white/[0.03] font-semibold text-zinc-100' : 'text-zinc-300'}`}>
                {row.map((cell, i) => (
                  <td
                    key={i}
                    className={`px-3 py-1.5 align-top ${table.align[i] === 'r' ? 'whitespace-nowrap text-right tabular-nums' : 'text-left'} ${i === 1 && table.align[1] === 'l' ? 'min-w-48' : ''}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SectionCard({ index, section }: { index: number; section: ReportSection }) {
  return (
    <section className="mb-4 rounded-xl border border-white/5 bg-zinc-900/40 p-4" aria-label={section.title}>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
        {index}. {section.title}
      </h2>
      {section.lead.map((line, i) => (
        <p key={i} className="mb-2 text-sm text-zinc-300">
          {line}
        </p>
      ))}
      {section.tables.map((table, i) => (
        <ScreenTable key={i} table={table} />
      ))}
      {section.after.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-zinc-400">
          {section.after.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Kafle ────────────────────────────────────────────────────────────────────

function Tile({ metric, tone }: { metric: ReportMetric; tone?: 'good' | 'bad' | null }) {
  const negative = metric.value < 0
  const box = tone === 'good' ? 'border-emerald-500/30 bg-emerald-500/5' : tone === 'bad' ? 'border-red-500/30 bg-red-500/5' : 'border-white/5 bg-zinc-900/40'
  const text = tone === 'good' ? 'text-emerald-300' : tone === 'bad' || negative ? 'text-red-300' : 'text-zinc-100'
  return (
    <div className={`rounded-xl border p-4 ${box}`}>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{metric.label}</div>
      <div className={`mt-1 tabular-nums text-xl font-bold ${text}`}>{pln(metric.value)}</div>
      <div className="mt-1 text-xs text-zinc-500">
        {metric.change === null ? 'bez porównania' : `${signed(metric.change)} wobec poprzedniego okresu`}
        {metric.pctOfRevenue !== null && ` · ${Math.round(metric.pctOfRevenue)}% przychodu`}
      </div>
    </div>
  )
}

function Provisional() {
  return (
    <span className="ml-2 rounded border border-amber-400/30 px-1 align-middle text-[10px] font-medium normal-case tracking-normal text-amber-300/90">
      wstępnie
    </span>
  )
}

// ── Zakładka ─────────────────────────────────────────────────────────────────

export function ReportTab(props: ReportTabProps) {
  const { period, projects, events, fixedCosts, subscriptions, equipment, groups, spread, settings, taxRatePercent, today, gearToggle } = props
  const { campaigns, isLoading: campaignsLoading } = useCampaigns()
  const { allPeople, isLoading: crewLoading } = useCrew()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState<'pdf' | 'md' | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const report: PeriodReport = useMemo(
    () =>
      buildPeriodReport(
        {
          projects,
          events,
          fixedCosts,
          subscriptions,
          equipment,
          campaigns,
          crew: allPeople,
          groups,
          spread,
          settings,
          taxRatePercent,
          today,
        },
        period
      ),
    [projects, events, fixedCosts, subscriptions, equipment, campaigns, allPeople, groups, spread, settings, taxRatePercent, today, period]
  )
  const sections = useMemo(() => reportSections(report), [report])
  const notes = useMemo(() => noteLines(report), [report])
  const pdfTexts = getPdfTextsConfig()

  const metric = (key: string) => report.metrics.find((m) => m.key === key)
  const revenue = metric('revenue')
  const margin = metric('margin')
  const costs = metric('companyCosts')
  const result = metric('result')

  const saved = (r: Awaited<ReturnType<typeof exportReportMarkdown>>, what: string) => {
    if (r.status === 'saved') {
      const pages = r.pages > 0 ? ` (${r.pages} ${plural(r.pages, 'strona', 'strony', 'stron')})` : ''
      setNotice({ tone: 'ok', message: `Zapisano ${what}${pages}: ${r.path}` })
    } else if (r.status === 'downloaded') {
      const pages = r.pages > 0 ? ` (${r.pages} ${plural(r.pages, 'strona', 'strony', 'stron')})` : ''
      setNotice({ tone: 'ok', message: `Pobrano ${r.fileName}${pages}.` })
    }
  }

  const savePdf = async () => {
    const el = printRef.current
    if (!el) return
    setBusy('pdf')
    setNotice(null)
    try {
      // Arkusz musi mieć świeże dane w DOM, zanim zrobimy zdjęcie.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      saved(await exportReportPdf(el, report), 'PDF')
    } catch (error) {
      console.error('Eksport raportu do PDF nie powiódł się:', error)
      setNotice({ tone: 'error', message: `Nie udało się zapisać PDF: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setBusy(null)
    }
  }

  const saveMarkdown = async () => {
    setBusy('md')
    setNotice(null)
    try {
      saved(await exportReportMarkdown(report), 'plik Markdown')
    } catch (error) {
      console.error('Zapis raportu (Markdown) nie powiódł się:', error)
      setNotice({ tone: 'error', message: `Nie udało się zapisać pliku: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setBusy(null)
    }
  }

  if (campaignsLoading || crewLoading) {
    return (
      <div className="flex justify-center py-16 text-zinc-600">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  const subtitle = reportSubtitle(report)
  const buttonClass =
    'flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div>
      {/* Arkusz do PDF — poza ekranem tylko na czas eksportu */}
      <div ref={printRef} style={{ display: 'none' }} aria-hidden>
        <PrintableReport report={report} production={{ company: pdfTexts.companyName, producer: pdfTexts.producerName }} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">{gearToggle}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={savePdf} disabled={busy !== null} className={buttonClass} aria-label="Zapisz raport jako PDF">
            {busy === 'pdf' ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
            Zapisz PDF
          </button>
          <button type="button" onClick={saveMarkdown} disabled={busy !== null} className={buttonClass} aria-label="Zapisz raport jako plik Markdown z JSON">
            {busy === 'md' ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
            Zapisz Markdown + JSON
          </button>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${notice.tone === 'error' ? 'border-red-500/30 bg-red-500/5 text-red-200' : 'border-white/10 bg-white/[0.03] text-zinc-300'}`}
        >
          {notice.message}
        </div>
      )}

      <div className="mb-4">
        <h2 className="text-lg font-bold tracking-tight text-white">
          {reportTitle(report).replace(' (wstępnie)', '')}
          {report.provisional && <Provisional />}
        </h2>
        <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
          {subtitle.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {revenue && <Tile metric={revenue} />}
        {margin && <Tile metric={margin} />}
        {costs && <Tile metric={costs} />}
        {result && <Tile metric={result} tone={result.value < 0 ? 'bad' : result.value > 0.5 ? 'good' : null} />}
      </div>

      {sections.map((section, i) => (
        <SectionCard key={section.id} index={i + 1} section={section} />
      ))}

      <section className="mb-4 rounded-xl border border-white/5 bg-zinc-900/40 p-4" aria-label="Do wyjaśnienia">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">{sections.length + 1}. Do wyjaśnienia</h2>
        {notes.length === 0 ? (
          <p className="text-sm text-zinc-400">Nic do wyjaśnienia.</p>
        ) : (
          <ul className="space-y-1.5 text-sm text-zinc-300">
            {notes.map((note, i) => (
              <li key={i}>
                <span
                  className={`mr-1.5 rounded border px-1 text-[10px] font-medium uppercase tracking-wide ${
                    note.kind === 'disagreement'
                      ? 'border-amber-400/30 text-amber-300/90'
                      : note.kind === 'gap'
                        ? 'border-red-400/30 text-red-300/90'
                        : 'border-white/10 text-zinc-500'
                  }`}
                >
                  {note.label}
                </span>
                {note.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
