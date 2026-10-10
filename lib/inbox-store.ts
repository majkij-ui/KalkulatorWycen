'use client'

/**
 * Odczyt skrzynki i zapis decyzji.
 *
 * `inbox/*.json` (AppData) pisze WYŁĄCZNIE Claude przez `npm run data -- inbox`;
 * aplikacja je tylko czyta i niczego w `inbox/` nie zmienia ani nie usuwa —
 * dzięki temu zapis z rozmowy nie koliduje z otwartą aplikacją. Decyzje
 * (przyjęte / odrzucone) aplikacja trzyma we własnym `inbox-decisions.json`.
 *
 * W przeglądarce (podgląd deweloperski) skrzynka to localStorage
 * `nonoise-inbox-v1`: `{ files: [{ name, content }] }` — tylko do testów UI.
 */

import { BaseDirectory, exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { isTauriRuntime } from './storage'
import { createCollectionStore } from './v3-store'
import {
  INBOX_DECISIONS_FILE,
  INBOX_DIR,
  inboxDecisionSchema,
  parseInboxFile,
  type InboxDecision,
  type ParsedInboxFile,
} from './inbox-types'

export const WEB_INBOX_KEY = 'nonoise-inbox-v1'
export const WEB_INBOX_DECISIONS_KEY = 'nonoise-inbox-decisions-v1'

/** Pliki skrzynki: `.json`, bez ukrytych (`.…tmp` to zapis w toku). */
function isInboxFileName(name: string): boolean {
  return name.endsWith('.json') && !name.startsWith('.')
}

async function readTauriInbox(): Promise<ParsedInboxFile[]> {
  let names: string[]
  try {
    if (!(await exists(INBOX_DIR, { baseDir: BaseDirectory.AppData }))) return [] // brak folderu = pusta skrzynka
    const entries = await readDir(INBOX_DIR, { baseDir: BaseDirectory.AppData })
    names = entries.filter((e) => e.isFile && isInboxFileName(e.name)).map((e) => e.name)
  } catch (error) {
    // Folder jest, a nie da się go odczytać (np. brak uprawnienia w capabilities).
    // Pokazujemy to na ekranie — cicha pusta skrzynka ukrywała propozycje.
    return [{ name: '', status: 'error', error: `nie da się odczytać folderu (${String(error)})` }]
  }
  return Promise.all(
    names.sort().map(async (name) => {
      try {
        const content = await readTextFile(`${INBOX_DIR}/${name}`, { baseDir: BaseDirectory.AppData })
        return parseInboxFile(name, JSON.parse(content))
      } catch {
        return { name, status: 'error', error: 'nie da się odczytać pliku (uszkodzony JSON?)' } as const
      }
    })
  )
}

function readWebInbox(): ParsedInboxFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(WEB_INBOX_KEY) ?? 'null') as {
      files?: { name?: unknown; content?: unknown }[]
    } | null
    return (raw?.files ?? [])
      .filter((f): f is { name: string; content: unknown } => typeof f.name === 'string' && isInboxFileName(f.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => parseInboxFile(f.name, f.content))
  } catch {
    return []
  }
}

/** Wszystkie pliki skrzynki, posortowane po nazwie (= po czasie zapisu). Nigdy nie rzuca. */
export async function readInboxFiles(): Promise<ParsedInboxFile[]> {
  return isTauriRuntime() ? readTauriInbox() : readWebInbox()
}

const decisions = createCollectionStore<InboxDecision>({
  fileName: INBOX_DECISIONS_FILE,
  webKey: WEB_INBOX_DECISIONS_KEY,
  schema: inboxDecisionSchema,
  getId: (d) => d.id,
  sort: (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
})

export const listInboxDecisions = decisions.list

/** Zapis kilku decyzji jednym zapisem pliku (np. „odrzuć wszystkie z wątku"). */
export function saveInboxDecisions(records: InboxDecision[]): Promise<InboxDecision[]> {
  const byId = new Map(records.map((r) => [r.id, r]))
  return decisions.mutate((all) => [
    ...all.map((d) => byId.get(d.id) ?? d),
    ...records.filter((r) => !all.some((d) => d.id === r.id)),
  ])
}
