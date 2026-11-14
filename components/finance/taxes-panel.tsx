'use client'

/**
 * Finanse → „Podatki": ZUS, ryczałt i VAT naprawdę zapłacone (wyciąg z banku)
 * obok tego, co hub wie z faktur KSeF i własnych wyliczeń (`taxes.ts`).
 * Ekran niczego nie zapisuje poza oznaczeniem faktury zakupu w „KSeF → Faktury".
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { bankCoveredTo, EMPTY_BANK, type BankCopy } from '@/lib/bank-statement'
import { readBankCopy } from '@/lib/bank-store'
import { periodMonths, type Period } from '@/lib/finance-calc'
import type { KsefSale } from '@/lib/ksef-invoices'
import type { KsefDecision } from '@/lib/ksef-reconcile'
import { listKsefDecisions, readKsefCache } from '@/lib/ksef-store'
import { taxSummary, VAT_PAYER_SINCE, zusCheck, type ZusCheck } from '@/lib/taxes'
import { day, money } from './ksef-invoice-list'

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
const monthName = (month: string) => MONTHS[Number(month.slice(5)) - 1] ?? month
const MONTHS_FROM = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']

export interface ZusCost {
  month: string
  amount: number
  paidFrom?: string
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export function ZusMark({ check }: { check: ZusCheck }) {
  if (check.state === 'confirmed') {
    return (
      <span title={`Przelew do ZUS ${day(check.day)} (wyciąg z banku)`} className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300">
        <Check className="size-3" />
        bank
      </span>
    )
  }
  if (check.state === 'differs') {
    return (
      <span title={`Przelew do ZUS ${day(check.day)}`} className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
        w banku {money(check.bankAmount)}
      </span>
    )
  }
  if (check.state === 'missing') {
    return (
      <span title="Wyciąg obejmuje cały miesiąc, a przelewu do ZUS w nim nie ma" className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-300">
        brak przelewu
      </span>
    )
  }
  if (check.state === 'elsewhere') {
    return (
      <span title="Zapłacone z konta spoza wyciągów; hub tego nie sprawdza" className="rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[11px] text-zinc-300">
        {check.account}
      </span>
    )
  }
  return null
}

export function TaxesPanel({
  period,
  periodLabel,
  taxEstimate,
  zusCosts,
}: {
  period: Period
  periodLabel: string
  /** Ryczałt, który hub wylicza z przychodu miesiąca (`RRRR-MM` → zł). */
  taxEstimate: Map<string, number>
  /** ZUS wpisany w kosztach stałych, po miesiącu. */
  zusCosts: ZusCost[]
}) {
  const [bank, setBank] = useState<BankCopy>(EMPTY_BANK)
  const [sales, setSales] = useState<KsefSale[]>([])
  const [purchases, setPurchases] = useState<KsefSale[]>([])
  const [decisions, setDecisions] = useState<KsefDecision[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void Promise.all([readBankCopy(), readKsefCache('sale'), readKsefCache('purchase'), listKsefDecisions()]).then(([copy, sale, purchase, saved]) => {
      if (!live) return
      setBank(copy)
      setSales(sale.cache?.invoices ?? [])
      setPurchases(purchase.cache?.invoices ?? [])
      setDecisions(saved)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [])

  const months = useMemo(() => periodMonths(period), [period])
  const summary = useMemo(() => taxSummary({ months, bank, sales, purchases, decisions }), [months, bank, sales, purchases, decisions])
  const zusByMonth = useMemo(() => {
    const map = new Map<string, ZusCost>()
    zusCosts.forEach((cost) => map.set(cost.month, { ...cost, amount: (map.get(cost.month)?.amount ?? 0) + cost.amount, paidFrom: cost.paidFrom ?? map.get(cost.month)?.paidFrom }))
    return map
  }, [zusCosts])

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-zinc-600">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  const hasBank = bank.operations.length > 0
  const coveredTo = bankCoveredTo(bank)
  const settledFlat = summary.months.filter((month) => month.flatTaxPaid !== null)
  const flatEstimate = settledFlat.reduce((sum, month) => sum + (taxEstimate.get(month.month) ?? 0), 0)
  // ZUS w hubie do miesiąca, do którego sięga wyciąg; osobno to, co poszło z kont spoza wyciągów.
  const seenMonths = months.filter((month) => coveredTo && month <= coveredTo.slice(0, 7))
  const zusHub = seenMonths.reduce((sum, month) => sum + (zusByMonth.get(month)?.amount ?? 0), 0)
  const zusElsewhere = seenMonths.reduce((sum, month) => sum + (zusByMonth.get(month)?.paidFrom ? (zusByMonth.get(month)?.amount ?? 0) : 0), 0)
  const zusAgrees = Math.abs(zusHub - zusElsewhere - summary.zus) < 0.01
  const { vat, outside } = summary
  const gap = Math.round((vat.deductibleByInvoices - vat.deductedReal) * 100) / 100
  const cell = 'whitespace-nowrap px-3 py-1.5 text-right tabular-nums'
  const dash = <span className="text-zinc-600">—</span>

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 text-sm">
        <h2 className="font-semibold text-zinc-200">Podatki · {periodLabel}</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {hasBank
            ? `Przelewy do urzędu i ZUS z wyciągu bankowego (do ${day(coveredTo)}) obok faktur z KSeF. Przelew z danego miesiąca rozlicza miesiąc poprzedni, więc stoi w wierszu miesiąca, za który jest.`
            : 'Wczytaj wyciąg z banku w zakładce KSeF („Wczytaj wyciąg z banku”), żeby zobaczyć faktycznie zapłacone podatki i ZUS.'}{' '}
          PIT-38, VAT-9M i przelewy prywatne są tu pomijane.
        </p>
      </section>

      {outside.count > 0 && (
        <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 text-xs text-zinc-400">
          <h2 className="text-sm font-semibold text-zinc-200">Poza hubem: sesje i inna sprzedaż bez faktur w KSeF</h2>
          <p className="mt-1">
            W tym okresie wpłynęło{' '}
            <span className="tabular-nums text-zinc-100">{money(outside.gross)}</span> ({outside.count}{' '}
            {outside.count === 1 ? 'wpłata' : 'wpłat'} od nadawców oznaczonych „Pomijaj tego nadawcę”). To{' '}
            <span className="tabular-nums text-zinc-200">{money(outside.net)}</span> netto i{' '}
            <span className="tabular-nums text-zinc-200">{money(outside.vat)}</span> VAT (wpłata to 123% ceny; przed{' '}
            {MONTHS_FROM[Number(VAT_PAYER_SINCE.slice(5)) - 1]} {VAT_PAYER_SINCE.slice(0, 4)} bez VAT).
          </p>
          <p className="mt-1 text-zinc-500">
            Hub nie liczy tych wpłat w przychodzie ani w projektach, ale urząd rozlicza je razem z resztą firmy: ich VAT jest doliczony poniżej, a ryczałt od
            nich siedzi w kwocie „Ryczałt zapłacony”.
          </p>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile
          label="ZUS z banku"
          value={money(summary.zus)}
          hint={`${zusAgrees ? 'zgodne z hubem' : `w hubie za te miesiące: ${money(zusHub - zusElsewhere)}`}${zusElsewhere ? `; do tego ${money(zusElsewhere)} z kont spoza wyciągu` : ''}`}
        />
        <Tile
          label="Ryczałt zapłacony"
          value={money(summary.flatTaxPaid)}
          hint={settledFlat.length ? `hub szacuje za te miesiące: ${money(flatEstimate)} (z pracą w realizacji, bez sesji)` : 'brak rozliczonych miesięcy w wyciągu'}
        />
        <Tile label="VAT wpłacony do urzędu" value={money(vat.paid)} hint={vat.months.length ? `za ${monthName(vat.months[0])}–${monthName(vat.months.at(-1)!)}` : 'brak rozliczonych miesięcy'} />
        <Tile label="Odliczony VAT (realnie)" value={money(vat.deductedReal)} hint={`według faktur zakupu: ${money(vat.deductibleByInvoices)}`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-900/40">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Miesiąc</th>
              <th className="px-3 py-2 text-right font-medium">ZUS (bank)</th>
              <th className="px-3 py-2 font-medium">ZUS w hubie</th>
              <th className="px-3 py-2 text-right font-medium">Ryczałt zapłacony</th>
              <th className="px-3 py-2 text-right font-medium" title="Stawka ryczałtu projektu × przychód huba w miesiącu wystawienia faktury. Hub liczy też pracę w realizacji bez faktury i nie zna sprzedaży poza KSeF, więc miesiące mogą się różnić">
                Ryczałt wg huba
              </th>
              <th className="px-3 py-2 text-right font-medium">VAT sprzedaż</th>
              <th className="px-3 py-2 text-right font-medium">VAT zakupy do odliczenia</th>
              <th className="px-3 py-2 text-right font-medium">VAT wpłacony</th>
            </tr>
          </thead>
          <tbody>
            {summary.months.map((month) => {
              const cost = zusByMonth.get(month.month)
              return (
                <tr key={month.month} className="border-t border-white/5 text-zinc-200">
                  <td className="px-3 py-1.5 capitalize">{monthName(month.month)}</td>
                  <td className={cell}>{month.zus ? money(month.zus) : dash}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {cost ? (
                      <span className="inline-flex items-center gap-1.5 tabular-nums text-zinc-400">
                        {money(cost.amount)} <ZusMark check={zusCheck(cost, bank)} />
                      </span>
                    ) : month.zus ? (
                      <span className="text-amber-300">brak w kosztach stałych</span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td className={cell}>{month.flatTaxPaid === null ? dash : money(month.flatTaxPaid)}</td>
                  <td className={`${cell} text-zinc-400`}>{taxEstimate.get(month.month) ? money(taxEstimate.get(month.month)!) : dash}</td>
                  <td className={cell} title={month.vatOutside ? `z faktur ${money(month.vatSales)} + z sesji ${money(month.vatOutside)}` : undefined}>
                    {month.vatApplies && (month.vatSales || month.vatOutside) ? money(month.vatSales + month.vatOutside) : dash}
                  </td>
                  <td className={`${cell} text-zinc-400`}>{month.vatApplies && month.vatDeductible ? money(month.vatDeductible) : dash}</td>
                  <td className={cell}>{!month.vatApplies || month.vatPaid === null ? dash : money(month.vatPaid)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 text-sm">
        <h2 className="font-semibold text-zinc-200">Ile dał VAT</h2>
        <p className="mt-1 text-xs text-zinc-500">
          VAT-owiec od {MONTHS_FROM[Number(VAT_PAYER_SINCE.slice(5)) - 1]} {VAT_PAYER_SINCE.slice(0, 4)}. Liczone tylko z miesięcy, za które wyciąg pokazuje już przelew do urzędu
          {vat.months.length ? ` (${monthName(vat.months[0])}–${monthName(vat.months.at(-1)!)})` : ''}. Klienci-firmy odliczają Twój VAT, więc zyskiem jest to,
          co sam odliczyłeś z zakupów.
        </p>
        {vat.months.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">Brak rozliczonych miesięcy: potrzebny wyciąg z banku i faktury z KSeF.</p>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <dl className="space-y-1 text-xs">
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Realnie (wyciąg z banku)</dt>
              <div className="flex justify-between"><dd className="text-zinc-400">VAT na fakturach sprzedaży</dd><dd className="tabular-nums text-zinc-200">{money(vat.sales)}</dd></div>
              {vat.salesOutside > 0 && (
                <div className="flex justify-between"><dd className="text-zinc-400">+ VAT z sesji (sprzedaż poza KSeF)</dd><dd className="tabular-nums text-zinc-200">{money(vat.salesOutside)}</dd></div>
              )}
              <div className="flex justify-between"><dd className="text-zinc-400">− wpłacone do urzędu</dd><dd className="tabular-nums text-zinc-200">{money(vat.paid)}</dd></div>
              <div className="flex justify-between border-t border-white/10 pt-1"><dd className="text-zinc-200">= odliczone naprawdę</dd><dd className="tabular-nums font-semibold text-emerald-300">{money(vat.deductedReal)}</dd></div>
            </dl>
            <dl className="space-y-1 text-xs">
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Według faktur zakupu w KSeF</dt>
              <div className="flex justify-between"><dd className="text-zinc-400">VAT na wszystkich fakturach zakupu</dd><dd className="tabular-nums text-zinc-200">{money(vat.purchasesAll)}</dd></div>
              <div className="flex justify-between"><dd className="text-zinc-400">− paliwo (połowa nie do odliczenia)</dd><dd className="tabular-nums text-zinc-200">{money(vat.fuelHalf)}</dd></div>
              <div className="flex justify-between"><dd className="text-zinc-400">− faktury oznaczone ręcznie (nie dotyczy firmy)</dd><dd className="tabular-nums text-zinc-200">{money(vat.excluded)}</dd></div>
              <div className="flex justify-between border-t border-white/10 pt-1"><dd className="text-zinc-200">= do odliczenia</dd><dd className="tabular-nums font-semibold text-zinc-100">{money(vat.deductibleByInvoices)}</dd></div>
            </dl>
          </div>
        )}
        {vat.months.length > 0 && Math.abs(gap) < 1 && <p className="mt-3 text-xs text-emerald-300">Obie liczby się zgadzają.</p>}
        {vat.months.length > 0 && Math.abs(gap) >= 1 && (
          <p className="mt-3 rounded-md border border-amber-500/15 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-200/90">
            Różnica między tymi liczbami: {money(Math.abs(gap))}. Możliwe powody: faktury zakupu, które nie dotyczą firmy albo są odliczane tylko w części
            (oznacz je w KSeF → Faktury → Zakupy), wpłaty za sesje od nadawców jeszcze nieoznaczonych „Pomijaj tego nadawcę”, zakupy, których nie ma w KSeF (paragony z NIP-em, faktury z zagranicy),
            zaokrąglenia deklaracji do pełnych złotych i przesunięcia między miesiącami.
          </p>
        )}
      </section>
    </div>
  )
}
