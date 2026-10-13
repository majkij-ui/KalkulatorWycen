/**
 * Call sheet dnia realizacji (T5b) — czyste funkcje.
 *
 * `resolveCallSheet` składa to, co pokazuje edytor i co trafia do PDF:
 *
 *   data                 → z kalendarza (dzień realizacji, `realization-days.ts`)
 *   miejsce              → własne z call sheetu, inaczej `data.location` wydarzenia
 *   ekipa                → wiersze ekipy dnia z Realizacji (`Project.costs`),
 *                          telefon i e-mail z bazy Ekipa; poprawki z call sheetu
 *                          wygrywają, osoby dopisane tylko tutaj dochodzą na końcu
 *   sprzęt               → siatka G3 dnia jako lista pakowania + rzeczy spoza katalogu
 *   klient               → `Project.contact`, z poprawkami z call sheetu
 *   zbiórka              → własna, inaczej początek pierwszego wpisu harmonogramu
 *
 * „Podpowiedz, nigdy nie nadpisuj": hub podpowiada każde puste pole na żywo,
 * a to, co wpisano w call sheecie, zostaje, nawet gdy w hubie coś się zmieni.
 * Wyczyszczone pole wraca do wartości z huba. Odczyt nic nie zapisuje.
 *
 * Funkcje edycji są niemutujące i usuwają miękko (`deletedAt`), więc „Cofnij"
 * (`restoreMarked` z tym samym znacznikiem) przywraca dokładnie to, co zniknęło.
 */

import { z } from 'zod'
import {
  createCallSheetId,
  createCallSheetItemId,
  type CallSheet,
  type CallSheetClient,
  type CallSheetContact,
  type CallSheetCrewEntry,
  type CallSheetGearExtra,
} from './call-sheet-types'
import {
  categorySchema,
  DEFAULT_CATEGORIES,
  paletteKeyForHex,
  plannerEventSchema,
  type Category,
  type EventSubItem,
  type PlannerEvent,
  type SavedDay,
} from './schedule-types'
import { setEventDuration, setEventStart } from './editing-engine'
import { formatLocalYmd, getDurationMinutes } from './time'
import { isProjectColorKey } from './calendar-palette'
import { buildPackingList, type PackingGroup } from './gear-usage'
import { costsOfDay, isCrew, personKey } from './project-costs'
import { crewMemberById, crewMemberByName, liveCrewMembers, type CrewMember } from './crew-types'
import type { EquipmentItem, GearDay, Project } from './project-types'
import type { TimelineEvent } from './event-types'

/** Początek pierwszego wpisu, gdy harmonogram jest pusty (06:00, jak w CallSheetWiz). */
export const DEFAULT_START_WHEN_EMPTY = 6 * 60

// ── Rekord ───────────────────────────────────────────────────────────────────

/** Nowy call sheet dnia: domyślne tagi, pusty harmonogram. Nic jeszcze nie zapisuje. */
export function createCallSheet(params: { projectId: string; dayId: string }, now: Date = new Date()): CallSheet {
  const iso = now.toISOString()
  return {
    id: createCallSheetId(),
    projectId: params.projectId,
    dayId: params.dayId,
    schedule: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    crew: [],
    contacts: [],
    gearExtra: [],
    createdAt: iso,
    updatedAt: iso,
  }
}

/**
 * Call sheet dnia. Dwa żywe dla tego samego dnia (np. dwa okna naraz) —
 * wygrywa starszy; drugi zostaje w pliku nietknięty.
 */
export function callSheetForDay(sheets: CallSheet[], projectId: string, dayId: string): CallSheet | null {
  return (
    sheets
      .filter((s) => !s.deletedAt && s.projectId === projectId && s.dayId === dayId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0] ?? null
  )
}

/** Czy w call sheecie jest coś, co warto zapisać (harmonogram, poprawki, uwagi). */
export function liveScheduleCount(sheet: Pick<CallSheet, 'schedule'>): number {
  return sheet.schedule.filter((e) => !e.deletedAt).length
}

