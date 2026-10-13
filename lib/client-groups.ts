/**
 * Grupy klientów (S2, plan po jeździe próbnej §3.4, decyzja D).
 *
 * Klient dalej jest polem projektu (decyzja 3) — grupa przechowuje tylko
 * KLUCZE klientów (`clientKey`), np. „CIONET" + „DE Group Sp. z o.o.". Każdy
 * członek zostaje sobą (własna nazwa, własna strona); w statystykach i
 * filtrach grupa liczy się jak jeden klient.
 *
 * To pierwszy zapis, który musi iść w parze z nazwami klientów:
 *  - „Scal nazwy" przenosi członkostwo na nową nazwę (`groupsAfterClientMerge`),
 *  - nowa pisownia wpisana w nagłówku projektu po cichu wypada z grupy —
 *    strona takiego klienta pokazuje „poza grupą" (`strayGroup`).
 *
 * Klient jest najwyżej w jednej grupie: dodanie do grupy przenosi go z
 * poprzedniej. Grupy usuwa się miękko (`deletedAt`, „Cofnij"). Schemat jest
 * `.passthrough()`, pola opcjonalne bez wartości domyślnych (`npm run data`).
 *
 * Wspólne wyszukiwanie dla Projektów, Finansów i raportu (S4/S5): wartość
 * filtra klienta to klucz klienta ALBO `grupa:<id>` (`clientScope`,
 * `scopeKeys`, `inClientScope`, `clientScopeOf`).
 *
 * Moduł czysty — testy w `client-groups.test.ts`.
 */

import { z } from 'zod'
import { clientKey, type ClientInfo } from './clients'
import { looksLikeSameClient } from './client-merge'

// ── Schemat ──────────────────────────────────────────────────────────────────

const optionalText = z.string().optional().catch(undefined)

/** Lista kluczy: zły wpis znika, reszta zostaje. */
const memberList = z
  .array(z.unknown())
  .catch([])
  .transform((list) => list.filter((key): key is string => typeof key === 'string' && key.trim().length > 0))

export const clientGroupSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    /** Klucze klientów (`clientKey`); porównujemy po `clientKey`, więc wpisana nazwa też zadziała. */
    members: memberList,
    createdAt: z.string().catch(''),
    updatedAt: z.string().catch(''),
    /** Miękkie usunięcie („Rozwiąż grupę"); „Cofnij" je zdejmuje. */
    deletedAt: optionalText,
  })
  .passthrough()
export type ClientGroup = z.infer<typeof clientGroupSchema>

