/**
 * Sprzęt w projekcie dzień po dniu — czyste funkcje, bez Reacta i zapisu.
 *
 * Projekt trzyma listę dni (`Project.gearDays`), a w każdym dniu pozycje z
 * katalogu z liczbą sztuk. Starsze projekty mają jeszcze płaskie
 * `equipment: { itemId, days }[]` (faza 3) — `projectGearDays` czyta oba
 * kształty, więc statystyki, lista pakowania i zakładka idą jedną ścieżką.
 *
 * Funkcje edycji są niemutujące: biorą listę dni i zwracają nową.
 */

import { addDays, daysBetween } from './calendar-layout'
import {
  createGearDayId,
  equipmentCategoryRank,
  type EquipmentItem,
  type GearDay,
  type GearLine,
  type Project,
  type ProjectEquipmentUsage,
} from './project-types'
import { isEventDate, type TimelineEvent } from './event-types'

// ── Odczyt ───────────────────────────────────────────────────────────────────

/**
 * Stary kształt → dni. `{ FX3: 3 dni, lampa: 1 dzień }` daje trzy dni: FX3 we
 * wszystkich, lampa w pierwszym. Id są stałe (`legacy-N`), bo ta konwersja
 * dzieje się przy KAŻDYM odczycie, dopóki zakładka nie zapisze `gearDays`.
 */
export function legacyToGearDays(equipment: ProjectEquipmentUsage[]): GearDay[] {
  const used = equipment.filter((u) => u.days > 0)
  const count = used.reduce((max, u) => Math.max(max, Math.ceil(u.days)), 0)
  return Array.from({ length: count }, (_, i) => ({
    id: `legacy-${i + 1}`,
    label: '',
    date: '',
    lines: used.filter((u) => u.days > i).map((u) => ({ itemId: u.itemId, qty: 1 })),
  }))
}

/**
 * Dni sprzętu projektu: nowy kształt, a gdy go brak — przeliczony stary.
 * Dni usunięte w Realizacji (`deletedAt`) zostają w pliku, ale nie liczą się
 * nigdzie: ani w statystykach, ani na liście pakowania.
 */
export function projectGearDays(project: Pick<Project, 'gearDays' | 'equipment'>): GearDay[] {
  return project.gearDays
    ? project.gearDays.filter((day) => !day.deletedAt)
    : legacyToGearDays(project.equipment ?? [])
}

/** Czy na projekcie zapisano jakikolwiek sprzęt. */
export function hasGearLogged(project: Pick<Project, 'gearDays' | 'equipment'>): boolean {
  return projectGearDays(project).some((day) => day.lines.length > 0)
}

/** „Dzień 2" albo własna nazwa dnia. */
export function gearDayLabel(day: Pick<GearDay, 'label'>, index: number): string {
  return day.label.trim() || `Dzień ${index + 1}`
}

/** Data dnia na potrzeby statystyk: własna, a bez niej data księgowa projektu. */
export function gearDayDate(day: Pick<GearDay, 'date'>, project: Pick<Project, 'date'>): string {
  return day.date || project.date
}

// ── Edycja ───────────────────────────────────────────────────────────────────

export function addGearDay(
  days: GearDay[],
  init: { label?: string; date?: string; lines?: GearLine[] } = {}
): GearDay[] {
  return [
    ...days,
    {
      id: createGearDayId(),
      label: init.label ?? '',
      date: init.date ?? '',
      lines: (init.lines ?? []).map((line) => ({ ...line })),
    },
  ]
}

export function removeGearDay(days: GearDay[], dayId: string): GearDay[] {
  return days.filter((day) => day.id !== dayId)
}

/**
 * Kopia dnia wstawiona zaraz za oryginałem — „drugi dzień, ten sam zestaw".
 * Data zostaje pusta: kolejny dzień zdjęciowy nie zawsze jest następnym dniem
 * kalendarza, a zła data byłaby gorsza niż żadna. Z tego samego powodu kopia
 * nie jest powiązana z wydarzeniem oryginału.
 */
export function duplicateGearDay(days: GearDay[], dayId: string): GearDay[] {
  const index = days.findIndex((day) => day.id === dayId)
  if (index === -1) return days
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { eventId, eventDay, deletedAt, ...source } = days[index]
  const copy: GearDay = {
    ...source,
    id: createGearDayId(),
    label: '',
    date: '',
    lines: source.lines.map((line) => ({ ...line })),
  }
  return [...days.slice(0, index + 1), copy, ...days.slice(index + 1)]
}

export function updateGearDay(
  days: GearDay[],
  dayId: string,
  patch: Partial<Pick<GearDay, 'label' | 'date'>>
): GearDay[] {
  return days.map((day) => (day.id === dayId ? { ...day, ...patch } : day))
}

/** Ustawia liczbę sztuk pozycji w dniu; `qty <= 0` usuwa ją z dnia. */
function withLine(day: GearDay, itemId: string, qty: number): GearDay {
  const count = Math.floor(qty)
  const exists = day.lines.some((line) => line.itemId === itemId)
  if (count <= 0) {
    return exists ? { ...day, lines: day.lines.filter((line) => line.itemId !== itemId) } : day
  }
  return {
    ...day,
    lines: exists
      ? day.lines.map((line) => (line.itemId === itemId ? { ...line, qty: count } : line))
      : [...day.lines, { itemId, qty: count }],
  }
}

export function setGearLine(days: GearDay[], dayId: string, itemId: string, qty: number): GearDay[] {
  return days.map((day) => (day.id === dayId ? withLine(day, itemId, qty) : day))
}

