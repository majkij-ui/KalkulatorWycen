'use client'

/**
 * Call sheet dnia realizacji (T5b) — planer dnia z CallSheetWiz wewnątrz
 * zakładki Realizacja: dzień i miejsce, harmonogram (oś czasu + lista do
 * odhaczania), ekipa i kontakty, lista pakowania, uwagi, PDF.
 *
 * Wszystko, co hub już wie, jest podpowiadane na żywo (`resolveCallSheet`):
 * data z kalendarza, miejsce z wydarzenia, ekipa dnia z Realizacji z
 * telefonami z bazy Ekipa, sprzęt z siatki, kontakt do klienta z projektu.
 * Call sheet zapisuje tylko swoje rzeczy (`call-sheets.json`) i niczego w
 * hubie nie zmienia.
 *
 * Zapis jak w Realizacji: lokalna kopia + zapis z krótkim opóźnieniem, a
 * wyjście z widoku zapisuje ostatnią zmianę. Otwarcie niczego nie zapisuje —
 * call sheet trafia do pliku przy pierwszej zmianie (razem z dniem z
 * kalendarza, jeśli ten nie był jeszcze zapisany w projekcie).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useCrew } from '@/lib/crew-context'
import { useEquipment } from '@/lib/equipment-context'
import { useQuote } from '@/lib/quote-context'
import {
  addCategory,
  addContact,
  addedScheduleIds,
  addExtraCrew,
  addGearExtra,
  applyDayTemplate,
  copyScheduleFrom,
  createCallSheet,
  importSavedDay,
  liveCategories,
  liveScheduleCount,
  moveScheduleItem,
  nextStartMinutes,
  patchClient,
  patchContact,
  patchCrew,
  resolveCallSheet,
  restoreSheetItems,
  softDeleteCategory,
  softDeleteContact,
  softDeleteCrewEntry,
  softDeleteGearExtra,
  softDeleteScheduleItem,
  softDeleteScheduleItems,
  updateCategory,
  upsertScheduleItem,
} from '@/lib/call-sheet'
import type { CallSheet } from '@/lib/call-sheet-types'
import type { DayInfo } from '@/lib/realization-days'
import { REALIZATION_KIND_LABELS } from '@/lib/realization-days'
import type { GearDay, Project } from '@/lib/project-types'
import { equipmentCategoryLabel } from '@/lib/project-types'
import type { PlannerEvent, SavedDay } from '@/lib/schedule-types'
import { exportCallSheetPdf } from '@/lib/print-call-sheet'
import { minutesToHHMM } from '@/lib/time'
import { plural } from '@/lib/pl-plural'
import { KindChip, archivo, mono } from '@/components/calendar/calendar-bits'
import { DayCalendar, type DayCalendarActions } from '@/components/realization/day-calendar'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CallSheetPeople, MinutesField } from './call-sheet-people'
import { ImportSavedDay } from './import-saved-day'
import { PlannerEventForm } from './planner-event-form'
import { FieldLabel, SectionTitle, iconButton, inputClass, outlineButton, smallButton } from './planner-bits'
import { PrintableCallSheet } from './printable-call-sheet'
import { ScheduleTable } from './schedule-table'
import { TagManager } from './tag-manager'
import { VisualTimeline } from './visual-timeline'

const SAVE_DELAY_MS = 400

interface Notice {
  message: string
  tone?: 'error'
  undo?: () => void
}

export interface CallSheetPlannerProps {
  project: Project
  day: GearDay
  info: DayInfo | undefined
  dayLabel: string
  /** Zapisany call sheet dnia; `null` = jeszcze go nie ma (powstanie przy pierwszej zmianie). */
  stored: CallSheet | null
  /** Inne call sheety projektu — do „Skopiuj harmonogram z…". */
  others: { sheet: CallSheet; label: string }[]
  calendar: DayCalendarActions
  /** Pierwsza zmiana: dzień z kalendarza musi trafić do projektu, zanim call sheet go wskaże. */
  onFirstChange: () => void
  onSave: (sheet: CallSheet) => Promise<void>
  onDelete: (sheet: CallSheet) => void
  onBack: () => void
}

