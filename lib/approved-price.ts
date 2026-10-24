/**
 * Zatwierdzona cena projektu (U1, plan §18 U-CENA, decyzje 18.3/4 i U1/1).
 * Moduł czysty — testy w `approved-price.test.ts`.
 *
 *  - Wycena / nieprzyjęta: cena idzie za PDF wybranego wariantu (albo
 *    kalkulatorem, gdy nie ma szkicu PDF) — nic nie jest jeszcze zatwierdzone.
 *  - PRZYJĘCIE ZLECENIA (status → W realizacji / Zrealizowany) zamraża sumę
 *    PDF wybranego wariantu w jego wycenie (`QuoteData.approvedPrice`). Potem
 *    zmiana PDF nie rusza ceny: Finanse pokazują „PDF: X zł · Odśwież".
 *  - WYBÓR WARIANTU w przyjętym projekcie zamraża cenę nowego wariantu (klient
 *    przyjął jego cenę); wariant, który ma już swoją cenę, ją zachowuje — dzięki
 *    temu „Cofnij" wraca co do grosza.
 *  - Kolejność przychodu planu jest w JEDNEJ funkcji: `planRevenue`
 *    (`quote-financials.ts`): kwota przelewu wpisana ręcznie → zatwierdzona cena
 *    → PDF → kalkulator.
 */

import { countsTowardRevenue, type Project, type ProjectStatus } from './project-types'
import { approvedPrice, approvedPriceRecord, computeSnapshotFinancials, freezeApprovedPrice, resolveSnapshot, type FinancialsSource } from './quote-financials'

type Snapshot = NonNullable<Project['quote']>

/**
 * Migawka z zamrożoną ceną z jej PDF (albo kalkulatora). Bez danych wyceny albo
 * z ceną już zapisaną — ta sama migawka (ten sam obiekt).
 */
export function withFrozenPrice<S extends Snapshot | null | undefined>(snapshot: S, at: string): S {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const raw = (snapshot as { data?: unknown }).data
  if (!raw || typeof raw !== 'object' || approvedPriceRecord((raw as { approvedPrice?: unknown }).approvedPrice)) return snapshot
  const resolved = resolveSnapshot(snapshot as FinancialsSource)
  if (!resolved) return snapshot
  const price = approvedPrice(resolved.data, resolved.pricing, resolved.margin, (snapshot as FinancialsSource).pdfDraft)
  return { ...snapshot, data: { ...(raw as object), approvedPrice: freezeApprovedPrice(price, at) } }
}

/** Czy zmiana statusu to przyjęcie zlecenia (z wyceny / nieprzyjętej do realizacji albo zrealizowanego). */
export function isAcceptance(from: ProjectStatus, to: ProjectStatus): boolean {
  return !countsTowardRevenue(from) && countsTowardRevenue(to)
}

/**
 * Łata zmiany statusu. Przyjęcie zlecenia zamraża cenę wybranego wariantu i
 * przelicza plan (przychód się nie zmienia — zatwierdzona cena = PDF w tej
 * chwili). Wyceny bez danych (retro-import) zmieniają tylko status.
 */
export function statusChangePatch(
  project: Pick<Project, 'status' | 'quote' | 'financials'>,
  next: ProjectStatus,
  now: Date
): Partial<Pick<Project, 'status' | 'quote' | 'financials'>> {
  if (!isAcceptance(project.status, next)) return { status: next }
  const quote = withFrozenPrice(project.quote, now.toISOString())
  if (!quote || quote === project.quote) return { status: next }
  return { status: next, quote, financials: computeSnapshotFinancials(quote as FinancialsSource, now) ?? project.financials }
}

/** Kopia wariantu bez zatwierdzonej ceny — nowy wariant ma swoją cenę z własnego PDF. */
export function withoutApprovedPrice<S extends Snapshot | null | undefined>(snapshot: S): S {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const raw = (snapshot as { data?: unknown }).data
  if (!raw || typeof raw !== 'object' || !('approvedPrice' in raw)) return snapshot
  const { approvedPrice: _dropped, ...data } = raw as Record<string, unknown>
  return { ...snapshot, data }
}
