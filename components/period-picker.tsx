'use client'

/**
 * Wybór okresu (Rok / Półrocze / Kwartał + rok + numer) — wspólny dla Finansów
 * i Klientów. Z `allowAll` pierwszą opcją jest „Całość" (wartość `null`).
 */

import { periodContaining, type Period, type PeriodKind } from '@/lib/finance-calc'

const KIND_LABELS: Record<Exclude<PeriodKind, 'month'>, string> = {
  year: 'Rok',
  half: 'Półrocze',
  quarter: 'Kwartał',
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-white/10 bg-black/30 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

type PeriodPickerProps = { years: number[] } & (
  | { allowAll?: false; period: Period; onChange: (next: Period) => void }
  | { allowAll: true; period: Period | null; onChange: (next: Period | null) => void }
)

export function PeriodPicker(props: PeriodPickerProps) {
  const { years, allowAll } = props
  const period = props.period
  const emit = props.onChange as (next: Period | null) => void
  const kind: Exclude<PeriodKind, 'month'> | 'all' =
    period === null ? 'all' : period.kind === 'month' ? 'year' : period.kind
  const indexOptions =
    kind === 'half'
      ? [1, 2].map((i) => ({ value: i, label: `H${i}` }))
      : kind === 'quarter'
        ? [1, 2, 3, 4].map((i) => ({ value: i, label: `Q${i}` }))
        : []
  const kindOptions: { value: Exclude<PeriodKind, 'month'> | 'all'; label: string }[] = [
    ...(allowAll ? [{ value: 'all' as const, label: 'Całość' }] : []),
    ...(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) => ({ value: k, label: KIND_LABELS[k] })),
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Rodzaj okresu"
        value={kind}
        options={kindOptions}
        onChange={(nextKind) => {
          if (nextKind === 'all') return emit(null)
          // Z „Całości" — okres z „dziś". Inaczej zostajemy w tym samym roku, na okresie
          // z „dziś" (gdy to bieżący rok) albo na pierwszym okresie roku.
          const base = periodContaining(new Date(), nextKind)
          if (period === null || base.year === period.year) return emit(base)
          emit({ kind: nextKind, year: period.year, index: nextKind === 'year' ? undefined : 1 })
        }}
      />
      {period !== null && (
        <select
          value={period.year}
          onChange={(e) => emit({ ...period, year: Number(e.target.value) })}
          aria-label="Rok"
          className="h-8 rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-medium text-zinc-200"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
      {period !== null && indexOptions.length > 0 && (
        <Segmented
          label={kind === 'half' ? 'Półrocze' : 'Kwartał'}
          value={period.index ?? 1}
          options={indexOptions}
          onChange={(index) => emit({ ...period, index })}
        />
      )}
    </div>
  )
}
