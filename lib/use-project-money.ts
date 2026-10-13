'use client'

/**
 * Pieniądze projektów z pętli (T6) po id — dla Klientów i filtra klienta w
 * Projektach (S2): ta sama najlepsza wiedza co w Finansach. Liczone raz na
 * zmianę projektów albo wydarzeń.
 */

import { useMemo } from 'react'
import { useEvents } from './events-context'
import { moneyLedger, type ProjectMoney } from './money-loop'
import { useProjectHub } from './project-hub-context'
import { toDateKey } from './project-types'

export function useProjectMoney(): Map<string, ProjectMoney> {
  const { projects } = useProjectHub()
  const { events } = useEvents()
  const today = toDateKey(new Date())
  return useMemo(() => new Map(moneyLedger(projects, events, today).map((m) => [m.id, m])), [projects, events, today])
}
