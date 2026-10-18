'use client'

/**
 * Arkusz A4 raportu okresowego (biały, do PDF) — barwy marki jak call sheet
 * i oferta: czarny pasek z logo, etykiety JetBrains Mono, akcent Ember.
 * Tabele i zdania to dokładnie `reportSections` (`period-report-sections.ts`),
 * te same, które widać na ekranie i które idą do pliku Markdown.
 *
 * `data-pdf-break="after"` = bezpieczne miejsca cięcia strony (wiersze tabel
 * i końce sekcji); arkusz trafia do `exportCallSheetPdf` (html2canvas-pro →
 * jsPDF), tak jak call sheet.
 */

import type { ReactNode } from 'react'
import type { PeriodReport } from '@/lib/period-report'
import {
  noteLines,
  reportSections,
  reportSubtitle,
  reportTitle,
  type ReportSection,
  type ReportTable,
} from '@/lib/period-report-sections'
import { formatDate } from '@/lib/money-loop-labels'

const BRAND = { ink: '#09090B', ember: '#EC5A29', emberDeep: '#D8431F' }
const FONT_SANS = 'var(--font-archivo, var(--font-inter, Inter), sans-serif)'
const FONT_MONO = 'var(--font-jetbrains-mono, ui-monospace, monospace)'
const mono = { fontFamily: FONT_MONO }

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="h-px w-4 shrink-0" style={{ backgroundColor: BRAND.ember }} aria-hidden />
      <span className="text-[7pt] font-semibold uppercase tracking-[0.14em]" style={{ ...mono, color: BRAND.emberDeep }}>
        {children}
      </span>
    </div>
  )
}

function PrintTable({ table }: { table: ReportTable }) {
  return (
    <div className="mt-2">
      {table.caption && (
        <div className="mb-1 text-[7pt] font-semibold uppercase tracking-[0.08em] text-zinc-500" style={mono}>
          {table.caption}
        </div>
      )}
      <table className="w-full border-collapse overflow-hidden rounded-lg text-[7.5pt] leading-tight">
        <thead>
          <tr data-pdf-break="after" className="bg-zinc-50">
            {table.head.map((cell, i) => (
              <th
                key={i}
                className={`border-y border-zinc-200 px-1.5 py-1 text-[6.5pt] font-semibold uppercase tracking-[0.06em] text-zinc-500 ${table.align[i] === 'r' ? 'text-right' : 'text-left'}`}
                style={mono}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} data-pdf-break="after" className={table.strong.includes(r) ? 'bg-zinc-50 font-bold' : ''}>
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`break-words border-b border-zinc-100 px-1.5 py-1 align-top ${table.align[i] === 'r' ? 'whitespace-nowrap text-right tabular-nums' : 'text-left'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PrintSection({ index, section }: { index: number | null; section: ReportSection }) {
  return (
    <section className="mt-5">
      <div data-pdf-break="after">
        <Eyebrow>
          {index !== null ? `${index}. ` : ''}
          {section.title}
        </Eyebrow>
        {section.lead.map((line, i) => (
          <p key={i} className="mt-0.5 text-[8pt] leading-snug text-zinc-700">
            {line}
          </p>
        ))}
      </div>
      {section.tables.map((table, i) => (
        <PrintTable key={i} table={table} />
      ))}
      {section.after.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[8pt] leading-snug text-zinc-700">
          {section.after.map((line, i) => (
            <li key={i} data-pdf-break="after">
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export interface PrintableReportProps {
  report: PeriodReport
  /** Producent z tekstów PDF (firma, producent). */
  production: { company: string; producer: string }
}

export function PrintableReport({ report, production }: PrintableReportProps) {
  const sections = reportSections(report)
  const notes = noteLines(report)
  const subtitle = reportSubtitle(report)
  const byline = [production.producer, production.company].filter(Boolean).join(' · ')

  return (
    <div className="w-[210mm] bg-white px-8 pb-8 pt-4 text-[9pt] leading-snug text-zinc-900" style={{ fontFamily: FONT_SANS }}>
      <div data-pdf-break="after">
        <div className="flex w-full items-center justify-between rounded-xl px-7 py-3" style={{ backgroundColor: BRAND.ink }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="NonoiseMedia" className="h-9 w-9 rounded-full object-cover" />
          <div className="flex-1 text-center text-[15px] font-bold tracking-[0.2em] text-white">RAPORT OKRESOWY</div>
          <div className="w-9" aria-hidden />
        </div>
        <div className="mt-3">
          <div className="text-[17pt] font-bold leading-tight">
            {report.period.label}
            {report.provisional && (
              <span className="ml-2 align-middle text-[8pt] font-semibold uppercase tracking-[0.12em]" style={{ ...mono, color: BRAND.emberDeep }}>
                wstępnie
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[9pt] text-zinc-600">{reportTitle(report)}</div>
        </div>
        <div className="mt-2 space-y-0.5 border-y border-zinc-200 py-2 text-[8.5pt] text-zinc-700">
          {subtitle.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {byline && <div className="text-zinc-500">{byline}</div>}
        </div>
      </div>

      {sections.map((section, i) => (
        <PrintSection key={section.id} index={i + 1} section={section} />
      ))}

      <section className="mt-5">
        <div data-pdf-break="after">
          <Eyebrow>{sections.length + 1}. Do wyjaśnienia</Eyebrow>
        </div>
        {notes.length === 0 ? (
          <p className="text-[8pt] text-zinc-700">Nic do wyjaśnienia.</p>
        ) : (
          <ul className="space-y-0.5 text-[8pt] leading-snug text-zinc-700">
            {notes.map((note, i) => (
              <li key={i} data-pdf-break="after">
                <span className="font-semibold">{note.label}:</span> {note.text}
              </li>
            ))}
          </ul>
        )}
        <p data-pdf-break="after" className="mt-3 text-[7pt] text-zinc-400" style={mono}>
          Wygenerowano {formatDate(report.generatedAt)} z NonoiseMedia Hub · kwoty netto w zł
        </p>
      </section>
    </div>
  )
}
