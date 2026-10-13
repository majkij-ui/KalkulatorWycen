'use client'

/**
 * Jak pokazać i przyjąć cenę z cennika (PLN) w walucie wyceny (S3).
 *
 * `InlinePrice` w zakładkach kalkulatora edytuje cennik, który zawsze jest w
 * zł. W wycenie w EUR pokazuje cenę w pełnych euro, a wpisane euro zapisuje
 * jako € × kurs (`quote-currency.ts`). Domyślnie (poza `QuoteProvider`) — zł
 * bez przeliczania, czyli dokładnie jak dotąd.
 */

import React, { createContext, useContext, useMemo } from 'react'
import { PLN_MONEY, currencyUnit, priceFromPln, priceToPln, type QuoteMoney } from './quote-currency'

export interface PriceDisplay {
  money: QuoteMoney
  /** Jednostka po polsku: „zł" albo „€". */
  unit: string
  toDisplay: (pln: number) => number
  fromDisplay: (value: number) => number
}

function priceDisplayFor(money: QuoteMoney): PriceDisplay {
  return {
    money,
    unit: currencyUnit(money.currency),
    toDisplay: (pln) => priceFromPln(pln, money),
    fromDisplay: (value) => priceToPln(value, money),
  }
}

const PriceDisplayContext = createContext<PriceDisplay>(priceDisplayFor(PLN_MONEY))

export function PriceDisplayProvider({ money, children }: { money: QuoteMoney; children: React.ReactNode }) {
  const value = useMemo(() => priceDisplayFor(money), [money])
  return <PriceDisplayContext.Provider value={value}>{children}</PriceDisplayContext.Provider>
}

export function usePriceDisplay(): PriceDisplay {
  return useContext(PriceDisplayContext)
}