export function createClientGroupId(): string {
  return `cg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ── Odczyt ───────────────────────────────────────────────────────────────────

/** Grupy bez rozwiązanych. */
export function liveGroups(groups: ClientGroup[]): ClientGroup[] {
  return groups.filter((g) => !g.deletedAt)
}

/** Klucze członków: znormalizowane, bez pustych i powtórzeń, w kolejności z pliku. */
export function groupMemberKeys(group: Pick<ClientGroup, 'members'>): string[] {
  return [...new Set(group.members.map(clientKey).filter(Boolean))]
}

/** Starsza grupa pierwsza — gdy klient trafił do dwóch (np. ręczny import), wygrywa starsza. */
function byAge(a: ClientGroup, b: ClientGroup): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** Grupa klienta (po kluczu albo nazwie); `null` = poza grupami. */
export function groupOfClient(groups: ClientGroup[], keyOrName: string): ClientGroup | null {
  const key = clientKey(keyOrName)
  if (!key) return null
  return [...liveGroups(groups)].sort(byAge).find((g) => groupMemberKeys(g).includes(key)) ?? null
}

// ── Zakres filtra: klient albo grupa (Projekty, Finanse, raport) ─────────────

/** Wartość filtra „grupa" — reszta wartości to klucze klientów. */
export const GROUP_SCOPE_PREFIX = 'grupa:'

export function groupScopeValue(groupId: string): string {
  return `${GROUP_SCOPE_PREFIX}${groupId}`
}

export function isGroupScope(value: string | null | undefined): boolean {
  return !!value && value.startsWith(GROUP_SCOPE_PREFIX)
}

export type ClientScope =
  | { kind: 'client'; value: string; keys: string[] }
  | { kind: 'group'; value: string; group: ClientGroup; keys: string[] }

/**
 * Co wybrano w filtrze klienta: klienta (klucz) albo grupę (`grupa:<id>`).
 * `null` = wszyscy (pusta wartość) albo grupa, której już nie ma.
 */
export function clientScope(value: string | null | undefined, groups: ClientGroup[]): ClientScope | null {
  if (!value) return null
  if (isGroupScope(value)) {
    const id = value.slice(GROUP_SCOPE_PREFIX.length)
    const group = liveGroups(groups).find((g) => g.id === id)
    return group ? { kind: 'group', value, group, keys: groupMemberKeys(group) } : null
  }
  const key = clientKey(value)
  return key ? { kind: 'client', value: key, keys: [key] } : null
}

/** Klucze klientów w zakresie filtra; `null` = bez filtra. */
export function scopeKeys(value: string | null | undefined, groups: ClientGroup[]): Set<string> | null {
  const scope = clientScope(value, groups)
  return scope ? new Set(scope.keys) : null
}

/** Czy projekt (jego pole klienta) jest w zakresie; `keys === null` = wszyscy. */
export function inClientScope(project: { client?: string | null }, keys: Set<string> | null): boolean {
  return !keys || keys.has(clientKey(project.client ?? ''))
}

/**
 * Pod jaką pozycją liczyć projekt w zestawieniu „po klientach" (raport,
 * Finanse): `grupa:<id>` dla członka grupy, inaczej klucz klienta; '' = bez
 * klienta.
 */
export function clientScopeOf(groups: ClientGroup[], clientName: string): string {
  const group = groupOfClient(groups, clientName)
  return group ? groupScopeValue(group.id) : clientKey(clientName)
}

/**
 * Grupy jako pozycje listy wyboru klienta (filtr Projektów): nazwa, liczba
 * projektów i ostatni projekt członków; szukanie po nazwie grupy i członków.
 */
export function groupDirectory(groups: ClientGroup[], directory: ClientInfo[]): ClientInfo[] {
  const byKey = new Map(directory.map((c) => [c.key, c]))
  return liveGroups(groups).map((group) => {
    const members = groupMemberKeys(group).flatMap((key) => {
      const info = byKey.get(key)
      return info ? [info] : []
    })
    return {
      key: groupScopeValue(group.id),
      name: group.name.trim() || members.map((m) => m.name).join(' + ') || 'Grupa bez nazwy',
      projectCount: members.reduce((sum, m) => sum + m.projectCount, 0),
      lastDate: members.reduce((last, m) => (m.lastDate > last ? m.lastDate : last), ''),
      search: [clientKey(group.name), ...members.map((m) => m.key)].join(' '),
    }
  })
}

// ── „Poza grupą" ─────────────────────────────────────────────────────────────

/**
 * Klient spoza grup, którego nazwa wygląda jak członek grupy (wspólne
 * znaczące słowo albo jedna nazwa zaczyna drugą — `looksLikeSameClient`):
 * zwykle nowa pisownia wpisana w nagłówku projektu. `null` = w grupie albo
 * nic podobnego.
 */
export function strayGroup(groups: ClientGroup[], key: string): ClientGroup | null {
  if (!key || groupOfClient(groups, key)) return null
  return [...liveGroups(groups)].sort(byAge).find((g) => groupMemberKeys(g).some((m) => looksLikeSameClient(key, m))) ?? null
}

/** Klienci spoza grup podobni do członków tej grupy (strona grupy: „Podobne nazwy poza grupą"). */
export function groupStrays(groups: ClientGroup[], group: ClientGroup, directory: ClientInfo[]): ClientInfo[] {
  return directory.filter((c) => strayGroup(groups, c.key)?.id === group.id)
}

// ── Edycja (każda zwraca nową listę wszystkich grup, do jednego zapisu) ───────

/** Nowa grupa; jej członkowie wychodzą z innych grup. Pusta nazwa = nazwy członków. */
export function createClientGroup(
  groups: ClientGroup[],
  params: { name: string; members: string[] },
  now: string
): { groups: ClientGroup[]; group: ClientGroup } {
  const members = [...new Set(params.members.map(clientKey).filter(Boolean))]
  const group: ClientGroup = {
    id: createClientGroupId(),
    name: params.name.trim(),
    members,
    createdAt: now,
    updatedAt: now,
  }
  return { groups: [...withoutKeys(groups, members, null, now), group], group }
}

/** Klucze wyjmowane z grup innych niż `keepId` (klient jest najwyżej w jednej grupie). */
function withoutKeys(groups: ClientGroup[], keys: string[], keepId: string | null, now: string): ClientGroup[] {
  const drop = new Set(keys)
  return groups.map((g) => {
    if (g.id === keepId || g.deletedAt) return g
    const members = g.members.filter((m) => !drop.has(clientKey(m)))
    return members.length === g.members.length ? g : { ...g, members, updatedAt: now }
  })
}

export function renameClientGroup(groups: ClientGroup[], groupId: string, name: string, now: string): ClientGroup[] {
  const trimmed = name.trim()
  return groups.map((g) => (g.id === groupId && g.name !== trimmed ? { ...g, name: trimmed, updatedAt: now } : g))
}

/** Dodanie klientów do grupy — z innych grup są przenoszeni. */
export function addGroupMembers(groups: ClientGroup[], groupId: string, keys: string[], now: string): ClientGroup[] {
  const added = [...new Set(keys.map(clientKey).filter(Boolean))]
  const target = groups.find((g) => g.id === groupId && !g.deletedAt)
  if (!target || added.length === 0) return groups
  const present = new Set(groupMemberKeys(target))
  const fresh = added.filter((k) => !present.has(k))
  return withoutKeys(groups, added, groupId, now).map((g) =>
    g.id === groupId && fresh.length > 0 ? { ...g, members: [...g.members, ...fresh], updatedAt: now } : g
  )
}

export function removeGroupMember(groups: ClientGroup[], groupId: string, key: string, now: string): ClientGroup[] {
  const drop = clientKey(key)
  return groups.map((g) => {
    if (g.id !== groupId) return g
    const members = g.members.filter((m) => clientKey(m) !== drop)
    return members.length === g.members.length ? g : { ...g, members, updatedAt: now }
  })
}

/** „Rozwiąż grupę": miękko; członkowie zostają w pliku (do „Cofnij"). */
export function dissolveClientGroup(groups: ClientGroup[], groupId: string, at: string): ClientGroup[] {
  return groups.map((g) => (g.id === groupId && !g.deletedAt ? { ...g, deletedAt: at, updatedAt: at } : g))
}

/** „Cofnij" rozwiązania — tylko tego (ten sam znacznik). */
export function restoreClientGroup(groups: ClientGroup[], groupId: string, at: string, now: string): ClientGroup[] {
  return groups.map((g) => {
    if (g.id !== groupId || g.deletedAt !== at) return g
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt, ...rest } = g
    return { ...rest, updatedAt: now }
  })
}

// ── „Scal nazwy" ─────────────────────────────────────────────────────────────

/** Zmiana członków jednej grupy przy scaleniu nazw (do „Cofnij"). */
export interface GroupMembershipChange {
  id: string
  before: string[]
  after: string[]
}

/**
 * Członkostwo po „Scal nazwy" (klienci `keys` → `targetKey`): klucz
 * docelowy zostaje w grupie, w której już był; jeśli nie był w żadnej — trafia
 * do pierwszej grupy któregoś ze scalanych (w kolejności `keys`, strona
 * scalania pierwsza). Z pozostałych grup scalane klucze wychodzą.
 */
export function groupsAfterClientMerge(
  groups: ClientGroup[],
  plan: { keys: string[]; targetKey: string },
  now: string
): { groups: ClientGroup[]; changes: GroupMembershipChange[] } {
  const merged = new Set(plan.keys.map(clientKey))
  const target = clientKey(plan.targetKey)
  const owner =
    groupOfClient(groups, target) ??
    plan.keys.map((k) => groupOfClient(groups, k)).find((g): g is ClientGroup => !!g) ??
    null
  const changes: GroupMembershipChange[] = []
  const next = groups.map((g) => {
    if (g.deletedAt) return g
    const keys = groupMemberKeys(g)
    const touched = keys.some((k) => merged.has(k) || (k === target && g.id !== owner?.id))
    if (!touched) return g
    const kept = g.members.filter((m) => !merged.has(clientKey(m)) && clientKey(m) !== target)
    const members = g.id === owner?.id ? insertAt(g.members, kept, merged, target) : kept
    if (JSON.stringify(members) === JSON.stringify(g.members)) return g
    changes.push({ id: g.id, before: g.members, after: members })
    return { ...g, members, updatedAt: now }
  })
  return { groups: next, changes }
}

/** Klucz docelowy w miejscu pierwszego scalanego członka (kolejność na liście zostaje). */
function insertAt(original: string[], kept: string[], merged: Set<string>, target: string): string[] {
  const index = original.findIndex((m) => merged.has(clientKey(m)) || clientKey(m) === target)
  const before = original.slice(0, Math.max(0, index)).filter((m) => kept.includes(m))
  return [...before, target, ...kept.filter((m) => !before.includes(m))]
}

/** „Cofnij" scalenia nazw w grupach: poprzedni skład tam, gdzie wciąż jest ten ze scalenia. */
export function groupsAfterUndoMerge(groups: ClientGroup[], changes: GroupMembershipChange[], now: string): ClientGroup[] {
  const byId = new Map(changes.map((c) => [c.id, c]))
  return groups.map((g) => {
    const change = byId.get(g.id)
    if (!change || JSON.stringify(g.members) !== JSON.stringify(change.after)) return g
    return { ...g, members: change.before, updatedAt: now }
  })
}
