'use client'

/**
 * Zakładka „Realizacja" projektu (T5a; po R2 — plan §13.1 B, D1): na górze
 * „Koszty projektu" (to, co nie należy do dnia), pod nimi dni zdjęciowe i
 * przygotowań z ekipą i sprzętem dnia, siatka sprzętu (G3), lista pakowania i
 * call sheet bez zmian. Wynik projektu (zysk, marże) jest w zakładce Finanse.
 *
 * Koszty: jedna lista `Project.costs`, zasady w `lib/realization-costs.ts`.
 * Dopóki nic nie zapisano, zakładka pokazuje plan z wyceny na żywo (szkic);
 * pierwsza zmiana zapisuje cały szkic jako wiersze, a potem tę zmianę.
 *
 * Datę dnia trzyma kalendarz (wariant A, decyzja M.J. 2026-10-09): dzień z
 * datą to wydarzenie `shoot_day` / `prep_day`, a sprzęt, ekipa i koszty wiszą
 * na dniu zapisanym w projekcie (`realization-days.ts`).
 *
 * Zapis jak w siatce G3: lokalna kopia dni i kosztów + zapis z krótkim
 * opóźnieniem. `updateProject` łata najświeższą wersję projektu, ale wartości
 * bierze z tego, co mu podamy — bez lokalnej kopii szybkie klikanie gubiłoby
 * zmiany.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { PackagePlus, Plus } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { useEvents } from '@/lib/events-context'
import { projectMoney } from '@/lib/money-loop'
import { useProjectHub } from '@/lib/project-hub-context'
import { useQuote } from '@/lib/quote-context'
import { useCrew } from '@/lib/crew-context'
import { crewRoleByName } from '@/lib/crew-types'
import { unknownCrewNames, type UnknownCrewName } from '@/lib/crew-stats'
import { createEvent } from '@/lib/events-store'
import { callSheetForDay, liveScheduleCount } from '@/lib/call-sheet'
import type { CallSheet } from '@/lib/call-sheet-types'
import { useCallSheets } from '@/lib/use-call-sheets'
import { eventKind } from '@/lib/event-kinds'
import type { TimelineEvent } from '@/lib/event-types'
import { summarizeProjectGear } from '@/lib/equipment-roi'
import { gearFromQuote } from '@/lib/gear-usage'
import { kitCrewDayCosts, kitCrewFromDayCosts, type KitCrewEntry } from '@/lib/quote-crew'
import { isBlankQuoteData } from '@/lib/project-save'
import {
  addCost,
  copyCrewToDays,
  costsOfDay,
  crewSuggestions,
  isCrew,
  isOwnWork,
  liveCosts,
  personKey,
  restoreCosts,
  softDeleteCost,
  softDeleteDayCosts,
  type NewCost,
} from '@/lib/project-costs'
import {
  addPlanRow,
  applyPatch,
  applyQuoteChanges,
  draftCosts,
  editPatch,
  isDraftId,
  layoutRealization,
  missingFromQuote,
  quoteChanges,
  quotePlanRows,
  realizationMode,
  restartFromQuote,
  startFromQuote,
  type PlanRow,
} from '@/lib/realization-costs'
import {
  gearDaysForSave,
  linkDayToEvent,
  realizationDayLabel,
  resolveRealizationDays,
  restoreDays,
  softDeleteDay,
  REALIZATION_KIND_LABELS,
} from '@/lib/realization-days'
import {
  costCategoryLabel,
  countsTowardRevenue,
  createGearDayId,
  toDateKey,
  type GearDay,
  type Project,
  type ProjectCost,
} from '@/lib/project-types'
import { itemLabel, plural } from '@/lib/pl-plural'
import { archivo } from '@/components/calendar/calendar-bits'
import { EventForm } from '@/components/calendar/event-form'
import { EventNotice, noticeAfterSave, type EventNoticeState } from '@/components/calendar/event-notice'
import { GearGrid, type DayRemoval } from '@/components/equipment/project-equipment'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CallSheetPlanner } from '@/components/planner/call-sheet-planner'
import { CostRow, CrewRoleDatalist, type LineMechanics } from './cost-rows'
import { DayCalendar, formatDayLong, type DayCalendarActions } from './day-calendar'
import { DayCards, DayLines, TotalsText, type LineHandlers } from './day-cards'
import { NewDayButton, type NewDay } from './new-day'
import { MissingFromQuote, QuoteChangesBanner, RestartFromQuote } from './realization-notices'

const SAVE_DELAY_MS = 250

export function ProjectRealization() {
  const { activeProject } = useProjectHub()
  const { isLoading } = useEvents()
  if (!activeProject) return null
  // Bez wczytanych wydarzeń każdy dzień z kalendarza wyglądałby na usunięty.
  if (isLoading) return <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-zinc-500">Wczytywanie…</div>
  // Klucz = id projektu: przejście do innego projektu zaczyna od jego danych.
  return <RealizationView key={activeProject.id} project={activeProject} />
}

interface Notice {
  message: string
  undo?: () => void | Promise<void>
}

function describeCost(cost: ProjectCost): string {
  if (isCrew(cost)) return cost.person?.trim() ? `„${cost.person.trim()}" z ekipy` : 'osobę z ekipy'
  return cost.label?.trim() ? `„${cost.label.trim()}"` : `koszt „${costCategoryLabel(cost.category)}"`
}

function eventRange(event: Pick<TimelineEvent, 'start' | 'end'>): string {
  const start = formatDayLong(event.start.slice(0, 10))
  return event.end ? `${start} – ${formatDayLong(event.end.slice(0, 10))}` : start
}

function RealizationView({ project }: { project: Project }) {
  const crewListId = useId()
  const { people: crewPeople, roles: crewRoles, activeRoles, addPerson } = useCrew()
  const { allEvents, save: saveEvent, remove: removeEvent, restore: restoreEvent } = useEvents()
  const { updateProject, projects } = useProjectHub()
  const { items } = useEquipment()
  const { data, pricingConfig, marginMultiplier } = useQuote()

  // `null` = projekt nie ma zapisanych dni; dni z kalendarza i podpowiedzi
  // zapiszą się dopiero przy pierwszej zmianie.
  const [stored, setStored] = useState<GearDay[] | null>(project.gearDays ?? null)
  const [costs, setCosts] = useState<ProjectCost[]>(project.costs ?? [])
  const [startedAt, setStartedAt] = useState<string | undefined>(project.costsFromQuoteAt)
  const storedRef = useRef(stored)
  const costsRef = useRef(costs)
  const startedRef = useRef(startedAt)

  const { days, info, suggestion } = useMemo(
    () => resolveRealizationDays({ ...project, gearDays: stored ?? undefined }, allEvents),
    [project, stored, allEvents]
  )

  // ── Zapis ──────────────────────────────────────────────────────────────────

  const saveRef = useRef(updateProject)
  useEffect(() => {
    saveRef.current = updateProject
  }, [updateProject])
  const pendingRef = useRef<{ gearDays?: GearDay[]; costs?: ProjectCost[]; costsFromQuoteAt?: string | null }>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const { gearDays, costs: nextCosts, costsFromQuoteAt } = pendingRef.current
    pendingRef.current = {}
    if (!gearDays && !nextCosts && costsFromQuoteAt === undefined) return
    void saveRef.current(project.id, {
      // Stary kształt (`equipment`) czyścimy: od pierwszego zapisu liczą się dni.
      ...(gearDays ? { gearDays, equipment: [] } : {}),
      ...(nextCosts ? { costs: nextCosts } : {}),
      ...(costsFromQuoteAt !== undefined ? { costsFromQuoteAt: costsFromQuoteAt ?? undefined } : {}),
    })
  }, [project.id])

  // Wyjście z zakładki albo projektu nie może zgubić ostatniej zmiany.
  useEffect(() => flush, [flush])

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS)
  }, [flush])

  /** Dni z zakładki (także oznaczone `deletedAt`) → zapis, z zachowaniem wcześniej usuniętych. */
  const commitDays = useCallback(
    (next: GearDay[]) => {
      const full = gearDaysForSave(next, storedRef.current)
      storedRef.current = full
      setStored(full)
      pendingRef.current.gearDays = full
      schedule()
    },
    [schedule]
  )

  const commitCosts = useCallback(
    (next: ProjectCost[]) => {
      costsRef.current = next
      setCosts(next)
      pendingRef.current.costs = next
      schedule()
    },
    [schedule]
  )

  const commitStarted = useCallback(
    (next: string | undefined) => {
      startedRef.current = next
      setStartedAt(next)
      pendingRef.current.costsFromQuoteAt = next ?? null
      schedule()
    },
    [schedule]
  )

  /** Koszt przypięty do dnia z kalendarza (jeszcze niezapisanego) najpierw zapisuje dni. */
  const ensureDaysSaved = () => {
    const unsaved = days.some((d) => {
      const i = info.get(d.id)
      return !i?.saved || i.pendingLink
    })
    if (unsaved) commitDays(days)
  }

  // ── Plan z wyceny (szkic) ──────────────────────────────────────────────────

  // Wycena TEGO projektu (wybrany wariant, z niezapisanymi jeszcze zmianami).
  const live = useMemo(() => ({ data, pricingConfig, marginMultiplier }), [data, pricingConfig, marginMultiplier])
  const hasQuote = !!project.quote || !isBlankQuoteData(data)
  const plan = useMemo(() => (hasQuote ? quotePlanRows(live) : { rows: [] as PlanRow[], quoteDayIds: [] as string[] }), [hasQuote, live])
  const shootDayIds = useMemo(
    () => days.filter((d) => (info.get(d.id)?.kind ?? 'shoot_day') === 'shoot_day').map((d) => d.id),
    [days, info]
  )
  const mode = realizationMode({ costs, costsFromQuoteAt: startedAt })
  const shown = useMemo(() => (mode === 'draft' ? draftCosts(plan.rows, shootDayIds) : costs), [mode, plan.rows, shootDayIds, costs])
  const layout = useMemo(
    () => layoutRealization(shown, days.map((d) => d.id), plan.quoteDayIds),
    [shown, days, plan.quoteDayIds]
  )

  /**
   * Pierwsza zmiana w szkicu (decyzja Q2, wariant A): cały szkic zapisuje się
   * jako wiersze. Zwraca wiersze po starcie i mapę planKey → id.
   */
  const ensureStarted = (): { list: ProjectCost[]; ids: Map<string, string> } => {
    const current = costsRef.current
    if (realizationMode({ costs: current, costsFromQuoteAt: startedRef.current }) !== 'draft' || plan.rows.length === 0) {
      return { list: current, ids: new Map() }
    }
    ensureDaysSaved()
    const result = startFromQuote(current, plan.rows, shootDayIds)
    commitStarted(result.startedAt)
    commitCosts(result.costs)
    return { list: result.costs, ids: result.ids }
  }

  /** Id zapisanego wiersza (szkic → wiersz po starcie). */
  const targetOf = (cost: ProjectCost): { list: ProjectCost[]; id: string | undefined } => {
    const { list, ids } = ensureStarted()
    return { list, id: isDraftId(cost.id) ? ids.get(cost.planKey ?? '') : cost.id }
  }

  // ── Komunikaty ─────────────────────────────────────────────────────────────

  const [notice, setNotice] = useState<Notice | null>(null)
  const [eventNotice, setEventNotice] = useState<EventNoticeState | null>(null)
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null)

  // ── Dni ────────────────────────────────────────────────────────────────────

  const labelOf = (day: GearDay, index: number) => realizationDayLabel(day, info.get(day.id), index)

  // ── Call sheet (T5b) ───────────────────────────────────────────────────────

  const callSheets = useCallSheets(project.id)
  const [plannerDayId, setPlannerDayId] = useState<string | null>(null)
  const plannerIndex = plannerDayId ? days.findIndex((d) => d.id === plannerDayId) : -1
  const plannerDay = plannerIndex >= 0 ? days[plannerIndex] : null

  const callSheetOf = (day: GearDay) => {
    const sheet = callSheetForDay(callSheets.sheets, project.id, day.id)
    return sheet ? { entries: liveScheduleCount(sheet) } : null
  }

  const openCallSheet = (day: GearDay) => {
    setPlannerDayId(day.id)
    window.scrollTo({ top: 0 })
  }

  const closeCallSheet = () => {
    setPlannerDayId(null)
    window.scrollTo({ top: 0 })
  }

  const deleteCallSheet = async (sheet: CallSheet) => {
    const index = days.findIndex((d) => d.id === sheet.dayId)
    const label = index >= 0 ? labelOf(days[index], index) : 'dnia'
    await callSheets.remove(sheet.id, new Date().toISOString())
    closeCallSheet()
    setNotice({ message: `Usunięto call sheet „${label}".`, undo: () => callSheets.restore(sheet.id) })
  }

  const addDay = async ({ kind, date, location }: NewDay) => {
    if (date) {
      // Dzień z datą to wydarzenie w kalendarzu; w Realizacji pojawi się sam.
      await saveEvent(
        createEvent({
          kind,
          start: date,
          projectId: project.id,
          data: location.trim() ? { location: location.trim() } : {},
        })
      )
      setNotice({ message: `Dodano dzień ${REALIZATION_KIND_LABELS[kind].toLowerCase()} ${formatDayLong(date)} — jest też w kalendarzu.` })
      return
    }
    commitDays([...days, { id: createGearDayId(), label: '', date: '', lines: [], kind }])
  }

  const calendarActions: DayCalendarActions = {
    onEditEvent: (event) => setEditingEvent(event),
    onRestoreEvent: async (event) => {
      await restoreEvent(event.id)
      setNotice({ message: 'Przywrócono wydarzenie w kalendarzu.' })
    },
    onAddToCalendar: async (day, date) => {
      // Lista sprzed zapisu: po zapisie wydarzenia pojawiłby się dla niego
      // osobny dzień „z kalendarza", a ten dzień ma go właśnie przejąć.
      const before = days
      const event = createEvent({
        kind: info.get(day.id)?.kind ?? 'shoot_day',
        start: date,
        projectId: project.id,
        title: day.label.trim(),
      })
      await saveEvent(event)
      commitDays(linkDayToEvent(before, day.id, event))
      setNotice({ message: `Dzień jest teraz w kalendarzu: ${formatDayLong(date)}.` })
    },
  }

  const dayRemoval = (day: GearDay): DayRemoval => {
    const i = info.get(day.id)
    if (i?.link === 'calendar' && i.event && i.eventSpan > 1) {
      return {
        ok: false,
        reason: `Ten dzień należy do wydarzenia ${eventRange(i.event)}. Skróć je w kalendarzu („Edytuj w kalendarzu").`,
      }
    }
    const dayCosts = costsOfDay(costs, day.id)
    const crew = dayCosts.filter(isCrew).length
    const other = dayCosts.length - crew
    const parts: string[] = []
    if (day.lines.length) parts.push(`${day.lines.length} ${itemLabel(day.lines.length)} sprzętu`)
    if (crew) parts.push(`${crew} ${plural(crew, 'osoba', 'osoby', 'osób')} z ekipy`)
    if (other) parts.push(`${other} ${plural(other, 'koszt', 'koszty', 'kosztów')}`)
    if (i?.link === 'calendar') parts.push('wpis w kalendarzu')
    return { ok: true, confirm: parts.length ? `Zniknie też: ${parts.join(', ')} (da się cofnąć).` : null }
  }

  const removeDay = async (day: GearDay) => {
    const i = info.get(day.id)
    const label = labelOf(day, days.indexOf(day))
    const before = days
    const deletedAt = new Date().toISOString()
    const eventId = i?.link === 'calendar' && i.event && i.eventSpan === 1 ? i.event.id : null
    if (eventId) await removeEvent(eventId)
    commitDays(softDeleteDay(before, day.id, deletedAt))
    commitCosts(softDeleteDayCosts(costsRef.current, day.id, deletedAt))
    setNotice({
      message: `Usunięto „${label}"${eventId ? ' (także z kalendarza)' : ''}.`,
      undo: async () => {
        if (eventId) await restoreEvent(eventId)
        commitDays(restoreDays(storedRef.current ?? [], deletedAt))
        commitCosts(restoreCosts(costsRef.current, deletedAt))
      },
    })
  }

  // ── Koszty ─────────────────────────────────────────────────────────────────

  const addDayCost = (dayId: string, init: NewCost) => {
    ensureDaysSaved()
    const { list } = ensureStarted()
    commitCosts(addCost(list, { ...init, dayId }))
  }
  const addProjectCost = () => {
    const { list } = ensureStarted()
    commitCosts(addCost(list, { category: 'inne', label: '', quantity: 1, unitCost: 0 }))
  }
  /** Zmiana wiersza (także pierwsza w szkicu); wiersz z planu dostaje znacznik „zmieniony ręcznie". */
  const changeCost = (cost: ProjectCost, patch: Partial<ProjectCost>) => {
    const { list, id } = targetOf(cost)
    if (!id) return
    commitCosts(list.map((c) => (c.id === id ? applyPatch(c, editPatch(c, patch)) : c)))
  }
  const removeCost = (cost: ProjectCost) => {
    const { list, id } = targetOf(cost)
    if (!id) return
    const deletedAt = new Date().toISOString()
    commitCosts(softDeleteCost(list, id, deletedAt))
    setNotice({
      message: `Usunięto ${describeCost(cost)}.`,
      undo: () => commitCosts(restoreCosts(costsRef.current, deletedAt)),
    })
  }
  /** Wiersze dnia wyceny bez odpowiednika → wybrany dzień Realizacji (bez znacznika „zmieniony"). */
  const moveToDay = (lines: ProjectCost[], dayId: string) => {
    ensureDaysSaved()
    const { list, ids } = ensureStarted()
    const targets = new Set(lines.map((c) => (isDraftId(c.id) ? ids.get(c.planKey ?? '') : c.id)).filter(Boolean))
    commitCosts(list.map((c) => (targets.has(c.id) ? { ...c, dayId } : c)))
  }

  const mechanics = (cost: ProjectCost): LineMechanics => ({
    counted: !cost.skipped,
    own: isOwnWork(cost),
    onTick: (counted) => changeCost(cost, { skipped: counted ? undefined : true }),
    onWork: (own) => changeCost(cost, { ownWork: own ? true : undefined }),
  })

  /** Dopisane pozycje da się cofnąć jednym kliknięciem (miękko usuwamy dokładnie je). */
  const undoAdded = (ids: Set<string>) => () => {
    const deletedAt = new Date().toISOString()
    commitCosts(costsRef.current.map((c) => (ids.has(c.id) && !c.deletedAt ? { ...c, deletedAt } : c)))
  }

  // Zestawy z ekipą (T9b): ekipa zestawu → wiersze kosztów dnia; ekipa dnia → zestaw.
  const kitCrewOfDay = (day: GearDay) => kitCrewFromDayCosts(costsOfDay(shown, day.id), crewRoles)

  const applyKitCrew = (day: GearDay, crew: KitCrewEntry[]) => {
    ensureDaysSaved()
    const { list } = ensureStarted()
    const rows = kitCrewDayCosts(crew, day.id, costsOfDay(list, day.id), crewRoles, crewPeople)
    if (rows.length === 0) {
      setNotice({ message: 'Ekipa z zestawu jest już w tym dniu.' })
      return
    }
    const before = new Set(list.map((c) => c.id))
    const next = rows.reduce((acc, row) => addCost(acc, row), list)
    commitCosts(next)
    setNotice({
      message: `Dopisano z zestawu ${rows.length} ${plural(rows.length, 'osobę', 'osoby', 'osób')} do ekipy dnia.`,
      undo: undoAdded(new Set(next.filter((c) => !before.has(c.id)).map((c) => c.id))),
    })
  }

  const copyCrew = (dayId: string) => {
    ensureDaysSaved()
    const { list } = ensureStarted()
    const before = new Set(list.map((c) => c.id))
    const { costs: next, added } = copyCrewToDays(list, dayId, days.map((d) => d.id))
    if (added === 0) {
      setNotice({ message: 'Wszystkie dni mają już te osoby.' })
      return
    }
    commitCosts(next)
    setNotice({
      message: `Dopisano ${added} ${plural(added, 'osobę', 'osoby', 'osób')} do pozostałych dni.`,
      undo: undoAdded(new Set(next.filter((c) => !before.has(c.id)).map((c) => c.id))),
    })
  }

  // ── Zmiany wyceny i koszty sprzed R2 ───────────────────────────────────────

  const changes = useMemo(
    () => (mode === 'quote' && hasQuote ? quoteChanges(costs, plan.rows, shootDayIds) : null),
    [mode, hasQuote, costs, plan.rows, shootDayIds]
  )
  const applyChanges = () => {
    if (!changes) return
    ensureDaysSaved()
    const before = costsRef.current
    commitCosts(applyQuoteChanges(before, changes.changes, shootDayIds))
    setNotice({ message: 'Uwzględniono zmiany wyceny w wierszach, których nie zmieniano ręcznie.', undo: () => commitCosts(before) })
  }

  const missing = useMemo(
    () => (mode === 'legacy' && hasQuote ? missingFromQuote(costs, plan.rows, shootDayIds) : null),
    [mode, hasQuote, costs, plan.rows, shootDayIds]
  )
  const addMissing = (rows: PlanRow[], as: 'plan' | 'own' | 'cost') => {
    ensureDaysSaved()
    const before = costsRef.current
    const next = rows.reduce((acc, row) => {
      const counted = as === 'plan' ? row : { ...row, skipped: undefined, ownWork: as === 'own' ? (true as const) : undefined }
      return addPlanRow(acc, counted, shootDayIds)
    }, before)
    commitCosts(next)
    setNotice({
      message: `Dodano z wyceny ${rows.length} ${plural(rows.length, 'pozycję', 'pozycje', 'pozycji')}.`,
      undo: () => commitCosts(before),
    })
  }

  const today = toDateKey(new Date())
  const financeCosts = useMemo(() => projectMoney({ ...project, costs }, allEvents, today).costs, [project, costs, allEvents, today])
  const restartPreview = useMemo(() => {
    if (mode !== 'legacy' || !hasQuote) return null
    const next = restartFromQuote(costs, plan.rows, shootDayIds)
    return projectMoney({ ...project, costs: next.costs }, allEvents, today).costs
  }, [mode, hasQuote, costs, plan.rows, shootDayIds, project, allEvents, today])
  const restart = () => {
    ensureDaysSaved()
    const before = costsRef.current
    const startedBefore = startedRef.current
    const result = restartFromQuote(before, plan.rows, shootDayIds)
    commitCosts(result.costs)
    commitStarted(result.startedAt)
    setNotice({
      message: 'Realizacja zaczyna się od wyceny; wcześniej wpisane koszty są usunięte (da się cofnąć).',
      undo: () => {
        commitCosts(before)
        commitStarted(startedBefore)
      },
    })
  }

  // Sprzęt z wyceny (G5): dzień N szczegółowej wyceny → N-ty dzień zdjęciowy.
  const quoteDays = useMemo(
    () => (data.isDetailedProdukcja ? (data.detailedShootingDays ?? []) : []),
    [data.isDetailedProdukcja, data.detailedShootingDays]
  )
  const quoteHasGear = quoteDays.some((d) => (d.gear ?? []).length > 0)

  const copyGearFromQuote = () => {
    const before = days
    const result = gearFromQuote(quoteDays, days, (d) => info.get(d.id)?.kind ?? 'shoot_day')
    const notes: string[] = []
    if (result.keptDays) {
      notes.push(`${result.keptDays} ${plural(result.keptDays, 'dzień miał', 'dni miały', 'dni miało')} już sprzęt`)
    }
    if (result.missingDays) {
      notes.push(
        `${result.missingDays} ${plural(result.missingDays, 'dzień', 'dni', 'dni')} z wyceny nie ma odpowiednika — dodaj dni zdjęciowe`
      )
    }
    const tail = notes.length ? ` (${notes.join('; ')})` : ''
    if (result.added === 0) {
      setNotice({ message: `Nic nie dopisano${tail}.` })
      return
    }
    commitDays(result.days)
    setNotice({
      message: `Dopisano z wyceny ${result.added} ${plural(result.added, 'pozycję', 'pozycje', 'pozycji')} sprzętu${tail}.`,
      undo: () => commitDays(before),
    })
  }

  const gear = useMemo(() => summarizeProjectGear({ ...project, gearDays: days }, items), [project, days, items])
  const rentByDay = useMemo(() => new Map(gear.perDay.map((d) => [d.dayId, d.rentValue])), [gear])

  const suggestions = useMemo(
    () =>
      crewSuggestions([
        ...projects.filter((p) => p.id !== project.id),
        // Osoby z tego projektu też podpowiadamy, niezależnie od jego statusu.
        { id: project.id, date: project.date, status: 'won' as const, costs },
      ]),
    [projects, project.id, project.date, costs]
  )

  // Imiona z wierszy ekipy tego projektu, których nie ma w bazie Ekipa —
  // rekordy powstają dopiero po kliknięciu „Dodaj do bazy".
  const outsideNames = useMemo(
    () => unknownCrewNames([{ date: project.date, costs, deletedAt: undefined }], crewPeople),
    [project.date, costs, crewPeople]
  )

  const addToCrewBase = async (entry: UnknownCrewName) => {
    const member = await addPerson({
      name: entry.name,
      roleIds: entry.roles.map((r) => crewRoleByName(crewRoles, r)?.id).filter((id): id is string => !!id),
      rate: entry.lastRate > 0 ? entry.lastRate : undefined,
    })
    if (!member) return
    // Wiersze tego projektu z tym imieniem dostają powiązanie z nową osobą.
    const key = personKey(entry.name)
    const liveIds = new Set(crewPeople.map((m) => m.id))
    commitCosts(
      costsRef.current.map((c) =>
        isCrew(c) && !c.deletedAt && (!c.personId || !liveIds.has(c.personId)) && personKey(c.person) === key
          ? { ...c, personId: member.id }
          : c
      )
    )
    setNotice({ message: `Dodano „${member.name}" do Ekipy — kontakt i stawkę uzupełnisz w sekcji Ekipa.` })
  }

  const handlers: LineHandlers = {
    outsiders: suggestions,
    roleListId: crewListListId(crewListId),
    mechanics,
    onChangeCost: changeCost,
    onRemoveCost: removeCost,
  }
  const calendarDayCount = days.filter((d) => info.get(d.id)?.link === 'calendar').length
  const newDayButton = <NewDayButton onAdd={addDay} />
  const enteredCount = liveCosts(costs).length

  const eventSheet = (
    <Sheet open={!!editingEvent} onOpenChange={(open) => !open && setEditingEvent(null)}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="overflow-y-auto border-l border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-2xl sm:max-w-md"
      >
        <SheetTitle className="sr-only">{editingEvent ? eventKind(editingEvent.kind).label : 'Wydarzenie'}</SheetTitle>
        {editingEvent && (
          <EventForm
            key={editingEvent.id}
            target={{ mode: 'edit', entry: { ...editingEvent, origin: 'event' } }}
            onClose={() => setEditingEvent(null)}
            onSaved={(saved) => {
              setEditingEvent(null)
              setEventNotice(noticeAfterSave(saved))
            }}
            onDeleted={(event) => {
              setEditingEvent(null)
              setEventNotice({ type: 'deleted', event })
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )

  if (plannerDay) {
    return (
      <>
        <CallSheetPlanner
          key={plannerDay.id}
          project={project}
          day={plannerDay}
          info={info.get(plannerDay.id)}
          dayLabel={labelOf(plannerDay, plannerIndex)}
          stored={callSheetForDay(callSheets.sheets, project.id, plannerDay.id)}
          others={days.flatMap((d, i) => {
            if (d.id === plannerDay.id) return []
            const sheet = callSheetForDay(callSheets.sheets, project.id, d.id)
            return sheet ? [{ sheet, label: labelOf(d, i) }] : []
          })}
          calendar={calendarActions}
          onFirstChange={ensureDaysSaved}
          onSave={callSheets.save}
          onDelete={(sheet) => void deleteCallSheet(sheet)}
          onBack={closeCallSheet}
        />
        {eventNotice && (
          <div className="mx-auto max-w-6xl px-4 pb-6">
            <EventNotice notice={eventNotice} onDone={() => setEventNotice(null)} />
          </div>
        )}
        {eventSheet}
      </>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6">
      <CrewRoleDatalist id={crewListListId(crewListId)} names={activeRoles.map((r) => r.name)} />

      <header className="space-y-1">
        <h2 className="text-lg font-bold tracking-tight text-white" style={archivo}>
          Realizacja
        </h2>
        <p className="max-w-2xl text-xs text-zinc-500">
          Koszty, ekipa i sprzęt, które naprawdę były — zaczynają się od wyceny. Zaznaczone = było; „Moja praca" nie jest
          kosztem. Zysk i marże są w zakładce Finanse.{' '}
          {!countsTowardRevenue(project.status) && 'To jeszcze wycena: realizację wpisuje się zwykle po akceptacji.'}
        </p>
        {mode === 'draft' && plan.rows.length > 0 && (
          <p className="max-w-2xl text-xs text-amber-200/70">
            Pozycje z wyceny — jeszcze niezapisane. Pierwsza zmiana (zaznaczenie, kwota, osoba, nowy wiersz) zapisze je jako
            Realizację; do tego czasu Finanse liczą plan.
          </p>
        )}
      </header>

      {(notice || eventNotice || changes || missing) && (
        <div className="space-y-2">
          {notice && (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
              role="status"
            >
              <span className="min-w-0 flex-1">{notice.message}</span>
              {notice.undo && (
                <button
                  type="button"
                  onClick={async () => {
                    const undo = notice.undo
                    setNotice(null)
                    await undo?.()
                  }}
                  className="font-semibold text-primary outline-none hover:underline focus-visible:underline"
                >
                  Cofnij
                </button>
              )}
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-zinc-500 hover:text-zinc-200"
                aria-label="Zamknij komunikat"
              >
                ×
              </button>
            </div>
          )}
          {eventNotice && <EventNotice notice={eventNotice} onDone={() => setEventNotice(null)} />}
          {changes && <QuoteChangesBanner projectId={project.id} changes={changes} onApply={applyChanges} />}
          {missing && <MissingFromQuote projectId={project.id} missing={missing} onAdd={addMissing} />}
        </div>
      )}

      <section aria-label="Koszty projektu" className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-white" style={archivo}>
              Koszty projektu
            </h3>
            <p className="text-xs text-zinc-500">
              To, co nie należy do jednego dnia: preprodukcja, dojazd, nocleg, catering, postprodukcja, sprzęt kupiony na ten projekt.
            </p>
          </div>
          <TotalsText lines={layout.project} label="Razem" />
        </div>
        <div className="space-y-1.5">
          {layout.project.map((cost) => (
            <div key={cost.id}>
              <CostRow
                cost={cost}
                withCrewCategory
                mechanics={mechanics(cost)}
                onChange={(patch) => changeCost(cost, patch)}
                onRemove={() => removeCost(cost)}
              />
              {cost.dayId && !days.some((d) => d.id === cost.dayId) && (
                <p className="mt-0.5 text-[11px] text-amber-200/70">Dzień tego kosztu już nie istnieje — liczy się do projektu.</p>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={addProjectCost}
            className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          >
            <Plus className="size-3.5" />
            Koszt projektu
          </button>
          {mode === 'legacy' && hasQuote && (
            <RestartFromQuote
              before={financeCosts}
              after={restartPreview}
              enteredCount={enteredCount}
              planCount={plan.rows.length}
              onConfirm={restart}
            />
          )}
        </div>
      </section>

      <section aria-label="Dni realizacji" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white" style={archivo}>
            Dni realizacji{' '}
            <span className="text-sm font-normal text-zinc-500">
              {days.length} {plural(days.length, 'dzień', 'dni', 'dni')}
            </span>
          </h3>
          {newDayButton}
        </div>
        {outsideNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
            <span>Spoza bazy Ekipa:</span>
            {outsideNames.map((entry) => (
              <button
                key={personKey(entry.name)}
                type="button"
                onClick={() => void addToCrewBase(entry)}
                title={[entry.roles.join(', '), entry.lastRate ? `${entry.lastRate} zł` : ''].filter(Boolean).join(' · ') || undefined}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 font-semibold text-zinc-200 hover:bg-white/5"
              >
                <Plus className="size-3" />
                {entry.name}
              </button>
            ))}
            <span className="text-zinc-600">— kliknij, żeby dodać do bazy</span>
          </div>
        )}
        {layout.unassigned.map((group) => (
          <article
            key={String(group.quoteDay)}
            className="rounded-xl border border-dashed border-white/10 bg-zinc-900/30 p-4"
            aria-label={group.quoteDay === null ? 'Ekipa z szybkiej wyceny' : `Dzień ${group.quoteDay + 1} z wyceny`}
          >
            <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {group.quoteDay === null ? 'Ekipa z szybkiej wyceny — wszystkie dni' : `Dzień ${group.quoteDay + 1} z wyceny`}
                </h4>
                <p className="text-[11px] text-zinc-500">
                  {group.quoteDay === null
                    ? 'Szybka wycena nie dzieli ekipy na dni. Rozpisz ją na dni, jeśli chcesz (i odznacz tę pozycję).'
                    : 'W Realizacji nie ma takiego dnia zdjęciowego — koszty liczą się do projektu.'}
                </p>
              </div>
              <div className="flex items-start gap-3">
                {days.length > 0 && (
                  <select
                    value=""
                    aria-label="Przenieś do dnia"
                    onChange={(e) => e.target.value && moveToDay(group.costs, e.target.value)}
                    className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-300"
                  >
                    <option value="">Przenieś do dnia…</option>
                    {days.map((d, i) => (
                      <option key={d.id} value={d.id}>
                        {labelOf(d, i)}
                      </option>
                    ))}
                  </select>
                )}
                <TotalsText lines={group.costs} label="Koszty" />
              </div>
            </header>
            <DayLines lines={group.costs} handlers={handlers} />
          </article>
        ))}
        <DayCards
          days={days}
          info={info}
          lines={layout.byDay}
          rentByDay={rentByDay}
          handlers={handlers}
          dayLabel={labelOf}
          calendar={calendarActions}
          dayRemoval={dayRemoval}
          onRemoveDay={(day) => void removeDay(day)}
          onAddCost={addDayCost}
          onCopyCrew={copyCrew}
          callSheetOf={callSheetOf}
          callSheetsReady={!callSheets.isLoading}
          onOpenCallSheet={openCallSheet}
        />
      </section>

      <GearGrid
        project={project}
        days={days}
        info={info}
        suggestion={suggestion}
        calendarDayCount={calendarDayCount}
        onCommit={commitDays}
        dayLabel={labelOf}
        renderDayDate={(day, close) => (
          <DayCalendar day={day} info={info.get(day.id)} actions={calendarActions} onDone={close} />
        )}
        dayRemoval={dayRemoval}
        onRemoveDay={(day) => void removeDay(day)}
        addDayButton={newDayButton}
        kitCrewOfDay={kitCrewOfDay}
        onKitCrew={applyKitCrew}
        extraActions={
          <button
            type="button"
            onClick={copyGearFromQuote}
            disabled={!quoteHasGear || days.length === 0}
            title={
              quoteHasGear
                ? 'Sprzęt z dni wyceny trafia do dni zdjęciowych, które nie mają jeszcze sprzętu'
                : 'Wycena nie ma sprzętu z katalogu (szczegółowa wycena produkcji)'
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs font-medium text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PackagePlus className="size-3.5" />
            Sprzęt z wyceny
          </button>
        }
      />

      {eventSheet}
    </div>
  )
}

/** `useId` daje „:r1:" — id elementu `datalist` musi być poprawnym selektorem w atrybucie `list`. */
function crewListListId(id: string): string {
  return `crew-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
}
