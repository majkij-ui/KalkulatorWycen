'use client'

/**
 * „Zapłacone" — odhaczenie wpłaty przy projekcie „W realizacji" (przy „Zakończony" to samo
 * robią podstatusy `PaymentSubStatus`).
 *
 * Odhaczenie dopisuje wydarzenie „Faktura opłacona" do wątku projektu (po
 * jednym na każdą nieopłaconą fakturę), więc wpłata widać też w kalendarzu.
 * Odznaczenie usuwa wpłaty miękko; gdy któraś przyszła z importu, najpierw pyta.
 * Logika: `lib/payments.ts`.
 */

import { useState } from 'react'
import { Check } from 'lucide-react'
import { useEvents } from '@/lib/events-context'
import { createEvent } from '@/lib/events-store'
import { lastPaymentDay, paymentState, paymentsToAdd } from '@/lib/payments'
import { PAYMENT_SUBSTATUS_LABELS, toDateKey, type Project } from '@/lib/project-types'

/**
 * Odhaczenie wpłaty i jej cofnięcie — jedno miejsce dla „Zapłacone" (projekt
 * W realizacji) i podstatusów „Oczekuje na zapłatę" / „Zapłacony" (projekt
 * Zakończony). Zapłata to fakt (wydarzenia `invoice_paid`), nie pole projektu.
 */
function usePayment(project: Project) {
  const { events, save, remove } = useEvents()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const today = toDateKey(new Date())
  const state = paymentState(events, project.id, today)
  const lastPaid = lastPaymentDay(events, project.id)

  const markPaid = async () => {
    setBusy(true)
    try {
      for (const draft of paymentsToAdd(events, project.id, today)) {
        await save(createEvent({ ...draft, source: { type: 'manual' } }))
      }
    } finally {
      setBusy(false)
    }
  }

  const markUnpaid = async () => {
    setBusy(true)
    try {
      for (const id of state.paymentIds) await remove(id)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return { state, lastPaid, busy, confirming, setConfirming, markPaid, markUnpaid }
}

/** Pytanie przed cofnięciem wpłaty; wpłaty z importu pytają wprost. */
function UnpaidConfirm({
  importedPayments,
  busy,
  onYes,
  onNo,
}: {
  importedPayments: number
  busy: boolean
  onYes: () => void
  onNo: () => void
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
      {importedPayments > 0 ? 'Usunąć wpłaty z importu?' : 'Cofnąć wpłatę?'}
      <button
        type="button"
        onClick={onYes}
        disabled={busy}
        className="font-semibold text-red-300 hover:underline disabled:opacity-50"
      >
        Tak
      </button>
      <button type="button" onClick={onNo} className="font-semibold hover:underline">
        Nie
      </button>
    </span>
  )
}

export function PaidToggle({ project }: { project: Project }) {
  const { state, lastPaid, busy, confirming, setConfirming, markPaid, markUnpaid } = usePayment(project)

  if (confirming) {
    return (
      <UnpaidConfirm
        importedPayments={state.importedPayments}
        busy={busy}
        onYes={markUnpaid}
        onNo={() => setConfirming(false)}
      />
    )
  }

  const label = state.paid
    ? `Zapłacone${lastPaid ? ` ${lastPaid.slice(8, 10)}.${lastPaid.slice(5, 7)}` : ''}`
    : state.unpaidInvoices > 0
      ? 'Czeka na wpłatę'
      : 'Niezapłacone'

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state.paid}
      disabled={busy}
      onClick={() => (state.paid ? setConfirming(true) : markPaid())}
      title={state.paid ? 'Odznacz, żeby cofnąć wpłatę' : 'Odhacz, gdy pieniądze są na koncie'}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
        state.paid ? 'text-emerald-300 hover:bg-emerald-500/10' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
      }`}
    >
      <span
        className={`flex size-3.5 items-center justify-center rounded-[4px] border ${
          state.paid ? 'border-emerald-400 bg-emerald-400 text-black' : 'border-zinc-600'
        }`}
        aria-hidden
      >
        {state.paid && <Check className="size-3" strokeWidth={3} />}
      </span>
      {label}
    </button>
  )
}

const SUB_PILL_BASE = 'rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50'
const SUB_PILL_IDLE = 'border-transparent text-zinc-500 hover:text-zinc-200'

/**
 * Podstatus projektu „Zakończony" (V1): „Oczekuje na zapłatę" / „Zapłacony".
 * Nic nie zapisuje w projekcie — to ten sam fakt wpłaty co przy „Zapłacone",
 * z tą samą akcją i tym samym pytaniem przy cofnięciu.
 */
export function PaymentSubStatus({ project }: { project: Project }) {
  const { state, busy, confirming, setConfirming, markPaid, markUnpaid } = usePayment(project)

  if (confirming) {
    return (
      <UnpaidConfirm
        importedPayments={state.importedPayments}
        busy={busy}
        onYes={markUnpaid}
        onNo={() => setConfirming(false)}
      />
    )
  }

  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Płatność projektu">
      <button
        type="button"
        disabled={busy}
        aria-pressed={!state.paid}
        onClick={() => {
          if (state.paid) setConfirming(true)
        }}
        title={state.paid ? 'Cofnij wpłatę' : 'Czeka na pieniądze na koncie'}
        className={`${SUB_PILL_BASE} ${
          state.paid ? SUB_PILL_IDLE : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        }`}
      >
        {PAYMENT_SUBSTATUS_LABELS.awaiting}
      </button>
      <button
        type="button"
        disabled={busy}
        aria-pressed={state.paid}
        onClick={() => {
          if (!state.paid) void markPaid()
        }}
        title={state.paid ? 'Wpłata odhaczona' : 'Odhacz, gdy pieniądze są na koncie'}
        className={`${SUB_PILL_BASE} ${
          state.paid ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : SUB_PILL_IDLE
        }`}
      >
        {PAYMENT_SUBSTATUS_LABELS.paid}
      </button>
    </div>
  )
}
