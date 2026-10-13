'use client'

/**
 * Panel jednej osoby z Ekipy: edycja (imię, role z własnymi stawkami, moja
 * stawka, kontakt, miasto, notatki), kopiowanie kontaktu, statystyki z
 * rzeczywistych kosztów (także w podziale na role), historia projektów,
 * „Scal z…", wycofanie / przywrócenie i miękkie usunięcie.
 * `member === null` = dodawanie nowej osoby.
 */

import { useState } from 'react'
import { ArrowUpRight, Check, Copy, GitMerge, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useCrew } from '@/lib/crew-context'
import { crewContactText, crewRoleGroupLabel, normalizeRoleRates, type CrewMember, type CrewRole } from '@/lib/crew-types'
import { crewCostRate } from '@/lib/quote-crew'
import type { CrewMemberStats } from '@/lib/crew-stats'
import { parseAmount } from '@/lib/event-draft'
import { dayLabel } from '@/lib/pl-plural'
import { toDateKey, type Project } from '@/lib/project-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, pln } from './crew-format'

interface RoleRateDraft {
  rate: string
  note: string
}

interface Draft {
  name: string
  roleIds: string[]
  /** Własne stawki w rolach (S2), po id roli; pusta stawka = jak stawka ogólna. */
  roleRates: Record<string, RoleRateDraft>
  rate: string
  phone: string
  email: string
  city: string
  notes: string
}

const amountText = (value: number | undefined) => (value ? String(value).replace('.', ',') : '')

function toDraft(member: CrewMember | null): Draft {
  const roleRates: Record<string, RoleRateDraft> = {}
  ;(member?.roleRates ?? []).forEach((entry) => {
    roleRates[entry.roleId] = { rate: amountText(entry.rate), note: entry.note ?? '' }
  })
  return {
    name: member?.name ?? '',
    // Stawka w roli, której nie ma na liście ról (np. z `npm run data`), dokłada tę rolę.
    roleIds: [...new Set([...(member?.roleIds ?? []), ...Object.keys(roleRates)])],
    roleRates,
    rate: amountText(member?.rate),
    phone: member?.contact?.phone ?? '',
    email: member?.contact?.email ?? '',
    city: member?.city ?? '',
    notes: member?.notes ?? '',
  }
}

/** Puste pole = brak pola w rekordzie (nie pusty string). */
function setOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined) {
  if (value === undefined || value === '') delete target[key]
  else target[key] = value
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-zinc-900/40 px-3 py-2">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-base font-semibold tabular-nums text-zinc-100">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  )
}

function RolePicker({
  roles,
  selected,
  onToggle,
  onAdd,
}: {
  roles: CrewRole[]
  selected: string[]
  onToggle: (id: string) => void
  onAdd: (name: string, group: string) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('ekipa')
  const groups = [...new Set(roles.map((r) => r.group))]
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{crewRoleGroupLabel(g)}</div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={crewRoleGroupLabel(g)}>
            {roles
              .filter((r) => r.group === g)
              .map((role) => {
                const on = selected.includes(role.id)
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle(role.id)}
                    className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                      on ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200' : 'border-white/10 text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {role.name}
                  </button>
                )
              })}
          </div>
        </div>
      ))}
      {adding ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Kolorysta"
            aria-label="Nazwa nowej roli"
            className="h-8 w-40 border-white/10 bg-black/40 text-sm"
            autoFocus
          />
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            aria-label="Grupa nowej roli"
            className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-200"
          >
            <option value="ekipa">Ekipa na planie</option>
            <option value="obsada">Obsada</option>
            <option value="post">Postprodukcja</option>
          </select>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!name.trim()}
            onClick={async () => {
              await onAdd(name, group)
              setName('')
              setAdding(false)
            }}
          >
            Dodaj
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-zinc-400" onClick={() => setAdding(false)}>
            Anuluj
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-zinc-100"
        >
          <Plus className="size-3.5" />
          Nowa rola
        </button>
      )}
    </div>
  )
}

