/**
 * Ekipa (T9a, plan §6d): role i ludzie — słownik firmy obok katalogu sprzętu.
 *
 *  - ROLA (`crew-roles.json`) to to, za co płaci klient: „Gafer", „Montażysta".
 *    Stawka dla klienta pochodzi z roli (decyzja 7).
 *  - OSOBA (`crew.json`) to to, komu płacę JA: imię, role, jej stawka, kontakt.
 *    Ekipa na planie i podwykonawcy (montaż, kolor) są na jednej liście,
 *    różnią się grupą roli (decyzja 8).
 *
 * Osiem ról, które zna dziś kalkulator (`CrewRoleKey`), istnieje BEZ pliku:
 * nazwa i stawka z bieżącego cennika, tak jak w zakładce Profit. Odczyt nic
 * nie zapisuje — rola trafia do pliku dopiero przy pierwszej edycji, a nowa
 * rola przy dodaniu. Wbudowana rola, której nie edytowano, idzie więc za
 * cennikiem; edytowana ma już własne stawki.
 *
 * Wszystkie schematy są `.passthrough()`, nowe pola tylko dopisujemy
 * (opcjonalne z `.catch`), usuwanie ludzi jest miękkie (`deletedAt`), a role
 * się wycofuje (`retiredAt`). Moduł czysty — bez Reacta i zapisu.
 */

import { z } from 'zod'
import type { PricingConfigShape } from './pricing-config'
import type { CrewRoleKey } from './quote-types'
import { personKey } from './project-costs'
import { safeNum } from './safe-numbers'

// ── Grupy ról ────────────────────────────────────────────────────────────────

/** Klucze na zawsze; `group` w rekordzie to wolny string, nieznany pokazuje się dosłownie. */
export const CREW_ROLE_GROUPS = ['ekipa', 'obsada', 'post'] as const
export type CrewRoleGroup = (typeof CREW_ROLE_GROUPS)[number]

export const CREW_ROLE_GROUP_LABELS: Record<CrewRoleGroup, string> = {
  ekipa: 'Ekipa na planie',
  obsada: 'Obsada',
  post: 'Postprodukcja i podwykonawcy',
}

export function crewRoleGroupLabel(group: string): string {
  return CREW_ROLE_GROUP_LABELS[group as CrewRoleGroup] ?? group
}

function groupRank(group: string): number {
  const index = (CREW_ROLE_GROUPS as readonly string[]).indexOf(group)
  return index === -1 ? CREW_ROLE_GROUPS.length : index
}

// ── Schematy ─────────────────────────────────────────────────────────────────

const optionalText = z.string().optional().catch(undefined)
const optionalRate = z.number().finite().nonnegative().optional().catch(undefined)

export const crewRoleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    /** Stawka dla klienta za dzień (PLN netto, przed marżą z nagłówka wyceny). */
    clientRate: z.number().finite().nonnegative().catch(0),
    /** Mój koszt za dzień, gdy nie wiadomo jeszcze, kto pojedzie; brak = stawka klienta. */
    costRate: optionalRate,
    /** Klucz z `CREW_ROLE_GROUPS` albo dowolny tekst. */
    group: z.string().min(1).catch('ekipa'),
    /** Kolejność w obrębie grupy (rosnąco). */
    order: z.number().finite().catch(0),
    /** Wycofana (YYYY-MM-DD albo ISO): zostaje w historii, znika z list wyboru. */
    retiredAt: optionalText,
    updatedAt: optionalText,
  })
  .passthrough()
export type CrewRole = z.infer<typeof crewRoleSchema>

export const crewContactSchema = z
  .object({
    phone: optionalText,
    email: optionalText,
  })
  .passthrough()
export type CrewContact = z.infer<typeof crewContactSchema>

/** Lista id: zły wpis znika, reszta zostaje (`.catch([])` wyzerowałby całą listę). */
const roleIdList = z
  .array(z.unknown())
  .catch([])
  .transform((list) => list.filter((id): id is string => typeof id === 'string' && id.length > 0))

