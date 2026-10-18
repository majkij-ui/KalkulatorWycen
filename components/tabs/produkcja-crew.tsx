'use client'

/**
 * Ekipa w wycenie (T9b, plan §6d; R1 plan po jeździe próbnej §13): role i
 * ludzie z bazy Ekipa w dniu zdjęciowym, jak sprzęt z katalogu w G5.
 *
 * Każdy wiersz ma dwie kwoty do edycji (R1, A3): „Koszt" (mój koszt, zł —
 * pozycja planu) i „Klient" (cena tej pozycji dla klienta przed marżą, w walucie
 * wyceny — trafia do PDF). Wybór osoby wpisuje w obie jej stawkę w roli;
 * zmiana osoby albo roli bierze obie od nowa. Kwota wpisana ręcznie jest
 * oznaczona i „zaktualizuj stawki" jej nie rusza. Reguły: `lib/quote-crew.ts`.
 */

import { useMemo, useState } from 'react'
import { Minus, Plus, RefreshCw, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useQuote } from '@/lib/quote-context'
import { currencyUnit, isForeign, priceFromPln, priceToPln, type QuoteMoney } from '@/lib/quote-currency'
import { lineMarginMultiplier } from '@/lib/quote-calc'
import { useCrew } from '@/lib/crew-context'
import {
  CREW_ROLE_GROUPS,
  crewMemberById,
  crewPickerOptions,
  crewRoleGroupLabel,
  personRateFor,
  selfCrewMember,
  type CrewMember,
  type CrewRole,
} from '@/lib/crew-types'
import {
  createQuoteCrewLine,
  crewLineBucket,
  dayCrewFigures,
  refreshCrewLines,
  resetCrewAmount,
  staffCrewLine,
  staleCrewLines,
  withCrewAmount,
  withCrewRole,
} from '@/lib/quote-crew'
import type { QuoteCrewLine, ShootingDay } from '@/lib/quote-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CrewRolesSheet } from '@/components/crew/crew-roles-sheet'

const NEW_ROLE = '__new_role__'
const NEW_PERSON = '__new_person__'

