'use client'

import { motion } from 'framer-motion'
import { Scissors, Palette, Sparkles } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import type { AnimationType } from '@/lib/quote-types'

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

export function PostprodukcjaTab() {
  const { data, updateField } = useQuote()

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Scissors className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Dni montazu</h3>
              <p className="text-xs text-zinc-400">Czas potrzebny na montaz materialu</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Dni</span>
              <span className="text-lg font-semibold tabular-nums text-white">{data.dniMontazu}</span>
            </div>
            <Slider
              value={[data.dniMontazu]}
              onValueChange={([val]) => updateField('dniMontazu', val)}
              min={1}
              max={21}
              step={1}
              className="py-2"
            />
            <div className="flex justify-between text-xs text-zinc-400">
              <span>1 dzien</span>
              <span>21 dni</span>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <motion.div variants={item}>
        <GlassCard>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Palette className="size-4" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Korekcja barwna</h3>
                <p className="text-xs text-zinc-400">Profesjonalny color grading</p>
              </div>
            </div>
            <Switch
              checked={data.korekcjaBarwna}
              onCheckedChange={(val) => updateField('korekcjaBarwna', val)}
              aria-label="Korekcja barwna"
            />
          </div>
        </GlassCard>
      </motion.div>

      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Animacje i grafika</h3>
              <p className="text-xs text-zinc-400">Elementy graficzne i animowane</p>
            </div>
          </div>
          <RadioGroup
            value={data.animacje}
            onValueChange={(val) => updateField('animacje', val as AnimationType)}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {([
              { value: 'brak', label: 'Brak', desc: 'Bez animacji' },
              { value: '2d', label: '2D', desc: 'Grafika 2D i lower thirds' },
              { value: '3d', label: 'Zaawansowane 3D', desc: 'Pelen motion design 3D' },
            ] as const).map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`anim-${opt.value}`}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all ${
                  data.animacje === opt.value
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                }`}
              >
                <RadioGroupItem value={opt.value} id={`anim-${opt.value}`} className="mt-0.5" />
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
  )
}
