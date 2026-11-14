'use client'

/**
 * „Pobierz z KSeF" w aplikacji: ta sama synchronizacja co `npm run data -- ksef-sync`,
 * uruchamiana przyciskiem w Finanse → KSeF.
 *
 * Token „Przeglądanie faktur" leży w pęku kluczy macOS i jest czytany tylko na czas
 * logowania; nie trafia do plików ani komunikatów. Sieć i pęk kluczy obsługuje część
 * systemowa aplikacji (src-tauri/src/ksef.rs), która przepuszcza wyłącznie odczyt.
 */

import { invoke } from '@tauri-apps/api/core'
import { getLoadedCompany } from './company-settings-core'
import { ksefFetchVia } from './ksef-app-bridge'
import { createKsefClient, KsefApiError, type KsefEnvironment } from './ksef-client'
import { KSEF_FROM } from './ksef-reconcile'
import { readKsefCache, writeKsefCache } from './ksef-store'
import { KSEF_DIRECTIONS, runKsefSync, type KsefSyncProgress, type KsefSyncResult } from './ksef-sync'
import { isTauriRuntime } from './storage'

const ENVIRONMENT: KsefEnvironment = 'prod'

export type KsefAppSync =
  | { ok: true; result: KsefSyncResult }
  /** `no-nip` = trzeba podać NIP firmy; `no-token` = brak tokenu w pęku kluczy. */
  | { ok: false; reason: 'no-nip' | 'no-token' | 'error'; message: string }

export const KSEF_TOKEN_COMMAND = 'security add-generic-password -U -s nonoise-hub-ksef -a prod -w'

/** Czy przycisk może pobierać sam (aplikacja), czy tylko odświeża kopię (podgląd w przeglądarce). */
export function canSyncKsefHere(): boolean {
  return isTauriRuntime()
}

/** NIP firmy: z ustawień, a gdy tam go nie ma, z dotychczasowej kopii KSeF. */
export async function knownKsefNip(): Promise<string> {
  const fromSettings = (getLoadedCompany()?.contact?.taxId ?? '').replace(/\D/g, '')
  if (/^\d{10}$/.test(fromSettings)) return fromSettings
  for (const direction of KSEF_DIRECTIONS) {
    const { cache } = await readKsefCache(direction)
    if (cache && cache.environment === ENVIRONMENT && /^\d{10}$/.test(cache.nip)) return cache.nip
  }
  return ''
}

function explain(error: unknown): string {
  if (error instanceof KsefApiError) {
    if (error.status === 429) {
      const minutes = error.retryAfter ? Math.ceil(error.retryAfter / 60) : 60
      return `KSeF chwilowo wstrzymał zapytania (limit). Spróbuj za ok. ${minutes} min.`
    }
    if (error.status === 401 || error.status === 403) {
      return 'KSeF odrzucił token: mógł wygasnąć albo zostać unieważniony. Wygeneruj nowy z samym uprawnieniem „Przeglądanie faktur” i zapisz go w pęku kluczy.'
    }
    if (error.status >= 500) return 'KSeF ma chwilową awarię. Spróbuj za kilka minut.'
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith('KSeF') ? message : `Nie udało się pobrać faktur z KSeF (${message}).`
}

export async function syncKsefFromApp(options: { nip?: string; onProgress?: (progress: KsefSyncProgress) => void } = {}): Promise<KsefAppSync> {
  const nip = (options.nip ?? '').replace(/\D/g, '') || (await knownKsefNip())
  if (!/^\d{10}$/.test(nip)) return { ok: false, reason: 'no-nip', message: 'Podaj NIP swojej firmy (10 cyfr), żeby pobrać faktury z KSeF.' }

  let token: string
  try {
    token = await invoke<string>('ksef_token', { environment: ENVIRONMENT })
  } catch {
    return {
      ok: false,
      reason: 'no-token',
      message: 'W pęku kluczy nie ma tokenu KSeF. Wygeneruj w Aplikacji Podatnika KSeF token z samym uprawnieniem „Przeglądanie faktur” i zapisz go poleceniem w terminalu:',
    }
  }

  try {
    const client = createKsefClient({ environment: ENVIRONMENT, nip, token, fetchImpl: ksefFetchVia(invoke, ENVIRONMENT) })
    const [sale, purchase] = await Promise.all([readKsefCache('sale'), readKsefCache('purchase')])
    const result = await runKsefSync({
      client,
      environment: ENVIRONMENT,
      nip,
      from: KSEF_FROM,
      now: new Date().toISOString(),
      previous: { sale: sale.cache, purchase: purchase.cache },
      onProgress: options.onProgress,
    })
    for (const direction of KSEF_DIRECTIONS) {
      const cache = result.caches[direction]
      if (cache) await writeKsefCache(direction, cache)
    }
    return { ok: true, result }
  } catch (error) {
    return { ok: false, reason: 'error', message: explain(error) }
  }
}
