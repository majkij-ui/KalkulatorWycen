'use client'

/**
 * Ustawienia firmy (`company.json`, F1) — odczyt przy starcie i zapis zmian.
 * Część czysta, schemat i pamięć: `company-settings-core.ts`.
 *
 *  - plik jest → wczytujemy go do pamięci; gettery czytają z pamięci,
 *  - pliku nie ma → tworzymy go z kluczy localStorage (raz; klucze zostają),
 *  - plik jest, ale nieczytelny → NIE nadpisujemy go; aplikacja działa po
 *    staremu na localStorage i pokazuje komunikat,
 *  - zapis nie wyszedł → zmiana zostaje w pamięci (i w localStorage), komunikat.
 *
 * W przeglądarce (podgląd) „plik" to klucz localStorage `nonoise-company-v1`.
 */

import { BaseDirectory, exists } from '@tauri-apps/plugin-fs'
import { createCollectionStore } from './v3-store'
import { isTauriRuntime } from './storage'
import { pushNotice } from './app-notices'
import {
  applyCompanyPatch,
  COMPANY_FILE,
  COMPANY_ID,
  companyFromLegacy,
  companySchema,
  pickCompany,
  setLoadedCompany,
  WEB_COMPANY_KEY,
  type CompanyPatch,
  type CompanySettings,
} from './company-settings-core'

const store = createCollectionStore<CompanySettings>({
  fileName: COMPANY_FILE,
  webKey: WEB_COMPANY_KEY,
  schema: companySchema,
  getId: (c) => c.id,
})

export type CompanyLoadStatus = 'loaded' | 'migrated' | 'unreadable' | 'write-failed' | 'skipped'

let status: CompanyLoadStatus = 'skipped'

/** Jak poszło wczytanie przy starcie (Ustawienia). */
export function companyLoadStatus(): CompanyLoadStatus {
  return status
}

async function fileExists(): Promise<boolean> {
  if (isTauriRuntime()) return exists(COMPANY_FILE, { baseDir: BaseDirectory.AppData })
  return localStorage.getItem(WEB_COMPANY_KEY) !== null
}

function persist(patch: CompanyPatch): void {
  void store
    .mutate((items) => {
      const fresh = items.find((c) => c.id === COMPANY_ID)
      const now = new Date().toISOString()
      const next = fresh
        ? applyCompanyPatch(fresh, patch, now)
        : applyCompanyPatch({ id: COMPANY_ID, createdAt: now, updatedAt: now }, patch, now)
      return [...items.filter((c) => c.id !== COMPANY_ID), next]
    })
    .catch((error) => {
      console.error('[ustawienia firmy] zapis company.json nie powiódł się', error)
      pushNotice(
        'company-write',
        'Nie udało się zapisać ustawień firmy do pliku company.json. Zmiana działa do zamknięcia aplikacji; spróbuj zapisać ponownie.'
      )
    })
}

/**
 * Wczytuje `company.json` do pamięci (albo tworzy go z localStorage).
 * Wywoływane RAZ przed startem providerów. Nigdy nie rzuca.
 */
export async function loadCompanySettings(): Promise<CompanyLoadStatus> {
  if (typeof window === 'undefined') return (status = 'skipped')
  try {
    if (await fileExists()) {
      const company = pickCompany(await store.list())
      if (!company) {
        setLoadedCompany(null, null)
        pushNotice(
          'company-read',
          'Nie udało się odczytać pliku company.json (ustawienia firmy). Plik zostaje nietknięty; do czasu naprawy teksty PDF, katalog realizacji i domyślny cennik działają z pamięci okna.'
        )
        return (status = 'unreadable')
      }
      setLoadedCompany(company, persist)
      return (status = 'loaded')
    }

    const { company, keys, unreadable } = companyFromLegacy((key) => localStorage.getItem(key), new Date().toISOString())
    if (unreadable.length) console.warn('[ustawienia firmy] pominięte nieczytelne klucze:', unreadable)
    await store.replaceAll([company])
    setLoadedCompany(company, persist)
    if (keys.length) console.info('[ustawienia firmy] utworzono company.json z:', keys)
    return (status = 'migrated')
  } catch (error) {
    console.error('[ustawienia firmy] company.json niedostępny', error)
    setLoadedCompany(null, null)
    pushNotice(
      'company-read',
      'Nie udało się utworzyć ani odczytać pliku company.json. Teksty PDF, katalog realizacji i domyślny cennik działają z pamięci okna, jak dotąd.'
    )
    return (status = 'write-failed')
  }
}
