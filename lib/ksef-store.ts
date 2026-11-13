'use client'

/**
 * Odczyt kopii KSeF i zapis decyzji ekranu „Zgodność z KSeF".
 *
 * `ksef/sprzedaz.json` pisze tylko `npm run data -- ksef-sync`; aplikacja ją
 * czyta. Decyzje (faktura przypisana ręcznie, projekt bez faktury) aplikacja
 * trzyma we własnym `ksef-decisions.json`.
 *
 * W przeglądarce (podgląd deweloperski) kopia to localStorage `nonoise-ksef-v1`.
 */

import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs'
import { isTauriRuntime } from './storage'
import { createCollectionStore } from './v3-store'
import { KSEF_DIR, KSEF_SALES_FILE, parseKsefCache, type KsefCache } from './ksef-cache'
import { ksefDecisionSchema, type KsefDecision } from './ksef-reconcile'

export const WEB_KSEF_KEY = 'nonoise-ksef-v1'
export const KSEF_DECISIONS_FILE = 'ksef-decisions.json'
export const WEB_KSEF_DECISIONS_KEY = 'nonoise-ksef-decisions-v1'

/** `null` = jeszcze nie pobrano faktur (albo pliku nie da się odczytać — wtedy `error`). */
export async function readKsefCache(): Promise<{ cache: KsefCache | null; error?: string }> {
  try {
    if (!isTauriRuntime()) {
      const raw = typeof window === 'undefined' ? null : localStorage.getItem(WEB_KSEF_KEY)
      return { cache: raw ? parseKsefCache(JSON.parse(raw)) : null }
    }
    const path = `${KSEF_DIR}/${KSEF_SALES_FILE}`
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
