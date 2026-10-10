'use client'

/**
 * Kontekst Ekipy (T9a): role i ludzie dla ekranu „Ekipa", Realizacji i
 * (w T9b) wyceny.
 *
 * Role to zapisane rekordy plus wbudowane z cennika — odczyt nic nie zapisuje.
 * Wbudowane mają dwa warianty stawek:
 * - `roles` — z cennika DOMYŚLNEGO użytkownika („Zapisz stawki jako
 *   domyślne"; bez niego z bieżącego). Ekran Ekipy, Realizacja, Zestawy.
 * - `quoteRoles` — z cennika otwartej wyceny (`useQuote().pricingConfig`):
 *   wczytanie wyceny podmienia cennik kalkulatora na jej własny, więc nowa
 *   pozycja ekipy kosztuje tyle, co stare liczniki w tej samej wycenie.
 * Kolekcje przeładowują się, gdy okno wraca na pierwszy plan (import z
 * rozmowy z Claude, plan §5a), tak jak wydarzenia.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQuote } from './quote-context'
import { getSavedUserDefault, USER_DEFAULT_PRICING_EVENT, type PricingConfigShape } from './pricing-config'
import {
  activeCrewRoles,
  createCrewMember,
  createCrewRole,
  liveCrewMembers,
  resolveCrewRoles,
  type CrewMember,
  type CrewRole,
} from './crew-types'
import {
  listAllCrewMembers,
  listStoredCrewRoles,
  restoreCrewMember,
  softDeleteCrewMember,
  upsertCrewMember,
  upsertCrewRole,
} from './crew-store'

interface CrewContextValue {
  /** Wszystkie role (zapisane + wbudowane z cennika domyślnego), także wycofane, w kolejności grup. */
  roles: CrewRole[]
  /** Role do wyboru (bez wycofanych). */
  activeRoles: CrewRole[]
  /** Jak `roles`, ale wbudowane ze stawkami z cennika otwartej wyceny — tylko w kalkulatorze. */
  quoteRoles: CrewRole[]
  quoteActiveRoles: CrewRole[]
  /** Id ról zapisanych w pliku; wbudowana rola spoza tego zbioru idzie za cennikiem. */
  storedRoleIds: Set<string>
  /** Ludzie bez usuniętych (wycofani zostają). */
  people: CrewMember[]
  /** Wszyscy, z usuniętymi — do cofania. */
  allPeople: CrewMember[]
  isLoading: boolean
  /** Zapis roli; pierwsza edycja wbudowanej roli zapisuje ją do pliku. */
  saveRole: (role: CrewRole) => Promise<void>
  addRole: (params: { name: string; group?: string; clientRate?: number; costRate?: number }) => Promise<CrewRole | null>
  addPerson: (params: Parameters<typeof createCrewMember>[0]) => Promise<CrewMember | null>
  savePerson: (member: CrewMember) => Promise<void>
  /** Miękkie usunięcie (`deletedAt`); `restorePerson` je cofa. */
  removePerson: (id: string) => Promise<void>
  restorePerson: (id: string) => Promise<void>
}

const CrewContext = createContext<CrewContextValue | null>(null)

export function CrewProvider({ children }: { children: React.ReactNode }) {
  const { pricingConfig } = useQuote()
  const [defaultPricing, setDefaultPricing] = useState<PricingConfigShape | null>(null)
  const [storedRoles, setStoredRoles] = useState<CrewRole[]>([])
  const [allPeople, setAllPeople] = useState<CrewMember[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    const [roles, people] = await Promise.all([listStoredCrewRoles(), listAllCrewMembers()])
    setStoredRoles(roles)
    setAllPeople(people)
    setDefaultPricing(getSavedUserDefault())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    const onDefaultPricing = () => setDefaultPricing(getSavedUserDefault())
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(USER_DEFAULT_PRICING_EVENT, onDefaultPricing)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(USER_DEFAULT_PRICING_EVENT, onDefaultPricing)
    }
  }, [reload])

  const roles = useMemo(
    () => resolveCrewRoles(storedRoles, defaultPricing ?? pricingConfig),
    [storedRoles, defaultPricing, pricingConfig]
  )
  const activeRoles = useMemo(() => activeCrewRoles(roles), [roles])
  const quoteRoles = useMemo(() => resolveCrewRoles(storedRoles, pricingConfig), [storedRoles, pricingConfig])
  const quoteActiveRoles = useMemo(() => activeCrewRoles(quoteRoles), [quoteRoles])
  const people = useMemo(() => liveCrewMembers(allPeople), [allPeople])
  const storedRoleIds = useMemo(() => new Set(storedRoles.map((r) => r.id)), [storedRoles])

  const saveRole = useCallback(async (role: CrewRole) => {
    setStoredRoles(await upsertCrewRole({ ...role, updatedAt: new Date().toISOString() }))
  }, [])

  const addRole = useCallback<CrewContextValue['addRole']>(
    async (params) => {
      if (!params.name.trim()) return null
      const role = createCrewRole(params, roles)
      setStoredRoles(await upsertCrewRole(role))
      return role
    },
    [roles]
  )

  const addPerson = useCallback<CrewContextValue['addPerson']>(async (params) => {
    if (!params.name.trim()) return null
    const member = createCrewMember(params)
    setAllPeople(await upsertCrewMember(member))
    return member
  }, [])

  const savePerson = useCallback(async (member: CrewMember) => {
    setAllPeople(await upsertCrewMember({ ...member, updatedAt: new Date().toISOString() }))
  }, [])

  const removePerson = useCallback(async (id: string) => {
    setAllPeople(await softDeleteCrewMember(id, new Date().toISOString()))
  }, [])

  const restorePerson = useCallback(async (id: string) => {
    setAllPeople(await restoreCrewMember(id))
  }, [])

  const value: CrewContextValue = {
    roles,
    activeRoles,
    quoteRoles,
    quoteActiveRoles,
    storedRoleIds,
    people,
    allPeople,
    isLoading,
    saveRole,
    addRole,
    addPerson,
    savePerson,
    removePerson,
    restorePerson,
  }
  return <CrewContext.Provider value={value}>{children}</CrewContext.Provider>
}

export function useCrew(): CrewContextValue {
  const ctx = useContext(CrewContext)
  if (!ctx) throw new Error('useCrew musi być użyty wewnątrz CrewProvider')
  return ctx
}
