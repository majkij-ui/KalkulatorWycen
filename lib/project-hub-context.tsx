'use client'

/**
 * Kontekst „Project Hub" — warstwa projektów nad istniejącym kalkulatorem.
 *
 * Siedzi WEWNĄTRZ `QuoteProvider`, bo cała integracja sprowadza się do dwóch
 * mostków do kalkulatora:
 *   otwarcie projektu → `loadQuoteSnapshot(project.quote)`
 *   zapis projektu    → `buildQuoteSnapshot()` + policzone finanse
 *
 * Dzięki temu kalkulator nie wie o istnieniu projektów i nie wymaga zmian.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQuote } from './quote-context'
import {
  createProject,
  deleteProject as deleteProjectRecord,
  filterProjects,
  listProjects,
  upsertProject,
} from './project-library'
import { listSavedQuotes } from './quote-library'
import { migrateQuotesToProjects, type MigrationResult } from './project-migration'
import { computeProfitSummary, resolveProfitSections } from './profit-calc'
import { toDateKey, type Project, type ProjectFilter, type ProjectStatus } from './project-types'

interface ProjectHubValue {
  projects: Project[]
  /** Projekty po zastosowaniu aktywnego filtra listy. */
  visibleProjects: Project[]
  filter: ProjectFilter
  setFilter: (filter: ProjectFilter) => void
  activeProject: Project | null
  isLoading: boolean

  /** Otwiera projekt w kalkulatorze (wgrywa jego migawkę wyceny). */
  openProject: (id: string) => Promise<void>
  /** Wraca do listy bez zapisywania. */
  closeProject: () => void
  /** Tworzy nowy projekt z BIEŻĄCEGO stanu kalkulatora. */
  createFromCurrentQuote: (name: string) => Promise<Project | null>
  /** Zapisuje stan kalkulatora do otwartego projektu (wraz z finansami). */
  saveActiveProject: () => Promise<void>
  updateActiveProject: (patch: Partial<Project>) => Promise<void>
  setStatus: (id: string, status: ProjectStatus) => Promise<void>
  removeProject: (id: string) => Promise<void>

  /** Ile starych wycen czeka na przeniesienie (0 = nic do zrobienia). */
  pendingQuoteCount: number
  runMigration: () => Promise<MigrationResult>
}

const ProjectHubContext = createContext<ProjectHubValue | null>(null)

export function ProjectHubProvider({ children }: { children: React.ReactNode }) {
  const {
    data,
    pricingConfig,
    totals,
    calculateTotalCrewDays,
    buildQuoteSnapshot,
    loadQuoteSnapshot,
  } = useQuote()

  const [projects, setProjects] = useState<Project[]>([])
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [pendingQuoteCount, setPendingQuoteCount] = useState(0)

  // Pierwsze wczytanie + sprawdzenie, czy są stare wyceny do przeniesienia.
  // Migracji NIE uruchamiamy automatycznie — to ruch na realnych danych
  // użytkownika, więc decyzja należy do niego (banner w liście projektów).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [loaded, quotes] = await Promise.all([listProjects(), listSavedQuotes()])
      if (cancelled) return
      setProjects(loaded)
      const migratedIds = new Set(
        loaded.map((p) => p.migratedFromQuoteId).filter((id): id is string => !!id)
      )
      setPendingQuoteCount(quotes.filter((q) => !migratedIds.has(q.id)).length)
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )

  const visibleProjects = useMemo(() => filterProjects(projects, filter), [projects, filter])

  /** Migawka finansowa liczona tak samo jak w zakładce Profit. */
  const computeFinancials = useCallback(() => {
    const { totalCost } = resolveProfitSections(data, pricingConfig, calculateTotalCrewDays())
    const transferAmount = data.profitTransferAmount ?? totals.sumaNetto
    const summary = computeProfitSummary(transferAmount, data.profitTaxRatePercent, totalCost)
    return {
      sumaNetto: summary.sumaNetto,
      koszty: summary.koszty,
      podatek: summary.podatek,
      zysk: summary.zysk,
      marzaPct: summary.marzaPct,
      computedAt: new Date().toISOString(),
    }
  }, [data, pricingConfig, totals.sumaNetto, calculateTotalCrewDays])

  const openProject = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id)
      if (!project) return
      loadQuoteSnapshot(project.quote as never)
      setActiveProjectId(id)
    },
    [projects, loadQuoteSnapshot]
  )

  const closeProject = useCallback(() => {
    setActiveProjectId(null)
  }, [])

  const createFromCurrentQuote = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const project = createProject({
        name: trimmed,
        quote: buildQuoteSnapshot(),
        client: data.clientName ?? '',
      })
      const withFinancials: Project = { ...project, financials: computeFinancials() }
      const next = await upsertProject(withFinancials)
      setProjects(next)
      setActiveProjectId(withFinancials.id)
      return withFinancials
    },
    [buildQuoteSnapshot, data.clientName, computeFinancials]
  )

  const saveActiveProject = useCallback(async () => {
    if (!activeProject) return
    const updated: Project = {
      ...activeProject,
      quote: buildQuoteSnapshot(),
      client: data.clientName || activeProject.client,
      financials: computeFinancials(),
      updatedAt: new Date().toISOString(),
    }
    setProjects(await upsertProject(updated))
  }, [activeProject, buildQuoteSnapshot, data.clientName, computeFinancials])

  const updateActiveProject = useCallback(
    async (patch: Partial<Project>) => {
      if (!activeProject) return
      const updated: Project = { ...activeProject, ...patch, updatedAt: new Date().toISOString() }
      setProjects(await upsertProject(updated))
    },
    [activeProject]
  )

  const setStatus = useCallback(
    async (id: string, status: ProjectStatus) => {
      const project = projects.find((p) => p.id === id)
      if (!project) return
      setProjects(await upsertProject({ ...project, status, updatedAt: new Date().toISOString() }))
    },
    [projects]
  )

  const removeProject = useCallback(
    async (id: string) => {
      const next = await deleteProjectRecord(id)
      setProjects(next)
      if (activeProjectId === id) setActiveProjectId(null)
    },
    [activeProjectId]
  )

  const runMigration = useCallback(async () => {
    const result = await migrateQuotesToProjects()
    setProjects(await listProjects())
    if (result.status === 'migrated' || result.status === 'skipped-already-done') {
      setPendingQuoteCount(0)
    }
    return result
  }, [])

  const value: ProjectHubValue = {
    projects,
    visibleProjects,
    filter,
    setFilter,
    activeProject,
    isLoading,
    openProject,
    closeProject,
    createFromCurrentQuote,
    saveActiveProject,
    updateActiveProject,
    setStatus,
    removeProject,
    pendingQuoteCount,
    runMigration,
  }

  return <ProjectHubContext.Provider value={value}>{children}</ProjectHubContext.Provider>
}

export function useProjectHub(): ProjectHubValue {
  const ctx = useContext(ProjectHubContext)
  if (!ctx) throw new Error('useProjectHub musi być użyty wewnątrz ProjectHubProvider')
  return ctx
}

/** Dzisiejsza data jako `YYYY-MM-DD` — do pól formularza. */
export function todayKey(): string {
  return toDateKey(new Date())
}
