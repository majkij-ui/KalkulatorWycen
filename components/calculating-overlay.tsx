'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Skeleton } from '@/components/ui/skeleton'

interface CalculatingOverlayProps {
  isVisible: boolean
}

export function CalculatingOverlay({ isVisible }: CalculatingOverlayProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 rounded-xl bg-background/80 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="size-8 rounded-full border-2 border-primary/30 border-t-primary"
            />
            <p className="text-sm font-medium text-zinc-400">
              Obliczanie...
            </p>
          </div>
          <div className="w-full max-w-sm space-y-3 px-8">
            <Skeleton className="h-4 w-full bg-white/5" />
            <Skeleton className="h-4 w-3/4 bg-white/5" />
            <Skeleton className="h-4 w-5/6 bg-white/5" />
            <Skeleton className="h-8 w-1/2 bg-white/5" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
