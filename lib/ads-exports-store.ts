'use client'

/**
 * Zapis wysłanych konwersji do Google Ads — `ads-exports.json` w AppData
 * (Tauri) / localStorage (web). Wzorzec jak `campaigns-store.ts`.
 *
 * Rekordów się NIE usuwa (nie eksportujemy `remove`): cofnięcie eksportu
 * zmienia `status` na `cancelled`, a zamrożony czas konwersji zostaje do
 * ponownego pliku. Zapisy idą przez `mutate`, więc czytają plik na świeżo.
 */

import { createCollectionStore } from './v3-store'
import { adsExportRecordSchema, type AdsExportRecord } from './ads-export-types'

export const ADS_EXPORTS_FILE = 'ads-exports.json'
export const WEB_ADS_EXPORTS_KEY = 'nonoise-ads-exports-v1'

/** Najnowszy eksport u góry. */
function byExportedDesc(a: AdsExportRecord, b: AdsExportRecord): number {
  return b.exportedAt.localeCompare(a.exportedAt) || a.id.localeCompare(b.id)
}

const store = createCollectionStore<AdsExportRecord>({
  fileName: ADS_EXPORTS_FILE,
  webKey: WEB_ADS_EXPORTS_KEY,
  schema: adsExportRecordSchema,
  getId: (r) => r.id,
  sort: byExportedDesc,
})

export const listAdsExports = store.list

export function createAdsExportId(): string {
  return `adx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Dopisuje rekordy (np. `pending` po zapisaniu pliku). */
export function appendAdsExports(records: AdsExportRecord[]): Promise<AdsExportRecord[]> {
  return store.mutate((current) => [...current, ...records])
}

/** Zmienia status wszystkich rekordów `pending` jednego eksportu (`exportedAt`). */
export function resolveAdsExport(
  exportedAt: string,
  status: 'confirmed' | 'cancelled',
  now: string = new Date().toISOString()
): Promise<AdsExportRecord[]> {
  return store.mutate((current) =>
    current.map((r) =>
      r.exportedAt === exportedAt && r.status === 'pending'
        ? { ...r, status, ...(status === 'confirmed' ? { confirmedAt: now } : { cancelledAt: now }) }
        : r
    )
  )
}
