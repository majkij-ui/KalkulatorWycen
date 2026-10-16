'use client'

/**
 * Zakładka „Zaplecze i drobiazgi" na ekranie Sprzęt: laptop, magic arm, karty
 * SD, kable — rzeczy, które kosztują, ale nigdy nie jadą na plan. Nie mają
 * stawki rentalowej ani statystyk spłaty; liczy się cena, data i ile sztuk.
 *
 * Szybkie wpisywanie: jeden wiersz (nazwa, cena, data, sztuk, notatka); Enter
 * zapisuje i zostaje w wierszu na kolejną pozycję (data zostaje, bo zakupy
 * zwykle przychodzą hurtem). Wiele pozycji naraz: „Wklej listę" (średnik albo
 * tabulator — tak wklejają się komórki z arkusza).
 */

import { useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Plus } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { backstageItems, parseBackstageRows, parseDateText, parseMoney } from '@/lib/gear-backstage'
import { unitsOwned, type EquipmentItem } from '@/lib/project-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : '—'
}

const BACKSTAGE_CATEGORY = 'inne'
const inputClass = 'h-9 border-white/10 bg-black/40 text-sm'

export function BackstagePanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { allItems, addItem } = useEquipment()
  const rows = useMemo(
    () =>
      backstageItems(allItems).sort((a, b) => {
        // Bez daty na górze (do uzupełnienia), potem od najnowszego zakupu.
        if (!a.purchaseDate !== !b.purchaseDate) return a.purchaseDate ? 1 : -1
        return b.purchaseDate.localeCompare(a.purchaseDate) || a.name.localeCompare(b.name, 'pl')
      }),
    [allItems]
  )

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => parseBackstageRows(pasteText), [pasteText])

  const addOne = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const qty = Math.floor(parseMoney(quantity))
      await addItem({
        name: trimmed,
        category: BACKSTAGE_CATEGORY,
        purchasePrice: parseMoney(price),
        purchaseDate: parseDateText(date),
        quantity: qty >= 1 ? qty : 1,
        notes: notes.trim(),
        onSet: false,
      })
      setJustAdded(trimmed)
      setName('')
      setPrice('')
      setQuantity('')
      setNotes('')
      nameRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const addMany = async () => {
    if (parsed.rows.length === 0 || busy) return
    setBusy(true)
    try {
      // Po kolei: każdy zapis czyta świeży plik, więc nic się nie nadpisuje.
      for (const row of parsed.rows) {
        await addItem({ ...row, category: BACKSTAGE_CATEGORY, onSet: false })
      }
      setJustAdded(`${parsed.rows.length} pozycji z listy`)
      setPasteText('')
      setPasteOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const total = rows.reduce((sum, item) => sum + item.purchasePrice * unitsOwned(item), 0)
  const undated = rows.filter((item) => !item.purchaseDate).length
  const unpriced = rows.filter((item) => item.purchasePrice <= 0).length

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-sm text-zinc-500">
        Rzeczy, które kosztują, ale nigdy nie jadą na plan: laptop, magic arm, karty SD, kable. Liczą się jako
        koszt (cena × sztuki), ale nie pojawiają się w wycenie, w Realizacji ani na listach pakowania i nie mają
        statystyk spłaty.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void addOne()
        }}
        className="rounded-xl border border-white/5 bg-zinc-900/40 p-3"
        aria-label="Szybkie dodawanie zaplecza"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_9.5rem_4.5rem]">
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nazwa, np. Magic arm"
            aria-label="Nazwa"
            className={`${inputClass} col-span-2 sm:col-span-1`}
          />
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Cena zł"
            aria-label="Cena zakupu za sztukę"
            className={`${inputClass} tabular-nums`}
          />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Data zakupu"
            className={`${inputClass} [color-scheme:dark]`}
          />
          <Input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="numeric"
            placeholder="Szt."
            aria-label="Liczba sztuk"
            className={`${inputClass} tabular-nums`}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notatka (opcjonalnie)"
            aria-label="Notatka"
            className={`${inputClass} min-w-[180px] flex-1`}
          />
          <Button type="submit" disabled={!name.trim() || busy} className="h-9 gap-2">
            <Plus className="size-4" />
            Dodaj
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPasteOpen((v) => !v)}
            aria-expanded={pasteOpen}
            className="h-9 gap-2 border-white/10"
          >
            <ClipboardPaste className="size-4" />
            Wklej listę
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-zinc-600" aria-live="polite">
          {justAdded ? (
            <span className="text-emerald-400/80">Dodano: {justAdded}. </span>
          ) : null}
          Enter dodaje i zostaje w wierszu; data zostaje na kolejną pozycję.
        </p>
      </form>

      {pasteOpen && (
        <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
          <label className="text-[11px] text-zinc-500" htmlFor="backstage-paste">
            Jedna pozycja w linii: nazwa ; cena ; data ; sztuk ; notatka (średnik albo tabulator, reszta pól może
            być pusta)
          </label>
          <Textarea
            id="backstage-paste"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder={'Laptop MacBook Pro ; 9 500 ; 12.03.2025\nKarta SD 128 GB ; 89 ; 2025-05-02 ; 6\nMagic arm ; 140'}
            className="mt-1 border-white/10 bg-black/40 font-mono text-xs"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={addMany} disabled={parsed.rows.length === 0 || busy} className="h-9">
              {parsed.rows.length > 0 ? `Dodaj ${parsed.rows.length} z listy` : 'Dodaj z listy'}
            </Button>
            <Button variant="ghost" onClick={() => setPasteOpen(false)} className="h-9 text-zinc-400">
              Zamknij
            </Button>
            {parsed.badDates.length > 0 && (
              <span className="text-xs text-amber-300/80">
                Nie rozpoznano daty w linii: {parsed.badDates.join(', ')} (pozycja wejdzie bez daty)
              </span>
            )}
          </div>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-zinc-600">
          Jeszcze nic w zapleczu. Wpisz pierwszą pozycję powyżej.
        </p>
      ) : (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
              {rows.length} {rows.length === 1 ? 'pozycja' : 'pozycji'} · {pln(total)}
            </h2>
            {(undated > 0 || unpriced > 0) && (
              <div className="text-xs text-amber-300/80">
                {undated > 0 && <span>{undated} bez daty</span>}
                {undated > 0 && unpriced > 0 && <span> · </span>}
                {unpriced > 0 && <span>{unpriced} bez ceny</span>}
              </div>
            )}
          </div>
          <ul className="flex flex-col gap-1.5">
            {rows.map((item) => (
              <BackstageRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function BackstageRow({ item, onOpen }: { item: EquipmentItem; onOpen: () => void }) {
  const units = unitsOwned(item)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-2.5 text-left transition-colors hover:border-white/15 ${
          item.retiredAt ? 'border-white/5 bg-zinc-900/20 opacity-60' : 'border-white/5 bg-zinc-900/40'
        }`}
      >
        <div className="min-w-[160px] flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">
            {item.name}
            {units > 1 && <span className="ml-1.5 text-xs font-normal text-zinc-500">×{units}</span>}
            {item.retiredAt && (
              <span className="ml-2 rounded bg-zinc-800 px-1.5 py-px text-[10px] font-normal text-zinc-400">
                wycofany
              </span>
            )}
          </div>
          {item.notes && <div className="truncate text-xs text-zinc-500">{item.notes}</div>}
        </div>
        <div className="w-24 shrink-0 text-xs tabular-nums text-zinc-500">
          {item.purchaseDate ? formatDate(item.purchaseDate) : <span className="text-amber-300/70">bez daty</span>}
        </div>
        <div className="w-28 shrink-0 text-right text-sm tabular-nums">
          {item.purchasePrice > 0 ? (
            <>
              <span className="font-semibold text-zinc-100">{pln(item.purchasePrice * units)}</span>
              {units > 1 && (
                <span className="block text-[11px] text-zinc-600">
                  {units} × {pln(item.purchasePrice)}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-amber-300/70">bez ceny</span>
          )}
        </div>
      </button>
    </li>
  )
}
