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
  replaceAllProjects,
  upsertProject,
} from './project-library'
import { listImportableQuotes } from './legacy-app'
import { migrateQuotesToProjects, type MigrationResult } from './project-migration'
import { backfillMissingFinancials } from './quote-financials'
import { toDateKey, type Project, type ProjectFilter, type ProjectStatus } from './project-types'
import { blankQuoteSnapshot, planProjectSave, type ProjectSavePlan } from './project-save'

/**
 * Wynik „Zapisz". `needs-confirmation` — projekt bez wyceny ma finanse spoza
 * kalkulatora (np. retro-import), a zapis wyceny by je zastąpił. Nic nie
 * zapisano; po zgodzie użytkownika ponów z `replaceFinancials: true`.
 */
export type SaveActiveProjectResult =
  | { status: 'saved' }
  | { status: 'no-project' }
  | Extract<ProjectSavePlan, { status: 'needs-confirmation' }>

interface ProjectHubValue {
  projects: Project[]
  /** Projekty po zastosowaniu aktywnego filtra listy. */
  visibleProjects: Project[]
  filter: ProjectFilter
  setFilter: (filter: ProjectFilter) => void
  /** „Ukryj nieprzyjęte" — domyślnie włączone, zapamiętywane między uruchomieniami. */
  hideLost: boolean
  setHideLost: (hide: boolean) => void
  activeProject: Project | null
  isLoading: boolean

  /** Otwiera projekt w kalkulatorze (wgrywa jego migawkę wyceny). */
  openProject: (id: string) => Promise<void>
  /** Wraca do listy bez zapisywania. */
  closeProject: () => void
  /**
   * Nowy, PUSTY projekt (bez wyceny), od razu otwarty w czystym kalkulatorze i
   * z czystym szkicem PDF. Nic nie przechodzi z poprzednio otwartego projektu.
   */
  createBlankProject: (name: string) => Promise<Project | null>
  /** Zakłada projekt bez wyceny (np. z zapytania w kalendarzu albo leada). Nie otwiera go. */
  createProjectWithoutQuote: (params: {
    name: string
    client?: string
    date?: string
    leadSource?: string
    contact?: Project['contact']
  }) => Promise<Project | null>
  /** Zapisuje stan kalkulatora do otwartego projektu (wraz z finansami). */
  saveActiveProject: (options?: { replaceFinancials?: boolean }) => Promise<SaveActiveProjectResult>
  updateActiveProject: (patch: Partial<Project>) => Promise<void>
  /** Zmiana pól dowolnego projektu (nie dotyka wyceny w kalkulatorze). */
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>
  setStatus: (id: string, status: ProjectStatus) => Promise<void>
  removeProject: (id: string) => Promise<void>

  /** Ile starych wycen czeka na przeniesienie (0 = nic do zrobienia). */
  pendingQuoteCount: number
  runMigration: () => Promise<MigrationResult>

  /** Projekty bez policzonych finansów (np. świeżo zmigrowane). */
  missingFinancialsCount: number
  /** Liczy brakujące finanse z migawek wycen; istniejących nie rusza. */
  backfillFinancials: () => Promise<{ filledCount: number; skippedCount: number }>
}

const ProjectHubContext = createContext<ProjectHubValue | null>(null)

const HIDE_LOST_KEY = 'nonoise-projects-hide-lost'

/** Domyślnie ukrywamy nieprzyjęte; zapamiętane „0" je pokazuje. */
function readHideLost(): boolean {
  try {
    return localStorage.getItem(HIDE_LOST_KEY) !== '0'
  } catch {
    return true
  }
}

