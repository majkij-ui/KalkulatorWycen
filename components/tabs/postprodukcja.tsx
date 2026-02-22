'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Scissors, Plus, Trash2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Counter } from '@/components/counter'
import { GlassCard } from '@/components/glass-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useQuote } from '@/lib/quote-context'
import type {
  Deliverable,
  DeliverableFormat,
  KorekcjaBarwnaOpcja,
  AnimacjePostproOpcja,
  MuzykaPostproOpcja,
  SoundDesignOpcja,
  MasterDzwiekuOpcja,
  LektorPostproOpcja,
} from '@/lib/quote-types'

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

const FORMAT_OPCJE: { value: DeliverableFormat; label: string }[] = [
  { value: 'shorts', label: 'do 30sek shorts/reel' },
  { value: 'reportaz', label: '1–3 min reportaż' },
]

const KOREKCJA_OPCJE: { value: KorekcjaBarwnaOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: 'podstawowa', label: 'Podstawowa' },
  { value: 'zaawansowana', label: 'Zaawansowana' },
]

const ANIMACJE_OPCJE: { value: AnimacjePostproOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: '2d', label: '2D' },
  { value: 'ai', label: 'AI' },
]

const MUZYKA_OPCJE: { value: MuzykaPostproOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: 'copyfree', label: 'Copy-free' },
  { value: 'kompozytor', label: 'Kompozytor' },
]

const SOUND_DESIGN_OPCJE: { value: SoundDesignOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: 'prosty', label: 'Prosty' },
  { value: 'zlozony', label: 'Złożony' },
]

const MASTER_OPCJE: { value: MasterDzwiekuOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: 'podstawowy', label: 'Podstawowy' },
  { value: 'zlozony', label: 'Złożony' },
]

const LEKTOR_OPCJE: { value: LektorPostproOpcja; label: string }[] = [
  { value: 'brak', label: 'Brak' },
  { value: 'ai', label: 'AI' },
  { value: 'studio', label: 'Studio' },
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
          className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
            value === o.value
              ? 'border-primary/50 bg-primary/10 text-white'
              : 'border-white/5 bg-zinc-900/50 text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-zinc-400">{label}</span>
        {children}
      </div>
      <Separator className="my-2 bg-white/5" />
    </>
  )
}

function DeliverableCard({
  del,
  index,
  onUpdate,
  onRemove,
  canRemove,
}: {
  del: Deliverable
  index: number
  onUpdate: <K extends keyof Deliverable>(field: K, value: Deliverable[K]) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <GlassCard className="relative">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Format / Dostawa {index + 1}</h3>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={del.format} onValueChange={(v) => onUpdate('format', v as DeliverableFormat)}>
          <SelectTrigger className="w-[200px] border-white/10 bg-zinc-900/30 text-white backdrop-blur-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPCJE.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Counter
          compact
          label=""
          value={del.ilosc}
          onChange={(v) => onUpdate('ilosc', v)}
          min={1}
          max={20}
        />
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-8 text-zinc-500 hover:bg-transparent hover:text-red-400"
            onClick={onRemove}
            aria-label="Usuń format"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <div className="space-y-0">
        <OptionRow label="Korekcja barwna">
          <PillGroup value={del.korekcjaBarwna} options={KOREKCJA_OPCJE} onChange={(v) => onUpdate('korekcjaBarwna', v)} />
        </OptionRow>
        <OptionRow label="Animacje">
          <PillGroup value={del.animacje} options={ANIMACJE_OPCJE} onChange={(v) => onUpdate('animacje', v)} />
        </OptionRow>
        <OptionRow label="Muzyka">
          <PillGroup value={del.muzyka} options={MUZYKA_OPCJE} onChange={(v) => onUpdate('muzyka', v)} />
        </OptionRow>
        <OptionRow label="Sound Design">
          <PillGroup value={del.soundDesign} options={SOUND_DESIGN_OPCJE} onChange={(v) => onUpdate('soundDesign', v)} />
        </OptionRow>
        <OptionRow label="Master dźwięku">
          <PillGroup value={del.masterDzwieku} options={MASTER_OPCJE} onChange={(v) => onUpdate('masterDzwieku', v)} />
        </OptionRow>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-zinc-400">Lektor</span>
          <PillGroup value={del.lektor} options={LEKTOR_OPCJE} onChange={(v) => onUpdate('lektor', v)} />
        </div>
      </div>
    </GlassCard>
  )
}

