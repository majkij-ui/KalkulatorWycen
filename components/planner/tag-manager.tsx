'use client'

/**
 * Tagi call sheetu (port `tag-manager-modal.tsx` z CallSheetWiz): dodawanie z
 * kolorem, zmiana nazwy, usuwanie. Kolory to sloty palety kalendarza (nie
 * neonowe hexy), więc tag wygląda na osi czasu jak projekt w kalendarzu.
 * Usunięcie jest miękkie — wpisy pokazują się jako „bez tagu" do „Cofnij".
 */

import { useState } from 'react'
import { Tag, X } from 'lucide-react'
import { projectTile } from '@/lib/calendar-palette'
import { TAG_COLOR_KEYS, type Category } from '@/lib/schedule-types'
import { personKey } from '@/lib/project-costs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FieldLabel, TagDot, inputClass, outlineButton } from './planner-bits'

interface TagManagerProps {
  categories: Category[]
  onAdd: (label: string, color: string) => void
  onRename: (id: string, label: string) => void
  onRecolor: (id: string, color: string) => void
  onDelete: (category: Category) => void
}

export function TagManager({ categories, onAdd, onRename, onRecolor, onDelete }: TagManagerProps) {
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<string>(TAG_COLOR_KEYS[0])
  const [recoloring, setRecoloring] = useState<string | null>(null)
  const duplicate = categories.some((c) => personKey(c.label) === personKey(label))
  const canAdd = label.trim().length > 0 && !duplicate

  const add = () => {
    if (!canAdd) return
    onAdd(label.trim(), color)
    setLabel('')
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={outlineButton}>
          <Tag className="size-3.5" />
          Tagi
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border-white/10 bg-zinc-950 p-3 text-white">
        <h4 className="text-sm font-semibold">Tagi (działy)</h4>
        <p className="mt-0.5 text-xs text-zinc-500">Kolor kafla na osi czasu i podpis na call sheecie.</p>

        <ul className="mt-3 space-y-1">
          {categories.length === 0 && <li className="text-xs text-zinc-500">Brak tagów.</li>}
          {categories.map((c) => (
            <li key={c.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRecoloring((prev) => (prev === c.id ? null : c.id))}
                  className="rounded p-1 hover:bg-white/5"
                  aria-label={`Zmień kolor tagu ${c.label}`}
                  aria-expanded={recoloring === c.id}
                >
                  <TagDot category={c} />
                </button>
                <input
                  value={c.label}
                  onChange={(e) => onRename(c.id, e.target.value)}
                  aria-label={`Nazwa tagu ${c.label}`}
                  className={`${inputClass} h-7 text-xs`}
                />
                <button
                  type="button"
                  onClick={() => onDelete(c)}
                  className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                  aria-label={`Usuń tag ${c.label}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              {recoloring === c.id && (
                <Swatches
                  value={c.color}
                  onPick={(key) => {
                    onRecolor(c.id, key)
                    setRecoloring(null)
                  }}
                />
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
          <div>
            <FieldLabel htmlFor="new-tag-label">Nowy tag</FieldLabel>
            <input
              id="new-tag-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
              placeholder="np. Dron, Garderoba"
              className={`${inputClass} h-7 text-xs`}
            />
            {duplicate && label.trim() && <p className="mt-1 text-[11px] text-amber-200/80">Taki tag już jest.</p>}
          </div>
          <Swatches value={color} onPick={setColor} />
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            Dodaj tag
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Swatches({ value, onPick }: { value: string; onPick: (key: string) => void }) {
  return (
    <div className="grid grid-cols-12 gap-1" role="radiogroup" aria-label="Kolor tagu">
      {TAG_COLOR_KEYS.map((key) => {
        const tile = projectTile(key)
        const selected = key === value
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={key}
            onClick={() => onPick(key)}
            className={`size-5 rounded-[4px] border-l-[3px] outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              selected ? 'ring-2 ring-white/80' : ''
            }`}
            style={{ background: tile.bg, borderColor: tile.edge }}
          />
        )
      })}
    </div>
  )
}
