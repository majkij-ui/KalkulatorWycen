'use client'

import { useSyncExternalStore } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { dismissNotice, getNotices, subscribeNotices } from '@/lib/app-notices'

const EMPTY: never[] = []

/** Pasek komunikatów z tła (kopia zapasowa, ustawienia firmy). */
export function AppNotices() {
  const notices = useSyncExternalStore(subscribeNotices, getNotices, () => EMPTY)
  if (!notices.length) return null
  return (
    <div className="fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" role="status">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="flex max-w-xl items-start gap-3 rounded-lg border border-amber-500/30 bg-zinc-900/95 px-4 py-3 text-sm text-amber-100 shadow-lg backdrop-blur"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="flex-1">{notice.text}</p>
          <button
            type="button"
            onClick={() => dismissNotice(notice.id)}
            className="rounded p-0.5 text-zinc-400 hover:bg-white/10 hover:text-white"
            aria-label="Zamknij komunikat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
