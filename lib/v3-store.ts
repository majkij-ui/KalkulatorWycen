/**
 * Wspólny fundament zapisu dla kolekcji v3 (projekty, sprzęt, koszty stałe).
 *
 * Powtarza dualność z `quote-library.ts`: w Tauri jeden plik JSON w AppData,
 * w przeglądarce localStorage. Zamiast kopiować ten sam kod trzy razy, każda
 * kolekcja dostaje typowane repozytorium z `createCollectionStore`.
 *
 * Parsowanie jest ZAWSZE defensywne: pojedynczy uszkodzony rekord jest
 * pomijany, a reszta kolekcji wczytuje się normalnie. Nic nigdy nie rzuca —
 * awaria odczytu daje pustą listę, nie biały ekran.
 */

import type { z } from 'zod'
import { isTauriRuntime, readJsonFile, writeJsonFile } from './storage'
import { PROJECT_SCHEMA_VERSION } from './project-types'

interface CollectionFile<T> {
  version: number
  items: T[]
}

export interface CollectionStore<T> {
  list: () => Promise<T[]>
  replaceAll: (items: T[]) => Promise<T[]>
  upsert: (item: T) => Promise<T[]>
  remove: (id: string) => Promise<T[]>
  /**
   * Odczyt–zmiana–zapis jako jedna operacja w kolejce (np. miękkie usunięcie
   * wielu rekordów naraz). `change` dostaje świeżo odczytaną kolekcję.
   */
  mutate: (change: (items: T[]) => T[]) => Promise<T[]>
  /** Surowa zawartość pliku — na potrzeby migracji i kopii zapasowych. */
  readRaw: () => Promise<unknown>
}

export interface CollectionConfig<T> {
  /** Nazwa pliku w AppData (Tauri). */
  fileName: string
  /** Klucz localStorage (web). */
  webKey: string
  /**
   * Schemat pojedynczego rekordu. Typ wejścia celowo luźny: schematy używają
   * `.catch()`, więc ich Input różni się od Output, a i tak karmimy je surowym
   * JSON-em z dysku.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<T, z.ZodTypeDef, any>
  /** Wyciąga id rekordu (do upsert/remove). */
  getId: (item: T) => string
  /** Opcjonalne sortowanie zwracanej listy. */
  sort?: (a: T, b: T) => number
}

function readWeb(webKey: string): unknown {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(webKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeWeb<T>(webKey: string, payload: CollectionFile<T>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(webKey, JSON.stringify(payload))
  } catch {
    // quota / tryb prywatny — pomijamy, tak jak w quote-library
  }
}

export function createCollectionStore<T>(config: CollectionConfig<T>): CollectionStore<T> {
  const { fileName, webKey, schema, getId, sort } = config

  /** Odrzuca wyłącznie rekordy, których nie da się odczytać — resztę zachowuje. */
  function coerce(raw: unknown): T[] {
    if (!raw || typeof raw !== 'object') return []
    const list = (raw as CollectionFile<unknown>).items
    if (!Array.isArray(list)) return []
    const out: T[] = []
    list.forEach((entry) => {
      const parsed = schema.safeParse(entry)
      if (parsed.success) out.push(parsed.data)
    })
    return sort ? [...out].sort(sort) : out
  }

  async function readRaw(): Promise<unknown> {
    return isTauriRuntime() ? await readJsonFile<unknown>(fileName) : readWeb(webKey)
  }

  async function list(): Promise<T[]> {
    return coerce(await readRaw())
  }

  async function write(items: T[]): Promise<T[]> {
    const sorted = sort ? [...items].sort(sort) : items
    const payload: CollectionFile<T> = { version: PROJECT_SCHEMA_VERSION, items: sorted }
    if (isTauriRuntime()) {
      await writeJsonFile<CollectionFile<T>>(fileName, payload)
    } else {
      writeWeb(webKey, payload)
    }
    return sorted
  }

  /**
   * Zapisy jeden po drugim. Każdy zapis to „odczytaj plik → zmień → zapisz
   * całość", więc dwa nakładające się zapisy (autozapis notatek tuż po zmianie
   * statusu, kilka wydarzeń naraz) gubiłyby nawzajem swoje zmiany.
   */
  let queue: Promise<unknown> = Promise.resolve()
  function exclusive<R>(operation: () => Promise<R>): Promise<R> {
    const run = queue.then(operation, operation)
    queue = run.catch(() => undefined)
    return run
  }

  const mutate = (change: (items: T[]) => T[]) => exclusive(async () => write(change(await list())))

  return {
    list,
    readRaw,
    replaceAll: (items: T[]) => exclusive(() => write(items)),
    mutate,
    upsert(item: T) {
      const id = getId(item)
      return mutate((current) =>
        current.some((e) => getId(e) === id) ? current.map((e) => (getId(e) === id ? item : e)) : [...current, item]
      )
    },
    remove(id: string) {
      return mutate((current) => current.filter((e) => getId(e) !== id))
    },
  }
}
