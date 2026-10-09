'use client'

/**
 * Zestawy sprzętu (G6) w sekcji „Sprzęt": co jest w zestawie, ile jest wart
 * za dzień (stawki z katalogu teraz), zmiana nazwy i usunięcie. Zestawy
 * powstają z dnia — w wycenie („Zapisz jako zestaw") albo w Realizacji.
 */

import { useState } from 'react'
import { Layers, Trash2 } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import type { GearKit } from '@/lib/project-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

export function GearKitsPanel() {
  const { kits } = useEquipment()
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Zestawy</h2>
      <p className="mb-3 text-xs text-zinc-600">
        {kits.length === 0
          ? 'Zestaw zapisujesz z dnia: w wycenie („Zapisz jako zestaw") albo w Realizacji (menu dnia). Potem dodajesz go do dnia jednym klikiem.'
          : 'Dodajesz je do dnia jednym klikiem w wycenie i w Realizacji. Ceny zawsze z katalogu.'}
      </p>
      <div className="flex flex-col gap-2">
        {kits.map((kit) => (
          <KitRow key={kit.id} kit={kit} />
        ))}
      </div>
    </section>
  )
}

function KitRow({ kit }: { kit: GearKit }) {
  const { items, updateKit, removeKit } = useEquipment()
  const [name, setName] = useState(kit.name)
  const [confirm, setConfirm] = useState(false)
  const byId = new Map(items.map((item) => [item.id, item]))
  const parts = kit.lines.map((line) => {
    const item = byId.get(line.itemId)
    return {
      key: line.itemId,
      label: `${line.qty > 1 ? `${line.qty}× ` : ''}${item?.name ?? 'usunięty z katalogu'}`,
      value: item ? item.rentalDayRate * line.qty : 0,
      missing: !item || !!item.retiredAt,
    }
  })
  const value = parts.reduce((sum, part) => sum + part.value, 0)

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
      <Layers className="mt-2 size-4 shrink-0 text-zinc-600" />
      <div className="min-w-[200px] flex-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim()
            if (next && next !== kit.name) void updateKit({ ...kit, name: next })
            else setName(kit.name)
          }}
          aria-label="Nazwa zestawu"
          className="h-8 border-transparent bg-transparent px-1 font-semibold text-zinc-100 hover:border-white/10 focus:border-white/10"
        />
        <div className="mt-1 px-1 text-xs text-zinc-500">
          {parts.map((part, i) => (
            <span key={part.key} className={part.missing ? 'text-zinc-600 line-through' : undefined}>
              {part.label}
              {i < parts.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="text-right text-xs tabular-nums text-zinc-400">
        <div className="text-sm font-semibold text-zinc-200">{pln(value)}</div>
        <div>za dzień</div>
      </div>
      {confirm ? (
        <div className="flex gap-1">
          <Button variant="destructive" size="sm" onClick={() => void removeKit(kit.id)} className="h-8 text-xs">
            Usuń
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(false)} className="h-8 text-xs">
            Anuluj
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          aria-label={`Usuń zestaw ${kit.name}`}
          className="mt-1.5 text-zinc-600 hover:text-red-400"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  )
}
