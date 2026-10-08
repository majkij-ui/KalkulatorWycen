'use client'

/**
 * Kontekst wydarzeń osi czasu.
 *
 * Przeładowuje kolekcję, gdy okno wraca na pierwszy plan: dane może dopisać
 * import z rozmowy z Claude (plan §5a) albo druga instancja aplikacji, a
 * kalendarz ma je pokazać bez ręcznego odświeżania. Zapis pojedynczego
 * wydarzenia i tak czyta plik na świeżo (`upsert`), więc nic nie nadpisze
 * cudzych zmian.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { listAllEvents, restoreEvent, saveEvent, softDeleteEvent } from './events-store'
import type { TimelineEvent } from './event-types'

interface EventsContextValue {
  /** Wydarzenia bez usuniętych. */
  events: TimelineEvent[]
  isLoading: boolean
  save: (event: TimelineEvent) => Promise<void>
  /** Miękkie usunięcie — `restore` je cofa. */
  remove: (id: string) => Promise<void>
  restore: (id: string) => Promise<void>
  reload: () => Promise<void>
}

const EventsContext = createContext<EventsContextValue | null>(null)

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const [all, setAll] = useState<TimelineEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setAll(await listAllEvents())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])

  const save = useCallback(async (event: TimelineEvent) => {
    setAll(await saveEvent(event))
  }, [])

  const remove = useCallback(async (id: string) => {
    setAll(await softDeleteEvent(id))
  }, [])

  const restore = useCallback(async (id: string) => {
    setAll(await restoreEvent(id))
  }, [])

  const events = useMemo(() => all.filter((e) => !e.deletedAt), [all])

  return (
    <EventsContext.Provider value={{ events, isLoading, save, remove, restore, reload }}>
      {children}
    </EventsContext.Provider>
  )
}

export function useEvents(): EventsContextValue {
  const ctx = useContext(EventsContext)
  if (!ctx) throw new Error('useEvents musi być użyty wewnątrz EventsProvider')
  return ctx
}
