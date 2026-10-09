/**
 * Usunięcie projektu razem z jego wątkiem (decyzja 2026-10-09, plan §6b).
 *
 * Nic nie znika na twardo: projekt i jego wydarzenia dostają TEN SAM
 * `deletedAt`. Dzięki temu „Cofnij" przywraca dokładnie to, co zniknęło razem
 * z projektem — a wydarzenie usunięte wcześniej osobno zostaje usunięte.
 * Zakupy sprzętu nie są wydarzeniami projektu (żyją w katalogu) i zostają.
 *
 * Moduł czysty — testy w `project-deletion.test.ts`.
 */

import { plural } from './pl-plural'

interface ThreadEvent {
  id: string
  kind: string
  projectId: string | null
  deletedAt?: string
}

export interface ProjectDeletionPlan {
  /** Aktywne wydarzenia wątku, które dostaną znacznik usunięcia. */
  eventIds: string[]
  /** Ile z nich to leady (znikną też z zakładki Marketing). */
  leadCount: number
}

export function planProjectDeletion(events: ThreadEvent[], projectId: string): ProjectDeletionPlan {
  const own = events.filter((e) => e.projectId === projectId && !e.deletedAt)
  return { eventIds: own.map((e) => e.id), leadCount: own.filter((e) => e.kind === 'lead_in').length }
}

/** Wydarzenia do przywrócenia razem z projektem: usunięte w tej samej chwili co on. */
export function eventsDeletedWithProject(
  events: ThreadEvent[],
  project: { id: string; deletedAt?: string }
): string[] {
  if (!project.deletedAt) return []
  return events.filter((e) => e.projectId === project.id && e.deletedAt === project.deletedAt).map((e) => e.id)
}

/** Dopisek do potwierdzenia: „Usunie też 6 wydarzeń (w tym 1 lead)." */
export function deletionNote(plan: ProjectDeletionPlan): string | null {
  const count = plan.eventIds.length
  if (count === 0) return null
  const events = `${count} ${plural(count, 'wydarzenie', 'wydarzenia', 'wydarzeń')}`
  const leads = plan.leadCount ? ` (w tym ${plan.leadCount} ${plural(plan.leadCount, 'lead', 'leady', 'leadów')})` : ''
  return `Usunie też ${events}${leads}.`
}
