'use client'

/**
 * Sekcja „Ekipa" (T9a, plan §6d): ludzie, z którymi pracuję — ekipa na planie
 * i podwykonawcy — z kontaktem, rolami i stawką, oraz to, ile razem
 * przepracowaliśmy. Statystyki są wyliczane z RZECZYWISTYCH kosztów ekipy w
 * projektach w realizacji i zrealizowanych (zakładka Realizacja); nic z nich
 * nie jest zapisywane.
 *
 * Klik w osobę otwiera panel z edycją, statystykami i historią projektów.
 * Imiona wpisane w projektach, których nie ma w bazie, można dodać jednym
 * kliknięciem („Dodaj do bazy") — rekordy powstają dopiero wtedy.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, Loader2, Phone, Plus, Search, UserPlus, Users } from 'lucide-react'
import { useCrew } from '@/lib/crew-context'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { computeCrewStats, crewRanking, unknownCrewNames, type UnknownCrewName } from '@/lib/crew-stats'
import { crewRoleByName, type CrewMember } from '@/lib/crew-types'
import { personKey } from '@/lib/project-costs'
import { dayLabel, plural } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CrewPersonSheet } from './crew-person-sheet'
import { CrewRolesSheet } from './crew-roles-sheet'
import { formatDate, pln } from './crew-format'

const SORTS = [
  { value: 'nazwa', label: 'Alfabetycznie' },
  { value: 'dni', label: 'Najczęściej na planie' },
  { value: 'ostatnio', label: 'Ostatnio' },
  { value: 'wyplaty', label: 'Najwięcej wypłat' },
] as const
type Sort = (typeof SORTS)[number]['value']

/** Filtr ról: id roli, „bez roli" albo wszyscy. */
const ALL = '__all__'
const NO_ROLE = '__none__'

type SheetState = { type: 'person'; id: string | null } | { type: 'roles' } | null

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-zinc-500">{sub}</div>}
    </div>
  )
}

