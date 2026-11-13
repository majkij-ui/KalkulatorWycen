'use client'

/**
 * Finanse → „KSeF" (docs/PLAN-KSEF.md §7–8). Dwie podzakładki:
 *  - „Zgodność": projekty obok faktur sprzedaży z KSeF (`ksef-reconcile.ts`).
 *    Hub proponuje dopasowanie i rozwiązanie różnic, a każdą rzecz da się
 *    zmienić ręcznie: projekt faktury, wpis huba, który zastępuje, różnicę kwot.
 *  - „Faktury": lista faktur sprzedaży i zakupu z sumami okresu i podglądem.
 * Kopię faktur pobiera `npm run data -- ksef-sync`; ten ekran ją czyta. Nic nie
 * zmienia się samo — dane projektu zapisuje dopiero „Zastosuj".
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleSlash, FileText, Loader2, RefreshCw, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ClientDetails } from '@/lib/client-details'
import { listClientDetails, mutateClientDetails } from '@/lib/client-details-store'
import { useEvents } from '@/lib/events-context'
import { createEvent } from '@/lib/events-store'
import type { TimelineEvent } from '@/lib/event-types'
import { isInPeriod, type Period } from '@/lib/finance-calc'
import type { KsefCache } from '@/lib/ksef-cache'
import {
  applyEventUpdate,
  MATCH_REASON_TEXT,
  reconcileKsef,
  safeToApplyInBulk,
  type AmountOption,
  type FieldChange,
  type KsefChange,
  type KsefDecision,
  type KsefDocument,
  type ReconcileResult,
  type ReconcileRow,
  type RowStatus,
} from '@/lib/ksef-reconcile'
import { listKsefDecisions, readKsefCache, removeKsefDecision, upsertKsefDecision } from '@/lib/ksef-store'
import type { ProjectMoney } from '@/lib/money-loop'
import { pln } from '@/lib/money-loop-labels'
import { plural } from '@/lib/pl-plural'
import { useProjectHub } from '@/lib/project-hub-context'
import { day, KsefInvoiceList, money } from './ksef-invoice-list'

const STATUS: Record<RowStatus, { label: string; className: string }> = {
  ok: { label: 'Zgodne', className: 'bg-emerald-500/10 text-emerald-300' },
  changes: { label: 'Do zapisania', className: 'bg-sky-500/10 text-sky-300' },
  amount: { label: 'Różnica kwoty', className: 'bg-amber-500/10 text-amber-300' },
  accepted: { label: 'Zgodne (różnica przyjęta)', className: 'bg-emerald-500/10 text-emerald-300' },
  awaiting: { label: 'Czeka na korektę', className: 'bg-zinc-500/10 text-zinc-300' },
  missing: { label: 'Brak faktury', className: 'bg-rose-500/10 text-rose-300' },
  no_invoice: { label: 'Bez faktury (celowo)', className: 'bg-zinc-500/10 text-zinc-400' },
  waiting: { label: 'W realizacji, bez faktury', className: 'bg-zinc-500/10 text-zinc-400' },
}
const EMPTY_COUNTS: Record<RowStatus, number> = { ok: 0, changes: 0, amount: 0, accepted: 0, awaiting: 0, missing: 0, no_invoice: 0, waiting: 0 }

const FIELD_LABELS: Record<string, string> = {
  projectId: 'Projekt',
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

/** Projekty do ręcznego wyboru: od pół roku przed startem KSeF (faktura bywa późniejsza niż projekt). */
const PROJECTS_SINCE = '2025-08-01'

const selectClass = 'max-w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-xs text-zinc-200'

function documentAmount(document: KsefDocument): string {
  return money(document.amount, document.sale.currency)
}

function documentLabel(document: KsefDocument): string {
  return `${document.sale.invoiceNumber} · ${day(document.sale.ksefDate)} · ${document.sale.counterpartyName.slice(0, 32)} · ${documentAmount(document)}`
}

function hubInvoiceLabel(event: TimelineEvent): string {
  const number = typeof event.data?.number === 'string' && event.data.number ? event.data.number : 'bez numeru'
  const amount = typeof event.data?.amountNetto === 'number' ? ` · ${pln(event.data.amountNetto)}` : ' · bez kwoty'
  return `${number} · ${day(event.start)}${amount}`
}

