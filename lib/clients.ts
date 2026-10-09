/**
 * Klient to pole projektu, nie osobna kartoteka (plan §3.2a).
 *
 * Żeby „Tchibo", „tchibo " i „Tchíbo" nie liczyły się jako trzech klientów,
 * grupujemy po kluczu znormalizowanym: bez spacji na brzegach, bez wielkości
 * liter i bez polskich znaków. Zapisana nazwa zostaje taka, jak ją wpisano —
 * klucz istnieje tylko w obliczeniach.
 *
 * Wszystko tu jest wyliczane z listy projektów; nic nie jest zapisywane.
 * Moduł czysty — testy w `clients.test.ts`.
 */

import { countsTowardRevenue, toYear, type Project, type ProjectContact } from './project-types'

/** „ Tchibo  Polska " → „tchibo polska", „Łódź Film" → „lodz film". */
export function clientKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // „ł" nie rozkłada się w NFD na literę + znak diakrytyczny
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface ClientInfo {
  key: string
  /** Najczęstsza pisownia (przy remisie — z najnowszego projektu). */
  name: string
  projectCount: number
  /** Data najnowszego projektu klienta (`YYYY-MM-DD`). */
  lastDate: string
}

/** Najnowszy pierwszy: po dacie księgowej, potem po ostatniej zmianie. */
function byRecency(a: Pick<Project, 'date' | 'updatedAt'>, b: Pick<Project, 'date' | 'updatedAt'>): number {
  return (b.date ?? '').localeCompare(a.date ?? '') || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
}

/** Klienci z projektów, alfabetycznie. Projekty bez klienta są pomijane. */
export function clientDirectory(projects: Pick<Project, 'client' | 'date' | 'updatedAt'>[]): ClientInfo[] {
  const groups = new Map<string, Pick<Project, 'client' | 'date' | 'updatedAt'>[]>()
  projects.forEach((p) => {
    const key = clientKey(p.client ?? '')
    if (!key) return
    groups.set(key, [...(groups.get(key) ?? []), p])
  })

  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort(byRecency)
      const counts = new Map<string, number>()
      sorted.forEach((p) => {
        const spelling = p.client.trim().replace(/\s+/g, ' ')
        counts.set(spelling, (counts.get(spelling) ?? 0) + 1)
      })
      // Map zachowuje kolejność wstawiania (od najnowszego), więc przy remisie
      // wygrywa pisownia z najnowszego projektu.
      let name = ''
      let best = 0
      counts.forEach((count, spelling) => {
        if (count > best) {
          name = spelling
          best = count
        }
      })
      return { key, name, projectCount: list.length, lastDate: sorted[0]?.date ?? '' }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
}

/**
 * Podpowiedzi do pola klienta. Pusty tekst = ostatnio używani. Inaczej
 * najpierw nazwy zaczynające się od wpisanego tekstu, potem zawierające go.
 */
export function suggestClients(directory: ClientInfo[], query: string, limit = 8): ClientInfo[] {
  const q = clientKey(query)
  if (!q) {
    return [...directory].sort((a, b) => b.lastDate.localeCompare(a.lastDate)).slice(0, limit)
  }
  const starts = directory.filter((c) => c.key.startsWith(q) || c.key.split(' ').some((w) => w.startsWith(q)))
  const contains = directory.filter((c) => !starts.includes(c) && c.key.includes(q))
  return [...starts, ...contains].slice(0, limit)
}

export function hasContact(contact: ProjectContact | null | undefined): boolean {
  return !!contact && [contact.name, contact.email, contact.phone].some((v) => typeof v === 'string' && v.trim())
}

/** Najnowszy projekt tego klienta (poza `excludeId`), który ma dane kontaktowe. */
export function latestContactProject<P extends Pick<Project, 'id' | 'client' | 'date' | 'updatedAt' | 'contact'>>(
  projects: P[],
  key: string,
  excludeId?: string
): P | null {
  if (!key) return null
  return (
    [...projects]
      .filter((p) => p.id !== excludeId && clientKey(p.client ?? '') === key && hasContact(p.contact))
      .sort(byRecency)[0] ?? null
  )
}

export interface ClientChoice {
  patch: Pick<Project, 'client'> & { contact?: ProjectContact }
  /** Projekt, z którego skopiowano kontakt (do komunikatu „kontakt z …"). */
  contactFrom: Pick<Project, 'id' | 'name'> | null
}

/**
 * Zmiana klienta projektu. Gdy projekt nie ma kontaktu, a ten klient ma go w
 * innym projekcie, kopiuje kontakt z najnowszego z nich — powracający klient
 * od razu ma maila i telefon. Istniejącego kontaktu nigdy nie nadpisuje.
 *
 * `null` = nic do zmiany (ta sama nazwa wpisana jeszcze raz).
 */
export function applyClientChoice<P extends Pick<Project, 'id' | 'name' | 'client' | 'date' | 'updatedAt' | 'contact'>>(
  project: P,
  name: string,
  projects: P[]
): ClientChoice | null {
  const client = name.trim().replace(/\s+/g, ' ')
  if (client === project.client) return null
  const patch: ClientChoice['patch'] = { client }
  if (hasContact(project.contact)) return { patch, contactFrom: null }
  const source = latestContactProject(projects, clientKey(client), project.id)
  if (!source?.contact) return { patch, contactFrom: null }
  return { patch: { ...patch, contact: { ...source.contact } }, contactFrom: { id: source.id, name: source.name } }
}

export interface ClientRevenue {
  /** Suma netto projektów W realizacji + Zrealizowanych (ta sama reguła co Finanse). */
  revenue: number
  /** Ile projektów się do niej liczy. */
  countedProjects: number
}

/** „Ile przyniósł ten klient" — opcjonalnie w jednym roku (po dacie księgowej). */
export function clientRevenue(
  projects: Pick<Project, 'client' | 'status' | 'date' | 'financials'>[],
  key: string,
  year: number | null = null
): ClientRevenue {
  const out: ClientRevenue = { revenue: 0, countedProjects: 0 }
  projects.forEach((p) => {
    if (clientKey(p.client ?? '') !== key || !countsTowardRevenue(p.status)) return
    if (year !== null && toYear(p.date) !== year) return
    out.countedProjects += 1
    out.revenue += p.financials?.sumaNetto ?? 0
  })
  return out
}
