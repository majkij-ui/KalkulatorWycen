'use client'

/**
 * Ekipa w wycenie (T9b, plan §6d): role i ludzie z bazy Ekipa w dniu
 * zdjęciowym, jak sprzęt z katalogu w G5.
 *
 * Cena dla klienta = stawka ROLI × osoby × marża z nagłówka (decyzja 7);
 * osoba zmienia tylko mój koszt (pozycja planu). Nazwy i stawki są zamrożone
 * w pozycji (`lib/quote-crew.ts`); „zaktualizuj stawki" bierze bieżące z bazy.
 */

import { useMemo, useState } from 'react'
import { Minus, Plus, RefreshCw, X } from 'lucide-react'
import { useQuote } from '@/lib/quote-context'
import { useCrew } from '@/lib/crew-context'
import {
  CREW_ROLE_GROUPS,
  crewPickerOptions,
  crewRoleGroupLabel,
  type CrewMember,
  type CrewRole,
} from '@/lib/crew-types'
import {
  createQuoteCrewLine,
  crewLineBucket,
  dayCrewFigures,
  refreshCrewLines,
  staleCrewLines,
  withCrewPerson,
} from '@/lib/quote-crew'
import type { QuoteCrewLine, ShootingDay } from '@/lib/quote-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

const NEW_ROLE = '__new_role__'
const NEW_PERSON = '__new_person__'

