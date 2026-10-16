'use client'

/**
 * Warianty wyceny A/B/C w zakładce Wycena (Q2, `lib/quote-variants.ts`).
 *
 * Projekt z jedną wyceną widzi tylko „+ Wariant". Z kilkoma: przełącznik
 * wariantów (✓ = wybrany do rozliczeń), zmiana nazwy (dwuklik albo ✎),
 * usunięcie z „Cofnij", „Wybierz do rozliczeń" (projekt w realizacji albo z
 * finansami z importu pyta najpierw) i tabela „Porównaj warianty".
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, Copy, FilePlus2, Pencil, Plus, Rows3, Trash2, X } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import { docToSnapshot } from '@/lib/quote-documents'
import { computeSnapshotFinancials } from '@/lib/quote-financials'
import { formatMoney } from '@/lib/quote-currency'
import { countsTowardRevenue, type Project } from '@/lib/project-types'
import { hasAlternatives, listVariants, variantFigures, type VariantView } from '@/lib/quote-variants'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function formatPln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

type Notice =
  | { type: 'deleted'; id: string; label: string }
  | { type: 'chosen'; label: string; previousId: string; previousLabel: string; after: number | null }
  | { type: 'error'; message: string }

interface ConfirmChoose {
  variant: VariantView
  before: number | null
  after: number | null
  imported: boolean
}

export function QuoteVariantsBar({
  project,
  selectedId,
  onSelect,
}: {
  project: Project
  selectedId: string
  onSelect: (variantId: string) => void
}) {
  const { quoteDocs, addVariant, renameVariant, deleteVariant, restoreVariant, chooseVariant } = useProjectHub()
  // Porównanie i kwoty w pytaniu liczą się z dokumentów (także z niezapisanymi zmianami).
  useSyncExternalStore(quoteDocs.subscribe, quoteDocs.version, quoteDocs.version)

  const variants = useMemo(() => listVariants(project), [project])
  const multiple = hasAlternatives(project)
  const selected = variants.find((v) => v.id === selectedId) ?? variants.find((v) => v.chosen)!

  const [renaming, setRenaming] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirm, setConfirm] = useState<ConfirmChoose | null>(null)
  const [comparing, setComparing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  const startRename = (v: VariantView) => {
    setRenaming(v.id)
    setNameDraft(v.label)
  }

  const commitRename = async () => {
    const id = renaming
    setRenaming(null)
    if (id) await renameVariant(project.id, id, nameDraft)
  }

  const handleAdd = async (fromDocId: string | null) => {
    setBusy(true)
    try {
      const id = await addVariant(project.id, fromDocId)
      if (id) onSelect(id)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (v: VariantView) => {
    if (v.chosen) return
    const ok = await deleteVariant(project.id, v.id)
    if (!ok) return
    onSelect(variants.find((x) => x.chosen)!.id)
    setNotice({ type: 'deleted', id: v.id, label: v.label })
  }

  const doChoose = async (v: VariantView) => {
    setConfirm(null)
    const previous = variants.find((x) => x.chosen)!
    setBusy(true)
    try {
      const plan = await chooseVariant(project.id, v.id)
      if (plan.status === 'blocked') {
        setNotice({
          type: 'error',
          message: 'Najpierw odpowiedz na pytanie o finanse z importu (nad zakładkami) — dopiero potem zmień wybór.',
        })
        return
      }
      if (plan.status !== 'ready') return
      onSelect(v.id)
      setNotice({
        type: 'chosen',
        label: v.label,
        previousId: previous.id,
        previousLabel: previous.label,
        after: plan.after?.sumaNetto ?? null,
      })
    } finally {
      setBusy(false)
    }
  }

  const startChoose = (v: VariantView) => {
    const imported = !project.quote && !!project.financials
    // Wycena / nieprzyjęta: od razu, z „Cofnij". W realizacji, zrealizowany i finanse z importu — najpierw pytanie.
    if (!countsTowardRevenue(project.status) && !imported) {
      void doChoose(v)
      return
    }
    const after = computeSnapshotFinancials(docToSnapshot(quoteDocs.get(v.docId)))
    setConfirm({ variant: v, before: project.financials?.sumaNetto ?? null, after: after?.sumaNetto ?? null, imported })
  }

  const undo = async () => {
    if (!notice) return
    setNotice(null)
    if (notice.type === 'deleted') {
      await restoreVariant(project.id, notice.id)
      onSelect(notice.id)
    }
    if (notice.type === 'chosen') {
      await chooseVariant(project.id, notice.previousId)
      onSelect(notice.previousId)
    }
  }

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="flex h-8 items-center gap-1 rounded-full border border-dashed border-white/15 px-3 text-xs text-zinc-400 outline-none hover:border-white/30 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          Wariant
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-white/10 bg-zinc-900 text-zinc-200">
        <DropdownMenuItem onSelect={() => void handleAdd(selected.docId)}>
          <Copy className="size-3.5" />
          Kopia wariantu {selected.label}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleAdd(null)}>
          <FilePlus2 className="size-3.5" />
          Pusta wycena
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  // Projekt z jedną wyceną wygląda jak dotąd — tylko „+ Wariant".
  if (!multiple) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        {notice && <NoticeLine notice={notice} onClose={() => setNotice(null)} onUndo={() => void undo()} />}
        {addMenu}
      </div>
    )
  }

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Warianty wyceny">
        <span className="mr-1 text-[11px] uppercase tracking-wider text-zinc-500">Warianty</span>
        {variants.map((v) => {
          const active = v.id === selected.id
          if (renaming === v.id) {
            return (
              <input
                key={v.id}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                aria-label={`Nazwa wariantu ${v.label}`}
                className="h-8 w-28 rounded-full border border-white/30 bg-black/60 px-3 text-xs text-white outline-none"
              />
            )
          }
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(v.id)}
              onDoubleClick={() => startRename(v)}
              title={v.chosen ? 'Wybrany do rozliczeń · dwuklik zmienia nazwę' : 'Dwuklik zmienia nazwę'}
              className={`flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full border px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/50 ${
                active
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-100'
                  : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-100'
              }`}
            >
              {v.chosen && <Check className="size-3.5 shrink-0 text-emerald-400" aria-label="wybrany do rozliczeń" />}
              <span className="truncate">{v.label}</span>
            </button>
          )
        })}
        {addMenu}
        <button
          type="button"
          onClick={() => setComparing((c) => !c)}
          aria-expanded={comparing}
          className={`ml-auto flex h-8 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
            comparing ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          <Rows3 className="size-3.5" />
          Porównaj warianty
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500">
        {selected.chosen ? (
          <span className="text-emerald-300/80">Wariant {selected.label} jest wybrany do rozliczeń.</span>
        ) : (
          <>
            <span>Wariant {selected.label} — nie liczy się do finansów.</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="h-7 border-emerald-500/30 px-2 text-xs text-emerald-200 hover:bg-emerald-500/10"
              onClick={() => startChoose(selected)}
            >
              <Check className="size-3.5" />
              Wybierz do rozliczeń
            </Button>
          </>
        )}
        <button
          type="button"
          onClick={() => startRename(selected)}
          className="flex items-center gap-1 rounded px-1 outline-none hover:text-zinc-200 focus-visible:ring-1 focus-visible:ring-white/50"
        >
          <Pencil className="size-3" />
          Zmień nazwę
        </button>
        <button
          type="button"
          onClick={() => void handleDelete(selected)}
          disabled={selected.chosen}
          title={selected.chosen ? 'Najpierw wybierz inny wariant do rozliczeń' : `Usuń wariant ${selected.label}`}
          className="flex items-center gap-1 rounded px-1 outline-none hover:text-red-300 focus-visible:ring-1 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-zinc-500"
        >
          <Trash2 className="size-3" />
          Usuń wariant
        </button>
      </div>

      {confirm && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90"
          role="alert"
        >
          <span className="min-w-0 flex-1">
            {confirm.imported
              ? `Ten projekt ma finanse z importu (${formatPln(confirm.before ?? 0)}). Zastąpić je wariantem ${confirm.variant.label} (${formatPln(confirm.after ?? 0)})?`
              : `Rozliczać wariant ${confirm.variant.label}? Finanse projektu: ${formatPln(confirm.before ?? 0)} → ${formatPln(confirm.after ?? 0)}.`}
          </span>
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void doChoose(confirm.variant)}>
            Wybierz {confirm.variant.label}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirm(null)}>
            Anuluj
          </Button>
        </div>
      )}

      {notice && (
        <NoticeLine
          notice={notice}
          onClose={() => setNotice(null)}
          onUndo={() => void undo()}
        />
      )}

      {comparing && <VariantsCompare project={project} variants={variants} selectedId={selected.id} onSelect={onSelect} />}
    </div>
  )
}

function NoticeLine({ notice, onClose, onUndo }: { notice: Notice; onClose: () => void; onUndo: () => void }) {
  const text =
    notice.type === 'deleted'
      ? `Usunięto wariant ${notice.label}.`
      : notice.type === 'chosen'
        ? `Wariant ${notice.label} jest teraz wybrany do rozliczeń${notice.after != null ? ` (${formatPln(notice.after)} netto)` : ''}; ${notice.previousLabel} został wariantem.`
        : notice.message
  return (
    <p
      className={`flex flex-wrap items-center gap-2 text-xs ${notice.type === 'error' ? 'text-amber-200/90' : 'text-emerald-300/90'}`}
      role="status"
    >
      {text}
      {notice.type !== 'error' && (
        <button
          type="button"
          onClick={onUndo}
          className="font-semibold text-primary outline-none hover:underline focus-visible:underline"
        >
          Cofnij
        </button>
      )}
      <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded p-0.5 text-zinc-500 hover:text-zinc-200">
        <X className="size-3" />
      </button>
    </p>
  )
}

/** Tabela „Porównaj warianty" — kotwica: ile kosztuje każda wersja i co za to dostaje klient. */
function VariantsCompare({
  project,
  variants,
  selectedId,
  onSelect,
}: {
  project: Project
  variants: VariantView[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const { quoteDocs } = useProjectHub()
  const rows = variants.map((v) => ({
    v,
    f: variantFigures(docToSnapshot(quoteDocs.get(v.docId)), project.client),
  }))
  const anyPdf = rows.some((r) => r.f.pdfNetto != null)
  const anyGear = rows.some((r) => r.f.gear != null)
  const anyEur = rows.some((r) => r.f.currency !== 'PLN')
  const money = (amount: number, currency: Parameters<typeof formatMoney>[1]) => formatMoney(amount, currency, { decimals: 0 })

  const lines: { label: string; hint?: string; cell: (f: (typeof rows)[number]['f']) => string }[] = [
    { label: 'Netto (kalkulator)', cell: (f) => money(f.netto, f.currency) },
    ...(anyEur ? [{ label: '≈ w złotych', cell: (f: (typeof rows)[number]['f']) => money(f.nettoPln, 'PLN') }] : []),
    ...(anyPdf
      ? [
          {
            label: 'Netto w PDF',
            hint: 'Ceny poprawione ręcznie w podglądzie PDF',
            cell: (f: (typeof rows)[number]['f']) => (f.pdfNetto == null ? '= kalkulator' : money(f.pdfNetto, f.pdfCurrency ?? 'PLN')),
          },
        ]
      : []),
    { label: 'Dni zdjęciowe', cell: (f) => String(f.shootingDays) },
    { label: 'Ekipa (osobodni)', cell: (f) => String(f.crewDays) },
    ...(anyGear
      ? [{ label: 'Sprzęt w cenie', cell: (f: (typeof rows)[number]['f']) => (f.gear == null ? '—' : money(f.gear, f.currency)) }]
      : []),
    { label: 'Zysk (plan)', cell: (f) => money(f.zysk, 'PLN') },
    { label: 'Marża', cell: (f) => `${f.marzaPct.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} %` },
  ]

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-900/30">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="border-b border-white/5">
            <th className="px-3 py-2 text-left font-normal text-zinc-500">Wariant</th>
            {rows.map(({ v }) => (
              <th key={v.id} className="px-3 py-2 text-right font-semibold">
                <button
                  type="button"
                  onClick={() => onSelect(v.id)}
                  className={`inline-flex items-center gap-1 rounded px-1 outline-none hover:text-white focus-visible:ring-1 focus-visible:ring-white/50 ${
                    v.id === selectedId ? 'text-amber-100' : 'text-zinc-300'
                  }`}
                >
                  {v.chosen && <Check className="size-3 text-emerald-400" aria-label="wybrany do rozliczeń" />}
                  {v.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.label} className="border-b border-white/5 last:border-0">
              <td className="px-3 py-1.5 text-zinc-500" title={line.hint}>
                {line.label}
              </td>
              {rows.map(({ v, f }) => (
                <td key={v.id} className="px-3 py-1.5 text-right tabular-nums text-zinc-200">
                  {line.cell(f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-white/5 px-3 py-2 text-[11px] text-zinc-500">
        Liczone na bieżąco z każdego wariantu. Do finansów projektu liczy się tylko wariant z ✓.
      </p>
    </div>
  )
}
