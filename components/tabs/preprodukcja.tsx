'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Calendar, UserCheck, MapPin, Minus, Plus } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import type { ScenarioType } from '@/lib/quote-types'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const item = {
  hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.4, ease: 'easeOut' } },
}

export function PreprodukcjaTab() {
  const { data, updateField } = useQuote()
  const isDetailed = data.isDetailedPrepro

  const dniValue = Math.max(0, Math.min(10, Number(data.dniDokumentacji) || 0))
  const setDni = (v: number) => updateField('dniDokumentacji', Math.max(0, Math.min(10, Number(v) ?? 0)))

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* Part 1: Dni dokumentacji (crude) – hidden when detailed mode is ON */}
      <AnimatePresence initial={false}>
        {!isDetailed && (
          <motion.div
            key="crude-prepro"
            initial={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)', y: 0 }}
            exit={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            transition={{ opacity: { duration: 0.3 }, height: { duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }, filter: { duration: 0.3 } }}
            className="overflow-hidden"
          >
            <motion.div variants={container} initial="hidden" animate="show" className="pb-5">
              <motion.div variants={item}>
                <GlassCard>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Calendar className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Dni dokumentacji</h3>
                    <p className="text-xs text-zinc-400">
                      Liczba dni potrzebnych na przygotowanie
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Dni</span>
                    <span className="text-lg font-semibold tabular-nums text-white">
                      {dniValue % 1 === 0 ? dniValue : dniValue.toFixed(1).replace('.', ',')}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                      onClick={() => setDni(Math.max(0, dniValue - 0.5))}
                      disabled={dniValue <= 0}
                      aria-label="Zmniejsz dni"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Slider
                      value={[dniValue]}
                      onValueChange={([v]) => setDni(Number(v) ?? 0)}
                      min={0}
                      max={10}
                      step={0.5}
                      className="flex-1 py-2"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                      onClick={() => setDni(Math.min(10, dniValue + 0.5))}
                      disabled={dniValue >= 10}
                      aria-label="Zwiększ dni"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>0</span>
                    <span>10 dni</span>
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
              <p className="font-semibold text-white">Szczegółowa wycena preprodukcji</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Przełącz na precyzyjny dobór elementów zamiast wyceny dniowej.
              </p>
            </div>
            <Switch
              checked={isDetailed}
              onCheckedChange={(v) => updateField('isDetailedPrepro', v)}
              aria-label="Szczegółowa wycena preprodukcji"
            />
          </div>
        </div>
      </motion.div>

      {/* Part 2: Detailed section (AnimatePresence) */}
      <AnimatePresence initial={false}>
        {isDetailed && (
          <motion.div
            key="detailed-prepro"
            initial={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)', y: 0 }}
            exit={{ height: 0, opacity: 0, filter: 'blur(8px)', y: -10 }}
            transition={{ opacity: { duration: 0.3 }, height: { duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }, filter: { duration: 0.3 } }}
            className="overflow-hidden"
          >
            {/* Re-trigger the container variants so children become visible */}
            <motion.div
              variants={container}
              initial="hidden"
              animate="show"
              className="space-y-5 pt-1 pb-1"
            >
              <motion.div variants={item}>
                <GlassCard>
                  <div className="mb-4 flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Scenariusz</h3>
                    <p className="text-xs text-zinc-400">Wybierz poziom rozbudowy scenariusza</p>
                    </div>
                  </div>
                  <RadioGroup
                  value={data.scenariusz}
                  onValueChange={(val) => updateField('scenariusz', val as ScenarioType)}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                >
                  {([
                    { value: 'brak', label: 'Brak', desc: 'Bez scenariusza' },
                    { value: 'podstawowy', label: 'Podstawowy', desc: 'Zarys i kluczowe sceny' },
                    { value: 'rozbudowany', label: 'Rozbudowany', desc: 'Pełny scenariusz z dialogami' },
                  ] as const).map((opt) => (
                    <Label
                      key={opt.value}
                      htmlFor={`scenario-${opt.value}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all ${
                        data.scenariusz === opt.value
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                      }`}
                    >
                      <RadioGroupItem value={opt.value} id={`scenario-${opt.value}`} className="mt-0.5" />
                      <div>
                        <span className="text-sm font-medium text-white">{opt.label}</span>
                        <p className="text-xs text-zinc-400">{opt.desc}</p>
                      </div>
                    </Label>
                  ))}
                  </RadioGroup>
                </GlassCard>
              </motion.div>

              <motion.div variants={item}>
                <GlassCard>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <MapPin className="size-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Wizja lokalna</h3>
                        <p className="text-xs text-zinc-400">Sprawdzenie lokacji przed zdjęciami</p>
                      </div>
                    </div>
                    <Switch
                      checked={data.wizjaLokalna}
                      onCheckedChange={(val) => updateField('wizjaLokalna', val)}
                      aria-label="Wizja lokalna"
                    />
                  </div>
                </GlassCard>
              </motion.div>

              <motion.div variants={item}>
                <GlassCard>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <UserCheck className="size-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Kierownik produkcji</h3>
                        <p className="text-xs text-zinc-400">Dedykowany koordynator projektu</p>
                      </div>
                    </div>
                    <Switch
                      checked={data.kierownikProdukcji}
                      onCheckedChange={(val) => updateField('kierownikProdukcji', val)}
                      aria-label="Kierownik produkcji"
                    />
                  </div>
                </GlassCard>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
