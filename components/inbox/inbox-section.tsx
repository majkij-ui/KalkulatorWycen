'use client'

/**
 * Sekcja „Skrzynka" — propozycje z poczty do zatwierdzenia (plan §5a, Lane 1).
 *
 * Propozycje pisze Claude (`npm run data -- inbox`) do `inbox/` w folderze
 * danych; ten ekran ich nie zmienia. Akceptacja zapisuje wydarzenie / projekt
 * przez zwykłe store'y, odrzucenie zapamiętuje `ref` w `inbox-decisions.json`,
 * więc propozycja nie wraca przy kolejnym imporcie.
 */

import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Inbox, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useInbox, type AcceptResult } from '@/lib/inbox-context'
import { plural } from '@/lib/pl-plural'
import { EventNotice, type EventNoticeState } from '@/components/calendar/event-notice'
import { mono } from '@/components/calendar/calendar-bits'
import { InboxGroup } from './inbox-group'

interface Notice {
  id: number
  text: string
  status: EventNoticeState | null
}

function count(n: number, one: string, few: string, many: string): string {
  return `${n} ${plural(n, one, few, many)}`
}

function shortStamp(iso: string): string {
  const [date, time] = iso.split('T')
  if (!date) return ''
  const [, m, d] = date.split('-')
  return `${d}.${m}${time ? ` ${time.slice(0, 5)}` : ''}`
}

export function InboxSection({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { isLoading, files, decisions, groups, pending, handled, reload, reopen } = useInbox()
  const [notices, setNotices] = useState<Notice[]>([])
  const [reloading, setReloading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const brokenFiles = files.filter((f) => f.status !== 'ok')
  const unreadable = files.reduce((sum, f) => sum + (f.status === 'ok' ? f.unreadable : 0), 0)

  const onAccepted = (result: AcceptResult) => {
    if (!result.accepted) return
    const where = result.project ? ` → ${result.project.name}${result.createdProject ? ' (nowy projekt)' : ''}` : ''
    setNotices((list) => [
      {
        id: Date.now(),
        text: `Przyjęto ${count(result.accepted, 'propozycję', 'propozycje', 'propozycji')}${where}.`,
        status:
          result.project && result.statusSuggestion
            ? { type: 'status', projectId: result.project.id, projectName: result.project.name, to: result.statusSuggestion }
            : null,
      },
      ...list.slice(0, 2),
    ])
  }

  const refresh = async () => {
    setReloading(true)
    try {
      await reload()
    } finally {
      setReloading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Skrzynka</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Propozycje z poczty. Nic nie trafia do projektów, dopóki ich nie zaakceptujesz; statusy projektów
            zmieniasz sam po podpowiedzi.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={reloading}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-60"
        >
          {reloading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Odśwież
        </button>
      </header>

      {notices.length > 0 && (
        <div className="mb-4 space-y-2">
          {notices.map((notice) => (
            <div key={notice.id} className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs text-emerald-300/90" role="status">
                <Check className="size-3.5" aria-hidden />
                {notice.text}
              </p>
              {notice.status && (
                <EventNotice
                  notice={notice.status}
                  onDone={() => setNotices((list) => list.map((n) => (n.id === notice.id ? { ...n, status: null } : n)))}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {(brokenFiles.length > 0 || unreadable > 0) && (
        <div className="mb-4 space-y-1 rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
          {brokenFiles.map((f) => (
            <p key={f.name} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                <span style={mono}>inbox/{f.name}</span>:{' '}
                {f.status === 'newer'
                  ? `nowszy format (v${f.version}) — zaktualizuj aplikację, plik czeka nietknięty.`
                  : `${f.status === 'error' ? f.error : ''} — pominięty.`}
              </span>
            </p>
          ))}
          {unreadable > 0 && (
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              Nie dało się odczytać: {count(unreadable, 'propozycja', 'propozycje', 'propozycji')} — pominięte (plik zostaje).
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-14 text-center">
          <Inbox className="mx-auto mb-3 size-8 text-zinc-700" aria-hidden />
          <p className="text-sm font-medium text-zinc-300">Skrzynka jest pusta</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            Poproś Claude’a w rozmowie „przejrzyj moją pocztę” — nowe leady, odpowiedzi, wyceny i faktury pojawią się tu
            jako propozycje.
            {handled > 0 && ` Rozpatrzonych do tej pory: ${handled}.`}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500" style={mono}>
            {count(pending.length, 'propozycja', 'propozycje', 'propozycji')} · {count(groups.length, 'wątek', 'wątki', 'wątków')}
          </p>
          <div className="space-y-4">
            {groups.map((group) => (
              <InboxGroup key={group.key} group={group} onAccepted={onAccepted} onOpenProject={onOpenProject} />
            ))}
          </div>
        </>
      )}

      {decisions.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-zinc-500 outline-none hover:text-zinc-300 focus-visible:underline"
          >
            <ChevronRight className={`size-3.5 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
            Rozpatrzone <span className="text-zinc-600">({decisions.length})</span>
          </button>
          {showHistory && (
            <ul className="mt-2 divide-y divide-white/[0.04] rounded-xl border border-white/5 bg-zinc-900/30 px-3">
              {decisions.slice(0, 40).map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2 text-xs">
                  {d.decision === 'accepted' ? (
                    <Check className="size-3.5 shrink-0 text-emerald-400/80" aria-label="przyjęta" />
                  ) : d.decision === 'rejected' ? (
                    <X className="size-3.5 shrink-0 text-zinc-500" aria-label="odrzucona" />
                  ) : (
                    <RotateCcw className="size-3.5 shrink-0 text-zinc-500" aria-label="przywrócona" />
                  )}
                  <span className="w-20 shrink-0 text-zinc-600" style={mono}>
                    {shortStamp(d.at)}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${d.decision === 'rejected' ? 'text-zinc-500' : 'text-zinc-300'}`}>
                    {d.title || d.ref}
                  </span>
                  {d.decision === 'accepted' && d.projectId && (
                    <button
                      type="button"
                      onClick={() => onOpenProject(d.projectId!)}
                      className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200"
                    >
                      projekt →
                    </button>
                  )}
                  {d.decision === 'rejected' && (
                    <button
                      type="button"
                      onClick={() => void reopen(d.ref)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary outline-none hover:underline focus-visible:underline"
                    >
                      Przywróć
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
