'use client'

/**
 * Formularz dodawania / edycji wpisu kalendarza.
 *
 * Wydarzenia idą do `events.json` przez `eventFromDraft`, które przy edycji
 * startuje od oryginału — pola spoza formularza (import Gmaila, nowsza wersja)
 * przechodzą nietknięte. Zakup sprzętu to wyjątek: zapisuje się w KATALOGU
 * (data zakupu pozycji), bo tam jest jego jedyne miejsce (plan §3.4).
 */

import { useId, useMemo, useState } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'
import { EVENT_GROUPS, EVENT_GROUP_LABELS, groupChip } from '@/lib/calendar-palette'
import { gearItemIdOf, type CalendarEntry } from '@/lib/calendar-entries'
import { EVENT_KINDS, eventKind, type EventField } from '@/lib/event-kinds'
import {
  draftFromEvent,
  draftProblems,
  emptyDraft,
  eventFromDraft,
  parseAmount,
  type DraftProblem,
  type EventDraft,
} from '@/lib/event-draft'
import type { TimelineEvent } from '@/lib/event-types'
import { useEvents } from '@/lib/events-context'
import { useEquipment } from '@/lib/equipment-context'
import { useProjectHub } from '@/lib/project-hub-context'
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  PROJECT_STATUS_LABELS,
  type EquipmentCategory,
  type Project,
} from '@/lib/project-types'
import { archivo } from './calendar-bits'

export type FormTarget =
  | { mode: 'new'; date: string; projectId: string | null }
  | { mode: 'edit'; entry: CalendarEntry }

export interface SavedInfo {
  kind: string
  /** Dzień zapisanego wpisu — kalendarz przechodzi na jego miesiąc. */
  date: string
  /** Projekt wpisu (także świeżo założony, którego lista jeszcze nie zna). */
  project: Pick<Project, 'id' | 'name' | 'status'> | null
}

const NEW_PROJECT = '__new__'

const PROBLEM_TEXT: Record<DraftProblem | 'projectName' | 'gearName', string> = {
  date: 'Podaj datę.',
  endDate: 'Koniec nie może być przed początkiem.',
  time: 'Godzina w formacie GG:MM.',
  project: 'Wybierz projekt albo załóż nowy.',
  projectName: 'Nadaj nazwę nowemu projektowi.',
  gearName: 'Podaj nazwę sprzętu.',
}

const inputClass =
  'h-8 w-full rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none [color-scheme:dark] placeholder:text-zinc-600 focus:border-white/30'

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[11px] text-zinc-500">
      {children}
    </label>
  )
}

/** Wydarzenie bez pola `origin` (to cecha widoku kalendarza, nie zapisu). */
function toStoredEvent(entry: CalendarEntry): TimelineEvent {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { origin, ...event } = entry
  return event
}

