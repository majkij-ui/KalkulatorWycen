'use client'

/**
 * Grupy klientów dla ekranów (Klienci, filtr Projektów; później Finanse i
 * raport). Zwykły hook zamiast kontekstu: grupy czyta naraz najwyżej jeden
 * ekran. Przeładowanie, gdy okno wraca na pierwszy plan (zmiana z
 * `npm run data`), jak przy wydarzeniach.
 *
 * Każda zmiana to jeden zapis na świeżo odczytanym pliku (`mutateClientGroups`
 * + czysta funkcja z `client-groups.ts`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addGroupMembers,
  createClientGroup,
  dissolveClientGroup,
  groupsAfterClientMerge,
  groupsAfterUndoMerge,
  liveGroups,
  removeGroupMember,
  renameClientGroup,
  restoreClientGroup,
  type ClientGroup,
  type GroupMembershipChange,
} from './client-groups'
import { listAllClientGroups, mutateClientGroups } from './client-groups-store'

export function useClientGroups() {
  const [allGroups, setAllGroups] = useState<ClientGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setAllGroups(await listAllClientGroups())
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

  const groups = useMemo(() => liveGroups(allGroups), [allGroups])
  const now = () => new Date().toISOString()

  const createGroup = useCallback(async (name: string, members: string[]) => {
    let created: ClientGroup | null = null
    setAllGroups(
      await mutateClientGroups((all) => {
        const result = createClientGroup(all, { name, members }, now())
        created = result.group
        return result.groups
      })
    )
    return created as ClientGroup | null
  }, [])

  const renameGroup = useCallback(async (id: string, name: string) => {
    setAllGroups(await mutateClientGroups((all) => renameClientGroup(all, id, name, now())))
  }, [])

  const addMembers = useCallback(async (id: string, keys: string[]) => {
    setAllGroups(await mutateClientGroups((all) => addGroupMembers(all, id, keys, now())))
  }, [])

  const removeMember = useCallback(async (id: string, key: string) => {
    setAllGroups(await mutateClientGroups((all) => removeGroupMember(all, id, key, now())))
  }, [])

  /** Zwraca znacznik — „Cofnij" go potrzebuje. */
  const dissolveGroup = useCallback(async (id: string) => {
    const at = now()
    setAllGroups(await mutateClientGroups((all) => dissolveClientGroup(all, id, at)))
    return at
  }, [])

  const restoreGroup = useCallback(async (id: string, at: string) => {
    setAllGroups(await mutateClientGroups((all) => restoreClientGroup(all, id, at, now())))
  }, [])

  /** „Scal nazwy": członkostwo idzie za nową nazwą; zwraca zmiany do „Cofnij". */
  const followClientMerge = useCallback(async (plan: { keys: string[]; targetKey: string }) => {
    let changes: GroupMembershipChange[] = []
    setAllGroups(
      await mutateClientGroups((all) => {
        const result = groupsAfterClientMerge(all, plan, now())
        changes = result.changes
        return result.groups
      })
    )
    return changes
  }, [])

  const undoClientMerge = useCallback(async (changes: GroupMembershipChange[]) => {
    if (changes.length === 0) return
    setAllGroups(await mutateClientGroups((all) => groupsAfterUndoMerge(all, changes, now())))
  }, [])

  return {
    groups,
    allGroups,
    isLoading,
    createGroup,
    renameGroup,
    addMembers,
    removeMember,
    dissolveGroup,
    restoreGroup,
    followClientMerge,
    undoClientMerge,
  }
}
