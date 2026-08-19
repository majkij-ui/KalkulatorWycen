'use client'

/**
 * Lista projektów — punkt wyjścia całej apki po przebudowie.
 *
 * Chronologicznie (najnowsze u góry), ze statusem oznaczonym kolorem i trzema
 * filtrami z notatek: wszystko / tylko projekty / tylko wyceny.
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, FolderPlus, Loader2, PackageOpen, Search, Trash2 } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import { useQuote } from '@/lib/quote-context'
import { PROJECT_FILTERS, type Project, type ProjectFilter } from '@/lib/project-types'
import { ProjectStatusBadge } from './project-status-badge'
import { itemLabel } from '@/lib/pl-plural'
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

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { removeProject } = useProjectHub()
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Zmigrowane wyceny nie mają jeszcze policzonych finansów. Pokazujemy „—",
  // nie „0 zł" — zero to konkretna informacja, a tu jej po prostu nie ma.
  const financials = project.financials
  const zysk = financials?.zysk ?? 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex items-center gap-4 rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-white/15 hover:bg-zinc-900/70"
    >
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
          </div>
        </div>

        <div className="shrink-0 text-right">
          {financials ? (
            <>
              <div className="tabular-nums font-semibold text-zinc-200">
                {formatPln(financials.sumaNetto)}
              </div>
              <div
                className={`text-[11px] tabular-nums ${zysk >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}
              >
                zysk {formatPln(zysk)}
              </div>
            </>
          ) : (
            <>
              <div className="text-zinc-600">—</div>
              <div className="text-[11px] text-zinc-600">nie policzono</div>
            </>
          )}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-xs"
              onClick={() => removeProject(project.id)}
            >
              Usuń
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              Anuluj
            </Button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Usuń projekt ${project.name}`}
              className="rounded-md p-1.5 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
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
          </>
        )}
      </div>
    </motion.div>
  )
}

export function ProjectList() {
  const { visibleProjects, projects, filter, setFilter, openProject, createFromCurrentQuote, isLoading } =
    useProjectHub()
  const { totals } = useQuote()
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const query = search.trim().toLowerCase()
  const rows = query
    ? visibleProjects.filter(
        (p) =>
          p.name.toLowerCase().includes(query) || p.client.toLowerCase().includes(query)
      )
    : visibleProjects

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    await createFromCurrentQuote(name)
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

      {/* Filtry + wyszukiwarka */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
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

        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj po nazwie lub kliencie…"
            className="h-9 border-white/10 bg-black/40 pl-9 text-sm"
            aria-label="Szukaj projektów"
          />
        </div>
      </div>

      {/* Tworzenie nowego projektu z bieżącego stanu kalkulatora */}
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
              Zapisz bieżący stan kalkulatora jako nowy projekt
              {totals.sumaNetto > 0 && (
                <span className="ml-2 tabular-nums text-zinc-500">({formatPln(totals.sumaNetto)} netto)</span>
              )}
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
              : 'Nic nie pasuje do tego filtra.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((project) => (
            <ProjectRow key={project.id} project={project} onOpen={() => openProject(project.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
