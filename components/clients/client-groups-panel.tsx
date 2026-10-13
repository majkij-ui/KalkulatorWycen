'use client'

/**
 * Grupy klientów na ekranie „Klienci" (S2, decyzja D):
 *  - `GroupMembersPanel` — strona grupy: członkowie (klik otwiera ich stronę,
 *    ✕ wyjmuje z grupy), dodawanie klientów (z innej grupy są przenoszeni),
 *    podobne nazwy poza grupą, zmiana nazwy i rozwiązanie grupy;
 *  - `ClientGroupBox` — strona klienta: do jakiej grupy należy, „poza grupą"
 *    przy nowej pisowni podobnej do członka, „Dodaj do grupy…".
 * Logika: `lib/client-groups.ts`; zapis: `useClientGroups` w sekcji.
 */

import { useMemo, useState } from 'react'
import { ArrowUpRight, Layers, Pencil, Plus, Search, X } from 'lucide-react'
import { clientKey, type ClientInfo } from '@/lib/clients'
import { groupMemberKeys, groupOfClient, groupStrays, strayGroup, type ClientGroup } from '@/lib/client-groups'
import type { GroupMemberSummary } from '@/lib/client-stats'
import { plural } from '@/lib/pl-plural'
import { mono } from '@/components/calendar/calendar-bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate, pln } from './client-bits'

export interface GroupActions {
  createGroup: (name: string, members: string[]) => Promise<ClientGroup | null>
  renameGroup: (id: string, name: string) => Promise<void>
  addMembers: (id: string, keys: string[]) => Promise<void>
  removeMember: (id: string, key: string) => Promise<void>
  dissolveGroup: (group: ClientGroup) => Promise<void>
}

