'use client'

import { motion } from 'framer-motion'
import { Clapperboard, Users, Camera } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Counter } from '@/components/counter'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import type { EquipmentClass } from '@/lib/quote-types'

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

export function ProdukcjaTab() {
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
              <Clapperboard className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Liczba dni zdjeciowych</h3>
              <p className="text-xs text-zinc-400">Ile dni planowanych jest na planie</p>
            </div>
          </div>
          <div className="space-y-3">
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
              <span>1 dzien</span>
              <span>14 dni</span>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Wielkosc ekipy</h3>
              <p className="text-xs text-zinc-400">Liczba osob na planie filmowym</p>
            </div>
          </div>
          <Counter
            label="Osoby w ekipie"
            value={data.wielkoscEkipy}
            onChange={(val) => updateField('wielkoscEkipy', val)}
            min={1}
            max={20}
          />
        </GlassCard>
      </motion.div>

      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Camera className="size-4" />
            </div>
            <div>
<h3 className="font-semibold text-white">Klasa sprzetu</h3>
            <p className="text-xs text-zinc-400">Poziom uzytego sprzetu filmowego</p>
            </div>
          </div>
          <RadioGroup
            value={data.klasaSprzetu}
            onValueChange={(val) => updateField('klasaSprzetu', val as EquipmentClass)}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {([
              { value: 'standard', label: 'Standard', desc: 'DSLR / Mirrorless' },
              { value: 'cinema', label: 'Cinema', desc: 'RED / ARRI Amira' },
              { value: 'premium', label: 'Premium', desc: 'ARRI Alexa / Sony Venice' },
            ] as const).map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`equip-${opt.value}`}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all ${
                  data.klasaSprzetu === opt.value
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
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
  )
}
