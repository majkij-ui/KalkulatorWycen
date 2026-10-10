'use client'

/**
 * „Scal nazwy" na stronie klienta: wybór nazwy po scaleniu i innych klientów
 * do dołączenia, podgląd projektów, potwierdzenie z liczbą. Zapis to jedno
 * przepisanie pola `client` (`client-merge.ts`); „Cofnij" pokazuje sekcja.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, GitMerge, Search } from 'lucide-react'
import { clientDirectory, clientKey, type ClientInfo } from '@/lib/clients'
import { mergeCandidates, planClientMerge, type ClientMergePlan } from '@/lib/client-merge'
import type { ClientStats } from '@/lib/client-stats'
import type { Project } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const projectsLabel = (n: number) => `${n} ${plural(n, 'projekcie', 'projektach', 'projektach')}`

export function ClientMerge({
  stats,
  projects,
  onMerge,
}: {
  stats: ClientStats
  projects: Project[]
  onMerge: (plan: ClientMergePlan) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(stats.name)
  const [extra, setExtra] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const directory = useMemo(() => clientDirectory(projects), [projects])
  const candidates = useMemo(() => mergeCandidates(directory, stats.key), [directory, stats.key])
  const shown = useMemo(() => {
    const q = clientKey(query)
    const chosen = (c: ClientInfo) => extra.has(c.key)
    if (q) return candidates.filter((c) => c.key.includes(q) || chosen(c))
    // Bez szukania: tylko podobni i już zaznaczeni (reszta po wpisaniu nazwy).
    return candidates.filter((c) => c.likely || chosen(c))
  }, [candidates, query, extra])

  const plan = useMemo(
    () => planClientMerge(projects, [stats.key, ...extra], target),
    [projects, stats.key, extra, target]
  )
  const changes = plan?.changes ?? []
  const otherClients = candidates.filter((c) => extra.has(c.key))

  const toggle = (key: string) => {
    setConfirming(false)
    setExtra((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const run = async () => {
    if (!plan || !changes.length) return
    setBusy(true)
    await onMerge(plan)
    setBusy(false)
    // Po scaleniu panel wraca do stanu wyjściowego; „Cofnij" jest nad stroną.
    setOpen(false)
    setConfirming(false)
    setExtra(new Set())
    setQuery('')
  }

  const label = 'text-[11px] text-zinc-500'

  return (
    <section className="rounded-xl border border-white/5 bg-zinc-900/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <GitMerge className="size-4 shrink-0 text-zinc-500" />
        <span className="flex-1 text-sm font-medium text-zinc-200">
          Scal nazwy
          <span className="ml-2 font-normal text-zinc-500">
            {stats.spellings.length > 1
              ? `${stats.spellings.length} ${plural(stats.spellings.length, 'pisownia', 'pisownie', 'pisowni')} w projektach`
              : 'połącz z innym klientem albo zmień nazwę'}
          </span>
        </span>
        <ChevronDown className={`size-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-white/5 px-4 pb-4 pt-3">
          <p className="text-xs text-zinc-500">
            Klient to pole projektu, więc scalenie przepisuje nazwę klienta w wybranych projektach. Wyceny (także
            nazwa na PDF) zostają bez zmian.
          </p>

          {stats.spellings.length > 1 && (
            <div>
              <div className={label}>Pisownie w projektach — kliknij, żeby wybrać</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {stats.spellings.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setTarget(s.name)
                      setConfirming(false)
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                      target.trim() === s.name ? 'border-white/30 text-white' : 'border-white/10 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    „{s.name}" <span className="text-zinc-500">× {s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className={label}>
            Nazwa po scaleniu
            <Input
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
                setConfirming(false)
              }}
              className="mt-1 h-9 border-white/10 bg-black/40 text-sm"
            />
          </label>

          <div>
            <div className={label}>Dołącz innych klientów (ta sama firma pod inną nazwą)</div>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj klienta"
                aria-label="Szukaj klienta do dołączenia"
                className="h-9 border-white/10 bg-black/40 pl-8 text-sm"
              />
            </div>
            {shown.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {shown.slice(0, 12).map((c) => (
                  <li key={c.key}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={extra.has(c.key)}
                        onChange={() => toggle(c.key)}
                        className="accent-emerald-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-zinc-200">{c.name}</span>
                      {c.likely && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300/90">podobna nazwa</span>
                      )}
                      <span className="shrink-0 text-xs text-zinc-500">
                        {c.projectCount} proj.
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-zinc-600">
                {query.trim() ? 'Nikt nie pasuje.' : 'Brak klientów o podobnej nazwie — wpisz, żeby wyszukać.'}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-white/5 bg-black/20 p-3">
            {!plan ? (
              <p className="text-xs text-zinc-500">Wpisz nazwę po scaleniu.</p>
            ) : changes.length === 0 ? (
              <p className="text-xs text-zinc-500">Nic do zmiany — wszystkie projekty mają już tę nazwę.</p>
            ) : (
              <>
                <p className="text-xs text-zinc-300">
                  Zmieni się klient w {projectsLabel(changes.length)}
                  {otherClients.length > 0 && (
                    <span className="text-zinc-500">
                      {' '}
                      (w tym {otherClients.map((c) => `„${c.name}"`).join(', ')})
                    </span>
                  )}
                  :
                </p>
                <ul className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto text-xs">
                  {changes.map((c) => (
                    <li key={c.id} className="flex gap-2 text-zinc-500">
                      <span className="min-w-0 flex-1 truncate text-zinc-300">{c.name || 'Bez nazwy'}</span>
                      <span className="shrink-0">
                        „{c.from.trim()}" → „{plan.target}"
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {confirming && plan && changes.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" role="alert">
              <p className="text-xs text-amber-100/90">
                Przepisać klienta na „{plan.target}" w {projectsLabel(changes.length)}? Można to cofnąć zaraz po
                scaleniu.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={run} disabled={busy} className="h-8">
                  Scal ({changes.length})
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} className="h-8">
                  Anuluj
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setConfirming(true)}
              disabled={!plan || changes.length === 0}
              className="h-9 w-fit gap-2 border-white/10"
            >
              <GitMerge className="size-4" />
              Scal…
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
