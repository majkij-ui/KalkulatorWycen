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
  /** Compact style: smaller buttons (size-7) and text-sm number */
  compact?: boolean
}

export function Counter({ value, onChange, min = 0, max = 99, label, className, compact }: CounterProps) {
  return (
    <div className={cn('flex items-center justify-between', className, !label && 'justify-end')}>
      {label ? <span className="text-sm font-medium text-zinc-400">{label}</span> : null}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'rounded-lg border-white/10 bg-white/5 text-foreground hover:bg-white/10',
            compact ? 'size-7' : 'size-8'
          )}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Zmniejsz ${label}`}
        >
          <Minus className={compact ? 'size-3' : 'size-4'} />
        </Button>
        <span
          className={cn(
            'tabular-nums text-white',
            compact ? 'w-6 text-center text-sm font-medium' : 'w-8 text-center text-lg font-semibold'
          )}
        >
          {value}
        </span>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'rounded-lg border-white/10 bg-white/5 text-foreground hover:bg-white/10',
            compact ? 'size-7' : 'size-8'
          )}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Zwiększ ${label}`}
        >
          <Plus className={compact ? 'size-3' : 'size-4'} />
        </Button>
      </div>
    </div>
  )
}
