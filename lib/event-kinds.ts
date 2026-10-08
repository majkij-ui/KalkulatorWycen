/**
 * Rejestr typów wydarzeń.
 *
 * KLUCZE SĄ NA ZAWSZE: etykiety, skróty, grupy i pola formularza wolno
 * zmieniać, klucza nie. Nieznany klucz (np. zapisany przez nowszą wersję)
 * trafia do grupy „inne" i przechodzi przez aplikację nietknięty.
 *
 * Każdy typ ma schemat pola `data`. Schemat służy do ODCZYTU (`eventData`) —
 * nie zmienia tego, co leży w pliku, więc dodanie lub zmiana pola w
 * przyszłości nie wymaga migracji. `fields` opisuje te same pola dla
 * formularza w kalendarzu. Moduł czysty.
 */

import { z } from 'zod'
import type { EventGroup } from './calendar-palette'
import type { ProjectStatus } from './project-types'

/** Pole formularza dla `event.data[key]`. */
export interface EventField {
  key: string
  label: string
  type: 'text' | 'number' | 'date'
  placeholder?: string
  /** Podpowiedzi (datalist) — wartość nadal jest dowolnym tekstem. */
  suggestions?: readonly string[]
}

export interface EventKind {
  key: string
  /** Pełna nazwa w formularzach i listach. */
  label: string
  /** 1–2 słowa na chipie w siatce miesiąca. */
  short: string
  group: EventGroup
  /** Czy wydarzenie może trwać kilka dni (paski w siatce). */
  range: boolean
  /**
   * `project` — należy do wątku projektu (albo zakłada nowy lead),
   * `business` — sprawa firmy, bez projektu, `either` — jedno i drugie.
   */
  scope: 'project' | 'business' | 'either'
  /** Formularz pyta o godzinę (liczymy z niej czas odpowiedzi na lead). */
  timed?: boolean
  /** Pola specyficzne dla typu (`event.data`). Wszystkie opcjonalne. */
  data: z.ZodTypeAny
  fields?: EventField[]
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
    scope: 'project',
    timed: true,
    // Kanał TEJ wiadomości (mail, telefon, formularz). Źródło leada i osoba
    // kontaktowa to cechy projektu (`leadSource`, `contact`) — jedno miejsce.
    data: z.object({ channel: text, summary: text }).passthrough(),
    fields: [
      { key: 'channel', label: 'Kanał', type: 'text', suggestions: ['mail', 'telefon', 'formularz', 'Instagram DM'] },
      { key: 'summary', label: 'O co pyta klient', type: 'text' },
    ],
  },
  {
    key: 'reply_sent',
    label: 'Odpowiedź wysłana',
    short: 'odp.',
    group: 'sprzedaz',
    range: false,
    scope: 'project',
    timed: true,
    data: noData,
  },
  {
    key: 'quote_sent',
    label: 'Wycena wysłana',
    short: 'wycena',
    group: 'sprzedaz',
    range: false,
    scope: 'project',
    data: z.object({ amountNetto: amount, quoteVersion: text }).passthrough(),
    fields: [
      { key: 'amountNetto', label: 'Kwota netto (zł)', type: 'number' },
      { key: 'quoteVersion', label: 'Wersja', type: 'text', placeholder: 'np. v2' },
    ],
    suggestsStatus: 'quote',
  },
  {
    key: 'follow_up',
    label: 'Follow-up',
    short: 'follow-up',
    group: 'sprzedaz',
    range: false,
    scope: 'project',
    timed: true,
    data: noData,
  },
  {
    key: 'won',
    label: 'Zlecenie potwierdzone',
    short: 'wygrany',
    group: 'sprzedaz',
    range: false,
    scope: 'project',
    data: noData,
    suggestsStatus: 'won',
  },
  {
    key: 'lost',
    label: 'Zlecenie przegrane',
    short: 'przegrany',
    group: 'sprzedaz',
    range: false,
    scope: 'project',
    data: z.object({ reason: text }).passthrough(),
    fields: [
      {
        key: 'reason',
        label: 'Powód',
        type: 'text',
        suggestions: ['budżet', 'termin', 'wybrali kogoś innego', 'brak odpowiedzi'],
      },
    ],
    suggestsStatus: 'lost',
  },
  {
    key: 'prep_day',
    label: 'Dzień przygotowań',
    short: 'prep',
    group: 'produkcja',
    range: true,
    scope: 'project',
    data: z.object({ location: text }).passthrough(),
    fields: [{ key: 'location', label: 'Miejsce', type: 'text' }],
  },
  {
    key: 'shoot_day',
    label: 'Dzień zdjęciowy',
    short: 'zdjęcia',
    group: 'produkcja',
    range: true,
    scope: 'project',
    data: z.object({ location: text, callSheetId: text }).passthrough(),
    fields: [{ key: 'location', label: 'Miejsce', type: 'text' }],
  },
  {
    key: 'post_day',
    label: 'Postprodukcja',
    short: 'post',
    group: 'post',
    range: true,
    scope: 'project',
    data: z.object({ hours: z.number().finite().nonnegative().optional().catch(undefined) }).passthrough(),
    fields: [{ key: 'hours', label: 'Godziny pracy (łącznie)', type: 'number' }],
  },
  {
    key: 'deadline',
    label: 'Deadline',
    short: 'deadline',
    group: 'post',
    range: false,
    scope: 'project',
    data: z.object({ what: text }).passthrough(),
    fields: [{ key: 'what', label: 'Co oddajemy', type: 'text', placeholder: 'np. wersja 1 do akceptacji' }],
  },
  {
    key: 'invoice_sent',
    label: 'Faktura wysłana',
    short: 'FV wysł.',
    group: 'pieniadze',
    range: false,
    scope: 'project',
    data: z.object({ number: text, amountNetto: amount, dueDate: dateKey }).passthrough(),
    fields: [
      { key: 'number', label: 'Numer faktury', type: 'text' },
      { key: 'amountNetto', label: 'Kwota netto (zł)', type: 'number' },
      { key: 'dueDate', label: 'Termin płatności', type: 'date' },
    ],
  },
  {
    key: 'invoice_paid',
    label: 'Faktura opłacona',
    short: 'FV opł.',
    group: 'pieniadze',
    range: false,
    scope: 'project',
    data: z.object({ number: text, amount }).passthrough(),
    fields: [
      { key: 'number', label: 'Numer faktury', type: 'text', placeholder: 'paruje wpłatę z fakturą' },
      { key: 'amount', label: 'Wpłacona kwota (zł)', type: 'number' },
    ],
    suggestsStatus: 'done',
  },
  {
    key: 'gear_purchase',
    label: 'Zakup sprzętu',
    short: 'sprzęt',
    group: 'firma',
    range: false,
    scope: 'business',
    // Zakupy żyją w katalogu sprzętu (data zakupu pozycji) i są rzutowane na
    // kalendarz — formularz kalendarza zapisuje do katalogu, nie do wydarzeń.
    data: z.object({ itemId: text, amount }).passthrough(),
  },
  {
    key: 'marketing',
    label: 'Marketing',
    short: 'ads',
    group: 'firma',
    range: true,
    scope: 'business',
    data: z.object({ campaign: text, spend: amount }).passthrough(),
    fields: [
      { key: 'campaign', label: 'Kampania', type: 'text', suggestions: ['Google Ads', 'Meta Ads', 'Instagram'] },
      { key: 'spend', label: 'Budżet (zł)', type: 'number' },
    ],
  },
  { key: 'note', label: 'Notatka', short: 'notatka', group: 'inne', range: true, scope: 'either', data: noData },
]

const BY_KEY = new Map(EVENT_KINDS.map((kind) => [kind.key, kind]))

export function isKnownKind(key: string): boolean {
  return BY_KEY.has(key)
}

export function eventKind(key: string): EventKind {
  return (
    BY_KEY.get(key) ?? { key, label: key, short: key, group: 'inne', range: true, scope: 'either', data: noData }
  )
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
 * zamyka wycenę, ale klient może wrócić (lost → won), a projektu w
 * realizacji nie cofamy do „przegranego" podpowiedzią — to robi się ręcznie.
 */
const STATUS_RANK: Record<ProjectStatus, number> = {
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
