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

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuote } from './quote-context'
import {
  createProject,
  deleteProject as deleteProjectRecord,
  listAllProjects,
  replaceAllProjects,
  restoreProject as restoreProjectRecord,
  upsertProject,
} from './project-library'
import { listImportableQuotes } from './legacy-app'
import { migrateQuotesToProjects, type MigrationResult } from './project-migration'
import { backfillMissingFinancials } from './quote-financials'
import { toDateKey, type Project, type ProjectFilter, type ProjectStatus } from './project-types'
import { blankQuoteSnapshot, canReprefillBlankQuote, planProjectSave, type ProjectSavePlan } from './project-save'
import { applyClientChoice, type ClientChoice } from './clients'
import { parseListPrefs, type ProjectListPrefs } from './project-list'

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
  filter: ProjectFilter
  setFilter: (filter: ProjectFilter) => void
  /** „Ukryj nieprzyjęte" — domyślnie włączone, zapamiętywane między uruchomieniami. */
  hideLost: boolean
  setHideLost: (hide: boolean) => void
  /** Klient na liście (klucz `clientKey`, pusty = wszyscy) — zapamiętywany. */
  listClient: string
  setListClient: (key: string) => void
  /** Rok na liście (`null` = wszystkie) — zapamiętywany. */
  listYear: number | null
  setListYear: (year: number | null) => void
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
  /**
   * Klient otwartego projektu (nagłówek). Kopiuje kontakt z ostatniego projektu
   * tego klienta, gdy bieżący go nie ma (`clients.ts`), a pustą wycenę wgrywa
   * na nowo z nowym klientem, jeśli nic by przy tym nie przepadło.
   */
  changeActiveClient: (name: string) => Promise<ClientChoice | null>
  setStatus: (id: string, status: ProjectStatus) => Promise<void>
  /**
   * Miękkie usunięcie projektu (`deletedAt`). Zwraca usunięty rekord — jego
   * znacznik dostaje też wątek (`project-deletion.ts`), a „Cofnij" go przywraca.
   */
  removeProject: (id: string, deletedAt?: string) => Promise<Project | null>
  restoreProject: (id: string) => Promise<void>

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
const LIST_PREFS_KEY = 'nonoise-projects-list-v1'

