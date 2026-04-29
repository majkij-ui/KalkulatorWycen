'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'

export interface BipolarSliderProps
  extends Omit<
    React.ComponentProps<typeof SliderPrimitive.Root>,
    'value' | 'onValueChange' | 'min' | 'max' | 'step'
  > {
  value?: number[]
  onValueChange?: (value: number[]) => void
  min?: number
  max?: number
  step?: number
}

function BipolarSlider({
  className,
  value = [1.0],
  onValueChange,
  min = 0.5,
  max = 1.5,
  step = 0.05,
  ...props
}: BipolarSliderProps) {
  const val = value?.[0] ?? 1.0
  const minVal = min ?? 0.5
  const maxVal = max ?? 1.5
  const percent = ((val - minVal) / (maxVal - minVal)) * 100

  const isDiscount = val < 1.0
  const left = isDiscount ? percent : 50
  const width = isDiscount ? 50 - percent : percent - 50
  const fillColor = isDiscount ? 'bg-red-500' : 'bg-primary'

  return (
    <SliderPrimitive.Root
      data-slot="bipolar-slider"
      value={value}
      onValueChange={onValueChange}
      min={min}
      max={max}
      step={step}
      className={cn(
        'relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        {/* Custom bipolar fill from center: red left (discount), primary right (margin) */}
        {width > 0 && (
          <div
            role="presentation"
            aria-hidden
            className={cn(
              'absolute top-0 h-full rounded-full transition-[left,width]',
              fillColor,
            )}
            style={{
              left: `${left}%`,
              width: `${width}%`,
            }}
          />
        )}
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
      />
    </SliderPrimitive.Root>
  )
}

export { BipolarSlider }
