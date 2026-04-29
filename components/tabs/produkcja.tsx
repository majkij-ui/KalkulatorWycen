'use client'

import { useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clapperboard, Users, Camera, Plus, Minus, Trash2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Counter } from '@/components/counter'
import { GlassCard } from '@/components/glass-card'
import { InlinePrice } from '@/components/ui/inline-price'
import { useQuote } from '@/lib/quote-context'
import { DEFAULT_PRICING } from '@/lib/pricing-config'
import type { CrewRoleKey, PakietSprzetu, ShootingDay, SprzetOpcja, DronOpcja } from '@/lib/quote-types'
import { computeShootingDayNet } from '@/lib/quote-calc'

const DP = DEFAULT_PRICING

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.4, ease: 'easeOut' } },
}

const SPRZET_OPCJE: { value: SprzetOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: 'standard', label: 'Standard' },
  { value: 'rental', label: 'Rental' },
]

const DRON_OPCJE: { value: DronOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: 'dji', label: 'DJI' },
  { value: 'fpv', label: 'FPV' },
]

const PAKIET_OPCJE: { value: PakietSprzetu; label: string; desc: string; priceKey: 'pakietSprzetowyMinimalistyczny' | 'pakietSprzetowyStandard' | 'pakietSprzetowyKinowy' }[] = [
  { value: 'minimalistyczny', label: 'Minimalistyczny', desc: 'Run & gun, reportaże', priceKey: 'pakietSprzetowyMinimalistyczny' },
  { value: 'standard', label: 'Standard', desc: 'Wywiady, mniejsze plany', priceKey: 'pakietSprzetowyStandard' },
  { value: 'kinowy', label: 'Kinowy', desc: 'Reklama, zaawansowany sprzęt (RED/ARRI)', priceKey: 'pakietSprzetowyKinowy' },
]

function PillGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-all cursor-pointer ${
            value === o.value
              ? 'bg-primary/10 border-primary/50 text-white'
              : 'bg-zinc-900/50 border-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 gap-2">
      <span className="text-sm text-zinc-400 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {children}
      </div>
    </div>
  )
}

// Click-to-edit inline label for crew role names.
function EditableLabel({ value, placeholder, onChange }: {
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isCustom = !!value

  function startEdit() { setDraft(value); setEditing(true) }
  function commit() { setEditing(false); onChange(draft.trim()) }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        placeholder={placeholder}
        className="text-sm bg-transparent border-b border-primary/40 outline-none text-zinc-200 w-28 max-w-[7rem]"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      title="Kliknij aby edytować"
      className={`text-sm text-left group flex items-center gap-1 shrink-0 ${isCustom ? 'text-zinc-200' : 'text-zinc-400 hover:text-zinc-300'}`}
    >
      <span>{isCustom ? value : placeholder}</span>
      <span className="text-[9px] opacity-0 group-hover:opacity-40 transition-opacity leading-none">✎</span>
    </button>
  )
}

