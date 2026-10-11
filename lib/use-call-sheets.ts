'use client'

/**
 * Call sheety projektu dla zakładki Realizacja (T5b). Kolekcja przeładowuje
 * się, gdy okno wraca na pierwszy plan (import z rozmowy z Claude, plan §5a),
 * tak jak wydarzenia i Ekipa. Otwarty edytor trzyma własną kopię call sheetu,
 * więc przeładowanie nie cofa tego, co właśnie wpisujesz.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAllCallSheets, restoreCallSheet, saveCallSheet, softDeleteCallSheet } from './call-sheets-store'
import type { CallSheet } from './call-sheet-types'

export function useCallSheets(projectId: string) {
  const [all, setAll] = useState<CallSheet[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setAll(await listAllCallSheets())
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

  /** Call sheety tego projektu, także usunięte (do „Cofnij"). */
  const sheets = useMemo(() => all.filter((s) => s.projectId === projectId), [all, projectId])

  const save = useCallback(async (sheet: CallSheet) => {
    setAll(await saveCallSheet(sheet))
  }, [])

  const remove = useCallback(async (id: string, deletedAt: string) => {
    setAll(await softDeleteCallSheet(id, deletedAt))
  }, [])

  const restore = useCallback(async (id: string) => {
    setAll(await restoreCallSheet(id))
  }, [])

  return { sheets, isLoading, save, remove, restore }
}
