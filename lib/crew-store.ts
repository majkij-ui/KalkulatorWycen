'use client'

/**
 * Zapis Ekipy (T9a): `crew-roles.json` i `crew.json` w AppData (Tauri) albo
 * localStorage (web), przez ten sam `createCollectionStore` co sprzęt.
 *
 * Plik ról zawiera tylko role dodane albo edytowane — wbudowane, których nikt
 * nie ruszał, dokłada przy odczycie `resolveCrewRoles` (`crew-types.ts`).
 * Ludzi nie usuwa się na twardo: `deletedAt`, a „Cofnij" go zdejmuje.
 */

import { createCollectionStore } from './v3-store'
import { compareCrewRoles, crewMemberSchema, crewRoleSchema, type CrewMember, type CrewRole } from './crew-types'

export const CREW_ROLES_FILE = 'crew-roles.json'
export const WEB_CREW_ROLES_KEY = 'nonoise-crew-roles-v1'
export const CREW_FILE = 'crew.json'
export const WEB_CREW_KEY = 'nonoise-crew-v1'

const rolesStore = createCollectionStore<CrewRole>({
  fileName: CREW_ROLES_FILE,
  webKey: WEB_CREW_ROLES_KEY,
  schema: crewRoleSchema,
  getId: (role) => role.id,
  sort: compareCrewRoles,
})

const crewStore = createCollectionStore<CrewMember>({
  fileName: CREW_FILE,
  webKey: WEB_CREW_KEY,
  schema: crewMemberSchema,
  getId: (member) => member.id,
  sort: (a, b) => a.name.localeCompare(b.name, 'pl') || a.id.localeCompare(b.id),
})

/** Zapisane role (bez wbudowanych, których nie edytowano). */
export const listStoredCrewRoles = rolesStore.list
/** Zapis jednej roli — także pierwsza edycja wbudowanej (wtedy trafia do pliku). */
export const upsertCrewRole = rolesStore.upsert

/** Wszyscy ludzie, z usuniętymi. */
export const listAllCrewMembers = crewStore.list
export const upsertCrewMember = crewStore.upsert

export function softDeleteCrewMember(id: string, deletedAt: string): Promise<CrewMember[]> {
  return crewStore.mutate((all) => all.map((m) => (m.id === id ? { ...m, deletedAt, updatedAt: deletedAt } : m)))
}

export function restoreCrewMember(id: string): Promise<CrewMember[]> {
  const updatedAt = new Date().toISOString()
  return crewStore.mutate((all) =>
    all.map((m) => {
      if (m.id !== id) return m
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { deletedAt, ...rest } = m
      return { ...rest, updatedAt }
    })
  )
}
