'use client'

/**
 * Finanse → Podsumowanie: jedna notka o sesjach coachingowych (wpłaty od nadawców oznaczonych
 * „Pomijaj tego nadawcę" w KSeF). Kafle liczą tylko produkcję wideo; sesje są formalnie przychodem
 * tej samej działalności, więc ich kwota, ryczałt i VAT stoją tu obok, a nie w kaflach
 * (M.J., 2026-11-14). W okresie bez sesji notka znika.
 */

import { useEffect, useMemo, useState } from 'react'
import { EMPTY_BANK, type BankCopy } from '@/lib/bank-statement'
import { readBankCopy } from '@/lib/bank-store'
import { periodMonths, type Period } from '@/lib/finance-calc'
import type { KsefDecision } from '@/lib/ksef-reconcile'
import { listKsefDecisions } from '@/lib/ksef-store'
import { taxSummary } from '@/lib/taxes'
import { money } from './ksef-invoice-list'

export function SessionsNote({ period, periodLabel }: { period: Period; periodLabel: string }) {
  const [bank, setBank] = useState<BankCopy>(EMPTY_BANK)
  const [decisions, setDecisions] = useState<KsefDecision[]>([])
  useEffect(() => {
    let live = true
    void Promise.all([readBankCopy(), listKsefDecisions()]).then(([copy, saved]) => {
      if (!live) return
      setBank(copy)
      setDecisions(saved)
    })
    return () => {
      live = false
    }
  }, [])
  const outside = useMemo(
    () => taxSummary({ months: periodMonths(period), bank, sales: [], purchases: [], decisions }).outside,
    [period, bank, decisions],
  )
  if (outside.count === 0) return null
  return (
    <p className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400">
      <span className="font-medium text-zinc-200">Sesje coachingowe · {periodLabel}.</span> Poza produkcją wideo działalność miała sesje na{' '}
      <span className="tabular-nums text-zinc-100">{money(outside.gross)}</span> (<span className="tabular-nums">{money(outside.net)}</span> netto). Podatek dochodowy od nich:{' '}
      <span className="tabular-nums text-zinc-100">{money(outside.flatTax)}</span>, VAT: <span className="tabular-nums text-zinc-100">{money(outside.vat)}</span>. Kafle powyżej
      tych kwot nie zawierają; są doliczone w zakładce „Podatki”.
    </p>
  )
}
