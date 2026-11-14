/**
 * Kopia faktur z KSeF w folderze danych huba: sprzedaż (`ksef/sprzedaz.json`)
 * i zakupy (`ksef/zakupy.json`).
 *
 * Pisze ją wyłącznie synchronizacja z KSeF (`ksef-sync.ts`): przycisk w
 * aplikacji albo `npm run data -- ksef-sync`. Plik jest zawsze zapisywany w
 * całości. Decyzje użytkownika leżą osobno (`ksef-decisions.json`), więc
 * kolejna synchronizacja niczego nie zaciera.
 *
 * Moduł czysty — testy w `ksef-reconcile.test.ts`.
 */

import { z } from 'zod'
import type { KsefSale } from './ksef-invoices'

export const KSEF_DIR = 'ksef'
export const KSEF_SALES_FILE = 'sprzedaz.json'
export const KSEF_PURCHASES_FILE = 'zakupy.json'
export const KSEF_CACHE_FORMAT = 'nonoise-hub-ksef'
export const KSEF_CACHE_VERSION = 1

const text = z.string().catch('')
const money = z.number().catch(0)

const lineSchema = z
  .object({
    name: text,
    unit: text,
    quantity: z.number().nullable().catch(null),
    unitPriceNet: z.number().nullable().catch(null),
    unitPriceGross: z.number().nullable().catch(null),
    amountNet: z.number().nullable().catch(null),
    amountGross: z.number().nullable().catch(null),
    vatRate: text,
  })
  .passthrough()

export const ksefSaleSchema = z
  .object({
    ksefNumber: z.string().min(1),
    invoiceNumber: text,
    direction: z.enum(['sale', 'purchase']).catch('sale'),
    issueDate: text,
    ksefDate: text,
    counterpartyName: text,
    counterpartyNip: text,
    counterpartyId: text,
    netAmount: money,
    grossAmount: money,
    vatAmount: money,
    currency: z.string().catch('PLN'),
    invoiceType: text,
    isCorrection: z.boolean().catch(false),
    hasDetails: z.boolean().optional().catch(undefined),
    details: z
      .object({
        dueDate: text,
        lines: z.array(lineSchema).catch([]),
        correctedKsefNumber: text,
        correctedNumber: text,
      })
      .passthrough(),
  })
  .passthrough()

export interface KsefCache {
  fetchedAt: string
  environment: string
  nip: string
  from: string
  /** Do tej chwili KSeF jest przejrzany; kolejna synchronizacja pyta tylko o nowsze faktury. */
  syncedTo?: string
  invoices: KsefSale[]
}

/** Odczyt wyrozumiały: uszkodzona faktura odpada, reszta zostaje. `null` = to nie jest kopia KSeF. */
export function parseKsefCache(raw: unknown): KsefCache | null {
  if (!raw || typeof raw !== 'object') return null
  const file = raw as Record<string, unknown>
  if (file.format !== KSEF_CACHE_FORMAT || typeof file.version !== 'number' || file.version > KSEF_CACHE_VERSION) return null
  const invoices = Array.isArray(file.invoices)
    ? file.invoices.flatMap((entry) => {
        const parsed = ksefSaleSchema.safeParse(entry)
        return parsed.success ? [parsed.data as KsefSale] : []
      })
    : []
  const str = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    fetchedAt: str(file.fetchedAt),
    environment: str(file.environment),
    nip: str(file.nip),
    from: str(file.from),
    ...(str(file.syncedTo) ? { syncedTo: str(file.syncedTo) } : {}),
    invoices,
  }
}

export function ksefCacheFile(cache: KsefCache) {
  return { format: KSEF_CACHE_FORMAT, version: KSEF_CACHE_VERSION, ...cache }
}
