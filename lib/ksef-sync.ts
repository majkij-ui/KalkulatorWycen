/**
 * Jedna synchronizacja kopii faktur z KSeF: lista nowych faktur (sprzedaż i
 * zakupy) i treść tych, które jej jeszcze nie mają.
 *
 * Wspólna dla przycisku w aplikacji (Finanse → KSeF) i polecenia
 * `npm run data -- ksef-sync`. Moduł czysty: nie czyta ani nie zapisuje plików,
 * dostaje poprzednią kopię i oddaje nową. Testy w `ksef-sync.test.ts`.
 */

import type { KsefCache } from './ksef-cache'
import { KsefApiError } from './ksef-client'
import { EMPTY_DETAILS, parseInvoiceXml, type KsefDirection, type KsefInvoice, type KsefSale } from './ksef-invoices'

export const KSEF_DIRECTIONS = ['sale', 'purchase'] as const

/** Poniżej godzinowego limitu KSeF (64 pobrania treści), z zapasem na ponowne próby. */
export const KSEF_DOWNLOADS_PER_RUN = 55
/** Kolejna synchronizacja cofa się o tyle, żeby nie zgubić faktury zapisanej z opóźnieniem. */
const SYNC_OVERLAP_MS = 2 * 86_400_000

export interface KsefSyncClient {
  listInvoices(params: { direction: KsefDirection; from: string; to: string }): Promise<KsefInvoice[]>
  getInvoiceXml(ksefNumber: string): Promise<string>
}

export type KsefSyncProgress =
  | { step: 'listing'; direction: KsefDirection }
  | { step: 'listed'; direction: KsefDirection; total: number; fresh: number }
  | { step: 'details-plan'; planned: number; postponed: number }
  | { step: 'details'; done: number; planned: number }
  /** KSeF odmówił (limit na godzinę): `done`/`planned` tylko przy treści faktur. */
  | { step: 'limited'; what: 'list' | 'details'; direction?: KsefDirection; minutes: number; done?: number; planned?: number }

export interface KsefSyncInput {
  client: KsefSyncClient
  environment: string
  nip: string
  /** Początek pierwszego pobrania, RRRR-MM-DD. */
  from: string
  /** Pytaj o cały zakres od `from`, mimo że poprzednia kopia sięga dalej. */
  fullRange?: boolean
  /** Chwila synchronizacji, ISO 8601. */
  now: string
  previous: Record<KsefDirection, KsefCache | null>
  /** Tylko lista, bez pobierania treści (próba na sucho). */
  skipDetails?: boolean
  maxDownloads?: number
  onProgress?: (progress: KsefSyncProgress) => void
}

export interface KsefSyncResult {
  /** Kopie do zapisania; `null` = nie ma czego zapisywać (lista niepobrana i brak wcześniejszej kopii). */
  caches: Record<KsefDirection, KsefCache | null>
  /** Faktury, których nie było w poprzedniej kopii. */
  fresh: Record<KsefDirection, number>
  /** Czy KSeF oddał listę; `false` = limit, zostaje stara. */
  listed: Record<KsefDirection, boolean>
  /** Treści faktur pobrane w tym przebiegu. */
  downloaded: number
  /** Faktury wciąż bez treści (przyjdą przy następnym przebiegu). */
  waiting: number
  /** Za ile minut KSeF pozwoli pobierać dalej; `null` = bez przeszkód. */
  retryInMinutes: number | null
}