export function ProjectHubProvider({ children }: { children: React.ReactNode }) {
  const { buildQuoteSnapshot, loadQuoteSnapshot } = useQuote()

  const [projects, setProjects] = useState<Project[]>([])
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [hideLost, setHideLostState] = useState(readHideLost)

  const setHideLost = useCallback((hide: boolean) => {
    setHideLostState(hide)
    try {
      localStorage.setItem(HIDE_LOST_KEY, hide ? '1' : '0')
    } catch {
      // tylko wygoda — bez zapisu przełącznik po prostu wróci do domyślnego
    }
  }, [])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [pendingQuoteCount, setPendingQuoteCount] = useState(0)

  // Pierwsze wczytanie + sprawdzenie, czy są stare wyceny do przeniesienia.
  // Migracji NIE uruchamiamy automatycznie — to ruch na realnych danych
  // użytkownika, więc decyzja należy do niego (banner w liście projektów).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [loaded, quotes] = await Promise.all([listProjects(), listImportableQuotes()])
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

  const visibleProjects = useMemo(
    () => filterProjects(projects, filter, { hideLost }),
    [projects, filter, hideLost]
  )

  const openProject = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id)
      if (!project) return
      // Projekt bez wyceny: czysty kalkulator z klientem z wątku, żeby
      // wycena „podjęła wątek" zamiast zostawić dane poprzedniego projektu.
      loadQuoteSnapshot((project.quote ?? blankQuoteSnapshot(project.client)) as never)
      setActiveProjectId(id)
    },
    [projects, loadQuoteSnapshot]
  )

  const closeProject = useCallback(() => {
    setActiveProjectId(null)
  }, [])

  // Dawniej „Nowy projekt" zapisywał BIEŻĄCY stan kalkulatora — a po otwarciu
  // innego projektu był to tamten projekt (z klientem i szkicem PDF). Teraz
  // nowy projekt zawsze startuje od zera; wycenę buduje się i zapisuje „Zapisz".
  const createBlankProject = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const project = createProject({ name: trimmed, existing: projects })
      setProjects(await upsertProject(project))
      loadQuoteSnapshot(blankQuoteSnapshot('') as never)
      setActiveProjectId(project.id)
      return project
    },
    [projects, loadQuoteSnapshot]
  )

  const createProjectWithoutQuote = useCallback<ProjectHubValue['createProjectWithoutQuote']>(
    async ({ name, client, date, leadSource, contact }) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const project = createProject({
        name: trimmed,
        client: client?.trim() ?? '',
        date,
        leadSource,
        contact,
        existing: projects,
      })
      setProjects(await upsertProject(project))
      return project
    },
    [projects]
  )

  const saveActiveProject = useCallback(
    async (options: { replaceFinancials?: boolean } = {}): Promise<SaveActiveProjectResult> => {
      if (!activeProject) return { status: 'no-project' }
      // Projekt bez wyceny otwiera się w pustym kalkulatorze — ślepy zapis
      // wyzerowałby jego finanse z importu. Decyzja i testy: `project-save.ts`.
      const plan = planProjectSave({
        project: activeProject,
        snapshot: buildQuoteSnapshot(),
        replaceFinancials: options.replaceFinancials,
      })
      if (plan.status === 'needs-confirmation') return plan
      setProjects(await upsertProject(plan.project))
      return { status: 'saved' }
    },
    [activeProject, buildQuoteSnapshot]
  )

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

  const updateProject = useCallback(
    async (id: string, patch: Partial<Project>) => {
      const project = projects.find((p) => p.id === id)
      if (!project) return
      setProjects(await upsertProject({ ...project, ...patch, id, updatedAt: new Date().toISOString() }))
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

  /** Projekt bez wyceny nie ma czego liczyć — nie jest „brakującym" wynikiem. */
  const missingFinancialsCount = useMemo(
    () => projects.filter((p) => !p.financials && p.quote).length,
    [projects]
  )

  const backfillFinancials = useCallback(async () => {
    const current = await listProjects()
    const result = backfillMissingFinancials(current)
    if (result.filledCount > 0) {
      setProjects(await replaceAllProjects(result.projects))
    } else {
      setProjects(current)
    }
    return { filledCount: result.filledCount, skippedCount: result.skippedCount }
  }, [])

  const value: ProjectHubValue = {
    projects,
    visibleProjects,
    filter,
    setFilter,
    hideLost,
    setHideLost,
    activeProject,
    isLoading,
    openProject,
    closeProject,
    createBlankProject,
    createProjectWithoutQuote,
    saveActiveProject,
    updateActiveProject,
    updateProject,
    setStatus,
    removeProject,
    pendingQuoteCount,
    runMigration,
    missingFinancialsCount,
    backfillFinancials,
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