function amountOf(text: string): number | undefined {
  if (!text.trim()) return undefined
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

const selectClass =
  'h-8 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary/50'

// ── Nad dniami: aktualność stawek i imiona w PDF ─────────────────────────────

export function CrewQuoteNotice() {
  const { data, updateField, updateShootingDay } = useQuote()
  const { quoteRoles: roles, people } = useCrew()
  const days = data.detailedShootingDays ?? []
  const hasCrew = days.some((d) => (d.crew ?? []).length > 0)
  const stale = useMemo(() => staleCrewLines(days, roles, people), [days, roles, people])
  if (!hasCrew) return null

  const refresh = () => {
    days.forEach((day) => {
      if (day.crew?.length) updateShootingDay(day.id, 'crew', refreshCrewLines(day.crew, roles, people))
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-zinc-900/30 px-4 py-2.5">
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <Switch
          checked={data.crewPeopleInPdf}
          onCheckedChange={(v) => updateField('crewPeopleInPdf', v)}
          aria-label="W PDF podaj imiona ekipy"
        />
        W PDF podaj imiona ekipy (domyślnie tylko role)
      </label>
      {stale > 0 && (
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
        >
          <RefreshCw className="size-3.5" />
          {stale} {stale === 1 ? 'pozycja ekipy ma' : 'pozycje ekipy mają'} inne stawki niż baza · zaktualizuj
        </button>
      )}
    </div>
  )
}

// ── Ekipa w dniu ─────────────────────────────────────────────────────────────

export function DayCrewSection({
  day,
  onUpdate,
}: {
  day: ShootingDay
  onUpdate: <K extends keyof ShootingDay>(field: K, value: ShootingDay[K]) => void
}) {
  const { marginMultiplier, formatCurrency } = useQuote()
  const { quoteRoles: roles, quoteActiveRoles: activeRoles, people, addRole } = useCrew()
  const lines = day.crew ?? []
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles])
  const [newRole, setNewRole] = useState(false)

  const setLines = (next: QuoteCrewLine[]) => onUpdate('crew', next)
  const update = (id: string, next: QuoteCrewLine) => setLines(lines.map((l) => (l.id === id ? next : l)))
  const remove = (id: string) => setLines(lines.filter((l) => l.id !== id))
  const addLine = (role: CrewRole) => setLines([...lines, createQuoteCrewLine(role)])

  const grouped = useMemo(() => {
    const groups = new Map<string, CrewRole[]>()
    activeRoles.forEach((role) => {
      const bucket = groups.get(role.group) ?? []
      bucket.push(role)
      groups.set(role.group, bucket)
    })
    return [...groups.entries()]
  }, [activeRoles])

  const figures = dayCrewFigures(day)
  const dayClient = (figures.ekipa + figures.obsada) * marginMultiplier

  return (
    <div className="space-y-2">
      {lines.length > 0 && (
        <ul className="space-y-1">
          {lines.map((line) => (
            <CrewLineRow
              key={line.id}
              line={line}
              role={roleById.get(line.roleId) ?? null}
              people={people}
              price={line.clientRate * line.qty * marginMultiplier}
              formatCurrency={formatCurrency}
              onChange={(next) => update(line.id, next)}
              onRemove={() => remove(line.id)}
            />
          ))}
        </ul>
      )}

      {newRole ? (
        <NewRoleForm
          onCancel={() => setNewRole(false)}
          onSave={async (params) => {
            const role = await addRole(params)
            if (role) addLine(role)
            setNewRole(false)
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value
              if (value === NEW_ROLE) return setNewRole(true)
              const role = roleById.get(value)
              if (role) addLine(role)
            }}
            aria-label="Dodaj rolę do dnia"
            className={`${selectClass} text-zinc-300`}
          >
            <option value="">+ Dodaj rolę…</option>
            {grouped.map(([group, list]) => (
              <optgroup key={group} label={crewRoleGroupLabel(group)}>
                {list.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} · {Math.round(role.clientRate)} zł
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={NEW_ROLE}>＋ Nowa rola…</option>
          </select>
          {lines.length > 0 && (
            <span className="ml-auto text-xs tabular-nums text-zinc-500">
              ekipa w dniu {formatCurrency(Math.round(dayClient))}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function CrewLineRow({
  line,
  role,
  people,
  price,
  formatCurrency,
  onChange,
  onRemove,
}: {
  line: QuoteCrewLine
  role: CrewRole | null
  people: CrewMember[]
  price: number
  formatCurrency: (n: number) => string
  onChange: (next: QuoteCrewLine) => void
  onRemove: () => void
}) {
  const { addPerson } = useCrew()
  const [newPerson, setNewPerson] = useState(false)
  const { withRole, others } = crewPickerOptions(people, line.roleId)
  const listed = new Set([...withRole, ...others].map((m) => m.id))
  const bucket = crewLineBucket(line)

  const pickPerson = (id: string) => {
    if (id === NEW_PERSON) return setNewPerson(true)
    const person = id ? (people.find((m) => m.id === id) ?? null) : null
    onChange(withCrewPerson(line, person, role))
  }

  // Nowa osoba z rolą tej pozycji trafia do bazy Ekipa i od razu obsadza miejsce.
  const createPerson = async (params: { name: string; rate?: number }) => {
    const person = await addPerson({ name: params.name, rate: params.rate, roleIds: role ? [role.id] : [] })
    if (person) onChange(withCrewPerson(line, person, role))
    setNewPerson(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5">
      <div className="min-w-[120px]">
        <div className="text-sm text-zinc-100">
          {line.roleName}
          {bucket === 'obsada' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-zinc-500">obsada</span>}
        </div>
        <div className="text-[11px] text-zinc-500">
          {formatCurrency(line.clientRate)}/dzień · mój koszt {formatCurrency(line.costRate)}
        </div>
      </div>
      <select
        value={line.personId ?? ''}
        onChange={(e) => pickPerson(e.target.value)}
        aria-label={`Osoba: ${line.roleName}`}
        className={`${selectClass} min-w-[150px] flex-1 ${line.personId ? '' : 'text-zinc-500'}`}
      >
        <option value="">— do obsadzenia —</option>
        {line.personId && !listed.has(line.personId) && (
          <option value={line.personId}>{line.personName ?? 'osoba spoza bazy'} (poza listą)</option>
        )}
        {withRole.length > 0 && (
          <optgroup label={`Z rolą „${line.roleName}"`}>
            {withRole.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.rate ? ` · ${Math.round(m.rate)} zł` : ''}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Pozostali">
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.rate ? ` · ${Math.round(m.rate)} zł` : ''}
              </option>
            ))}
          </optgroup>
        )}
        <option value={NEW_PERSON}>＋ Nowa osoba…</option>
      </select>
      {!line.personId && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => (line.qty <= 1 ? onRemove() : onChange({ ...line, qty: line.qty - 1 }))}
            aria-label={`Mniej osób: ${line.roleName}`}
            className="flex size-6 items-center justify-center rounded border border-white/10 text-zinc-400 hover:text-white"
          >
            <Minus className="size-3" />
          </button>
          <span className="w-6 text-center text-sm tabular-nums text-zinc-200">{line.qty}</span>
          <button
            type="button"
            onClick={() => onChange({ ...line, qty: line.qty + 1 })}
            aria-label={`Więcej osób: ${line.roleName}`}
            className="flex size-6 items-center justify-center rounded border border-white/10 text-zinc-400 hover:text-white"
          >
            <Plus className="size-3" />
          </button>
        </div>
      )}
      <div className="w-24 text-right text-sm tabular-nums text-zinc-200">{formatCurrency(Math.round(price))}</div>
      <button type="button" onClick={onRemove} aria-label={`Usuń ${line.roleName}`} className="text-zinc-600 hover:text-red-400">
        <X className="size-4" />
      </button>
      {newPerson && (
        <NewPersonForm roleName={line.roleName} onSave={createPerson} onCancel={() => setNewPerson(false)} />
      )}
    </li>
  )
}

function NewPersonForm({
  roleName,
  onSave,
  onCancel,
}: {
  roleName: string
  onSave: (params: { name: string; rate?: number }) => void | Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const canSave = name.trim().length > 0 && (rate.trim() === '' || amountOf(rate) !== undefined)

  const save = () => {
    if (canSave) void onSave({ name: name.trim(), rate: amountOf(rate) })
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-black/30 p-2">
      <label className="text-[11px] text-zinc-500">
        Imię i nazwisko
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') onCancel()
          }}
          className="mt-1 h-8 w-48 text-sm"
        />
      </label>
      <label className="text-[11px] text-zinc-500">
        Mój koszt / dzień (opcjonalnie)
        <Input
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') onCancel()
          }}
          className="mt-1 h-8 w-28 text-right text-sm tabular-nums"
        />
      </label>
      <Button size="sm" className="h-8 text-xs" onClick={save} disabled={!canSave}>
        Dodaj do Ekipy
      </Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>
        Anuluj
      </Button>
      <p className="w-full text-[11px] text-zinc-500">
        Trafi do bazy Ekipa z rolą „{roleName}". Telefon i e-mail dopiszesz na ekranie „Ekipa".
      </p>
    </div>
  )
}

function NewRoleForm({
  onSave,
  onCancel,
}: {
  onSave: (params: { name: string; group: string; clientRate: number; costRate?: number }) => void | Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState<string>('ekipa')
  const [clientRate, setClientRate] = useState('')
  const [costRate, setCostRate] = useState('')
  const canSave = name.trim().length > 0 && amountOf(clientRate) !== undefined

  const save = () => {
    if (!canSave) return
    void onSave({ name: name.trim(), group, clientRate: amountOf(clientRate) ?? 0, costRate: amountOf(costRate) })
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-black/30 p-2">
      <label className="text-[11px] text-zinc-500">
        Nowa rola
        <Input
          autoFocus
          value={name}
          placeholder="np. Operator drona"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') onCancel()
          }}
          className="mt-1 h-8 w-44 border-white/10 bg-black/40 text-sm"
        />
      </label>
      <label className="text-[11px] text-zinc-500">
        Grupa
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${selectClass} mt-1 block`}>
          {CREW_ROLE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {crewRoleGroupLabel(g)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] text-zinc-500">
        Stawka dla klienta
        <Input
          inputMode="decimal"
          value={clientRate}
          placeholder="zł / dzień"
          onChange={(e) => setClientRate(e.target.value)}
          className="mt-1 h-8 w-28 border-white/10 bg-black/40 text-right text-sm tabular-nums"
        />
      </label>
      <label className="text-[11px] text-zinc-500">
        Mój koszt (opcjonalnie)
        <Input
          inputMode="decimal"
          value={costRate}
          placeholder="= stawka"
          onChange={(e) => setCostRate(e.target.value)}
          className="mt-1 h-8 w-28 border-white/10 bg-black/40 text-right text-sm tabular-nums"
        />
      </label>
      <Button type="button" size="sm" onClick={save} disabled={!canSave} className="h-8">
        Dodaj rolę
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="h-8 text-zinc-400">
        Anuluj
      </Button>
    </div>
  )
}