function UnknownNamesBanner({
  names,
  onAdd,
  onAddAll,
}: {
  names: UnknownCrewName[]
  onAdd: (entry: UnknownCrewName) => void
  onAddAll: () => void
}) {
  const [open, setOpen] = useState(false)
  if (names.length === 0) return null
  return (
    <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <UserPlus className="size-4 shrink-0 text-zinc-400" />
        <span className="flex-1 text-sm text-zinc-200">
          {names.length} {plural(names.length, 'osoba wpisana', 'osoby wpisane', 'osób wpisanych')} w projektach nie
          ma w bazie
        </span>
        <ChevronDown className={`size-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-white/5 px-4 pb-3 pt-2">
          <p className="mb-2 text-xs text-zinc-500">
            Imiona z wierszy ekipy w zakładce Realizacja. Dodanie tworzy kartę osoby z rolami i ostatnią stawką; jej
            dotychczasowa praca policzy się po imieniu.
          </p>
          <ul className="flex flex-col gap-1">
            {names.map((entry) => (
              <li key={personKey(entry.name)} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                  {entry.name}
                  {entry.roles.length > 0 && <span className="text-zinc-500"> · {entry.roles.join(', ')}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {entry.uses} {plural(entry.uses, 'wiersz', 'wiersze', 'wierszy')}
                  {entry.lastRate > 0 ? ` · ${pln(entry.lastRate)}` : ''}
                </span>
                <Button size="sm" variant="outline" className="h-7 border-white/10 text-xs" onClick={() => onAdd(entry)}>
                  Dodaj do bazy
                </Button>
              </li>
            ))}
          </ul>
          {names.length > 1 && (
            <Button size="sm" className="mt-2 h-8 text-xs" onClick={onAddAll}>
              Dodaj wszystkich ({names.length})
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

export function CrewSection({ onOpenProject }: { onOpenProject?: (id: string) => void }) {
  const { people, allPeople, roles, activeRoles, isLoading, addPerson, restorePerson } = useCrew()
  const { projects } = useProjectHub()
  const { allEvents } = useEvents()

  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>(ALL)
  const [sort, setSort] = useState<Sort>('nazwa')
  const [showRetired, setShowRetired] = useState(false)
  const [sheet, setSheet] = useState<SheetState>(null)
  const [notice, setNotice] = useState<{ message: string; undoId?: string } | null>(null)

  const stats = useMemo(() => computeCrewStats(people, projects, { events: allEvents }), [people, projects, allEvents])
  const ranking = useMemo(() => crewRanking(people, stats), [people, stats])
  const unknown = useMemo(() => unknownCrewNames(projects, people), [projects, people])
  const year = new Date().getFullYear()

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id
  const retiredCount = people.filter((m) => m.retiredAt).length

  const visible = useMemo(() => {
    const needle = personKey(query)
    const list = people.filter(
      (m) =>
        (showRetired || !m.retiredAt) &&
        (!needle ||
          personKey(m.name).includes(needle) ||
          personKey(m.city).includes(needle) ||
          m.roleIds.some((id) => personKey(roleName(id)).includes(needle))) &&
        (roleFilter === ALL || (roleFilter === NO_ROLE ? m.roleIds.length === 0 : m.roleIds.includes(roleFilter)))
    )
    const byName = (a: CrewMember, b: CrewMember) => a.name.localeCompare(b.name, 'pl')
    const s = (m: CrewMember) => stats.get(m.id)
    const compare: Record<Sort, (a: CrewMember, b: CrewMember) => number> = {
      nazwa: byName,
      dni: (a, b) => (s(b)?.days ?? 0) - (s(a)?.days ?? 0) || byName(a, b),
      ostatnio: (a, b) => (s(b)?.lastDate ?? '').localeCompare(s(a)?.lastDate ?? '') || byName(a, b),
      wyplaty: (a, b) => (s(b)?.paidTotal ?? 0) - (s(a)?.paidTotal ?? 0) || byName(a, b),
    }
    return [...list].sort(compare[sort])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, query, roleFilter, sort, showRetired, stats, roles])

  const addUnknown = async (entry: UnknownCrewName) => {
    await addPerson({
      name: entry.name,
      roleIds: entry.roles.map((r) => crewRoleByName(roles, r)?.id).filter((id): id is string => !!id),
      rate: entry.lastRate > 0 ? entry.lastRate : undefined,
    })
  }

  const paidThisYear = [...stats.values()].reduce((sum, s) => sum + s.paidThisYear, 0)
  const daysThisYearPeople = ranking.length
  const top = ranking[0]

  const sheetMember =
    sheet?.type === 'person' && sheet.id ? (allPeople.find((m) => m.id === sheet.id && !m.deletedAt) ?? null) : null
  const sheetOpen = sheet?.type === 'roles' || (sheet?.type === 'person' && (sheet.id === null || sheetMember !== null))

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Ekipa</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Ludzie, z którymi pracuję — na planie i przy postprodukcji — z kontaktem, rolami i stawką. Ile razem
          przepracowaliśmy i ile wypłaciłem, liczy się z rzeczywistych kosztów ekipy w zakładce Realizacja
          (projekty w realizacji i zrealizowane).
        </p>
      </header>

      {notice && (
        <div
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
          role="status"
        >
          <span className="min-w-0 flex-1">{notice.message}</span>
          {notice.undoId && (
            <button
              type="button"
              onClick={async () => {
                const id = notice.undoId!
                setNotice(null)
                await restorePerson(id)
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

      {people.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile
            label="Ludzie"
            value={String(people.length - retiredCount)}
            sub={retiredCount > 0 ? `+ ${retiredCount} ${plural(retiredCount, 'wycofany', 'wycofanych', 'wycofanych')}` : `${activeRoles.length} ról`}
          />
          <Tile label={`Wypłacone w ${year}`} value={pln(paidThisYear)} sub={`${daysThisYearPeople} ${plural(daysThisYearPeople, 'osoba', 'osoby', 'osób')} z pracą w bazie`} />
          <Tile
            label="Najczęściej pracuję z"
            value={top ? top.member.name : '—'}
            sub={top ? `${top.stats.days} ${dayLabel(top.stats.days)} · ${top.stats.projects} proj.` : 'jeszcze brak pracy w projektach'}
          />
        </div>
      )}

      {ranking.length > 1 && (
        <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/30 px-4 py-3">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Najczęściej pracuję z…</h2>
          <ol className="flex flex-col gap-1">
            {ranking.slice(0, 5).map(({ member, stats: s }, index) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => setSheet({ type: 'person', id: member.id })}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left text-sm hover:bg-white/5"
                >
                  <span className="w-4 shrink-0 text-xs tabular-nums text-zinc-600">{index + 1}.</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{member.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {s.days} {dayLabel(s.days)} · {s.projects} proj. · ostatnio {formatDate(s.lastDate)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <UnknownNamesBanner
        names={unknown}
        onAdd={(entry) => void addUnknown(entry)}
        onAddAll={async () => {
          for (const entry of unknown) await addUnknown(entry)
        }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj osoby, roli, miasta"
            aria-label="Szukaj w Ekipie"
            className="h-9 border-white/10 bg-black/40 pl-8 text-sm"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filtr roli"
          className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200"
        >
          <option value={ALL}>Wszystkie role</option>
          {activeRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value={NO_ROLE}>Bez roli</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sortowanie"
          className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {retiredCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
              className="accent-emerald-500"
            />
            Pokaż wycofanych ({retiredCount})
          </label>
        )}
        <Button variant="outline" onClick={() => setSheet({ type: 'roles' })} className="h-9 border-white/10">
          Role
        </Button>
        <Button onClick={() => setSheet({ type: 'person', id: null })} className="h-9 gap-2">
          <Plus className="size-4" />
          Dodaj osobę
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : people.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-16 text-center">
          <Users className="size-8 text-zinc-700" />
          <p className="mt-3 max-w-sm text-sm text-zinc-500">
            Dodaj ludzi, z którymi pracujesz — z rolami, stawką i telefonem — żeby wybierać ich w zakładce Realizacja
            i widzieć, ile razem przepracowaliście.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.length === 0 && <p className="py-8 text-center text-sm text-zinc-600">Nic nie pasuje do filtrów.</p>}
          {visible.map((member) => {
            const s = stats.get(member.id)
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => setSheet({ type: 'person', id: member.id })}
                className={`flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3 text-left transition-colors hover:border-white/15 ${
                  member.retiredAt ? 'border-white/5 bg-zinc-900/20 opacity-60' : 'border-white/5 bg-zinc-900/40'
                }`}
              >
                <div className="min-w-[180px] flex-1">
                  <div className="truncate font-semibold text-zinc-100">
                    {member.name}
                    {member.retiredAt && (
                      <span className="ml-2 rounded bg-zinc-800 px-1.5 py-px text-[10px] font-normal text-zinc-400">
                        wycofany
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {member.roleIds.length > 0 ? member.roleIds.map(roleName).join(', ') : 'bez roli'}
                    {member.city ? ` · ${member.city}` : ''}
                  </div>
                </div>
                <div className="w-36 shrink-0 truncate text-xs text-zinc-500">
                  {member.contact?.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" />
                      {member.contact.phone}
                    </span>
                  ) : (
                    member.contact?.email || <span className="text-zinc-700">bez kontaktu</span>
                  )}
                </div>
                <div className="w-36 shrink-0 text-xs text-zinc-500">
                  {!s || s.projects === 0 ? (
                    'jeszcze bez pracy'
                  ) : (
                    <>
                      <div>
                        {s.projects} proj. · {s.days} {dayLabel(s.days)}
                      </div>
                      <div className="text-zinc-600">ostatnio {formatDate(s.lastDate)}</div>
                    </>
                  )}
                </div>
                <div className="w-28 shrink-0 text-right tabular-nums">
                  <div className="text-sm font-semibold text-zinc-100">{s ? pln(s.paidTotal) : pln(0)}</div>
                  <div className="text-xs text-zinc-500">{member.rate ? `${pln(member.rate)}/dzień` : 'stawka —'}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            if (sheet?.type === 'person' && sheet.id) e.preventDefault()
          }}
          className="overflow-y-auto border-l border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-2xl sm:max-w-md"
        >
          <SheetTitle className="sr-only">
            {sheet?.type === 'roles' ? 'Role' : sheetMember ? sheetMember.name : 'Nowa osoba'}
          </SheetTitle>
          {sheet?.type === 'roles' && <CrewRolesSheet />}
          {sheet?.type === 'person' && sheetOpen && (
            <CrewPersonSheet
              key={sheet.id ?? 'new'}
              member={sheetMember}
              stats={sheetMember ? stats.get(sheetMember.id) : undefined}
              onClose={() => setSheet(null)}
              onDeleted={(member) => {
                setSheet(null)
                setNotice({ message: `Usunięto „${member.name}" z Ekipy.`, undoId: member.id })
              }}
              onOpenProject={onOpenProject}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
