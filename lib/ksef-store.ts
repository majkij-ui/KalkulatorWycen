'use client'

/**
 * Odczyt kopii KSeF i zapis decyzji ekranu „Zgodność z KSeF".
 *
 * `ksef/sprzedaz.json` i `ksef/zakupy.json` pisze tylko `npm run data -- ksef-sync`;
 * aplikacja je czyta. Decyzje (faktura przypisana ręcznie, projekt bez faktury) aplikacja
 * trzyma we własnym `ksef-decisions.json`.
 *
 * W przeglądarce (podgląd deweloperski) kopia to localStorage `nonoise-ksef-v1`.
 */

import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs'
import { isTauriRuntime } from './storage'
import { createCollectionStore } from './v3-store'
import { KSEF_DIR, KSEF_PURCHASES_FILE, KSEF_SALES_FILE, parseKsefCache, type KsefCache } from './ksef-cache'
import type { KsefDirection } from './ksef-invoices'
import { KSEF_DECISIONS_FILE, ksefDecisionSchema, type KsefDecision } from './ksef-reconcile'

export const WEB_KSEF_KEY = 'nonoise-ksef-v1'
export const WEB_KSEF_PURCHASES_KEY = 'nonoise-ksef-purchases-v1'
export const WEB_KSEF_DECISIONS_KEY = 'nonoise-ksef-decisions-v1'

/** `null` = jeszcze nie pobrano faktur (albo pliku nie da się odczytać — wtedy `error`). */
export async function readKsefCache(direction: KsefDirection = 'sale'): Promise<{ cache: KsefCache | null; error?: string }> {
  try {
    if (!isTauriRuntime()) {
      const raw = typeof window === 'undefined' ? null : localStorage.getItem(direction === 'sale' ? WEB_KSEF_KEY : WEB_KSEF_PURCHASES_KEY)
      return { cache: raw ? parseKsefCache(JSON.parse(raw)) : null }
    }
    const path = `${KSEF_DIR}/${direction === 'sale' ? KSEF_SALES_FILE : KSEF_PURCHASES_FILE}`
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return { cache: null }
    const cache = parseKsefCache(JSON.parse(await readTextFile(path, { baseDir: BaseDirectory.AppData })))
    return cache ? { cache } : { cache: null, error: 'plik kopii KSeF ma nieznany format' }
  } catch (error) {
    return { cache: null, error: `nie da się odczytać kopii KSeF (${String(error)})` }
  }
}

const decisions = createCollectionStore<KsefDecision>({
  fileName: KSEF_DECISIONS_FILE,
  webKey: WEB_KSEF_DECISIONS_KEY,
  schema: ksefDecisionSchema,
  getId: (decision) => decision.id,
})

export const listKsefDecisions = decisions.list
export const upsertKsefDecision = decisions.upsert
export const removeKsefDecision = decisions.remove
