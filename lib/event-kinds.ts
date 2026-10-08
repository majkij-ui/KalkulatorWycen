/**
 * Rejestr typów wydarzeń.
 *
 * KLUCZE SĄ NA ZAWSZE: etykiety, skróty, grupy i pola formularza wolno
 * zmieniać, klucza nie. Nieznany klucz (np. zapisany przez nowszą wersję)
 * trafia do grupy „inne" i przechodzi przez aplikację nietknięty.
 *
 * Każdy typ ma schemat pola `data`. Schemat służy do ODCZYTU (`eventData`) —
 * nie zmienia tego, co leży w pliku, więc dodanie lub zmiana pola w
 * przyszłości nie wymaga migracji. Moduł czysty.
 */

import { z } from 'zod'
import type { EventGroup } from './calendar-palette'
import type { ProjectStatus } from './project-types'

export interface EventKind {
  key: string
  /** Pełna nazwa w formularzach i listach. */
  label: string
  /** 1–2 słowa na chipie w siatce miesiąca. */
  short: string
  group: EventGroup
  /** Czy wydarzenie może trwać kilka dni (paski w siatce). */
  range: boolean
  /** Pola specyficzne dla typu (`event.data`). Wszystkie opcjonalne. */
  data: z.ZodTypeAny
  /** Status, który ten typ proponuje projektowi (zawsze do potwierdzenia). */
  suggestsStatus?: ProjectStatus
}

// ── Pola wspólne dla kilku typów ─────────────────────────────────────────────

const text = z.string().trim().optional().catch(undefined)
/** Kwota PLN netto; odrzucamy tylko to, co nie jest liczbą skończoną. */
const amount = z.number().finite().nonnegative().optional().catch(undefined)
const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined)

const noData = z.object({}).passthrough()

export const EVENT_KINDS: EventKind[] = [
  {
    key: 'lead_in',
    label: 'Nowy lead',
    short: 'lead',
    group: 'sprzedaz',
    range: false,
    // Kanał TEJ wiadomości (mail, telefon, formularz). Źródło leada i osoba
    // kontaktowa to cechy projektu (`leadSource`, `contact`) — jedno miejsce.
    data: z.object({ channel: text, summary: text }).passthrough(),
    suggestsStatus: 'lead',
  },
  { key: 'reply_sent', label: 'Odpowiedź wysłana', short: 'odp.', group: 'sprzedaz', range: false, data: noData },
  {
    key: 'quote_sent',
    label: 'Wycena wysłana',
    short: 'wycena',
    group: 'sprzedaz',
    range: false,
    data: z.object({ amountNetto: amount, quoteVersion: text }).passthrough(),
    suggestsStatus: 'quote',
  },
  { key: 'follow_up', label: 'Follow-up', short: 'follow-up', group: 'sprzedaz', range: false, data: noData },
  {
    key: 'won',
    label: 'Zlecenie potwierdzone',
    short: 'wygrany',
    group: 'sprzedaz',
    range: false,
    data: noData,
    suggestsStatus: 'won',
  },
  {
    key: 'lost',
    label: 'Zlecenie przegrane',
    short: 'przegrany',
    group: 'sprzedaz',
    range: false,
    data: z.object({ reason: text }).passthrough(),
    suggestsStatus: 'lost',
  },
  {
    key: 'prep_day',
    label: 'Dzień przygotowań',
    short: 'prep',
    group: 'produkcja',
    range: true,
    data: z.object({ location: text }).passthrough(),
  },
  {
    key: 'shoot_day',
    label: 'Dzień zdjęciowy',
    short: 'zdjęcia',
    group: 'produkcja',
    range: true,
    data: z.object({ location: text, callSheetId: text }).passthrough(),
  },
  {
    key: 'post_day',
    label: 'Postprodukcja',
    short: 'post',
    group: 'post',
    range: true,
    data: z.object({ hours: z.number().finite().nonnegative().optional().catch(undefined) }).passthrough(),
  },
  {
    key: 'deadline',
    label: 'Deadline',
    short: 'deadline',
    group: 'post',
    range: false,
    data: z.object({ what: text }).passthrough(),
  },
  {
    key: 'invoice_sent',
    label: 'Faktura wysłana',
    short: 'FV wysł.',
    group: 'pieniadze',
    range: false,
    data: z.object({ number: text, amountNetto: amount, dueDate: dateKey }).passthrough(),
  },
  {
    key: 'invoice_paid',
    label: 'Faktura opłacona',
    short: 'FV opł.',
    group: 'pieniadze',
    range: false,
    data: z.object({ number: text, amount }).passthrough(),
    suggestsStatus: 'done',
  },
  {
    key: 'gear_purchase',
    label: 'Zakup sprzętu',
    short: 'sprzęt',
    group: 'firma',
    range: false,
    data: z.object({ itemId: text, amount }).passthrough(),
  },
  {
    key: 'marketing',
    label: 'Marketing',
    short: 'ads',
    group: 'firma',
    range: true,
    data: z.object({ campaign: text, spend: amount }).passthrough(),
  },
  { key: 'note', label: 'Notatka', short: 'notatka', group: 'inne', range: true, data: noData },
]

const BY_KEY = new Map(EVENT_KINDS.map((kind) => [kind.key, kind]))

export function isKnownKind(key: string): boolean {
  return BY_KEY.has(key)
}

export function eventKind(key: string): EventKind {
  return BY_KEY.get(key) ?? { key, label: key, short: key, group: 'inne', range: true, data: noData }
}

/**
 * Pola typu odczytane przez jego schemat. Nigdy nie rzuca: niepoprawne pole
 * staje się `undefined`, nieznane pola zostają. Zapisanych danych nie zmienia.
 */
export function eventData(event: { kind: string; data?: Record<string, unknown> }): Record<string, unknown> {
  const parsed = eventKind(event.kind).data.safeParse(event.data ?? {})
  return parsed.success && parsed.data && typeof parsed.data === 'object'
    ? (parsed.data as Record<string, unknown>)
    : {}
}

// ── Podpowiedzi statusu ──────────────────────────────────────────────────────

/**
 * Kolejność etapów wątku. `lost` leży między wyceną a realizacją: przegrana
 * zamyka lead lub wycenę, ale klient może wrócić (lost → won), a projektu w
 * realizacji nie cofamy do „przegranego" podpowiedzią — to robi się ręcznie.
 */
const STATUS_RANK: Record<ProjectStatus, number> = {
  lead: 0,
  quote: 1,
  lost: 1.5,
  won: 2,
  done: 3,
}

/**
 * Status do ZAPROPONOWANIA po dodaniu wydarzenia albo `null`. Proponujemy
 * tylko ruch naprzód — wysłanie poprawionej wyceny projektowi w realizacji nie
 * może sugerować cofnięcia go do „wyceny". Decyzja zawsze należy do użytkownika.
 */
export function statusSuggestion(current: ProjectStatus, eventKindKey: string): ProjectStatus | null {
  const target = eventKind(eventKindKey).suggestsStatus
  if (!target || target === current) return null
  return STATUS_RANK[target] > STATUS_RANK[current] ? target : null
}
