'use client'

/**
 * Hub obok starej aplikacji (plan §5b).
 *
 * Stara aplikacja QuoteGen (`com.michal.quotegen`) zostaje zainstalowana i
 * działa dalej. Hub tylko CZYTA jej bibliotekę wycen — uprawnienia Tauri
 * pozwalają na odczyt jednego pliku i jawnie zabraniają zapisu do jej
 * katalogu. Od Q1 import uruchamia się wyłącznie przyciskiem w Ustawieniach
 * (bez sprawdzania przy starcie). Można go powtarzać: wyceny zrobione później
 * w starej aplikacji dojdą jako nowe projekty, bez duplikatów
 * (`migratedFromQuoteId`). Własnej biblioteki huba („Moje wyceny") import nie czyta.
 */

import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { isTauriRuntime, readJsonFile } from './storage'
import { coerceLibrary, readWebQuoteLibrary, sortByUpdatedDesc, type SavedQuoteRecord } from './quote-library'
import { CARRYOVER_FILE, carryOverEntries } from './carryover-core'

export const LEGACY_APP_IDENTIFIER = 'com.michal.quotegen'
const LEGACY_QUOTES_PATH = `${LEGACY_APP_IDENTIFIER}/quotes.json`
const CARRYOVER_DONE_KEY = 'nonoise-carryover-applied'

/**
 * Wyceny starej aplikacji (do importu). W przeglądarce (dev) starej aplikacji
 * nie ma — jej miejsce zajmuje biblioteka w localStorage.
 */
export async function listLegacyQuotes(): Promise<SavedQuoteRecord[]> {
  if (!isTauriRuntime()) return readWebQuoteLibrary()
  return sortByUpdatedDesc(coerceLibrary(await readJsonFile<unknown>(LEGACY_QUOTES_PATH, BaseDirectory.Data)))
}

/**
 * Przenosi ustawienia ze starej aplikacji, jeśli w katalogu huba leży plik
 * przeniesienia. Wywoływane RAZ przed startem providerów (cennik i katalog
 * realizacji czytają localStorage przy pierwszym renderze). Nigdy nie rzuca.
 */
export async function applyCarryOver(): Promise<string[]> {
  if (!isTauriRuntime() || typeof window === 'undefined') return []
  try {
    if (localStorage.getItem(CARRYOVER_DONE_KEY)) return []
    const file = await readJsonFile<unknown>(CARRYOVER_FILE)
    if (!file) return []
    const entries = carryOverEntries(file, (key) => localStorage.getItem(key) !== null)
    entries.forEach(([key, value]) => localStorage.setItem(key, value))
    localStorage.setItem(CARRYOVER_DONE_KEY, new Date().toISOString())
    return entries.map(([key]) => key)
  } catch {
    return []
  }
}
