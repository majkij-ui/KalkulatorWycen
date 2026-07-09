'use client'

/**
 * Biblioteka zapisanych wycen ("save game / load game").
 *
 * Wszystkie nazwane wyceny trzymamy w JEDNYM pliku `quotes.json` w katalogu
 * danych aplikacji (Tauri AppData) — bez dialogów plikowych i bez szukania
 * JSON-ów po dysku. W przeglądarce (dev) używamy localStorage.
 *
 * Jeden plik zamiast katalogu per-wycena = zero dodatkowych uprawnień fs
 * (odczyt/zapis $APPDATA jest już w capabilities) i trywialny listing.
 */

import { isTauriRuntime, readJsonFile, writeJsonFile } from './storage'
import type { QuoteData } from './quote-types'
import type { PricingConfigShape } from './pricing-config'

/** Snapshot pełnego stanu wyceny — ten sam kształt co eksport/import pliku JSON. */
export interface QuoteSnapshot {
  version: 2
  savedAt: string
  data: QuoteData
  pricingConfig: PricingConfigShape
  marginMultiplier: number
  pdfDraft: unknown
}

export interface SavedQuoteRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  snapshot: QuoteSnapshot
}

interface QuotesLibraryFile {
  version: 1
  quotes: SavedQuoteRecord[]
}

const QUOTES_FILE = 'quotes.json'
const WEB_QUOTES_KEY = 'nonoise-quotes-library-v1'

export function createQuoteId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function sortByUpdatedDesc(quotes: SavedQuoteRecord[]): SavedQuoteRecord[] {
  return [...quotes].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

function coerceLibrary(raw: unknown): SavedQuoteRecord[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as QuotesLibraryFile).quotes
  if (!Array.isArray(list)) return []
  return list.filter(
    (q): q is SavedQuoteRecord =>
      !!q &&
      typeof q === 'object' &&
      typeof (q as SavedQuoteRecord).id === 'string' &&
      typeof (q as SavedQuoteRecord).name === 'string' &&
      !!(q as SavedQuoteRecord).snapshot
  )
}

function readWebLibrary(): SavedQuoteRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(WEB_QUOTES_KEY)
    if (!raw) return []
    return coerceLibrary(JSON.parse(raw))
  } catch {
    return []
  }
}

function writeWebLibrary(quotes: SavedQuoteRecord[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WEB_QUOTES_KEY, JSON.stringify({ version: 1, quotes } satisfies QuotesLibraryFile))
  } catch {
    // quota / private mode — ignore
  }
}

export async function listSavedQuotes(): Promise<SavedQuoteRecord[]> {
  if (isTauriRuntime()) {
    const file = await readJsonFile<QuotesLibraryFile>(QUOTES_FILE)
    return sortByUpdatedDesc(coerceLibrary(file))
  }
  return sortByUpdatedDesc(readWebLibrary())
}

async function writeLibrary(quotes: SavedQuoteRecord[]): Promise<void> {
  if (isTauriRuntime()) {
    await writeJsonFile<QuotesLibraryFile>(QUOTES_FILE, { version: 1, quotes })
    return
  }
  writeWebLibrary(quotes)
}

/** Dodaje nową wycenę lub nadpisuje istniejącą (po `record.id`). Zwraca posortowaną listę. */
export async function upsertSavedQuote(record: SavedQuoteRecord): Promise<SavedQuoteRecord[]> {
  const current = await listSavedQuotes()
  const idx = current.findIndex((q) => q.id === record.id)
  const next = idx === -1 ? [...current, record] : current.map((q) => (q.id === record.id ? record : q))
  const sorted = sortByUpdatedDesc(next)
  await writeLibrary(sorted)
  return sorted
}

export async function deleteSavedQuote(id: string): Promise<SavedQuoteRecord[]> {
  const current = await listSavedQuotes()
  const next = current.filter((q) => q.id !== id)
  await writeLibrary(next)
  return next
}