/** Wybór klienta do dodania: szukanie po nazwie; klient z innej grupy jest podpisany. */
function ClientSearch({
  directory,
  groups,
  exclude,
  onPick,
  placeholder,
}: {
  directory: ClientInfo[]
  groups: ClientGroup[]
  exclude: Set<string>
  onPick: (client: ClientInfo) => void
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const q = clientKey(query)
  const shown = directory.filter((c) => !exclude.has(c.key) && (!q || c.key.includes(q))).slice(0, q ? 12 : 0)
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 border-white/10 bg-black/40 pl-8 text-sm"
        />
      </div>
      {q && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {shown.length === 0 && <li className="px-2 py-1 text-xs text-zinc-600">Nikt nie pasuje.</li>}
          {shown.map((c) => {
            const other = groupOfClient(groups, c.key)
            return (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(c)
                    setQuery('')
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Plus className="size-3.5 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{c.name}</span>
                  {other && (
                    <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300/90">
                      przeniesie z „{other.name}"
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-zinc-500">{c.projectCount} proj.</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function GroupMembersPanel({
  group,
  members,
  groups,
  directory,
  actions,
  onOpenClient,
}: {
  group: ClientGroup
  members: GroupMemberSummary[]
  groups: ClientGroup[]
  directory: ClientInfo[]
  actions: GroupActions
  onOpenClient: (key: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(group.name)
  const [confirmDissolve, setConfirmDissolve] = useState(false)
  const memberKeys = useMemo(() => new Set(groupMemberKeys(group)), [group])
  const strays = useMemo(() => groupStrays(groups, group, directory), [groups, group, directory])

  const saveName = async () => {
    if (name.trim() && name.trim() !== group.name) await actions.renameGroup(group.id, name)
    setRenaming(false)
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          Klienci w grupie ({members.length})
        </h2>
        {!renaming && (
          <button
            type="button"
            onClick={() => {
              setName(group.name)
              setRenaming(true)
            }}
            className="flex items-center gap-1 rounded-md text-[11px] text-zinc-500 outline-none hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Pencil className="size-3" />
            Zmień nazwę grupy
          </button>
        )}
      </div>

      {renaming && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName()
              if (e.key === 'Escape') setRenaming(false)
            }}
            aria-label="Nazwa grupy"
            className="h-9 min-w-[200px] flex-1 border-white/10 bg-black/40 text-sm"
          />
          <Button size="sm" className="h-9" onClick={saveName} disabled={!name.trim()}>
            Zapisz
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setRenaming(false)}>
            Anuluj
          </Button>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {members.map((m) => (
          <li key={m.key} className="flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/40 px-3 py-2">
            <button
              type="button"
              disabled={m.empty}
              onClick={() => onOpenClient(m.key)}
              className="group flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${m.empty ? 'text-zinc-500' : 'text-zinc-200'}`}>{m.name}</div>
                <div className="text-[11px] text-zinc-500">
                  {m.empty
                    ? 'brak projektów z tą nazwą — zmieniona pisownia albo usunięte projekty'
                    : `${m.projectCount} ${plural(m.projectCount, 'projekt', 'projekty', 'projektów')} · ${m.jobCount} ${plural(m.jobCount, 'zlecenie', 'zlecenia', 'zleceń')} · ostatni ${formatDate(m.lastDate)}`}
                </div>
              </div>
              {!m.empty && (
                <span className="shrink-0 text-sm text-zinc-200" style={mono}>
                  {pln(m.revenue)}
                </span>
              )}
              {!m.empty && <ArrowUpRight className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />}
            </button>
            <button
              type="button"
              onClick={() => actions.removeMember(group.id, m.key)}
              aria-label={`Wyjmij z grupy: ${m.name}`}
              title="Wyjmij z grupy (klient i jego projekty zostają)"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-600 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {members.length < 2 && (
        <p className="text-[11px] text-zinc-500">Grupa ma sens od dwóch klientów — dodaj kolejnego poniżej.</p>
      )}

      {strays.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2" role="status">
          <div className="text-xs text-amber-100/90">Podobne nazwy poza grupą — zwykle nowa pisownia wpisana w projekcie:</div>
          <ul className="mt-1 flex flex-col gap-1">
            {strays.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => onOpenClient(c.key)}
                  className="min-w-0 truncate text-left text-zinc-200 underline-offset-2 outline-none hover:underline focus-visible:underline"
                >
                  {c.name}
                </button>
                <span className="text-xs text-zinc-500">{c.projectCount} proj.</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-white/10 text-xs"
                  onClick={() => actions.addMembers(group.id, [c.key])}
                >
                  Dodaj do grupy
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ClientSearch
        directory={directory}
        groups={groups}
        exclude={memberKeys}
        onPick={(c) => actions.addMembers(group.id, [c.key])}
        placeholder="Dodaj klienta do grupy"
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        {confirmDissolve ? (
          <>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => actions.dissolveGroup(group)}>
              Rozwiąż „{group.name || 'grupę'}"
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setConfirmDissolve(false)}>
              Anuluj
            </Button>
            <p className="w-full text-[11px] text-zinc-500">
              Klienci i ich projekty zostają, znika tylko grupa. Da się to cofnąć.
            </p>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-zinc-500 hover:text-red-300"
            onClick={() => setConfirmDissolve(true)}
          >
            Rozwiąż grupę
          </Button>
        )}
      </div>
    </section>
  )
}

/** Strona klienta: grupa, „poza grupą", „Dodaj do grupy…". */
export function ClientGroupBox({
  clientKeyValue,
  clientName,
  groups,
  actions,
  onOpenGroup,
}: {
  clientKeyValue: string
  clientName: string
  groups: ClientGroup[]
  actions: GroupActions
  onOpenGroup: (group: ClientGroup) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const own = groupOfClient(groups, clientKeyValue)
  const stray = own ? null : strayGroup(groups, clientKeyValue)

  if (own) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-white/5 bg-zinc-900/30 px-4 py-2.5 text-sm">
        <Layers className="size-4 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 text-zinc-300">
          W grupie <span className="font-semibold text-zinc-100">„{own.name}"</span>
          <span className="text-zinc-500"> · statystyki grupy liczą wszystkich członków</span>
        </span>
        <Button size="sm" variant="outline" className="h-7 border-white/10 text-xs" onClick={() => onOpenGroup(own)}>
          Strona grupy
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-zinc-500"
          onClick={() => actions.removeMember(own.id, clientKeyValue)}
        >
          Wyjmij z grupy
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {stray && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm"
          role="status"
        >
          <Layers className="size-4 shrink-0 text-amber-300/80" />
          <span className="min-w-0 flex-1 text-amber-100/90">
            Poza grupą „{stray.name}" — nazwa podobna do jej członka. Liczy się osobno, dopóki go nie dodasz (albo nie
            scalisz nazw).
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-white/10 text-xs"
            onClick={() => actions.addMembers(stray.id, [clientKeyValue])}
          >
            Dodaj do grupy
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpenGroup(stray)}>
            Strona grupy
          </Button>
        </div>
      )}
      {adding ? (
        <div className="flex flex-col gap-2 rounded-xl border border-white/5 bg-zinc-900/30 p-3">
          <div className="text-[11px] text-zinc-500">Dodaj „{clientName}" do grupy</div>
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <Button
                  key={g.id}
                  size="sm"
                  variant="outline"
                  className="h-7 border-white/10 text-xs"
                  onClick={async () => {
                    await actions.addMembers(g.id, [clientKeyValue])
                    setAdding(false)
                  }}
                >
                  {g.name || 'Grupa bez nazwy'}
                </Button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`Nowa grupa, np. „${clientName} + …"`}
              aria-label="Nazwa nowej grupy"
              className="h-8 min-w-[200px] flex-1 border-white/10 bg-black/40 text-sm"
            />
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!newName.trim()}
              onClick={async () => {
                const created = await actions.createGroup(newName, [clientKeyValue])
                setAdding(false)
                setNewName('')
                if (created) onOpenGroup(created)
              }}
            >
              Utwórz grupę
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAdding(false)}>
              Anuluj
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-fit items-center gap-1.5 rounded-md text-xs font-medium text-zinc-500 outline-none hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="Dodaj do grupy klientów"
          title="Kilku klientów, którzy są jednym (np. spółki jednej grupy) — w statystykach i filtrach liczą się razem"
        >
          <Layers className="size-3.5" />
          Dodaj do grupy klientów…
        </button>
      )}
    </div>
  )
}