export function EventForm({
  target,
  onClose,
  onSaved,
  onDeleted,
}: {
  target: FormTarget
  onClose: () => void
  onSaved: (info: SavedInfo) => void
  onDeleted: (event: TimelineEvent) => void
}) {
  const id = useId()
  const { save, remove } = useEvents()
  const { projects, createProjectWithoutQuote } = useProjectHub()
  const { items, addItem, updateItem } = useEquipment()

  const editing = target.mode === 'edit' ? target.entry : null
  const gearItem = useMemo(() => {
    const itemId = editing ? gearItemIdOf(editing) : null
    return itemId ? (items.find((i) => i.id === itemId) ?? null) : null
  }, [editing, items])
  const original = editing && editing.origin === 'event' ? toStoredEvent(editing) : null

  const [draft, setDraft] = useState<EventDraft>(() => {
    if (original) return draftFromEvent(original)
    if (editing) return { ...emptyDraft({ kind: 'gear_purchase', date: editing.start.slice(0, 10) }), title: editing.title }
    const t = target as Extract<FormTarget, { mode: 'new' }>
    return emptyDraft({ kind: t.projectId ? 'shoot_day' : 'lead_in', date: t.date, projectId: t.projectId })
  })
  const [projectName, setProjectName] = useState('')
  const [projectClient, setProjectClient] = useState('')
  const [newProject, setNewProject] = useState(false)
  const [gearCategory, setGearCategory] = useState<EquipmentCategory>(gearItem?.category ?? 'kamery')
  const [gearPrice, setGearPrice] = useState(gearItem?.purchasePrice ? String(gearItem.purchasePrice) : '')
  const [showProblems, setShowProblems] = useState(false)
  const [busy, setBusy] = useState(false)

  const kind = eventKind(draft.kind)
  const isGear = draft.kind === 'gear_purchase'
  const clients = useMemo(
    () => [...new Set(projects.map((p) => p.client.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')),
    [projects]
  )

  // Edytowanego wydarzenia nie da się zamienić w zakup sprzętu (to inny zapis)
  // i odwrotnie — pozycja katalogu zostaje zakupem.
  const pickableKinds = EVENT_KINDS.filter((k) =>
    gearItem ? k.key === 'gear_purchase' : original ? k.key !== 'gear_purchase' : true
  )

  const problems: (DraftProblem | 'projectName' | 'gearName')[] = isGear
    ? [
        ...(draft.title.trim() ? [] : (['gearName'] as const)),
        ...draftProblems(draft).filter((p) => p === 'date'),
      ]
    : [
        ...draftProblems(draft, { newProject }),
        ...(newProject && !projectName.trim() ? (['projectName'] as const) : []),
      ]

  const set = (patch: Partial<EventDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const setField = (key: string, value: string) => setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }))

  const chooseKind = (key: string) => {
    const next = eventKind(key)
    setDraft((d) => ({
      ...d,
      kind: key,
      projectId: next.scope === 'business' ? null : d.projectId,
      time: next.timed ? d.time : '',
      endDate: next.range ? d.endDate : '',
    }))
    if (next.scope === 'business') setNewProject(false)
  }

  const submit = async () => {
    if (problems.length) {
      setShowProblems(true)
      return
    }
    setBusy(true)
    try {
      if (isGear) {
        const purchasePrice = parseAmount(gearPrice) ?? 0
        if (gearItem) {
          await updateItem({
            ...gearItem,
            name: draft.title.trim(),
            category: gearCategory,
            purchasePrice,
            purchaseDate: draft.date,
          })
        } else {
          await addItem({ name: draft.title, category: gearCategory, purchasePrice, purchaseDate: draft.date })
        }
        onSaved({ kind: 'gear_purchase', date: draft.date, project: null })
        return
      }

      let project: Project | null = projects.find((p) => p.id === draft.projectId) ?? null
      if (newProject) project = await createProjectWithoutQuote({ name: projectName, client: projectClient })
      const event = eventFromDraft({ ...draft, projectId: project?.id ?? draft.projectId }, original)
      await save(event)
      onSaved({ kind: event.kind, date: draft.date, project: event.projectId ? project : null })
    } finally {
      setBusy(false)
    }
  }

  const fieldInput = (field: EventField) => {
    const fieldId = `${id}-f-${field.key}`
    const listId = field.suggestions ? `${fieldId}-list` : undefined
    return (
      <div key={field.key}>
        <Label htmlFor={fieldId}>{field.label}</Label>
        <input
          id={fieldId}
          type={field.type === 'date' ? 'date' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={draft.fields[field.key] ?? ''}
          onChange={(e) => setField(field.key, e.target.value)}
          placeholder={field.placeholder}
          list={listId}
          className={inputClass}
        />
        {field.suggestions && (
          <datalist id={listId}>
            {field.suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </div>
    )
  }

  const heading = gearItem ? 'Zakup sprzętu' : original ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold text-white" style={archivo}>
          {heading}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij formularz"
          className="rounded-md p-1 text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Typ */}
      {!gearItem && (
        <fieldset className="space-y-2.5">
          <legend className="mb-1.5 text-[11px] text-zinc-500">Co się wydarzyło?</legend>
          {EVENT_GROUPS.map((group) => {
            const kinds = pickableKinds.filter((k) => k.group === group)
            if (!kinds.length) return null
            return (
              <div key={group} className="flex flex-wrap gap-1" role="group" aria-label={EVENT_GROUP_LABELS[group]}>
                {kinds.map((k) => {
                  const chip = groupChip(k.group)
                  const active = draft.kind === k.key
                  return (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => chooseKind(k.key)}
                      aria-pressed={active}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                        active ? 'bg-white/[0.04] text-zinc-50' : 'text-zinc-400 hover:text-zinc-100'
                      }`}
                      style={{ borderColor: active ? chip.bg : 'rgba(255,255,255,0.08)' }}
                    >
                      <span className="size-2 rounded-[2px]" style={{ background: chip.bg }} aria-hidden />
                      {k.label}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </fieldset>
      )}

      {/* Projekt */}
      {kind.scope !== 'business' && (
        <div>
          <Label htmlFor={`${id}-project`}>Projekt</Label>
          <select
            id={`${id}-project`}
            value={newProject ? NEW_PROJECT : (draft.projectId ?? '')}
            onChange={(e) => {
              const value = e.target.value
              setNewProject(value === NEW_PROJECT)
              set({ projectId: value && value !== NEW_PROJECT ? value : null })
            }}
            className={inputClass}
          >
            <option value="">{kind.scope === 'either' ? 'Bez projektu (sprawa firmy)' : 'Wybierz projekt…'}</option>
            <option value={NEW_PROJECT}>+ Nowy projekt…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.client ? ` (${p.client})` : ''} · {PROJECT_STATUS_LABELS[p.status]}
              </option>
            ))}
          </select>
          {newProject && (
            <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
              <div>
                <Label htmlFor={`${id}-project-name`}>Nazwa projektu</Label>
                <input
                  id={`${id}-project-name`}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="np. Tchibo — spot jesienny"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor={`${id}-project-client`}>Klient</Label>
                <input
                  id={`${id}-project-client`}
                  value={projectClient}
                  onChange={(e) => setProjectClient(e.target.value)}
                  list={`${id}-clients`}
                  className={inputClass}
                />
                <datalist id={`${id}-clients`}>
                  {clients.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Daty */}
      <div className="grid grid-cols-2 gap-2">
        <div className={kind.range || kind.timed ? '' : 'col-span-2'}>
          <Label htmlFor={`${id}-date`}>{kind.range ? 'Od' : isGear ? 'Data zakupu' : 'Data'}</Label>
          <input
            id={`${id}-date`}
            type="date"
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
            className={inputClass}
            required
          />
        </div>
        {kind.range && (
          <div>
            <Label htmlFor={`${id}-end`}>Do (włącznie)</Label>
            <input
              id={`${id}-end`}
              type="date"
              value={draft.endDate}
              min={draft.date}
              onChange={(e) => set({ endDate: e.target.value })}
              className={inputClass}
            />
          </div>
        )}
        {kind.timed && (
          <div>
            <Label htmlFor={`${id}-time`}>Godzina</Label>
            <input
              id={`${id}-time`}
              type="time"
              value={draft.time}
              onChange={(e) => set({ time: e.target.value })}
              className={inputClass}
            />
          </div>
        )}
      </div>

      {/* Treść */}
      {isGear ? (
        <>
          <div>
            <Label htmlFor={`${id}-title`}>Sprzęt</Label>
            <input
              id={`${id}-title`}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="np. Aputure 600d"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-category`}>Kategoria</Label>
              <select
                id={`${id}-category`}
                value={gearCategory}
                onChange={(e) => setGearCategory(e.target.value as EquipmentCategory)}
                className={inputClass}
              >
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EQUIPMENT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`${id}-price`}>Cena zakupu (zł)</Label>
              <input
                id={`${id}-price`}
                inputMode="decimal"
                value={gearPrice}
                onChange={(e) => setGearPrice(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Zapisuje się w katalogu Sprzęt — tam też go usuniesz albo uzupełnisz stawkę rentalową.
          </p>
        </>
      ) : (
        <>
          <div>
            <Label htmlFor={`${id}-title`}>Tytuł</Label>
            <input
              id={`${id}-title`}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder={kind.label}
              className={inputClass}
            />
          </div>
          {kind.fields?.map(fieldInput)}
          <div>
            <Label htmlFor={`${id}-notes`}>Notatki</Label>
            <textarea
              id={`${id}-notes`}
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
              rows={2}
              className={`${inputClass} h-auto resize-y py-1.5`}
            />
          </div>
        </>
      )}

      {showProblems && problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-300" role="alert">
          {problems.map((p) => (
            <li key={p}>{PROBLEM_TEXT[p]}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Zapisz
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Anuluj
        </button>
        {original && (
          <button
            type="button"
            onClick={async () => {
              await remove(original.id)
              onDeleted(original)
            }}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-zinc-500 outline-none hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Trash2 className="size-3.5" />
            Usuń
          </button>
        )}
      </div>
    </form>
  )
}
