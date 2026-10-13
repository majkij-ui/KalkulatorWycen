/**
 * „Scal osoby" (S2, plan po jeździe próbnej §3.3) — czyste funkcje.
 *
 * Ta sama osoba wpisana kilka razy („Łukasz - ze sprzętem", „Łukasz - op
 * bez sprzętu") staje się jedną kartą. Scalenie:
 *  - przepina `personId` z duplikatów na osobę, która zostaje, wszędzie, gdzie
 *    wskazuje osobę: wiersze ekipy w Realizacji (`Project.costs`, także
 *    usunięte), pozycje ekipy w wycenach projektów (`ShootingDay.crew` w
 *    `Project.quote`) i ekipę zestawów (`GearKit.crew`). Wiersze Realizacji bez
 *    `personId`, które pasowały do duplikatu po imieniu, dostają `personId`
 *    osoby, która zostaje (inaczej po usunięciu duplikatu wypadłyby „spoza
 *    bazy"). Call sheety wskazują wiersze kosztów (`costId`), nie osoby — nie
 *    ma w nich czego przepinać;
 *  - zostawia imiona zamrożone w wierszach i pozycjach (`person`,
 *    `personName`) — tak, jak je wpisano;
 *  - łączy kartę: role i stawki w rolach z duplikatów dochodzą do osoby, puste
 *    pola (stawka, telefon, e-mail, miasto) uzupełnia pierwszy duplikat, który
 *    je ma, a stawki, które się nie zmieściły, trafiają do notatki;
 *  - usuwa duplikaty MIĘKKO (`deletedAt`) ze wskazaniem `mergedInto`, więc
 *    stara kopia wyceny zapisana później i tak trafia do właściwej osoby
 *    (`crewMemberById`).
 *
 * „Cofnij" przywraca dokładnie to, co było — ale tylko tam, gdzie od scalenia
 * nikt niczego nie zmienił (wiersz wciąż wskazuje osobę, która została;
 * zestaw ma ekipę ze scalenia; karta nie była edytowana).
 */

import { crewMemberByName, type CrewMember } from './crew-types'
import { isCrew, personKey } from './project-costs'
import type { GearKit, KitCrewLine, Project, ProjectCost } from './project-types'
import type { QuoteCrewLine, ShootingDay } from './quote-types'

/** Jedno miejsce w projekcie, które wskazuje scalaną osobę. */
export interface CrewMergeRef {
  projectId: string
  /** `cost` — wiersz Realizacji, `quote` — pozycja ekipy w wycenie projektu. */
  kind: 'cost' | 'quote'
  /** Id wiersza kosztu albo pozycji wyceny. */
  id: string
  /** Dzień wyceny (tylko pozycje wyceny). */
  dayId?: string
  /** Dotychczasowy `personId`; brak = wiersz pasował po imieniu. */
  from?: string
}

export interface CrewMergeKit {
  kitId: string
  name: string
  before: KitCrewLine[]
  after: KitCrewLine[]
}

export interface CrewMergePlan {
  targetId: string
  sourceIds: string[]
  /** Karta osoby, która zostaje — po scaleniu. */
  merged: CrewMember
  /** Ta sama karta przed scaleniem (do „Cofnij"). */
  before: CrewMember
  /** Duplikaty przed scaleniem (do podglądu). */
  sources: CrewMember[]
  refs: CrewMergeRef[]
  kits: CrewMergeKit[]
  /** Znacznik scalenia: `updatedAt` karty i `deletedAt` duplikatów. */
  at: string
}

type MergeProject = Pick<Project, 'id' | 'costs' | 'quote'>

// ── Podpowiedzi ──────────────────────────────────────────────────────────────

/** Pierwsze słowo imienia bez znaków i polskich liter: „Łukasz - ze sprzętem" → „lukasz". */
function firstName(name: string): string {
  return personKey(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean)[0] ?? ''
}

