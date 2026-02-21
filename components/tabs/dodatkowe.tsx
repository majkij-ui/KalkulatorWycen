'use client'

import { motion } from 'framer-motion'
import { MapPin, Mic, Music } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import type { MusicLicense } from '@/lib/quote-types'

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

export function DodatkoweTab() {
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
              <MapPin className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Koszty dojazdu</h3>
              <p className="text-xs text-zinc-400">Odleglosc do miejsca realizacji</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Kilometry</span>
              <span className="text-lg font-semibold tabular-nums text-white">{data.kosztDojazduKm} km</span>
            </div>
            <Slider
              value={[data.kosztDojazduKm]}
              onValueChange={([val]) => updateField('kosztDojazduKm', val)}
              min={0}
              max={500}
              step={10}
              className="py-2"
            />
            <div className="flex justify-between text-xs text-zinc-400">
              <span>0 km</span>
              <span>500 km</span>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <motion.div variants={item}>
        <GlassCard>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Mic className="size-4" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Lektor</h3>
                <p className="text-xs text-zinc-400">Profesjonalny lektor do narracji</p>
              </div>
            </div>
            <Switch
              checked={data.lektor}
              onCheckedChange={(val) => updateField('lektor', val)}
              aria-label="Lektor"
            />
          </div>
        </GlassCard>
      </motion.div>

      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Music className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Licencja muzyczna</h3>
              <p className="text-xs text-zinc-400">Rodzaj muzyki w tle</p>
            </div>
          </div>
          <RadioGroup
            value={data.licencjaMuzyczna}
            onValueChange={(val) => updateField('licencjaMuzyczna', val as MusicLicense)}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {([
              { value: 'stock', label: 'Stock', desc: 'Muzyka z biblioteki' },
              { value: 'premium', label: 'Premium', desc: 'Licencja rozszerzona' },
              { value: 'kompozytor', label: 'Kompozytor', desc: 'Dedykowana kompozycja' },
            ] as const).map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`music-${opt.value}`}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all ${
                  data.licencjaMuzyczna === opt.value
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/5'
                }`}
              >
                <RadioGroupItem value={opt.value} id={`music-${opt.value}`} className="mt-0.5" />
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