function amountOf(text: string): number | undefined {
  if (!text.trim()) return undefined
  const value = Number(text.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function amountText(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded).replace('.', ',')
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
          title="Kwoty wpisane ręcznie zostają"
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
  // Stawki ról w zł; w wycenie w EUR „Klient" w pełnych euro, „Koszt" w zł (S3).
  const { data, marginMultiplier, formatCurrency, money } = useQuote()
  const { quoteRoles: roles, quoteActiveRoles: activeRoles, people, allPeople, addRole } = useCrew()
  const lines = day.crew ?? []
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles])
  const [newRole, setNewRole] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  // Wycena sprzed R1: cena wiersza z marżą z nagłówka; od R1 marża to osobna pozycja.
  const lineM = lineMarginMultiplier(data, marginMultiplier)
  const me = useMemo(() => selfCrewMember(people), [people])

  const setLines = (next: QuoteCrewLine[]) => onUpdate('crew', next)
  const replace = (id: string, next: QuoteCrewLine[]) => setLines(lines.flatMap((l) => (l.id === id ? next : [l])))
  const remove = (id: string) => setLines(lines.filter((l) => l.id !== id))
  const addLine = (role: CrewRole) => setLines([...lines, createQuoteCrewLine(role)])

  const grouped = useMemo(() => groupRoles(activeRoles), [activeRoles])

  const figures = dayCrewFigures({
    crew: lines.map((line) => ({ ...line, clientRate: priceFromPln(line.clientRate, money) })),
  })
  const dayClient = (figures.ekipa + figures.obsada) * lineM

  return (
    <div className="space-y-2">
      {lines.length > 0 && (
        <ul className="space-y-1">
          {lines.map((line) => (
            <CrewLineRow
              key={line.id}
              line={line}
              role={roleById.get(line.roleId) ?? null}
              person={crewMemberById(allPeople, line.personId)}
              people={people}
              me={me}
              grouped={grouped}
              roleById={roleById}
              lineM={lineM}
              money={money}
              formatCurrency={formatCurrency}
              onReplace={(next) => replace(line.id, next)}
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
                    {role.name} · {Math.round(priceFromPln(role.clientRate, money))} {currencyUnit(money.currency)}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={NEW_ROLE}>＋ Nowa rola…</option>
          </select>
          {/* A4: stawki ról (Ekipa › Role) bez wychodzenia z wyceny. */}
          <button
            type="button"
            onClick={() => setRolesOpen(true)}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline"
          >
            <SlidersHorizontal className="size-3.5" />
            Stawki ról
          </button>
          {lines.length > 0 && (
            <span className="ml-auto text-xs tabular-nums text-zinc-500">
              ekipa w dniu {formatCurrency(Math.round(dayClient))}
            </span>
          )}
        </div>
      )}

      <Sheet open={rolesOpen} onOpenChange={setRolesOpen}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          // Bez autofokusu na nazwie pierwszej roli — przypadkowe pisanie zmieniłoby jej nazwę.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="overflow-y-auto border-l border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-2xl sm:max-w-md"
        >
          <SheetTitle className="sr-only">Stawki ról</SheetTitle>
          <CrewRolesSheet />
          <p className="mt-4 text-[11px] text-zinc-500">
            To ta sama lista co Ekipa › Role. Stawkę osoby w roli (np. swoją jako „Ja") zmienisz na jej karcie w
            Ekipie. Pozycje już dodane do wyceny mają zamrożone kwoty — po zmianie kliknij „zaktualizuj" nad dniami.
          </p>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function groupRoles(roles: CrewRole[]): [string, CrewRole[]][] {
  const groups = new Map<string, CrewRole[]>()
  roles.forEach((role) => {
    const bucket = groups.get(role.group) ?? []
    bucket.push(role)
    groups.set(role.group, bucket)
  })
  return [...groups.entries()]
}

/** Imię w liście wyboru: „Ja" najpierw i z dopiskiem (R1). */
function personLabel(m: CrewMember, me: CrewMember | null): string {
  return me && m.id === me.id ? `Ja · ${m.name}` : m.name
}

function CrewLineRow({
  line,
  role,
  person,
  people,
  me,
  grouped,
  roleById,
  lineM,
  money,
  formatCurrency,
  onReplace,
  onRemove,
}: {
  line: QuoteCrewLine
  role: CrewRole | null
  /** Osoba z bazy (po scaleniu — ta, która została); `null` = brak albo usunięta. */
  person: CrewMember | null
  people: CrewMember[]
  me: CrewMember | null
  grouped: [string, CrewRole[]][]
  roleById: Map<string, CrewRole>
  lineM: number
  money: QuoteMoney
  formatCurrency: (n: number) => string
  onReplace: (next: QuoteCrewLine[]) => void
  onRemove: () => void
}) {
  const { addPerson } = useCrew()
  const [newPerson, setNewPerson] = useState(false)
  const options = crewPickerOptions(people, line.roleId)
  const meFirst = (list: CrewMember[]) => (me ? [...list.filter((m) => m.id === me.id), ...list.filter((m) => m.id !== me.id)] : list)
  const withRole = meFirst(options.withRole)
  const others = meFirst(options.others)
  const listed = new Set([...withRole, ...others].map((m) => m.id))
  const bucket = crewLineBucket(line)
  const isMe = !!me && line.personId === me.id
  const unit = currencyUnit(money.currency)
  const clientShown = priceFromPln(line.clientRate, money)
  const price = clientShown * line.qty * lineM
  // Stawka osoby w roli tej pozycji (S2), potem jej ogólna.
  const rateLabel = (m: CrewMember) => {
    const rate = personRateFor(m, line.roleId)
    return rate ? ` · ${Math.round(rate)} zł` : ''
  }
  const change = (next: QuoteCrewLine) => onReplace([next])

  const pickPerson = (id: string) => {
    if (id === NEW_PERSON) return setNewPerson(true)
    const picked = id ? (people.find((m) => m.id === id) ?? null) : null
    onReplace(staffCrewLine(line, picked, role))
  }

  const pickRole = (id: string) => {
    const next = roleById.get(id)
    if (next && next.id !== line.roleId) change(withCrewRole(line, next, person))
  }

  // Nowa osoba z rolą tej pozycji trafia do bazy Ekipa i od razu obsadza miejsce.
  const createPerson = async (params: { name: string; rate?: number }) => {
    const created = await addPerson({ name: params.name, rate: params.rate, roleIds: role ? [role.id] : [] })
    if (created) onReplace(staffCrewLine(line, created, role))
    setNewPerson(false)
  }

  const roleListed = grouped.some(([, list]) => list.some((r) => r.id === line.roleId))

  return (
    <li className="flex flex-wrap items-end gap-x-3 gap-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="flex min-w-[130px] flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
          Rola
          {bucket === 'obsada' && <span className="text-zinc-600">· obsada</span>}
          {isMe && <span className="rounded bg-primary/20 px-1 text-[9px] font-bold text-primary">Ja</span>}
        </span>
        <select
          value={line.roleId}
          onChange={(e) => pickRole(e.target.value)}
          aria-label={`Rola: ${line.roleName}`}
          className={`${selectClass} max-w-[180px]`}
        >
          {!roleListed && <option value={line.roleId}>{line.roleName}</option>}
          {grouped.map(([group, list]) => (
            <optgroup key={group} label={crewRoleGroupLabel(group)}>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id === line.roleId ? line.roleName : r.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex min-w-[150px] flex-1 flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Osoba</span>
        <select
          value={line.personId ?? ''}
          onChange={(e) => pickPerson(e.target.value)}
          aria-label={`Osoba: ${line.roleName}`}
          className={`${selectClass} ${line.personId ? '' : 'text-zinc-500'}`}
        >
          <option value="">— do obsadzenia —</option>
          {line.personId && !listed.has(line.personId) && (
            <option value={line.personId}>{line.personName ?? 'osoba spoza bazy'} (poza listą)</option>
          )}
          {withRole.length > 0 && (
            <optgroup label={`Z rolą „${line.roleName}"`}>
              {withRole.map((m) => (
                <option key={m.id} value={m.id}>
                  {personLabel(m, me)}
                  {rateLabel(m)}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Pozostali">
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {personLabel(m, me)}
                  {rateLabel(m)}
                </option>
              ))}
            </optgroup>
          )}
          <option value={NEW_PERSON}>＋ Nowa osoba…</option>
        </select>
      </div>
      {!line.personId && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Osób</span>
          <div className="flex h-8 items-center gap-1">
            <button
              type="button"
              onClick={() => (line.qty <= 1 ? onRemove() : change({ ...line, qty: line.qty - 1 }))}
              aria-label={`Mniej osób: ${line.roleName}`}
              className="flex size-6 items-center justify-center rounded border border-white/10 text-zinc-400 hover:text-white"
            >
              <Minus className="size-3" />
            </button>
            <span className="w-6 text-center text-sm tabular-nums text-zinc-200">{line.qty}</span>
            <button
              type="button"
              onClick={() => change({ ...line, qty: line.qty + 1 })}
              aria-label={`Więcej osób: ${line.roleName}`}
              className="flex size-6 items-center justify-center rounded border border-white/10 text-zinc-400 hover:text-white"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>
      )}
      <AmountField
        label="Koszt"
        hint="mój koszt za osobodzień (plan)"
        value={line.costRate}
        unit="zł"
        edited={line.costEdited === true}
        ariaLabel={`Koszt: ${line.roleName}`}
        onCommit={(value) => change(withCrewAmount(line, 'cost', value))}
        onReset={() => change(resetCrewAmount(line, 'cost', role, person))}
      />
      <AmountField
        label="Klient"
        hint={lineM !== 1 ? 'cena dla klienta za osobodzień, przed marżą z nagłówka' : 'cena dla klienta za osobodzień (do PDF)'}
        value={isForeign(money) ? Math.round(clientShown) : clientShown}
        unit={unit}
        edited={line.clientEdited === true}
        ariaLabel={`Klient: ${line.roleName}`}
        onCommit={(value) => change(withCrewAmount(line, 'client', priceToPln(value, money)))}
        onReset={() => change(resetCrewAmount(line, 'client', role, person))}
      />
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">{lineM !== 1 ? 'Z marżą' : 'Razem'}</span>
        <div className="flex h-8 w-24 items-center justify-end text-sm tabular-nums text-zinc-200">
          {formatCurrency(Math.round(price))}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Usuń ${line.roleName}`}
        className="flex h-8 items-center text-zinc-600 hover:text-red-400"
      >
        <X className="size-4" />
      </button>
      {newPerson && <NewPersonForm roleName={line.roleName} onSave={createPerson} onCancel={() => setNewPerson(false)} />}
    </li>
  )
}

/**
 * Kwota w wierszu: pole zatwierdza się Enterem albo po wyjściu z pola; ta sama
 * liczba nic nie zmienia (samo kliknięcie nie robi z niej „ręcznej"). Kwota
 * wpisana ręcznie ma dopisek i ↺ (znowu z Ekipy).
 */
function AmountField({
  label,
  hint,
  value,
  unit,
  edited,
  ariaLabel,
  onCommit,
  onReset,
}: {
  label: string
  hint: string
  value: number
  unit: string
  edited: boolean
  ariaLabel: string
  onCommit: (value: number) => void
  onReset: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? amountText(value)
  const commit = () => {
    if (text === null) return
    const parsed = amountOf(text)
    setText(null)
    if (parsed === undefined) return
    if (Math.abs(parsed - Math.round(value * 100) / 100) < 0.005) return
    onCommit(parsed)
  }
  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
        {edited && <span className="ml-1 normal-case tracking-normal text-amber-300/80">ręcznie</span>}
      </span>
      <div className="flex h-8 items-center gap-1">
        <Input
          inputMode="decimal"
          value={shown}
          aria-label={ariaLabel}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setText(null)
          }}
          className={`h-8 w-20 border-white/10 bg-black/40 text-right text-sm tabular-nums ${edited ? 'text-amber-100' : ''}`}
        />
        <span className="text-[11px] text-zinc-500">{unit}</span>
        {edited && (
          <button
            type="button"
            onClick={onReset}
            aria-label={`${label}: znowu z Ekipy`}
            title="Znowu z Ekipy (stawka osoby w roli albo roli)"
            className="text-zinc-500 hover:text-zinc-200"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
    </div>
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
