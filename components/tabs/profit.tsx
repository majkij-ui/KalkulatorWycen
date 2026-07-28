'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ClipboardList,
  Clapperboard,
  Scissors,
  Truck,
  ChevronDown,
  RotateCcw,
  Plus,
  Trash2,
  PiggyBank,
} from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import {
  resolveProfitSections,
  computeProfitSummary,
  computeFuelRatePerKm,
  PROFIT_SECTION_LABELS,
  type ProfitLine,
  type ProfitSectionResult,
} from '@/lib/profit-calc'
import { createProfitCustomItem, type ProfitCustomItem, type ProfitLineOverride, type ProfitSectionKey } from '@/lib/quote-types'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
}

const SECTION_ICONS: Record<ProfitSectionKey, React.ElementType> = {
  preprodukcja: ClipboardList,
  produkcja: Clapperboard,
  postprodukcja: Scissors,
  logistyka: Truck,
}

/** Mapowanie sekcji Profit → kategoria wyceny (dla kwoty "wycena" w nagłówku). */
const SECTION_TO_PHASE: Record<ProfitSectionKey, string> = {
  preprodukcja: 'Preprodukcja',
  produkcja: 'Produkcja',
  postprodukcja: 'Postprodukcja',
  logistyka: 'Dodatkowe',
}

const numInputClass =
  'h-8 bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white text-right'

