'use client'

/**
 * Sekcja „Klienci" (T10): lista klientów i strona każdego z nich.
 *
 * Klient nie ma własnego rekordu (plan §3.2a, decyzja 3) — to grupa projektów
 * o tym samym `clientKey`, a każda liczba jest wyliczana na bieżąco z projektów
 * i wydarzeń (`client-stats.ts`); kwoty to najlepsza wiedza z pętli pieniędzy
 * (T6), jak w Finansach. Zapisy: „Scal nazwy" (przepisanie pola `client` w
 * projektach, z „Cofnij") i grupy klientów (S2, `client-groups.json`): grupa
 * to jeden wiersz listy z członkami w środku i własna strona ze statystykami
 * wszystkich członków.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, BellRing, Handshake, Layers, Loader2, Repeat, Search } from 'lucide-react'
import { useEvents } from '@/lib/events-context'
import { useCrew } from '@/lib/crew-context'
import { crewOnProjects } from '@/lib/crew-stats'
import { useProjectHub } from '@/lib/project-hub-context'
import { useClientGroups } from '@/lib/use-client-groups'
import { useProjectMoney } from '@/lib/use-project-money'
import {
  CLIENT_SORTS,
  CLIENT_SORT_LABELS,
  clientListRows,
  clientStats,
  groupStats,
  listClientRows,
  totalRevenue,
  type ClientListRow,
  type ClientSort,
  type ClientSummary,
} from '@/lib/client-stats'
import { mergePatches, undoMergePatches, type ClientMergePlan } from '@/lib/client-merge'
import { moneyOf } from '@/lib/client-money'
import {
  clientScope,
  groupScopeValue,
  isGroupScope,
  scopeKeys,
  type ClientGroup,
  type GroupMembershipChange,
} from '@/lib/client-groups'
import { clientDirectory, clientKey } from '@/lib/clients'
import { countsTowardRevenue, toDateKey } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { archivo, mono } from '@/components/calendar/calendar-bits'
import { Input } from '@/components/ui/input'
import { Tile, formatDate, pct, pln } from './client-bits'
import { ClientPage } from './client-page'
import type { GroupActions } from './client-groups-panel'

const SORT_KEY = 'nonoise-clients-sort-v1'

function readSort(): ClientSort {
  try {
    const raw = localStorage.getItem(SORT_KEY)
    return (CLIENT_SORTS as readonly string[]).includes(raw ?? '') ? (raw as ClientSort) : 'przychod'
  } catch {
    return 'przychod'
  }
}

function ClientRow({ client, onOpen }: { client: ClientSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3 text-left transition-colors hover:border-white/15"
    >
      <div className="min-w-[180px] flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-zinc-100">{client.name}</span>
          {client.repeat && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] text-emerald-300">
              <Repeat className="size-3" />
              wraca
            </span>
          )}
          {client.nudge && (
            <span
              className="flex shrink-0 items-center gap-1 rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300/90"
              title="Przerwa dużo dłuższa niż zwykle"
            >
              <BellRing className="size-3" />
              dawno bez zlecenia
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {client.projectCount} {plural(client.projectCount, 'projekt', 'projekty', 'projektów')}
          {' · '}
          {client.jobCount} {plural(client.jobCount, 'zlecenie', 'zlecenia', 'zleceń')}
        </div>
      </div>
      <div className="w-28 shrink-0 text-xs text-zinc-500">
        <div className="text-[10px] uppercase tracking-wide text-zinc-600">ostatni projekt</div>
        <div style={mono}>{formatDate(client.lastDate)}</div>
      </div>
      <div
        className={`w-28 shrink-0 text-right text-sm ${client.revenue > 0 ? 'font-semibold text-zinc-100' : 'text-zinc-600'}`}
        style={mono}
      >
        {pln(client.revenue)}
      </div>
      <ArrowUpRight className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />
    </button>
  )
}

/** Grupa: jeden wiersz z liczbami wszystkich członków, a w środku członkowie (każdy ze swoją stroną). */
function GroupRow({
  row,
  onOpen,
  onOpenMember,
}: {
  row: Extract<ClientListRow, { kind: 'group' }>
  onOpen: () => void
  onOpenMember: (key: string) => void
}) {
  const { summary, members } = row
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 transition-colors hover:border-white/15">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-2 pt-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <div className="min-w-[180px] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Layers className="size-4 shrink-0 text-zinc-500" />
            <span className="min-w-0 max-w-full truncate font-semibold text-zinc-100">{summary.name}</span>
            <span className="shrink-0 rounded bg-white/5 px-1.5 py-px text-[10px] text-zinc-400">
              grupa · {members.length} {plural(members.length, 'klient', 'klientów', 'klientów')}
            </span>
            {summary.repeat && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] text-emerald-300">
                <Repeat className="size-3" />
                wraca
              </span>
            )}
            {summary.nudge && (
              <span
                className="flex shrink-0 items-center gap-1 rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300/90"
                title="Przerwa dużo dłuższa niż zwykle"
              >
                <BellRing className="size-3" />
                dawno bez zlecenia
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {summary.projectCount} {plural(summary.projectCount, 'projekt', 'projekty', 'projektów')}
            {' · '}
            {summary.jobCount} {plural(summary.jobCount, 'zlecenie', 'zlecenia', 'zleceń')}
          </div>
        </div>
        <div className="w-28 shrink-0 text-xs text-zinc-500">
          <div className="text-[10px] uppercase tracking-wide text-zinc-600">ostatni projekt</div>
          <div style={mono}>{formatDate(summary.lastDate)}</div>
        </div>
        <div
          className={`w-28 shrink-0 text-right text-sm ${summary.revenue > 0 ? 'font-semibold text-zinc-100' : 'text-zinc-600'}`}
          style={mono}
        >
          {pln(summary.revenue)}
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />
      </button>
      <ul className="flex flex-col border-t border-white/5 px-2 py-1.5 sm:pl-10">
        {members.map((m) => (
          <li key={m.key}>
            <button
              type="button"
              disabled={m.empty}
              onClick={() => onOpenMember(m.key)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1 text-left text-xs outline-none enabled:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <span className={`min-w-0 flex-1 truncate ${m.empty ? 'text-zinc-600' : 'text-zinc-300'}`}>{m.name}</span>
              <span className="shrink-0 text-zinc-500">
                {m.empty ? 'brak projektów' : `${m.projectCount} proj. · ${m.jobCount} ${plural(m.jobCount, 'zlecenie', 'zlecenia', 'zleceń')}`}
              </span>
              <span className="w-24 shrink-0 text-right text-zinc-300" style={mono}>
                {m.empty ? '' : pln(m.revenue)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface MergeNotice {
  kind: 'merge'
  plan: ClientMergePlan
  /** Zmiany członkostwa w grupach — „Cofnij" je odwraca. */
  groupChanges: GroupMembershipChange[]
  /** Strona, z której scalano — „Cofnij" na nią wraca. */
  fromKey: string
  /** Klient zapamiętany w filtrze listy projektów przed scaleniem. */
  listClient: string
}

interface GroupNotice {
  kind: 'dissolve'
  group: ClientGroup
  at: string
}

type Notice = MergeNotice | GroupNotice

export function ClientsSection({
  onOpenProject,
  initialKey = null,
}: {
  onOpenProject?: (id: string) => void
  /** Strona klienta do otwarcia od razu (np. z nagłówka projektu). */
  initialKey?: string | null
}) {
  const today = toDateKey(new Date())
  const { projects, isLoading, updateProjects, listClient, setListClient } = useProjectHub()
  const { events } = useEvents()
  const { allPeople } = useCrew()
  const money = useProjectMoney()
  const {
    groups,
    isLoading: groupsLoading,
    createGroup,
    renameGroup,
    addMembers,
    removeMember,
    dissolveGroup,
    restoreGroup,
    followClientMerge,
    undoClientMerge,
  } = useClientGroups()

  const [openKey, setOpenKey] = useState<string | null>(initialKey)
  const [query, setQuery] = useState('')
  const [sort, setSortState] = useState<ClientSort>(readSort)
  const [notice, setNotice] = useState<Notice | null>(null)

  const setSort = (next: ClientSort) => {
    setSortState(next)
    try {
      localStorage.setItem(SORT_KEY, next)
    } catch {
      // tylko wygoda — bez zapisu lista wróci do sortowania po przychodzie
    }
  }

  const rows = useMemo(() => clientListRows(projects, groups, today, money), [projects, groups, today, money])
  const visible = useMemo(() => listClientRows(rows, sort, query), [rows, sort, query])
  const directory = useMemo(() => clientDirectory(projects), [projects])
  const openGroup = useMemo(() => {
    const scope = clientScope(openKey, groups)
    return scope?.kind === 'group' ? scope.group : null
  }, [openKey, groups])
  const stats = useMemo(() => {
    if (!openKey) return null
    if (isGroupScope(openKey)) return openGroup ? groupStats(projects, events, openGroup, today, money) : null
    return clientStats(projects, events, openKey, today, money)
  }, [projects, events, openKey, openGroup, today, money])
  // Kto pracował przy zleceniach tego klienta albo grupy (rzeczywiste koszty ekipy, T9a).
  const crew = useMemo(() => {
    const keys = scopeKeys(openKey, groups)
    return keys
      ? crewOnProjects(
          allPeople,
          projects.filter((p) => keys.has(clientKey(p.client ?? ''))),
          { events }
        )
      : null
  }, [allPeople, projects, events, openKey, groups])

  // Klient zniknął (scalony gdzie indziej, projekty usunięte, grupa rozwiązana) → wracamy do listy.
  useEffect(() => {
    if (openKey && !isLoading && !groupsLoading && !stats) setOpenKey(null)
  }, [openKey, isLoading, groupsLoading, stats])

  const totals = useMemo(() => {
    const all = totalRevenue(projects, null, money)
    const summaries: ClientSummary[] = rows.map((r) => r.summary)
    const repeatRevenue = summaries.filter((c) => c.repeat).reduce((sum, c) => sum + c.revenue, 0)
    const noClient = projects.filter((p) => countsTowardRevenue(p.status) && !clientKey(p.client ?? ''))
    return {
      clients: summaries.length,
      groups: rows.filter((r) => r.kind === 'group').length,
      withJobs: summaries.filter((c) => c.jobCount > 0).length,
      repeat: summaries.filter((c) => c.repeat).length,
      repeatSharePct: all > 0 ? (repeatRevenue / all) * 100 : null,
      clientRevenue: summaries.reduce((sum, c) => sum + c.revenue, 0),
      noClientJobs: noClient.length,
      noClientRevenue: noClient.reduce((sum, p) => sum + (moneyOf(p, money).revenue ?? 0), 0),
      nudges: summaries.filter((c) => c.nudge).length,
    }
  }, [projects, rows, money])

  const open = (key: string | null) => {
    setOpenKey(key)
    window.scrollTo({ top: 0 })
  }

  const groupActions: GroupActions = {
    createGroup,
    renameGroup,
    addMembers,
    removeMember,
    dissolveGroup: async (group) => {
      const at = await dissolveGroup(group.id)
      setNotice({ kind: 'dissolve', group, at })
      // Strona grupy znika — wracamy do listy (efekt wyżej zrobiłby to samo po chwili).
      if (openKey === groupScopeValue(group.id)) open(null)
    },
  }

  // Klucz strony zmieniamy w tym samym takcie co projekty (`updateProjects` zmienia
  // je od razu, przed zapisem) — inaczej strona na chwilę „gubi" klienta i wraca do listy.
  const merge = async (plan: ClientMergePlan) => {
    const fromKey = openKey ?? plan.targetKey
    const previousListClient = listClient
    setOpenKey(plan.targetKey)
    // Filtr listy projektów wskazywał scalonego klienta → niech wskazuje wynik scalenia.
    if (listClient && plan.keys.includes(listClient)) setListClient(plan.targetKey)
    await updateProjects(mergePatches(plan).map(({ id, client }) => ({ id, patch: { client } })))
    // Członkostwo w grupach idzie za nową nazwą (S2).
    const groupChanges = await followClientMerge(plan)
    setNotice({ kind: 'merge', plan, groupChanges, fromKey, listClient: previousListClient })
  }

  const undo = async () => {
    if (!notice) return
    setNotice(null)
    if (notice.kind === 'dissolve') {
      await restoreGroup(notice.group.id, notice.at)
      return
    }
    setOpenKey(notice.fromKey)
    setListClient(notice.listClient)
    await updateProjects(undoMergePatches(projects, notice.plan).map(({ id, client }) => ({ id, patch: { client } })))
    await undoClientMerge(notice.groupChanges)
  }

  const noticeBar = notice && (
    <div
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
      role="status"
    >
      <span className="min-w-0 flex-1">
        {notice.kind === 'merge' ? (
          <>
            Scalono: klient „{notice.plan.target}" w {notice.plan.changes.length}{' '}
            {plural(notice.plan.changes.length, 'projekcie', 'projektach', 'projektach')}
            {notice.groupChanges.length > 0 && ' (grupa klientów idzie za nową nazwą)'}.
          </>
        ) : (
          <>Rozwiązano grupę „{notice.group.name}". Klienci i ich projekty zostały.</>
        )}
      </span>
      <button
        type="button"
        onClick={undo}
        className="font-semibold text-primary outline-none hover:underline focus-visible:underline"
      >
        Cofnij
      </button>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="font-semibold text-zinc-500 outline-none hover:text-zinc-200 focus-visible:underline"
      >
        OK
      </button>
    </div>
  )

  if (stats) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        {noticeBar}
        <ClientPage
          stats={stats}
          projects={projects}
          money={money}
          crew={crew}
          groups={groups}
          directory={directory}
          groupActions={groupActions}
          onBack={() => open(null)}
          onOpenProject={onOpenProject}
          onOpenClient={(key) => open(key)}
          onOpenGroup={(group) => open(groupScopeValue(group.id))}
          onMerge={merge}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white" style={archivo}>
          Klienci
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Klienci z Twoich projektów: ile przynieśli, jak często wracają i czy zlecenia rosną. Nazwy różniące się
          wielkością liter lub polskimi znakami to jeden klient, a grupa (np. spółki jednej firmy) liczy się jak
          jeden. Przychód liczy się jak w Finansach — projekty w realizacji i zakończone, z faktur, a bez nich z
          planu.
        </p>
      </header>

      {noticeBar}

      {rows.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Klienci"
            value={String(totals.clients)}
            lines={[
              `${totals.withJobs} ze zleceniem`,
              totals.groups > 0 ? `w tym ${totals.groups} ${plural(totals.groups, 'grupa', 'grupy', 'grup')}` : '',
            ]}
          />
          <Tile
            label="Wracają"
            value={String(totals.repeat)}
            good={totals.repeat > 0}
            lines={[
              totals.repeatSharePct === null ? '2+ zlecenia' : `${pct(totals.repeatSharePct)} przychodu firmy`,
            ]}
          />
          <Tile
            label="Przychód od klientów"
            value={pln(totals.clientRevenue)}
            lines={['w realizacji i zakończone']}
            warn={
              totals.noClientJobs > 0
                ? `+${pln(totals.noClientRevenue)} w ${totals.noClientJobs} ${plural(totals.noClientJobs, 'zleceniu', 'zleceniach', 'zleceniach')} bez klienta`
                : undefined
            }
          />
          <Tile
            label="Dawno bez zlecenia"
            value={String(totals.nudges)}
            lines={['przerwa dużo dłuższa niż zwykle']}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj klienta"
            aria-label="Szukaj klienta"
            className="h-9 border-white/10 bg-black/40 pl-8 text-sm"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ClientSort)}
          aria-label="Sortowanie"
          className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200"
        >
          {CLIENT_SORTS.map((s) => (
            <option key={s} value={s}>
              {CLIENT_SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-16 text-center">
          <Handshake className="size-8 text-zinc-700" />
          <p className="mt-3 max-w-sm text-sm text-zinc-500">
            Klienci pojawią się tutaj, gdy wpiszesz ich w projektach (pole „Klient" w nagłówku projektu).
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-600">Nic nie pasuje do wyszukiwania.</p>
          )}
          {visible.map((row) =>
            row.kind === 'group' ? (
              <GroupRow
                key={row.summary.key}
                row={row}
                onOpen={() => open(row.summary.key)}
                onOpenMember={(key) => open(key)}
              />
            ) : (
              <ClientRow key={row.summary.key} client={row.summary} onOpen={() => open(row.summary.key)} />
            )
          )}
        </div>
      )}
    </div>
  )
}
