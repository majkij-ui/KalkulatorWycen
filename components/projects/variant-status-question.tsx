'use client'

/**
 * „Który wariant przyjął klient?" (Q2). Status „W realizacji" / „Zrealizowany"
 * projektu z kilkoma wariantami ustawia się dopiero po odpowiedzi: wybrany
 * wariant idzie do rozliczeń (finanse liczą się z niego), „Anuluj" nie zmienia
 * niczego. Pytanie zadaje hub (`requestStatus`), z nagłówka i z sugestii po
 * wydarzeniu w kalendarzu.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import { docToSnapshot } from '@/lib/quote-documents'
import { formatMoney } from '@/lib/quote-currency'
import { PROJECT_STATUS_LABELS } from '@/lib/project-types'
import { listVariants, variantFigures } from '@/lib/quote-variants'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function VariantStatusQuestion() {
  const { statusQuestion, answerStatusQuestion, projects, quoteDocs } = useProjectHub()
  useSyncExternalStore(quoteDocs.subscribe, quoteDocs.version, quoteDocs.version)
  const project = statusQuestion ? projects.find((p) => p.id === statusQuestion.projectId) ?? null : null
  const variants = useMemo(() => (project ? listVariants(project) : []), [project])
  const [picked, setPicked] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPicked(variants.find((v) => v.chosen)?.id ?? null)
    setBlocked(false)
  }, [statusQuestion, variants])

  if (!statusQuestion || !project) return null

  const answer = async (variantId: string | null) => {
    setBusy(true)
    try {
      setBlocked((await answerStatusQuestion(variantId)) === 'blocked')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void answer(null)}>
      <DialogContent className="border-white/10 bg-zinc-950/95 text-zinc-100 backdrop-blur-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Który wariant przyjął klient?</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {project.name} → „{PROJECT_STATUS_LABELS[statusQuestion.to]}". Finanse projektu policzą się z wybranego
            wariantu; pozostałe zostają w wycenie.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2" role="radiogroup" aria-label="Wariant przyjęty przez klienta">
          {variants.map((v) => {
            const f = variantFigures(docToSnapshot(quoteDocs.get(v.docId)), project.client)
            const active = picked === v.id
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPicked(v.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                  active ? 'border-amber-400/40 bg-amber-400/10' : 'border-white/10 hover:border-white/25'
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  Wariant {v.label}
                  {v.chosen && <span className="ml-2 text-xs font-normal text-emerald-300/80">obecnie wybrany</span>}
                </span>
                <span className="text-right text-xs tabular-nums text-zinc-300">
                  {formatMoney(f.netto, f.currency, { decimals: 0 })}
                  {f.pdfNetto != null && (
                    <span className="block text-zinc-500">PDF {formatMoney(f.pdfNetto, f.pdfCurrency ?? 'PLN', { decimals: 0 })}</span>
                  )}
                </span>
                {active && <Check className="size-4 text-amber-300" />}
              </button>
            )
          })}
        </div>
        {blocked && (
          <p className="text-xs text-amber-200/90" role="alert">
            Wycena tego projektu czeka na odpowiedź o finanse z importu — odpowiedz najpierw w nagłówku projektu.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => void answer(null)} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={() => picked && void answer(picked)} disabled={busy || !picked}>
            Ustaw „{PROJECT_STATUS_LABELS[statusQuestion.to]}"
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
