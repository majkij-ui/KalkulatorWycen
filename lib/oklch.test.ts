import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrastRatio, fitColor, inSrgbGamut, maxChroma, type Oklch } from './oklch'
import { EVENT_GROUPS, NEUTRAL_TILE, PROJECT_COLOR_KEYS, groupChip, projectTile } from './calendar-palette'

/** `oklch(0.3 0.065 25)` → [0.3, 0.065, 25] */
function parse(css: string): Oklch {
  const match = css.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  assert.ok(match, `nie OKLCH: ${css}`)
  return [Number(match![1]), Number(match![2]), Number(match![3])]
}

test('biel i czerń dają kontrast 21:1', () => {
  assert.ok(Math.abs(contrastRatio([1, 0, 0], [0, 0, 0]) - 21) < 0.01)
})

test('fitColor zawsze zostaje w gamucie sRGB', () => {
  for (let h = 0; h < 360; h += 15) {
    for (const l of [0.3, 0.47, 0.8]) assert.ok(inSrgbGamut(fitColor(l, 0.4, h)), `h=${h} l=${l}`)
  }
})

test('turkus przy ciemnej jasności mieści mniej nasycenia niż fiolet', () => {
  assert.ok(maxChroma(0.3, 185) < maxChroma(0.3, 290))
})

// ── Strażnik palety kalendarza: każda zmiana kolorów musi przejść te testy ──

const tiles = [...PROJECT_COLOR_KEYS.map((key) => [key, projectTile(key)] as const), ['neutral', NEUTRAL_TILE] as const]
const chips = EVENT_GROUPS.map((group) => [group, groupChip(group)] as const)

test('paleta: wszystkie kolory mieszczą się w sRGB (przeglądarka nic nie obcina)', () => {
  tiles.forEach(([key, tile]) => [tile.bg, tile.edge, tile.text].forEach((c) => assert.ok(inSrgbGamut(parse(c)), `${key}: ${c}`)))
  chips.forEach(([group, chip]) => [chip.bg, chip.text].forEach((c) => assert.ok(inSrgbGamut(parse(c)), `${group}: ${c}`)))
})

test('paleta: tekst na kaflu i na chipie spełnia WCAG AA z zapasem', () => {
  tiles.forEach(([key, tile]) => {
    const ratio = contrastRatio(parse(tile.bg), parse(tile.text))
    assert.ok(ratio >= 7, `${key}: tekst kafla ${ratio.toFixed(1)}:1`)
  })
  chips.forEach(([group, chip]) => {
    const ratio = contrastRatio(parse(chip.bg), parse(chip.text))
    assert.ok(ratio >= 7, `${group}: tekst chipu ${ratio.toFixed(1)}:1`)
  })
})

test('paleta: chip typu odcina się od każdego kafla projektu (forma, nie tylko odcień)', () => {
  tiles.forEach(([key, tile]) =>
    chips.forEach(([group, chip]) => {
      const ratio = contrastRatio(parse(chip.bg), parse(tile.bg))
      assert.ok(ratio >= 4.5, `${group} na ${key}: ${ratio.toFixed(1)}:1`)
    })
  )
})