// ── Miękkie usuwanie (wspólne dla list w call sheecie) ──────────────────────

type Removable = { id: string; deletedAt?: string }

export function markDeleted<T extends Removable>(list: T[], id: string, deletedAt: string): T[] {
  return list.map((item) => (item.id === id ? { ...item, deletedAt } : item))
}

/** Zdejmuje `deletedAt` z pozycji usuniętych z tym znacznikiem. */
export function restoreMarked<T extends Removable>(list: T[], deletedAt: string): T[] {
  return list.map((item) => {
    if (item.deletedAt !== deletedAt) return item
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt: _removed, ...rest } = item
    return rest as T
  })
}

function live<T extends { deletedAt?: string }>(list: T[]): T[] {
  return list.filter((item) => !item.deletedAt)
}

/** Przywraca w całym call sheecie wszystko, co usunięto z tym znacznikiem. */
export function restoreSheetItems(sheet: CallSheet, deletedAt: string): CallSheet {
  return {
    ...sheet,
    schedule: restoreMarked(sheet.schedule, deletedAt),
    categories: restoreMarked(sheet.categories, deletedAt),
    crew: restoreMarked(sheet.crew, deletedAt),
    contacts: restoreMarked(sheet.contacts, deletedAt),
    gearExtra: restoreMarked(sheet.gearExtra, deletedAt),
  }
}

// ── Harmonogram ──────────────────────────────────────────────────────────────

/** Wpisy bez usuniętych, po godzinie (równe początki: krótszy pierwszy, potem kolejność dodania). */
export function liveSchedule(sheet: Pick<CallSheet, 'schedule'>): PlannerEvent[] {
  return live(sheet.schedule).sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes)
}

/** Domyślny początek nowego wpisu: koniec ostatniego albo 06:00 (jak w CallSheetWiz). */
export function nextStartMinutes(sheet: Pick<CallSheet, 'schedule'>): number {
  const events = live(sheet.schedule)
  return events.length > 0 ? Math.max(...events.map((e) => e.endMinutes)) : DEFAULT_START_WHEN_EMPTY
}

/** Dodaje albo podmienia wpis (po `id`). */
export function upsertScheduleItem(sheet: CallSheet, item: PlannerEvent): CallSheet {
  const exists = sheet.schedule.some((e) => e.id === item.id)
  return {
    ...sheet,
    schedule: exists ? sheet.schedule.map((e) => (e.id === item.id ? item : e)) : [...sheet.schedule, item],
  }
}

/**
 * Przeciąganie na osi czasu (port `handleEventChange` z CallSheetWiz): nowy
 * początek przesuwa wpis z zachowaniem czasu trwania, nowy koniec zmienia
 * czas trwania.
 */
export function moveScheduleItem(
  sheet: CallSheet,
  id: string,
  updates: { startMinutes?: number; endMinutes?: number }
): CallSheet {
  return {
    ...sheet,
    schedule: sheet.schedule.map((event) => {
      if (event.id !== id) return event
      let next = event
      if (updates.startMinutes != null) next = setEventStart(next, updates.startMinutes)
      if (updates.endMinutes != null) {
        next = setEventDuration(next, getDurationMinutes(next.startMinutes, updates.endMinutes))
      }
      return next
    }),
  }
}

export function softDeleteScheduleItem(sheet: CallSheet, id: string, deletedAt: string): CallSheet {
  return { ...sheet, schedule: markDeleted(sheet.schedule, id, deletedAt) }
}

/** Kilka wpisów naraz (cofnięcie szablonu, kopii albo importu). */
export function softDeleteScheduleItems(sheet: CallSheet, ids: Iterable<string>, deletedAt: string): CallSheet {
  const wanted = new Set(ids)
  return {
    ...sheet,
    schedule: sheet.schedule.map((e) => (wanted.has(e.id) && !e.deletedAt ? { ...e, deletedAt } : e)),
  }
}

