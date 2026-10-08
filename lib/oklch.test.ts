import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrastRatio, fitColor, inSrgbGamut, maxChroma } from './oklch'
import {
  EVENT_GROUPS,
  PAGE_BACKGROUND,
  PROJECT_COLOR_KEYS,
  clipColorValues,
  projectInkValue,
} from './calendar-palette'

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

test('wariant B: tekst na każdym klipie spełnia WCAG AA (4.5:1)', () => {
  for (const key of [...PROJECT_COLOR_KEYS, null]) {
    const { fill, text } = clipColorValues(key)
    const ratio = contrastRatio(fill, text)
    assert.ok(ratio >= 4.5, `${key}: ${ratio.toFixed(2)}`)
  }
})

test('warianty C i D: nazwa projektu na tle strony ma co najmniej 7:1', () => {
  for (const key of [...PROJECT_COLOR_KEYS, null]) {
    const ratio = contrastRatio(projectInkValue(key), PAGE_BACKGROUND)
    assert.ok(ratio >= 7, `${key}: ${ratio.toFixed(2)}`)
  }
})

test('grupy wydarzeń są nadal kompletne', () => {
  assert.equal(EVENT_GROUPS.length, 6)
})
