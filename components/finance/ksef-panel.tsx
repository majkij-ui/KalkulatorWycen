'use client'

/**
 * Finanse → „Zgodność z KSeF": projekty obok faktur sprzedaży z KSeF
 * (`ksef-reconcile.ts`, docs/PLAN-KSEF.md §7). Kopię faktur pobiera
 * `npm run data -- ksef-sync`; ten ekran ją czyta, pokazuje różnice i na
 * „Zastosuj" zapisuje fakturę w projekcie. Nic nie zmienia się samo.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleSlash, FileText, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ClientDetails } from '@/lib/client-details'
import { listClientDetails, mutateClientDetails } from '@/lib/client-details-store'
import { useEvents } from '@/lib/events-context'
import { createEvent } from '@/lib/events-store'
import { isInPeriod, type Period } from '@/lib/finance-calc'
import type { KsefCache } from '@/lib/ksef-cache'
import {
  applyEventUpdate,
  MATCH_REASON_TEXT,
  reconcileKsef,
  safeToApplyInBulk,
  type FieldChange,
  type KsefChange,
  type KsefDecision,
  type KsefDocument,
  type ReconcileRow,
  type RowStatus,
} from '@/lib/ksef-reconcile'
import { listKsefDecisions, readKsefCache, removeKsefDecision, upsertKsefDecision } from '@/lib/ksef-store'
import type { ProjectMoney } from '@/lib/money-loop'
import { pln } from '@/lib/money-loop-labels'
import { plural } from '@/lib/pl-plural'
import { useProjectHub } from '@/lib/project-hub-context'

const STATUS: Record<RowStatus, { label: string; className: string }> = {
  ok: { label: 'Zgodne', className: 'bg-emerald-500/10 text-emerald-300' },
  changes: { label: 'Do poprawy', className: 'bg-sky-500/10 text-sky-300' },
  amount: { label: 'Różnica kwoty', className: 'bg-amber-500/10 text-amber-300' },
  missing: { label: 'Brak faktury', className: 'bg-rose-500/10 text-rose-300' },
  no_invoice: { label: 'Bez faktury (celowo)', className: 'bg-zinc-500/10 text-zinc-400' },
  waiting: { label: 'W realizacji, bez faktury', className: 'bg-zinc-500/10 text-zinc-400' },
}

const FIELD_LABELS: Record<string, string> = {
  start: 'Data w kalendarzu (KSeF)',
  'data.number': 'Numer faktury',
  'data.amountNetto': 'Kwota netto (zł)',
  'data.amountOriginal': 'Kwota na fakturze',
  'data.currency': 'Waluta',
  'data.dueDate': 'Termin płatności',
  'data.issueDate': 'Data wystawienia',
  'data.ksefNumber': 'Numer KSeF',
  'data.buyerId': 'Nabywca',
  'data.corrections': 'Korekty',
}

function day(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

function show(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (field === 'start' || field === 'data.dueDate' || field === 'data.issueDate') return day(String(value))
  if (field === 'data.amountNetto') return pln(Number(value))
  if (field === 'data.buyerId') return String(value).replace(/^Nip:/, 'NIP ').replace(/^VatUe:/, 'VAT UE ')
  if (field === 'data.corrections' && Array.isArray(value)) {
    return value.map((c: { number?: string; netChange?: number; currency?: string }) => `${c.number} (${c.netChange} ${c.currency})`).join(', ')
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function documentAmount(document: KsefDocument): string {
  return document.sale.currency === 'PLN'
    ? pln(document.amount)
    : `${document.amount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${document.sale.currency}`
}

function ChangeList({ changes }: { changes: KsefChange[] }) {
  const rows: { key: string; label: string; field?: FieldChange; text?: string }[] = []
  changes.forEach((change, index) => {
    if (change.kind === 'update') {
      change.fields.forEach((field) => rows.push({ key: `${index}-${field.field}`, label: FIELD_LABELS[field.field] ?? field.field, field }))
    } else if (change.kind === 'create') {
      rows.push({ key: `${index}`, label: 'Nowa faktura w projekcie', text: `${change.title}, ${day(change.start)}` })
    } else if (change.kind === 'details') {
      rows.push({
        key: `${index}`,
        label: change.before ? 'Nazwa z faktury' : 'Klient w kartotece',
        text: `${change.record.legalName}${change.record.nip ? ` · NIP ${change.record.nip}` : ''}`,
      })
    }
  })
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md border border-white/5 bg-black/20 px-2.5 py-1.5 text-[11px]">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-zinc-600">{row.label}</dt>
          <dd className="min-w-0 break-words">
            {row.field ? (
              <>
                <span className="text-zinc-500 line-through decoration-zinc-700">{show(row.field.field, row.field.before)}</span>
                <span className="px-1.5 text-zinc-600" aria-label="zmienia się na">→</span>
                <span className="text-zinc-100">{show(row.field.field, row.field.after)}</span>
              </>
            ) : (
              <span className="text-zinc-100">{row.text}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function RowCard({
  row,
  busy,
  onApply,
  onNoInvoice,
  onClient,
  onOpenProject,
}: {
  row: ReconcileRow
  busy: boolean
  onApply: (row: ReconcileRow) => void
  onNoInvoice: (row: ReconcileRow, on: boolean) => void
  onClient: (row: ReconcileRow, to: string) => void
  onOpenProject: (id: string) => void
}) {
  const status = STATUS[row.status]
  const invoiceChanges = row.changes.filter((c) => c.kind !== 'client')
  const clientChange = row.changes.find((c): c is Extract<KsefChange, { kind: 'client' }> => c.kind === 'client')
  const suggested = row.documents.some((d) => d.reason === 'suggested')
  return (
    <li className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={() => onOpenProject(row.project.id)} className="text-left text-sm font-medium text-zinc-100 hover:underline">
            {row.project.name}
          </button>
          <div className="text-xs text-zinc-500">{row.project.client || 'bez klienta'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-right text-xs">
          <div>
            <div className="text-zinc-600">W hubie</div>
            <div className="tabular-nums text-zinc-200">{row.hubValue === null ? '—' : pln(row.hubValue)}</div>
          </div>
          <div>
            <div className="text-zinc-600">W KSeF</div>
            <div className="tabular-nums text-zinc-200">
              {row.ksefTotal !== null ? pln(row.ksefTotal) : row.documents.length ? row.documents.map(documentAmount).join(' + ') : '—'}
            </div>
          </div>
          {row.diff !== null && Math.abs(row.diff) >= 0.5 && (
            <div>
              <div className="text-zinc-600">Różnica</div>
              <div className="tabular-nums text-amber-300">
                {row.diff > 0 ? '+' : ''}
                {pln(row.diff)}
              </div>
            </div>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
        </div>
      </div>

      {row.documents.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-400">
          {row.documents.map((document) => (
            <li key={document.sale.ksefNumber}>
              <FileText className="mr-1 inline size-3 text-zinc-600" />
              {document.sale.invoiceNumber} · {day(document.sale.ksefDate)} · {documentAmount(document)} ·{' '}
              <span className={document.reason === 'suggested' ? 'text-amber-300' : 'text-zinc-500'}>{MATCH_REASON_TEXT[document.reason]}</span>
              {document.corrections.map((c) => (
                <span key={c.ksefNumber} className="ml-2 text-zinc-500">
                  + korekta {c.invoiceNumber} ({c.netAmount} {c.currency})
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {row.status === 'amount' && (
        <p className="mt-2 text-xs text-amber-300/90">
          Faktury różnią się od ceny z dosprzedażą w Finansach projektu. Po zapisaniu faktur o przychodzie decydują one; cenę
          albo dosprzedaż poprawisz w projekcie.
        </p>
      )}
      {row.extraHubInvoices.length > 0 && (
        <p className="mt-2 text-xs text-amber-300/90">
          <AlertTriangle className="mr-1 inline size-3" />W hubie jest faktura, której nie ma w KSeF:{' '}
          {row.extraHubInvoices.map((e) => `${String(e.data?.number ?? 'bez numeru')} (${day(e.start)})`).join(', ')}. Usuń ją w
          projekcie, jeśli to pomyłka.
        </p>
      )}
      {invoiceChanges.length > 0 && <ChangeList changes={invoiceChanges} />}
      {clientChange && (
        <p className="mt-2 text-xs text-zinc-400">
          Faktury tej firmy są w hubie pod nazwą <span className="text-zinc-200">„{clientChange.to}”</span>, a ten projekt ma
          klienta „{clientChange.from}”. Jedna firma = jedna nazwa wyświetlana; zmienisz ją potem w Klientach („Scal nazwy”).
        </p>
      )}

      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {row.status === 'missing' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onNoInvoice(row, true)}>
            <CircleSlash className="size-3.5" />
            Bez faktury (barter, inne)
          </Button>
        )}
        {row.status === 'no_invoice' && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onNoInvoice(row, false)}>
            Cofnij „bez faktury”
          </Button>
        )}
        {clientChange && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onClient(row, clientChange.to)}>
            Ustaw klienta „{clientChange.to}”
          </Button>
        )}
        {invoiceChanges.length > 0 && (
          <Button size="sm" disabled={busy} onClick={() => onApply(row)}>
            <Check className="size-3.5" />
            {suggested ? 'To ten projekt — zastosuj z KSeF' : 'Zastosuj z KSeF'}
          </Button>
        )}
      </div>
    </li>
  )
}

export function KsefPanel({
  period,
  periodLabel,
  moneyById,
  onOpenProject,
}: {
  period: Period
  periodLabel: string
  moneyById: Map<string, ProjectMoney>
  onOpenProject: (id: string) => void
}) {
  const { projects, updateProject } = useProjectHub()
  const { allEvents, save } = useEvents()
  const [cache, setCache] = useState<KsefCache | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [decisions, setDecisions] = useState<KsefDecision[]>([])
  const [details, setDetails] = useState<ClientDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [read, savedDecisions, savedDetails] = await Promise.all([readKsefCache(), listKsefDecisions(), listClientDetails()])
    setCache(read.cache)
    setError(read.error)
    setDecisions(savedDecisions)
    setDetails(savedDetails)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const result = useMemo(
    () =>
      reconcileKsef({
        projects: projects.map((p) => ({ id: p.id, name: p.name, client: p.client ?? '', status: p.status, date: p.date ?? '', deletedAt: p.deletedAt })),
        expected: new Map([...moneyById].map(([id, money]) => [id, money.expected])),
        events: allEvents,
        invoices: cache?.invoices ?? [],
        details,
        decisions,
        inPeriod: (value) => isInPeriod(value, period),
        now: new Date().toISOString(),
      }),
    [projects, moneyById, allEvents, cache, details, decisions, period],
  )

  const applyRow = async (row: ReconcileRow) => {
    const now = new Date().toISOString()
    for (const change of row.changes) {
      if (change.kind === 'update') {
        const event = allEvents.find((e) => e.id === change.eventId)
        if (event) await save(applyEventUpdate(event, change, now))
      } else if (change.kind === 'create') {
        await save(
          createEvent({
            kind: 'invoice_sent',
            start: change.start,
            projectId: row.project.id,
            title: change.title,
            notes: change.notes,
            data: change.data,
            source: { type: 'ksef', ref: `ksef:${change.ksefNumber}` },
          }),
        )
      } else if (change.kind === 'details') {
        const record = change.record
        await mutateClientDetails((items) => [...items.filter((d) => d.id !== record.id), record])
      }
      // Zmiana klienta ma własny przycisk (`onClient`): zapis faktury jej nie wymusza.
    }
  }

  const run = async (work: () => Promise<void>, message: string) => {
    setBusy(true)
    try {
      await work()
      setDetails(await listClientDetails())
      setDecisions(await listKsefDecisions())
      setNotice(message)
    } finally {
      setBusy(false)
    }
  }

  const bulk = result.rows.filter(safeToApplyInBulk)
  const counts = result.rows.reduce<Record<RowStatus, number>>(
    (acc, row) => ({ ...acc, [row.status]: acc[row.status] + 1 }),
    { ok: 0, changes: 0, amount: 0, missing: 0, no_invoice: 0, waiting: 0 },
  )
  const candidates = projects
    .filter((p) => !p.deletedAt && p.status !== 'lost')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-zinc-600">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-zinc-200">Faktury sprzedaży z KSeF · {periodLabel}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {cache
                ? `Pobrane ${day(cache.fetchedAt)} ${cache.fetchedAt.slice(11, 16)} UTC: ${cache.invoices.length} ${plural(cache.invoices.length, 'faktura', 'faktury', 'faktur')} od ${day(cache.from)}.`
                : 'Faktur jeszcze nie pobrano.'}{' '}
              Nowe faktury pobierasz poleceniem <code className="text-zinc-300">npm run data -- ksef-sync</code>{' '}(albo poproś
              Claude&apos;a). KSeF jest tu tylko czytany — faktury wystawiasz w panelu biura rachunkowego.
            </p>
            {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            Odśwież
          </Button>
        </div>
        {cache && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {(Object.keys(STATUS) as RowStatus[])
              .filter((key) => counts[key] > 0)
              .map((key) => (
                <span key={key} className={`rounded-full px-2 py-0.5 ${STATUS[key].className}`}>
                  {STATUS[key].label}: {counts[key]}
                </span>
              ))}
            {result.unassigned.length > 0 && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-300">Bez projektu: {result.unassigned.length}</span>
            )}
            {bulk.length > 0 && (
              <Button
                size="sm"
                className="ml-auto"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    for (const row of bulk) await applyRow(row)
                  }, `Zastosowano ${bulk.length} ${plural(bulk.length, 'projekt', 'projekty', 'projektów')} z KSeF.`)
                }
              >
                <Check className="size-3.5" />
                Zastosuj wszystkie pewne ({bulk.length})
              </Button>
            )}
          </div>
        )}
        {notice && <p className="mt-2 text-xs text-emerald-300">{notice}</p>}
      </section>

      {result.unassigned.length > 0 && (
        <section className="rounded-xl border border-rose-500/20 bg-zinc-900/40 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Faktury bez projektu</h2>
          <p className="mb-2 text-xs text-zinc-500">Pasuje więcej niż jeden projekt albo żaden. Wskaż właściwy.</p>
          <ul className="space-y-2">
            {result.unassigned.map(({ document, hints }) => {
              const key = document.sale.ksefNumber
              const hinted = new Set(hints)
              const options = [...candidates.filter((p) => hinted.has(p.id)), ...candidates.filter((p) => !hinted.has(p.id))]
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-300">
                    {document.sale.invoiceNumber} · {day(document.sale.ksefDate)} · {document.sale.counterpartyName} · {documentAmount(document)}
                  </span>
                  <span className="flex items-center gap-2">
                    <select
                      value={choice[key] ?? ''}
                      onChange={(e) => setChoice((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="max-w-72 rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-zinc-200"
                    >
                      <option value="">Wybierz projekt…</option>
                      {options.map((p) => (
                        <option key={p.id} value={p.id}>
                          {hinted.has(p.id) ? '★ ' : ''}
                          {p.name} ({p.client || 'bez klienta'})
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !choice[key]}
                      onClick={() =>
                        void run(
                          () =>
                            upsertKsefDecision({
                              id: `assign:${key}`,
                              kind: 'assign',
                              projectId: choice[key],
                              ksefNumber: key,
                              at: new Date().toISOString(),
                            }).then(() => undefined),
                          `Faktura ${document.sale.invoiceNumber} przypisana — sprawdź zmiany przy projekcie.`,
                        )
                      }
                    >
                      Przypisz
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {cache && result.rows.length === 0 && result.unassigned.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-600">Brak faktur i projektów w tym okresie.</p>
      )}
      <ul className="space-y-2">
        {result.rows.map((row) => (
          <RowCard
            key={row.project.id}
            row={row}
            busy={busy}
            onOpenProject={onOpenProject}
            onApply={(target) => void run(() => applyRow(target), `Zastosowano KSeF w „${target.project.name}”.`)}
            onClient={(target, to) =>
              void run(() => updateProject(target.project.id, { client: to }), `„${target.project.name}”: klient „${to}”.`)
            }
            onNoInvoice={(target, on) =>
              void run(
                () =>
                  (on
                    ? upsertKsefDecision({ id: `none:${target.project.id}`, kind: 'no_invoice', projectId: target.project.id, at: new Date().toISOString() })
                    : removeKsefDecision(`none:${target.project.id}`)
                  ).then(() => undefined),
                on ? `„${target.project.name}” oznaczony jako bez faktury.` : 'Cofnięto.',
              )
            }
          />
        ))}
      </ul>
    </div>
  )
}
