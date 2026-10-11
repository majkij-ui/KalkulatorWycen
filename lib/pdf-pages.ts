/**
 * Cięcie wysokiego obrazu strony (html2canvas) na strony A4 — czyste funkcje.
 *
 * Ten sam algorytm co eksport oferty w aplikacji desktopowej
 * (`handleTauriExport` w `podglad-pdf.tsx`): strona kończy się na ostatniej
 * „bezpiecznej" granicy (`data-pdf-break="after"`), która się mieści; bez
 * takiej granicy — twarde cięcie. Treść kończy się na ostatniej granicy,
 * więc dolny margines kontenera nie robi pustej strony na końcu.
 *
 * Do tego linki: prostokąty elementów z `data-pdf-href` (telefon, e-mail)
 * przeliczone na milimetry strony, na której wypadły — w PDF da się kliknąć
 * numer i zadzwonić.
 */

export interface PageSlice {
  /** Początek i koniec wycinka w pikselach obrazu (od góry). */
  start: number
  end: number
}

export function planPdfPages(breaks: number[], contentHeight: number, pageHeight: number): PageSlice[] {
  const sorted = [...breaks].sort((a, b) => a - b)
  const pages: PageSlice[] = []
  if (pageHeight <= 0) return pages
  let start = 0
  while (start < contentHeight) {
    const limit = Math.min(start + pageHeight, contentHeight)
    const candidates = sorted.filter((b) => b > start && b <= limit)
    const end = candidates.length ? candidates[candidates.length - 1] : limit
    if (end - start <= 0) break
    pages.push({ start, end })
    start = end
  }
  return pages
}

/** Koniec treści: ostatnia granica sekcji, a bez granic — cała wysokość obrazu. */
export function contentHeightOf(breaks: number[], canvasHeight: number): number {
  return breaks.length ? Math.max(...breaks) : canvasHeight
}

export interface LinkBox {
  /** Prostokąt w pikselach obrazu, od lewego górnego rogu treści. */
  left: number
  top: number
  width: number
  height: number
  url: string
}

export interface PlacedLink {
  /** Numer strony od 0. */
  page: number
  /** Milimetry od lewego górnego rogu strony. */
  x: number
  y: number
  w: number
  h: number
  url: string
}

/**
 * Link trafia na stronę, na której zaczyna się jego prostokąt; część za
 * cięciem strony jest obcinana (klikalny zostaje widoczny kawałek).
 */
export function placeLinks(links: LinkBox[], pages: PageSlice[], pxPerMm: number): PlacedLink[] {
  if (pxPerMm <= 0) return []
  return links.flatMap((link) => {
    const page = pages.findIndex((p) => link.top >= p.start && link.top < p.end)
    if (page === -1) return []
    const slice = pages[page]
    const bottom = Math.min(link.top + link.height, slice.end)
    return [
      {
        page,
        x: link.left / pxPerMm,
        y: (link.top - slice.start) / pxPerMm,
        w: link.width / pxPerMm,
        h: (bottom - link.top) / pxPerMm,
        url: link.url,
      },
    ]
  })
}

/** Nazwa pliku bez znaków, których nie lubi macOS/Windows. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

/** `tel:` z numeru wpisanego po ludzku („+48 600 100 200" → „tel:+48600100200"). */
export function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '')
  return digits.replace(/\+/g, '').length >= 3 ? `tel:${digits}` : null
}

export function mailHref(email: string): string | null {
  const trimmed = email.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? `mailto:${trimmed}` : null
}
