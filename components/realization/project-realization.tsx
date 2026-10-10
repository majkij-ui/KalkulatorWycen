'use client'

/**
 * Zakładka „Realizacja" projektu (T5a, plan §4): dni zdjęciowe i
 * przygotowań, na każdy dzień sprzęt (siatka G3), ekipa i inne koszty
 * rzeczywiste, a na dole plan z wyceny — dawna zakładka Profit kalkulatora.
 *
 * Datę dnia trzyma kalendarz (wariant A, decyzja M.J. 2026-10-09): dzień z
 * datą to wydarzenie `shoot_day` / `prep_day`, a sprzęt, ekipa i koszty wiszą
 * na dniu zapisanym w projekcie (`realization-days.ts`). Koszty rzeczywiste
 * nie zmieniają Finansów (to T6).
 *
 * Zapis jak w siatce G3: lokalna kopia dni i kosztów + zapis z krótkim
 * opóźnieniem. `updateProject` łata najświeższą wersję projektu, ale wartości
 * bierze z tego, co mu podamy — bez lokalnej kopii szybkie klikanie gubiłoby
 * zmiany. Plan (Profit) jest częścią wyceny w kalkulatorze i zapisuje się
 * przyciskiem „Zapisz" w nagłówku.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ClipboardCopy, PackagePlus, Plus } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { useQuote } from '@/lib/quote-context'
import { useCrew } from '@/lib/crew-context'
import { crewRoleByName } from '@/lib/crew-types'
import { unknownCrewNames, type UnknownCrewName } from '@/lib/crew-stats'
import { createEvent } from '@/lib/events-store'
import { eventKind } from '@/lib/event-kinds'
import type { TimelineEvent } from '@/lib/event-types'
import { summarizeProjectGear } from '@/lib/equipment-roi'
import { gearFromQuote } from '@/lib/gear-usage'
import { kitCrewDayCosts, kitCrewFromDayCosts, type KitCrewEntry } from '@/lib/quote-crew'
import {
  addCost,
  copyCrewToDays,
  costsOfDay,
  crewSuggestions,
  isCrew,
  personKey,
  projectLevelCosts,
  restoreCosts,
  softDeleteCost,
  softDeleteDayCosts,
  updateCost,
  type NewCost,
} from '@/lib/project-costs'
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
  actualFigures,
  crewCostsFromPlan,
  isPlanUnsaved,
  plannedCrew,
  projectPlan,
} from '@/lib/realization-plan'
import {
  costCategoryLabel,
  countsTowardRevenue,
  createGearDayId,
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
import { CostRow, CrewRoleDatalist } from './cost-rows'
import { DayCalendar, formatDayLong, type DayCalendarActions } from './day-calendar'
import { DayCards } from './day-cards'
import { NewDayButton, type NewDay } from './new-day'
import { PlanSection } from './plan-section'
import { RealizationSummary } from './realization-summary'

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
  const storedRef = useRef(stored)
  const costsRef = useRef(costs)

  const { days, info, suggestion } = useMemo(
    () => resolveRealizationDays({ ...project, gearDays: stored ?? undefined }, allEvents),
    [project, stored, allEvents]
  )

  // ── Zapis ──────────────────────────────────────────────────────────────────

  const saveRef = useRef(updateProject)
  useEffect(() => {
    saveRef.current = updateProject
  }, [updateProject])
  const pendingRef = useRef<{ gearDays?: GearDay[]; costs?: ProjectCost[] }>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const { gearDays, costs: nextCosts } = pendingRef.current
    pendingRef.current = {}
    if (!gearDays && !nextCosts) return
    void saveRef.current(project.id, {
      // Stary kształt (`equipment`) czyścimy: od pierwszego zapisu liczą się dni.
      ...(gearDays ? { gearDays, equipment: [] } : {}),
      ...(nextCosts ? { costs: nextCosts } : {}),
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

  /** Koszt przypięty do dnia z kalendarza (jeszcze niezapisanego) najpierw zapisuje dni. */
  const ensureDaysSaved = () => {
    const unsaved = days.some((d) => {
      const i = info.get(d.id)
      return !i?.saved || i.pendingLink
    })
    if (unsaved) commitDays(days)
  }

  // ── Komunikaty ─────────────────────────────────────────────────────────────

  const [notice, setNotice] = useState<Notice | null>(null)
  const [eventNotice, setEventNotice] = useState<EventNoticeState | null>(null)
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null)

  // ── Dni ────────────────────────────────────────────────────────────────────

  const labelOf = (day: GearDay, index: number) => realizationDayLabel(day, info.get(day.id), index)

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
    commitCosts(addCost(costsRef.current, { ...init, dayId }))
  }
  const changeCost = (id: string, patch: Partial<ProjectCost>) => commitCosts(updateCost(costsRef.current, id, patch))
  const removeCost = (cost: ProjectCost) => {
    const deletedAt = new Date().toISOString()
    commitCosts(softDeleteCost(costsRef.current, cost.id, deletedAt))
    setNotice({
      message: `Usunięto ${describeCost(cost)}.`,
      undo: () => commitCosts(restoreCosts(costsRef.current, deletedAt)),
    })
  }

  /** Dopisane pozycje da się cofnąć jednym kliknięciem (miękko usuwamy dokładnie je). */
  const undoAdded = (ids: Set<string>) => () => {
    const deletedAt = new Date().toISOString()
    commitCosts(costsRef.current.map((c) => (ids.has(c.id) && !c.deletedAt ? { ...c, deletedAt } : c)))
  }

  // Zestawy z ekipą (T9b): ekipa zestawu → wiersze kosztów dnia; ekipa dnia → zestaw.
  const kitCrewOfDay = (day: GearDay) => kitCrewFromDayCosts(costsOfDay(costsRef.current, day.id), crewRoles)

  const applyKitCrew = (day: GearDay, crew: KitCrewEntry[]) => {
    ensureDaysSaved()
    const rows = kitCrewDayCosts(crew, day.id, costsOfDay(costsRef.current, day.id), crewRoles, crewPeople)
    if (rows.length === 0) {
      setNotice({ message: 'Ekipa z zestawu jest już w tym dniu.' })
      return
    }
    const before = new Set(costsRef.current.map((c) => c.id))
    const next = rows.reduce((list, row) => addCost(list, row), costsRef.current)
    commitCosts(next)
    setNotice({
      message: `Dopisano z zestawu ${rows.length} ${plural(rows.length, 'osobę', 'osoby', 'osób')} do ekipy dnia.`,
      undo: undoAdded(new Set(next.filter((c) => !before.has(c.id)).map((c) => c.id))),
    })
  }

  const copyCrew = (dayId: string) => {
    ensureDaysSaved()
    const before = new Set(costsRef.current.map((c) => c.id))
    const { costs: next, added } = copyCrewToDays(costsRef.current, dayId, days.map((d) => d.id))
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

  // Bieżący stan kalkulatora — ten projekt jest w nim wgrany.
  const live = useMemo(() => ({ data, pricingConfig, marginMultiplier }), [data, pricingConfig, marginMultiplier])
  const planCrew = useMemo(() => plannedCrew(live), [live])

  const copyCrewFromPlan = () => {
    ensureDaysSaved()
    const result = crewCostsFromPlan(
      planCrew,
      days.map((d) => ({ id: d.id, kind: info.get(d.id)?.kind ?? 'shoot_day' })),
      costsRef.current
    )
    const notes: string[] = []
    if (result.keptDays) notes.push(`${result.keptDays} ${plural(result.keptDays, 'dzień miał', 'dni miały', 'dni miało')} już ekipę`)
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
    const before = new Set(costsRef.current.map((c) => c.id))
    commitCosts(result.costs)
    setNotice({
      message: `Dopisano z planu ${result.added} ${plural(result.added, 'osobę', 'osoby', 'osób')}${tail}. Uzupełnij imiona i stawki.`,
      undo: undoAdded(new Set(result.costs.filter((c) => !before.has(c.id)).map((c) => c.id))),
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

  // ── Liczby ─────────────────────────────────────────────────────────────────

  const plan = useMemo(() => projectPlan(project, live), [project, live])
  const actual = useMemo(() => actualFigures(plan, costs), [plan, costs])
  const unsavedPlan = useMemo(() => isPlanUnsaved(project, live), [project, live])

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

  const projectCosts = projectLevelCosts(costs, days.map((d) => d.id))
  const calendarDayCount = days.filter((d) => info.get(d.id)?.link === 'calendar').length
  const newDayButton = <NewDayButton onAdd={addDay} />

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6">
      <CrewRoleDatalist id={crewListListId(crewListId)} names={activeRoles.map((r) => r.name)} />

      <header className="space-y-1">
        <h2 className="text-lg font-bold tracking-tight text-white" style={archivo}>
          Realizacja
        </h2>
        <p className="max-w-2xl text-xs text-zinc-500">
          Dni zdjęciowe i przygotowań (daty z kalendarza), sprzęt, ekipa i koszty, które naprawdę były — obok planu
          z wyceny. {!countsTowardRevenue(project.status) && 'To jeszcze wycena: realizację wpisuje się zwykle po akceptacji.'}
        </p>
      </header>

      {(notice || eventNotice) && (
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
        </div>
      )}

      <RealizationSummary plan={plan} actual={actual} />

      <section aria-label="Dni realizacji" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white" style={archivo}>
            Dni realizacji{' '}
            <span className="text-sm font-normal text-zinc-500">
              {days.length} {plural(days.length, 'dzień', 'dni', 'dni')}
            </span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyCrewFromPlan}
              disabled={planCrew.length === 0 || days.length === 0}
              title={
                planCrew.length === 0
                  ? 'Plan nie ma płatnej ekipy (albo projekt nie ma wyceny)'
                  : 'Role i stawki z planu trafiają do dni zdjęciowych, które nie mają jeszcze ekipy'
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs font-medium text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ClipboardCopy className="size-3.5" />
              Przepisz ekipę z planu
            </button>
            {newDayButton}
          </div>
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
        <DayCards
          days={days}
          info={info}
          costs={costs}
          rentByDay={rentByDay}
          outsiders={suggestions}
          roleListId={crewListListId(crewListId)}
          dayLabel={labelOf}
          calendar={calendarActions}
          dayRemoval={dayRemoval}
          onRemoveDay={(day) => void removeDay(day)}
          onAddCost={addDayCost}
          onChangeCost={changeCost}
          onRemoveCost={removeCost}
          onCopyCrew={copyCrew}
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

      <section aria-label="Koszty całego projektu" className="space-y-2">
        <h3 className="text-base font-bold text-white" style={archivo}>
          Koszty całego projektu
        </h3>
        <p className="text-xs text-zinc-500">
          To, co nie należy do jednego dnia: sprzęt kupiony pod projekt, dojazd za całość, montażysta, muzyka.
        </p>
        <div className="space-y-1.5">
          {projectCosts.map((cost) => (
            <div key={cost.id}>
              <CostRow
                cost={cost}
                withCrewCategory
                onChange={(patch) => changeCost(cost.id, patch)}
                onRemove={() => removeCost(cost)}
              />
              {cost.dayId && (
                <p className="mt-0.5 text-[11px] text-amber-200/70">Dzień tego kosztu już nie istnieje — liczy się do projektu.</p>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => commitCosts(addCost(costsRef.current, { category: 'sprzet', label: '', quantity: 1, unitCost: 0 }))}
          className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
        >
          <Plus className="size-3.5" />
          Koszt projektu
        </button>
      </section>

      <PlanSection plan={plan} unsaved={unsavedPlan} defaultOpen={!countsTowardRevenue(project.status)} />

      <Sheet open={!!editingEvent} onOpenChange={(open) => !open && setEditingEvent(null)}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="overflow-y-auto border-l border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-2xl sm:max-w-md"
        >
          <SheetTitle className="sr-only">
            {editingEvent ? eventKind(editingEvent.kind).label : 'Wydarzenie'}
          </SheetTitle>
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
    </div>
  )
}

/** `useId` daje „:r1:" — id elementu `datalist` musi być poprawnym selektorem w atrybucie `list`. */
function crewListListId(id: string): string {
  return `crew-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
}
