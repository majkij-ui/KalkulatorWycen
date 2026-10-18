'use client'

/**
 * Zapis raportu okresowego (S5) na dysk: plik Markdown z blokiem JSON i PDF.
 *
 * PDF idzie drogą call sheetu (`print-call-sheet.ts`: arkusz A4 →
 * html2canvas-pro → jsPDF → natywne „Zapisz jako…" + `writeFile`), bo
 * `window.print()` w aplikacji desktopowej (WKWebView) nie działa pewnie.
 * Markdown: ten sam dialog i ten sam `writeFile` (`fs:allow-write-file` w
 * $HOME — żadnego nowego uprawnienia); w przeglądarce zwykłe pobranie.
 */

import { exportCallSheetPdf, type CallSheetExportResult } from './print-call-sheet'
import type { PeriodReport } from './period-report'
import { reportBaseName, reportFileName, reportToMarkdown } from './period-report-markdown'
import { isTauriRuntime } from './storage'

export type ReportExportResult = CallSheetExportResult

/** PDF z ukrytego arkusza A4 (`PrintableReport`). */
export async function exportReportPdf(el: HTMLElement, report: PeriodReport): Promise<ReportExportResult> {
  return exportCallSheetPdf(el, reportBaseName(report))
}

function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Markdown: w aplikacji „Zapisz jako…", w przeglądarce pobranie pliku. */
export async function exportReportMarkdown(report: PeriodReport): Promise<ReportExportResult> {
  const fileName = reportFileName(report, 'md')
  const text = reportToMarkdown(report)

  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const chosen = await save({ defaultPath: fileName, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (!chosen) return { status: 'cancelled' }
    await writeFile(chosen, new TextEncoder().encode(text))
    return { status: 'saved', path: chosen, pages: 0 }
  }

  downloadText(text, fileName)
  return { status: 'downloaded', fileName, pages: 0 }
}
