'use client'

/**
 * Eksport konwersji do Google Ads: podgląd (wiersze, powody odpadnięcia,
 * ostrzeżenia, korekty), zapis pliku CSV i lista eksportów „Czeka na
 * potwierdzenie".
 *
 * Wpisy `pending` powstają dopiero po UDANYM zapisie pliku; anulowanie okna
 * „Zapisz jako…" nie zostawia po sobie nic. Liczy `lib/ads-export.ts`, tu
 * tylko widok i kolejność operacji.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, FileDown, Loader2, Undo2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ADS_CORRECTION_LABELS,
  ADS_REASON_LABELS,
  buildAdsCsv,
  groupRejected,
  pendingRecordsFor,
  planAdsExport,
  type AdsLedgerEntry,
  type AdsProject,
} from '@/lib/ads-export'
import { ADS_EXPORT_CONFIG, type AdsConversionKey } from '@/lib/ads-export-config'
import type { AdsExportRecord } from '@/lib/ads-export-types'
import { adsExportFileName, saveAdsCsv } from '@/lib/ads-export-file'
import { createAdsExportId } from '@/lib/ads-exports-store'
import type { TimelineEvent } from '@/lib/event-types'
import { mono } from '@/components/calendar/calendar-bits'
import { pln } from './marketing-bits'

const KEY_LABEL: Record<AdsConversionKey, string> = { lead: 'lead', won: 'wygrana' }

function formatExportedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso || 'nieznany czas'
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function rowsWord(n: number): string {
  if (n === 1) return 'wiersz'
  const last = n % 10
  return last >= 2 && last <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'wiersze' : 'wierszy'
}

function daysWord(n: number): string {
  return n === 1 ? 'dzień' : 'dni'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-white" style={mono}>
        {value}
      </div>
    </div>
  )
}

export function AdsExportDialog({
  open,
  onOpenChange,
  events,
  projects,
  ledger,
  records,
  today,
  onAddRecords,
  onResolve,
  onOpenProject,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: TimelineEvent[]
  projects: AdsProject[]
  ledger: AdsLedgerEntry[]
  records: AdsExportRecord[]
  /** Dzień eksportu `YYYY-MM-DD`. */
  today: string
  onAddRecords: (records: AdsExportRecord[]) => Promise<void>
  onResolve: (exportedAt: string, status: 'confirmed' | 'cancelled') => Promise<void>
  onOpenProject: (id: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const plan = useMemo(
    () => (open ? planAdsExport({ events, projects, ledger, exports: records, today, config: ADS_EXPORT_CONFIG }) : null),
    [open, events, projects, ledger, records, today]
  )
  const groups = useMemo(() => (plan ? groupRejected(plan.rejected) : []), [plan])
  const pendingGroups = useMemo(() => {
    const byExport = new Map<string, AdsExportRecord[]>()
    records
      .filter((r) => r.status === 'pending')
      .forEach((r) => byExport.set(r.exportedAt, [...(byExport.get(r.exportedAt) ?? []), r]))
    return [...byExport.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [records])

  if (!plan) return null
  const noRows = plan.rows.length === 0

  const save = async () => {
    if (noRows || busy) return
    setBusy('save')
    setMessage(null)
    const rows = plan.rows
    try {
      const result = await saveAdsCsv(await buildAdsCsv(rows), adsExportFileName(today))
      // Anulowane okno „Zapisz jako…": nic nie zapisano, więc nic nie wpisujemy.
      if (result.status === 'cancelled') return
      try {
        await onAddRecords(pendingRecordsFor(rows, new Date().toISOString(), createAdsExportId))
        setMessage({
          tone: 'ok',
          text: `Zapisano plik${result.status === 'saved' ? `: ${result.path}` : ` (${result.fileName})`}. Zaimportuj go w Google Ads, potem potwierdź poniżej.`,
        })
      } catch (error) {
        setMessage({
          tone: 'error',
          text: `Plik zapisany, ale nie udało się zapisać wpisów „czeka na potwierdzenie" (${error instanceof Error ? error.message : 'błąd zapisu'}). Nie wysyłaj go ponownie bez sprawdzenia.`,
        })
      }
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `Nie udało się zapisać pliku (${error instanceof Error ? error.message : 'błąd zapisu'}). Nic nie zostało oznaczone jako wysłane.`,
      })
    } finally {
      setBusy(null)
    }
  }

  const resolve = async (exportedAt: string, status: 'confirmed' | 'cancelled') => {
    if (busy) return
    setBusy(exportedAt)
    setMessage(null)
    try {
      await onResolve(exportedAt, status)
    } catch (error) {
      setMessage({ tone: 'error', text: `Nie udało się zapisać zmiany (${error instanceof Error ? error.message : 'błąd zapisu'}).` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[90vh] flex-col overflow-hidden border-white/10 bg-slate-900/95 text-foreground backdrop-blur-xl sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="text-white">Eksport do Google Ads</DialogTitle>
          <p className="text-sm text-zinc-400">
            Plik CSV z konwersjami offline do ręcznego importu. E-mail i telefon jadą tylko jako skrót SHA-256 i tylko przy
            zgodzie.
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
          {pendingGroups.length > 0 && (
            <section aria-label="Czeka na potwierdzenie">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-300/90">Czeka na potwierdzenie</h3>
              <ul className="space-y-2">
                {pendingGroups.map(([exportedAt, items]) => (
                  <li
                    key={exportedAt}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2"
                  >
                    <div className="text-sm text-zinc-200">
                      <span style={mono}>{formatExportedAt(exportedAt)}</span>
                      <span className="ml-2 text-xs text-zinc-400">
                        {items.length} {rowsWord(items.length)} · {pln(items.reduce((s, r) => s + r.value, 0))}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void resolve(exportedAt, 'cancelled')}
                        title="Wiersze wrócą do następnego eksportu z tym samym czasem konwersji"
                        className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/5 disabled:opacity-50"
                      >
                        <Undo2 className="size-3.5" />
                        Cofnij
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void resolve(exportedAt, 'confirmed')}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {busy === exportedAt ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Potwierdź import
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Do wysłania" className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Wiersze" value={String(plan.totals.rows)} />
              <Stat label="Leady" value={String(plan.totals.leads)} />
              <Stat label="Suma wartości" value={pln(plan.totals.value, 2)} />
            </div>
            {noRows && (
              <p className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                {plan.rejected.length === 0
                  ? 'Brak wierszy do wysłania: w hubie nie ma jeszcze żadnych leadów.'
                  : pendingGroups.length > 0
                    ? 'Brak nowych wierszy do wysłania. To, co się kwalifikuje, czeka już na potwierdzenie (wyżej).'
                    : 'Brak wierszy do wysłania: żaden lead nie spełnia warunków. Powody poniżej.'}
              </p>
            )}
          </section>

          {plan.warnings.length > 0 && (
            <section aria-label="Ostrzeżenia">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-300/90">
                <AlertTriangle className="size-3.5" />
                Okno Google zaraz się zamknie
              </h3>
              <ul className="space-y-1 text-sm text-zinc-300">
                {plan.warnings.map((w) => (
                  <li key={`${w.leadEventId}-${w.conversionKey}`}>
                    {w.leadName || 'Bez nazwy'} <span className="text-zinc-500">({KEY_LABEL[w.conversionKey]})</span>: zostało{' '}
                    <span style={mono}>
                      {w.daysLeft} {daysWord(w.daysLeft)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {plan.corrections.length > 0 && (
            <section aria-label="Do ręcznej korekty">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-rose-300/90">Do ręcznej korekty</h3>
              <p className="mb-1.5 text-xs text-zinc-500">
                Te konwersje już pojechały, a dane się zmieniły. Hub ich nie poprawia sam.
              </p>
              <ul className="space-y-1 text-sm text-zinc-300">
                {plan.corrections.map((c) => (
                  <li key={`${c.recordId}-${c.kind}`}>
                    {c.leadName || 'Bez nazwy'} <span className="text-zinc-500">({KEY_LABEL[c.conversionKey]})</span>:{' '}
                    {ADS_CORRECTION_LABELS[c.kind]}
                    {c.sent !== null && c.current !== null && (
                      <span className="text-zinc-400" style={mono}>
                        {' '}
                        ({pln(c.sent, 2)} → {pln(c.current, 2)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groups.length > 0 && (
            <section aria-label="Powody odpadnięcia">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Nie pojadą</h3>
              <ul className="space-y-1.5">
                {groups.map(({ reason, items }) =>
                  reason === 'pre_tracking' ? (
                    <li
                      key={reason}
                      className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm text-zinc-300"
                    >
                      <span>{ADS_REASON_LABELS[reason]}</span>
                      <span className="text-zinc-500" style={mono}>
                        {items.length}
                      </span>
                    </li>
                  ) : (
                    <li key={reason}>
                      <details className="group rounded-lg border border-white/5 bg-black/20">
                        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                          <span>{ADS_REASON_LABELS[reason]}</span>
                          <span className="text-zinc-500" style={mono}>
                            {items.length}
                          </span>
                        </summary>
                        <ul className="space-y-1 border-t border-white/5 px-3 py-2 text-sm text-zinc-400">
                          {items.map((item) => (
                            <li key={`${item.leadEventId}-${item.conversionKey}`} className="flex flex-wrap items-center gap-x-2">
                              <span className="text-zinc-200">{item.leadName || 'Bez nazwy'}</span>
                              {item.conversionKey === 'won' && <span className="text-zinc-500">· wygrana</span>}
                              {reason === 'no_won_date' && item.projectName && (
                                <span className="text-zinc-500">· projekt: {item.projectName}</span>
                              )}
                              {reason === 'no_won_date' && item.projectId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenChange(false)
                                    onOpenProject(item.projectId as string)
                                  }}
                                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-sky-300 hover:bg-white/5"
                                >
                                  Otwórz projekt
                                  <ArrowRight className="size-3" />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  )
                )}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p
            role="status"
            className={`min-w-0 flex-1 text-xs ${message?.tone === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}
          >
            {message?.text}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/5"
            >
              Zamknij
            </button>
            <button
              type="button"
              disabled={noRows || busy !== null}
              onClick={() => void save()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
              Zapisz plik
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
