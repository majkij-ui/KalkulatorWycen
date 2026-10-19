/**
 * Ekipa w wycenie (T9b, plan §6d) — czyste funkcje, bez Reacta.
 *
 * Każdy dzień szczegółowej wyceny może mieć pozycje ekipy z bazy
 * (`ShootingDay.crew`): rolę („operator") i opcjonalnie osobę („Łukasz").
 *
 *   „Koszt" (mój koszt) = stawka osoby w tej roli → stawka osoby → koszt roli
 *                         → stawka roli  (pozycja planu; S2 dodało stawkę w roli)
 *   „Klient"            = R1 (A3): przy osobie jej stawka w roli → jej stawka
 *                         ogólna → stawka roli; miejsce do obsadzenia: stawka roli.
 *                         Obie kwoty można zmienić ręcznie (`clientEdited`,
 *                         `costEdited`). Pozycja sprzed R1 z osobą (bez
 *                         `clientFromPerson`): „Klient" = stawka roli (decyzja 7).
 *   cena dla klienta    = „Klient" × osoby (× marża z nagłówka tylko w wycenie
 *                         sprzed R1; od R1 marża to osobna pozycja — quote-calc).
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
import { crewRoleByName, personRateFor, selfCrewMember, type CrewMember, type CrewRole } from './crew-types'
import { isCrew, type NewCost } from './project-costs'
import type { ProjectCost } from './project-types'

type RoleRates = Pick<CrewRole, 'clientRate' | 'costRate'> & { id?: string }
type PersonRate = Pick<CrewMember, 'rate' | 'roleRates'>
type RoleLike = Pick<CrewRole, 'id' | 'name' | 'group' | 'clientRate' | 'costRate'>

/**
 * Mój koszt osoby-dnia: stawka osoby w tej roli, potem jej stawka ogólna,
 * potem koszt roli, potem stawka roli (jak dziś). Rolę wskazuje `role.id`,
 * a gdy roli nie ma w bazie — `roleId` (np. z zamrożonej pozycji).
 */
export function crewCostRate(
  role: RoleRates | null | undefined,
  person: PersonRate | null | undefined,
  fallbackClientRate = 0,
  roleId: string | undefined = role?.id
): number {
  const own = personRateFor(person, roleId)
  if (own !== null) return own
  if (role?.costRate !== undefined) return role.costRate
  if (role) return role.clientRate
  return Math.max(0, safeNum(fallbackClientRate, 0))
}

/**
 * „Klient" osoby w roli (R1, A3): jej stawka w tej roli, potem jej stawka
 * ogólna; osoba bez stawek (albo bez osoby) — stawka roli, a bez roli
 * `fallbackClientRate`. Kamil 1 200 jako Asystent przy roli 1 500 → 1 200.
 */
export function crewClientRate(
  role: RoleRates | null | undefined,
  person: PersonRate | null | undefined,
  fallbackClientRate = 0,
  roleId: string | undefined = role?.id
): number {
  const own = personRateFor(person, roleId)
  if (own !== null) return own
  if (role) return role.clientRate
  return Math.max(0, safeNum(fallbackClientRate, 0))
}

type PersonLine = Pick<CrewMember, 'id' | 'name' | 'rate' | 'roleRates'> & Partial<Pick<CrewMember, 'self'>>

/** Nowa pozycja: nazwy i stawki z roli i osoby TERAZ (zamrożone). Z osobą obie kwoty z jej stawki (A3). */
export function createQuoteCrewLine(
  role: Pick<CrewRole, 'id' | 'name' | 'group' | 'clientRate' | 'costRate'>,
  person?: PersonLine | null,
  qty = 1
): QuoteCrewLine {
  const line: QuoteCrewLine = {
    id: createQuoteCrewLineId(),
    roleId: role.id,
    roleName: role.name,
    group: role.group,
    clientRate: person ? crewClientRate(role, person) : role.clientRate,
    costRate: crewCostRate(role, person),
    qty: person ? 1 : Math.max(1, Math.floor(qty)),
  }
  if (person) {
    line.personId = person.id
    line.personName = person.name
    line.clientFromPerson = true
    // R2 (D1): pozycja „Ja" to moja praca, nie koszt planu.
    if (person.self) line.ownWork = true
  }
  return line
}

/** Pozycja bez osoby i bez znaczników kwot (do przepisania od nowa). */
function stripped(line: QuoteCrewLine): QuoteCrewLine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { personId, personName, clientFromPerson, clientEdited, costEdited, ownWork, ...rest } = line
  return rest
}

