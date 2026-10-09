'use client'

/**
 * Formularz kampanii: nazwa, platforma, start/koniec i budżet dzienny z panelu
 * (z historią zmian — „od 1 maja 100 zł/dzień").
 */

import { useId, useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import {
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_PLATFORM_LABELS,
  createCampaign,
  type BudgetStep,
  type Campaign,
} from '@/lib/marketing-types'
import { AVG_DAYS_PER_MONTH } from '@/lib/marketing-calc'
import { FieldLabel, inputClass, pln } from './marketing-bits'

interface StepDraft {
  from: string
  daily: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function CampaignForm({
  campaign,
  today,
  onSave,
  onDelete,
  onClose,
}: {
  campaign: Campaign | null
  today: string
  onSave: (campaign: Campaign) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onClose: () => void
}) {
  const id = useId()
  const [name, setName] = useState(campaign?.name ?? 'Google Ads — produkcja filmowa')
  const [platform, setPlatform] = useState(campaign?.platform ?? 'google_ads')
  const [startDate, setStartDate] = useState(campaign?.startDate ?? today)
  const [ongoing, setOngoing] = useState(!campaign?.endDate)
  const [endDate, setEndDate] = useState(campaign?.endDate ?? '')
  const [daily, setDaily] = useState(campaign?.budgets[0] ? String(campaign.budgets[0].daily) : '')
  const [steps, setSteps] = useState<StepDraft[]>(
    (campaign?.budgets.slice(1) ?? []).map((s) => ({ from: s.from, daily: String(s.daily) }))
  )
  const [notes, setNotes] = useState(campaign?.notes ?? '')
  const [showProblems, setShowProblems] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const dailyValue = parseAmount(daily)
  const problems: string[] = []
  if (!name.trim()) problems.push('Nazwij kampanię.')
  if (!DATE.test(startDate)) problems.push('Podaj datę startu.')
  if (!ongoing && (!DATE.test(endDate) || endDate < startDate)) problems.push('Koniec nie może być przed startem.')
  // Pusty budżet = jeszcze nieznany (dozwolone); wpisany musi być liczbą.
  if (daily.trim() && dailyValue === undefined) problems.push('Budżet dzienny musi być kwotą w zł.')
  if (steps.some((s) => !DATE.test(s.from) || parseAmount(s.daily) === undefined)) {
    problems.push('Uzupełnij datę i kwotę każdej zmiany budżetu.')
  }

  const submit = async () => {
    if (problems.length) {
      setShowProblems(true)
      return
    }
    const budgets: BudgetStep[] = [
      ...(dailyValue !== undefined ? [{ from: startDate, daily: dailyValue }] : []),
      ...steps.map((s) => ({ from: s.from, daily: parseAmount(s.daily) ?? 0 })),
    ].sort((a, b) => a.from.localeCompare(b.from))
    const base = campaign ?? createCampaign({ name, startDate, dailyBudget: dailyValue ?? 0 })
    setBusy(true)
    try {
      await onSave({
        ...base,
        name: name.trim(),
        platform,
        startDate,
        endDate: ongoing ? undefined : endDate,
        budgets,
        notes: notes.trim(),
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold text-white" style={{ fontFamily: 'var(--font-archivo)' }}>
          {campaign ? 'Ustawienia kampanii' : 'Nowa kampania'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij formularz"
          className="rounded-md p-1 text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-4" />
        </button>
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-name`}>Nazwa</FieldLabel>
        <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-platform`}>Platforma</FieldLabel>
        <select id={`${id}-platform`} value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputClass}>
          {CAMPAIGN_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {CAMPAIGN_PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel htmlFor={`${id}-start`}>Start emisji</FieldLabel>
          <input
            id={`${id}-start`}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-end`}>Koniec (włącznie)</FieldLabel>
          <input
            id={`${id}-end`}
            type="date"
            value={ongoing ? '' : endDate}
            min={startDate}
            disabled={ongoing}
            onChange={(e) => setEndDate(e.target.value)}
            className={`${inputClass} disabled:opacity-40`}
          />
        </div>
      </div>
      <label className="-mt-2 flex items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={ongoing}
          onChange={(e) => setOngoing(e.target.checked)}
          className="size-3.5 accent-[var(--primary)]"
        />
        Kampania trwa
      </label>

      <div>
        <FieldLabel htmlFor={`${id}-daily`}>Budżet dzienny w panelu (zł)</FieldLabel>
        <input
          id={`${id}-daily`}
          inputMode="decimal"
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
          placeholder="np. 75 — puste, jeśli nie wiesz"
          className={inputClass}
        />
        {dailyValue !== undefined && dailyValue > 0 && (
          <p className="mt-1 text-[11px] text-zinc-500">
            ≈ {pln(dailyValue * AVG_DAYS_PER_MONTH)} miesięcznie (Google liczy limit jako budżet × 30,4)
          </p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-[11px] text-zinc-500">Zmiany budżetu w trakcie</legend>
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">od</span>
            <input
              type="date"
              aria-label={`Data zmiany budżetu ${i + 1}`}
              value={step.from}
              min={startDate}
              onChange={(e) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
              className={inputClass}
            />
            <input
              inputMode="decimal"
              aria-label={`Nowy budżet dzienny ${i + 1}`}
              placeholder="zł/dzień"
              value={step.daily}
              onChange={(e) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, daily: e.target.value } : x)))}
              className={`${inputClass} w-24 shrink-0`}
            />
            <button
              type="button"
              aria-label={`Usuń zmianę budżetu ${i + 1}`}
              onClick={() => setSteps((s) => s.filter((_, j) => j !== i))}
              className="rounded-md p-1 text-zinc-500 hover:text-red-300"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setSteps((s) => [...s, { from: today, daily: '' }])}
          className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-100"
        >
          <Plus className="size-3.5" />
          Zmiana budżetu od dnia…
        </button>
      </fieldset>

      <div>
        <FieldLabel htmlFor={`${id}-notes`}>Notatki (słowa kluczowe, wykluczenia, ustawienia)</FieldLabel>
        <textarea
          id={`${id}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={`${inputClass} h-auto resize-y py-1.5`}
        />
      </div>

      {showProblems && problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-300" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Zapisz
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Anuluj
        </button>
        {campaign && onDelete && (
          <div className="ml-auto">
            {confirmDelete ? (
              <button
                type="button"
                onClick={async () => {
                  await onDelete(campaign.id)
                  onClose()
                }}
                className="rounded-md bg-red-500/15 px-2 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/25"
              >
                Na pewno usuń
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="size-3.5" />
                Usuń
              </button>
            )}
          </div>
        )}
      </div>
      {confirmDelete && (
        <p className="text-[11px] text-zinc-500">
          Leady i wydatki tej kampanii zostaną (wydatki dalej liczą się w Finansach) — stracą tylko przypisanie.
        </p>
      )}
    </form>
  )
}
