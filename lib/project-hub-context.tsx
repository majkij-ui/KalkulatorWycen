'use client'

/**
 * Kontekst „Project Hub" — projekty i ich dokumenty wyceny.
 *
 * Od Q1 nie ma jednego kalkulatora, do którego projekt się wgrywa: każdy
 * projekt ma własny dokument wyceny w magazynie `quoteDocs`
 * (`quote-documents.ts`), który sam zapisuje go do projektu. Hub zapisuje
 * czekające zmiany przy przejściu do innego projektu, przy zamknięciu
 * projektu, gdy okno traci fokus i przed zamknięciem okna. `QuoteProvider`
 * (pod spodem) daje zakładkom wycenę otwartego projektu.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  createProject,
  deleteProject as deleteProjectRecord,
  listAllProjects,
  listProjects,
  patchProjects,
  replaceAllProjects,
  restoreProject as restoreProjectRecord,
  upsertProject,
} from './project-library'
import { backfillMissingFinancials } from './quote-financials'
import { getSavedUserDefault } from './pricing-config'
import { toDateKey, type Project, type ProjectFilter, type ProjectStatus } from './project-types'
import { blankDoc, createQuoteDocumentStore, docToSnapshot, type QuoteDocState, type QuoteDocumentStore } from './quote-documents'
import {
  addVariantPatch,
  asksWhichVariant,
  chooseVariantPlan,
  createVariantId,
  deleteVariantPatch,
  renameVariantPatch,
  restoreVariantPatch,
  variantSnapshotPatch,
  type ChooseVariantPlan,
} from './quote-variants'
import { isTauriRuntime } from './storage'
import { applyClientChoice, type ClientChoice } from './clients'
import { parseListPrefs, type ProjectListPrefs } from './project-list'

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

  /** Otwiera projekt (jego wycena to jego własny dokument). Czekające zmiany poprzedniego zapisują się od razu. */
  openProject: (id: string) => Promise<void>
  /** Wraca do listy; czekające zmiany wyceny zapisują się od razu. */
  closeProject: () => void
  /**
   * Nowy, PUSTY projekt (bez wyceny), od razu otwarty z pustą wyceną i moim
   * domyślnym cennikiem. Nic nie przechodzi z poprzednio otwartego projektu.
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
  /** Dokumenty wycen projektów — same zapisują się do projektów (`quote-documents.ts`). */
  quoteDocs: QuoteDocumentStore
  updateActiveProject: (patch: Partial<Project>) => Promise<void>
  /** Zmiana pól dowolnego projektu (nie dotyka wyceny w kalkulatorze). */
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>
  /** Zmiana pól wielu projektów jednym zapisem (np. „Scal nazwy" klienta). */
  updateProjects: (patches: { id: string; patch: Partial<Project> }[]) => Promise<void>
  /**
   * Klient otwartego projektu (nagłówek). Kopiuje kontakt z ostatniego projektu
   * tego klienta, gdy bieżący go nie ma (`clients.ts`). Pusta wycena projektu
   * bez wyceny bierze klienta z projektu, więc idzie za zmianą sama.
   */
  changeActiveClient: (name: string) => Promise<ClientChoice | null>
  setStatus: (id: string, status: ProjectStatus) => Promise<void>
  /**
   * Zmiana statusu z ekranu (nagłówek, sugestia po wydarzeniu). Przejście do
   * „W realizacji" / „Zrealizowany" projektu z wariantami najpierw pyta, który
   * wariant przyjął klient (`statusQuestion`) — status zmienia dopiero odpowiedź.
   */
  requestStatus: (id: string, status: ProjectStatus) => Promise<void>
  /** Otwarte pytanie „Który wariant przyjął klient?" (`null` = brak). */
  statusQuestion: { projectId: string; to: ProjectStatus } | null
  /** Odpowiedź: id wariantu (wybór + status) albo `null` = anuluj (nic się nie zmienia). */
  answerStatusQuestion: (variantId: string | null) => Promise<'done' | 'blocked'>

  // Warianty wyceny (Q2, `quote-variants.ts`)
  /**
   * „+ Wariant": kopia dokumentu `fromDocId` (z niezapisanymi zmianami) albo
   * pusta wycena (`null`, mój domyślny cennik). Zwraca id nowego wariantu.
   */
  addVariant: (projectId: string, fromDocId: string | null) => Promise<string | null>
  renameVariant: (projectId: string, variantId: string, label: string) => Promise<void>
  /** Miękkie usunięcie; wybranego nie da się usunąć (`false`). */
  deleteVariant: (projectId: string, variantId: string) => Promise<boolean>
  restoreVariant: (projectId: string, variantId: string) => Promise<void>
  /**
   * „Wybrany do rozliczeń": zamiana migawek i finanse z nowego wyboru.
   * Wszystkie dokumenty projektu zapisują się przed zamianą; potem budują się
   * od nowa (nowy punkt „Cofnij zmiany z tej sesji").
   */
  chooseVariant: (projectId: string, variantId: string) => Promise<ChooseVariantPlan>
  /**
   * Miękkie usunięcie projektu (`deletedAt`). Zwraca usunięty rekord — jego
   * znacznik dostaje też wątek (`project-deletion.ts`), a „Cofnij" go przywraca.
   */
  removeProject: (id: string, deletedAt?: string) => Promise<Project | null>
  restoreProject: (id: string) => Promise<void>
  /** Wczytuje projekty z pliku od nowa (np. po imporcie ze starej aplikacji). */
  reloadProjects: () => Promise<void>
  /** Najświeższa lista projektów (także zaraz po zapisie, przed nowym renderem). */
  latestProjects: () => Project[]

  /** Projekty bez policzonych finansów (np. świeżo zmigrowane). */
  missingFinancialsCount: number
  /** Liczy brakujące finanse z migawek wycen; istniejących nie rusza. */
  backfillFinancials: () => Promise<{ filledCount: number; skippedCount: number }>
}

