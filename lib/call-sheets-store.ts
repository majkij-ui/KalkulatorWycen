'use client'

/**
 * Zapis call sheetów (T5b): `call-sheets.json` w AppData (Tauri) albo
 * localStorage (web), przez ten sam `createCollectionStore` co reszta huba.
 *
 * Call sheetu nie usuwa się na twardo: `deletedAt`, a „Cofnij" go zdejmuje.
 * Zapis jednego call sheetu czyta plik na świeżo (kolejka zapisów w
 * `v3-store.ts`), więc nie nadpisze innego call sheetu zapisanego w tym czasie.
 */

import { createCollectionStore } from './v3-store'
import { callSheetSchema, type CallSheet } from './call-sheet-types'

export const CALL_SHEETS_FILE = 'call-sheets.json'
export const WEB_CALL_SHEETS_KEY = 'nonoise-call-sheets-v1'

const store = createCollectionStore<CallSheet>({
  fileName: CALL_SHEETS_FILE,
  webKey: WEB_CALL_SHEETS_KEY,
  schema: callSheetSchema,
  getId: (sheet) => sheet.id,
  sort: (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
})

/** Wszystkie call sheety, z usuniętymi. */
export const listAllCallSheets = store.list

export function saveCallSheet(sheet: CallSheet): Promise<CallSheet[]> {
  return store.upsert({ ...sheet, updatedAt: new Date().toISOString() })
}

export function softDeleteCallSheet(id: string, deletedAt: string): Promise<CallSheet[]> {
  return store.mutate((all) => all.map((s) => (s.id === id ? { ...s, deletedAt, updatedAt: deletedAt } : s)))
}

export function restoreCallSheet(id: string): Promise<CallSheet[]> {
  const updatedAt = new Date().toISOString()
  return store.mutate((all) =>
    all.map((s) => {
      if (s.id !== id) return s
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { deletedAt, ...rest } = s
      return { ...rest, updatedAt }
    })
  )
}
