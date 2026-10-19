'use client'

/**
 * Komunikaty Realizacji po R2 — każdy da się ukryć dla projektu („Ukryj"
 * trzyma podpis listy w localStorage: wraca dopiero, gdy wycena znowu się zmieni).
 *  - `QuoteChangesBanner` — wycena zmieniła się od startu Realizacji.
 *  - `MissingFromQuote` — koszty sprzed R2: pozycje planu, których tu nie widać.
 *  - `RestartFromQuote` — cichy przycisk „Zacznij od wyceny" z potwierdzeniem.
 */

import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import type { MissingRows, PlanRow, QuoteChanges } from '@/lib/realization-costs'
import { costCategoryLabel } from '@/lib/project-types'
import { pln } from '@/components/calendar/calendar-bits'

const HIDDEN_KEY = 'nonoise-realization-hidden-v1'

type Hidden = Record<string, { changes?: string; missing?: string }>

function readHidden(): Hidden {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Hidden) : {}
  } catch {
    return {}
  }
}

/** Ukryty podpis listy dla projektu (`changes` / `missing`) i jego zapis. */
export function useHidden(projectId: string, kind: 'changes' | 'missing') {
  const [hidden, setHidden] = useState<string | undefined>(() =>
    typeof window === 'undefined' ? undefined : readHidden()[projectId]?.[kind]
  )
  const hide = (signature: string) => {
    setHidden(signature)
    try {
      const all = readHidden()
      all[projectId] = { ...(all[projectId] ?? {}), [kind]: signature }
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(all))
    } catch {
      // Bez localStorage ukrycie działa do zamknięcia zakładki.
    }
  }
  return { hidden, hide }
}