// Inline editable adjustment amount (can be negative).
function AdjustmentInput({ value, onChange, formatCurrency }: {
  value: number
  onChange: (v: number) => void
  formatCurrency: (n: number) => string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() { setDraft(value === 0 ? '' : String(value)); setEditing(true) }
  function commit() {
    setEditing(false)
    const parsed = parseFloat(draft.replace(',', '.').replace(/\s/g, ''))
    onChange(isNaN(parsed) ? 0 : Math.round(parsed))
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        placeholder="0"
        className="text-sm text-right bg-transparent border-b border-primary/40 outline-none text-zinc-200 w-24 tabular-nums"
      />
    )
  }

  const display = value === 0
    ? <span className="text-zinc-600 text-sm">+ 0</span>
    : <span className={`text-sm tabular-nums font-medium ${value < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
        {value > 0 ? '+' : ''}{formatCurrency(value)}
      </span>

  return (
    <button
      type="button"
      onClick={startEdit}
      title="Kliknij aby ustawić korektę"
      className="group flex items-center gap-1"
    >
      {display}
      <span className="text-[9px] opacity-0 group-hover:opacity-40 transition-opacity leading-none text-zinc-400">✎</span>
    </button>
  )
}

function DayCard({
  day,
  index,
  onUpdate,
  onRemove,
  canRemove,
}: {
  day: ShootingDay
  index: number
  onUpdate: <K extends keyof ShootingDay>(field: K, value: ShootingDay[K]) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const { pricingConfig, updatePricingValue, marginMultiplier, formatCurrency } = useQuote()
  const pc = pricingConfig.produkcja
  const crewNames = day.crewNames ?? {}

  function setCrewName(role: CrewRoleKey, name: string) {
    onUpdate('crewNames', { ...crewNames, [role]: name })
  }

  // Live day subtotal displayed at the bottom of the card.
  const dayBaseNetto = computeShootingDayNet(day, pc) * marginMultiplier
  const adj = day.dayAdjustment ?? 0
  const dayFinalNetto = dayBaseNetto + adj

  return (
    <GlassCard className="relative">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Dzień zdjęciowy {index + 1}</h3>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-zinc-500 hover:text-red-400 hover:bg-transparent"
            onClick={onRemove}
            aria-label="Usuń dzień"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary/80 mb-3 mt-6 first:mt-0">Ekipa</h4>
        <div className="space-y-0">
          <Row label={<EditableLabel value={crewNames.rezOp ?? ''} placeholder="ReżOp" onChange={(v) => setCrewName('rezOp', v)} />}>
            <InlinePrice value={pc.rezOp} onChange={(v) => updatePricingValue('produkcja', 'rezOp', v)} isModified={pc.rezOp !== DP.produkcja.rezOp} />
            <Counter compact label="" value={day.rezOp} onChange={(v) => onUpdate('rezOp', v)} min={0} />
          </Row>
          <Row label={<EditableLabel value={crewNames.asystent ?? ''} placeholder="Asystent/Operator" onChange={(v) => setCrewName('asystent', v)} />}>
            <InlinePrice value={pc.asystentOperator} onChange={(v) => updatePricingValue('produkcja', 'asystentOperator', v)} isModified={pc.asystentOperator !== DP.produkcja.asystentOperator} />
            <Counter compact label="" value={day.asystent} onChange={(v) => onUpdate('asystent', v)} min={0} />
          </Row>
          <Row label={<EditableLabel value={crewNames.gafer ?? ''} placeholder="Gafer" onChange={(v) => setCrewName('gafer', v)} />}>
            <InlinePrice value={pc.gafer} onChange={(v) => updatePricingValue('produkcja', 'gafer', v)} isModified={pc.gafer !== DP.produkcja.gafer} />
            <Counter compact label="" value={day.gafer} onChange={(v) => onUpdate('gafer', v)} min={0} />
          </Row>
          <Row label={<EditableLabel value={crewNames.dzwiekowiec ?? ''} placeholder="Dźwiękowiec" onChange={(v) => setCrewName('dzwiekowiec', v)} />}>
            <InlinePrice value={pc.dzwiekowiec} onChange={(v) => updatePricingValue('produkcja', 'dzwiekowiec', v)} isModified={pc.dzwiekowiec !== DP.produkcja.dzwiekowiec} />
            <Counter compact label="" value={day.dzwiekowiec} onChange={(v) => onUpdate('dzwiekowiec', v)} min={0} />
          </Row>
          <Row label={<EditableLabel value={crewNames.mua ?? ''} placeholder="MUA (Wizaż)" onChange={(v) => setCrewName('mua', v)} />}>
            <InlinePrice value={pc.mua} onChange={(v) => updatePricingValue('produkcja', 'mua', v)} isModified={pc.mua !== DP.produkcja.mua} />
            <Counter compact label="" value={day.mua} onChange={(v) => onUpdate('mua', v)} min={0} />
          </Row>
        </div>

        <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary/80 mb-3 mt-6">Obsada</h4>
        <div className="space-y-0">
          <Row label={<EditableLabel value={crewNames.aktor ?? ''} placeholder="Aktor" onChange={(v) => setCrewName('aktor', v)} />}>
            <InlinePrice value={pc.aktor} onChange={(v) => updatePricingValue('produkcja', 'aktor', v)} isModified={pc.aktor !== DP.produkcja.aktor} />
            <Counter compact label="" value={day.aktor} onChange={(v) => onUpdate('aktor', v)} min={0} />
          </Row>
          <Row label={<EditableLabel value={crewNames.model ?? ''} placeholder="Model" onChange={(v) => setCrewName('model', v)} />}>
            <InlinePrice value={pc.model} onChange={(v) => updatePricingValue('produkcja', 'model', v)} isModified={pc.model !== DP.produkcja.model} />
            <Counter compact label="" value={day.model} onChange={(v) => onUpdate('model', v)} min={0} />
          </Row>
          <Row label={<EditableLabel value={crewNames.statysta ?? ''} placeholder="Statysta/Epizodysta" onChange={(v) => setCrewName('statysta', v)} />}>
            <InlinePrice value={pc.statystaEpizodysta} onChange={(v) => updatePricingValue('produkcja', 'statystaEpizodysta', v)} isModified={pc.statystaEpizodysta !== DP.produkcja.statystaEpizodysta} />
            <Counter compact label="" value={day.statysta} onChange={(v) => onUpdate('statysta', v)} min={0} />
          </Row>
        </div>

        <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary/80 mb-3 mt-6">Sprzęt</h4>
        <div className="space-y-0">
          <Row label="Kamera Sony Mirrorless">
            <InlinePrice value={pc.kameraSonyMirrorless} onChange={(v) => updatePricingValue('produkcja', 'kameraSonyMirrorless', v)} isModified={pc.kameraSonyMirrorless !== DP.produkcja.kameraSonyMirrorless} />
            <Counter compact label="" value={day.kameraSony} onChange={(v) => onUpdate('kameraSony', v)} min={0} />
          </Row>
          <Row label="Kamera Red Komodo X">
            <InlinePrice value={pc.kameraRedKomodoX} onChange={(v) => updatePricingValue('produkcja', 'kameraRedKomodoX', v)} isModified={pc.kameraRedKomodoX !== DP.produkcja.kameraRedKomodoX} />
            <Counter compact label="" value={day.kameraRed} onChange={(v) => onUpdate('kameraRed', v)} min={0} />
          </Row>
          <Row label="Obiektywy">
            {day.obiektywy !== 'brak' && (
              <InlinePrice
                value={day.obiektywy === 'standard' ? pc.obiektywyStandard : pc.obiektywyRental}
                onChange={(v) => updatePricingValue('produkcja', day.obiektywy === 'standard' ? 'obiektywyStandard' : 'obiektywyRental', v)}
                isModified={day.obiektywy === 'standard' ? pc.obiektywyStandard !== DP.produkcja.obiektywyStandard : pc.obiektywyRental !== DP.produkcja.obiektywyRental}
              />
            )}
            <PillGroup value={day.obiektywy} options={SPRZET_OPCJE} onChange={(v) => onUpdate('obiektywy', v as SprzetOpcja)} />
          </Row>
          <Row label="Stabilizacja">
            {day.stabilizacja !== 'brak' && (
              <InlinePrice
                value={day.stabilizacja === 'standard' ? pc.stabilizacjaStandard : pc.stabilizacjaRental}
                onChange={(v) => updatePricingValue('produkcja', day.stabilizacja === 'standard' ? 'stabilizacjaStandard' : 'stabilizacjaRental', v)}
                isModified={day.stabilizacja === 'standard' ? pc.stabilizacjaStandard !== DP.produkcja.stabilizacjaStandard : pc.stabilizacjaRental !== DP.produkcja.stabilizacjaRental}
              />
            )}
            <PillGroup value={day.stabilizacja} options={SPRZET_OPCJE} onChange={(v) => onUpdate('stabilizacja', v as SprzetOpcja)} />
          </Row>
          <Row label="Podgląd">
            {day.podglad !== 'brak' && (
              <InlinePrice
                value={day.podglad === 'standard' ? pc.podgladStandard : pc.podgladRental}
                onChange={(v) => updatePricingValue('produkcja', day.podglad === 'standard' ? 'podgladStandard' : 'podgladRental', v)}
                isModified={day.podglad === 'standard' ? pc.podgladStandard !== DP.produkcja.podgladStandard : pc.podgladRental !== DP.produkcja.podgladRental}
              />
            )}
            <PillGroup value={day.podglad} options={SPRZET_OPCJE} onChange={(v) => onUpdate('podglad', v as SprzetOpcja)} />
          </Row>
          <Row label="Światło">
            {day.swiatlo !== 'brak' && (
              <InlinePrice
                value={day.swiatlo === 'standard' ? pc.swiatloStandard : pc.swiatloRental}
                onChange={(v) => updatePricingValue('produkcja', day.swiatlo === 'standard' ? 'swiatloStandard' : 'swiatloRental', v)}
                isModified={day.swiatlo === 'standard' ? pc.swiatloStandard !== DP.produkcja.swiatloStandard : pc.swiatloRental !== DP.produkcja.swiatloRental}
              />
            )}
            <PillGroup value={day.swiatlo} options={SPRZET_OPCJE} onChange={(v) => onUpdate('swiatlo', v as SprzetOpcja)} />
          </Row>
          <Row label="Dron">
            {day.dron !== 'brak' && (
              <InlinePrice
                value={day.dron === 'dji' ? pc.dronDji : pc.dronFpv}
                onChange={(v) => updatePricingValue('produkcja', day.dron === 'dji' ? 'dronDji' : 'dronFpv', v)}
                isModified={day.dron === 'dji' ? pc.dronDji !== DP.produkcja.dronDji : pc.dronFpv !== DP.produkcja.dronFpv}
              />
            )}
            <PillGroup value={day.dron} options={DRON_OPCJE} onChange={(v) => onUpdate('dron', v as DronOpcja)} />
          </Row>
        </div>
      </div>

      {/* Day subtotal + adjustment */}
      <div className="mt-5 pt-4 border-t border-white/10 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Podstawa dnia</span>
          <span className="tabular-nums text-zinc-400">{formatCurrency(Math.round(dayBaseNetto))}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Korekta / Zniżka</span>
          <AdjustmentInput
            value={adj}
            onChange={(v) => onUpdate('dayAdjustment', v)}
            formatCurrency={formatCurrency}
          />
        </div>
        {adj !== 0 && (
          <div className="flex items-center justify-between text-sm font-semibold pt-1.5 border-t border-white/5">
            <span className="text-zinc-300">Razem dzień</span>
            <span className={`tabular-nums ${adj < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {formatCurrency(Math.round(dayFinalNetto))}
            </span>
          </div>
        )}
      </div>
    </GlassCard>
  )
}