/** Id żywych wpisów, których nie było w `before` (co dopisał szablon, kopia albo import). */
export function addedScheduleIds(before: Pick<CallSheet, 'schedule'>, after: Pick<CallSheet, 'schedule'>): string[] {
  const known = new Set(before.schedule.map((e) => e.id))
  return live(after.schedule)
    .filter((e) => !known.has(e.id))
    .map((e) => e.id)
}

// ── Punkty pod wpisem (ujęcia) ───────────────────────────────────────────────

export function addSubItem(event: PlannerEvent, text: string): PlannerEvent {
  const trimmed = text.trim()
  if (!trimmed) return event
  const item: EventSubItem = { id: createCallSheetItemId('sub'), text: trimmed, isCompleted: false }
  return { ...event, subItems: [...(event.subItems ?? []), item] }
}

export function updateSubItem(event: PlannerEvent, id: string, patch: Partial<EventSubItem>): PlannerEvent {
  return { ...event, subItems: (event.subItems ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

/** Punkt to linijka tekstu w wpisie (jak w CallSheetWiz) — usuwa się go z listy wpisu. */
export function removeSubItem(event: PlannerEvent, id: string): PlannerEvent {
  return { ...event, subItems: (event.subItems ?? []).filter((s) => s.id !== id) }
}

/** Przesuwa punkt o `delta` miejsc (−1 w górę, +1 w dół); poza listą nic się nie dzieje. */
export function moveSubItem(event: PlannerEvent, id: string, delta: number): PlannerEvent {
  const items = [...(event.subItems ?? [])]
  const from = items.findIndex((s) => s.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= items.length) return event
  const [moved] = items.splice(from, 1)
  items.splice(to, 0, moved)
  return { ...event, subItems: items }
}

// ── Tagi ─────────────────────────────────────────────────────────────────────

export function liveCategories(sheet: Pick<CallSheet, 'categories'>): Category[] {
  return live(sheet.categories)
}

/**
 * Nowy tag. Pusta nazwa albo nazwa, którą ma już żywy tag (bez wielkości
 * liter i polskich znaków), nic nie dodaje — jak w CallSheetWiz.
 */
export function addCategory(sheet: CallSheet, label: string, color: string): CallSheet {
  const trimmed = label.trim()
  if (!trimmed) return sheet
  if (liveCategories(sheet).some((c) => personKey(c.label) === personKey(trimmed))) return sheet
  return { ...sheet, categories: [...sheet.categories, { id: createCallSheetItemId('tag'), label: trimmed, color }] }
}

export function updateCategory(sheet: CallSheet, id: string, patch: Partial<Category>): CallSheet {
  return { ...sheet, categories: sheet.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
}

/**
 * Usunięcie tagu. Wpisy zachowują `categoryId` i pokazują się jako „bez
 * tagu" (CallSheetWiz czyścił je na twardo) — po „Cofnij" wracają do koloru.
 */
export function softDeleteCategory(sheet: CallSheet, id: string, deletedAt: string): CallSheet {
  return { ...sheet, categories: markDeleted(sheet.categories, id, deletedAt) }
}

/** Domyślne tagi o tych id, których call sheet nie ma wcale (szablon dnia, kopia). */
function withDefaultCategories(sheet: CallSheet, ids: string[]): CallSheet {
  const known = new Set(sheet.categories.map((c) => c.id))
  const missing = DEFAULT_CATEGORIES.filter((c) => ids.includes(c.id) && !known.has(c.id))
  return missing.length ? { ...sheet, categories: [...sheet.categories, ...missing.map((c) => ({ ...c }))] } : sheet
}

// ── Szablon dnia i kopia z innego dnia ───────────────────────────────────────

/** Typowy dzień zdjęciowy od godziny zbiórki: [tytuł, minuty, tag]. */
const DAY_TEMPLATE: readonly [string, number, string][] = [
  ['Zbiórka ekipy i odprawa', 30, 'logistics'],
  ['Rozstawienie sprzętu i światła', 60, 'camera'],
  ['Zdjęcia — blok 1', 210, 'camera'],
  ['Obiad', 60, 'meals'],
  ['Zdjęcia — blok 2', 180, 'camera'],
  ['Pakowanie i koniec dnia', 60, 'logistics'],
]

/**
 * Dopisuje szkielet dnia od `callTime` (domyślnie zbiórka call sheetu albo
 * 07:00). Brakujące domyślne tagi dochodzą; tag usunięty przez użytkownika
 * zostaje usunięty, a wpis idzie bez tagu.
 */
export function applyDayTemplate(sheet: CallSheet, callTime?: number): CallSheet {
  const start = callTime ?? sheet.callTime ?? 7 * 60
  const withTags = withDefaultCategories(sheet, DAY_TEMPLATE.map(([, , tag]) => tag))
  const liveTags = new Set(liveCategories(withTags).map((c) => c.id))
  let cursor = start
  const items: PlannerEvent[] = []
  for (const [title, minutes, tag] of DAY_TEMPLATE) {
    const end = Math.min(1439, cursor + minutes)
    if (end <= cursor) break
    items.push({
      id: createCallSheetItemId('ev'),
      title,
      startMinutes: cursor,
      endMinutes: end,
      categoryId: liveTags.has(tag) ? tag : '',
      subItems: [],
    })
    cursor = end
  }
  return { ...withTags, schedule: [...withTags.schedule, ...items] }
}

/**
 * Harmonogram z innego dnia (zwykle poprzedni dzień tych samych zdjęć):
 * nowe id, punkty bez odhaczeń. Tag źródła trafia do celu, gdy cel nie ma
 * żywego tagu o tym id ani o tej nazwie. Zbiórka i miejsce tylko, gdy cel ich
 * nie ma (nigdy nie nadpisuje).
 */
export function copyScheduleFrom(target: CallSheet, source: CallSheet): { sheet: CallSheet; added: number } {
  let categories = [...target.categories]
  const idMap = new Map<string, string>()
  liveCategories(source).forEach((tag) => {
    const liveTarget = live(categories)
    const sameId = liveTarget.find((c) => c.id === tag.id)
    if (sameId) {
      idMap.set(tag.id, sameId.id)
      return
    }
    const sameName = liveTarget.find((c) => personKey(c.label) === personKey(tag.label))
    if (sameName) {
      idMap.set(tag.id, sameName.id)
      return
    }
    const id = categories.some((c) => c.id === tag.id) ? createCallSheetItemId('tag') : tag.id
    categories = [...categories, { ...tag, id }]
    idMap.set(tag.id, id)
  })

  const copied = liveSchedule(source).map((event) => ({
    ...event,
    id: createCallSheetItemId('ev'),
    categoryId: idMap.get(event.categoryId) ?? '',
    subItems: (event.subItems ?? []).map((s) => ({ ...s, id: createCallSheetItemId('sub'), isCompleted: false })),
  }))

  const sheet: CallSheet = { ...target, categories, schedule: [...target.schedule, ...copied] }
  if (sheet.callTime === undefined && source.callTime !== undefined) sheet.callTime = source.callTime
  if (!sheet.locationNotes?.trim() && source.locationNotes?.trim()) sheet.locationNotes = source.locationNotes
  return { sheet, added: copied.length }
}

// ── Ekipa ────────────────────────────────────────────────────────────────────

export interface CrewValues {
  name: string
  role: string
  phone: string
  email: string
}

const CREW_FIELDS = ['name', 'role', 'phone', 'email'] as const

export interface ResolvedCrewRow {
  /** Stały klucz wiersza: id kosztu albo id wpisu dopisanego tutaj. */
  key: string
  /** Zapisany wpis call sheetu (poprawki albo osoba dopisana tutaj). */
  entry: CallSheetCrewEntry | null
  costId: string | null
  /** Osoba z bazy Ekipa, z której są telefon i e-mail. */
  personId: string | null
  /** Z Realizacji i bazy Ekipa — podpowiedź pod polem. */
  base: CrewValues
  /** Co pokazuje call sheet i PDF. */
  value: CrewValues
  /** Które pola wpisano w call sheecie. */
  own: Record<keyof CrewValues, boolean>
  callTime: number | null
  ownCallTime: boolean
  note: string
  hidden: boolean
  /** Osoba dopisana tylko na call sheecie (nie ma jej w Realizacji). */
  extra: boolean
}

const EMPTY_VALUES: CrewValues = { name: '', role: '', phone: '', email: '' }

function pick(own: string | undefined, base: string): { value: string; own: boolean } {
  const trimmed = own?.trim() ?? ''
  return trimmed ? { value: trimmed, own: true } : { value: base, own: false }
}

function merged(entry: CallSheetCrewEntry | null, base: CrewValues) {
  const value = { ...EMPTY_VALUES }
  const own = { name: false, role: false, phone: false, email: false }
  CREW_FIELDS.forEach((field) => {
    const result = pick(entry?.[field], base[field])
    value[field] = result.value
    own[field] = result.own
  })
  return { value, own }
}

/**
 * Ekipa dnia na call sheecie. Telefon i e-mail: osoba wskazana w wierszu
 * (`personId`), a wiersz bez wskazania — osoba o tym imieniu z bazy (jak w
 * statystykach Ekipy). Wiersz wskazujący osobę usuniętą z bazy zostaje z
 * zamrożonym imieniem, bez kontaktu. Poprawka, której wiersz zniknął z
 * Realizacji, zostaje w pliku, ale się nie pokazuje.
 */
export function resolveCrew(
  sheet: Pick<CallSheet, 'crew'>,
  costs: Project['costs'],
  dayId: string,
  people: CrewMember[],
  generalCall: number | null
): ResolvedCrewRow[] {
  const members = liveCrewMembers(people)
  const entries = live(sheet.crew)
  const byCost = new Map<string, CallSheetCrewEntry>()
  entries.forEach((e) => {
    if (e.costId && !byCost.has(e.costId)) byCost.set(e.costId, e)
  })

  const row = (
    key: string,
    entry: CallSheetCrewEntry | null,
    base: CrewValues,
    extra: boolean,
    costId: string | null,
    personId: string | null
  ): ResolvedCrewRow => {
    const { value, own } = merged(entry, base)
    const ownCallTime = entry?.callTime !== undefined
    return {
      key,
      entry,
      costId,
      personId,
      base,
      value,
      own,
      callTime: ownCallTime ? (entry?.callTime ?? null) : generalCall,
      ownCallTime,
      note: entry?.note?.trim() ?? '',
      hidden: !!entry?.hidden,
      extra,
    }
  }

  const fromRealization = costsOfDay(costs, dayId)
    .filter(isCrew)
    .map((cost) => {
      // Scalony duplikat (S2, `mergedInto`) prowadzi do osoby, która została.
      const member = cost.personId ? crewMemberById(people, cost.personId) : crewMemberByName(members, cost.person)
      const base: CrewValues = {
        name: cost.person?.trim() || member?.name.trim() || '',
        role: cost.role?.trim() ?? '',
        phone: member?.contact?.phone?.trim() ?? '',
        email: member?.contact?.email?.trim() ?? '',
      }
      return row(cost.id, byCost.get(cost.id) ?? null, base, false, cost.id, member?.id ?? null)
    })

  const added = entries
    .filter((e) => !e.costId)
    .map((entry) => row(entry.id, entry, EMPTY_VALUES, true, null, null))

  return [...fromRealization, ...added]
}

/** Puste pole (albo `null`) znaczy „bez poprawki": klucz znika, wraca wartość z huba. */
function cleanEntry<T extends Record<string, unknown>>(entry: T, patch: Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...entry, ...patch }
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || (key === 'hidden' && value === false)) {
      delete next[key]
    }
  })
  return next as T
}

