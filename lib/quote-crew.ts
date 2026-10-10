/**
 * Ekipa w wycenie (T9b, plan §6d) — czyste funkcje, bez Reacta.
 *
 * Każdy dzień szczegółowej wyceny może mieć pozycje ekipy z bazy
 * (`ShootingDay.crew`): rolę („operator") i opcjonalnie osobę („Łukasz").
 *
 *   cena dla klienta = stawka ROLI × osoby × marża z nagłówka  (decyzja 7)
 *   mój koszt        = stawka osoby → koszt roli → stawka roli  (pozycja planu)
 *
 * Nazwy i stawki są ZAMROŻONE w pozycji (jak sprzęt w G5); zmiana roli albo
 * osoby w bazie nie zmienia wysłanej oferty — „zaktualizuj stawki" to
 * świadomy klik. Stare liczniki dnia (`rezOp` … `statysta`) liczą się obok,
 * jak dotąd; ten moduł ich nie dotyka.
 *
 * W szybkiej wycenie dni szczegółowe nie wchodzą do ceny, więc i ich ekipa nie.
 */

import { safeArray, safeNum } from './safe-numbers'
import { createQuoteCrewLineId, type QuoteCrewLine, type QuoteData, type ShootingDay } from './quote-types'
import { crewRoleByName, type CrewMember, type CrewRole } from './crew-types'
import { isCrew, type NewCost } from './project-costs'
import type { ProjectCost } from './project-types'

type RoleRates = Pick<CrewRole, 'clientRate' | 'costRate'>
type PersonRate = Pick<CrewMember, 'rate'>

/** Mój koszt osoby-dnia: stawka osoby, potem koszt roli, potem stawka roli (jak dziś). */
export function crewCostRate(
  role: RoleRates | null | undefined,
  person: PersonRate | null | undefined,
  fallbackClientRate = 0
): number {
  if (person?.rate !== undefined && person.rate > 0) return person.rate
  if (role?.costRate !== undefined) return role.costRate
  if (role) return role.clientRate
  return Math.max(0, safeNum(fallbackClientRate, 0))
}

/** Nowa pozycja: nazwy i stawki z roli i osoby TERAZ (zamrożone). */
export function createQuoteCrewLine(
  role: Pick<CrewRole, 'id' | 'name' | 'group' | 'clientRate' | 'costRate'>,
  person?: Pick<CrewMember, 'id' | 'name' | 'rate'> | null,
  qty = 1
): QuoteCrewLine {
  const line: QuoteCrewLine = {
    id: createQuoteCrewLineId(),
    roleId: role.id,
    roleName: role.name,
    group: role.group,
    clientRate: role.clientRate,
    costRate: crewCostRate(role, person),
    qty: person ? 1 : Math.max(1, Math.floor(qty)),
  }
  if (person) {
    line.personId = person.id
    line.personName = person.name
  }
  return line
}

/**
 * Obsadzenie miejsca osobą (albo zdjęcie osoby: `null`). Cena dla klienta się
 * NIE zmienia (decyzja 7); zmienia się mój koszt. Osoba to jedna osoba, więc
 * pozycja z osobą ma `qty` 1.
 */
export function withCrewPerson(
  line: QuoteCrewLine,
  person: Pick<CrewMember, 'id' | 'name' | 'rate'> | null,
  role: RoleRates | null | undefined
): QuoteCrewLine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { personId, personName, ...rest } = line
  if (!person) return { ...rest, costRate: crewCostRate(role, null, line.clientRate) }
  return {
    ...rest,
    personId: person.id,
    personName: person.name,
    costRate: crewCostRate(role, person, line.clientRate),
    qty: 1,
  }
}

/** Wiersz PDF i kubeł kwot: obsada osobno, cała reszta (także `post`) to ekipa. */
export function crewLineBucket(line: Pick<QuoteCrewLine, 'group'>): 'ekipa' | 'obsada' {
  return line.group === 'obsada' ? 'obsada' : 'ekipa'
}

function lineQty(line: QuoteCrewLine): number {
  return Math.max(0, safeNum(line.qty, 0))
}

export interface DayCrewFigures {
  /** Cena dla klienta przed marżą — ekipa (z `post`). */
  ekipa: number
  /** Cena dla klienta przed marżą — obsada. */
  obsada: number
  /** Osobodni (podstawa cateringu i noclegów, jak liczniki). */
  personDays: number
  /** Mój koszt (pozycje planu, przed nadpisaniami w zakładce Plan). */
  cost: number
}

export function dayCrewFigures(day: Pick<ShootingDay, 'crew'>): DayCrewFigures {
  const figures: DayCrewFigures = { ekipa: 0, obsada: 0, personDays: 0, cost: 0 }
  safeArray<QuoteCrewLine>(day.crew).forEach((line) => {
    const qty = lineQty(line)
    const client = Math.max(0, safeNum(line.clientRate, 0)) * qty
    figures[crewLineBucket(line)] += client
    figures.personDays += qty
    figures.cost += Math.max(0, safeNum(line.costRate, 0)) * qty
  })
  return figures
}

