'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Car, Utensils, Bed, Scale, FileText, Minus, Plus, Sparkles, Users, Copy } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Counter } from '@/components/counter'
import { GlassCard } from '@/components/glass-card'
import { InlinePrice } from '@/components/ui/inline-price'
import { useQuote } from '@/lib/quote-context'
import { currencyUnit, fromPln } from '@/lib/quote-currency'
import { DEFAULT_PRICING } from '@/lib/pricing-config'
import { computeFuelRatePerKm } from '@/lib/profit-calc'
import { dayActorCount } from '@/lib/quote-crew'
import type { ExtraAmountKind, ExtraMode, QuoteData } from '@/lib/quote-types'
import { getExtrasBase } from '@/lib/quote-calc'
import { extraAmount, resolveExtra, type ExtraKey } from '@/lib/quote-extras'

const DP = DEFAULT_PRICING

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

const inputClass =
  'w-20 h-8 text-right bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white'

const EXTRA_MODES: { value: ExtraMode; label: string }[] = [
  { value: 'w-cenie', label: 'W cenie' },
  { value: 'opcja', label: 'Jako opcja' },
  { value: 'ukryj', label: 'Nie pokazuj' },
]

/** W1: jedna pozycja (prawa albo surowy materiał) — te same kontrolki dla obu. */
function ExtraControl(props: {
  id: string
  title: string
  hint: string
  mode: ExtraMode
  kind: ExtraAmountKind
  percent: number
  percentModified: boolean
  fixed: number
  unit: string
  amountText: string | null
  onMode: (m: ExtraMode) => void
  onKind: (k: ExtraAmountKind) => void
  onPercent: (v: number) => void
  onFixed: (v: number) => void
}) {
  const seg = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs transition-colors ${
      active ? 'border-primary/50 bg-primary/10 text-white' : 'border-white/10 bg-zinc-900/50 text-zinc-400 hover:bg-white/5'
    }`
  return (
    <div className="rounded-lg border border-white/5 bg-zinc-900/30 p-3" data-testid={`extra-${props.id}`}>
      <div className="mb-2">
        <span className="text-sm font-medium text-white">{props.title}</span>
        <p className="text-xs text-zinc-500">{props.hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${props.title}: tryb`}>
        {EXTRA_MODES.map((m) => (
          <button key={m.value} type="button" aria-pressed={props.mode === m.value} className={seg(props.mode === m.value)} onClick={() => props.onMode(m.value)}>
            {m.label}
          </button>
        ))}
      </div>
      {props.mode !== 'ukryj' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-1.5" role="group" aria-label={`${props.title}: rodzaj kwoty`}>
            <button type="button" aria-pressed={props.kind === 'percent'} className={seg(props.kind === 'percent')} onClick={() => props.onKind('percent')}>
              % od ceny
            </button>
            <button type="button" aria-pressed={props.kind === 'fixed'} className={seg(props.kind === 'fixed')} onClick={() => props.onKind('fixed')}>
              Własna kwota
            </button>
          </div>
          {props.kind === 'percent' ? (
            <InlinePrice value={props.percent} onChange={props.onPercent} isModified={props.percentModified} suffix="%" step={1} min={0} />
          ) : (
            <div className="flex items-center gap-1.5">
              <Input
                aria-label={`${props.title}: kwota (${props.unit})`}
                type="number"
                min={0}
                step={100}
                value={props.fixed}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  props.onFixed(Number.isFinite(n) ? Math.max(0, n) : 0)
                }}
                className={inputClass}
              />
              <span>{props.unit}</span>
            </div>
          )}
          {props.amountText && (
            <span className="ml-auto tabular-nums">
              {props.mode === 'w-cenie' ? 'Doliczone:' : 'Opcja w PDF:'}{' '}
              <span className="font-medium text-amber-400/80">{props.amountText}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function LogistykaRow({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-white/5 text-zinc-400">
          <Icon className="size-3.5" />
        </div>
        <span className="text-sm text-zinc-400">{label}</span>
      </div>
      <div className="min-w-0 flex-1 flex justify-end">
        {children}
      </div>
    </div>
  )
}

export function DodatkoweTab() {
  const { data, updateField, calculateTotalCrewDays, pricingConfig, updatePricingValue, breakdown, formatCurrency, money, clientData, clientPricing, marginMultiplier } = useQuote()
  const totalCrewDays = calculateTotalCrewDays()
  // Kwoty wpisane tutaj są w walucie wyceny (S3); paliwo to mój koszt w zł.
  const unit = currencyUnit(money.currency)
  const pc = pricingConfig.dodatkowe

  const dodPhase = breakdown.find(p => p.category === 'Dodatkowe')
  const travelNetto = dodPhase?.items.find(i => i.label === 'Koszty dojazdu')?.lineNetto ?? 0
  const cateringNetto = dodPhase?.items.find(i => i.label === 'Catering')?.lineNetto ?? 0
  const lodgingNetto = dodPhase?.items.find(i => i.label === 'Noclegi')?.lineNetto ?? 0
  // W1: podstawa % to cena bez prawa i surowego materiału; kwota pokazuje się też dla „Jako opcja".
  const extrasBase = getExtrasBase(clientData, marginMultiplier, clientPricing)
  const extraView = (key: ExtraKey) => {
    const setting = resolveExtra(clientData, clientPricing, key)
    const amount = extraAmount(setting, extrasBase)
    return { setting, amountText: setting.mode !== 'ukryj' && amount > 0 ? formatCurrency(amount) : null }
  }
  const rightsView = extraView('rights')
  const rawView = extraView('raw')
  const rightsSetting = resolveExtra(data, pricingConfig, 'rights')
  const rawSetting = resolveExtra(data, pricingConfig, 'raw')

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* Logistyka na planie: Dojazd + Wyżywienie + Nocleg */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-6">
            <h3 className="font-semibold text-white">Logistyka na planie</h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Dojazd, wyżywienie i noclegi dla ekipy i obsady
            </p>
          </div>

          {/* Row 1: Dojazd */}
          <LogistykaRow label="Dojazd" icon={Car}>
            <div className="flex w-full max-w-md flex-col gap-2">
              <div className="flex items-center gap-2 justify-end">
                <Input
                  type="number"
                  min={0}
                  max={9999}
                  value={Math.max(0, Math.min(9999, Number(data.kosztDojazduKm) || 0))}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      updateField('kosztDojazduKm', 0)
                      return
                    }
                    const n = Number(raw)
                    updateField('kosztDojazduKm', Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : 0)
                  }}
                  className="w-20 h-8 text-right bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white"
                />
                <span className="text-sm text-zinc-400">km</span>
              </div>
              <Slider
                value={[Math.max(0, Math.min(1000, Number(data.kosztDojazduKm) || 0))]}
                onValueChange={([val]) => updateField('kosztDojazduKm', Math.max(0, Math.min(1000, Number(val) ?? 0)))}
                min={0}
                max={1000}
                step={10}
                className="flex-1 py-1"
              />
              <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-zinc-500">
                <span>Paliwo:</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={Math.max(0, Number(data.profitFuelPricePerLiter) || 0)}
                    onChange={(e) => {
                      const raw = e.target.value
                      const n = Number(raw)
                      updateField('profitFuelPricePerLiter', raw === '' ? 0 : Number.isFinite(n) ? Math.max(0, n) : 0)
                    }}
                    className="w-[70px] h-7 text-right bg-black/40 border-white/10 text-xs rounded-md tabular-nums text-white"
                    aria-label="Cena paliwa (zł/l)"
                  />
                  <span>zł/l</span>
                </div>
                <span className="text-zinc-600">×</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={Math.max(0, Number(data.profitFuelConsumption) || 0)}
                    onChange={(e) => {
                      const raw = e.target.value
                      const n = Number(raw)
                      updateField('profitFuelConsumption', raw === '' ? 0 : Number.isFinite(n) ? Math.max(0, n) : 0)
                    }}
                    className="w-16 h-7 text-right bg-black/40 border-white/10 text-xs rounded-md tabular-nums text-white"
                    aria-label="Średnie spalanie (l/100 km)"
                  />
                  <span>l/100km</span>
                </div>
                <span className="text-zinc-600">=</span>
                <span className="tabular-nums text-zinc-400">
                  {computeFuelRatePerKm(data).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  zł/km
                  {money.currency !== 'PLN' && (
                    <>
                      {' '}(≈ {fromPln(computeFuelRatePerKm(data), money).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {unit}/km)
                    </>
                  )}
                </span>
              </div>
              {travelNetto > 0 && (
                <div className="flex items-center justify-end gap-1 text-xs">
                  <span className="text-zinc-500">Łącznie:</span>
                  <span className="text-amber-400/80 tabular-nums font-medium">{formatCurrency(travelNetto)}</span>
                </div>
              )}
            </div>
          </LogistykaRow>
          <div className="flex justify-between px-0 text-[10px] text-zinc-500">
            <span>0 km</span>
            <span>1000 km</span>
          </div>

          <Separator className="my-6 bg-white/5" />

          {/* Row 2: Wyżywienie (Catering) */}
          <div className="flex flex-col gap-3">
            <LogistykaRow label="Wyżywienie (Catering)" icon={Utensils}>
              <div className="flex items-center gap-3">
                {cateringNetto > 0 && (
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-zinc-500">Łącznie:</span>
                    <span className="tabular-nums font-medium text-amber-400/80">{formatCurrency(cateringNetto)}</span>
                  </div>
                )}
                <Switch
                  checked={data.includeCatering}
                  onCheckedChange={(v) => updateField('includeCatering', v)}
                  aria-label="Wyżywienie (Catering)"
                />
              </div>
            </LogistykaRow>
            <AnimatePresence initial={false}>
              {data.includeCatering && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="overflow-hidden space-y-3 pl-9"
                >
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Stawka za osobodzień ({unit})</span>
                    <Counter
                      compact
                      label=""
                      value={data.cateringRate}
                      onChange={(v) => updateField('cateringRate', Math.max(0, Math.min(2000, v)))}
                      min={0}
                      max={2000}
                      step={10}
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Ręczna liczba osobodni</span>
                    <Switch
                      checked={data.cateringOverride}
                      onCheckedChange={(v) => updateField('cateringOverride', v)}
                      aria-label="Ręczna liczba osobodni"
                    />
                  </div>
                  {!data.cateringOverride ? (
                    <span className="text-sm text-zinc-500">
                      Wyliczono automatycznie: {totalCrewDays} osobodni
                    </span>
                  ) : (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm text-zinc-400">Podaj liczbę osobodni</span>
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('cateringCustomDays', Math.max(1, data.cateringCustomDays - 1))}
                          disabled={data.cateringCustomDays <= 1}
                          aria-label="Zmniejsz"
                        >
                          <Minus className="size-4" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          value={data.cateringCustomDays}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              updateField('cateringCustomDays', 1)
                              return
                            }
                            const n = parseInt(raw, 10)
                            if (!isNaN(n)) updateField('cateringCustomDays', Math.max(1, Math.min(999, n)))
                          }}
                          className="w-16 h-8 text-center bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('cateringCustomDays', Math.min(999, data.cateringCustomDays + 1))}
                          disabled={data.cateringCustomDays >= 999}
                          aria-label="Zwiększ"
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Separator className="my-6 bg-white/5" />

          {/* Row 3: Nocleg (Lodging) */}
          <div className="flex flex-col gap-3">
            <LogistykaRow label="Nocleg (Hotele/Apartamenty)" icon={Bed}>
              <div className="flex items-center gap-3">
                {lodgingNetto > 0 && (
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-zinc-500">Łącznie:</span>
                    <span className="tabular-nums font-medium text-amber-400/80">{formatCurrency(lodgingNetto)}</span>
                  </div>
                )}
                <Switch
                  checked={data.includeLodging}
                  onCheckedChange={(v) => updateField('includeLodging', v)}
                  aria-label="Nocleg"
                />
              </div>
            </LogistykaRow>
            <AnimatePresence initial={false}>
              {data.includeLodging && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="overflow-hidden space-y-3 pl-9"
                >
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Stawka za osobodzień ({unit})</span>
                    <Counter
                      compact
                      label=""
                      value={data.lodgingRate}
                      onChange={(v) => updateField('lodgingRate', Math.max(0, Math.min(2000, v)))}
                      min={0}
                      max={2000}
                      step={10}
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Ręczna liczba osobodni</span>
                    <Switch
                      checked={data.lodgingOverride}
                      onCheckedChange={(v) => updateField('lodgingOverride', v)}
                      aria-label="Ręczna liczba osobodni (nocleg)"
                    />
                  </div>
                  {!data.lodgingOverride ? (
                    <span className="text-sm text-zinc-500">
                      Wyliczono automatycznie: {totalCrewDays} osobodni
                    </span>
                  ) : (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm text-zinc-400">Podaj liczbę osobodni</span>
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('lodgingCustomDays', Math.max(1, data.lodgingCustomDays - 1))}
                          disabled={data.lodgingCustomDays <= 1}
                          aria-label="Zmniejsz"
                        >
                          <Minus className="size-4" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          value={data.lodgingCustomDays}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              updateField('lodgingCustomDays', 1)
                              return
                            }
                            const n = parseInt(raw, 10)
                            if (!isNaN(n)) updateField('lodgingCustomDays', Math.max(1, Math.min(999, n)))
                          }}
                          className="w-16 h-8 text-center bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('lodgingCustomDays', Math.min(999, data.lodgingCustomDays + 1))}
                          disabled={data.lodgingCustomDays >= 999}
                          aria-label="Zwiększ"
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </GlassCard>
      </motion.div>

      {/* Section A: Prawa autorskie */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Scale className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Licencja i Prawa Autorskie</h3>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <ExtraControl
              id="rights"
              title="Przekazanie praw"
              hint="Dopłata od ceny bez tych dwóch pozycji (z marżą)"
              mode={rightsSetting.mode}
              kind={rightsSetting.kind}
              percent={rightsSetting.percent}
              percentModified={rightsSetting.percent !== DP.dodatkowe.pelnePrzekazaniePrawProcent}
              fixed={rightsSetting.fixed}
              unit={unit}
              amountText={rightsView.amountText}
              onMode={(m) => {
                updateField('rightsMode', m)
                // Stary czytnik copyrightType: w sync z trybem praw.
                updateField('copyrightType', m === 'w-cenie' ? 'przekazanie' : 'licencja')
              }}
              onKind={(k) => updateField('rightsAmountKind', k)}
              onPercent={(v) => updatePricingValue('dodatkowe', 'pelnePrzekazaniePrawProcent', v)}
              onFixed={(v) => updateField('rightsFixedAmount', v)}
            />
            <ExtraControl
              id="raw"
              title="Przekazanie surowego materiału"
              hint="Dopłata od tej samej podstawy co prawa (nie od praw)"
              mode={rawSetting.mode}
              kind={rawSetting.kind}
              percent={rawSetting.percent}
              percentModified={rawSetting.percent !== DP.dodatkowe.surowyMaterialProcent}
              fixed={rawSetting.fixed}
              unit={unit}
              amountText={rawView.amountText}
              onMode={(m) => updateField('rawMode', m)}
              onKind={(k) => updateField('rawAmountKind', k)}
              onPercent={(v) => updatePricingValue('dodatkowe', 'surowyMaterialProcent', v)}
              onFixed={(v) => updateField('rawFixedAmount', v)}
            />
          </div>
          <AnimatePresence initial={false}>
            {rightsSetting.mode === 'w-cenie' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <Separator className="my-4 bg-white/5" />

                {/* Per-actor copyright transfer fee — flat, independent of shooting days */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-md bg-white/5 text-zinc-400">
                      <Users className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm text-zinc-300">Honorarium aktorów za przekazanie praw</span>
                      <p className="text-xs text-zinc-500">
                        Jednorazowa kwota za aktora (niezależna od liczby dni zdjęciowych).
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 pl-9">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="actor-rights-amount" className="text-xs text-zinc-400 whitespace-nowrap">
                        Kwota za aktora ({unit})
                      </Label>
                      <Input
                        id="actor-rights-amount"
                        type="number"
                        min={0}
                        step={100}
                        value={Math.max(0, Number(data.actorRightsTransferAmount) || 0)}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            updateField('actorRightsTransferAmount', 0)
                            return
                          }
                          const n = Number(raw)
                          updateField('actorRightsTransferAmount', Number.isFinite(n) ? Math.max(0, n) : 0)
                        }}
                        className={inputClass}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="actor-rights-count" className="text-xs text-zinc-400 whitespace-nowrap">
                        Liczba aktorów
                      </Label>
                      <Input
                        id="actor-rights-count"
                        type="number"
                        min={0}
                        max={99}
                        value={Math.max(0, Math.min(99, Number(data.liczbaAktorow) || 0))}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            updateField('liczbaAktorow', 0)
                            return
                          }
                          const n = parseInt(raw, 10)
                          if (!isNaN(n)) updateField('liczbaAktorow', Math.max(0, Math.min(99, n)))
                        }}
                        className={inputClass}
                      />
                      {data.isDetailedProdukcja && Array.isArray(data.detailedShootingDays) && data.detailedShootingDays.length > 0 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => {
                            const first = data.detailedShootingDays?.[0]
                            const aktor = first ? dayActorCount(first) : 0
                            updateField('liczbaAktorow', Math.max(0, Math.min(99, aktor)))
                          }}
                          aria-label="Skopiuj liczbę aktorów z 1. dnia zdjęciowego"
                          title="Skopiuj z 1. dnia zdjęciowego"
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {(Number(data.actorRightsTransferAmount) || 0) > 0 && (Number(data.liczbaAktorow) || 0) > 0 && (
                    <div className="pl-9 text-xs text-zinc-500">
                      Razem:{' '}
                      <span className="text-primary tabular-nums">
                        {((Number(data.actorRightsTransferAmount) || 0) * (Number(data.liczbaAktorow) || 0)).toLocaleString('pl-PL', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        {unit}
                      </span>{' '}
                      (doliczone do Produkcji, bez marży)
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </motion.div>

      {/* Section B: Warunki współpracy (PDF) */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Warunki współpracy (PDF)</h3>
              <p className="text-xs text-zinc-400">
                Te informacje pojawią się jako klauzule na wygenerowanej wycenie.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Revisions */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="revisions-toggle" className="text-sm text-zinc-300 cursor-pointer">
                  Limit darmowych poprawek
                </Label>
                <Switch
                  id="revisions-toggle"
                  checked={data.includeRevisionsInfo}
                  onCheckedChange={(v) => updateField('includeRevisionsInfo', v)}
                  aria-label="Limit darmowych poprawek"
                />
              </div>
              <AnimatePresence initial={false}>
                {data.includeRevisionsInfo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap items-center gap-4 pt-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="included-revisions" className="text-xs text-zinc-400 whitespace-nowrap">
                          Liczba darmowych rund
                        </Label>
                        <Input
                          id="included-revisions"
                          type="number"
                          min={0}
                          max={20}
                          value={Math.max(0, Math.min(20, Number(data.includedRevisions) || 0))}
                          onChange={(e) => updateField('includedRevisions', Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
                          className={inputClass}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="extra-revision-price" className="text-xs text-zinc-400 whitespace-nowrap">
                          Koszt dodatkowej rundy ({unit})
                        </Label>
                        <Input
                          id="extra-revision-price"
                          type="number"
                          min={0}
                          step={50}
                          value={Math.max(0, Number(data.extraRevisionPrice) || 0)}
                          onChange={(e) => updateField('extraRevisionPrice', Math.max(0, Number(e.target.value) || 0))}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Separator className="my-4 bg-white/5" />

            {/* Overtime */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="overtime-toggle" className="text-sm text-zinc-300 cursor-pointer">
                  Zasady nadgodzin na planie
                </Label>
                <Switch
                  id="overtime-toggle"
                  checked={data.includeOvertimeInfo}
                  onCheckedChange={(v) => updateField('includeOvertimeInfo', v)}
                  aria-label="Zasady nadgodzin na planie"
                />
              </div>
              <AnimatePresence initial={false}>
                {data.includeOvertimeInfo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap items-center gap-4 pt-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="standard-day-hours" className="text-xs text-zinc-400 whitespace-nowrap">
                          Długość dnia pracy (godziny)
                        </Label>
                        <Input
                          id="standard-day-hours"
                          type="number"
                          min={1}
                          max={24}
                          value={Math.max(1, Math.min(24, Number(data.standardDayHours) || 10))}
                          onChange={(e) => updateField('standardDayHours', Math.max(1, Math.min(24, Number(e.target.value) || 10)))}
                          className={inputClass}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="overtime-hourly-rate" className="text-xs text-zinc-400 whitespace-nowrap">
                          Koszt nadgodziny ({unit}/osobę)
                        </Label>
                        <Input
                          id="overtime-hourly-rate"
                          type="number"
                          min={0}
                          step={50}
                          value={Math.max(0, Number(data.overtimeHourlyRate) || 0)}
                          onChange={(e) => updateField('overtimeHourlyRate', Math.max(0, Number(e.target.value) || 0))}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Opcje dodatkowe (Upsell) */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Opcje dodatkowe (Upsell)</h3>
              <p className="text-xs text-zinc-400">
                Zasugeruj klientowi płatne opcje, które nie wchodzą w główną wycenę.
              </p>
            </div>
          </div>
          <Textarea
            value={data.opcjeDodatkowe}
            onChange={(e) => updateField('opcjeDodatkowe', e.target.value)}
            placeholder={
              money.currency === 'EUR'
                ? 'np. - ujęcia z drona FPV: 250 €\n- dodatkowa wersja 9:16 (Reels): 190 €'
                : 'np. - ujęcia z drona FPV: 1000 zł\n- dodatkowa wersja 9:16 (Reels): 800 zł'
            }
            className="bg-black/40 border-white/10 resize-none min-h-[100px] text-sm text-white placeholder:text-zinc-500"
          />
        </GlassCard>
      </motion.div>
    </motion.div>
  )
}