export function ProdukcjaTab() {
  const { data, updateField, addShootingDay, removeShootingDay, updateShootingDay, pricingConfig, updatePricingValue, formatCurrency } = useQuote()
  const pc = pricingConfig.produkcja
  const isDetailed = data.isDetailedProdukcja
  const days = data.detailedShootingDays ?? []
  const dniZdjeciowe = Math.max(0, Math.min(14, Number(data.dniZdjeciowe) || 0))
  const crudeDaysTotal = dniZdjeciowe * pc.stawkaOperatoraSzybkaWycena

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* Part 1: Szybka wycena (Ogólna) – crude panel, hidden when detailed mode is ON */}
      <AnimatePresence initial={false}>
        {!isDetailed && (
          <motion.div
            key="crude-produkcja"
            initial={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)', y: 0 }}
            exit={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            transition={{ opacity: { duration: 0.3 }, height: { duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }, filter: { duration: 0.3 } }}
            className="overflow-hidden"
          >
            <motion.div variants={container} initial="hidden" animate="show" className="pb-5">
              <motion.div variants={item}>
                <GlassCard>
                <h2 className="mb-6 text-lg font-semibold text-white">Szybka wycena (Ogólna)</h2>

                {/* Liczba dni zdjęciowych */}
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Clapperboard className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-white">Liczba dni zdjęciowych</h3>
                    <p className="text-xs text-zinc-400">
                      Ile dni planowanych jest na planie
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Dni</span>
                    <span className="text-lg font-semibold tabular-nums text-white">
                      {dniZdjeciowe}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Stawka operatora / dzień</span>
                    <InlinePrice
                      value={pc.stawkaOperatoraSzybkaWycena}
                      onChange={(v) => updatePricingValue('produkcja', 'stawkaOperatoraSzybkaWycena', v)}
                      isModified={pc.stawkaOperatoraSzybkaWycena !== DP.produkcja.stawkaOperatoraSzybkaWycena}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                      onClick={() => updateField('dniZdjeciowe', Math.max(0, (Number(data.dniZdjeciowe) || 0) - 1))}
                      disabled={(Number(data.dniZdjeciowe) || 0) <= 0}
                      aria-label="Zmniejsz dni"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Slider
                      value={[dniZdjeciowe]}
                      onValueChange={([val]) => updateField('dniZdjeciowe', Math.max(0, Math.min(14, Number(val) ?? 0)))}
                      min={0}
                      max={14}
                      step={1}
                      className="flex-1 py-2"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                      onClick={() => updateField('dniZdjeciowe', Math.min(14, (Number(data.dniZdjeciowe) || 0) + 1))}
                      disabled={(Number(data.dniZdjeciowe) || 0) >= 14}
                      aria-label="Zwiększ dni"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>0 dni</span>
                    <span>14 dni</span>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-right text-xs text-zinc-300">
                    Razem (stawka × dni): <span className="font-medium text-white">{formatCurrency(crudeDaysTotal)}</span>
                  </div>
                </div>

                <Separator className="my-6 bg-white/10" />

                {/* Wielkość ekipy */}
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Users className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-white">Wielkość ekipy</h3>
                    <p className="text-xs text-zinc-400">Liczba osób na planie filmowym</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Counter
                    label="Osoby w ekipie"
                    value={Math.max(1, Math.min(20, Number(data.wielkoscEkipy) || 1))}
                    onChange={(val) => updateField('wielkoscEkipy', Math.max(1, Math.min(20, Number(val) ?? 1)))}
                    min={1}
                    max={20}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div>
                      <p className="text-sm font-medium text-white">Dopłata za Reż-Opa</p>
                      <p className="text-xs text-zinc-400">Dodatkowa stawka za łączenie funkcji reżysera i operatora</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <InlinePrice
                        value={pc.doplataRezOpSzybkaWycena}
                        onChange={(v) => updatePricingValue('produkcja', 'doplataRezOpSzybkaWycena', v)}
                        isModified={pc.doplataRezOpSzybkaWycena !== DP.produkcja.doplataRezOpSzybkaWycena}
                      />
                      <Switch
                        checked={data.crudeRezOpSurcharge}
                        onCheckedChange={(v) => updateField('crudeRezOpSurcharge', v)}
                        aria-label="Dopłata za Reż-Opa"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div>
                      <p className="text-sm font-medium text-white">Dopłata za drona</p>
                      <p className="text-xs text-zinc-400">Dodatkowa stawka dzienna za ujęcia lotnicze</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <InlinePrice
                        value={pc.doplataDronSzybkaWycena}
                        onChange={(v) => updatePricingValue('produkcja', 'doplataDronSzybkaWycena', v)}
                        isModified={pc.doplataDronSzybkaWycena !== DP.produkcja.doplataDronSzybkaWycena}
                      />
                      <Switch
                        checked={data.crudeDroneSurcharge}
                        onCheckedChange={(v) => updateField('crudeDroneSurcharge', v)}
                        aria-label="Dopłata za drona"
                      />
                    </div>
                  </div>
                </div>

                <Separator className="my-6 bg-white/10" />

                {/* Pakiet sprzętowy */}
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Camera className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-white">Pakiet sprzętowy</h3>
                    <p className="text-xs text-zinc-400">Poziom użytego sprzętu filmowego</p>
                  </div>
                </div>
                <RadioGroup
                  value={data.klasaSprzetu}
                  onValueChange={(val) => updateField('klasaSprzetu', val as PakietSprzetu)}
                  className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
                >
                  {PAKIET_OPCJE.map((opt) => (
                    <div key={opt.value} className="flex flex-col gap-1">
                      <Label
                        htmlFor={`equip-${opt.value}`}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all ${
                          data.klasaSprzetu === opt.value ? 'border-primary/50 bg-primary/5' : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                        }`}
                      >
                        <RadioGroupItem value={opt.value} id={`equip-${opt.value}`} className="mt-0.5" />
                        <div>
                          <span className="text-sm font-medium text-white">{opt.label}</span>
                          <p className="text-xs text-zinc-400">{opt.desc}</p>
                        </div>
                      </Label>
                      <div className="flex justify-end pr-1">
                        <InlinePrice
                          value={pc[opt.priceKey]}
                          onChange={(v) => updatePricingValue('produkcja', opt.priceKey, v)}
                          isModified={pc[opt.priceKey] !== DP.produkcja[opt.priceKey]}
                        />
                      </div>
                    </div>
                  ))}
                </RadioGroup>
                </GlassCard>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Divider + Toggle */}
      <motion.div variants={item} className="space-y-4">
        <Separator className="bg-white/10" />
        <div className="rounded-xl border-t border-l border-white/10 bg-zinc-900/30 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-white">Szczegółowa wycena produkcji</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Przełącz na precyzyjny dobór ekipy i sprzętu na każdy dzień.
              </p>
            </div>
            <Switch
              checked={isDetailed}
              onCheckedChange={(v) => {
                updateField('isDetailedProdukcja', v)
                if (v && (data.detailedShootingDays ?? []).length === 0) addShootingDay()
              }}
              aria-label="Szczegółowa wycena produkcji"
            />
          </div>
        </div>
      </motion.div>

      {/* Part 2: Detailed section (AnimatePresence) */}
      <AnimatePresence initial={false}>
        {isDetailed && (
          <motion.div
            key="detailed-produkcja"
            initial={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)', y: 0 }}
            exit={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            transition={{ opacity: { duration: 0.3 }, height: { duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }, filter: { duration: 0.3 } }}
            className="overflow-hidden"
          >
            <motion.div
              variants={container}
              initial="hidden"
              animate="show"
              className="space-y-5 pt-1 pb-1"
            >
              {days.map((day, index) => (
                <motion.div key={day.id} variants={item}>
                  <DayCard
                    day={day}
                    index={index}
                    onUpdate={(field, value) => updateShootingDay(day.id, field, value)}
                    onRemove={() => removeShootingDay(day.id)}
                    canRemove={days.length > 1}
                  />
                </motion.div>
              ))}

              <motion.div variants={item}>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-white/10 bg-zinc-900/30 py-6 text-white hover:bg-white/10 backdrop-blur-xl"
                  onClick={addShootingDay}
                >
                  <Plus className="size-5 mr-2" />
                  Dodaj kolejny dzień zdjęciowy
                </Button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