export async function runKsefSync(input: KsefSyncInput): Promise<KsefSyncResult> {
  const { client, environment, nip, from, now, previous } = input
  const report = input.onProgress ?? (() => {})
  const known = { sale: new Map<string, KsefSale>(), purchase: new Map<string, KsefSale>() }
  /** Do kiedy lista jest przejrzana; zostaje stara data, gdy KSeF odmówił listy (limit). */
  const syncedTo: Record<KsefDirection, string | undefined> = { sale: undefined, purchase: undefined }
  const fresh = { sale: 0, purchase: 0 }
  const listed = { sale: false, purchase: false }
  let retryInMinutes: number | null = null

  /** Limit godzinowy nie przerywa synchronizacji: to, co już jest, zostaje. Inny błąd leci dalej. */
  const limitMinutes = (error: unknown): number => {
    if (!(error instanceof KsefApiError) || error.status !== 429) throw error
    const minutes = error.retryAfter ? Math.ceil(error.retryAfter / 60) : 60
    retryInMinutes = Math.max(retryInMinutes ?? 0, minutes)
    return minutes
  }

  for (const direction of KSEF_DIRECTIONS) {
    // Kopia z innego środowiska (np. próba na danych testowych) albo innej firmy nie miesza się z tą.
    const saved = previous[direction]
    const usable = saved && saved.environment === environment && saved.nip === nip ? saved : null
    usable?.invoices.forEach((invoice) => known[direction].set(invoice.ksefNumber, invoice))
    // Przyrostowo: tylko to, co KSeF zapisał od poprzedniego przebiegu (limit: 20 zapytań o listę na godzinę).
    const since =
      usable?.syncedTo && !input.fullRange
        ? new Date(Date.parse(usable.syncedTo) - SYNC_OVERLAP_MS).toISOString()
        : `${from}T00:00:00+01:00`
    syncedTo[direction] = usable?.syncedTo
    report({ step: 'listing', direction })
    let invoices: KsefInvoice[]
    try {
      invoices = await client.listInvoices({ direction, from: since, to: now })
    } catch (error) {
      report({ step: 'limited', what: 'list', direction, minutes: limitMinutes(error) })
      continue
    }
    syncedTo[direction] = now
    listed[direction] = true
    invoices.forEach((invoice) => {
      const before = known[direction].get(invoice.ksefNumber)
      if (!before) fresh[direction] += 1
      known[direction].set(
        invoice.ksefNumber,
        before ? { ...before, ...invoice } : { ...invoice, details: EMPTY_DETAILS, hasDetails: false },
      )
    })
    report({ step: 'listed', direction, total: known[direction].size, fresh: fresh[direction] })
  }

  // Treść faktur (termin płatności, pozycje, korygowana faktura): najpierw sprzedaż. KSeF wydaje
  // najwyżej 64 faktury na godzinę, więc reszta przyjdzie przy kolejnej synchronizacji.
  const withoutDetails = () =>
    KSEF_DIRECTIONS.flatMap((direction) =>
      [...known[direction].values()].filter((invoice) => invoice.hasDetails === false).map((invoice) => ({ direction, invoice })),
    )
  const batch = withoutDetails().slice(0, input.maxDownloads ?? KSEF_DOWNLOADS_PER_RUN)
  report({ step: 'details-plan', planned: batch.length, postponed: withoutDetails().length - batch.length })
  let downloaded = 0
  if (!input.skipDetails) {
    try {
      for (const { direction, invoice } of batch) {
        const { hasDetails: _waiting, ...rest } = invoice
        const details = parseInvoiceXml(await client.getInvoiceXml(invoice.ksefNumber))
        known[direction].set(invoice.ksefNumber, { ...rest, details })
        downloaded += 1
        report({ step: 'details', done: downloaded, planned: batch.length })
      }
    } catch (error) {
      report({ step: 'limited', what: 'details', minutes: limitMinutes(error), done: downloaded, planned: batch.length })
    }
  }

  const cacheOf = (direction: KsefDirection): KsefCache | null => {
    const invoices = [...known[direction].values()].sort(
      (a, b) => a.ksefDate.localeCompare(b.ksefDate) || a.ksefNumber.localeCompare(b.ksefNumber),
    )
    // Pusty plik udawałby „brak faktur", choć KSeF nie oddał listy.
    if (!syncedTo[direction] && invoices.length === 0) return null
    return { fetchedAt: now, environment, nip, from, ...(syncedTo[direction] ? { syncedTo: syncedTo[direction] } : {}), invoices }
  }

  return {
    caches: { sale: cacheOf('sale'), purchase: cacheOf('purchase') },
    fresh,
    listed,
    downloaded,
    waiting: withoutDetails().length,
    retryInMinutes,
  }
}