/**
 * Poprawka wiersza ekipy. `costId` — wiersz z Realizacji (wpis powstaje przy
 * pierwszej poprawce); `entryId` — wpis już zapisany (np. osoba dopisana tutaj).
 */
export function patchCrew(
  sheet: CallSheet,
  target: { costId?: string | null; entryId?: string | null },
  patch: Partial<Omit<CallSheetCrewEntry, 'id' | 'costId'>> & Record<string, unknown>
): CallSheet {
  const existing =
    (target.entryId ? sheet.crew.find((e) => e.id === target.entryId) : undefined) ??
    (target.costId ? live(sheet.crew).find((e) => e.costId === target.costId) : undefined)
  if (existing) {
    return { ...sheet, crew: sheet.crew.map((e) => (e === existing ? cleanEntry(e, patch) : e)) }
  }
  if (!target.costId) return sheet
  const entry = cleanEntry<CallSheetCrewEntry>({ id: createCallSheetItemId('crew'), costId: target.costId }, patch)
  return { ...sheet, crew: [...sheet.crew, entry] }
}

/** Osoba tylko na call sheecie. */
export function addExtraCrew(sheet: CallSheet, init: Partial<CrewValues> = {}): { sheet: CallSheet; id: string } {
  const id = createCallSheetItemId('crew')
  const entry = cleanEntry<CallSheetCrewEntry>({ id }, { ...init })
  return { sheet: { ...sheet, crew: [...sheet.crew, entry] }, id }
}

