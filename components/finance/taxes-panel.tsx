'use client'

/**
 * Finanse → „Podatki": ZUS, ryczałt i VAT naprawdę zapłacone (wyciąg z banku)
 * obok tego, co hub wie z faktur KSeF i własnych wyliczeń (`taxes.ts`).
 * Ekran niczego nie zapisuje poza oznaczeniem faktury zakupu w „KSeF → Faktury".
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { matchPayments, payableInvoices } from '@/lib/bank-match'
import { bankCoveredTo, EMPTY_BANK, type BankCopy } from '@/lib/bank-statement'
import { readBankCopy } from '@/lib/bank-store'
import { periodMonths, type Period } from '@/lib/finance-calc'
import type { KsefSale } from '@/lib/ksef-invoices'
import { ksefDocuments, type KsefDecision } from '@/lib/ksef-reconcile'
import { listKsefDecisions, readKsefCache } from '@/lib/ksef-store'
import { OUTSIDE_FLAT_TAX_PERCENT, taxSummary, VAT_PAYER_SINCE, zusCheck, type ZusCheck } from '@/lib/taxes'
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
  invoicedTax,
  untaxedProjects,
  zusCosts,
}: {
  period: Period
  periodLabel: string
  /** Przychód zafakturowany w hubie i ryczałt od niego, po miesiącu wystawienia faktury (`RRRR-MM`). */
  invoicedTax: Map<string, { revenue: number; tax: number }>
  /** Projekty w przychodzie bez faktury i bez podatku (barter). */
  untaxedProjects: { name: string; amount: number }[]
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
  // Ryczałt według huba = od faktur zapisanych w hubie + od sesji; praca w realizacji tu nie wchodzi.
  const hubFlat = (month: { month: string; flatTaxOutside: number }) => (invoicedTax.get(month.month)?.tax ?? 0) + month.flatTaxOutside
  const settledFlat = summary.months.filter((month) => month.flatTaxPaid !== null)
  const flatEstimate = settledFlat.reduce((sum, month) => sum + hubFlat(month), 0)
  const flatGaps = settledFlat
    .map((month) => ({ month, gap: Math.round(((month.flatTaxPaid ?? 0) - hubFlat(month)) * 100) / 100 }))
    // Sto złotych ryczałtu to ponad tysiąc złotych przychodu: tyle warto wyjaśnić.
    .filter(({ gap }) => Math.abs(gap) >= 100)
  const flatGapTotal = Math.round((summary.flatTaxPaid - flatEstimate) * 100) / 100
  const unmatchedIncomes = hasBank
    ? matchPayments({ invoices: payableInvoices(ksefDocuments(sales.filter((invoice) => invoice.hasDetails !== false))), operations: bank.operations, decisions }).unmatched.length
    : 0
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
          hint={settledFlat.length ? `z faktur w hubie i sesji za te miesiące: ${money(flatEstimate)}` : 'brak rozliczonych miesięcy w wyciągu'}
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
              <th className="px-3 py-2 text-right font-medium" title="Ryczałt od faktur zapisanych w hubie (miesiąc wystawienia, stawka projektu) plus od sesji. Praca w realizacji bez faktury tu nie wchodzi">
                Ryczałt z faktur i sesji
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
                  <td
                    className={`${cell} text-zinc-400`}
                    title={`z faktur ${money(invoicedTax.get(month.month)?.tax ?? 0)} (przychód ${money(invoicedTax.get(month.month)?.revenue ?? 0)})${month.flatTaxOutside ? ` + z sesji ${money(month.flatTaxOutside)}` : ''}`}
                  >
                    {hubFlat(month) ? money(hubFlat(month)) : dash}
                  </td>
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
      </section>

      <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
        <h2 className="flex items-center gap-2 font-semibold text-amber-200">
          <AlertTriangle className="size-4" />
          Notki podatkowe
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-amber-100/90">
          {outside.count > 0 && (
            <li>
              Sesje (wpłaty bez faktur w KSeF): {money(outside.gross)}, czyli {money(outside.net)} netto. W rachunku jest od nich {money(outside.vat)} VAT i{' '}
              {money(outside.flatTax)} ryczałtu ({String(OUTSIDE_FLAT_TAX_PERCENT).replace('.', ',')}%, jak usługi edukacyjne; przy doradztwie w zarządzaniu byłoby 15%).
            </li>
          )}
          {untaxedProjects.map((project) => (
            <li key={project.name}>
              „{project.name}”: {money(project.amount)} w przychodzie huba bez faktury i bez podatku (barter). Nie wchodzi do porównań na tej stronie.
            </li>
          ))}
          {flatGaps.map(({ month, gap }) => (
            <li key={month.month}>
              <span className="capitalize">{monthName(month.month)}</span>: ryczałt zapłacony {money(month.flatTaxPaid ?? 0)}, z faktur i sesji wychodzi{' '}
              {money(hubFlat(month))}. To {money(Math.abs(gap))} {gap > 0 ? 'więcej' : 'mniej'}, czyli ok.{' '}
              {money(Math.abs(gap) / (OUTSIDE_FLAT_TAX_PERCENT / 100))} przychodu, {gap > 0 ? 'którego hub nie zna' : 'który hub ma, a w podatku go nie widać'}.
              {month.flatTaxTransfers.length > 1 ? ` Poszły ${month.flatTaxTransfers.length} przelewy: ${month.flatTaxTransfers.map((value) => money(value)).join(' i ')}.` : ''}
            </li>
          ))}
          {settledFlat.length > 0 && Math.abs(flatGapTotal) >= 1 && (
            <li>
              Ryczałt razem: zapłacono {money(summary.flatTaxPaid)}, z faktur i sesji wychodzi {money(flatEstimate)}; różnica {money(Math.abs(flatGapTotal))}{' '}
              {flatGapTotal > 0 ? 'ponad to, co wie hub' : 'poniżej tego, co liczy hub'}. Do wyjaśnienia z wyliczeniem księgowej.
            </li>
          )}
          {vat.months.length > 0 && Math.abs(gap) >= 1 && (
            <li>
              VAT: odliczone naprawdę {money(vat.deductedReal)}, według faktur zakupu {money(vat.deductibleByInvoices)}; różnica {money(Math.abs(gap))}. Możliwe
              powody: zakupy, których nie ma w KSeF (paragony z NIP-em, faktury z zagranicy), faktury zakupu niefirmowe albo odliczane w części (KSeF →
              Faktury → Zakupy), zaokrąglenia deklaracji.
            </li>
          )}
          {unmatchedIncomes > 0 && (
            <li>
              {unmatchedIncomes} {unmatchedIncomes === 1 ? 'wpłata w wyciągu nie ma' : 'wpłat w wyciągu nie ma'} faktury ani oznaczenia (KSeF → „Wpłaty bez faktury w KSeF”). Jeśli to
              sesje, oznacz nadawcę: dopiero wtedy wejdą do VAT i ryczałtu.
            </li>
          )}
          {!hasBank && <li>Bez wyciągu z banku ta strona pokazuje tylko to, co wynika z faktur.</li>}
        </ul>
      </section>
    </div>
  )
}