/** Ta sama liczba sztuk we WSZYSTKICH dniach (0 = usuń wszędzie). */
export function setGearLineEverywhere(days: GearDay[], itemId: string, qty: number): GearDay[] {
  return days.map((day) => withLine(day, itemId, qty))
}

/**
 * Następna liczba sztuk po kliknięciu w komórkę: brak → wszystkie → o jedną
 * mniej → … → brak. Zwykle zabiera się komplet, więc pierwszy klik daje
 * wszystkie sztuki; jedna sztuka to zwykły przełącznik.
 */
export function cycleGearQty(current: number, owned: number): number {
  const max = Math.max(1, Math.floor(owned))
  if (current <= 0) return max
  return Math.min(current, max) - 1
}

/**
 * Klik w nazwę pozycji: gdy jest we WSZYSTKICH dniach — znika z każdego;
 * w przeciwnym razie dochodzi do brakujących dni (komplet sztuk), a dni, w
 * których już jest, zachowują swoją liczbę.
 */
export function toggleGearItemAllDays(days: GearDay[], itemId: string, owned: number): GearDay[] {
  const inEvery = days.length > 0 && days.every((day) => day.lines.some((l) => l.itemId === itemId))
  if (inEvery) return setGearLineEverywhere(days, itemId, 0)
  const qty = Math.max(1, Math.floor(owned))
  return days.map((day) => (day.lines.some((l) => l.itemId === itemId) ? day : withLine(day, itemId, qty)))
}

// ── Podpowiedź dni ───────────────────────────────────────────────────────────

type ShootEvent = Pick<TimelineEvent, 'kind' | 'projectId' | 'start' | 'end' | 'deletedAt'>

/** Daty dni zdjęciowych projektu z kalendarza (zakresy rozwinięte, bez powtórzeń). */
export function projectShootDates(projectId: string, events: ShootEvent[]): string[] {
  const dates = new Set<string>()
  events.forEach((event) => {
    if (event.kind !== 'shoot_day' || event.projectId !== projectId || event.deletedAt) return
    if (!isEventDate(event.start)) return
    const start = event.start.slice(0, 10)
    const end = event.end && isEventDate(event.end) ? event.end.slice(0, 10) : start
    const span = Math.max(0, daysBetween(start, end))
    for (let i = 0; i <= span; i += 1) dates.add(addDays(start, i))
  })
  return [...dates].sort()
}

/** Liczba dni zdjęciowych zapisana w wycenie (szczegółowa: lista dni; szybka: licznik). */
export function quoteShootDayCount(quote: unknown): number {
  const data = (quote as { data?: Record<string, unknown> } | null)?.data
  if (!data || typeof data !== 'object') return 0
  if (data.isDetailedProdukcja && Array.isArray(data.detailedShootingDays)) {
    return data.detailedShootingDays.length
  }
  const raw = data.dniZdjeciowe
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

/**
 * Dni, od których zaczyna pusta zakładka Sprzęt. Kolejność źródeł:
 *  1. stary kształt `equipment` (żeby nic, co już zaznaczono, nie zniknęło),
 *  2. dni zdjęciowe z kalendarza — z datami,
 *  3. liczba dni z wyceny,
 *  4. jeden dzień.
 */
export function suggestGearDays(
  project: Pick<Project, 'id' | 'quote' | 'equipment' | 'gearDays'>,
  events: ShootEvent[]
): GearDay[] {
  const legacy = legacyToGearDays(project.equipment ?? [])
  if (legacy.length > 0) return legacy.map((day) => ({ ...day, id: createGearDayId() }))

  const dates = projectShootDates(project.id, events)
  if (dates.length > 0) {
    return dates.map((date) => ({ id: createGearDayId(), label: '', date, lines: [] }))
  }

  const count = Math.max(1, quoteShootDayCount(project.quote))
  return Array.from({ length: count }, () => ({ id: createGearDayId(), label: '', date: '', lines: [] }))
}

// ── Lista pakowania ──────────────────────────────────────────────────────────

export interface PackingGroup {
  category: string
  items: {
    item: EquipmentItem
    /** Ile sztuk spakować (dla całego projektu: najwięcej w jednym dniu). */
    qty: number
    /** W ilu dniach pozycja jedzie na plan. */
    days: number
  }[]
}

/**
 * Lista pakowania na cały projekt albo jeden dzień (`dayId`). Kategorie w
 * kolejności katalogu (tak się realnie pakuje wóz), nazwy alfabetycznie.
 * Pozycje usunięte z katalogu są pomijane.
 */
export function buildPackingList(
  project: Pick<Project, 'gearDays' | 'equipment'>,
  catalog: EquipmentItem[],
  dayId?: string
): PackingGroup[] {
  const byId = new Map(catalog.map((item) => [item.id, item]))
  const days = projectGearDays(project).filter((day) => !dayId || day.id === dayId)
  const totals = new Map<string, { qty: number; days: number }>()

  days.forEach((day) => {
    day.lines.forEach((line) => {
      if (!byId.has(line.itemId) || line.qty <= 0) return
      const entry = totals.get(line.itemId) ?? { qty: 0, days: 0 }
      totals.set(line.itemId, { qty: Math.max(entry.qty, line.qty), days: entry.days + 1 })
    })
  })

  const groups = new Map<string, PackingGroup['items']>()
  totals.forEach(({ qty, days: count }, itemId) => {
    const item = byId.get(itemId)!
    const bucket = groups.get(item.category) ?? []
    bucket.push({ item, qty, days: count })
    groups.set(item.category, bucket)
  })

  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.item.name.localeCompare(b.item.name, 'pl')),
    }))
    .sort(
      (a, b) =>
        equipmentCategoryRank(a.category) - equipmentCategoryRank(b.category) ||
        a.category.localeCompare(b.category, 'pl')
    )
}