export function softDeleteCrewEntry(sheet: CallSheet, id: string, deletedAt: string): CallSheet {
  return { ...sheet, crew: markDeleted(sheet.crew, id, deletedAt) }
}

// ── Kontakty ─────────────────────────────────────────────────────────────────

export interface ResolvedClient {
  /** Nazwa klienta projektu (nagłówek wiersza). */
  client: string
  base: Omit<CrewValues, 'role'>
  value: Omit<CrewValues, 'role'>
  own: Record<'name' | 'phone' | 'email', boolean>
  hidden: boolean
  /** Poprawki tak, jak je wpisano (pola edytora). */
  raw: CallSheetClient | null
}

export function resolveClient(
  sheet: Pick<CallSheet, 'client'>,
  project: Pick<Project, 'client' | 'contact'>
): ResolvedClient {
  const base = {
    name: project.contact?.name?.trim() ?? '',
    phone: project.contact?.phone?.trim() ?? '',
    email: project.contact?.email?.trim() ?? '',
  }
  const name = pick(sheet.client?.name, base.name)
  const phone = pick(sheet.client?.phone, base.phone)
  const email = pick(sheet.client?.email, base.email)
  return {
    client: project.client.trim(),
    base,
    value: { name: name.value, phone: phone.value, email: email.value },
    own: { name: name.own, phone: phone.own, email: email.own },
    hidden: !!sheet.client?.hidden,
    raw: sheet.client ?? null,
  }
}

