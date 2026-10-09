'use client'

/**
 * Wydarzenia osi czasu — `events.json` w AppData (Tauri) / localStorage (web).
 *
 * Usuwanie jest MIĘKKIE: `softDeleteEvent` stawia `deletedAt`, rekord zostaje
 * w pliku. Dzięki temu ponowny import z Gmaila nie wskrzesza odrzuconych
 * propozycji (dedup po `source.ref` widzi też usunięte), a pomyłkę da się
 * cofnąć. Widoki używają `listEvents` — bez usuniętych.
 */

import { createCollectionStore } from './v3-store'
import { createEventId, eventSchema, type EventSource, type TimelineEvent } from './event-types'

export const EVENTS_FILE = 'events.json'
export const WEB_EVENTS_KEY = 'nonoise-events-v1'

/** Chronologicznie; w obrębie dnia stabilnie po id. */
function byStart(a: TimelineEvent, b: TimelineEvent): number {
  return a.start.localeCompare(b.start) || a.id.localeCompare(b.id)
}

const store = createCollectionStore<TimelineEvent>({
  fileName: EVENTS_FILE,
  webKey: WEB_EVENTS_KEY,
  schema: eventSchema,
  getId: (e) => e.id,
  sort: byStart,
})

/** Wszystkie rekordy, łącznie z usuniętymi — dla importu i kopii zapasowych. */
export const listAllEvents = store.list
export const readRawEvents = store.readRaw

/** Wydarzenia widoczne w aplikacji (bez usuniętych). */
export async function listEvents(): Promise<TimelineEvent[]> {
  return (await store.list()).filter((e) => !e.deletedAt)
}

export async function listProjectEvents(projectId: string): Promise<TimelineEvent[]> {
  return (await listEvents()).filter((e) => e.projectId === projectId)
}

/** Zapis z aktualizacją `updatedAt`. Zwraca pełną kolekcję (z usuniętymi). */
export async function saveEvent(event: TimelineEvent): Promise<TimelineEvent[]> {
  return store.upsert({ ...event, updatedAt: new Date().toISOString() })
}

/** Ta sama zmiana dla wielu rekordów — jeden odczyt i jeden zapis pliku. */
function patchEvents(ids: string[], patch: Partial<TimelineEvent>): Promise<TimelineEvent[]> {
  const wanted = new Set(ids)
  const updatedAt = new Date().toISOString()
  return store.mutate((all) => all.map((e) => (wanted.has(e.id) ? { ...e, ...patch, updatedAt } : e)))
}

export function softDeleteEvent(id: string): Promise<TimelineEvent[]> {
  return patchEvents([id], { deletedAt: new Date().toISOString() })
}

export function restoreEvent(id: string): Promise<TimelineEvent[]> {
  return patchEvents([id], { deletedAt: undefined })
}

/**
 * Miękkie usunięcie wielu wydarzeń naraz (np. wątku usuniętego projektu).
 * `deletedAt` jawnie — ten sam znacznik co na projekcie pozwala potem
 * przywrócić dokładnie te wydarzenia, które zniknęły razem z nim.
 */
export function softDeleteEvents(ids: string[], deletedAt: string): Promise<TimelineEvent[]> {
  return patchEvents(ids, { deletedAt })
}

export function restoreEvents(ids: string[]): Promise<TimelineEvent[]> {
  return patchEvents(ids, { deletedAt: undefined })
}

export function createEvent(params: {
  kind: string
  start: string
  projectId?: string | null
  end?: string
  title?: string
  notes?: string
  data?: Record<string, unknown>
  source?: EventSource
}): TimelineEvent {
  const now = new Date().toISOString()
  return {
    id: createEventId(),
    kind: params.kind,
    projectId: params.projectId ?? null,
    start: params.start,
    end: params.end && params.end !== params.start ? params.end : undefined,
    title: params.title ?? '',
    notes: params.notes ?? '',
    data: params.data ?? {},
    source: params.source ?? { type: 'manual' },
    createdAt: now,
    updatedAt: now,
  }
}