/**
 * Obsadzenie miejsca osobą (albo zdjęcie osoby: `null`). R1 (A3): wybór to
 * świadoma decyzja, więc OBIE kwoty biorą się od nowa — „Koszt" i „Klient" ze
 * stawki osoby w roli (bez osoby: z roli), także po ręcznej zmianie. Osoba to
 * jedna osoba, więc pozycja z osobą ma `qty` 1 (resztę miejsc zostawia
 * `staffCrewLine`).
 */
export function withCrewPerson(
  line: QuoteCrewLine,
  person: PersonLine | null,
  role: RoleRates | null | undefined
): QuoteCrewLine {
  const rest = stripped(line)
  if (!person) {
    const clientRate = role ? role.clientRate : line.clientRate
    return { ...rest, clientRate, costRate: crewCostRate(role, null, clientRate) }
  }
  return {
    ...rest,
    personId: person.id,
    personName: person.name,
    clientRate: crewClientRate(role, person, line.clientRate, line.roleId),
    costRate: crewCostRate(role, person, line.clientRate, line.roleId),
    qty: 1,
    clientFromPerson: true,
    ...(person.self ? { ownWork: true as const } : {}),
  }
}

/**
 * Wybór osoby w wierszu: jak `withCrewPerson`, ale miejsce na kilka osób
 * („Operator × 2") się nie gubi — osoba dostaje jedno, reszta zostaje
 * miejscem do obsadzenia (z tymi samymi kwotami) tuż pod nią.
 */
export function staffCrewLine(
  line: QuoteCrewLine,
  person: PersonLine | null,
  role: RoleRates | null | undefined
): QuoteCrewLine[] {
  const staffed = withCrewPerson(line, person, role)
  const seats = Math.floor(lineQty(line))
  if (!person || line.personId || seats <= 1) return [staffed]
  return [staffed, { ...line, id: createQuoteCrewLineId(), qty: seats - 1 }]
}

/**
 * Zmiana roli w wierszu (R1). Obie kwoty od nowa z nowej roli — ze stawki
 * osoby w tej roli, a bez osoby z roli — także po ręcznej zmianie (M.J.
 * 2026-10-18: wpisana kwota była za inną rolę). Osoba zostaje.
 */
export function withCrewRole(
  line: QuoteCrewLine,
  role: Pick<CrewRole, 'id' | 'name' | 'group' | 'clientRate' | 'costRate'>,
  person: PersonLine | null
): QuoteCrewLine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { clientEdited, costEdited, ...rest } = line
  const next: QuoteCrewLine = { ...rest, roleId: role.id, roleName: role.name, group: role.group }
  if (person) {
    next.clientRate = crewClientRate(role, person)
    next.costRate = crewCostRate(role, person)
    next.clientFromPerson = true
  } else {
    next.clientRate = role.clientRate
    next.costRate = crewCostRate(role, null)
  }
  return next
}

/**
 * Kwota wpisana ręcznie w wierszu (zł; „Klient" w euro przelicza wołający,
 * jak każdą cenę z bazy — S3). Zaznacza ją jako ręczną: „zaktualizuj stawki"
 * jej nie ruszy. Pozycja z osobą liczy się od tej chwili po R1.
 */
export function withCrewAmount(line: QuoteCrewLine, field: 'client' | 'cost', value: number): QuoteCrewLine {
  const amount = Math.max(0, safeNum(value, 0))
  const next: QuoteCrewLine =
    field === 'client' ? { ...line, clientRate: amount, clientEdited: true } : { ...line, costRate: amount, costEdited: true }
  if (line.personId) next.clientFromPerson = true
  return next
}

