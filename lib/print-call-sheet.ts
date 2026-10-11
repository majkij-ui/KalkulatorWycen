'use client'

/**
 * Eksport call sheetu do PDF (T5b).
 *
 * CallSheetWiz drukował przez ukrytą ramkę i `window.print()` (A4 z CSS).
 * W aplikacji desktopowej (Tauri, WKWebView na macOS) okno drukowania nie
 * działa pewnie, a pobieranie przez `<a download>` WKWebView blokuje — dlatego
 * idziemy tą samą drogą, którą już działa PDF oferty (`podglad-pdf.tsx`,
 * `PDF_EXPORT.md`):
 *
 *   ukryty arkusz A4 (`PrintableCallSheet`) → html2canvas-pro → jsPDF
 *   → Tauri: natywne „Zapisz jako…" (`dialog:allow-save`) + `writeFile`
 *     (`fs:allow-write-file` w $HOME — uprawnienia już są, nic nowego)
 *   → przeglądarka (podgląd deweloperski): zwykłe pobranie pliku.
 *
 * Strony tniemy na granicach `data-pdf-break="after"` (`pdf-pages.ts`), a
 * telefony i e-maile z `data-pdf-href` stają się w PDF klikalnymi linkami.
 */

import { isTauriRuntime } from './storage'
import { contentHeightOf, placeLinks, planPdfPages, safeFileName, type LinkBox } from './pdf-pages'

export type CallSheetExportResult =
  | { status: 'saved'; path: string; pages: number }
  | { status: 'downloaded'; fileName: string; pages: number }
  | { status: 'cancelled' }

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Arkusz → bajty PDF. Element musi być w DOM; na czas zdjęcia stoi poza ekranem. */
export async function renderCallSheetPdf(el: HTMLElement): Promise<{ bytes: Uint8Array; pages: number }> {
  const prevStyle = el.getAttribute('style') ?? ''
  el.setAttribute('style', 'position:absolute;left:-10000px;top:0;display:block;')
  try {
    await nextFrame()
    await nextFrame()
    if (document.fonts?.ready) await document.fonts.ready

    // html2canvas-pro rozumie oklch() z Tailwinda v4 (WKWebView oddaje kolory w oryginalnej przestrzeni).
    const html2canvas = (await import('html2canvas-pro')).default
    const { jsPDF } = await import('jspdf')
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })

    const box = el.getBoundingClientRect()
    const scale = canvas.width / box.width
    const breaks: number[] = []
    el.querySelectorAll<HTMLElement>('[data-pdf-break="after"]').forEach((node) => {
      breaks.push((node.getBoundingClientRect().bottom - box.top) * scale)
    })
    const links: LinkBox[] = []
    el.querySelectorAll<HTMLElement>('[data-pdf-href]').forEach((node) => {
      const r = node.getBoundingClientRect()
      const url = node.dataset.pdfHref
      if (!url || r.width <= 0) return
      links.push({ left: (r.left - box.left) * scale, top: (r.top - box.top) * scale, width: r.width * scale, height: r.height * scale, url })
    })

    const pdf = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const pxPerMm = canvas.width / pageW
    const pages = planPdfPages(breaks, contentHeightOf(breaks, canvas.height), pageH * pxPerMm)

    pages.forEach((slice, index) => {
      const part = document.createElement('canvas')
      part.width = canvas.width
      part.height = Math.ceil(slice.end - slice.start)
      const ctx = part.getContext('2d')
      if (!ctx) throw new Error('Brak kontekstu 2D canvas')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, part.width, part.height)
      ctx.drawImage(canvas, 0, -slice.start)
      if (index > 0) pdf.addPage()
      pdf.addImage(part.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageW, (slice.end - slice.start) / pxPerMm)
    })

    placeLinks(links, pages, pxPerMm).forEach((link) => {
      pdf.setPage(link.page + 1)
      pdf.link(link.x, link.y, link.w, link.h, { url: link.url })
    })

    return { bytes: new Uint8Array(pdf.output('arraybuffer')), pages: pages.length }
  } finally {
    el.setAttribute('style', prevStyle)
  }
}

function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
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

/** Generuje PDF i zapisuje go: w aplikacji przez „Zapisz jako…", w przeglądarce jako pobranie. */
export async function exportCallSheetPdf(el: HTMLElement, title: string): Promise<CallSheetExportResult> {
  const fileName = `${safeFileName(title) || 'Call sheet'}.pdf`
  const { bytes, pages } = await renderCallSheetPdf(el)

  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const chosen = await save({ defaultPath: fileName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!chosen) return { status: 'cancelled' }
    await writeFile(chosen, bytes)
    return { status: 'saved', path: chosen, pages }
  }

  downloadBytes(bytes, fileName)
  return { status: 'downloaded', fileName, pages }
}
