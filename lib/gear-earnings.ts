/**
 * Ile zarobił mój sprzęt w projekcie (U2, decyzje M.J. 2026-10-24, §18.3/1–2)
 * — czyste funkcje.
 *
 *   zarobił       = wiersz „Sprzęt" z PDF (wybrany wariant, w zł) − wynajem
 *                   z Realizacji (jedna liczba, `rentals.ts`)
 *                   albo kwota wpisana w projekcie (`gearEarnedOverride`, np.
 *                   wynajem w osobnym wierszu PDF)
 *   bez szkicu PDF = wiersz „Sprzęt", który wydrukowałby kalkulator
 *   EUR          = € × kurs zamrożony w wycenie (jak suma PDF, R2)
 *
 * Wynik może być UJEMNY (wynajem > wiersz Sprzęt): to nie błąd, tylko fakt —
 * dzieli się tak samo i obniża „Zarobił" i spłatę pozycji.
 *
 * Podział między pozycje katalogu na planie: stawka rentalowa za dzień × dni
 * (sztuko-dni). Pozycje z siatki sprzętu Realizacji, a gdy w siatce nic nie
 * ma — mój sprzęt z dni wyceny. Pozycje bez stawki są wymienione („bez
 * stawki") i nic nie dostają; zaplecze nie liczy się nigdy (katalog podaje
 * wywołujący: tylko sprzęt na plan). Gdy nie ma na kogo podzielić — kwota jest
 * „nieprzypisana".
 *
 * Dawne „zarobił" (gear-revenue) brało kwotę z kalkulatora × (przelew / suma
 * kalkulatora), wynajem z planu wyceny i dzieliło sprzęt z katalogu w wycenie
 * „dokładnie", niezależnie od tego, co pojechało na plan — stąd złe liczby.
 */

import { getProductionEkipaCastSprzetNetto } from './quote-calc'
import { pdfDraftTotalPln, quoteViews, resolveSnapshot, type FinancialsSource } from './quote-financials'
import { toPln } from './quote-currency'
import { safeArray, safeNum } from './safe-numbers'
import type { EquipmentItem, GearDay, ProjectCost } from './project-types'
import type { ShootingDay } from './quote-types'
import { rentalTotal } from './rentals'