export const crewMemberSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    /** Role, w których ta osoba pracuje (`CrewRole.id`). */
    roleIds: roleIdList,
    /** Ile ta osoba bierze ode MNIE za dzień (PLN netto); brak = nieznane. */
    rate: optionalRate,
    contact: crewContactSchema.catch({}),
    city: optionalText,
    notes: optionalText,
    /** Już nie współpracuję: zostaje w historii i statystykach, znika z list wyboru. */
    retiredAt: optionalText,
    /** Miękkie usunięcie (ISO); „Cofnij" je zdejmuje. */
    deletedAt: optionalText,
    createdAt: z.string().catch(''),
    updatedAt: z.string().catch(''),
  })
  .passthrough()
export type CrewMember = z.infer<typeof crewMemberSchema>

// ── Identyfikatory ───────────────────────────────────────────────────────────

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createCrewRoleId(): string {
  return `cr-${randomSuffix()}`
}

export function createCrewMemberId(): string {
  return `cm-${randomSuffix()}`
}

// ── Role wbudowane ───────────────────────────────────────────────────────────

/**
 * Osiem ról kalkulatora — te same id co `CrewRoleKey`, nazwy jak w zakładce
 * Profit (`CREW_ROLE_DEFS` w `profit-calc.ts`; test pilnuje zgodności), stawki
 * z cennika (`pricing.produkcja`).
 */
export const BUILT_IN_CREW_ROLES: readonly {
  id: CrewRoleKey
  name: string
  priceKey: keyof PricingConfigShape['produkcja']
  group: CrewRoleGroup
}[] = [
  { id: 'rezOp', name: 'ReżOp', priceKey: 'rezOp', group: 'ekipa' },
  { id: 'asystent', name: 'Asystent/Operator', priceKey: 'asystentOperator', group: 'ekipa' },
  { id: 'gafer', name: 'Gafer', priceKey: 'gafer', group: 'ekipa' },
  { id: 'dzwiekowiec', name: 'Dźwiękowiec', priceKey: 'dzwiekowiec', group: 'ekipa' },
  { id: 'mua', name: 'MUA (Wizaż)', priceKey: 'mua', group: 'ekipa' },
  { id: 'aktor', name: 'Aktor', priceKey: 'aktor', group: 'obsada' },
  { id: 'model', name: 'Model', priceKey: 'model', group: 'obsada' },
  { id: 'statysta', name: 'Statysta/Epizodysta', priceKey: 'statystaEpizodysta', group: 'obsada' },
]

const BUILT_IN_IDS = new Set<string>(BUILT_IN_CREW_ROLES.map((r) => r.id))

export function isBuiltInCrewRole(id: string): boolean {
  return BUILT_IN_IDS.has(id)
}

/** Wbudowane role z bieżącego cennika (kolejność co 10, żeby dało się wstawić między). */
export function builtInCrewRoles(pricing: Pick<PricingConfigShape, 'produkcja'>): CrewRole[] {
  return BUILT_IN_CREW_ROLES.map((def, index) => ({
    id: def.id,
    name: def.name,
    clientRate: safeNum(pricing.produkcja?.[def.priceKey], 0, 0),
    group: def.group,
    order: (index + 1) * 10,
  }))
}

/** Grupa, potem kolejność, potem nazwa. */
export function compareCrewRoles(a: CrewRole, b: CrewRole): number {
  return (
    groupRank(a.group) - groupRank(b.group) ||
    a.group.localeCompare(b.group, 'pl') ||
    a.order - b.order ||
    a.name.localeCompare(b.name, 'pl')
  )
}

/**
 * Pełna lista ról: zapisane rekordy oraz wbudowane, których jeszcze nie
 * zapisano (ze stawką z bieżącego cennika). Zapisany rekord o id wbudowanej
 * roli ją zastępuje. Także wycofane — listy wyboru filtrują `activeCrewRoles`.
 */
export function resolveCrewRoles(stored: CrewRole[], pricing: Pick<PricingConfigShape, 'produkcja'>): CrewRole[] {
  const storedIds = new Set(stored.map((r) => r.id))
  return [...stored, ...builtInCrewRoles(pricing).filter((r) => !storedIds.has(r.id))].sort(compareCrewRoles)
}

