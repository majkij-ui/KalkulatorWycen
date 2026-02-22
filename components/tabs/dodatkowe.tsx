'use client'

import { motion } from 'framer-motion'
import { MapPin } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'

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
              <p className="text-xs text-zinc-400">Odległość do miejsca realizacji</p>
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
    </motion.div>
  )
}
