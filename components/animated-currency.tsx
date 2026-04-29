'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

// A single digit slot that rolls up or down when its digit changes.
function RollingDigit({ digit, prevDigit }: { digit: string; prevDigit: string }) {
  const isDigit = /\d/.test(digit)
  const prevIsDigit = /\d/.test(prevDigit)

  if (!isDigit || !prevIsDigit || digit === prevDigit) {
    return (
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={digit}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="inline-block"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    )
  }

  const from = parseInt(prevDigit, 10)
  const to = parseInt(digit, 10)
  // Roll upward (positive direction) when the new digit is larger, downward otherwise.
  const up = to > from

  return (
    <span
      className="inline-block overflow-hidden"
      style={{ height: '1.25em', verticalAlign: 'top' }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={digit}
          initial={{ y: up ? '100%' : '-100%' }}
          animate={{ y: '0%' }}
          exit={{ y: up ? '-100%' : '100%' }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="block"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

interface AnimatedCurrencyProps {
  value: number
  format: (n: number) => string
  className?: string
  /** Ignored — kept for API compatibility. */
  duration?: number
}

export function AnimatedCurrency({ value, format, className }: AnimatedCurrencyProps) {
  // Round to nearest integer — currency amounts are always whole zloty/euro in this app.
  const rounded = Math.round(value)
  const formatted = format(rounded)

  // usePrevious pattern: read ref during render (gets last render's value), update after paint.
  const prevFormattedRef = useRef(formatted)
  const prevFormatted = prevFormattedRef.current
  useEffect(() => {
    prevFormattedRef.current = formatted
  })

  // Align prev and current from the RIGHT so digit positions match naturally.
  const curr = [...formatted]
  const prev = [...prevFormatted]
  const maxLen = Math.max(curr.length, prev.length)

  const paddedCurr = Array.from({ length: maxLen }, (_, i) => {
    const idx = i - (maxLen - curr.length)
    return idx >= 0 ? curr[idx] : ' ' // thin space placeholder
  })
  const paddedPrev = Array.from({ length: maxLen }, (_, i) => {
    const idx = i - (maxLen - prev.length)
    return idx >= 0 ? prev[idx] : ' '
  })

  return (
    <span className={cn('inline-flex items-baseline tabular-nums', className)}>
      {paddedCurr.map((char, i) => (
        <RollingDigit key={i} digit={char} prevDigit={paddedPrev[i]} />
      ))}
    </span>
  )
}