type SaveState = 'idle' | 'pending' | 'saved' | 'error'

function stamp(date: Date = new Date()): string {
  return `wygenerowano ${date.toLocaleDateString('pl-PL')} ${date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`
}

const card = 'rounded-xl border border-white/5 bg-zinc-900/40 p-4'

export function CallSheetPlanner({
  project,
  day,
  info,
  dayLabel,
  stored,
  others,
  calendar,
  onFirstChange,
  onSave,
  onDelete,
  onBack,
}: CallSheetPlannerProps) {
  const { allPeople } = useCrew()
  const { items } = useEquipment()
  const { pdfTexts } = useQuote()

  const [sheet, setSheet] = useState<CallSheet>(() => stored ?? createCallSheet({ projectId: project.id, dayId: day.id }))
  const sheetRef = useRef(sheet)
  const persisted = useRef(!!stored)
  const [saveState, setSaveState] = useState<SaveState>(stored ? 'saved' : 'idle')
  const [notice, setNotice] = useState<Notice | null>(null)

  // ── Zapis ──────────────────────────────────────────────────────────────────

  const saveRef = useRef(onSave)
  useEffect(() => {
    saveRef.current = onSave
  }, [onSave])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    if (!dirtyRef.current) return
    dirtyRef.current = false
    saveRef
      .current(sheetRef.current)
      .then(() => {
        if (!dirtyRef.current) setSaveState('saved')
      })
      .catch((err: unknown) => {
        console.error('Zapis call sheetu nie powiódł się:', err)
        setSaveState('error')
      })
  }, [])

  // Wyjście z widoku nie może zgubić ostatniej zmiany.
  useEffect(() => flush, [flush])

  const commit = useCallback(
    (next: CallSheet) => {
      if (!persisted.current) {
        persisted.current = true
        onFirstChange()
      }
      sheetRef.current = next
      setSheet(next)
      dirtyRef.current = true
      setSaveState('pending')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush, onFirstChange]
  )

  /** Zmiana na najświeższej wersji (kilka zmian w jednym takcie się nie gubi). */
  const change = useCallback((fn: (current: CallSheet) => CallSheet) => commit(fn(sheetRef.current)), [commit])

  const withUndo = (message: string, apply: (current: CallSheet) => CallSheet, undo: (current: CallSheet) => CallSheet) => {
    change(apply)
    setNotice({ message, undo: () => change(undo) })
  }

  // ── Widok ──────────────────────────────────────────────────────────────────

  const resolved = useMemo(
    () =>
      resolveCallSheet(sheet, {
        project,
        day,
        date: day.date,
        dayLabel,
        event: info?.event ?? null,
        people: allPeople,
        catalog: items,
      }),
    [sheet, project, day, dayLabel, info, allPeople, items]
  )
  const kind = info?.kind ?? 'shoot_day'
  const liveTags = liveCategories(sheet)

  const [formTarget, setFormTarget] = useState<{ event: PlannerEvent | null } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [generatedAt, setGeneratedAt] = useState(() => stamp())
  const printRef = useRef<HTMLDivElement>(null)
  const [gearDraft, setGearDraft] = useState('')

  const setField = (key: 'title' | 'location' | 'locationNotes' | 'notes', value: string) =>
    change((current) => {
      const next = { ...current, [key]: value }
      if (!value) delete next[key]
      return next
    })

  const setCallTime = (minutes: number | undefined) =>
    change((current) => {
      const next = { ...current, callTime: minutes }
      if (minutes === undefined) delete next.callTime
      return next
    })

  // ── Harmonogram ────────────────────────────────────────────────────────────

  const previousOf = (event: PlannerEvent | null): PlannerEvent | null => {
    if (!event) return null
    const list = resolved.schedule.filter((e) => e.id !== event.id)
    const before = list.filter(
      (e) => e.startMinutes < event.startMinutes || (e.startMinutes === event.startMinutes && e.endMinutes <= event.startMinutes)
    )
    return before.length ? before.reduce((a, b) => (b.endMinutes > a.endMinutes ? b : a)) : null
  }

  const deleteEvent = (event: PlannerEvent) => {
    const at = new Date().toISOString()
    setFormTarget(null)
    withUndo(
      `Usunięto „${event.title}".`,
      (current) => softDeleteScheduleItem(current, event.id, at),
      (current) => restoreSheetItems(current, at)
    )
  }

  const insertTemplate = () => {
    const before = sheetRef.current
    const after = applyDayTemplate(before)
    const added = addedScheduleIds(before, after)
    withUndo(
      `Wstawiono szablon dnia (${added.length} ${plural(added.length, 'wpis', 'wpisy', 'wpisów')}) od ${minutesToHHMM(
        after.schedule.find((e) => e.id === added[0])?.startMinutes ?? 420
      )}. Popraw godziny, przeciągając kafle.`,
      () => after,
      (current) => softDeleteScheduleItems(current, added, new Date().toISOString())
    )
  }

  const copyFrom = (source: CallSheet, label: string) => {
    const before = sheetRef.current
    const { sheet: after, added } = copyScheduleFrom(before, source)
    if (added === 0) {
      setNotice({ message: `„${label}" nie ma wpisów w harmonogramie.` })
      return
    }
    const ids = addedScheduleIds(before, after)
    withUndo(
      `Skopiowano ${added} ${plural(added, 'wpis', 'wpisy', 'wpisów')} z „${label}".`,
      () => after,
      (current) => softDeleteScheduleItems(current, ids, new Date().toISOString())
    )
  }

  const importDay = (savedDay: SavedDay) => {
    const before = sheetRef.current
    const result = importSavedDay(before, savedDay)
    const ids = addedScheduleIds(before, result.sheet)
    withUndo(
      `Zaimportowano „${savedDay.dayTitle || 'dzień'}" z CallSheetWiz: ${result.added} ${plural(result.added, 'wpis', 'wpisy', 'wpisów')}${
        result.replaced ? `, zastąpiono ${result.replaced}` : ''
      }.`,
      () => result.sheet,
      (current) => {
        const restored = softDeleteScheduleItems(restoreSheetItems(current, result.deletedAt), ids, new Date().toISOString())
        const next: CallSheet = { ...restored, title: before.title, importedFrom: before.importedFrom }
        if (next.title === undefined) delete next.title
        if (next.importedFrom === undefined) delete next.importedFrom
        return next
      }
    )
  }

  // ── PDF ────────────────────────────────────────────────────────────────────

  const exportPdf = async () => {
    const el = printRef.current
    if (!el) return
    setExporting(true)
    setNotice(null)
    setGeneratedAt(stamp())
    try {
      // Stopka z aktualną godziną musi się wyrenderować przed zdjęciem arkusza.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const title = ['Call sheet', resolved.title, resolved.date || dayLabel].filter(Boolean).join(' — ')
      const result = await exportCallSheetPdf(el, title)
      if (result.status === 'saved') {
        setNotice({ message: `Zapisano PDF (${result.pages} ${plural(result.pages, 'strona', 'strony', 'stron')}): ${result.path}` })
      } else if (result.status === 'downloaded') {
        setNotice({ message: `Pobrano ${result.fileName} (${result.pages} ${plural(result.pages, 'strona', 'strony', 'stron')}).` })
      }
    } catch (err) {
      console.error('Eksport call sheetu do PDF nie powiódł się:', err)
      setNotice({ tone: 'error', message: `Nie udało się zapisać PDF: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setExporting(false)
    }
  }

  const production = { company: pdfTexts.companyName, producer: pdfTexts.producerName, email: pdfTexts.contactEmail }
  const printable = (
    <PrintableCallSheet sheet={resolved} dayKind={REALIZATION_KIND_LABELS[kind]} production={production} generatedAt={generatedAt} />
  )
  const scheduleCount = liveScheduleCount(sheet)

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* Arkusz do PDF — poza ekranem tylko na czas eksportu */}
      <div ref={printRef} style={{ display: 'none' }} aria-hidden>
        {printable}
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <button type="button" onClick={onBack} className={`${smallButton} -ml-1.5`}>
            <ArrowLeft className="size-3.5" />
            Realizacja
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <KindChip kind={kind} />
            <h2 className="text-lg font-bold tracking-tight text-white" style={archivo}>
              Call sheet · {dayLabel}
            </h2>
          </div>
          <p className="text-xs text-zinc-500">
            {resolved.title}
            {resolved.callTime !== null && (
              <>
                {' · '}zbiórka <span style={mono}>{minutesToHHMM(resolved.callTime)}</span>
              </>
            )}
            {' · '}
            <span className={saveState === 'error' ? 'text-red-300' : ''}>
              {saveState === 'pending'
                ? 'zapisywanie…'
                : saveState === 'saved'
                  ? 'zapisano'
                  : saveState === 'error'
                    ? 'nie zapisano — spróbuj jeszcze raz'
                    : 'nic jeszcze nie zapisano'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowPreview((v) => !v)} className={outlineButton} aria-pressed={showPreview}>
            {showPreview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {showPreview ? 'Ukryj podgląd' : 'Podgląd wydruku'}
          </button>
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={exporting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
            Zapisz PDF
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`${iconButton} size-8 border border-white/10`} aria-label="Więcej">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 border-white/10 bg-zinc-950 text-zinc-200">
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <FileUp className="size-3.5" />
                Importuj dzień z CallSheetWiz…
              </DropdownMenuItem>
              {others.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] font-normal text-zinc-500">Skopiuj harmonogram z…</DropdownMenuLabel>
                  {others.map(({ sheet: other, label }) => (
                    <DropdownMenuItem key={other.id} onSelect={() => copyFrom(other, label)}>
                      <Copy className="size-3.5" />
                      {label}
                      <span className="ml-auto text-[11px] text-zinc-500">{liveScheduleCount(other)}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {persisted.current && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onDelete(sheetRef.current)} className="text-red-300 focus:text-red-200">
                    <Trash2 className="size-3.5" />
                    Usuń call sheet
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {notice && (
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-xs ${
            notice.tone === 'error' ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-white/10 bg-white/[0.03] text-zinc-300'
          }`}
          role="status"
        >
          <span className="min-w-0 flex-1 break-words">{notice.message}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={() => {
                const undo = notice.undo
                setNotice(null)
                undo?.()
              }}
              className="font-semibold text-primary outline-none hover:underline focus-visible:underline"
            >
              Cofnij
            </button>
          )}
          <button type="button" onClick={() => setNotice(null)} className="text-zinc-500 hover:text-zinc-200" aria-label="Zamknij komunikat">
            ×
          </button>
        </div>
      )}

      {showPreview && (
        <section aria-label="Podgląd wydruku" className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-800/40 p-4">
          <div className="mx-auto w-fit shadow-2xl shadow-black/60" style={{ zoom: 0.8 }}>
            {printable}
          </div>
        </section>
      )}

      <section aria-label="Dzień i miejsce" className={card}>
        <SectionTitle>Dzień i miejsce</SectionTitle>
        <div className="mb-3">
          <DayCalendar day={day} info={info} actions={calendar} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="cs-title">Tytuł na call sheecie</FieldLabel>
            <input
              id="cs-title"
              value={sheet.title ?? ''}
              onChange={(e) => setField('title', e.target.value)}
              placeholder={project.name || 'Nazwa projektu'}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel htmlFor="cs-location">
              Miejsce{!resolved.location.own && resolved.location.base ? ' (z kalendarza)' : ''}
            </FieldLabel>
            <input
              id="cs-location"
              value={sheet.location ?? ''}
              onChange={(e) => setField('location', e.target.value)}
              placeholder={resolved.location.base || 'np. Studio, ul. Fabryczna 1, Poznań'}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel htmlFor="cs-location-notes">Dojazd, wejście, parking</FieldLabel>
            <textarea
              id="cs-location-notes"
              value={sheet.locationNotes ?? ''}
              onChange={(e) => setField('locationNotes', e.target.value)}
              rows={2}
              placeholder="np. Brama od podwórza, parking na dziedzińcu, 2. piętro"
              className={`${inputClass} h-auto resize-y py-1.5`}
            />
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div>
              <FieldLabel htmlFor="cs-call">Zbiórka ekipy</FieldLabel>
              <MinutesField
                value={sheet.callTime}
                placeholder={resolved.schedule[0] ? minutesToHHMM(resolved.schedule[0].startMinutes) : 'GG:MM'}
                label="Zbiórka ekipy"
                onCommit={setCallTime}
                className={`${inputClass} text-center`}
              />
            </div>
            <p className="self-end pb-1 text-[11px] text-zinc-500">
              {resolved.ownCallTime
                ? 'Własna godzina zbiórki. Wyczyść, żeby liczyła się od pierwszego wpisu.'
                : 'Bez wpisu: początek pierwszego wpisu harmonogramu. Osoba może mieć swoją godzinę.'}
            </p>
          </div>
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="cs-notes">Uwagi na call sheet</FieldLabel>
            <textarea
              id="cs-notes"
              value={sheet.notes ?? ''}
              onChange={(e) => setField('notes', e.target.value)}
              rows={2}
              placeholder="Pogoda, dress code, catering, BHP…"
              className={`${inputClass} h-auto resize-y py-1.5`}
            />
          </div>
        </div>
      </section>

      <section aria-label="Harmonogram" className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white" style={archivo}>
            Harmonogram{' '}
            <span className="text-sm font-normal text-zinc-500">
              {scheduleCount} {plural(scheduleCount, 'wpis', 'wpisy', 'wpisów')}
              {resolved.wrapTime !== null && resolved.callTime !== null && (
                <>
                  {' · '}
                  <span style={mono}>
                    {minutesToHHMM(resolved.schedule[0]?.startMinutes ?? resolved.callTime)}–{minutesToHHMM(resolved.wrapTime)}
                  </span>
                </>
              )}
            </span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {scheduleCount === 0 && (
              <button type="button" onClick={insertTemplate} className={outlineButton} title="Zbiórka, rozstawienie, zdjęcia, obiad, zdjęcia, pakowanie">
                <LayoutTemplate className="size-3.5" />
                Szablon dnia
              </button>
            )}
            <TagManager
              categories={liveTags}
              onAdd={(label, color) => change((current) => addCategory(current, label, color))}
              onRename={(id, label) => change((current) => updateCategory(current, id, { label }))}
              onRecolor={(id, color) => change((current) => updateCategory(current, id, { color }))}
              onDelete={(category) => {
                const at = new Date().toISOString()
                withUndo(
                  `Usunięto tag „${category.label}" — jego wpisy są teraz bez tagu.`,
                  (current) => softDeleteCategory(current, category.id, at),
                  (current) => restoreSheetItems(current, at)
                )
              }}
            />
            <button
              type="button"
              onClick={() => setFormTarget({ event: null })}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-3.5" />
              Wpis
            </button>
          </div>
        </div>

        <VisualTimeline
          events={resolved.schedule}
          categories={sheet.categories}
          dayDate={day.date}
          onEventChange={(id, updates) => change((current) => moveScheduleItem(current, id, updates))}
          onEventClick={(event) => setFormTarget({ event })}
        />
        <ScheduleTable
          events={resolved.schedule}
          categories={sheet.categories}
          onEdit={(event) => setFormTarget({ event })}
          onDelete={deleteEvent}
          onUpdateEvent={(event) => change((current) => upsertScheduleItem(current, event))}
        />
      </section>

      <section aria-label="Ekipa i kontakty" className={card}>
        <CallSheetPeople
          sheet={resolved}
          onPatchCrew={(row, patch) => change((current) => patchCrew(current, { costId: row.costId, entryId: row.entry?.id }, patch))}
          onAddCrew={() => change((current) => addExtraCrew(current).sheet)}
          onRemoveCrew={(row) => {
            if (!row.entry) return
            const at = new Date().toISOString()
            const entryId = row.entry.id
            withUndo(
              `Usunięto ${row.value.name || 'osobę'} z call sheetu.`,
              (current) => softDeleteCrewEntry(current, entryId, at),
              (current) => restoreSheetItems(current, at)
            )
          }}
          onPatchClient={(patch) => change((current) => patchClient(current, patch))}
          onAddContact={() => change((current) => addContact(current).sheet)}
          onPatchContact={(id, patch) => change((current) => patchContact(current, id, patch))}
          onRemoveContact={(contact) => {
            const at = new Date().toISOString()
            withUndo(
              `Usunięto kontakt ${contact.label || contact.name || ''}`.trim() + '.',
              (current) => softDeleteContact(current, contact.id, at),
              (current) => restoreSheetItems(current, at)
            )
          }}
        />
      </section>

      <section aria-label="Sprzęt" className={card}>
        <SectionTitle>Sprzęt — lista pakowania</SectionTitle>
        {resolved.packing.length === 0 ? (
          <p className="text-xs text-zinc-500">
            W siatce sprzętu Realizacji nic nie zaznaczono dla tego dnia. Zaznaczony sprzęt pojawi się tu i na wydruku.
          </p>
        ) : (
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {resolved.packing.map((group) => (
              <div key={group.category}>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  {equipmentCategoryLabel(group.category)}
                </div>
                <ul className="space-y-0.5 text-sm text-zinc-200">
                  {group.items.map(({ item, qty }) => (
                    <li key={item.id}>
                      {qty > 1 && (
                        <span className="text-zinc-500" style={mono}>
                          {qty}×{' '}
                        </span>
                      )}
                      {item.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Spoza katalogu</div>
          {resolved.gearExtra.length > 0 && (
            <ul className="mb-1.5 flex flex-wrap gap-1.5">
              {resolved.gearExtra.map((g) => (
                <li key={g.id} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] py-0.5 pl-2 pr-0.5 text-xs text-zinc-200">
                  {g.text}
                  <button
                    type="button"
                    onClick={() => {
                      const at = new Date().toISOString()
                      withUndo(
                        `Usunięto „${g.text}" z listy.`,
                        (current) => softDeleteGearExtra(current, g.id, at),
                        (current) => restoreSheetItems(current, at)
                      )
                    }}
                    className="rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
                    aria-label={`Usuń ${g.text}`}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            value={gearDraft}
            onChange={(e) => setGearDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !gearDraft.trim()) return
              e.preventDefault()
              change((current) => addGearExtra(current, gearDraft))
              setGearDraft('')
            }}
            placeholder="np. Baterie AA × 12, taśma gaffer — Enter dodaje"
            aria-label="Rzecz spoza katalogu"
            className={`${inputClass} max-w-md text-xs`}
          />
        </div>
      </section>

      <ImportSavedDay
        open={importOpen}
        onOpenChange={setImportOpen}
        dayDate={day.date}
        currentCount={scheduleCount}
        onImport={importDay}
      />

      <Sheet open={!!formTarget} onOpenChange={(open) => !open && setFormTarget(null)}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="overflow-y-auto border-l border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-2xl sm:max-w-md"
        >
          <SheetTitle className="sr-only">{formTarget?.event ? 'Edytuj wpis' : 'Nowy wpis'}</SheetTitle>
          {formTarget && (
            <PlannerEventForm
              key={formTarget.event?.id ?? 'new'}
              event={formTarget.event}
              categories={liveTags}
              defaultStartMinutes={nextStartMinutes(sheet)}
              previous={previousOf(formTarget.event)}
              onSave={(event) => {
                change((current) => upsertScheduleItem(current, event))
                setFormTarget(null)
              }}
              onDelete={deleteEvent}
              onClose={() => setFormTarget(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
