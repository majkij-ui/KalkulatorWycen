'use client'

/**
 * Zakładka „Zakupy KSeF" na ekranie Sprzęt: faktury zakupu z kopii KSeF
 * rozpisane na wiersze. Każdy wiersz dostaje decyzję: nowy sprzęt (na plan
 * albo zaplecze), połączenie z pozycją, która już jest w katalogu, albo
 * kategoria wydatku. Zasady i zapis: `lib/ksef-purchases.ts`.
 *
 * Sprzęt z faktury trafia do katalogu, więc Finanse liczą go jak każdy inny
 * zakup (`gear-costs.ts`); kategorie wydatków są na razie tylko spisem.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileText, Loader2, Search, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InvoiceDialog, day, money } from '@/components/finance/ksef-invoice-list'
import { useEquipment } from '@/lib/equipment-context'
import { isInPeriod, periodLabel, type Period } from '@/lib/finance-calc'
import { syncProgressText, syncSummary } from '@/lib/ksef-app-bridge'
import { canSyncKsefHere, syncKsefFromApp } from '@/lib/ksef-app-sync'
import type { KsefCache } from '@/lib/ksef-cache'
import {
  FUEL_COMPANY_SHARE,
  PURCHASE_BUCKET_LABEL,
  PURCHASE_CATEGORIES,
  categoryDecision,
  categoryDecisionIds,
  invoicesCoverItem,
  lineBucket,
  lineCategoryDecisionId,
  lineUnits,
  linkLine,
  newItemFromLine,
  purchaseBook,
  purchaseTotals,
  sellerCategoryDecisionId,
  suggestedItems,
  unlinkLine,
  type PurchaseBucket,
  type PurchaseCategory,
  type PurchaseEntry,
  type PurchaseLine,
} from '@/lib/ksef-purchases'
import type { KsefDecision } from '@/lib/ksef-reconcile'
import { listKsefDecisions, readKsefCache, removeKsefDecision, upsertKsefDecision } from '@/lib/ksef-store'
import { plural } from '@/lib/pl-plural'
import { EQUIPMENT_CATEGORIES, equipmentCategoryLabel, unitsOwned, type EquipmentItem } from '@/lib/project-types'
import { purchaseVatDecisionId } from '@/lib/taxes'

const PRIVATE = 'private'
type Filter = 'todo' | 'all' | PurchaseBucket
const BUCKET_ORDER: PurchaseBucket[] = ['gear', 'backstage', 'fuel', 'car', 'subscription', 'project', 'office', 'other', 'private']

const CHIP: Record<'gear' | 'category' | 'private' | 'todo' | 'returned', string> = {
  gear: 'bg-emerald-500/10 text-emerald-300',
  category: 'bg-sky-500/10 text-sky-300',
  private: 'bg-zinc-500/10 text-zinc-400',
  todo: 'bg-amber-500/10 text-amber-300',
  returned: 'bg-zinc-500/10 text-zinc-500',
}

const selectClass = 'h-8 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-200'
const smallButton = 'h-8 rounded-md border border-white/10 px-2.5 text-xs text-zinc-200 hover:border-white/25 disabled:opacity-40'

function amount(text: string): number {
  const value = Number(text.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(value) && value >= 0 ? value : 0
}

type Draft =
  | { mode: 'new'; onSet: boolean; name: string; price: string; category: string }
  | { mode: 'link'; itemId: string; adopt: boolean }

export function KsefPurchasesPanel({ period, onOpenItem }: { period: Period | null; onOpenItem: (id: string) => void }) {
  const { allItems, addItem, updateItem } = useEquipment()
  const [cache, setCache] = useState<KsefCache | null>(null)
  const [decisions, setDecisions] = useState<KsefDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('todo')
  const [query, setQuery] = useState('')
  const [openNumber, setOpenNumber] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ key: string; value: Draft } | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [purchases, savedDecisions] = await Promise.all([readKsefCache('purchase'), listKsefDecisions()])
    setCache(purchases.cache)
    setDecisions(savedDecisions)
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const entries = useMemo(() => purchaseBook({ invoices: cache?.invoices ?? [], decisions, items: allItems }), [cache, decisions, allItems])
  const inRange = useMemo(() => entries.filter((entry) => !period || isInPeriod(entry.invoice.issueDate, period)), [entries, period])
  const totals = useMemo(() => purchaseTotals(inRange), [inRange])
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl')
    return inRange
      .map((entry) => {
        const lines =
          filter === 'all' ? entry.lines : entry.lines.filter((line) => (filter === 'todo' ? line.status.kind === 'todo' && !line.returned : lineBucket(line) === filter && !line.returned))
        return { entry, lines }
      })
      .filter(({ entry, lines }) => {
        if (lines.length === 0) return false
        if (!needle) return true
        const text = `${entry.invoice.counterpartyName} ${entry.invoice.invoiceNumber} ${entry.invoice.counterpartyNip} ${entry.lines.map((l) => l.name).join(' ')}`
        return text.toLocaleLowerCase('pl').includes(needle)
      })
  }, [inRange, filter, query])
  const openEntry = openNumber ? (entries.find((entry) => entry.invoice.ksefNumber === openNumber) ?? null) : null
  const itemsByName = useMemo(() => [...allItems].sort((a, b) => a.name.localeCompare(b.name, 'pl')), [allItems])

  const run = async (work: () => Promise<void>, done?: string) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setProblem(null)
    try {
      await work()
      if (done) setNotice(done)
      setEditing(null)
      setDraft(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Nie udało się zapisać.')
    } finally {
      setBusy(false)
    }
  }

  const syncFromKsef = async () => {
    setNotice(null)
    setProblem(null)
    setSyncing('Łączę się z KSeF…')
    const outcome = await syncKsefFromApp({
      onProgress: (progress) => {
        const text = syncProgressText(progress)
        if (text) setSyncing(text)
      },
    })
    if (outcome.ok) {
      const summary = syncSummary(outcome.result)
      await load()
      setNotice(summary.text)
      if (summary.warning) setProblem(summary.warning)
    } else {
      setProblem(outcome.reason === 'error' ? outcome.message : `${outcome.message} Ustawisz to w Finanse → KSeF.`)
    }
    setSyncing(null)
  }

  /** Kategoria dla wiersza albo całej faktury; „nie dotyczy firmy" to ta sama decyzja co w Finansach (VAT 0%). */
  const setCategory = (entry: PurchaseEntry, line: PurchaseLine | null, value: string) =>
    run(async () => {
      const at = new Date().toISOString()
      const { ksefNumber } = entry.invoice
      const vatId = purchaseVatDecisionId(ksefNumber)
      if (value === PRIVATE) {
        await upsertKsefDecision({ id: vatId, kind: 'purchase_vat', projectId: '', ksefNumber, amount: 0, at })
      } else {
        if (decisions.some((d) => d.id === vatId && d.kind === 'purchase_vat' && d.amount === 0)) await removeKsefDecision(vatId)
        await upsertKsefDecision(categoryDecision(line ? 'line' : 'invoice', entry, line, value as PurchaseCategory, at))
      }
      setDecisions(await listKsefDecisions())
    })

  const setSellerCategory = (entry: PurchaseEntry, category: PurchaseCategory) =>
    run(
      async () => {
        await upsertKsefDecision(categoryDecision('seller', entry, null, category, new Date().toISOString()))
        setDecisions(await listKsefDecisions())
      },
      `Faktury od ${entry.invoice.counterpartyName} trafiają do „${PURCHASE_BUCKET_LABEL[category]}".`
    )

  /** Cofa decyzję wiersza: odpina sprzęt albo usuwa decyzję o kategorii z miejsca, z którego pochodzi. */
  const undo = (entry: PurchaseEntry, line: PurchaseLine) =>
    run(async () => {
      const { ksefNumber, counterpartyNip } = entry.invoice
      if (line.status.kind === 'gear') {
        for (const linked of line.status.items) {
          const item = allItems.find((i) => i.id === linked.id)
          if (item) await updateItem(unlinkLine(item, line.key))
        }
        return
      }
      if (line.status.kind === 'private') await removeKsefDecision(purchaseVatDecisionId(ksefNumber))
      if (line.status.kind === 'category') {
        if (line.status.source === 'line') await removeKsefDecision(lineCategoryDecisionId(ksefNumber, line.index))
        if (line.status.source === 'invoice') for (const id of categoryDecisionIds(entry)) if (decisions.some((d) => d.id === id)) await removeKsefDecision(id)
        if (line.status.source === 'seller' && counterpartyNip) await removeKsefDecision(sellerCategoryDecisionId(counterpartyNip))
      }
      setDecisions(await listKsefDecisions())
    })

  const createItem = (entry: PurchaseEntry, line: PurchaseLine, value: Extract<Draft, { mode: 'new' }>) =>
    run(
      async () => {
        const base = newItemFromLine(entry, line, value.onSet)
        const name = value.name.trim() || base.name
        await addItem({ ...base, name, category: value.onSet ? value.category : 'inne', purchasePrice: amount(value.price) })
      },
      value.onSet ? 'Dodano do sprzętu na plan.' : 'Dodano do zaplecza i drobiazgów.'
    )

  const connect = (entry: PurchaseEntry, line: PurchaseLine, value: Extract<Draft, { mode: 'link' }>) =>
    run(async () => {
      const item = allItems.find((i) => i.id === value.itemId)
      if (!item) return
      await updateItem(linkLine(item, entry, line, value.adopt))
    }, 'Faktura przypięta do pozycji.')

  const startLink = (entry: PurchaseEntry, line: PurchaseLine, itemId: string) => {
    const item = allItems.find((i) => i.id === itemId)
    setDraft({ key: line.key, value: { mode: 'link', itemId, adopt: item ? invoicesCoverItem(item, lineUnits(line)) : false } })
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" /> Wczytuję faktury…
      </div>
    )
  }

  const label = period ? periodLabel(period) : 'całość'
  const chips: { value: Filter; label: string; count?: number; sum?: number }[] = [
    { value: 'todo', label: 'Do decyzji', count: totals.todo },
    { value: 'all', label: 'Wszystkie', count: totals.invoices },
    ...BUCKET_ORDER.filter((bucket) => totals.byBucket[bucket] !== undefined).map((bucket) => ({ value: bucket as Filter, label: PURCHASE_BUCKET_LABEL[bucket], sum: totals.byBucket[bucket] })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={`Wydatki firmy · ${label}`} value={money(totals.company)} hint={`${totals.invoices} ${plural(totals.invoices, 'faktura', 'faktury', 'faktur')}, paliwo w połowie`} />
        <Tile label="Sprzęt na plan" value={money(totals.byBucket.gear ?? 0)} />
        <Tile label="Zaplecze i drobiazgi" value={money(totals.byBucket.backstage ?? 0)} />
        <Tile
          label="Paliwo"
          value={money(totals.byBucket.fuel ?? 0)}
          hint={totals.byBucket.fuel ? `firmowa połowa: ${money((totals.byBucket.fuel ?? 0) * FUEL_COMPANY_SHARE)}` : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Które wiersze">
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              role="tab"
              aria-selected={filter === chip.value}
              onClick={() => setFilter(chip.value)}
              className={`rounded-md border px-2.5 py-1 text-xs ${filter === chip.value ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-zinc-400 hover:text-zinc-200'}`}
            >
              {chip.label}{' '}
              <span className="tabular-nums text-zinc-500">{chip.count !== undefined ? chip.count : money(chip.sum ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-56 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sprzedawca, numer, pozycja" className="h-8 border-white/10 bg-black/40 pl-8 text-sm" />
        </div>
        {canSyncKsefHere() && (
          <Button variant="outline" className="h-8 gap-1.5 border-white/10 text-xs" onClick={() => void syncFromKsef()} disabled={syncing !== null}>
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {syncing ?? 'Pobierz z KSeF'}
          </Button>
        )}
      </div>
      {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      {problem && <p className="text-xs text-amber-300">{problem}</p>}

      {!cache ? (
        <p className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-zinc-600">Faktur zakupu jeszcze nie pobrano z KSeF.</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-zinc-600">
          {filter === 'todo' && !query ? 'Wszystkie wiersze z tego okresu są rozpisane.' : 'Brak faktur dla tego wyboru.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map(({ entry, lines }) => {
            const { invoice } = entry
            const wholeCategory = entry.lines.find((line) => line.status.kind === 'category' && line.status.source === 'invoice')
            const invoiceCategory = wholeCategory?.status.kind === 'category' ? wholeCategory.status.category : null
            return (
              <li key={invoice.ksefNumber} className="rounded-xl border border-white/5 bg-zinc-900/40">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/5 px-4 py-2.5">
                  <div className="w-20 shrink-0 text-xs tabular-nums text-zinc-500">{day(invoice.issueDate)}</div>
                  <div className="min-w-[180px] flex-1">
                    <div className="truncate text-sm font-semibold text-zinc-100">{invoice.counterpartyName || '—'}</div>
                    <button type="button" onClick={() => setOpenNumber(invoice.ksefNumber)} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                      <FileText className="size-3" />
                      {invoice.invoiceNumber}
                      {entry.looseCorrection && <span className="text-amber-300/80"> · korekta do rozpisania ręcznie</span>}
                      {entry.corrections.length > 0 && <span> · z korektą {entry.corrections.map((c) => c.invoiceNumber).join(', ')}</span>}
                    </button>
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums text-zinc-100">{money(entry.cost, invoice.currency)}</div>
                  <select
                    aria-label={`Kategoria całej faktury ${invoice.invoiceNumber}`}
                    className={selectClass}
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && void setCategory(entry, null, e.target.value)}
                  >
                    <option value="">Cała faktura…</option>
                    {PURCHASE_CATEGORIES.map((category) => (
                      <option key={category.key} value={category.key}>
                        {category.label}
                      </option>
                    ))}
                    <option value={PRIVATE}>Nie dotyczy firmy</option>
                  </select>
                </div>
                {invoiceCategory && invoice.counterpartyNip && (
                  <div className="border-b border-white/5 px-4 py-1.5 text-xs">
                    <button type="button" disabled={busy} onClick={() => void setSellerCategory(entry, invoiceCategory)} className="text-zinc-400 underline decoration-zinc-700 hover:text-zinc-200">
                      Zawsze „{PURCHASE_BUCKET_LABEL[invoiceCategory]}" dla tego sprzedawcy
                    </button>
                  </div>
                )}
                <ul>
                  {lines.map((line) => (
                    <LineRow
                      key={line.key}
                      entry={entry}
                      line={line}
                      items={itemsByName}
                      suggestions={line.status.kind === 'todo' && !line.returned ? suggestedItems(entry, line, allItems) : []}
                      open={line.status.kind === 'todo' ? !line.returned : editing === line.key}
                      draft={draft?.key === line.key ? draft.value : null}
                      busy={busy}
                      onEdit={() => setEditing(editing === line.key ? null : line.key)}
                      onDraft={(value) => setDraft(value ? { key: line.key, value } : null)}
                      onStartLink={(itemId) => startLink(entry, line, itemId)}
                      onCreate={(value) => void createItem(entry, line, value)}
                      onConnect={(value) => void connect(entry, line, value)}
                      onCategory={(value) => void setCategory(entry, line, value)}
                      onUndo={() => void undo(entry, line)}
                      onOpenItem={onOpenItem}
                    />
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}

      {openEntry && (
        <InvoiceDialog invoice={openEntry.invoice} payment={null} vatShare={null} onPurchaseVat={() => undefined} onClose={() => setOpenNumber(null)} onOpenProject={() => undefined} />
      )}
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-white">{value}</div>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  )
}

function statusText(line: PurchaseLine): { text: string; tone: keyof typeof CHIP } {
  if (line.returned) return { text: 'Zwrócone', tone: 'returned' }
  if (line.status.kind === 'gear') return { text: line.status.items.some((item) => item.onSet) ? 'Sprzęt na plan' : 'Zaplecze i drobiazgi', tone: 'gear' }
  if (line.status.kind === 'private') return { text: 'Nie dotyczy firmy', tone: 'private' }
  if (line.status.kind === 'category') return { text: PURCHASE_BUCKET_LABEL[line.status.category], tone: 'category' }
  return { text: 'Do decyzji', tone: 'todo' }
}

function LineRow({
  entry,
  line,
  items,
  suggestions,
  open,
  draft,
  busy,
  onEdit,
  onDraft,
  onStartLink,
  onCreate,
  onConnect,
  onCategory,
  onUndo,
  onOpenItem,
}: {
  entry: PurchaseEntry
  line: PurchaseLine
  items: EquipmentItem[]
  suggestions: EquipmentItem[]
  open: boolean
  draft: Draft | null
  busy: boolean
  onEdit: () => void
  onDraft: (value: Draft | null) => void
  onStartLink: (itemId: string) => void
  onCreate: (value: Extract<Draft, { mode: 'new' }>) => void
  onConnect: (value: Extract<Draft, { mode: 'link' }>) => void
  onCategory: (value: string) => void
  onUndo: () => void
  onOpenItem: (id: string) => void
}) {
  const { currency, issueDate } = entry.invoice
  const status = statusText(line)
  const units = lineUnits(line)
  const hasLines = entry.invoice.details.lines.length > 0
  const decided = line.status.kind !== 'todo'
  const fromRule = line.status.kind === 'category' && line.status.source === 'rule'
  const startNew = (onSet: boolean) =>
    onDraft({ mode: 'new', onSet, name: line.name.replace(/\s+/g, ' ').trim(), price: currency === 'PLN' ? String(Math.round((line.cost / units) * 100) / 100).replace('.', ',') : '', category: 'inne' })
  const linkItem = draft?.mode === 'link' ? items.find((item) => item.id === draft.itemId) : undefined
  const adopted = linkItem && draft?.mode === 'link' ? linkLine(linkItem, entry, line, true) : undefined

  return (
    <li className="border-b border-white/5 px-4 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className={`min-w-[200px] flex-1 text-sm ${line.returned ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>
          {line.name || '—'}
          {units > 1 && <span className="ml-1.5 text-xs text-zinc-500">×{units}</span>}
        </div>
        {line.status.kind === 'gear' &&
          line.status.items.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenItem(item.id)} className="max-w-[220px] truncate text-xs text-zinc-400 underline decoration-zinc-700 hover:text-zinc-200">
              {item.name}
            </button>
          ))}
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${CHIP[status.tone]}`}>{status.text}</span>
        <div className="w-28 text-right text-sm tabular-nums text-zinc-100">
          {money(line.cost, currency)}
          {line.shipping > 0 && <span className="block text-[11px] text-zinc-600">w tym wysyłka {money(line.shipping, currency)}</span>}
        </div>
        {decided && !line.returned && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={onEdit} className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-200">
              zmień
            </button>
            {!fromRule && (
              <button type="button" onClick={onUndo} disabled={busy} aria-label={`Cofnij decyzję: ${line.name}`} title="Cofnij decyzję" className="rounded p-1 text-zinc-500 hover:text-zinc-200">
                <Undo2 className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {open && !draft && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {suggestions.map((item) => (
            <button key={item.id} type="button" disabled={busy} onClick={() => onStartLink(item.id)} className={`${smallButton} border-emerald-500/30 text-emerald-200`}>
              To „{item.name}"{item.purchasePrice > 0 ? ` (${money(item.purchasePrice)}${item.purchaseDate ? `, ${day(item.purchaseDate)}` : ''})` : ''}
            </button>
          ))}
          {hasLines && (
            <>
              <button type="button" disabled={busy} onClick={() => startNew(true)} className={smallButton}>
                Nowy sprzęt na plan
              </button>
              <button type="button" disabled={busy} onClick={() => startNew(false)} className={smallButton}>
                Do zaplecza i drobiazgów
              </button>
              <select aria-label={`Połącz z pozycją: ${line.name}`} className={selectClass} value="" disabled={busy} onChange={(e) => e.target.value && onStartLink(e.target.value)}>
                <option value="">Połącz z pozycją…</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.onSet === false ? ' (zaplecze)' : ''}
                  </option>
                ))}
              </select>
            </>
          )}
          <select aria-label={`Kategoria wydatku: ${line.name}`} className={selectClass} value="" disabled={busy} onChange={(e) => e.target.value && onCategory(e.target.value)}>
            <option value="">To nie sprzęt…</option>
            {PURCHASE_CATEGORIES.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {draft?.mode === 'new' && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onCreate(draft)
          }}
        >
          <label className="min-w-[220px] flex-1 text-[11px] text-zinc-500">
            Nazwa w hubie
            <Input value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} className="mt-1 h-8 border-white/10 bg-black/40 text-sm" autoFocus />
          </label>
          <label className="w-32 text-[11px] text-zinc-500">
            Cena netto{units > 1 ? ' / szt.' : ''}
            <Input value={draft.price} onChange={(e) => onDraft({ ...draft, price: e.target.value })} inputMode="decimal" className="mt-1 h-8 border-white/10 bg-black/40 text-sm tabular-nums" />
          </label>
          {draft.onSet && (
            <label className="text-[11px] text-zinc-500">
              Kategoria
              <select value={draft.category} onChange={(e) => onDraft({ ...draft, category: e.target.value })} className={`${selectClass} mt-1 block`}>
                {EQUIPMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {equipmentCategoryLabel(category)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="text-[11px] text-zinc-500">
            {draft.onSet ? 'Na plan' : 'Zaplecze'} · {units > 1 ? `${units} szt. · ` : ''}zakup {day(issueDate)}
          </div>
          <Button type="submit" className="h-8 text-xs" disabled={busy}>
            Dodaj
          </Button>
          <Button type="button" variant="ghost" className="h-8 text-xs text-zinc-400" onClick={() => onDraft(null)}>
            Anuluj
          </Button>
        </form>
      )}

      {draft?.mode === 'link' && linkItem && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-400">
          <span>
            Połącz z „<span className="text-zinc-100">{linkItem.name}</span>"{unitsOwned(linkItem) > 1 ? ` (×${unitsOwned(linkItem)})` : ''}.
          </span>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={draft.adopt} onChange={(e) => onDraft({ ...draft, adopt: e.target.checked })} />
            Ustaw cenę i datę z faktury
            {adopted && (
              <span className="tabular-nums text-zinc-500">
                ({money(linkItem.purchasePrice)} → {money(adopted.purchasePrice)}
                {unitsOwned(linkItem) > 1 ? '/szt.' : ''}, {linkItem.purchaseDate ? day(linkItem.purchaseDate) : 'bez daty'} → {day(adopted.purchaseDate)})
              </span>
            )}
          </label>
          <Button className="h-8 text-xs" disabled={busy} onClick={() => onConnect(draft)}>
            Połącz
          </Button>
          <Button variant="ghost" className="h-8 text-xs text-zinc-400" onClick={() => onDraft(null)}>
            Anuluj
          </Button>
        </div>
      )}
    </li>
  )
}
