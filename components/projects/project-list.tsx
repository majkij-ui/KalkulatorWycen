'use client'

/**
 * Lista projektów — punkt wyjścia całej apki po przebudowie.
 *
 * Chronologicznie (najnowsze u góry), ze statusem oznaczonym kolorem i trzema
 * filtrami z notatek: wszystko / tylko projekty / tylko wyceny. Nieprzyjęte
 * wyceny są domyślnie ukryte (przełącznik obok filtrów), a gdy są widoczne,
 * ich kwoty są szare — nie liczą się do wyników firmy. Do tego klient (z jego
 * przychodem) i rok — wybór zapamiętuje się między uruchomieniami.
 *
 * Usunięcie jest miękkie i zabiera ze sobą wątek projektu; „Cofnij" przywraca
 * jedno i drugie (`use-project-deletion.ts`).
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, FolderPlus, Loader2, PackageOpen, Search, Trash2, X } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import {
  PROJECT_FILTERS,
  countsTowardRevenue,
  leadSourceLabel,
  type Project,
  type ProjectFilter,
} from '@/lib/project-types'
import { clientDirectory, clientRevenue } from '@/lib/clients'
import { filterProjectList, lostInScope, projectYears } from '@/lib/project-list'
import { ProjectStatusBadge } from './project-status-badge'
import { PaidToggle } from './paid-toggle'
import { ClientCombobox } from './client-combobox'
import { useProjectDeletion } from './use-project-deletion'
import { itemLabel, plural } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const FILTER_LABELS: Record<ProjectFilter, string> = {
  all: 'Wszystko',
  projects: 'Tylko projekty',
  quotes: 'Tylko wyceny',
}

function formatPln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

/** Baner migracji — pokazywany tylko, gdy są stare wyceny do przeniesienia. */
function MigrationBanner() {
  const { pendingQuoteCount, runMigration } = useProjectHub()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (pendingQuoteCount === 0 && !message) return null

  const handleMigrate = async () => {
    setBusy(true)
    const result = await runMigration()
    setBusy(false)
    if (result.status === 'migrated') {
      setMessage(
        `Przeniesiono ${result.migratedCount} wycen. Kopia zapasowa: ${result.backupLocation}`
      )
    } else if (result.status === 'aborted-no-backup') {
      setMessage('Nie udało się zapisać kopii zapasowej — migracja przerwana, dane nietknięte.')
    } else {
      setMessage('Nie było nic do przeniesienia.')
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      {message ? (
        <p className="text-sm text-amber-200/90">{message}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-amber-200">
              Znaleziono {pendingQuoteCount} zapisanych wycen
            </p>
            <p className="mt-0.5 text-xs text-amber-200/70">
              Przeniesiemy je do listy projektów jako wyceny. Oryginalna biblioteka zostaje
              nietknięta, a przed zapisem powstaje kopia zapasowa.
            </p>
          </div>
          <Button onClick={handleMigrate} disabled={busy} className="shrink-0 gap-2">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Przenieś do projektów
          </Button>
        </div>
      )}
    </div>
  )
}

function ProjectRow({
  project,
  onOpen,
  onDeleted,
}: {
  project: Project
  onOpen: () => void
  onDeleted: (deleted: { project: Project; eventCount: number }) => void
}) {
  const { describe, deleteWithThread } = useProjectDeletion()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Zmigrowane wyceny nie mają jeszcze policzonych finansów. Pokazujemy „—",
  // nie „0 zł" — zero to konkretna informacja, a tu jej po prostu nie ma.
  const financials = project.financials
  const zysk = financials?.zysk ?? 0
  // Pełny kolor i pogrubienie tylko dla kwot, które się liczą: projekt
  // zatwierdzony („W realizacji") albo zrealizowany. Otwarta wycena to jeszcze
  // obietnica (szara), nieprzyjęta — archiwum (jeszcze ciemniejsza).
  const counts = countsTowardRevenue(project.status)
  const amountTone = counts ? 'font-semibold text-zinc-100' : project.status === 'lost' ? 'text-zinc-600' : 'text-zinc-500'
  const profitTone = counts
    ? zysk >= 0
      ? 'text-emerald-400/80'
      : 'text-red-400/80'
    : project.status === 'lost'
      ? 'text-zinc-600'
      : 'text-zinc-500'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group rounded-xl border px-4 py-3 transition-colors ${
        confirmDelete
          ? 'border-red-500/25 bg-red-500/[0.04]'
          : 'border-white/5 bg-zinc-900/40 hover:border-white/15 hover:bg-zinc-900/70'
      }`}
    >
      <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-zinc-100">{project.name}</span>
            <ProjectStatusBadge status={project.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span>{formatDate(project.date)}</span>
            {project.client && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{project.client}</span>
              </>
            )}
            {project.leadSource && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 text-zinc-400">{leadSourceLabel(project.leadSource)}</span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          {financials ? (
            <>
              <div className={`tabular-nums ${amountTone}`}>{formatPln(financials.sumaNetto)}</div>
              <div className={`text-[11px] tabular-nums ${profitTone}`}>
                zysk {formatPln(zysk)}
              </div>
            </>
          ) : (
            <>
              <div className="text-zinc-600">—</div>
              <div className="text-[11px] text-zinc-600">{project.quote ? 'nie policzono' : 'brak wyceny'}</div>
            </>
          )}
        </div>
      </button>

      {/* Stała szerokość także bez przełącznika — kwoty zostają w jednej kolumnie. */}
      <div className="flex w-[132px] shrink-0 justify-start">{counts && <PaidToggle project={project} />}</div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Usuń projekt ${project.name}`}
          className={`rounded-md p-1.5 text-zinc-600 transition-opacity hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 ${
            confirmDelete ? 'invisible' : 'opacity-0'
          }`}
        >
          <Trash2 className="size-4" />
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Otwórz projekt ${project.name}`}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:text-white"
        >
          <ArrowRight className="size-4" />
        </button>
      </div>
      </div>

      {confirmDelete && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-red-500/15 pt-3 text-xs" role="alert">
          <span className="min-w-0 flex-1 text-zinc-300">
            Usunąć „{project.name}"? {describe(project.id) ?? 'Projekt nie ma wydarzeń w kalendarzu.'}{' '}
            <span className="text-zinc-500">Można cofnąć.</span>
          </span>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true)
              const deleted = await deleteWithThread(project.id)
              setDeleting(false)
              if (deleted) onDeleted(deleted)
            }}
          >
            {deleting && <Loader2 className="size-3 animate-spin" />}
            Usuń
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmDelete(false)}>
            Anuluj
          </Button>
        </div>
      )}
    </motion.div>
  )
}

/** „Usunięto … Cofnij" — usunięcie zabiera wątek, cofnięcie przywraca oba. */
function DeletedBanner({
  deleted,
  onClose,
}: {
  deleted: { project: Project; eventCount: number }
  onClose: () => void
}) {
  const { undoDelete } = useProjectDeletion()
  const [busy, setBusy] = useState(false)
  const { project, eventCount } = deleted
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
      role="status"
    >
      <span className="min-w-0 flex-1">
        Usunięto „{project.name}"
        {eventCount > 0 && ` i ${eventCount} ${plural(eventCount, 'wydarzenie', 'wydarzenia', 'wydarzeń')} z kalendarza`}.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await undoDelete(project)
          onClose()
        }}
        className="font-semibold text-primary outline-none hover:underline focus-visible:underline disabled:opacity-50"
      >
        Cofnij
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Zamknij"
        className="rounded p-0.5 text-zinc-500 outline-none hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function ProjectList() {
  const {
    projects,
    filter,
    setFilter,
    hideLost,
    setHideLost,
    listClient,
    setListClient,
    listYear,
    setListYear,
    openProject,
    createBlankProject,
    isLoading,
  } = useProjectHub()
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleted, setDeleted] = useState<{ project: Project; eventCount: number } | null>(null)

  const directory = useMemo(() => clientDirectory(projects), [projects])
  const years = useMemo(() => projectYears(projects), [projects])
  // Zapamiętany klient, którego już nie ma (zmiana nazwy, usunięcie) — lista pokazuje wszystkich.
  const selectedClient = directory.find((c) => c.key === listClient) ?? null
  const year = listYear !== null && years.includes(listYear) ? listYear : null
  const query = { filter, hideLost, client: selectedClient?.key ?? '', year, search }
  const rows = filterProjectList(projects, query)
  const lostCount = lostInScope(projects, query)
  const revenue = selectedClient ? clientRevenue(projects, selectedClient.key, year) : null
  const narrowed = !!selectedClient || year !== null || !!search.trim()

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    await createBlankProject(name)
    setNewName('')
    setCreating(false)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Projekty</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {projects.length === 0
            ? 'Nic tu jeszcze nie ma.'
            : `${projects.length} ${itemLabel(projects.length)} w archiwum`}
        </p>
      </header>

      <MigrationBanner />

      {deleted && <DeletedBanner key={deleted.project.id} deleted={deleted} onClose={() => setDeleted(null)} />}

      {/* Filtry: status, nieprzyjęte, klient, rok, wyszukiwarka */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-white/10 bg-black/40 p-0.5">
          {PROJECT_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {FILTER_LABELS[value]}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200">
          <input
            type="checkbox"
            checked={hideLost}
            onChange={(e) => setHideLost(e.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Ukryj nieprzyjęte
          {lostCount > 0 && <span className="tabular-nums text-zinc-600">({lostCount})</span>}
        </label>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ClientCombobox
          value={selectedClient?.name ?? ''}
          directory={directory}
          onCommit={(_, picked) => setListClient(picked?.key ?? '')}
          placeholder="Wszyscy klienci"
          ariaLabel="Filtr klienta"
          className="w-56"
        />

        <select
          value={year ?? ''}
          onChange={(e) => setListYear(e.target.value ? Number(e.target.value) : null)}
          aria-label="Filtr roku"
          className={`h-8 rounded-md border border-white/10 bg-black/40 px-2 text-sm outline-none [color-scheme:dark] focus:border-white/30 ${
            year === null ? 'text-zinc-500' : 'text-zinc-200'
          }`}
        >
          <option value="">Wszystkie lata</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj po nazwie lub kliencie…"
            className="h-8 border-white/10 bg-black/40 pl-9 text-sm"
            aria-label="Szukaj projektów"
          />
        </div>
      </div>

      {selectedClient && revenue && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-white/5 bg-zinc-900/30 px-4 py-3">
          <span className="font-semibold text-zinc-100">{selectedClient.name}</span>
          <span className="text-sm text-zinc-400">
            przychód{year !== null ? ` w ${year}` : ''}:{' '}
            <span className="font-semibold tabular-nums text-zinc-100">{formatPln(revenue.revenue)}</span>
          </span>
          <span className="text-xs text-zinc-500">
            {revenue.countedProjects}{' '}
            {plural(revenue.countedProjects, 'projekt wliczony', 'projekty wliczone', 'projektów wliczonych')} (w
            realizacji i zrealizowane, jak w Finansach)
          </span>
        </div>
      )}

      {/* Nowy projekt — zawsze pusty, niczego nie przejmuje z poprzednio otwartego */}
      <div className="mb-6 rounded-xl border border-white/5 bg-zinc-900/30 p-4">
        {creating ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setCreating(false)
              }}
              placeholder="Nazwa projektu…"
              className="h-9 min-w-[200px] flex-1 border-white/10 bg-black/40 text-sm"
            />
            <Button onClick={handleCreate} disabled={!newName.trim()} className="h-9">
              Utwórz
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)} className="h-9">
              Anuluj
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-zinc-400">
              Nowy projekt startuje od pustej wyceny
            </div>
            <Button onClick={() => setCreating(true)} className="h-9 gap-2">
              <FolderPlus className="size-4" />
              Nowy projekt
            </Button>
          </div>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-16 text-center">
          <PackageOpen className="size-8 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">
            {projects.length === 0
              ? 'Utwórz pierwszy projekt albo przenieś zapisane wyceny.'
              : hideLost && lostCount > 0 && filter !== 'projects'
                ? 'Nic nie pasuje do tych filtrów. Nieprzyjęte wyceny są ukryte.'
                : 'Nic nie pasuje do tych filtrów.'}
          </p>
          {narrowed && (
            <button
              type="button"
              onClick={() => {
                setListClient('')
                setListYear(null)
                setSearch('')
              }}
              className="mt-3 text-xs font-semibold text-primary hover:underline"
            >
              Pokaż wszystkich klientów i lata
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              onOpen={() => openProject(project.id)}
              onDeleted={setDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}