export function patchClient(sheet: CallSheet, patch: Partial<CallSheetClient>): CallSheet {
  const next = cleanEntry<CallSheetClient>(sheet.client ?? {}, patch)
  return { ...sheet, client: Object.keys(next).length ? next : undefined }
}

export function addContact(sheet: CallSheet, init: Partial<CallSheetContact> = {}): { sheet: CallSheet; id: string } {
  const id = createCallSheetItemId('contact')
  const entry = cleanEntry<CallSheetContact>({ id }, { ...init, id })
  return { sheet: { ...sheet, contacts: [...sheet.contacts, entry] }, id }
}

export function patchContact(sheet: CallSheet, id: string, patch: Partial<CallSheetContact>): CallSheet {
  return { ...sheet, contacts: sheet.contacts.map((c) => (c.id === id ? cleanEntry(c, patch) : c)) }
}

export function softDeleteContact(sheet: CallSheet, id: string, deletedAt: string): CallSheet {
  return { ...sheet, contacts: markDeleted(sheet.contacts, id, deletedAt) }
}

// ── Sprzęt ───────────────────────────────────────────────────────────────────

export function addGearExtra(sheet: CallSheet, text: string): CallSheet {
  const trimmed = text.trim()
  if (!trimmed) return sheet
  return { ...sheet, gearExtra: [...sheet.gearExtra, { id: createCallSheetItemId('gear'), text: trimmed }] }
}