/**
 * Stawki w rolach (S2): przy każdej roli osoby własna stawka i notatka
 * („z własnym sprzętem"). Puste pole = stawka ogólna osoby, a bez niej koszt
 * roli — podpowiedź w polu pokazuje, co policzy się zamiast.
 */
function RoleRatesEditor({
  roles,
  draft,
  onChange,
}: {
  roles: CrewRole[]
  draft: Draft
  onChange: (roleRates: Record<string, RoleRateDraft>) => void
}) {
  const general = parseAmount(draft.rate)
  const list = draft.roleIds.flatMap((id) => {
    const role = roles.find((r) => r.id === id)
    return role ? [role] : []
  })
  if (list.length === 0) return null
  const set = (roleId: string, patch: Partial<RoleRateDraft>) =>
    onChange({ ...draft.roleRates, [roleId]: { ...(draft.roleRates[roleId] ?? { rate: '', note: '' }), ...patch } })
  return (
    <div>
      <div className="mb-1 text-[11px] text-zinc-500">Moja stawka w rolach (puste = stawka ogólna poniżej)</div>
      <ul className="flex flex-col gap-1.5">
        {list.map((role) => {
          const entry = draft.roleRates[role.id] ?? { rate: '', note: '' }
          const fallback = general && general > 0 ? general : crewCostRate(role, null)
          return (
            <li key={role.id} className="flex flex-wrap items-center gap-1.5">
              <span className="w-32 shrink-0 truncate text-xs text-zinc-300" title={role.name}>
                {role.name}
              </span>
              <Input
                inputMode="decimal"
                value={entry.rate}
                placeholder={`${Math.round(fallback)}`}
                aria-label={`Moja stawka: ${role.name}`}
                onChange={(e) => set(role.id, { rate: e.target.value })}
                className="h-8 w-24 border-white/10 bg-black/40 text-right text-sm tabular-nums"
              />
              <span className="text-[11px] text-zinc-500">zł</span>
              <Input
                value={entry.note}
                placeholder="notatka, np. z własnym sprzętem"
                aria-label={`Notatka do stawki: ${role.name}`}
                onChange={(e) => set(role.id, { note: e.target.value })}
                className="h-8 min-w-[140px] flex-1 border-white/10 bg-black/40 text-xs"
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function CrewPersonSheet({
  member,
  stats,
  onClose,
  onDeleted,
  onOpenProject,
  onMerge,
}: {
  member: CrewMember | null
  stats: CrewMemberStats<Project> | undefined
  onClose: () => void
  /** Po miękkim usunięciu — sekcja pokazuje „Cofnij". */
  onDeleted: (member: CrewMember) => void
  onOpenProject?: (id: string) => void
  /** „Scal z…": otwiera scalanie z tą osobą jako tą, która zostaje. */
  onMerge?: (member: CrewMember) => void
}) {
  const { activeRoles, roles, addPerson, savePerson, removePerson, addRole } = useCrew()
  const [draft, setDraft] = useState<Draft>(() => toDraft(member))
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Role do zaznaczenia: aktywne + wycofane, które ta osoba wciąż ma.
  const pickable = roles.filter((r) => !r.retiredAt || draft.roleIds.includes(r.id))
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaved(false)
  }

  const canSave = draft.name.trim().length > 0

  const save = async () => {
    if (!canSave) return
    const rate = parseAmount(draft.rate)
    // Stawki tylko przy zaznaczonych rolach; pusta albo 0 = bez własnej stawki.
    const roleRates = normalizeRoleRates(
      draft.roleIds.map((roleId) => {
        const previous = member?.roleRates?.find((r) => r.roleId === roleId)
        const entry = draft.roleRates[roleId]
        return { ...previous, roleId, rate: parseAmount(entry?.rate ?? '') ?? 0, note: entry?.note ?? '' }
      })
    )
    if (!member) {
      await addPerson({
        name: draft.name,
        roleIds: draft.roleIds,
        rate,
        roleRates,
        contact: {
          ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
          ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
        },
        city: draft.city,
        notes: draft.notes,
      })
      onClose()
      return
    }
    const next: CrewMember = { ...member, name: draft.name.trim(), roleIds: draft.roleIds, contact: { ...member.contact } }
    setOptional(next, 'rate', rate && rate > 0 ? rate : undefined)
    // Pole znika, gdy nie ma żadnej stawki — ale tylko jeśli było, żeby zapis bez zmian nic nie dopisywał.
    if (roleRates.length > 0) next.roleRates = roleRates
    else delete next.roleRates
    setOptional(next.contact, 'phone', draft.phone.trim())
    setOptional(next.contact, 'email', draft.email.trim())
    setOptional(next, 'city', draft.city.trim())
    setOptional(next, 'notes', draft.notes.trim())
    await savePerson(next)
    setSaved(true)
  }

  const copyContact = async () => {
    const text = crewContactText({ name: draft.name, contact: { phone: draft.phone, email: draft.email } })
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // schowek niedostępny (np. podgląd bez uprawnień) — nic nie robimy
    }
  }

  const retire = async () => {
    if (!member) return
    await savePerson({ ...member, retiredAt: toDateKey(new Date()) })
  }

  const restore = async () => {
    if (!member) return
    const next: CrewMember = { ...member }
    delete next.retiredAt
    await savePerson(next)
  }

  const label = 'text-[11px] text-zinc-500'
  const field = 'mt-1 h-9 border-white/10 bg-black/40 text-sm'

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">
          {member ? member.roleIds.map(roleName).join(' · ') || 'Ekipa' : 'Nowa osoba'}
        </div>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-white">{member ? member.name : 'Dodaj osobę'}</h2>
        {member?.retiredAt && (
          <div className="mt-1 text-xs text-amber-300/80">Nie współpracujemy od {formatDate(member.retiredAt)}</div>
        )}
      </header>

      {member && stats && (
        <section className="grid grid-cols-2 gap-2">
          <Stat
            label="Razem na planie"
            value={`${stats.days} ${dayLabel(stats.days)}`}
            sub={`${stats.projects} ${stats.projects === 1 ? 'projekt' : 'proj.'}${stats.lastDate ? ` · ostatnio ${formatDate(stats.lastDate)}` : ''}`}
          />
          <Stat
            label="Średnia stawka"
            value={stats.avgDayRate === null ? '—' : pln(stats.avgDayRate)}
            sub={stats.avgDayRate === null ? 'brak dni pracy' : 'za dzień, z wierszy ekipy'}
          />
          <Stat label={`Wypłacone w ${new Date().getFullYear()}`} value={pln(stats.paidThisYear)} />
          <Stat label="Wypłacone razem" value={pln(stats.paidTotal)} />
          {stats.roles.length > 0 && (
            <div className="col-span-2 rounded-lg border border-white/5 bg-zinc-900/40 px-3 py-2">
              <div className="mb-1 text-[11px] text-zinc-500">W rolach</div>
              <ul className="flex flex-col gap-0.5">
                {stats.roles.map((r) => (
                  <li key={r.name} className="flex items-baseline gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-zinc-300">{r.name}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">
                      {r.days > 0 ? `${r.days} ${dayLabel(r.days)}` : `${r.count}×`}
                      {r.avgDayRate !== null ? ` · śr. ${pln(r.avgDayRate)}` : ''}
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums text-zinc-200">{pln(r.paid)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="col-span-2 text-[11px] text-zinc-600">
            Liczone z rzeczywistych kosztów ekipy w projektach w realizacji i zrealizowanych.
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <label className={label}>
          Imię i nazwisko
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} className={field} autoFocus={!member} />
        </label>
        <div>
          <div className={`${label} mb-1`}>Role</div>
          <RolePicker
            roles={pickable}
            selected={draft.roleIds}
            onToggle={(id) =>
              set({ roleIds: draft.roleIds.includes(id) ? draft.roleIds.filter((r) => r !== id) : [...draft.roleIds, id] })
            }
            onAdd={async (name, group) => {
              const role = await addRole({ name, group })
              if (role) set({ roleIds: [...draft.roleIds, role.id] })
            }}
          />
          {activeRoles.length === 0 && <p className="text-[11px] text-zinc-600">Brak ról — dodaj pierwszą.</p>}
        </div>
        <RoleRatesEditor roles={roles} draft={draft} onChange={(roleRates) => set({ roleRates })} />
        <label className={label}>
          Moja stawka za dzień (ile ta osoba bierze ode mnie; dla ról bez własnej stawki)
          <Input
            inputMode="decimal"
            value={draft.rate}
            placeholder="zł netto"
            onChange={(e) => set({ rate: e.target.value })}
            className={`${field} tabular-nums`}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Telefon
            <Input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} className={field} inputMode="tel" />
          </label>
          <label className={label}>
            E-mail
            <Input value={draft.email} onChange={(e) => set({ email: e.target.value })} className={field} inputMode="email" />
          </label>
        </div>
        <label className={label}>
          Miasto
          <Input value={draft.city} onChange={(e) => set({ city: e.target.value })} className={field} />
        </label>
        <label className={label}>
          Notatki
          <Textarea
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={2}
            className="mt-1 border-white/10 bg-black/40 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!canSave} className="h-9">
            {member ? 'Zapisz' : 'Dodaj'}
          </Button>
          <Button variant="ghost" onClick={onClose} className="h-9 text-zinc-400">
            {member ? 'Zamknij' : 'Anuluj'}
          </Button>
          {(draft.phone.trim() || draft.email.trim()) && (
            <Button variant="outline" onClick={copyContact} className="h-9 gap-1.5 border-white/10 text-xs">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? 'Skopiowano' : 'Kopiuj kontakt'}
            </Button>
          )}
          {saved && <span className="text-xs text-emerald-400">Zapisano</span>}
        </div>
      </section>

      {member && (
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
            Projekty ({stats?.history.length ?? 0})
          </h3>
          {!stats || stats.history.length === 0 ? (
            <p className="text-xs text-zinc-600">
              Jeszcze w żadnym projekcie w realizacji. Wybierz tę osobę w wierszu ekipy w zakładce Realizacja.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {stats.history.map((h) => (
                <li key={h.project.id}>
                  <button
                    type="button"
                    disabled={!onOpenProject}
                    onClick={() => onOpenProject?.(h.project.id)}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors enabled:hover:bg-white/5"
                  >
                    <span className="w-20 shrink-0 text-xs tabular-nums text-zinc-500">{formatDate(h.lastDate)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                      {h.project.name || 'Bez nazwy'}
                      {h.roles.length > 0 && <span className="text-zinc-500"> · {h.roles.join(', ')}</span>}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                      {h.days > 0 ? `${h.days} ${dayLabel(h.days)} · ` : ''}
                      {pln(h.paid)}
                    </span>
                    {onOpenProject && <ArrowUpRight className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {member && (
        <section className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
          {onMerge && (
            <Button
              variant="outline"
              onClick={() => onMerge(member)}
              className="h-8 gap-1.5 border-white/10 text-xs"
              title="Ta sama osoba wpisana kilka razy — połącz karty"
            >
              <GitMerge className="size-3.5" />
              Scal z…
            </Button>
          )}
          {member.retiredAt ? (
            <Button variant="outline" onClick={restore} className="h-8 gap-1.5 border-white/10 text-xs">
              <RotateCcw className="size-3.5" />
              Przywróć do wyboru
            </Button>
          ) : (
            <Button variant="outline" onClick={retire} className="h-8 border-white/10 text-xs" title="Zostaje w historii i statystykach, znika z list wyboru">
              Już nie współpracujemy
            </Button>
          )}
          {confirmDelete ? (
            <Button
              variant="destructive"
              className="h-8 text-xs"
              onClick={async () => {
                await removePerson(member.id)
                onDeleted(member)
              }}
            >
              Usuń {member.name}
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="h-8 gap-1.5 text-xs text-zinc-500 hover:text-red-300"
            >
              <Trash2 className="size-3.5" />
              Usuń
            </Button>
          )}
          {confirmDelete && (
            <p className="w-full text-[11px] text-zinc-500">
              Wiersze ekipy w projektach zostają (z imieniem). Usunięcie da się cofnąć.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
