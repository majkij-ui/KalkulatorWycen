/**
 * Raport okresowy → jeden plik Markdown (S5, decyzja F): te same tabele co
 * PDF (`period-report-sections.ts`), na początku definicje i „Do wyjaśnienia",
 * na końcu blok JSON z całym raportem — do wklejenia w rozmowę z asystentem
 * AI. Tekst po polsku, klucze JSON po angielsku, etykiety po polsku.
 *
 * Moduł czysty — testy w `period-report.test.ts`.
 */

import { safeFileName } from './pdf-pages'
import type { PeriodReport } from './period-report'
import { noteLines, reportSections, reportSubtitle, reportTitle, type ReportTable } from './period-report-sections'

/** Pojedyncza spacja zamiast twardej (kopiowanie do rozmowy) i bez łamań wiersza w komórce. */
function cell(text: string): string {
  return text.replace(/[  ]/g, ' ').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

function plain(text: string): string {
  return text.replace(/[  ]/g, ' ')
}

export function markdownTable(t: ReportTable): string {
  const head = `| ${t.head.map(cell).join(' | ')} |`
  const rule = `|${t.align.map((a) => (a === 'r' ? '---:' : '---')).join('|')}|`
  const rows = t.rows.map((row, index) => {
    const cells = row.map((text) => (t.strong.includes(index) && text.trim() ? `**${cell(text)}**` : cell(text)))
    return `| ${cells.join(' | ')} |`
  })
  return [head, rule, ...rows].join('\n')
}

/** Nazwa pliku bez rozszerzenia: „Raport Q3 2026" (otwarty: „Raport Q4 2026 (wstępnie)"). */
export function reportBaseName(report: PeriodReport): string {
  return safeFileName(`Raport ${report.period.label}${report.provisional ? ' (wstępnie)' : ''}`)
}

export function reportFileName(report: PeriodReport, extension: 'md' | 'pdf'): string {
  return `${reportBaseName(report)}.${extension}`
}

export function reportToMarkdown(report: PeriodReport): string {
  const out: string[] = []
  out.push(`# ${reportTitle(report)}`, '')
  out.push(...reportSubtitle(report).map((line) => `${plain(line)}  `))
  out.push('')
  out.push(
    '> Plik do wklejenia w rozmowę z asystentem AI. Na końcu jest blok JSON z całym raportem (te same liczby co w tabelach, plus szczegóły: faktury, kampanie, ekipa, sprzęt). Kwoty netto w zł.',
    ''
  )

  out.push('## Jak liczone (definicje)', '')
  report.definitions.forEach((d) => out.push(`- **${d.label}:** ${plain(d.text)}`))
  out.push('')

  out.push('## Do wyjaśnienia', '')
  const notes = noteLines(report)
  if (notes.length === 0) out.push('Nic do wyjaśnienia.')
  else notes.forEach((n) => out.push(`- **${n.label}:** ${plain(n.text)}`))
  out.push('')

  reportSections(report).forEach((section, index) => {
    out.push(`## ${index + 1}. ${section.title}`, '')
    if (section.lead.length > 0) out.push(...section.lead.map((l) => `${plain(l)}`), '')
    section.tables.forEach((t) => {
      if (t.caption) out.push(`**${plain(t.caption)}**`, '')
      out.push(markdownTable(t), '')
    })
    if (section.after.length > 0) out.push(...section.after.map((l) => `- ${plain(l)}`), '')
  })

  out.push('## Dane (JSON)', '')
  const json = JSON.stringify(report, null, 2)
  let fence = '```'
  while (json.includes(fence)) fence += '`'
  out.push(`${fence}json`, json, fence, '')
  return out.join('\n')
}