export function PostprodukcjaTab() {
  const { data, updateField, addDeliverable, removeDeliverable, updateDeliverable } = useQuote()
  const isDetailed = data.isDetailedPostpro
  const deliverables = data.detailedDeliverables
  const unit = data.crudeEditUnit
  const count = data.crudeEditCount

  const sliderMax = unit === 'dni' ? 30 : 100
  const sliderStep = unit === 'dni' ? 0.5 : 1

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* Part 1: Szybka wycena montażu (crude) – hidden when detailed mode is ON */}
      <AnimatePresence initial={false}>
        {!isDetailed && (
          <motion.div
            key="crude-postpro"
            initial={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)', y: 0 }}
            exit={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            transition={{
              opacity: { duration: 0.3 },
              height: { duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] },
              filter: { duration: 0.3 },
            }}
            className="overflow-hidden"
          >
            <motion.div variants={container} initial="hidden" animate="show" className="pb-5">
              <motion.div variants={item}>
                <GlassCard>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Scissors className="size-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Szybka wycena montażu</h3>
                      <p className="text-xs text-zinc-400">
                        Wybierz jednostkę i podaj czas montażu
                      </p>
                    </div>
                  </div>

                  <div className="mb-4 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateField('crudeEditUnit', 'dni')}
                      className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                        unit === 'dni'
                          ? 'border-primary/50 bg-primary/10 text-white'
                          : 'border-white/5 bg-zinc-900/50 text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                      }`}
                    >
                      Dni
                    </button>
                    <button
                      type="button"
                      onClick={() => updateField('crudeEditUnit', 'godziny')}
                      className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                        unit === 'godziny'
                          ? 'border-primary/50 bg-primary/10 text-white'
                          : 'border-white/5 bg-zinc-900/50 text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                      }`}
                    >
                      Godziny
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">{unit === 'dni' ? 'Dni' : 'Godziny'}</span>
                      <span className="text-lg font-semibold tabular-nums text-white">
                        {unit === 'dni'
                          ? count % 1 === 0 ? count : count.toFixed(1).replace('.', ',')
                          : count}
                      </span>
                    </div>
                    <Slider
                      value={[count]}
                      onValueChange={([v]) => updateField('crudeEditCount', v)}
                      min={0}
                      max={sliderMax}
                      step={sliderStep}
                      className="py-2"
                    />
                    <div className="flex justify-between text-xs text-zinc-400">
                      <span>0</span>
                      <span>{sliderMax} {unit === 'dni' ? 'dni' : 'godz.'}</span>
                    </div>
                  </div>
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
              <p className="font-semibold text-white">Szczegółowa wycena postprodukcji</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Przełącz na precyzyjny dobór formatów i udźwiękowienia.
              </p>
            </div>
            <Switch
              checked={isDetailed}
              onCheckedChange={(v) => {
                updateField('isDetailedPostpro', v)
                if (v && data.detailedDeliverables.length === 0) addDeliverable()
              }}
              aria-label="Szczegółowa wycena postprodukcji"
            />
          </div>
        </div>
      </motion.div>

      {/* Part 2: Detailed section (AnimatePresence) */}
      <AnimatePresence initial={false}>
        {isDetailed && (
          <motion.div
            key="detailed-postpro"
            initial={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)', y: 0 }}
            exit={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            transition={{
              opacity: { duration: 0.3 },
              height: { duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] },
              filter: { duration: 0.3 },
            }}
            className="overflow-hidden"
          >
            <motion.div
              variants={container}
              initial="hidden"
              animate="show"
              className="space-y-5 pt-1 pb-1"
            >
              {deliverables.map((del, index) => (
                <motion.div key={del.id} variants={item}>
                  <DeliverableCard
                    del={del}
                    index={index}
                    onUpdate={(field, value) => updateDeliverable(del.id, field, value)}
                    onRemove={() => removeDeliverable(del.id)}
                    canRemove={deliverables.length > 1}
                  />
                </motion.div>
              ))}

              <motion.div variants={item}>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-white/10 bg-zinc-900/30 py-6 text-white backdrop-blur-xl hover:bg-white/10"
                  onClick={addDeliverable}
                >
                  <Plus className="size-5 mr-2" />
                  Dodaj kolejny format
                </Button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