/** Osobodni z pozycji ekipy w całej wycenie (tylko tryb szczegółowy). */
export function quoteCrewPersonDays(data: Pick<QuoteData, 'isDetailedProdukcja' | 'detailedShootingDays'>): number {
  if (!data.isDetailedProdukcja) return 0
  return safeArray<ShootingDay>(data.detailedShootingDays).reduce((sum, day) => sum + dayCrewFigures(day).personDays, 0)
}

/** Czy dzień używa starych liczników ekipy — wtedy pokazujemy je rozwinięte. */
export function hasLegacyCrew(
  day: Pick<ShootingDay, 'rezOp' | 'asystent' | 'gafer' | 'dzwiekowiec' | 'mua' | 'aktor' | 'model' | 'statysta'>
): boolean {
  return [day.rezOp, day.asystent, day.gafer, day.dzwiekowiec, day.mua, day.aktor, day.model, day.statysta].some(
    (count) => safeNum(count, 0) > 0
  )
}

// ── Aktualność stawek ────────────────────────────────────────────────────────

type RoleLike = Pick<CrewRole, 'id' | 'name' | 'group' | 'clientRate' | 'costRate'>
type PersonLike = Pick<CrewMember, 'id' | 'name' | 'rate' | 'deletedAt'>

/** Pozycja z bieżącymi nazwami i stawkami z bazy (rola albo osoba usunięta → bez zmian). */
function refreshedLine(line: QuoteCrewLine, roles: Map<string, RoleLike>, people: Map<string, PersonLike>): QuoteCrewLine {
  const role = roles.get(line.roleId)
  const person = line.personId ? people.get(line.personId) : undefined
  const livePerson = person && !person.deletedAt ? person : undefined
  if (!role && !livePerson) return line
  const next: QuoteCrewLine = { ...line }
  if (role) {
    next.roleName = role.name
    next.group = role.group
    next.clientRate = role.clientRate
  }
  if (livePerson) next.personName = livePerson.name
  // Osoba usunięta z bazy: jej stawka zostaje zamrożona; inaczej koszt z bazy.
  next.costRate =
    line.personId && !livePerson ? line.costRate : crewCostRate(role ?? null, livePerson ?? null, next.clientRate)
  return next
}

function sameLine(a: QuoteCrewLine, b: QuoteCrewLine): boolean {
  return (
    a.roleName === b.roleName &&
    a.group === b.group &&
    a.clientRate === b.clientRate &&
    a.costRate === b.costRate &&
    a.personName === b.personName
  )
}

/** Ile pozycji ma inne nazwy lub stawki niż role i ludzie w bazie teraz. */
export function staleCrewLines(days: Pick<ShootingDay, 'crew'>[], roles: RoleLike[], people: PersonLike[]): number {
  const roleMap = new Map(roles.map((r) => [r.id, r]))
  const peopleMap = new Map(people.map((p) => [p.id, p]))
  return days.reduce(
    (count, day) =>
      count + safeArray<QuoteCrewLine>(day.crew).filter((line) => !sameLine(line, refreshedLine(line, roleMap, peopleMap))).length,
    0
  )
}

/** „Zaktualizuj stawki": nazwy i stawki pozycji dnia z bieżącej bazy. */
export function refreshCrewLines(
  lines: QuoteCrewLine[] | undefined,
  roles: RoleLike[],
  people: PersonLike[]
): QuoteCrewLine[] | undefined {
  if (!lines) return lines
  const roleMap = new Map(roles.map((r) => [r.id, r]))
  const peopleMap = new Map(people.map((p) => [p.id, p]))
  return lines.map((line) => refreshedLine(line, roleMap, peopleMap))
}

// ── Zestawy (G6 + T9b) ───────────────────────────────────────────────────────

/** Pozycja ekipy w zestawie: rola, opcjonalnie osoba, liczba osób. */
export interface KitCrewEntry {
  roleId: string
  personId?: string
  qty: number
}

/** Ekipa dnia → wpisy zestawu (bez stawek: te zawsze z bazy w chwili użycia). */
export function kitCrewFromLines(lines: QuoteCrewLine[] | undefined): KitCrewEntry[] {
  return safeArray<QuoteCrewLine>(lines).map((line) => {
    const entry: KitCrewEntry = { roleId: line.roleId, qty: Math.max(1, Math.floor(lineQty(line))) }
    if (line.personId) entry.personId = line.personId
    return entry
  })
}

/**
 * Ekipa z zestawu dochodzi do dnia wyceny ze stawkami z bazy TERAZ. Rola
 * wycofana albo usunięta jest pomijana; osoba usunięta lub wycofana zostaje
 * miejscem do obsadzenia. Pozycja tej samej roli i osoby, która już jest w
 * dniu, nie jest dublowana.
 */
