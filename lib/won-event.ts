/**
 * „W realizacji" dopisuje wydarzenie `won` („Zlecenie potwierdzone").
 *
 * Eksport do Google Ads czyta datę wygranej z wydarzenia `won` w wątku projektu
 * (`ads-export.ts`), a sama zmiana statusu go nie tworzyła. Przejście do `won`
 * dopisuje więc to wydarzenie, jeśli projekt nie ma jeszcze żywego (nieusuniętego).
 * Reguły:
 *  - tylko status → `won`; „Zrealizowany" (także prosto z wyceny), „Wycena"
 *    i „Nieprzyjęty" niczego nie dopisują ani nie ruszają istniejącego wydarzenia,
 *  - projekt już „W realizacji" — nic,
 *  - jest żywe `won` — nic; samo usunięte (miękko) nie liczy się, wtedy dopisujemy nowe,
 *  - data = dziś, sama data (bez godziny), wydarzenie jak dodane ręcznie (bez tytułu —
 *    oś czasu pokazuje wtedy nazwę typu).
 *
 * Moduł czysty — testy w `won-event.test.ts`.
 */

import type { ProjectStatus } from './project-types'

export interface WonEventDraft {
  kind: 'won'
  projectId: string
  /** `YYYY-MM-DD` */
  start: string
  title: string
  data: Record<string, never>
}

export interface WonEventLookup {
  kind: string
  projectId: string | null
  deletedAt?: string
}

/** Wydarzenie `won` do dopisania przy zmianie statusu projektu na `next`, albo `null`. */
export function wonEventToAdd(
  project: { id: string; status: ProjectStatus },
  events: WonEventLookup[],
  next: ProjectStatus,
  today: string
): WonEventDraft | null {
  if (next !== 'won' || project.status === 'won') return null
  const hasLive = events.some((e) => e.kind === 'won' && e.projectId === project.id && !e.deletedAt)
  if (hasLive) return null
  return { kind: 'won', projectId: project.id, start: today, title: '', data: {} }
}
