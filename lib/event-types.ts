/**
 * Wydarzenie na osi czasu — jeden datowany fakt z wątku projektu („lead
 * przyszedł", „dzień zdjęciowy", „faktura opłacona") albo z życia firmy
 * („zakup sprzętu"). Kalendarz, strona projektu i finanse czytają te same
 * wydarzenia; statystyki są z nich WYLICZANE, nigdy zapisywane.
 *
 * Schemat jest celowo wyrozumiały, bo dane mają ewoluować bez migracji
 * (patrz docs/PLAN-CALENDAR-AND-THREADS.md §3.4):
 *
 *  - `kind` to dowolny string, nie enum — typ zapisany przez nowszą wersję
 *    aplikacji przeżywa odczyt i zapis w starszej.
 *  - `data` to otwarty rekord; walidacja per typ dzieje się przy ODCZYCIE
 *    (`eventData` w event-kinds.ts) i nigdy nie zmienia tego, co zapisane.
 *  - `.passthrough()` — nieznane pola rekordu zostają. `z.object` domyślnie
 *    je obcina, co już raz kosztowało nas idempotencję migracji.
 *  - Jedynym powodem odrzucenia rekordu jest brak `id`. Bez id nie da się go
 *    zaktualizować, a wszystko inne lepiej pokazać jako „do poprawy" niż zgubić
 *    przy następnym zapisie kolekcji.
 *  - Usuwanie jest miękkie (`deletedAt`): ponowny import z Gmaila nie wskrzesza
 *    usuniętych propozycji, a pomyłkę da się cofnąć.
 *
 * Moduł czysty — bez Tauri/React.
 */

import { z } from 'zod'

/** `YYYY-MM-DD` albo `YYYY-MM-DDTHH:mm` (czas lokalny, bez strefy). */
export const EVENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

export function isEventDate(value: unknown): value is string {
  return typeof value === 'string' && EVENT_DATE_PATTERN.test(value)
}

/** Skąd pochodzi wydarzenie. `ref` = id wiadomości/wątku Gmaila (deduplikacja importu). */
export const eventSourceSchema = z
  .object({
    type: z.string().min(1).catch('manual'),
    ref: z.string().optional().catch(undefined),
  })
  .passthrough()

export type EventSource = z.infer<typeof eventSourceSchema>

export const eventSchema = z
  .object({
    id: z.string().min(1),
    /** Klucz z rejestru `event-kinds.ts`; nieznany = grupa „inne". */
    kind: z.string().catch('note'),
    /** `null` = wydarzenie firmowe (zakup sprzętu, marketing). */
    projectId: z.string().min(1).nullable().catch(null),
    /** Pusty = niepoprawna data; rekord zostaje, ale nie trafia do kalendarza. */
    start: z.string().regex(EVENT_DATE_PATTERN).catch(''),
    /** Ostatni dzień WŁĄCZNIE; brak = wydarzenie jednodniowe. */
    end: z.string().regex(EVENT_DATE_PATTERN).optional().catch(undefined),
    title: z.string().catch(''),
    notes: z.string().catch(''),
    data: z.record(z.unknown()).catch({}),
    source: eventSourceSchema.catch({ type: 'manual' }),
    createdAt: z.string().catch(''),
    updatedAt: z.string().catch(''),
    deletedAt: z.string().optional().catch(undefined),
  })
  .passthrough()

export type TimelineEvent = z.infer<typeof eventSchema>

export function createEventId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function isDeleted(event: Pick<TimelineEvent, 'deletedAt'>): boolean {
  return !!event.deletedAt
}

/** Czy wydarzenie da się umieścić w kalendarzu (ma poprawną datę i nie jest usunięte). */
export function isPlaceable(event: Pick<TimelineEvent, 'start' | 'deletedAt'>): boolean {
  return !event.deletedAt && isEventDate(event.start)
}
