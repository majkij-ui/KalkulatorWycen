'use client'

/**
 * Biblioteka projektów — następca `quote-library.ts` w modelu v3.
 *
 * Projekty leżą w jednym `projects.json` (AppData) / localStorage, tak samo
 * jak wyceny. Stara biblioteka wycen ZOSTAJE nietknięta: migracja tylko z niej
 * czyta (patrz `project-migration.ts`), więc powrót do poprzedniej wersji apki
 * niczego nie traci.
 */

import { createCollectionStore } from './v3-store'
import {
  createProjectId,
  projectSchema,
  toDateKey,
  type Project,
  type ProjectContact,
  type ProjectFilter,
  type ProjectStatus,
} from './project-types'
import { matchesFilter } from './project-types'
import type { QuoteSnapshot } from './quote-library'
import { nextProjectColor, projectColorFor } from './calendar-palette'

export const PROJECTS_FILE = 'projects.json'
export const WEB_PROJECTS_KEY = 'nonoise-projects-v1'

/** Najnowsze u góry — lista projektów jest chronologiczna (notatki). */
function byDateDesc(a: Project, b: Project): number {
  const byDate = (b.date ?? '').localeCompare(a.date ?? '')
  return byDate !== 0 ? byDate : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
}

const store = createCollectionStore<Project>({
  fileName: PROJECTS_FILE,
  webKey: WEB_PROJECTS_KEY,
  schema: projectSchema,
  getId: (p) => p.id,
  sort: byDateDesc,
})

const visible = (projects: Project[]) => projects.filter((p) => !p.deletedAt)

/**
 * Wszystkie rekordy, łącznie z usuniętymi — dla migracji (idempotencja po
 * `migratedFromQuoteId`) i zapisów całej kolekcji, które nie mogą ich zgubić.
 */
export const listAllProjects = store.list
export const readProjectsRaw = store.readRaw

/** Projekty widoczne w aplikacji (bez usuniętych). */
export async function listProjects(): Promise<Project[]> {
  return visible(await store.list())
}

/**
 * Zapis całej kolekcji. Przekazuj PEŁNĄ listę z `listAllProjects` — czego tu
 * nie ma, znika z pliku. Zwraca widoczne projekty.
 */
export async function replaceAllProjects(projects: Project[]): Promise<Project[]> {
  return visible(await store.replaceAll(projects))
}

/**
 * Zapis projektu. Utrwala kolor: projekt bez `colorKey` dostaje slot wyliczony
 * ze swojego id, więc kolor w kalendarzu nie zmieni się już nigdy, nawet jeśli
 * paleta się kiedyś przebuduje. Zwraca widoczne projekty.
 */
export async function upsertProject(project: Project): Promise<Project[]> {
  return visible(await store.upsert(project.colorKey ? project : { ...project, colorKey: projectColorFor(project) }))
}

/**
 * Usunięcie jest MIĘKKIE: projekt dostaje `deletedAt` i znika z widoków, ale
 * zostaje w pliku (da się cofnąć). `deletedAt` jawnie — ten sam znacznik
 * dostaje wątek projektu.
 */
export async function deleteProject(id: string, deletedAt: string = new Date().toISOString()): Promise<Project[]> {
  return visible(await store.mutate((all) => all.map((p) => (p.id === id ? { ...p, deletedAt } : p))))
}

/** Cofnięcie usunięcia. */
export async function restoreProject(id: string): Promise<Project[]> {
  return visible(
    await store.mutate((all) =>
      all.map((p) => {
        if (p.id !== id) return p
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { deletedAt, ...rest } = p
        return rest as Project
      })
    )
  )
}

/**
 * Nowy projekt — z migawki wyceny albo bez niej (`quote: null`, np. z zapytania
 * dodanego w kalendarzu; lista pokazuje wtedy „brak wyceny").
 * `existing` = obecne projekty: nowy dostaje najrzadziej używany kolor, więc
 * kolejne projekty w kalendarzu nie wyglądają tak samo.
 */
export function createProject(params: {
  name: string
  quote?: QuoteSnapshot | null
  client?: string
  status?: ProjectStatus
  date?: string
  /** Pochodzenie klienta (np. projekt założony z leada kampanii). */
  leadSource?: string
  contact?: ProjectContact
  existing?: Pick<Project, 'id' | 'colorKey'>[]
}): Project {
  const now = new Date()
  const nowIso = now.toISOString()
  const quote = params.quote ?? null
  return {
    id: createProjectId(),
    name: params.name,
    client: params.client ?? '',
    status: params.status ?? 'quote',
    colorKey: nextProjectColor((params.existing ?? []).map(projectColorFor)),
    ...(params.leadSource ? { leadSource: params.leadSource } : {}),
    ...(params.contact ? { contact: params.contact } : {}),
    date: params.date ?? toDateKey(now),
    createdAt: nowIso,
    updatedAt: nowIso,
    quote,
    financials: null,
    equipment: [],
    notes: '',
  }
}

export async function getProject(id: string): Promise<Project | null> {
  const all = await listProjects()
  return all.find((p) => p.id === id) ?? null
}

/** Filtr listy: wszystko / tylko projekty / tylko wyceny, opcjonalnie bez nieprzyjętych. */
export function filterProjects(
  projects: Project[],
  filter: ProjectFilter,
  options: { hideLost?: boolean } = {}
): Project[] {
  return projects.filter((p) => matchesFilter(p.status, filter, options))
}

/** Zmiana statusu (np. „wycena weszła") ze stemplem czasu. */
export async function setProjectStatus(id: string, status: ProjectStatus): Promise<Project[]> {
  const project = await getProject(id)
  if (!project) return listProjects()
  return upsertProject({ ...project, status, updatedAt: new Date().toISOString() })
}