export function softDeleteGearExtra(sheet: CallSheet, id: string, deletedAt: string): CallSheet {
  return { ...sheet, gearExtra: markDeleted(sheet.gearExtra, id, deletedAt) }
}

// ── Całość ───────────────────────────────────────────────────────────────────

export interface CallSheetContext {
  project: Pick<Project, 'id' | 'name' | 'client' | 'contact' | 'costs'>
  /** Dzień realizacji (sprzęt z siatki G3 w `lines`). */
  day: Pick<GearDay, 'id' | 'lines'>
  /** Data dnia z kalendarza (`YYYY-MM-DD`) albo '' (dzień bez daty). */
  date: string
  /** „Dzień 2", „Zdjęcia w studiu" (`realizationDayLabel`). */
  dayLabel: string
  /** Wydarzenie dnia — miejsce z `data.location`. */
  event: Pick<TimelineEvent, 'data'> | null
  /** Ludzie z bazy Ekipa (także usunięci — liczą się tylko żywi). */
  people: CrewMember[]
  catalog: EquipmentItem[]
}

export interface ResolvedCallSheet {
  title: string
  dayLabel: string
  date: string
  location: { value: string; base: string; own: boolean }
  locationNotes: string
  /** Zbiórka ekipy (minuty) albo `null`, gdy nic nie wiadomo. */
  callTime: number | null
  ownCallTime: boolean
  /** Koniec ostatniego wpisu. */
  wrapTime: number | null
  schedule: PlannerEvent[]
  categories: Category[]
  crew: ResolvedCrewRow[]
  client: ResolvedClient
  contacts: CallSheetContact[]
  packing: PackingGroup[]
  gearExtra: CallSheetGearExtra[]
  notes: string
}

/** Miejsce zapisane w wydarzeniu (`shoot_day` / `prep_day`: `data.location`). */
export function eventLocation(event: Pick<TimelineEvent, 'data'> | null | undefined): string {
  const location = event?.data?.location
  return typeof location === 'string' ? location.trim() : ''
}

export function resolveCallSheet(sheet: CallSheet, ctx: CallSheetContext): ResolvedCallSheet {
  const schedule = liveSchedule(sheet)
  const ownCallTime = sheet.callTime !== undefined
  const callTime = ownCallTime ? (sheet.callTime ?? null) : (schedule[0]?.startMinutes ?? null)
  const wrapTime = schedule.length ? Math.max(...schedule.map((e) => e.endMinutes)) : null
  const location = pick(sheet.location, eventLocation(ctx.event))
  return {
    title: sheet.title?.trim() || ctx.project.name.trim() || 'Bez nazwy',
    dayLabel: ctx.dayLabel,
    date: ctx.date,
    location: { value: location.value, base: eventLocation(ctx.event), own: location.own },
    locationNotes: sheet.locationNotes?.trim() ?? '',
    callTime,
    ownCallTime,
    wrapTime,
    schedule,
    categories: liveCategories(sheet),
    crew: resolveCrew(sheet, ctx.project.costs, ctx.day.id, ctx.people, callTime),
    client: resolveClient(sheet, ctx.project),
    contacts: live(sheet.contacts),
    packing: buildPackingList({ gearDays: [{ ...ctx.day, label: '', date: '' }], equipment: [] }, ctx.catalog, ctx.day.id),
    gearExtra: live(sheet.gearExtra),
    notes: sheet.notes?.trim() ?? '',
  }
}

// ── Import z CallSheetWiz ────────────────────────────────────────────────────

const savedDaySchema = z
  .object({
    id: z.string(),
    dayTitle: z.string(),
    date: z.string(),
    events: z.array(z.unknown()),
    categories: z.array(z.unknown()),
  })
  .passthrough()

function parseSavedDay(value: unknown): SavedDay[] {
  const parsed = savedDaySchema.safeParse(value)
  if (!parsed.success) return []
  const day = parsed.data
  const events = day.events.flatMap((entry) => {
    const event = plannerEventSchema.safeParse(entry)
    return event.success ? [event.data] : []
  })
  const categories = day.categories.flatMap((entry) => {
    const category = categorySchema.safeParse(entry)
    return category.success ? [category.data] : []
  })
  return [{ ...day, events, categories }]
}

