'use client'

/** Stan wpłaty faktury według wyciągu z banku (`bank-match.ts`), jednym krótkim znacznikiem. */

import type { PaymentView } from '@/lib/bank-match'
import { plural } from '@/lib/pl-plural'

const dayText = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}
const days = (count: number) => `${count} ${plural(count, 'dzień', 'dni', 'dni')}`
const amount = (value: number) => value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function paymentText(view: PaymentView): { text: string; hint: string; className: string } {
  if (view.state === 'paid') {
    return {
      text: `${view.confident ? 'Zapłacona' : 'Chyba zapłacona'} ${dayText(view.day)}`,
      hint: `${days(view.daysFromIssue)} od wystawienia${view.daysLate ? `, ${days(view.daysLate)} po terminie` : ''}${view.confident ? '' : ' — zgadza się sama kwota, potwierdź obok'}`,
      className: view.confident ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300',
    }
  }
  if (view.state === 'partial') {
    return { text: `Częściowo: brakuje ${amount(view.left)}`, hint: `Wpłynęło ${amount(view.paid)}, ostatnio ${dayText(view.day)}`, className: 'bg-amber-500/10 text-amber-300' }
  }
  if (view.state === 'overdue') {
    return { text: `Po terminie ${days(view.daysLate)}`, hint: 'W wyciągu nie ma wpłaty za tę fakturę', className: 'bg-rose-500/10 text-rose-300' }
  }
  if (view.state === 'waiting') {
    return {
      text: view.daysLeft === null ? 'Czeka na wpłatę' : view.daysLeft >= 0 ? `Czeka, termin za ${days(view.daysLeft)}` : 'Czeka na wpłatę',
      hint: 'W wyciągu nie ma jeszcze wpłaty',
      className: 'bg-zinc-500/10 text-zinc-300',
    }
  }
  return { text: 'Brak wyciągu', hint: 'Wczytaj nowszy wyciąg z banku, żeby sprawdzić wpłatę', className: 'bg-zinc-500/10 text-zinc-500' }
}

export function PaymentChip({ view }: { view: PaymentView }) {
  const { text, hint, className } = paymentText(view)
  return (
    <span title={hint} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {text}
    </span>
  )
}