export function activeCrewRoles(roles: CrewRole[]): CrewRole[] {
  return roles.filter((r) => !r.retiredAt)
}

/** Rola po nazwie (bez wielkości liter i polskich znaków) — wiersz kosztu ma rolę tekstem. */
export function crewRoleByName(roles: CrewRole[], name: string | undefined): CrewRole | null {
  const key = personKey(name)
  if (!key) return null
  return roles.find((r) => personKey(r.name) === key) ?? null
}

/** Nowa rola na końcu swojej grupy. */
export function createCrewRole(
  params: { name: string; group?: string; clientRate?: number; costRate?: number },
  existing: CrewRole[],
  now: Date = new Date()
): CrewRole {
  const group = params.group?.trim() || 'ekipa'
  const lastOrder = existing.filter((r) => r.group === group).reduce((max, r) => Math.max(max, r.order), 0)
  const role: CrewRole = {
    id: createCrewRoleId(),
    name: params.name.trim(),
    clientRate: safeNum(params.clientRate, 0, 0),
    group,
    order: lastOrder + 10,
    updatedAt: now.toISOString(),
  }
  if (params.costRate !== undefined && Number.isFinite(params.costRate) && params.costRate >= 0) {
    role.costRate = params.costRate
  }
  return role
}

// ── Ludzie ───────────────────────────────────────────────────────────────────

/** Ludzie bez usuniętych (wycofani zostają — w historii i statystykach). */
export function liveCrewMembers(members: CrewMember[]): CrewMember[] {
  return members.filter((m) => !m.deletedAt)
}

/** Ludzie do wyboru w listach: bez usuniętych i wycofanych. */
export function pickableCrewMembers(members: CrewMember[]): CrewMember[] {
  return members.filter((m) => !m.deletedAt && !m.retiredAt)
}

/** Osoba po imieniu (klucz `personKey`); usunięci się nie liczą, najstarszy rekord wygrywa. */
export function crewMemberByName(members: CrewMember[], name: string | undefined): CrewMember | null {
  const key = personKey(name)
  if (!key) return null
  return (
    liveCrewMembers(members)
      .filter((m) => personKey(m.name) === key)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0] ?? null
  )
}

export function createCrewMember(
  params: {
    name: string
    roleIds?: string[]
    rate?: number
    contact?: CrewContact
    city?: string
    notes?: string
  },
  now: Date = new Date()
): CrewMember {
  const iso = now.toISOString()
  const member: CrewMember = {
    id: createCrewMemberId(),
    name: params.name.trim(),
    roleIds: [...new Set(params.roleIds ?? [])],
    contact: { ...(params.contact ?? {}) },
    createdAt: iso,
    updatedAt: iso,
  }
  if (params.rate !== undefined && Number.isFinite(params.rate) && params.rate > 0) member.rate = params.rate
  if (params.city?.trim()) member.city = params.city.trim()
  if (params.notes?.trim()) member.notes = params.notes.trim()
  return member
}

// ── Wybór osoby i kontakt ────────────────────────────────────────────────────

/**
 * Ludzie do wyboru w wierszu ekipy: najpierw ci, którzy mają tę rolę, potem
 * reszta (alfabetycznie). `query` zawęża po imieniu (bez wielkości liter i
 * polskich znaków). Wycofani i usunięci nie są do wyboru.
 */
export function crewPickerOptions(
  members: CrewMember[],
  roleId: string | null,
  query = ''
): { withRole: CrewMember[]; others: CrewMember[] } {
  const needle = personKey(query)
  const list = pickableCrewMembers(members)
    .filter((m) => !needle || personKey(m.name).includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  if (!roleId) return { withRole: [], others: list }
  return {
    withRole: list.filter((m) => m.roleIds.includes(roleId)),
    others: list.filter((m) => !m.roleIds.includes(roleId)),
  }
}

/** Kontakt do skopiowania: „Imię · telefon · e-mail" (puste pola pominięte). */
export function crewContactText(member: Pick<CrewMember, 'name' | 'contact'>): string {
  return [member.name.trim(), member.contact?.phone?.trim(), member.contact?.email?.trim()].filter(Boolean).join(' · ')
}
