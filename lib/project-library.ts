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

export const listProjects = store.list
export const deleteProject = store.remove
export const replaceAllProjects = store.replaceAll
export const readProjectsRaw = store.readRaw

/**
 * Zapis projektu. Utrwala kolor: projekt bez `colorKey` dostaje slot wyliczony
 * ze swojego id, więc kolor w kalendarzu nie zmieni się już nigdy, nawet jeśli
 * paleta się kiedyś przebuduje.
 */
export function upsertProject(project: Project): Promise<Project[]> {
  return store.upsert(project.colorKey ? project : { ...project, colorKey: projectColorFor(project) })
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
