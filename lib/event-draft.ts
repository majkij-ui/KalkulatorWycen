/**
 * Szkic formularza wydarzenia ⇄ zapisane wydarzenie.
 *
 * Formularz trzyma wszystko jako tekst (tak działają pola input). Przy zapisie
 * `eventFromDraft` zamienia go z powrotem na `TimelineEvent` i — przy edycji —
 * startuje od ORYGINAŁU: pola rekordu i klucze `data`, których formularz nie
 * zna (z nowszej wersji, z importu Gmaila), przechodzą nietknięte.
 *
 * Moduł czysty — testy w `event-draft.test.ts`.
 */

import { eventKind } from './event-kinds'
import { createEventId, isEventDate, type TimelineEvent } from './event-types'

export interface EventDraft {
  kind: string
  /** `null` = bez projektu (sprawa firmy). */
  projectId: string | null
  /** `YYYY-MM-DD` */
  date: string
  /** `HH:mm` albo pusty. */
  time: string
  /** `YYYY-MM-DD` albo pusty (= jednodniowe). */
  endDate: string
  title: string
  notes: string
  /** Wartości pól typu jako tekst, klucz = `EventField.key`. */
  fields: Record<string, string>
}

export function emptyDraft(params: { kind: string; date: string; projectId?: string | null }): EventDraft {
  return {
    kind: params.kind,
    projectId: params.projectId ?? null,
    date: params.date,
    time: '',
    endDate: '',
    title: '',
    notes: '',
    fields: {},
  }
}

export function draftFromEvent(event: TimelineEvent): EventDraft {
  const fields: Record<string, string> = {}
  eventKind(event.kind).fields?.forEach((field) => {
    const value = event.data?.[field.key]
    if (typeof value === 'string' || typeof value === 'number') fields[field.key] = String(value)
  })
  return {
    kind: event.kind,
    projectId: event.projectId,
    date: event.start.slice(0, 10),
    time: event.start.length > 10 ? event.start.slice(11, 16) : '',
    endDate: event.end ? event.end.slice(0, 10) : '',
    title: event.title,
    notes: event.notes,
    fields,
  }
}

/** „1 234,5" → 1234.5; puste albo niepoprawne → `undefined`. */
export function parseAmount(value: string): number | undefined {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  if (!normalized) return undefined
  const number = Number(normalized)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export type DraftProblem = 'date' | 'endDate' | 'time' | 'project'

/** Co blokuje zapis. `newLead` = użytkownik zakłada w formularzu nowy lead. */
export function draftProblems(draft: EventDraft, options: { newLead?: boolean } = {}): DraftProblem[] {
  const problems: DraftProblem[] = []
  const kind = eventKind(draft.kind)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) problems.push('date')
  if (draft.time && !/^\d{2}:\d{2}$/.test(draft.time)) problems.push('time')
  if (kind.range && draft.endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate) || draft.endDate < draft.date)) {
    problems.push('endDate')
  }
  if (kind.scope === 'project' && !draft.projectId && !options.newLead) problems.push('project')
  return problems
}

/**
 * Zapisywalne wydarzenie ze szkicu. `original` = edytowane wydarzenie: jego
 * nieznane pola i klucze `data` zostają. `now` jawnie — powtarzalne testy.
 */
export function eventFromDraft(
  draft: EventDraft,
  original: TimelineEvent | null,
  now: Date = new Date()
): TimelineEvent {
  const kind = eventKind(draft.kind)
  const data: Record<string, unknown> = { ...(original?.data ?? {}) }
  kind.fields?.forEach((field) => {
    const raw = (draft.fields[field.key] ?? '').trim()
    const value = field.type === 'number' ? parseAmount(raw) : raw || undefined
    if (value === undefined) delete data[field.key]
    else data[field.key] = value
  })

  const start = kind.timed && draft.time ? `${draft.date}T${draft.time}` : draft.date
  const end = kind.range && draft.endDate && draft.endDate > draft.date ? draft.endDate : undefined
  const nowIso = now.toISOString()

  return {
    ...(original ?? {}),
    id: original?.id ?? createEventId(),
    kind: draft.kind,
    projectId: kind.scope === 'business' ? null : draft.projectId,
    start: isEventDate(start) ? start : draft.date,
    end,
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    data,
    source: original?.source ?? { type: 'manual' },
    createdAt: original?.createdAt || nowIso,
    updatedAt: nowIso,
  }
}
