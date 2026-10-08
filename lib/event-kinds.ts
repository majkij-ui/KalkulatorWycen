/**
 * Rejestr typów wydarzeń (szkic na potrzeby makiety kalendarza; T1 rozbuduje go
 * o schematy `data` i podpowiedzi statusu).
 *
 * KLUCZE SĄ NA ZAWSZE: etykiety, skróty i grupy wolno zmieniać, klucza nie.
 * Nieznany klucz (np. zapisany przez nowszą wersję) trafia do grupy „inne".
 */

import type { EventGroup } from './calendar-palette'

export interface EventKind {
  key: string
  /** Pełna nazwa w formularzach i listach. */
  label: string
  /** 1–2 słowa na chipie w siatce miesiąca. */
  short: string
  group: EventGroup
  /** Czy wydarzenie może trwać kilka dni (paski w siatce). */
  range: boolean
}

export const EVENT_KINDS: EventKind[] = [
  { key: 'lead_in', label: 'Nowy lead', short: 'lead', group: 'sprzedaz', range: false },
  { key: 'reply_sent', label: 'Odpowiedź wysłana', short: 'odp.', group: 'sprzedaz', range: false },
  { key: 'quote_sent', label: 'Wycena wysłana', short: 'wycena', group: 'sprzedaz', range: false },
  { key: 'follow_up', label: 'Follow-up', short: 'follow-up', group: 'sprzedaz', range: false },
  { key: 'won', label: 'Zlecenie potwierdzone', short: 'wygrany', group: 'sprzedaz', range: false },
  { key: 'lost', label: 'Zlecenie przegrane', short: 'przegrany', group: 'sprzedaz', range: false },
  { key: 'prep_day', label: 'Dzień przygotowań', short: 'prep', group: 'produkcja', range: true },
  { key: 'shoot_day', label: 'Dzień zdjęciowy', short: 'zdjęcia', group: 'produkcja', range: true },
  { key: 'post_day', label: 'Postprodukcja', short: 'post', group: 'post', range: true },
  { key: 'deadline', label: 'Deadline', short: 'deadline', group: 'post', range: false },
  { key: 'invoice_sent', label: 'Faktura wysłana', short: 'FV wysł.', group: 'pieniadze', range: false },
  { key: 'invoice_paid', label: 'Faktura opłacona', short: 'FV opł.', group: 'pieniadze', range: false },
  { key: 'gear_purchase', label: 'Zakup sprzętu', short: 'sprzęt', group: 'firma', range: false },
  { key: 'marketing', label: 'Marketing', short: 'ads', group: 'firma', range: true },
  { key: 'note', label: 'Notatka', short: 'notatka', group: 'inne', range: true },
]

const BY_KEY = new Map(EVENT_KINDS.map((kind) => [kind.key, kind]))

export function eventKind(key: string): EventKind {
  return BY_KEY.get(key) ?? { key, label: key, short: key, group: 'inne', range: true }
}
