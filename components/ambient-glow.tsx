'use client'

import { useState, useEffect } from 'react'

export function AmbientGlow() {
  const [position, setPosition] = useState({ x: 50, y: 40 })

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100
      const y = (e.clientY / window.innerHeight) * 100
      setPosition({ x, y })
    }
    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [])

  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute size-[min(120vw,800px)] rounded-full opacity-100 blur-3xl transition-[left,top] duration-700 ease-out"
        style={{
          left: `calc(${position.x}% - min(60vw, 400px))`,
          top: `calc(${position.y}% - min(60vw, 400px))`,
          background: 'radial-gradient(circle, rgb(37 99 235 / 0.1) 0%, transparent 70%)',
        }}
      />
    </div>
  )
}
