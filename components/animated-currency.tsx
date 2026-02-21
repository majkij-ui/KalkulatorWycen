'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

interface AnimatedCurrencyProps {
  value: number
  format: (n: number) => string
  className?: string
  duration?: number
}

export function AnimatedCurrency({ value, format, className, duration = 0.5 }: AnimatedCurrencyProps) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)
  const rafRef = useRef<number>()

  useEffect(() => {
    const start = prevRef.current
    const end = value
    prevRef.current = value
    if (start === end) {
      setDisplay(end)
      return
    }
    const startTime = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / (duration * 1000), 1)
      const eased = 1 - (1 - t) * (1 - t)
      setDisplay(start + (end - start) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  return (
    <motion.span
      key={value}
      initial={{ opacity: 0.85 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className={className}
    >
      {format(Math.round(display * 100) / 100)}
    </motion.span>
  )
}
