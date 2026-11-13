'use client'

/**
 * Finanse → KSeF → „Faktury": lista faktur sprzedaży i zakupu z kopii KSeF,
 * z sumami okresu i podglądem treści (pozycje, terminy). KSeF przechowuje
 * faktury jako dane (XML), nie PDF — podgląd pokazuje to, co w nich jest.
 */

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { clientKey } from '@/lib/clients'
import type { KsefCache } from '@/lib/ksef-cache'
import type { KsefDirection, KsefSale } from '@/lib/ksef-invoices'
import { plural } from '@/lib/pl-plural'

export function day(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value || '—'
}

export function money(value: number, currency = 'PLN'): string {
  const text = value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'PLN' ? `${text} zł` : `${text} ${currency}`
}

const INVOICE_TYPES: Record<string, string> = {
  Vat: 'Faktura',
  Kor: 'Korekta',
  Zal: 'Zaliczkowa',
  Roz: 'Rozliczeniowa',
  Upr: 'Uproszczona',
  KorZal: 'Korekta zaliczkowej',
  KorRoz: 'Korekta rozliczeniowej',
}

interface Totals {
  count: number
  net: number
  vat: number
  gross: number
  /** Netto faktur w innych walutach, per waluta. */
  foreign: Map<string, number>
}

function totalsOf(invoices: KsefSale[]): Totals {
  const totals: Totals = { count: invoices.length, net: 0, vat: 0, gross: 0, foreign: new Map() }
  invoices.forEach((invoice) => {
    if (invoice.currency !== 'PLN') {
      totals.foreign.set(invoice.currency, (totals.foreign.get(invoice.currency) ?? 0) + invoice.netAmount)
      return
    }
    totals.net += invoice.netAmount
    totals.vat += invoice.vatAmount
    totals.gross += invoice.grossAmount
  })
  return totals
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-base font-semibold tabular-nums text-zinc-100">{value}</div>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  )
}