function readListPrefs(): ProjectListPrefs {
  try {
    return parseListPrefs(localStorage.getItem(LIST_PREFS_KEY))
  } catch {
    return parseListPrefs(null)
  }
}

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

  const [projects, setProjectsState] = useState<Project[]>([])
  // Najświeższa lista także dla zapisów odpalonych z opóźnieniem (autozapis
  // notatek) — inaczej zapis na starej kopii projektu cofnąłby nowszą zmianę.
  const projectsRef = useRef<Project[]>([])
  const setProjects = useCallback((next: Project[]) => {
    projectsRef.current = next
    setProjectsState(next)
  }, [])
  // Numer ostatniego zapisu: wynik starszego zapisu nie może cofnąć na ekranie
  // zmiany, która jest już w drodze.
  const writeSeqRef = useRef(0)
  const [listPrefs, setListPrefs] = useState(readListPrefs)
  const [hideLost, setHideLostState] = useState(readHideLost)

  const updateListPrefs = useCallback((patch: Partial<ProjectListPrefs>) => {
    setListPrefs((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(next))
      } catch {
        // tylko wygoda — bez zapisu lista wróci do domyślnych filtrów
      }
      return next
    })
  }, [])
  const setFilter = useCallback((filter: ProjectFilter) => updateListPrefs({ filter }), [updateListPrefs])
  const setListClient = useCallback((client: string) => updateListPrefs({ client }), [updateListPrefs])
  const setListYear = useCallback((year: number | null) => updateListPrefs({ year }), [updateListPrefs])

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
      const [loaded, quotes] = await Promise.all([listAllProjects(), listImportableQuotes()])
      if (cancelled) return
      setProjects(loaded.filter((p) => !p.deletedAt))
      // Usunięte też się liczą: usunięta wycena nie jest „do przeniesienia".
      const migratedIds = new Set(
        loaded.map((p) => p.migratedFromQuoteId).filter((id): id is string => !!id)
      )
      setPendingQuoteCount(quotes.filter((q) => !migratedIds.has(q.id)).length)
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [setProjects])

  /** Zapis jednego projektu: od razu na ekranie, potem do pliku. */
  const writeProject = useCallback(
    async (updated: Project) => {
      const seq = ++writeSeqRef.current
      setProjects(projectsRef.current.map((p) => (p.id === updated.id ? updated : p)))
      const saved = await upsertProject(updated)
      if (seq === writeSeqRef.current) setProjects(saved)
    },
    [setProjects]
  )

  /** Zmiana pól na NAJŚWIEŻSZEJ wersji projektu (nie na kopii z domknięcia). */
  const patchProject = useCallback(
    async (id: string, patch: Partial<Project>) => {
      const current = projectsRef.current.find((p) => p.id === id)
      if (!current) return null
      const updated: Project = { ...current, ...patch, id, updatedAt: new Date().toISOString() }
      await writeProject(updated)
      return updated
    },
    [writeProject]
  )

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
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
      const project = createProject({ name: trimmed, existing: projectsRef.current })
      setProjects(await upsertProject(project))
      loadQuoteSnapshot(blankQuoteSnapshot('') as never)
      setActiveProjectId(project.id)
      return project
    },
    [loadQuoteSnapshot, setProjects]
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
        existing: projectsRef.current,
      })
      setProjects(await upsertProject(project))
      return project
    },
    [setProjects]
  )

  const saveActiveProject = useCallback(
    async (options: { replaceFinancials?: boolean } = {}): Promise<SaveActiveProjectResult> => {
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      if (!project) return { status: 'no-project' }
      // Projekt bez wyceny otwiera się w pustym kalkulatorze — ślepy zapis
      // wyzerowałby jego finanse z importu. Decyzja i testy: `project-save.ts`.
      const plan = planProjectSave({
        project,
        snapshot: buildQuoteSnapshot(),
        replaceFinancials: options.replaceFinancials,
      })
      if (plan.status === 'needs-confirmation') return plan
      await writeProject(plan.project)
      return { status: 'saved' }
    },
    [activeProjectId, buildQuoteSnapshot, writeProject]
  )

  const updateActiveProject = useCallback(
    async (patch: Partial<Project>) => {
      if (activeProjectId) await patchProject(activeProjectId, patch)
    },
    [activeProjectId, patchProject]
  )

  const changeActiveClient = useCallback(
    async (name: string) => {
      const project = projectsRef.current.find((p) => p.id === activeProjectId)
      if (!project) return null
      const choice = applyClientChoice(project, name, projectsRef.current)
      if (!choice) return null
      // Przed zapisem: decyzja dotyczy kalkulatora z chwili zmiany.
      const reprefill = canReprefillBlankQuote(project, buildQuoteSnapshot())
      await patchProject(project.id, choice.patch)
      if (reprefill) loadQuoteSnapshot(blankQuoteSnapshot(choice.patch.client) as never)
      return choice
    },
    [activeProjectId, buildQuoteSnapshot, loadQuoteSnapshot, patchProject]
  )

  const setStatus = useCallback(
    async (id: string, status: ProjectStatus) => {
      await patchProject(id, { status })
    },
    [patchProject]
  )

  const updateProject = useCallback(
    async (id: string, patch: Partial<Project>) => {
      await patchProject(id, patch)
    },
    [patchProject]
  )

  const removeProject = useCallback(
    async (id: string, deletedAt: string = new Date().toISOString()) => {
      const project = projectsRef.current.find((p) => p.id === id)
      if (!project) return null
      if (activeProjectId === id) setActiveProjectId(null)
      writeSeqRef.current += 1
      setProjects(await deleteProjectRecord(id, deletedAt))
      return { ...project, deletedAt }
    },
    [activeProjectId, setProjects]
  )

  const restoreProject = useCallback(
    async (id: string) => {
      writeSeqRef.current += 1
      setProjects(await restoreProjectRecord(id))
    },
    [setProjects]
  )

  const runMigration = useCallback(async () => {
    const result = await migrateQuotesToProjects()
    setProjects((await listAllProjects()).filter((p) => !p.deletedAt))
    if (result.status === 'migrated' || result.status === 'skipped-already-done') {
      setPendingQuoteCount(0)
    }
    return result
  }, [setProjects])

  /** Projekt bez wyceny nie ma czego liczyć — nie jest „brakującym" wynikiem. */
  const missingFinancialsCount = useMemo(
    () => projects.filter((p) => !p.financials && p.quote).length,
    [projects]
  )

  const backfillFinancials = useCallback(async () => {
    // Pełna lista z usuniętymi — zapis całej kolekcji nie może ich zgubić.
    const current = await listAllProjects()
    const result = backfillMissingFinancials(current)
    writeSeqRef.current += 1
    if (result.filledCount > 0) {
      setProjects(await replaceAllProjects(result.projects))
    } else {
      setProjects(current.filter((p) => !p.deletedAt))
    }
    return { filledCount: result.filledCount, skippedCount: result.skippedCount }
  }, [setProjects])

  const value: ProjectHubValue = {
    projects,
    filter: listPrefs.filter,
    setFilter,
    hideLost,
    setHideLost,
    listClient: listPrefs.client,
    setListClient,
    listYear: listPrefs.year,
    setListYear,
    activeProject,
    isLoading,
    openProject,
    closeProject,
    createBlankProject,
    createProjectWithoutQuote,
    saveActiveProject,
    updateActiveProject,
    updateProject,
    changeActiveClient,
    setStatus,
    removeProject,
    restoreProject,
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