export interface PdfGearRow {
  /** W zł. */
  pln: number
  /** W walucie dokumentu. */
  amount: number
  currency: 'PLN' | 'EUR'
  rate: number | null
  /** `pdf` = wiersz szkicu PDF, `calculator` = wycena bez szkicu (PDF idzie za kalkulatorem). */
  source: 'pdf' | 'calculator'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Wiersz „Sprzęt" wybranego wariantu w zł; `null` = projekt bez wyceny. */
export function pdfGearRow(snapshot: FinancialsSource | null | undefined): PdfGearRow | null {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return null
  const { data, pricing, margin } = resolved
  const views = quoteViews(data, pricing)
  const draft = snapshot?.pdfDraft
  if (isRecord(draft) && isRecord(draft.rows)) {
    // Ten sam przelicznik waluty co suma PDF (`pdfDraftTotalPln`), tylko dla jednego wiersza.
    const sprzet = draft.rows.sprzet
    const row = pdfDraftTotalPln({ ...draft, rows: isRecord(sprzet) ? { sprzet } : {} }, views.money)!
    return { ...row, source: 'pdf' }
  }
  const { sprzetNetto } = getProductionEkipaCastSprzetNetto(views.client.data, margin, views.client.pricing)
  const amount = safeNum(sprzetNetto, 0, 0)
  const foreign = views.money.currency === 'EUR'
  return {
    pln: toPln(amount, views.money),
    amount,
    currency: foreign ? 'EUR' : 'PLN',
    rate: foreign ? views.money.rate : null,
    source: 'calculator',
  }
}

export interface GearShare {
  itemId: string
  item: EquipmentItem
  /** Sztuko-dni na planie. */
  unitDays: number
  /** Stawka × sztuko-dni — waga podziału. */
  weight: number
  /** Udział w „zarobił" (może być ujemny). */
  earned: number
}

export interface GearEarnings {
  /** `null` = projekt bez wyceny: nie wiadomo, ile zapłacono za sprzęt. */
  pdfGear: PdfGearRow | null
  /** Wynajem z Realizacji (jedna liczba projektu). */
  rentals: number
  /** Wiersz Sprzęt − wynajem; `null` bez wyceny. Może być ujemny. */
  computed: number | null
  /** Kwota wpisana w projekcie; `null` = liczona. */
  override: number | null
  /** To, co się liczy: wpisana albo wyliczona. */
  earned: number | null
  /** O ile wynajem przekracza wiersz Sprzęt (0 = nie przekracza). */
  rentalsOver: number
  /** Skąd pozycje: siatka Realizacji, sprzęt z wyceny albo nic. */
  source: 'grid' | 'quote' | 'none'
  /** Udziały pozycji ze stawką, malejąco po wadze. */
  shares: GearShare[]
  /** Pozycje na planie bez stawki rentalowej — nic nie dostają. */
  noRate: EquipmentItem[]
  /** Ile rozdzielono między pozycje. */
  assigned: number
  /** Czeka na pozycje (nie ma komu przypisać). */
  unassigned: number
}

export interface GearEarningsInput {
  /** Wycena wybranego wariantu (zapisana albo na żywo, z `pdfDraft`). */
  quote: FinancialsSource | null | undefined
  /** Wiersze Realizacji (zapisane albo szkic z planu) — z nich wynajem. */
  costs: ProjectCost[]
  /** Dni realizacji (bez usuniętych). */
  gearDays: GearDay[]
  /** Katalog sprzętu NA PLAN (bez zaplecza). */
  catalog: Map<string, EquipmentItem>
  override?: number | null
}

type GearLineLike = { itemId: string; qty: number }

/** Mój sprzęt z dni szczegółowej wyceny (pozycje katalogu, także „gratis" — był na planie). */
function quoteGearLines(quote: FinancialsSource | null | undefined): GearLineLike[] {
  const resolved = resolveSnapshot(quote)
  if (!resolved || !resolved.data.isDetailedProdukcja) return []
  return safeArray<ShootingDay>(resolved.data.detailedShootingDays).flatMap((day) =>
    safeArray<{ itemId?: unknown; qty?: unknown }>(day.gear).flatMap((line) =>
      typeof line.itemId === 'string' && line.itemId ? [{ itemId: line.itemId, qty: safeNum(line.qty, 0, 0) }] : []
    )
  )
}

export function gearEarnings(input: GearEarningsInput): GearEarnings {
  const pdfGear = pdfGearRow(input.quote)
  const rentals = rentalTotal(input.costs)
  const computed = pdfGear ? pdfGear.pln - rentals : null
  const override = typeof input.override === 'number' && Number.isFinite(input.override) ? input.override : null
  const earned = pdfGear === null && override === null ? null : (override ?? computed)

  const gridLines = input.gearDays.flatMap((day) => day.lines).filter((line) => line.qty > 0)
  const quoteLines = gridLines.length > 0 ? [] : quoteGearLines(input.quote).filter((line) => line.qty > 0)
  const lines = gridLines.length > 0 ? gridLines : quoteLines
  const source: GearEarnings['source'] = gridLines.length > 0 ? 'grid' : quoteLines.length > 0 ? 'quote' : 'none'

  const byItem = new Map<string, GearShare>()
  const noRate = new Map<string, EquipmentItem>()
  lines.forEach((line) => {
    const item = input.catalog.get(line.itemId)
    if (!item || item.onSet === false) return
    if (!(item.rentalDayRate > 0)) {
      noRate.set(item.id, item)
      return
    }
    const share = byItem.get(item.id) ?? { itemId: item.id, item, unitDays: 0, weight: 0, earned: 0 }
    share.unitDays += line.qty
    share.weight += line.qty * item.rentalDayRate
    byItem.set(item.id, share)
  })
  const shares = [...byItem.values()].sort((a, b) => b.weight - a.weight || a.item.name.localeCompare(b.item.name, 'pl'))
  const totalWeight = shares.reduce((sum, s) => sum + s.weight, 0)
  const assigned = earned !== null && totalWeight > 0 ? earned : 0
  if (assigned !== 0) shares.forEach((share) => (share.earned = (assigned * share.weight) / totalWeight))

  return {
    pdfGear,
    rentals,
    computed,
    override,
    earned,
    rentalsOver: pdfGear ? Math.max(0, rentals - pdfGear.pln) : 0,
    source,
    shares,
    noRate: [...noRate.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    assigned,
    unassigned: earned === null ? 0 : earned - assigned,
  }
}