function parseNonNegative(raw: string): number {
  if (raw === '') return 0
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

interface RowProps {
  line: ProfitLine
  formatCurrency: (n: number) => string
  onToggle: (checked: boolean) => void
  onQuantity: (value: number) => void
  onUnitCost: (value: number) => void
  onReset: () => void
  onLabelChange?: (value: string) => void
  onDelete?: () => void
}

function CostLineRow({ line, formatCurrency, onToggle, onQuantity, onUnitCost, onReset, onLabelChange, onDelete }: RowProps) {
  const potential = line.quantity * line.unitCost
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/5 py-2 last:border-b-0">
      <Checkbox
        checked={line.isCost}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={`Koszt: ${line.label || 'własna pozycja'}`}
      />
      <div className={`min-w-[160px] flex-1 ${line.isCost ? '' : 'opacity-50'}`}>
        {line.isCustom && onLabelChange ? (
          <Input
            value={line.label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="Nazwa kosztu…"
            className="h-8 w-full max-w-[260px] bg-black/40 border-white/10 text-sm text-white placeholder:text-zinc-500"
          />
        ) : (
          <>
            <span className={`text-sm ${line.isCost ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>
              {line.label}
            </span>
            {line.detail && <span className="ml-2 text-xs text-zinc-500">{line.detail}</span>}
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          step={1}
          value={line.quantity}
          onChange={(e) => onQuantity(parseNonNegative(e.target.value))}
          className={`${numInputClass} w-16`}
          aria-label="Ilość"
        />
        <span className="w-[74px] text-xs text-zinc-500">{line.unitLabel}</span>
      </div>
      <span className="text-xs text-zinc-600">×</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          step={50}
          value={line.unitCost}
          onChange={(e) => onUnitCost(parseNonNegative(e.target.value))}
          className={`${numInputClass} w-24`}
          aria-label="Stawka jednostkowa (PLN netto)"
        />
        <span className="text-xs text-zinc-500">zł</span>
      </div>
      <div className="w-[110px] text-right tabular-nums">
        {line.isCost ? (
          <span className="text-sm font-medium text-amber-400/80">{formatCurrency(line.total)}</span>
        ) : (
          <span className="text-xs text-zinc-600 line-through">{formatCurrency(potential)}</span>
        )}
      </div>
      <div className="flex w-8 items-center justify-end">
        {line.isCustom && onDelete ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-zinc-500 hover:text-red-400"
            onClick={onDelete}
            aria-label="Usuń pozycję"
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : line.isOverridden ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-zinc-500 hover:text-white"
            onClick={onReset}
            aria-label="Przywróć wartości z wyceny"
            title="Przywróć wartości z wyceny"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

interface FuelRowProps {
  line: ProfitLine
  fuelPrice: number
  consumption: number
  ratePerKm: number
  formatCurrency: (n: number) => string
  onToggle: (checked: boolean) => void
  onQuantity: (value: number) => void
  onFuelPrice: (value: number) => void
  onConsumption: (value: number) => void
  onReset: () => void
}

/** Dojazd: koszt liczony z równania paliwowego (km × spalanie/100 × cena paliwa). */
function FuelCostRow({ line, fuelPrice, consumption, ratePerKm, formatCurrency, onToggle, onQuantity, onFuelPrice, onConsumption, onReset }: FuelRowProps) {
  const potential = line.quantity * line.unitCost
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/5 py-2 last:border-b-0">
      <Checkbox
        checked={line.isCost}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label="Koszt: dojazd (paliwo)"
      />
      <div className={`min-w-[160px] flex-1 ${line.isCost ? '' : 'opacity-50'}`}>
        <span className={`text-sm ${line.isCost ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>
          {line.label}
        </span>
        <span className="ml-2 text-xs text-zinc-500 tabular-nums">
          stawka: {ratePerKm.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł/km
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          step={10}
          value={line.quantity}
          onChange={(e) => onQuantity(parseNonNegative(e.target.value))}
          className={`${numInputClass} w-24`}
          aria-label="Kilometry"
        />
        <span className="text-xs text-zinc-500">km</span>
      </div>
      <span className="text-xs text-zinc-600">×</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          step={0.1}
          value={fuelPrice}
          onChange={(e) => onFuelPrice(parseNonNegative(e.target.value))}
          className={`${numInputClass} w-[70px]`}
          aria-label="Cena paliwa (zł/l)"
        />
        <span className="text-xs text-zinc-500">zł/l</span>
      </div>
      <span className="text-xs text-zinc-600">×</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          step={0.5}
          value={consumption}
          onChange={(e) => onConsumption(parseNonNegative(e.target.value))}
          className={`${numInputClass} w-16`}
          aria-label="Średnie spalanie (l/100 km)"
        />
        <span className="text-xs text-zinc-500">l/100km</span>
      </div>
      <div className="w-[110px] text-right tabular-nums">
        {line.isCost ? (
          <span className="text-sm font-medium text-amber-400/80">{formatCurrency(line.total)}</span>
        ) : (
          <span className="text-xs text-zinc-600 line-through">{formatCurrency(potential)}</span>
        )}
      </div>
      <div className="flex w-8 items-center justify-end">
        {line.isOverridden ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-zinc-500 hover:text-white"
            onClick={onReset}
            aria-label="Przywróć wartości z wyceny"
            title="Przywróć wartości z wyceny"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function ProfitTab() {
  const { data, updateField, totals, formatCurrency, pricingConfig, calculateTotalCrewDays, breakdown } = useQuote()
  const autoCrewDays = calculateTotalCrewDays()

  const { sections, totalCost } = useMemo(
    () => resolveProfitSections(data, pricingConfig, autoCrewDays),
    [data, pricingConfig, autoCrewDays]
  )
  // Kwota przelewu: ręczne nadpisanie (jeśli ustawione) albo suma netto z kalkulatora.
  const transferOverridden = data.profitTransferAmount != null
  const transferAmount = data.profitTransferAmount ?? totals.sumaNetto
  const summary = computeProfitSummary(transferAmount, data.profitTaxRatePercent, totalCost)

  const [openSections, setOpenSections] = useState<Record<ProfitSectionKey, boolean>>({
    preprodukcja: true,
    produkcja: true,
    postprodukcja: true,
    logistyka: true,
  })

  const phaseNettoBySection = useMemo(() => {
    const map: Partial<Record<ProfitSectionKey, number>> = {}
    for (const [section, category] of Object.entries(SECTION_TO_PHASE) as [ProfitSectionKey, string][]) {
      map[section] = breakdown.find((p) => p.category === category)?.phaseNetto ?? 0
    }
    return map
  }, [breakdown])

  const setOverride = (key: string, patch: Partial<ProfitLineOverride>) => {
    const prev = data.profitOverrides?.[key] ?? {}
    updateField('profitOverrides', { ...(data.profitOverrides ?? {}), [key]: { ...prev, ...patch } })
  }

  const resetOverride = (key: string) => {
    const next = { ...(data.profitOverrides ?? {}) }
    delete next[key]
    updateField('profitOverrides', next)
  }

  const addCustomItem = (section: ProfitSectionKey) => {
    updateField('profitCustomItems', [...(data.profitCustomItems ?? []), createProfitCustomItem(section)])
  }

  const updateCustomItem = (id: string, patch: Partial<ProfitCustomItem>) => {
    updateField(
      'profitCustomItems',
      (data.profitCustomItems ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c))
    )
  }

  const removeCustomItem = (id: string) => {
    updateField('profitCustomItems', (data.profitCustomItems ?? []).filter((c) => c.id !== id))
  }

  const renderSection = (result: ProfitSectionResult) => {
    const Icon = SECTION_ICONS[result.section]
    const open = openSections[result.section]
    const quoteNetto = phaseNettoBySection[result.section] ?? 0
    return (
      <motion.div variants={item} key={result.section}>
        <GlassCard className="p-0">
          <Collapsible
            open={open}
            onOpenChange={(v) => setOpenSections((prev) => ({ ...prev, [result.section]: v }))}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl p-5 text-left transition-colors hover:bg-white/[0.02]"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-white">{PROFIT_SECTION_LABELS[result.section]}</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Wycena: <span className="tabular-nums">{formatCurrency(quoteNetto)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Koszty</p>
                    <p className="text-sm font-medium tabular-nums text-amber-400/80">
                      {formatCurrency(result.totalCost)}
                    </p>
                  </div>
                  <ChevronDown
                    className={`size-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-5 pb-5">
                <Separator className="mb-2 bg-white/5" />
                {result.lines.length === 0 && (
                  <p className="py-3 text-sm text-zinc-500">
                    Brak pozycji z wyceny w tej sekcji. Możesz dodać własny koszt poniżej.
                  </p>
                )}
                {result.lines.map((line) =>
                  line.key === 'log:dojazd' ? (
                    <FuelCostRow
                      key={line.key}
                      line={line}
                      fuelPrice={data.profitFuelPricePerLiter}
                      consumption={data.profitFuelConsumption}
                      ratePerKm={computeFuelRatePerKm(data)}
                      formatCurrency={formatCurrency}
                      onToggle={(v) => setOverride(line.key, { isCost: v })}
                      onQuantity={(v) => setOverride(line.key, { quantity: v })}
                      onFuelPrice={(v) => updateField('profitFuelPricePerLiter', v)}
                      onConsumption={(v) => updateField('profitFuelConsumption', v)}
                      onReset={() => resetOverride(line.key)}
                    />
                  ) : line.isCustom && line.customId ? (
                    <CostLineRow
                      key={line.key}
                      line={line}
                      formatCurrency={formatCurrency}
                      onToggle={(v) => updateCustomItem(line.customId!, { isCost: v })}
                      onQuantity={(v) => updateCustomItem(line.customId!, { quantity: v })}
                      onUnitCost={(v) => updateCustomItem(line.customId!, { unitCost: v })}
                      onLabelChange={(v) => updateCustomItem(line.customId!, { label: v })}
                      onDelete={() => removeCustomItem(line.customId!)}
                      onReset={() => {}}
                    />
                  ) : (
                    <CostLineRow
                      key={line.key}
                      line={line}
                      formatCurrency={formatCurrency}
                      onToggle={(v) => setOverride(line.key, { isCost: v })}
                      onQuantity={(v) => setOverride(line.key, { quantity: v })}
                      onUnitCost={(v) => setOverride(line.key, { unitCost: v })}
                      onReset={() => resetOverride(line.key)}
                    />
                  )
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 h-8 rounded-lg border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10"
                  onClick={() => addCustomItem(result.section)}
                >
                  <Plus className="mr-1 size-3.5" />
                  Dodaj własny koszt
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </GlassCard>
      </motion.div>
    )
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-5">
      {/* Podsumowanie: Zysk netto vs Suma z wyceny */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
                <PiggyBank className="size-3.5" />
                Zysk netto
              </div>
              <p
                className={`mt-1 text-4xl font-bold tabular-nums ${
                  summary.zysk >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {formatCurrency(summary.zysk)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Marża: <span className="tabular-nums">{summary.marzaPct.toFixed(1)}%</span> sumy netto
              </p>
            </div>
            <div className="min-w-[260px] space-y-2 text-sm">
              <div className="flex items-center justify-between gap-6">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  Kwota przelewu
                  {transferOverridden && (
                    <button
                      type="button"
                      onClick={() => updateField('profitTransferAmount', null)}
                      title={`Przywróć sumę z wyceny (${formatCurrency(totals.sumaNetto)})`}
                      aria-label="Przywróć sumę z wyceny"
                      className="text-zinc-500 transition-colors hover:text-white"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={Math.max(0, Number(transferAmount) || 0)}
                    onChange={(e) => updateField('profitTransferAmount', parseNonNegative(e.target.value))}
                    className={`${numInputClass} w-32`}
                    aria-label="Kwota przelewu (netto PLN)"
                  />
                  <span className="text-xs text-zinc-500">zł</span>
                </div>
              </div>
              {transferOverridden && (
                <p className="text-right text-[11px] text-zinc-600">
                  Suma z wyceny: <span className="tabular-nums">{formatCurrency(totals.sumaNetto)}</span>
                </p>
              )}
              <div className="flex items-center justify-between gap-6">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  Ryczałt
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={data.profitTaxRatePercent}
                    onChange={(e) => {
                      const raw = e.target.value
                      const n = Number(raw)
                      updateField(
                        'profitTaxRatePercent',
                        raw === '' ? 0 : Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
                      )
                    }}
                    className={`${numInputClass} w-16 h-7`}
                    aria-label="Stawka ryczałtu (%)"
                  />
                  <span className="text-zinc-500">%</span>
                </span>
                <span className="tabular-nums text-red-400/80">−{formatCurrency(summary.podatek)}</span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-zinc-400">Koszty łącznie</span>
                <span className="tabular-nums text-red-400/80">−{formatCurrency(summary.koszty)}</span>
              </div>
              <Separator className="bg-white/5" />
              <p className="text-xs text-zinc-600">
                Kwoty netto — VAT 23% jest tylko przekazywany i nie wpływa na zysk.
              </p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Sekcje kosztów */}
      {sections.map(renderSection)}
    </motion.div>
  )
}
