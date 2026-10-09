'use client'

/**
 * Usunięcie projektu razem z jego wątkiem — spina projekty i wydarzenia.
 *
 * Oba zapisy dostają ten sam `deletedAt`, więc „Cofnij" przywraca dokładnie
 * to, co zniknęło razem z projektem (`lib/project-deletion.ts`).
 */

import { useCallback } from 'react'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { deletionNote, eventsDeletedWithProject, planProjectDeletion } from '@/lib/project-deletion'
import type { Project } from '@/lib/project-types'

export function useProjectDeletion() {
  const { removeProject, restoreProject } = useProjectHub()
  const { events, allEvents, removeMany, restoreMany } = useEvents()

  /** Dopisek do potwierdzenia („Usunie też 6 wydarzeń."), `null` gdy wątek pusty. */
  const describe = useCallback((projectId: string) => deletionNote(planProjectDeletion(events, projectId)), [events])

  /** Usuwa projekt i jego wątek; zwraca usunięty rekord do „Cofnij". */
  const deleteWithThread = useCallback(
    async (projectId: string): Promise<{ project: Project; eventCount: number } | null> => {
      const plan = planProjectDeletion(events, projectId)
      const deletedAt = new Date().toISOString()
      const project = await removeProject(projectId, deletedAt)
      if (!project) return null
      await removeMany(plan.eventIds, deletedAt)
      return { project, eventCount: plan.eventIds.length }
    },
    [events, removeProject, removeMany]
  )

  const undoDelete = useCallback(
    async (project: Project) => {
      await restoreProject(project.id)
      await restoreMany(eventsDeletedWithProject(allEvents, project))
    },
    [allEvents, restoreProject, restoreMany]
  )

  return { describe, deleteWithThread, undoDelete }
}