const ProjectHubContext = createContext<ProjectHubValue | null>(null)

const HIDE_LOST_KEY = 'nonoise-projects-hide-lost'
/** Zamknięcie okna czeka na zapis wycen najwyżej tyle — potem okno i tak się zamyka. */
const CLOSE_FLUSH_TIMEOUT_MS = 3000
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
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeProjectId
  const [isLoading, setIsLoading] = useState(true)

  // Pierwsze wczytanie. Starej aplikacji nie sprawdzamy przy starcie — import
  // jest przyciskiem w Ustawieniach (decyzja M.J. 2026-10-16).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await listAllProjects()
      if (cancelled) return
      setProjects(loaded.filter((p) => !p.deletedAt))
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [setProjects])

  const latestProjects = useCallback(() => projectsRef.current, [])

  const reloadProjects = useCallback(async () => {
    writeSeqRef.current += 1
    setProjects(await listProjects())
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

  // Dokumenty wycen: zapis idzie łatą na najświeższą wersję projektu, więc nie
  // cofa zmian zrobionych w międzyczasie w nagłówku, Realizacji czy Notatkach.
  const patchProjectRef = useRef(patchProject)
  patchProjectRef.current = patchProject
  const [quoteDocs] = useState(() =>
    createQuoteDocumentStore({
      getProject: (id) => projectsRef.current.find((p) => p.id === id) ?? null,
      defaultPricing: getSavedUserDefault,
      write: async (id, patch) => {
        await patchProjectRef.current(id, patch)
      },
      // Wariant: tylko jego wpis na NAJŚWIEŻSZEJ wersji projektu (bez finansów).
      writeVariant: async (projectId, variantId, snapshot) => {
        const latest = projectsRef.current.find((p) => p.id === projectId)
        const patch = latest ? variantSnapshotPatch(latest, variantId, snapshot, new Date()) : null
        if (patch) await patchProjectRef.current(projectId, patch)
      },
    })
  )

  // Okno traci fokus, chowa się albo zamyka — czekające zmiany idą do pliku od razu.
  useEffect(() => {
    const flushAll = () => void quoteDocs.flushAll()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll()
    }
    window.addEventListener('blur', flushAll)
    window.addEventListener('pagehide', flushAll)
    document.addEventListener('visibilitychange', onVisibility)

    // Desktop: zamknięcie okna czeka na zapis (najwyżej kilka sekund), potem okno się zamyka.
    let unlisten: (() => void) | null = null
    let disposed = false
    if (isTauriRuntime()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onCloseRequested(async () => {
            await Promise.race([
              quoteDocs.flushAll().catch(() => undefined),
              new Promise((resolve) => setTimeout(resolve, CLOSE_FLUSH_TIMEOUT_MS)),
            ])
          })
        )
        .then((stop) => {
          if (disposed) stop()
          else unlisten = stop
        })
        .catch((err) => console.error('Zapis wycen przy zamknięciu okna niedostępny:', err))
    }

    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('blur', flushAll)
      window.removeEventListener('pagehide', flushAll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [quoteDocs])

  /** Wyjście z projektu: jego czekające zmiany zapisują się od razu, bez czekania na opóźnienie. */
  const leaveActive = useCallback(() => {
    const current = activeIdRef.current
    if (current) void quoteDocs.flushProject(current)
  }, [quoteDocs])

  const openProject = useCallback(
    async (id: string) => {
      if (!projectsRef.current.some((p) => p.id === id)) return
      if (activeIdRef.current !== id) leaveActive()
      setActiveProjectId(id)
    },
    [leaveActive]
  )

  const closeProject = useCallback(() => {
    leaveActive()
    setActiveProjectId(null)
  }, [leaveActive])

  // Nowy projekt zawsze startuje od pustej wyceny — nic z poprzednio otwartego.
  const createBlankProject = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const project = createProject({ name: trimmed, existing: projectsRef.current })
      setProjects(await upsertProject(project))
      leaveActive()
      setActiveProjectId(project.id)
      return project
    },
    [leaveActive, setProjects]
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
      await patchProject(project.id, choice.patch)
      return choice
    },
    [activeProjectId, patchProject]
  )

  const setStatus = useCallback(
    async (id: string, status: ProjectStatus) => {
      await patchProject(id, { status })
    },
    [patchProject]
  )

  // ── Warianty wyceny ───────────────────────────────────────────────────────

  const addVariant = useCallback(
    async (projectId: string, fromDocId: string | null) => {
      const project = projectsRef.current.find((p) => p.id === projectId)
      if (!project) return null
      const now = new Date()
      const source = fromDocId ? quoteDocs.get(fromDocId) : blankDoc(project.client, getSavedUserDefault())
      const { patch, variant } = addVariantPatch(project, {
        id: createVariantId(),
        snapshot: docToSnapshot(source, now),
        now,
      })
      await patchProject(projectId, patch)
      return variant.id
    },
    [patchProject, quoteDocs]
  )

  const renameVariant = useCallback(
    async (projectId: string, variantId: string, label: string) => {
      const project = projectsRef.current.find((p) => p.id === projectId)
      const patch = project ? renameVariantPatch(project, variantId, label, new Date()) : null
      if (patch) await patchProject(projectId, patch)
    },
    [patchProject]
  )

  const deleteVariant = useCallback(
    async (projectId: string, variantId: string) => {
      const docId = `${projectId}#${variantId}`
      // Czekające zmiany najpierw do pliku — „Cofnij" przywraca wariant z nimi.
      await quoteDocs.flush(docId)
      const project = projectsRef.current.find((p) => p.id === projectId)
      const patch = project ? deleteVariantPatch(project, variantId, new Date()) : null
      if (!patch) return false
      await patchProject(projectId, patch)
      quoteDocs.forget(docId)
      return true
    },
    [patchProject, quoteDocs]
  )

  const restoreVariant = useCallback(
    async (projectId: string, variantId: string) => {
      const project = projectsRef.current.find((p) => p.id === projectId)
      const patch = project ? restoreVariantPatch(project, variantId) : null
      if (patch) await patchProject(projectId, patch)
    },
    [patchProject]
  )

  const chooseVariant = useCallback(
    async (projectId: string, variantId: string): Promise<ChooseVariantPlan> => {
      await quoteDocs.flushProject(projectId)
      // Zmiany czekające na „Zastąp" żyją tylko w pamięci — zamiana by je zgubiła.
      if (quoteDocs.pendingIds().some((id) => id === projectId || id.startsWith(`${projectId}#`))) return { status: 'blocked' }
      const project = projectsRef.current.find((p) => p.id === projectId)
      if (!project) return { status: 'missing' }
      const plan = chooseVariantPlan(project, variantId, new Date())
      if (plan.status !== 'ready') return plan
      await patchProject(projectId, plan.patch)
      // Migawki zamieniły się miejscami — dokumenty projektu budują się od nowa.
      quoteDocs.forget(projectId)
      return plan
    },
    [patchProject, quoteDocs]
  )

  const [statusQuestion, setStatusQuestion] = useState<ProjectHubValue['statusQuestion']>(null)

  const requestStatus = useCallback(
    async (id: string, status: ProjectStatus) => {
      const project = projectsRef.current.find((p) => p.id === id)
      if (!project) return
      if (asksWhichVariant(project, status)) {
        setStatusQuestion({ projectId: id, to: status })
        return
      }
      await patchProject(id, { status })
    },
    [patchProject]
  )

  const answerStatusQuestion = useCallback(
    async (variantId: string | null) => {
      const question = statusQuestion
      if (!question || variantId === null) {
        setStatusQuestion(null)
        return 'done' as const
      }
      const plan = await chooseVariant(question.projectId, variantId)
      // Pytanie zostaje otwarte — najpierw decyzja o finansach z importu.
      if (plan.status === 'blocked') return 'blocked' as const
      setStatusQuestion(null)
      if (plan.status !== 'missing') await patchProject(question.projectId, { status: question.to })
      return 'done' as const
    },
    [chooseVariant, patchProject, statusQuestion]
  )

  const updateProject = useCallback(
    async (id: string, patch: Partial<Project>) => {
      await patchProject(id, patch)
    },
    [patchProject]
  )

  const updateProjects = useCallback(
    async (patches: { id: string; patch: Partial<Project> }[]) => {
      if (!patches.length) return
      const updatedAt = new Date().toISOString()
      const byId = new Map(patches.map(({ id, patch }) => [id, patch]))
      const seq = ++writeSeqRef.current
      setProjects(
        projectsRef.current.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id), id: p.id, updatedAt } : p))
      )
      const saved = await patchProjects(patches, updatedAt)
      if (seq === writeSeqRef.current) setProjects(saved)
    },
    [setProjects]
  )

  const removeProject = useCallback(
    async (id: string, deletedAt: string = new Date().toISOString()) => {
      // Czekające zmiany wyceny najpierw do pliku — „Cofnij" przywraca projekt z nimi.
      await quoteDocs.flush(id)
      const project = projectsRef.current.find((p) => p.id === id)
      if (!project) return null
      if (activeIdRef.current === id) setActiveProjectId(null)
      writeSeqRef.current += 1
      setProjects(await deleteProjectRecord(id, deletedAt))
      quoteDocs.forget(id)
      return { ...project, deletedAt }
    },
    [quoteDocs, setProjects]
  )

  const restoreProject = useCallback(
    async (id: string) => {
      writeSeqRef.current += 1
      setProjects(await restoreProjectRecord(id))
    },
    [setProjects]
  )

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
    quoteDocs,
    updateActiveProject,
    updateProject,
    updateProjects,
    changeActiveClient,
    setStatus,
    requestStatus,
    statusQuestion,
    answerStatusQuestion,
    addVariant,
    renameVariant,
    deleteVariant,
    restoreVariant,
    chooseVariant,
    removeProject,
    restoreProject,
    reloadProjects,
    latestProjects,
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

/** Stan zapisu wyceny projektu (nagłówek: „Zapisano", pytanie o import, „Cofnij zmiany z tej sesji"). */
export function useQuoteDocState(projectId: string | null): QuoteDocState | null {
  const { quoteDocs } = useProjectHub()
  useSyncExternalStore(quoteDocs.subscribe, quoteDocs.version, quoteDocs.version)
  return projectId ? quoteDocs.state(projectId) : null
}

/** Dzisiejsza data jako `YYYY-MM-DD` — do pól formularza. */
export function todayKey(): string {
  return toDateKey(new Date())
}