/**
 * Prawdopodobne duplikaty: ludzie (bez usuniętych) o tym samym pierwszym
 * słowie imienia, grupy od największej. Tylko podpowiedź — wybór należy do
 * użytkownika.
 */
export function crewDuplicateGroups(members: CrewMember[]): CrewMember[][] {
  const groups = new Map<string, CrewMember[]>()
  members
    .filter((m) => !m.deletedAt)
    .forEach((m) => {
      const key = firstName(m.name)
      if (key.length < 2) return
      groups.set(key, [...(groups.get(key) ?? []), m])
    })
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
    .sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name, 'pl'))
}

// ── Karta po scaleniu ────────────────────────────────────────────────────────

const plnText = (amount: number) => `${amount.toLocaleString('pl-PL', { useGrouping: 'always' })} zł`

function dateText(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

/**
 * Karta osoby, która zostaje: jej pola mają pierwszeństwo, duplikaty
 * uzupełniają braki. Stawka duplikatu inna niż wynikowa (ogólna albo w roli,
 * w której osoba ma już swoją) nie przepada — trafia do notatki.
 */
export function mergedCrewMember(
  target: CrewMember,
  sources: CrewMember[],
  at: string,
  roleName: (roleId: string) => string = (id) => id
): CrewMember {
  const merged: CrewMember = { ...target, roleIds: [...target.roleIds], contact: { ...target.contact } }
  const roleRates = [...(target.roleRates ?? [])]
  const notes: string[] = target.notes?.trim() ? [target.notes.trim()] : []

  sources.forEach((source) => {
    source.roleIds.forEach((id) => {
      if (!merged.roleIds.includes(id)) merged.roleIds.push(id)
    })
    const lost: string[] = []
    ;(source.roleRates ?? []).forEach((entry) => {
      const existing = roleRates.find((r) => r.roleId === entry.roleId)
      if (!existing) roleRates.push({ ...entry })
      else if (existing.rate !== entry.rate) lost.push(`${roleName(entry.roleId)} ${plnText(entry.rate)}`)
    })
    if (merged.rate === undefined && source.rate !== undefined) merged.rate = source.rate
    else if (source.rate !== undefined && source.rate !== merged.rate) lost.unshift(`stawka ${plnText(source.rate)}`)
    if (!merged.contact.phone?.trim() && source.contact?.phone?.trim()) merged.contact.phone = source.contact.phone.trim()
    if (!merged.contact.email?.trim() && source.contact?.email?.trim()) merged.contact.email = source.contact.email.trim()
    if (!merged.city?.trim() && source.city?.trim()) merged.city = source.city.trim()
    const extra = [lost.join(', '), source.notes?.trim() ?? ''].filter(Boolean).join(' · ')
    notes.push(`Scalono z „${source.name.trim()}" (${dateText(at)})${extra ? `: ${extra}` : ''}.`)
  })

  if (roleRates.length > 0) merged.roleRates = roleRates
  merged.notes = notes.join('\n')
  merged.updatedAt = at
  return merged
}

// ── Odwołania w projektach i zestawach ───────────────────────────────────────

function quoteDays(project: MergeProject): ShootingDay[] {
  const data = (project.quote as { data?: { detailedShootingDays?: unknown } } | null | undefined)?.data
  const days = data?.detailedShootingDays
  return Array.isArray(days) ? (days as ShootingDay[]) : []
}

/**
 * Miejsca w projektach, które wskazują duplikaty. `members` = ludzie PRZED
 * scaleniem (do dopasowania po imieniu). Usuniętych projektów nie ruszamy —
 * po przywróceniu prowadzi je `mergedInto`.
 */
export function crewMergeRefs(
  projects: MergeProject[],
  members: CrewMember[],
  sourceIds: string[]
): CrewMergeRef[] {
  const sources = new Set(sourceIds)
  const refs: CrewMergeRef[] = []
  projects.forEach((project) => {
    ;(project.costs ?? []).forEach((cost) => {
      if (cost.personId) {
        if (sources.has(cost.personId)) refs.push({ projectId: project.id, kind: 'cost', id: cost.id, from: cost.personId })
        return
      }
      if (!isCrew(cost)) return
      const byName = crewMemberByName(members, cost.person)
      if (byName && sources.has(byName.id)) refs.push({ projectId: project.id, kind: 'cost', id: cost.id })
    })
    quoteDays(project).forEach((day) => {
      ;(Array.isArray(day.crew) ? day.crew : []).forEach((line) => {
        if (line?.personId && sources.has(line.personId)) {
          refs.push({ projectId: project.id, kind: 'quote', id: line.id, dayId: day.id, from: line.personId })
        }
      })
    })
  })
  return refs
}

/**
 * Ekipa zestawu z przepiętymi osobami. Ta sama rola z tą samą osobą po
 * scaleniu to jedna pozycja (osoba to jedna osoba, jak w `normalizeKitCrew`);
 * pozostałe pola wpisów zostają.
 */
function retargetKitCrew(crew: KitCrewLine[], sourceIds: Set<string>, targetId: string): KitCrewLine[] {
  const seen = new Set<string>()
  return crew.flatMap((entry) => {
    const next = entry.personId && sourceIds.has(entry.personId) ? { ...entry, personId: targetId } : entry
    if (!next.personId) return [next]
    const key = `${next.roleId}|${next.personId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [next]
  })
}

export function crewMergeKits(kits: Pick<GearKit, 'id' | 'name' | 'crew'>[], sourceIds: string[], targetId: string): CrewMergeKit[] {
  const sources = new Set(sourceIds)
  return kits.flatMap((kit) => {
    const before = kit.crew ?? []
    if (!before.some((entry) => entry.personId && sources.has(entry.personId))) return []
    return [{ kitId: kit.id, name: kit.name, before, after: retargetKitCrew(before, sources, targetId) }]
  })
}

/**
 * Plan scalenia: `sourceIds` (duplikaty) do `targetId`. `null` = brak osoby
 * docelowej, brak duplikatów albo duplikat = osoba docelowa. `members` =
 * wszyscy ludzie (z usuniętymi), `projects` = widoczne projekty.
 */
export function planCrewMerge(params: {
  members: CrewMember[]
  targetId: string
  sourceIds: string[]
  projects: MergeProject[]
  kits: Pick<GearKit, 'id' | 'name' | 'crew'>[]
  at: string
  roleName?: (roleId: string) => string
}): CrewMergePlan | null {
  const { members, targetId, projects, kits, at, roleName } = params
  const target = members.find((m) => m.id === targetId && !m.deletedAt)
  const sourceIds = [...new Set(params.sourceIds)].filter((id) => id !== targetId)
  const sources = sourceIds.flatMap((id) => {
    const member = members.find((m) => m.id === id && !m.deletedAt)
    return member ? [member] : []
  })
  if (!target || sources.length === 0 || sources.length !== sourceIds.length) return null
  return {
    targetId,
    sourceIds,
    merged: mergedCrewMember(target, sources, at, roleName),
    before: target,
    sources,
    refs: crewMergeRefs(projects, members, sourceIds),
    kits: crewMergeKits(kits, sourceIds, targetId),
    at,
  }
}

// ── Zapis ────────────────────────────────────────────────────────────────────

type ProjectPatch = { id: string; patch: Partial<Pick<Project, 'costs' | 'quote'>> }

/** Wiersz / pozycja z nowym `personId` (`undefined` = bez powiązania). */
function withPersonId<T extends { personId?: string }>(row: T, personId: string | undefined): T {
  if (personId) return { ...row, personId }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { personId: _removed, ...rest } = row
  return rest as T
}

/**
 * Zmiany projektów: dla każdego odwołania `decide` mówi, jaki `personId`
 * wpisać (albo `null` = zostaw, bo ktoś to już zmienił). Jeden wpis na
 * projekt, tylko gdy coś się zmienia.
 */
function rewriteProjects(
  projects: MergeProject[],
  refs: CrewMergeRef[],
  decide: (ref: CrewMergeRef, current: string | undefined) => { personId: string | undefined } | null
): ProjectPatch[] {
  const byProject = new Map<string, CrewMergeRef[]>()
  refs.forEach((ref) => byProject.set(ref.projectId, [...(byProject.get(ref.projectId) ?? []), ref]))

  return projects.flatMap((project) => {
    const own = byProject.get(project.id)
    if (!own) return []
    const patch: ProjectPatch['patch'] = {}

    const costRefs = new Map(own.filter((r) => r.kind === 'cost').map((r) => [r.id, r]))
    let costsChanged = false
    const costs = (project.costs ?? []).map((cost): ProjectCost => {
      const ref = costRefs.get(cost.id)
      const next = ref ? decide(ref, cost.personId) : null
      if (!next || next.personId === cost.personId) return cost
      costsChanged = true
      return withPersonId(cost, next.personId)
    })
    if (costsChanged) patch.costs = costs

    const lineRefs = new Map(own.filter((r) => r.kind === 'quote').map((r) => [`${r.dayId}|${r.id}`, r]))
    if (lineRefs.size > 0 && project.quote) {
      let quoteChanged = false
      const days = quoteDays(project).map((day) => {
        if (!Array.isArray(day.crew)) return day
        let dayChanged = false
        const crew = day.crew.map((line): QuoteCrewLine => {
          const ref = lineRefs.get(`${day.id}|${line?.id}`)
          const next = ref ? decide(ref, line.personId) : null
          if (!next || next.personId === line.personId) return line
          dayChanged = true
          return withPersonId(line, next.personId)
        })
        if (!dayChanged) return day
        quoteChanged = true
        return { ...day, crew }
      })
      if (quoteChanged) {
        const quote = project.quote
        patch.quote = { ...quote, data: { ...quote.data, detailedShootingDays: days } }
      }
    }

    return Object.keys(patch).length > 0 ? [{ id: project.id, patch }] : []
  })
}

/** Zmiany projektów przy scaleniu: odwołania, które wciąż są takie jak w planie, wskazują osobę docelową. */
export function crewMergePatches(projects: MergeProject[], plan: CrewMergePlan): ProjectPatch[] {
  return rewriteProjects(projects, plan.refs, (ref, current) =>
    current === ref.from ? { personId: plan.targetId } : null
  )
}

/** „Cofnij": poprzednie `personId` tam, gdzie wiersz wciąż wskazuje osobę docelową. */
export function crewUnmergePatches(projects: MergeProject[], plan: CrewMergePlan): ProjectPatch[] {
  return rewriteProjects(projects, plan.refs, (ref, current) =>
    current === plan.targetId ? { personId: ref.from } : null
  )
}

const sameCrew = (a: KitCrewLine[] | undefined, b: KitCrewLine[]) => JSON.stringify(a ?? []) === JSON.stringify(b)

/** Zestawy po scaleniu (tylko te, których ekipa się od planu nie zmieniła). */
export function crewMergeKitUpdates<K extends Pick<GearKit, 'id' | 'crew'>>(kits: K[], plan: CrewMergePlan): K[] {
  const byId = new Map(plan.kits.map((k) => [k.kitId, k]))
  return kits.flatMap((kit) => {
    const change = byId.get(kit.id)
    return change && sameCrew(kit.crew, change.before) ? [{ ...kit, crew: change.after }] : []
  })
}

/** „Cofnij" w zestawach: poprzednia ekipa tam, gdzie wciąż jest ta ze scalenia. */
export function crewUnmergeKitUpdates<K extends Pick<GearKit, 'id' | 'crew'>>(kits: K[], plan: CrewMergePlan): K[] {
  const byId = new Map(plan.kits.map((k) => [k.kitId, k]))
  return kits.flatMap((kit) => {
    const change = byId.get(kit.id)
    if (!change || !sameCrew(kit.crew, change.after)) return []
    return [{ ...kit, crew: change.before }]
  })
}

/** Ludzie po scaleniu: karta docelowa połączona, duplikaty usunięte ze wskazaniem `mergedInto`. */
export function crewAfterMerge(members: CrewMember[], plan: CrewMergePlan): CrewMember[] {
  const sources = new Set(plan.sourceIds)
  return members.map((m) => {
    if (m.id === plan.targetId) return plan.merged
    if (sources.has(m.id) && !m.deletedAt) return { ...m, deletedAt: plan.at, mergedInto: plan.targetId, updatedAt: plan.at }
    return m
  })
}

/**
 * „Cofnij": duplikaty wracają (tylko te usunięte tym scaleniem), karta
 * docelowa wraca do stanu sprzed scalenia, jeśli nikt jej od tego czasu nie
 * edytował.
 */
export function crewAfterUnmerge(members: CrewMember[], plan: CrewMergePlan, now: string): CrewMember[] {
  const sources = new Set(plan.sourceIds)
  return members.map((m) => {
    if (m.id === plan.targetId) return m.updatedAt === plan.at ? plan.before : m
    if (sources.has(m.id) && m.deletedAt === plan.at && m.mergedInto === plan.targetId) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { deletedAt, mergedInto, ...rest } = m
      return { ...rest, updatedAt: now }
    }
    return m
  })
}

// ── Wycena otwarta w kalkulatorze ────────────────────────────────────────────

/** Pozycja kalkulatora przepięta przy scaleniu (do „Cofnij"). */
export interface CalculatorCrewRef {
  dayId: string
  lineId: string
  from: string
}

/**
 * Dni wyceny otwartej w kalkulatorze z przepiętymi osobami — żeby późniejsze
 * „Zapisz" nie przywróciło duplikatu. Zwraca tylko zmienione dni i to, co
 * zmieniono.
 */
export function retargetQuoteDays(
  days: Pick<ShootingDay, 'id' | 'crew'>[],
  sourceIds: string[],
  targetId: string
): { days: { dayId: string; crew: QuoteCrewLine[] }[]; refs: CalculatorCrewRef[] } {
  const sources = new Set(sourceIds)
  const refs: CalculatorCrewRef[] = []
  const changed = days.flatMap((day) => {
    if (!Array.isArray(day.crew)) return []
    let dayChanged = false
    const crew = day.crew.map((line) => {
      if (!line.personId || !sources.has(line.personId)) return line
      refs.push({ dayId: day.id, lineId: line.id, from: line.personId })
      dayChanged = true
      return { ...line, personId: targetId }
    })
    return dayChanged ? [{ dayId: day.id, crew }] : []
  })
  return { days: changed, refs }
}

/** „Cofnij" w kalkulatorze: poprzednia osoba tam, gdzie pozycja wciąż wskazuje osobę docelową. */
export function restoreQuoteDays(
  days: Pick<ShootingDay, 'id' | 'crew'>[],
  refs: CalculatorCrewRef[],
  targetId: string
): { dayId: string; crew: QuoteCrewLine[] }[] {
  const byLine = new Map(refs.map((r) => [`${r.dayId}|${r.lineId}`, r.from]))
  return days.flatMap((day) => {
    if (!Array.isArray(day.crew)) return []
    let dayChanged = false
    const crew = day.crew.map((line) => {
      const from = byLine.get(`${day.id}|${line.id}`)
      if (!from || line.personId !== targetId) return line
      dayChanged = true
      return { ...line, personId: from }
    })
    return dayChanged ? [{ dayId: day.id, crew }] : []
  })
}