/** ↺ przy ręcznej kwocie: znowu z bazy (ta sama reguła co „zaktualizuj stawki"). */
export function resetCrewAmount(
  line: QuoteCrewLine,
  field: 'client' | 'cost',
  role: RoleRates | null | undefined,
  person: Pick<CrewMember, 'rate' | 'roleRates' | 'deletedAt'> | null | undefined
): QuoteCrewLine {
  const livePerson = line.personId && person && !person.deletedAt ? person : null
  const base = baseRates(line, role ?? null, livePerson)
  if (field === 'client') {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { clientEdited, ...rest } = line
    return { ...rest, clientRate: base.clientRate }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { costEdited, ...rest } = line
  return { ...rest, costRate: base.costRate }
}

/** Domyślna rola pierwszego dnia nowej wyceny (A2, M.J.: „ReżOp · Ja"). */
export const FIRST_DAY_ROLE_ID = 'rezOp'

/**
 * Ekipa pierwszego dnia, gdy dzień 1 powstaje od zera (A2): jedna pozycja
 * „ReżOp · Ja" po moich stawkach. Bez „Ja" w Ekipie — miejsce „ReżOp" do
 * obsadzenia; ReżOp wycofany — pusto. `people` = żywi ludzie z bazy.
 */
export function defaultFirstDayCrew(roles: (RoleLike & Pick<CrewRole, 'retiredAt'>)[], people: CrewMember[]): QuoteCrewLine[] {
  const role = roles.find((r) => r.id === FIRST_DAY_ROLE_ID && !r.retiredAt)
  if (!role) return []
  const me = selfCrewMember(people)
  return [createQuoteCrewLine(role, me && !me.retiredAt ? me : null)]
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

/**
 * Aktorzy dnia — do „skopiuj liczbę aktorów" w Dodatkowych (prawa do
 * wizerunku): stary licznik `aktor` plus pozycje ekipy z wbudowaną rolą
 * „Aktor". Model i statyści się nie liczą, jak dotąd.
 */
export function dayActorCount(day: Pick<ShootingDay, 'aktor' | 'crew'>): number {
  const fromLines = safeArray<QuoteCrewLine>(day.crew)
    .filter((line) => line.roleId === 'aktor')
    .reduce((sum, line) => sum + lineQty(line), 0)
  return Math.max(0, safeNum(day.aktor, 0)) + fromLines
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

type PersonLike = Pick<CrewMember, 'id' | 'name' | 'rate' | 'roleRates' | 'deletedAt'> & Partial<Pick<CrewMember, 'self'>>

/**
 * Kwoty pozycji z bazy TERAZ. „Klient": pozycja R1 z żywą osobą — stawka
 * osoby w roli; pozycja R1 z osobą usuniętą z bazy — zamrożona; pozycja sprzed
 * R1 i miejsce do obsadzenia — stawka roli (bez roli zamrożona). „Koszt":
 * osoba usunięta — zamrożony, inaczej `crewCostRate`.
 */
function baseRates(
  line: QuoteCrewLine,
  role: RoleRates | null,
  livePerson: PersonRate | null
): { clientRate: number; costRate: number } {
  let clientRate: number
  if (line.clientFromPerson && line.personId) {
    clientRate = livePerson ? crewClientRate(role, livePerson, line.clientRate, line.roleId) : line.clientRate
  } else {
    clientRate = role ? role.clientRate : line.clientRate
  }
  const costRate = line.personId && !livePerson ? line.costRate : crewCostRate(role, livePerson, clientRate, line.roleId)
  return { clientRate, costRate }
}

/**
 * Pozycja z bieżącymi nazwami i stawkami z bazy (rola i osoba spoza bazy →
 * bez zmian). Kwoty wpisane ręcznie zostają (R1).
 */
function refreshedLine(line: QuoteCrewLine, roles: Map<string, RoleLike>, people: Map<string, PersonLike>): QuoteCrewLine {
  const role = roles.get(line.roleId)
  const person = line.personId ? people.get(line.personId) : undefined
  const livePerson = person && !person.deletedAt ? person : undefined
  if (!role && !livePerson) return line
  const next: QuoteCrewLine = { ...line }
  if (role) {
    next.roleName = role.name
    next.group = role.group
  }
  if (livePerson) {
    next.personName = livePerson.name
    // R2: „Moja praca" idzie za kartą „Ja" (pozycja sprzed R2 dostaje znacznik przy „zaktualizuj").
    if (livePerson.self) next.ownWork = true
    else delete next.ownWork
  }
  const base = baseRates(line, role ?? null, livePerson ?? null)
  if (!line.clientEdited) next.clientRate = base.clientRate
  if (!line.costEdited) next.costRate = base.costRate
  return next
}

function sameLine(a: QuoteCrewLine, b: QuoteCrewLine): boolean {
  return (
    a.roleName === b.roleName &&
    a.group === b.group &&
    a.clientRate === b.clientRate &&
    a.costRate === b.costRate &&
    a.personName === b.personName &&
    !!a.ownWork === !!b.ownWork
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

/** „Zaktualizuj stawki": nazwy i stawki pozycji dnia z bieżącej bazy; ręczne kwoty zostają. */
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
        ...(person?.self ? { ownWork: true as const } : {}),
        quantity: 1,
        unitCost: crewCostRate(role, person),
        dayId,
      })
    }
    if (person) present.add(person.id)
  })
  return added
}
