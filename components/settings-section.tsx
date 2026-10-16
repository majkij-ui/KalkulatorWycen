'use client'

/**
 * Ekran „Ustawienia". Cennik, teksty PDF i katalog realizacji są w ustawieniach
 * wyceny (koło zębate w nagłówku kalkulatora otwartego projektu). Tutaj: import
 * ze starej aplikacji QuoteGen — od Q1 tylko na żądanie, bez sprawdzania przy
 * każdym starcie (decyzja M.J. 2026-10-16). Czyta wyłącznie plik starej
 * aplikacji; „Moje wyceny" huba zostają na dysku nietknięte.
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjectHub } from '@/lib/project-hub-context'
import { listLegacyQuotes } from '@/lib/legacy-app'
import { listAllProjects } from '@/lib/project-library'
import { pendingQuotes } from '@/lib/project-migration-core'
import { migrateQuotesToProjects, readSkippedQuoteIds, skipQuoteIds } from '@/lib/project-migration'
import { plural } from '@/lib/pl-plural'
import { isTauriRuntime } from '@/lib/storage'
import { lastAutoBackup } from '@/lib/auto-backup-tauri'
import { companyLoadStatus, type CompanyLoadStatus } from '@/lib/company-settings'
import { DEFAULT_RETENTION } from '@/lib/auto-backup'

interface LegacyQuote {
  id: string
  name: string
  updatedAt: string
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

function LegacyImportCard() {
  const { reloadProjects } = useProjectHub()
  const [quotes, setQuotes] = useState<LegacyQuote[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const check = async () => {
    setBusy(true)
    setMessage(null)
    try {
      // Z usuniętymi: usunięty projekt z importu nie wskrzesza swojej wyceny.
      const [legacy, projects] = await Promise.all([listLegacyQuotes(), listAllProjects()])
      setQuotes(
        pendingQuotes(legacy, projects, readSkippedQuoteIds()).map((q) => ({ id: q.id, name: q.name, updatedAt: q.updatedAt }))
      )
    } catch (err) {
      setMessage(`Nie udało się odczytać starej aplikacji: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const skip = (ids: string[]) => {
    const skipped = skipQuoteIds(ids)
    setQuotes((list) => (list ?? []).filter((q) => !skipped.has(q.id)))
  }

  const runImport = async () => {
    setBusy(true)
    const result = await migrateQuotesToProjects()
    await reloadProjects()
    setBusy(false)
    setQuotes([])
    if (result.status === 'migrated') {
      setMessage(
        `Przeniesiono ${result.migratedCount} ${plural(result.migratedCount, 'wycenę', 'wyceny', 'wycen')} do projektów. Kopia zapasowa: ${result.backupLocation}`
      )
    } else if (result.status === 'aborted-no-backup') {
      setMessage('Nie udało się zapisać kopii zapasowej — import przerwany, dane nietknięte.')
    } else {
      setMessage('Nie było nic do przeniesienia.')
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-zinc-900/30 p-4">
      <h2 className="text-sm font-semibold text-white">Stara aplikacja QuoteGen</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Wyceny zrobione w starej aplikacji można przenieść do projektów. Stara aplikacja i jej plik zostają nietknięte,
        a przed zapisem powstaje kopia zapasowa.
      </p>

      {quotes === null ? (
        <Button variant="outline" onClick={check} disabled={busy} className="mt-3 gap-2">
          {busy && <Loader2 className="size-4 animate-spin" />}
          Sprawdź starą aplikację
        </Button>
      ) : quotes.length === 0 ? (
        !message && <p className="mt-3 text-sm text-zinc-400">Wszystkie wyceny ze starej aplikacji są już projektami.</p>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-zinc-200">
            {quotes.length === 1
              ? 'Jedna wycena nie jest jeszcze projektem:'
              : `${quotes.length} ${plural(quotes.length, 'wycena nie jest', 'wyceny nie są', 'wycen nie jest')} jeszcze projektami:`}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-300">
            {quotes.map((q) => (
              <li key={q.id} className="flex items-center gap-2">
                <span className="truncate">„{q.name}"</span>
                {q.updatedAt && <span className="shrink-0 text-zinc-500">{formatDate(q.updatedAt)}</span>}
                <button
                  type="button"
                  onClick={() => skip([q.id])}
                  className="shrink-0 rounded px-1 text-zinc-500 underline-offset-2 outline-none hover:text-zinc-200 hover:underline focus-visible:ring-1 focus-visible:ring-white/50"
                >
                  Pomiń
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={runImport} disabled={busy} className="gap-2">
              {busy && <Loader2 className="size-4 animate-spin" />}
              Przenieś do projektów
            </Button>
            <Button variant="outline" onClick={() => skip(quotes.map((q) => q.id))} disabled={busy}>
              {quotes.length === 1 ? 'Pomiń' : 'Pomiń wszystkie'}
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-3 text-sm text-zinc-300" role="status">
          {message}
        </p>
      )}
    </section>
  )
}

const COMPANY_STATUS: Record<CompanyLoadStatus, string> = {
  loaded: 'czytane z pliku company.json.',
  migrated: 'plik company.json utworzony przy tym starcie (z pamięci okna; stare wpisy zostały na miejscu).',
  unreadable: 'pliku company.json nie da się odczytać — działają z pamięci okna, plik zostaje nietknięty.',
  'write-failed': 'nie udało się utworzyć company.json — działają z pamięci okna, jak dotąd.',
  skipped: 'nie wczytano.',
}

/** Kopie zapasowe i plik ustawień firmy (F1) — tylko do wglądu. */
function DataSafetyCard() {
  const backup = lastAutoBackup()
  const result = backup?.result
  let backupLine: string
  if (!isTauriRuntime()) backupLine = 'W przeglądarce (podgląd) kopie nie są robione — dotyczą tylko aplikacji na komputerze.'
  else if (!result) backupLine = 'Kopia przy tym starcie jeszcze trwa albo nie ruszyła.'
  else if (!result.ok) backupLine = 'Kopia przy tym starcie nie udała się (szczegóły w komunikacie na dole okna).'
  else if (!result.folder) backupLine = 'Nie było jeszcze plików danych do skopiowania.'
  else
    backupLine = `Kopia z tego startu: ${result.folder} (${result.copied.length} ${plural(
      result.copied.length,
      'plik',
      'pliki',
      'plików'
    )})${result.pruned.length ? `, usunięto ${result.pruned.length} ${plural(result.pruned.length, 'starą kopię', 'stare kopie', 'starych kopii')}` : ''}.`

  return (
    <section className="rounded-xl border border-white/10 bg-zinc-900/30 p-4">
      <h2 className="text-sm font-semibold text-white">Dane i kopie zapasowe</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Przy każdym starcie aplikacja kopiuje pliki danych do folderu backups/auto-…. Zostaje {DEFAULT_RETENTION.keepLast}{' '}
        ostatnich kopii i najnowsza z każdego dnia z ostatnich {DEFAULT_RETENTION.dailyDays} dni. Kopii robionych przez
        Claude&apos;a (backups/*.json) aplikacja nie rusza.
      </p>
      <p className="mt-3 text-sm text-zinc-300">{backupLine}</p>
      {backup?.dir && <p className="mt-1 break-all text-xs text-zinc-500">Folder danych: {backup.dir}</p>}
      <p className="mt-3 text-sm text-zinc-300">
        Teksty PDF, katalog realizacji i domyślny cennik: {COMPANY_STATUS[companyLoadStatus()]}
      </p>
    </section>
  )
}

export function SettingsSection() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-white">Ustawienia</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-500">
        Cennik, teksty PDF i katalog realizacji są w ustawieniach wyceny — ikona koła zębatego w nagłówku kalkulatora
        otwartego projektu. Każdy projekt ma własny cennik; „Zapisz stawki jako domyślne" ustawia cennik nowych wycen.
      </p>
      <div className="mt-6 max-w-xl space-y-4">
        <DataSafetyCard />
        <LegacyImportCard />
      </div>
    </div>
  )
}
