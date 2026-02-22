'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Clapperboard, Users, Camera, Plus, Trash2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Counter } from '@/components/counter'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import type { PakietSprzetu, ShootingDay, SprzetOpcja, DronOpcja } from '@/lib/quote-types'

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

const PAKIET_OPCJE: { value: PakietSprzetu; label: string; desc: string }[] = [
  { value: 'minimalistyczny', label: 'Minimalistyczny', desc: 'Run & gun, podstawowe światło' },
  { value: 'standard', label: 'Standard', desc: 'Wywiady, mniejsze plany' },
  { value: 'kinowy', label: 'Kinowy', desc: 'Reklama, zaawansowany sprzęt (RED/ARRI)' },
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      {children}
    </div>
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
          <Row label="ReżOp">
            <Counter compact label="" value={day.rezOp} onChange={(v) => onUpdate('rezOp', v)} min={0} max={2} />
          </Row>
          <Row label="Asystent/Operator">
            <Counter compact label="" value={day.asystent} onChange={(v) => onUpdate('asystent', v)} min={0} max={4} />
          </Row>
          <Row label="Gafer">
            <Counter compact label="" value={day.gafer} onChange={(v) => onUpdate('gafer', v)} min={0} max={2} />
          </Row>
          <Row label="Dźwiękowiec">
            <Counter compact label="" value={day.dzwiekowiec} onChange={(v) => onUpdate('dzwiekowiec', v)} min={0} max={2} />
          </Row>
          <Row label="MUA (Wizaż)">
            <Counter compact label="" value={day.mua} onChange={(v) => onUpdate('mua', v)} min={0} max={2} />
          </Row>
        </div>

        <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary/80 mb-3 mt-6">Obsada</h4>
        <div className="space-y-0">
          <Row label="Aktor">
            <Counter compact label="" value={day.aktor} onChange={(v) => onUpdate('aktor', v)} min={0} max={5} />
          </Row>
          <Row label="Model">
            <Counter compact label="" value={day.model} onChange={(v) => onUpdate('model', v)} min={0} max={5} />
          </Row>
          <Row label="Statysta/Epizodysta">
            <Counter compact label="" value={day.statysta} onChange={(v) => onUpdate('statysta', v)} min={0} max={20} />
          </Row>
        </div>

        <h4 className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary/80 mb-3 mt-6">Sprzęt</h4>
        <div className="space-y-0">
          <Row label="Kamera Sony Mirrorless">
            <Counter compact label="" value={day.kameraSony} onChange={(v) => onUpdate('kameraSony', v)} min={0} max={2} />
          </Row>
          <Row label="Kamera Red Komodo X">
            <Counter compact label="" value={day.kameraRed} onChange={(v) => onUpdate('kameraRed', v)} min={0} max={2} />
          </Row>
          <Row label="Obiektywy">
            <PillGroup value={day.obiektywy} options={SPRZET_OPCJE} onChange={(v) => onUpdate('obiektywy', v)} />
          </Row>
          <Row label="Stabilizacja">
            <PillGroup value={day.stabilizacja} options={SPRZET_OPCJE} onChange={(v) => onUpdate('stabilizacja', v)} />
          </Row>
          <Row label="Podgląd">
            <PillGroup value={day.podglad} options={SPRZET_OPCJE} onChange={(v) => onUpdate('podglad', v)} />
          </Row>
          <Row label="Światło">
            <PillGroup value={day.swiatlo} options={SPRZET_OPCJE} onChange={(v) => onUpdate('swiatlo', v)} />
          </Row>
          <Row label="Dron">
            <PillGroup value={day.dron} options={DRON_OPCJE} onChange={(v) => onUpdate('dron', v)} />
          </Row>
        </div>
      </div>
    </GlassCard>
  )
}

export function ProdukcjaTab() {
  const { data, updateField, addShootingDay, removeShootingDay, updateShootingDay } = useQuote()
  const isDetailed = data.isDetailedProdukcja
  const days = data.detailedShootingDays

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
                    <span className="text-lg font-semibold tabular-nums text-white">{data.dniZdjeciowe}</span>
                  </div>
                  <Slider
                    value={[data.dniZdjeciowe]}
                    onValueChange={([val]) => updateField('dniZdjeciowe', val)}
                    min={1}
                    max={14}
                    step={1}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>1 dzień</span>
                    <span>14 dni</span>
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
                    value={data.wielkoscEkipy}
                    onChange={(val) => updateField('wielkoscEkipy', val)}
                    min={1}
                    max={20}
                  />
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
                    <Label
                      key={opt.value}
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
                if (v && data.detailedShootingDays.length === 0) addShootingDay()
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
