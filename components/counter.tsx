'use client'

import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CounterProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  label: string
  className?: string
}

export function Counter({ value, onChange, min = 0, max = 99, label, className }: CounterProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <span className="text-sm font-medium text-zinc-400">{label}</span>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="size-8 rounded-lg border-white/10 bg-white/5 text-foreground hover:bg-white/10"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Zmniejsz ${label}`}
        >
          <Minus className="size-4" />
        </Button>
        <span className="w-8 text-center text-lg font-semibold tabular-nums text-white">
          {value}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8 rounded-lg border-white/10 bg-white/5 text-foreground hover:bg-white/10"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Zwieksz ${label}`}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}
