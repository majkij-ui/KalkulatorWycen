'use client'

/**
 * Migracja: zapisane wyceny (`quotes.json`) → projekty (`projects.json`).
 *
 * Ten moduł odpowiada wyłącznie za wejście/wyjście; całe mapowanie siedzi w
 * `project-migration-core.ts` i jest pokryte testami.
 *
 * Zasady, których migrator pilnuje:
 *  1. Stara biblioteka wycen NIE jest kasowana ani modyfikowana — po migracji
 *     poprzednia wersja apki dalej otwiera swoje dane.
 *  2. Przed pierwszym zapisem powstaje kopia `quotes.backup-<data>.json`.
 *  3. Migracja jest IDEMPOTENTNA — puszczona dwa razy nie zduplikuje projektów.
 *  4. Gdy kopia zapasowa się nie uda, migracja jest PRZERYWANA — lepiej nie
 *     migrować niż ruszać dane bez siatki bezpieczeństwa.
 */

import { isTauriRuntime, writeJsonFile } from './storage'
import { listSavedQuotes, type SavedQuoteRecord } from './quote-library'
import { listProjects, replaceAllProjects } from './project-library'
import { pendingQuotes, quoteToProject } from './project-migration-core'
import { toDateKey } from './project-types'

const BACKUP_PREFIX = 'quotes.backup-'
const WEB_BACKUP_PREFIX = 'nonoise-quotes-backup-'
const MIGRATION_FLAG_KEY = 'nonoise-v3-migration-done'

export interface MigrationResult {
  status: 'migrated' | 'skipped-empty' | 'skipped-already-done' | 'aborted-no-backup'
  migratedCount: number
  skippedCount: number
  backupLocation: string | null
}

/** Kopia zapasowa biblioteki wycen. Zwraca lokalizację albo `null` przy porażce. */
async function backupQuotes(quotes: SavedQuoteRecord[]): Promise<string | null> {
  const stamp = toDateKey(new Date())
  const payload = { version: 1, backedUpAt: new Date().toISOString(), quotes }

  if (isTauriRuntime()) {
    const fileName = `${BACKUP_PREFIX}${stamp}.json`
    try {
      await writeJsonFile(fileName, payload)
      return fileName
    } catch {
      return null
    }
  }

  if (typeof window === 'undefined') return null
  const key = `${WEB_BACKUP_PREFIX}${stamp}`
  try {
    localStorage.setItem(key, JSON.stringify(payload))
    return key
  } catch {
    return null
  }
}

function markMigrationDone(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, new Date().toISOString())
  } catch {
    // brak localStorage nie może wywrócić migracji — chroni nas idempotencja
  }
}

export function isMigrationDone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return !!localStorage.getItem(MIGRATION_FLAG_KEY)
  } catch {
    return false
  }
}

/**
 * Przenosi wyceny do projektów. Bezpieczna do wywołania przy każdym starcie:
 * już przeniesione wyceny są pomijane, nowe dopisywane.
 */
export async function migrateQuotesToProjects(): Promise<MigrationResult> {
  const quotes = await listSavedQuotes()
  if (quotes.length === 0) {
    return { status: 'skipped-empty', migratedCount: 0, skippedCount: 0, backupLocation: null }
  }

  const existing = await listProjects()
  const pending = pendingQuotes(quotes, existing)

  if (pending.length === 0) {
    return {
      status: 'skipped-already-done',
      migratedCount: 0,
      skippedCount: quotes.length,
      backupLocation: null,
    }
  }

  // Kopia zapasowa PRZED jakimkolwiek zapisem — bez niej nie ruszamy danych.
  const backupLocation = await backupQuotes(quotes)
  if (!backupLocation) {
    return {
      status: 'aborted-no-backup',
      migratedCount: 0,
      skippedCount: quotes.length,
      backupLocation: null,
    }
  }

  const now = new Date()
  const migrated = pending.map((quote) => quoteToProject(quote, now))
  await replaceAllProjects([...existing, ...migrated])
  markMigrationDone()

  return {
    status: 'migrated',
    migratedCount: migrated.length,
    skippedCount: quotes.length - pending.length,
    backupLocation,
  }
}