function InvoiceDialog({
  invoice,
  projectName,
  onClose,
  onOpenProject,
}: {
  invoice: KsefSale
  projectName?: { id: string; name: string } | null
  onClose: () => void
  onOpenProject: (id: string) => void
}) {
  const isSale = invoice.direction === 'sale'
  const rows: [string, string][] = [
    [isSale ? 'Nabywca' : 'Sprzedawca', `${invoice.counterpartyName || '—'}${invoice.counterpartyNip ? ` · NIP ${invoice.counterpartyNip}` : ''}`],
    ['Data wystawienia', day(invoice.issueDate)],
    ['Przyjęta w KSeF', day(invoice.ksefDate)],
    ['Termin płatności', invoice.hasDetails === false ? 'treść jeszcze niepobrana' : day(invoice.details.dueDate)],
    ['Netto', money(invoice.netAmount, invoice.currency)],
    ['VAT', money(invoice.vatAmount, invoice.currency)],
    ['Brutto', money(invoice.grossAmount, invoice.currency)],
    ['Numer KSeF', invoice.ksefNumber],
  ]
  if (invoice.isCorrection && (invoice.details.correctedNumber || invoice.details.correctedKsefNumber)) {
    rows.splice(1, 0, ['Koryguje fakturę', invoice.details.correctedNumber || invoice.details.correctedKsefNumber])
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {INVOICE_TYPES[invoice.invoiceType] ?? invoice.invoiceType} {invoice.invoiceNumber}
          </DialogTitle>
          <DialogDescription>
            {isSale ? 'Faktura sprzedaży' : 'Faktura zakupu'} z KSeF. KSeF przechowuje dane faktury, nie PDF; plik PDF pobierzesz
            w panelu biura rachunkowego albo w Aplikacji Podatnika.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="min-w-0 break-words text-zinc-100">{value}</dd>
            </div>
          ))}
          {projectName && (
            <div className="contents">
              <dt className="text-zinc-500">Projekt w hubie</dt>
              <dd>
                <button type="button" className="text-left text-zinc-100 underline decoration-zinc-600 hover:decoration-zinc-300" onClick={() => onOpenProject(projectName.id)}>
                  {projectName.name}
                </button>
              </dd>
            </div>
          )}
        </dl>
        {invoice.hasDetails === false ? (
          <p className="text-xs text-zinc-500">Pozycje pobiorą się przy kolejnej synchronizacji (KSeF wydaje do 64 faktur na godzinę).</p>
        ) : invoice.details.lines.length === 0 ? (
          <p className="text-xs text-zinc-500">Faktura nie ma pozycji.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-2 font-normal">Pozycja</th>
                <th className="py-1 pr-2 text-right font-normal">Ilość</th>
                <th className="py-1 pr-2 text-right font-normal">Cena</th>
                <th className="py-1 pr-2 text-right font-normal">Wartość</th>
                <th className="py-1 text-right font-normal">VAT</th>
              </tr>
            </thead>
            <tbody>
              {invoice.details.lines.map((line, index) => (
                <tr key={index} className="border-t border-white/5 text-zinc-200">
                  <td className="py-1 pr-2">{line.name || '—'}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {line.quantity ?? '—'} {line.unit}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {line.unitPriceNet !== null ? money(line.unitPriceNet, invoice.currency) : line.unitPriceGross !== null ? `${money(line.unitPriceGross, invoice.currency)} brutto` : '—'}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {line.amountNet !== null ? money(line.amountNet, invoice.currency) : line.amountGross !== null ? `${money(line.amountGross, invoice.currency)} brutto` : '—'}
                  </td>
                  <td className="py-1 text-right tabular-nums">{line.vatRate ? (/^\d+$/.test(line.vatRate) ? `${line.vatRate}%` : line.vatRate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function KsefInvoiceList({
  sales,
  purchases,
  inPeriod,
  periodLabel,
  projectOfInvoice,
  onOpenProject,
}: {
  sales: KsefCache | null
  purchases: KsefCache | null
  inPeriod: (day: string) => boolean
  periodLabel: string
  /** Numer KSeF faktury sprzedaży → projekt, do którego trafiła w zestawieniu. */
  projectOfInvoice: Map<string, { id: string; name: string }>
  onOpenProject: (id: string) => void
}) {
  const [direction, setDirection] = useState<KsefDirection>('sale')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<KsefSale | null>(null)
  const cache = direction === 'sale' ? sales : purchases
  const inRange = useMemo(() => (cache?.invoices ?? []).filter((invoice) => inPeriod(invoice.issueDate)), [cache, inPeriod])
  const shown = useMemo(() => {
    const needle = clientKey(query)
    const list = needle
      ? inRange.filter((invoice) => clientKey(`${invoice.invoiceNumber} ${invoice.counterpartyName} ${invoice.counterpartyNip}`).includes(needle))
      : inRange
    return [...list].sort((a, b) => b.ksefDate.localeCompare(a.ksefDate) || b.invoiceNumber.localeCompare(a.invoiceNumber))
  }, [inRange, query])
  const totals = totalsOf(shown)
  const foreign = [...totals.foreign].map(([currency, value]) => money(value, currency)).join(' + ')
  const waiting = inRange.filter((invoice) => invoice.hasDetails === false).length
  const counts = { sale: (sales?.invoices ?? []).filter((i) => inPeriod(i.issueDate)).length, purchase: (purchases?.invoices ?? []).filter((i) => inPeriod(i.issueDate)).length }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-sm" role="tablist" aria-label="Rodzaj faktur">
          {(['sale', 'purchase'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={direction === value}
              onClick={() => setDirection(value)}
              className={`rounded-md px-3 py-1 ${direction === value ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {value === 'sale' ? 'Sprzedaż' : 'Zakupy'} <span className="text-zinc-500">{counts[value]}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-64 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Numer, kontrahent, NIP" className="h-8 border-white/10 bg-black/40 pl-8 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={`${direction === 'sale' ? 'Sprzedaż' : 'Zakupy'} · ${periodLabel}`} value={`${totals.count} ${plural(totals.count, 'faktura', 'faktury', 'faktur')}`} hint={query ? 'wg wyszukiwania' : undefined} />
        <Tile label="Netto" value={money(totals.net)} hint={foreign ? `+ ${foreign}` : undefined} />
        <Tile label="VAT" value={money(totals.vat)} />
        <Tile label="Brutto" value={money(totals.gross)} />
      </div>
      {waiting > 0 && (
        <p className="text-xs text-zinc-500">
          {waiting} {plural(waiting, 'faktura czeka', 'faktury czekają', 'faktur czeka')} na pobranie pozycji i terminu płatności (limit KSeF: 64 faktury na
          godzinę) — dociągnie je kolejna synchronizacja. Kwoty i daty są już pełne.
        </p>
      )}

      {!cache ? (
        <p className="py-8 text-center text-sm text-zinc-600">Tych faktur jeszcze nie pobrano z KSeF.</p>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-600">Brak faktur w tym okresie.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-900/40">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Numer</th>
                <th className="px-3 py-2 font-medium">{direction === 'sale' ? 'Nabywca' : 'Sprzedawca'}</th>
                <th className="px-3 py-2 text-right font-medium">Netto</th>
                <th className="px-3 py-2 text-right font-medium">VAT</th>
                <th className="px-3 py-2 text-right font-medium">Brutto</th>
                <th className="px-3 py-2 font-medium">Termin</th>
                {direction === 'sale' && <th className="px-3 py-2 font-medium">Projekt</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((invoice) => (
                <tr
                  key={invoice.ksefNumber}
                  tabIndex={0}
                  onClick={() => setOpen(invoice)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(invoice)}
                  className="cursor-pointer border-t border-white/5 text-zinc-200 outline-none hover:bg-white/5 focus-visible:bg-white/5"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-zinc-400">{day(invoice.ksefDate)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {invoice.invoiceNumber}
                    {invoice.isCorrection && <span className="ml-1.5 rounded bg-amber-500/10 px-1 text-[10px] text-amber-300">korekta</span>}
                  </td>
                  <td className="max-w-56 truncate px-3 py-1.5" title={invoice.counterpartyName}>
                    {invoice.counterpartyName || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(invoice.netAmount, invoice.currency)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-zinc-400">{money(invoice.vatAmount, invoice.currency)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(invoice.grossAmount, invoice.currency)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-zinc-400">{invoice.details.dueDate ? day(invoice.details.dueDate) : '—'}</td>
                  {direction === 'sale' && (
                    <td className="max-w-48 truncate px-3 py-1.5 text-zinc-400" title={projectOfInvoice.get(invoice.ksefNumber)?.name}>
                      {projectOfInvoice.get(invoice.ksefNumber)?.name ?? (invoice.isCorrection ? '' : '— bez projektu')}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <InvoiceDialog
          invoice={open}
          projectName={projectOfInvoice.get(open.ksefNumber) ?? null}
          onClose={() => setOpen(null)}
          onOpenProject={(id) => {
            setOpen(null)
            onOpenProject(id)
          }}
        />
      )}
    </div>
  )
}