/**
 * Plik eksportu CallSheetWiz („Export all" = lista dni, albo jeden dzień).
 * Port `parseSavedDaysFile`: `null` = to nie są dni z CallSheetWiz; pusta
 * lista = poprawny, pusty eksport. Nieznane pola zostają (passthrough).
 */
export function parseSavedDaysFile(content: string): SavedDay[] | null {
  try {
    const parsed = JSON.parse(content) as unknown
    const values = Array.isArray(parsed) ? parsed : [parsed]
    const days = values.flatMap(parseSavedDay)
    if (days.length > 0) return days
    return Array.isArray(parsed) && parsed.length === 0 ? [] : null
  } catch {
    return null
  }
}

/** Data dnia z CallSheetWiz (zapisanego w lokalne południe) jako `YYYY-MM-DD`; '' gdy nieczytelna. */
export function savedDayDateKey(day: Pick<SavedDay, 'date'>): string {
  const parsed = new Date(day.date)
  return Number.isNaN(parsed.getTime()) ? '' : formatLocalYmd(parsed)
}

const UNTITLED_SHOOT = 'untitled shoot'

/**
 * Wgrywa dzień z CallSheetWiz do call sheetu. Dotychczasowy harmonogram
 * zostaje miękko usunięty z `deletedAt` (do cofnięcia), zaimportowane wpisy
 * zachowują swoje id (nowe tylko przy kolizji), tagi — tag o tym samym id
 * albo nazwie już jest, więc nic się nie dubluje, a kolor z hexa przechodzi
 * na najbliższy slot palety. Tytuł dnia trafia do tytułu call sheetu tylko,
 * gdy ten jest pusty.
 */
export function importSavedDay(
  target: CallSheet,
  day: SavedDay,
  now: Date = new Date()
): { sheet: CallSheet; added: number; replaced: number; deletedAt: string } {
  const deletedAt = now.toISOString()
  const replaced = live(target.schedule).length
  const schedule = target.schedule.map((e) => (e.deletedAt ? e : { ...e, deletedAt }))

  let categories = [...target.categories]
  const idMap = new Map<string, string>()
  day.categories.forEach((tag) => {
    const liveTarget = live(categories)
    const existing =
      liveTarget.find((c) => c.id === tag.id) ?? liveTarget.find((c) => personKey(c.label) === personKey(tag.label))
    if (existing) {
      idMap.set(tag.id, existing.id)
      return
    }
    const hex = tag.color
    const color = isProjectColorKey(hex) ? hex : (paletteKeyForHex(hex) ?? '')
    const id = categories.some((c) => c.id === tag.id) ? createCallSheetItemId('tag') : tag.id
    const imported: Category = { ...tag, id, label: tag.label.trim() || 'Bez nazwy', color }
    if (!isProjectColorKey(hex) && hex) imported.importedColor = hex
    categories = [...categories, imported]
    idMap.set(tag.id, id)
  })

  const taken = new Set(schedule.map((e) => e.id))
  const imported = day.events.map((event) => {
    const id = taken.has(event.id) ? createCallSheetItemId('ev') : event.id
    taken.add(id)
    // Wpis bez tagu albo z tagiem, którego w pliku nie było: '' (szary), jak w CallSheetWiz.
    const { deletedAt: _skip, ...rest } = event // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, id, categoryId: idMap.get(event.categoryId) ?? '' }
  })

  const sheet: CallSheet = {
    ...target,
    schedule: [...schedule, ...imported],
    categories,
    importedFrom: { type: 'callsheetwiz', id: day.id, title: day.dayTitle, date: day.date, at: deletedAt },
  }
  const title = day.dayTitle.trim()
  if (!target.title?.trim() && title && title.toLowerCase() !== UNTITLED_SHOOT) sheet.title = title
  return { sheet, added: imported.length, replaced, deletedAt }
}