function amountOptionLabel(option: AmountOption): string {
  if (option.kind === 'add_extra') return `Dopisz dosprzedaż +${pln(option.amount)}`
  if (option.kind === 'adjust_extra') return `Zmień dosprzedaż ${pln(option.from)} → ${pln(option.to)}`
  if (option.kind === 'remove_extras') return `Usuń dosprzedaż spoza faktury (${pln(option.amount)})`
  if (option.kind === 'accept') return 'Przyjmij kwotę z KSeF'
  return 'Czeka na korektę'
}

interface Actions {
  projectNames: Map<string, string>
  projectOptions: { id: string; label: string }[]
  allDocuments: ReconcileResult['documents']
  assign: (ksefNumber: string, projectId: string | null, label: string) => void
  pair: (ksefNumber: string, eventId: string) => void
  apply: (row: ReconcileRow) => void
  noInvoice: (row: ReconcileRow, on: boolean) => void
  setClient: (row: ReconcileRow, to: string) => void
  resolveAmount: (row: ReconcileRow, option: AmountOption) => void
  reopenAmount: (row: ReconcileRow) => void
  removeHubInvoice: (event: TimelineEvent) => void
  openProject: (id: string) => void
}

function ChangeList({ changes, projectNames }: { changes: KsefChange[]; projectNames: Map<string, string> }) {
  const show = (field: string, value: unknown): string => {
    if (value === undefined || value === null || value === '') return '—'
    if (field === 'projectId') return projectNames.get(String(value)) ?? String(value)
    if (field === 'start' || field === 'data.dueDate' || field === 'data.issueDate') return day(String(value))
    if (field === 'data.amountNetto') return money(Number(value))
    if (field === 'data.buyerId') return String(value).replace(/^Nip:/, 'NIP ').replace(/^VatUe:/, 'VAT UE ')
    if (field === 'data.corrections' && Array.isArray(value)) {
      return value.map((c: { number?: string; netChange?: number; currency?: string }) => `${c.number} (${c.netChange} ${c.currency})`).join(', ')
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
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

/** Wybór faktury z KSeF dla projektu: najpierw te bez projektu, potem przypisane gdzie indziej. */
function InvoicePicker({ row, actions, busy }: { row: ReconcileRow; actions: Actions; busy: boolean }) {
  const [value, setValue] = useState('')
  const own = new Set(row.documents.map((d) => d.sale.ksefNumber))
  const others = actions.allDocuments.filter(({ document }) => !own.has(document.sale.ksefNumber))
  const free = others.filter((entry) => !entry.projectId)
  const taken = others.filter((entry) => entry.projectId)
  if (!others.length) return null
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select value={value} onChange={(e) => setValue(e.target.value)} className={`${selectClass} w-72`} aria-label="Faktura z KSeF do przypisania">
        <option value="">{row.documents.length ? 'Dodaj kolejną fakturę z KSeF…' : 'Przypisz fakturę z KSeF…'}</option>
        {free.length > 0 && (
          <optgroup label="Bez projektu">
            {free.map(({ document }) => (
              <option key={document.sale.ksefNumber} value={document.sale.ksefNumber}>
                {documentLabel(document)}
              </option>
            ))}
          </optgroup>
        )}
        {taken.length > 0 && (
          <optgroup label="Przenieś z innego projektu">
            {taken.map(({ document, projectId }) => (
              <option key={document.sale.ksefNumber} value={document.sale.ksefNumber}>
                {documentLabel(document)} ← {actions.projectNames.get(projectId!) ?? ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !value}
        onClick={() => {
          actions.assign(value, row.project.id, `Faktura przypisana do „${row.project.name}”. Sprawdź zmiany i kliknij „Zastosuj z KSeF”.`)
          setValue('')
        }}
      >
        Przypisz
      </Button>
    </span>
  )
}

function RowCard({ row, busy, actions }: { row: ReconcileRow; busy: boolean; actions: Actions }) {
  const status = STATUS[row.status]
  const suggested = row.documents.some((d) => d.reason === 'suggested')
  const invoiceChanges = row.changes.filter((c) => c.kind !== 'client')
  const clientChange = row.changes.find((c): c is Extract<KsefChange, { kind: 'client' }> => c.kind === 'client')
  const documentsByNumber = new Map(actions.allDocuments.map(({ document }) => [document.sale.ksefNumber, document]))
  return (
    <li className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={() => actions.openProject(row.project.id)} className="text-left text-sm font-medium text-zinc-100 hover:underline">
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
              <div className={`tabular-nums ${row.amountState === 'open' ? 'text-amber-300' : 'text-zinc-400'}`}>
                {row.diff > 0 ? '+' : ''}
                {pln(row.diff)}
              </div>
            </div>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
        </div>
      </div>

      {row.documents.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-xs text-zinc-400">
          {row.documents.map((document) => {
            const pair = row.pairs.find((p) => p.ksefNumber === document.sale.ksefNumber)
            return (
              <li key={document.sale.ksefNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <FileText className="mr-1 inline size-3 text-zinc-600" />
                  <span className="text-zinc-200">{document.sale.invoiceNumber}</span> · {day(document.sale.ksefDate)} · {documentAmount(document)} ·{' '}
                  <span className={document.reason === 'suggested' ? 'text-amber-300' : 'text-zinc-500'}>{MATCH_REASON_TEXT[document.reason]}</span>
                  {document.corrections.map((c) => (
                    <span key={c.ksefNumber} className="ml-2 text-zinc-500">
                      + korekta {c.invoiceNumber} ({c.netAmount} {c.currency})
                    </span>
                  ))}
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  {pair && !pair.saved && row.replaceable.length > 0 && (
                    <label className="flex items-center gap-1 text-zinc-500">
                      w hubie
                      <select
                        value={pair.eventId ?? 'new'}
                        disabled={busy}
                        onChange={(e) => actions.pair(document.sale.ksefNumber, e.target.value)}
                        className={`${selectClass} w-56`}
                      >
                        {row.replaceable.map((event) => (
                          <option key={event.id} value={event.id}>
                            zastąpi wpis: {hubInvoiceLabel(event)}
                          </option>
                        ))}
                        <option value="new">doda się jako nowa faktura</option>
                      </select>
                    </label>
                  )}
                  <select
                    value={row.project.id}
                    disabled={busy}
                    aria-label="Projekt tej faktury"
                    onChange={(e) =>
                      actions.assign(
                        document.sale.ksefNumber,
                        e.target.value || null,
                        e.target.value ? `Faktura ${document.sale.invoiceNumber} przeniesiona do „${actions.projectNames.get(e.target.value) ?? ''}”.` : `Faktura ${document.sale.invoiceNumber} odpięta — czeka w „Faktury bez projektu”.`,
                      )
                    }
                    className={`${selectClass} w-44`}
                  >
                    <option value={row.project.id}>ten projekt</option>
                    <option value="">odepnij od projektu</option>
                    <optgroup label="Przenieś do">
                      {actions.projectOptions
                        .filter((p) => p.id !== row.project.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {row.extraHubInvoices.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-amber-300/90">
          {row.extraHubInvoices.map((event) => (
            <p key={event.id} className="flex flex-wrap items-center gap-2">
              <span>
                <AlertTriangle className="mr-1 inline size-3" />W hubie jest faktura, której nie ma w KSeF: {hubInvoiceLabel(event)}. Jeśli to ta sama
                faktura co wyżej, wybierz przy niej „zastąpi wpis”; jeśli pomyłka, usuń wpis.
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => actions.removeHubInvoice(event)}>
                Usuń wpis z huba
              </Button>
            </p>
          ))}
        </div>
      )}

      {invoiceChanges.length > 0 && <ChangeList changes={invoiceChanges} projectNames={actions.projectNames} />}

      {row.amountState && (
        <div className="mt-2 rounded-md border border-amber-500/15 bg-amber-500/5 px-2.5 py-2 text-xs">
          {row.amountState === 'open' ? (
            <>
              <p className="text-amber-200/90">
                Faktury w KSeF: {pln(row.ksefTotal ?? 0)}, cena z dosprzedażą w hubie: {pln(row.hubValue ?? 0)}. Po zapisaniu faktur o przychodzie
                decydują one. Co zrobić z różnicą {pln(Math.abs(row.diff ?? 0))}?
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {row.amountOptions.map((option, index) => (
                  <Button key={option.kind} size="sm" variant={index === 0 ? 'default' : 'outline'} disabled={busy} onClick={() => actions.resolveAmount(row, option)}>
                    {amountOptionLabel(option)}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-zinc-400">
              {row.amountState === 'awaiting'
                ? `Różnica ${pln(Math.abs(row.diff ?? 0))} czeka na fakturę korygującą; po jej pobraniu z KSeF sprawa wróci sama.`
                : `Różnica ${pln(Math.abs(row.diff ?? 0))} przyjęta: o przychodzie decydują faktury.`}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => actions.reopenAmount(row)}>
                <Undo2 className="size-3.5" />
                Wróć do różnicy
              </Button>
            </p>
          )}
        </div>
      )}

      {row.invoiceCandidates.length > 0 && (
        <div className="mt-2 rounded-md border border-white/5 bg-black/20 px-2.5 py-2 text-xs">
          <p className="text-zinc-400">{row.documents.length ? 'Faktury bez projektu, które mogą uzupełniać ten projekt:' : 'Faktury bez projektu, które tu pasują:'}</p>
          <ul className="mt-1 space-y-1">
            {row.invoiceCandidates.map((candidate) => {
              const document = documentsByNumber.get(candidate.id)
              if (!document) return null
              return (
                <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-zinc-200">
                    {documentLabel(document)} <span className="text-zinc-500">— {candidate.reasons.join(', ')}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => actions.assign(candidate.id, row.project.id, `Faktura ${document.sale.invoiceNumber} przypisana do „${row.project.name}”.`)}
                  >
                    Przypisz
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {row.status === 'missing' && row.invoiceCandidates.length === 0 && (
        <p className="mt-2 text-xs text-rose-300/90">
          Zakończony projekt bez faktury w KSeF i bez pasującej faktury wśród nieprzypisanych. Wystaw fakturę, wskaż ją ręcznie albo oznacz projekt jako
          „bez faktury”.
        </p>
      )}
      {clientChange && (
        <p className="mt-2 text-xs text-zinc-400">
          Faktury tej firmy są w hubie pod nazwą <span className="text-zinc-200">„{clientChange.to}”</span>, a ten projekt ma klienta „{clientChange.from}”.
          Jedna firma = jedna nazwa wyświetlana; zmienisz ją potem w Klientach („Scal nazwy”).
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {row.status !== 'no_invoice' && <InvoicePicker row={row} actions={actions} busy={busy} />}
        {row.status === 'missing' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.noInvoice(row, true)}>
            <CircleSlash className="size-3.5" />
            Bez faktury (barter, inne)
          </Button>
        )}
        {row.status === 'no_invoice' && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => actions.noInvoice(row, false)}>
            Cofnij „bez faktury”
          </Button>
        )}
        {clientChange && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.setClient(row, clientChange.to)}>
            Ustaw klienta „{clientChange.to}”
          </Button>
        )}
        {invoiceChanges.length > 0 && (
          <Button size="sm" disabled={busy} onClick={() => actions.apply(row)}>
            <Check className="size-3.5" />
            {suggested ? 'To ten projekt — zastosuj z KSeF' : 'Zastosuj z KSeF'}
          </Button>
        )}
      </div>
    </li>
  )
}

function UnassignedInvoice({
  entry,
  busy,
  actions,
}: {
  entry: ReconcileResult['unassigned'][number]
  busy: boolean
  actions: Actions
}) {
  const [value, setValue] = useState('')
  const { document, candidates, detached } = entry
  const key = document.sale.ksefNumber
  const assign = (projectId: string) =>
    actions.assign(key, projectId, `Faktura ${document.sale.invoiceNumber} przypisana do „${actions.projectNames.get(projectId) ?? ''}” — sprawdź zmiany przy projekcie.`)
  return (
    <li className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 text-xs">
      <div className="text-zinc-200">
        {documentLabel(document)}
        {detached && <span className="ml-2 text-zinc-500">odpięta ręcznie</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {candidates.map((candidate) => (
          <Button key={candidate.id} size="sm" variant="outline" disabled={busy} onClick={() => assign(candidate.id)} title={candidate.reasons.join(', ')}>
            → {actions.projectNames.get(candidate.id) ?? candidate.id}
            <span className="font-normal text-zinc-500">{candidate.reasons.join(', ')}</span>
          </Button>
        ))}
        {candidates.length === 0 && <span className="text-rose-300/90">Żaden projekt nie pasuje klientem ani kwotą — może brakuje projektu w hubie.</span>}
        <span className="ml-auto flex items-center gap-2">
          <select value={value} onChange={(e) => setValue(e.target.value)} className={`${selectClass} w-64`} aria-label="Projekt dla faktury">
            <option value="">Inny projekt…</option>
            {actions.projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={busy || !value} onClick={() => assign(value)}>
            Przypisz
          </Button>
        </span>
      </div>
    </li>
  )
}

type KsefTab = 'match' | 'invoices'

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
  const { allEvents, save, remove } = useEvents()
  const [tab, setTab] = useState<KsefTab>('match')
  const [sales, setSales] = useState<KsefCache | null>(null)
  const [purchases, setPurchases] = useState<KsefCache | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [decisions, setDecisions] = useState<KsefDecision[]>([])
  const [details, setDetails] = useState<ClientDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [readSales, readPurchases, savedDecisions, savedDetails] = await Promise.all([
      readKsefCache('sale'),
      readKsefCache('purchase'),
      listKsefDecisions(),
      listClientDetails(),
    ])
    setSales(readSales.cache)
    setPurchases(readPurchases.cache)
    setError(readSales.error ?? readPurchases.error)
    setDecisions(savedDecisions)
    setDetails(savedDetails)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const inPeriod = useCallback((value: string) => isInPeriod(value, period), [period])
  const result = useMemo(
    () =>
      reconcileKsef({
        projects: projects.map((p) => ({ id: p.id, name: p.name, client: p.client ?? '', status: p.status, date: p.date ?? '', deletedAt: p.deletedAt })),
        expected: new Map([...moneyById].map(([id, m]) => [id, m.expected])),
        extras: new Map([...moneyById].map(([id, m]) => [id, m.extras.map((e) => ({ id: e.id, amount: e.amount, what: e.what }))])),
        events: allEvents,
        invoices: sales?.invoices ?? [],
        details,
        decisions,
        inPeriod,
        now: new Date().toISOString(),
      }),
    [projects, moneyById, allEvents, sales, details, decisions, inPeriod],
  )

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const projectOptions = useMemo(
    () =>
      projects
        // Faktury w KSeF są od lutego 2026: starsze projekty tylko zaśmiecałyby listę.
        .filter((p) => !p.deletedAt && p.status !== 'lost' && (p.date ?? '') >= PROJECTS_SINCE)
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .map((p) => ({ id: p.id, label: `${p.name} (${p.client || 'bez klienta'})` })),
    [projects],
  )
  const projectOfInvoice = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    result.documents.forEach(({ document, projectId }) => {
      if (!projectId) return
      const entry = { id: projectId, name: projectNames.get(projectId) ?? '' }
      map.set(document.sale.ksefNumber, entry)
      document.corrections.forEach((c) => map.set(c.ksefNumber, entry))
    })
    return map
  }, [result.documents, projectNames])

  const run = async (work: () => Promise<unknown>, message: string) => {
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
      // Zmiana klienta ma własny przycisk: zapis faktury jej nie wymusza.
    }
  }

  const resolveAmount = async (row: ReconcileRow, option: AmountOption) => {
    const now = new Date().toISOString()
    const id = `amount:${row.project.id}`
    if (option.kind === 'accept') {
      await upsertKsefDecision({ id, kind: 'accept_amount', projectId: row.project.id, amount: row.diff ?? 0, at: now })
    } else if (option.kind === 'await_correction') {
      await upsertKsefDecision({ id, kind: 'await_correction', projectId: row.project.id, at: now })
    } else if (option.kind === 'add_extra') {
      const last = row.documents.at(-1)?.sale
      await save(
        createEvent({
          kind: 'extra_sale',
          start: last?.ksefDate ?? now.slice(0, 10),
          projectId: row.project.id,
          data: { what: `Różnica wg faktury KSeF${last ? ` ${last.invoiceNumber}` : ''}`, amountNetto: option.amount, ...(last ? { number: last.invoiceNumber } : {}) },
        }),
      )
    } else if (option.kind === 'adjust_extra') {
      const event = allEvents.find((e) => e.id === option.eventId)
      if (event) await save({ ...event, data: { ...event.data, amountNetto: option.to }, updatedAt: now })
    } else {
      for (const eventId of option.eventIds) await remove(eventId)
    }
  }

  const actions: Actions = {
    projectNames,
    projectOptions,
    allDocuments: result.documents,
    assign: (ksefNumber, projectId, label) =>
      void run(
        () =>
          upsertKsefDecision(
            projectId
              ? { id: `assign:${ksefNumber}`, kind: 'assign', projectId, ksefNumber, at: new Date().toISOString() }
              : { id: `assign:${ksefNumber}`, kind: 'unassign', projectId: '', ksefNumber, at: new Date().toISOString() },
          ),
        label,
      ),
    pair: (ksefNumber, eventId) =>
      void run(
        () => upsertKsefDecision({ id: `pair:${ksefNumber}`, kind: 'pair', projectId: '', ksefNumber, eventId, at: new Date().toISOString() }),
        eventId === 'new' ? 'Faktura dopisze się jako nowa.' : 'Faktura zastąpi wskazany wpis.',
      ),
    apply: (row) => void run(() => applyRow(row), `Zastosowano KSeF w „${row.project.name}”.`),
    noInvoice: (row, on) =>
      void run(
        () =>
          on
            ? upsertKsefDecision({ id: `none:${row.project.id}`, kind: 'no_invoice', projectId: row.project.id, at: new Date().toISOString() })
            : removeKsefDecision(`none:${row.project.id}`),
        on ? `„${row.project.name}” oznaczony jako bez faktury.` : 'Cofnięto.',
      ),
    setClient: (row, to) => void run(() => updateProject(row.project.id, { client: to }), `„${row.project.name}”: klient „${to}”.`),
    resolveAmount: (row, option) => void run(() => resolveAmount(row, option), `„${row.project.name}”: ${amountOptionLabel(option).toLowerCase()}.`),
    reopenAmount: (row) => void run(() => removeKsefDecision(`amount:${row.project.id}`), 'Różnica znów czeka na decyzję.'),
    removeHubInvoice: (event) => void run(() => remove(event.id), 'Wpis faktury usunięty z projektu (da się przywrócić w projekcie).'),
    openProject: onOpenProject,
  }

  const bulk = result.rows.filter(safeToApplyInBulk)
  const counts = result.rows.reduce<Record<RowStatus, number>>((acc, row) => ({ ...acc, [row.status]: acc[row.status] + 1 }), EMPTY_COUNTS)
  const fetched = sales ?? purchases

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
          <div className="min-w-0">
            <h2 className="font-semibold text-zinc-200">KSeF · {periodLabel}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {fetched
                ? `Pobrane ${day(fetched.fetchedAt)} ${new Date(fetched.fetchedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}: ${sales?.invoices.length ?? 0} faktur sprzedaży i ${purchases?.invoices.length ?? 0} zakupu od ${day(fetched.from)}.`
                : 'Faktur jeszcze nie pobrano.'}{' '}
              Nowe faktury pobiera polecenie <code className="text-zinc-300">npm run data -- ksef-sync</code> w terminalu (albo Claude na czacie), potem
              „Odśwież”. KSeF jest tu tylko czytany — faktury wystawiasz w panelu biura rachunkowego.
            </p>
            {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            Odśwież
          </Button>
        </div>
        {fetched && (
          <div className="mt-3 inline-flex rounded-lg border border-white/10 p-0.5 text-sm" role="tablist" aria-label="Widok KSeF">
            {(
              [
                ['match', 'Zgodność z projektami'],
                ['invoices', 'Faktury'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded-md px-3 py-1 ${tab === value ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {notice && <p className="mt-2 text-xs text-emerald-300">{notice}</p>}
      </section>

      {!fetched ? null : tab === 'invoices' ? (
        <KsefInvoiceList sales={sales} purchases={purchases} inPeriod={inPeriod} periodLabel={periodLabel} projectOfInvoice={projectOfInvoice} onOpenProject={onOpenProject} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(Object.keys(STATUS) as RowStatus[])
              .filter((key) => counts[key] > 0)
              .map((key) => (
                <span key={key} className={`rounded-full px-2 py-0.5 ${STATUS[key].className}`}>
                  {STATUS[key].label}: {counts[key]}
                </span>
              ))}
            {result.unassigned.length > 0 && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-300">Faktury bez projektu: {result.unassigned.length}</span>}
            {result.pendingDetails > 0 && (
              <span className="text-zinc-500">
                {result.pendingDetails} {plural(result.pendingDetails, 'faktura czeka', 'faktury czekają', 'faktur czeka')} na pobranie treści
              </span>
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

          {result.unassigned.length > 0 && (
            <section className="rounded-xl border border-rose-500/20 bg-zinc-900/40 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">Faktury bez projektu</h2>
              <p className="mb-2 text-xs text-zinc-500">
                Hub nie wskazał jednego projektu. Przyciski to najlepsi kandydaci (klient, kwota, data); inny projekt wybierzesz z listy.
              </p>
              <ul className="space-y-2">
                {result.unassigned.map((entry) => (
                  <UnassignedInvoice key={entry.document.sale.ksefNumber} entry={entry} busy={busy} actions={actions} />
                ))}
              </ul>
            </section>
          )}

          {result.rows.length === 0 && result.unassigned.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-600">Brak faktur i projektów w tym okresie.</p>
          )}
          <ul className="space-y-2">
            {result.rows.map((row) => (
              <RowCard key={row.project.id} row={row} busy={busy} actions={actions} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
