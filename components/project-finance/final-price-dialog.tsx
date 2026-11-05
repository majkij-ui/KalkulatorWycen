'use client'

/**
 * Ostrzeżenie przed zmianą ceny końcowej (decyzja M.J. 2026-11-05): nazywa
 * źródło, kwotę i numery faktur. Dopiero „Zmień cenę" zapisuje nową cenę
 * (jako ręczne nadpisanie); „Anuluj" niczego nie zmienia.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { overrideWarning, type FinalPrice } from '@/lib/final-price'

export function FinalPriceDialog({
  final,
  newPln,
  onConfirm,
  onCancel,
}: {
  final: FinalPrice
  /** `null` = okno zamknięte. */
  newPln: number | null
  onConfirm: (pln: number) => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={newPln !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Zmienić cenę końcową?</AlertDialogTitle>
          <AlertDialogDescription>{newPln === null ? '' : overrideWarning(final, newPln)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction onClick={() => newPln !== null && onConfirm(newPln)}>Zmień cenę</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