export function addKitCrewToQuote(
  lines: QuoteCrewLine[] | undefined,
  kit: KitCrewEntry[],
  roles: (RoleLike & Pick<CrewRole, 'retiredAt'>)[],
  people: (PersonLike & Pick<CrewMember, 'retiredAt'>)[]
): QuoteCrewLine[] {
  const roleMap = new Map(roles.map((r) => [r.id, r]))
  const peopleMap = new Map(people.map((p) => [p.id, p]))
  let next = lines ?? []
  kit.forEach((entry) => {
    const role = roleMap.get(entry.roleId)
    if (!role || role.retiredAt) return
    const candidate = entry.personId ? peopleMap.get(entry.personId) : undefined
    const person = candidate && !candidate.deletedAt && !candidate.retiredAt ? candidate : null
    const exists = next.some((line) => line.roleId === role.id && (line.personId ?? null) === (person?.id ?? null))
    if (exists) return
    next = [...next, createQuoteCrewLine(role, person, entry.qty)]
  })
  return next
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export interface CrewPdfLabels {
  opisPersonDays: string
}

/**
 * Zdania do opisu wiersza „Ekipa" albo „Obsada" w PDF: role z osobodniami
 * („Operator: 2 osobodni."). Domyślnie BEZ imion — klient płaci za rolę;
 * `withPeople` dopisuje imiona obsadzonych osób.
 */
export function pdfCrewSentences(
  data: Pick<QuoteData, 'isDetailedProdukcja' | 'detailedShootingDays'>,
  bucket: 'ekipa' | 'obsada',
  labels: CrewPdfLabels,
  withPeople = false
): string[] {
  if (!data.isDetailedProdukcja) return []
  const byRole = new Map<string, { days: number; people: string[] }>()
  safeArray<ShootingDay>(data.detailedShootingDays).forEach((day) => {
    safeArray<QuoteCrewLine>(day.crew).forEach((line) => {
      if (crewLineBucket(line) !== bucket) return
      const qty = lineQty(line)
      if (qty <= 0) return
      const name = line.roleName?.trim() || line.roleId
      const entry = byRole.get(name) ?? { days: 0, people: [] }
      entry.days += qty
      const person = line.personName?.trim()
      if (person && !entry.people.includes(person)) entry.people.push(person)
      byRole.set(name, entry)
    })
  })
  return [...byRole].map(([name, { days, people }]) => {
    const who = withPeople && people.length > 0 ? ` (${people.join(', ')})` : ''
    return `${name}: ${Number.isInteger(days) ? days : days.toLocaleString('pl-PL')} ${labels.opisPersonDays}${who}.`
  })
}

// ── Zestawy w Realizacji ─────────────────────────────────────────────────────

type CostRow = Pick<ProjectCost, 'category' | 'role' | 'person' | 'personId' | 'deletedAt'>

/**
 * Ekipa dnia Realizacji → wpisy zestawu. Wiersz ma rolę tekstem, więc rola
 * jest szukana po nazwie; wiersz z rolą spoza bazy jest pomijany.
 */
export function kitCrewFromDayCosts(
  costs: CostRow[],
  roles: Pick<CrewRole, 'id' | 'name'>[]
): KitCrewEntry[] {
  return costs
    .filter((cost) => isCrew(cost) && !cost.deletedAt)
    .flatMap((cost) => {
      const role = crewRoleByName(roles as CrewRole[], cost.role)
      if (!role) return []
      const entry: KitCrewEntry = { roleId: role.id, qty: 1 }
      if (cost.personId) entry.personId = cost.personId
      return [entry]
    })
}

/**
 * Ekipa z zestawu → nowe wiersze kosztów dnia Realizacji, po moim koszcie z
 * bazy TERAZ (`crewCostRate`). Rola wycofana albo nieznana jest pomijana;
 * osoba, która już jest w tym dniu, się nie dubluje; osoba usunięta lub
 * wycofana zostaje miejscem do obsadzenia.
 */
export function kitCrewDayCosts(
  kit: KitCrewEntry[],
  dayId: string,
  dayCosts: CostRow[],
  roles: (RoleLike & Pick<CrewRole, 'retiredAt'>)[],
  people: (PersonLike & Pick<CrewMember, 'retiredAt'>)[]
): NewCost[] {
  const roleMap = new Map(roles.map((r) => [r.id, r]))
  const peopleMap = new Map(people.map((p) => [p.id, p]))
  const present = new Set(dayCosts.filter((c) => isCrew(c) && !c.deletedAt && c.personId).map((c) => c.personId))
  const added: NewCost[] = []
  kit.forEach((entry) => {
    const role = roleMap.get(entry.roleId)
    if (!role || role.retiredAt) return
    const candidate = entry.personId ? peopleMap.get(entry.personId) : undefined
    const person = candidate && !candidate.deletedAt && !candidate.retiredAt ? candidate : null
    if (person && present.has(person.id)) return
    const copies = person ? 1 : Math.max(1, Math.floor(entry.qty))
    for (let i = 0; i < copies; i += 1) {
      added.push({
        category: 'ekipa',
        role: role.name,
        person: person?.name ?? '',
        ...(person ? { personId: person.id } : {}),
        quantity: 1,
        unitCost: crewCostRate(role, person),
        dayId,
      })
    }
    if (person) present.add(person.id)
  })
  return added
}