function signedPln(value: number): string {
  const rounded = Math.sign(value) * Math.round(Math.abs(value))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${pln(Math.abs(rounded))}`
}

export function rowTitle(row: Pick<PlanRow, 'role' | 'person' | 'label' | 'category' | 'quoteDay'>): string {
  const main = row.category === 'ekipa' ? [row.role, row.person].filter(Boolean).join(' · ') || 'Osoba' : row.label || costCategoryLabel(row.category)
  return row.quoteDay !== null ? `${main} (dzień ${row.quoteDay + 1} wyceny)` : main
}

const quietButton = 'rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/5 hover:text-zinc-100'

export function QuoteChangesBanner({
  projectId,
  changes,
  onApply,
}: {
  projectId: string
  changes: QuoteChanges
  onApply: () => void
}) {
  const { hidden, hide } = useHidden(projectId, 'changes')
  const [open, setOpen] = useState(false)
  if (changes.changes.length === 0 || hidden === changes.signature) return null
  const parts = [
    changes.added && `+${changes.added}`,
    changes.changed && `~${changes.changed}`,
    changes.removed && `−${changes.removed}`,
  ].filter(Boolean)
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300" role="status">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1">
          Wycena zmieniła się od startu Realizacji: {parts.join(' / ')}, koszty {signedPln(changes.delta)}
          {Math.abs(changes.ownDelta) >= 0.5 && `, moja praca ${signedPln(changes.ownDelta)}`}. Wpisanych ręcznie wierszy to nie
          rusza.
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={quietButton}>
          {open ? 'Zwiń' : 'Pokaż'}
        </button>
        <button type="button" onClick={onApply} className="font-semibold text-primary hover:underline">
          Uwzględnij
        </button>
        <button type="button" onClick={() => hide(changes.signature)} className={quietButton}>
          Ukryj
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-0.5 text-zinc-400">
          {changes.changes.map((c) => (
            <li key={`${c.type}-${c.planKey}`}>
              {c.type === 'added' ? 'Nowe: ' : c.type === 'changed' ? 'Zmienione: ' : 'Nie ma już w wycenie: '}
              {c.row
                ? rowTitle(c.row)
                : c.cost
                  ? c.cost.category === 'ekipa'
                    ? [c.cost.role, c.cost.person].filter(Boolean).join(' · ')
                    : c.cost.label || costCategoryLabel(c.cost.category)
                  : c.planKey}
              {Math.abs(c.delta) >= 0.5 && <span className="tabular-nums text-zinc-500"> ({signedPln(c.delta)})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MissingFromQuote({
  projectId,
  missing,
  onAdd,
}: {
  projectId: string
  missing: MissingRows
  /** `own` = dodaj jako „Moja praca" (pozycje odznaczone w planie). */
  onAdd: (rows: PlanRow[], as: 'plan' | 'own' | 'cost') => void
}) {
  const { hidden, hide } = useHidden(projectId, 'missing')
  const [open, setOpen] = useState(false)
  const count = missing.counted.length + missing.skipped.length
  if (count === 0 || hidden === missing.signature) return null
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex min-w-0 flex-1 items-center gap-1 text-left text-zinc-300">
          <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          W wycenie, nie ma w Realizacji: {missing.counted.length > 0 ? `${missing.counted.length} (${pln(missing.total)})` : 'nic liczonego'}
          {missing.skipped.length > 0 && ` · odznaczone w planie: ${missing.skipped.length}`}
        </button>
        {missing.counted.length > 1 && (
          <button type="button" onClick={() => onAdd(missing.counted, 'plan')} className={quietButton}>
            Dodaj wszystkie
          </button>
        )}
        <button type="button" onClick={() => hide(missing.signature)} className={quietButton}>
          Ukryj
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-zinc-500">
            Koszty tego projektu wpisano przed zmianą Realizacji — liczą się tak, jak są. Dodaj z wyceny tylko to, czego tu brakuje.
          </p>
          {missing.counted.length > 0 && (
            <ul className="space-y-1">
              {missing.counted.map((row) => (
                <li key={row.planKey} className="flex flex-wrap items-center gap-x-2">
                  <span className="min-w-0 flex-1 text-zinc-300">{rowTitle(row)}</span>
                  <span className="tabular-nums text-zinc-500">{pln(row.quantity * row.unitCost)}</span>
                  <button type="button" onClick={() => onAdd([row], 'plan')} className={`${quietButton} inline-flex items-center gap-1`}>
                    <Plus className="size-3" />
                    Dodaj
                  </button>
                </li>
              ))}
            </ul>
          )}
          {missing.skipped.length > 0 && (
            <>
              <div className="pt-1 text-[11px] text-zinc-500">Odznaczone w planie („nie mój koszt") — np. Twoja praca:</div>
              <ul className="space-y-1">
                {missing.skipped.map((row) => (
                  <li key={row.planKey} className="flex flex-wrap items-center gap-x-2">
                    <span className="min-w-0 flex-1 text-zinc-400">{rowTitle(row)}</span>
                    <span className="tabular-nums text-zinc-500">{pln(row.quantity * row.unitCost)}</span>
                    <button type="button" onClick={() => onAdd([row], 'own')} className={quietButton}>
                      Dodaj jako Moja praca
                    </button>
                    <button type="button" onClick={() => onAdd([row], 'cost')} className={quietButton}>
                      jako koszt
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function RestartFromQuote({
  before,
  after,
  enteredCount,
  planCount,
  onConfirm,
}: {
  /** Koszty w Finansach teraz i po zastąpieniu. */
  before: number | null
  after: number | null
  enteredCount: number
  planCount: number
  onConfirm: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  if (planCount === 0) return null
  if (!confirm) {
    return (
      <button type="button" onClick={() => setConfirm(true)} className="text-[11px] text-zinc-600 underline-offset-2 hover:text-zinc-300 hover:underline">
        Zacznij od wyceny…
      </button>
    )
  }
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">
      <p>
        Wpisane koszty ({enteredCount} {enteredCount === 1 ? 'pozycja' : 'pozycji'}) zastąpią pozycje z wyceny ({planCount}). Koszty
        w Finansach: {before === null ? '—' : pln(before)} → {after === null ? '—' : pln(after)}. Da się cofnąć.
      </p>
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirm(false)
            onConfirm()
          }}
          className="rounded-md bg-white/10 px-2 py-1 font-semibold text-white hover:bg-white/15"
        >
          Zastąp
        </button>
        <button type="button" onClick={() => setConfirm(false)} className={quietButton}>
          Anuluj
        </button>
      </div>
    </div>
  )
}
