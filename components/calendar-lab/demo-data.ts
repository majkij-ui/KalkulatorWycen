/**
 * Przykładowe dane makiety kalendarza (październik 2026). Nic z tego nie trafia
 * do zapisu — to wyłącznie materiał do oceny palety i układu.
 */

import type { ProjectColorKey } from '@/lib/calendar-palette'

export interface DemoProject {
  id: string
  name: string
  short: string
  client: string
  color: ProjectColorKey
}

export interface DemoEvent {
  id: string
  kind: string
  projectId: string | null
  start: string
  end?: string
  title: string
}

export const DEMO_PROJECTS: DemoProject[] = [
  { id: 'tchibo', name: 'Tchibo — spot jesienny', short: 'Tchibo', client: 'Tchibo', color: 'lemon' },
  { id: 'jhj', name: 'Jot Ha Jot — teledysk', short: 'Jot Ha Jot', client: 'Jot Ha Jot', color: 'teal' },
  { id: 'dentmed', name: 'Dentmed — film o klinice', short: 'Dentmed', client: 'Klinika Dentmed', color: 'blue' },
  { id: 'wisla', name: 'Festiwal Wisła — relacja', short: 'Fest. Wisła', client: 'Fundacja Wisła', color: 'magenta' },
  { id: 'ziarno', name: 'Ziarno — reels', short: 'Ziarno', client: 'Kawiarnia Ziarno', color: 'lime' },
  { id: 'arch', name: 'Arch Studio — portfolio', short: 'Arch Studio', client: 'Arch Studio', color: 'coral' },
]

let seq = 0
const ev = (kind: string, projectId: string | null, start: string, title: string, end?: string): DemoEvent => ({
  id: `e${++seq}`,
  kind,
  projectId,
  start,
  end,
  title,
})

export const DEMO_EVENTS: DemoEvent[] = [
  // Tchibo — pełny wątek od leada
  ev('lead_in', 'tchibo', '2026-10-02T09:14', 'Zapytanie o spot jesienny'),
  ev('reply_sent', 'tchibo', '2026-10-02T13:40', 'Odpowiedź z pytaniami o zakres'),
  ev('quote_sent', 'tchibo', '2026-10-06', 'Wycena v1 — 38 400 zł netto'),
  ev('won', 'tchibo', '2026-10-09', 'Akceptacja wyceny'),
  ev('prep_day', 'tchibo', '2026-10-20', 'Dokumentacja lokacji'),
  ev('shoot_day', 'tchibo', '2026-10-28', 'Zdjęcia — palarnia + studio', '2026-10-29'),
  ev('post_day', 'tchibo', '2026-10-30', 'Montaż i kolor', '2026-11-05'),
  ev('deadline', 'tchibo', '2026-11-06', 'Oddanie wersji 1'),

  // Jot Ha Jot — w trakcie postprodukcji, potem faktura
  ev('won', 'jhj', '2026-09-22', 'Potwierdzenie terminu'),
  ev('shoot_day', 'jhj', '2026-10-05', 'Zdjęcia — hala + plener', '2026-10-06'),
  ev('post_day', 'jhj', '2026-10-07', 'Montaż, kolor, VFX', '2026-10-13'),
  ev('deadline', 'jhj', '2026-10-15', 'Wersja finalna'),
  ev('invoice_sent', 'jhj', '2026-10-16', 'FV 14/10/2026 — 22 000 zł netto'),

  // Dentmed — faktura z września opłacona
  ev('invoice_sent', 'dentmed', '2026-09-10', 'FV 11/09/2026'),
  ev('invoice_paid', 'dentmed', '2026-10-03', 'Wpłata 12 300 zł netto'),
  ev('follow_up', 'dentmed', '2026-10-14', 'Telefon — kolejny film'),

  // Festiwal Wisła — świeży lead
  ev('lead_in', 'wisla', '2026-10-12T18:02', 'Zapytanie z Google Ads'),
  ev('reply_sent', 'wisla', '2026-10-13T08:30', 'Odpowiedź + termin rozmowy'),
  ev('quote_sent', 'wisla', '2026-10-14', 'Wycena — 3 dni relacji'),
  ev('follow_up', 'wisla', '2026-10-21', 'Przypomnienie o wycenie'),

  // Ziarno — lead przegrany
  ev('lead_in', 'ziarno', '2026-10-19T11:00', 'Zapytanie z Instagrama'),
  ev('reply_sent', 'ziarno', '2026-10-21T10:00', 'Odpowiedź z widełkami'),
  ev('lost', 'ziarno', '2026-10-23', 'Budżet poniżej minimum'),

  // Arch Studio — zdjęcia, długa postprodukcja, faktura
  ev('shoot_day', 'arch', '2026-10-14', 'Zdjęcia wnętrz'),
  ev('post_day', 'arch', '2026-10-15', 'Selekcja, montaż, retusz', '2026-10-23'),
  ev('deadline', 'arch', '2026-10-26', 'Oddanie portfolio'),
  ev('invoice_sent', 'arch', '2026-10-27', 'FV 15/10/2026'),

  // Firma — bez projektu
  ev('marketing', null, '2026-10-01', 'Google Ads — kampania Q4'),
  ev('gear_purchase', null, '2026-10-08', 'Sigma 35mm f/1.4'),
  ev('gear_purchase', null, '2026-10-22', 'Aputure 600d'),
  ev('note', null, '2026-10-14', 'Spotkanie z księgową'),
]
