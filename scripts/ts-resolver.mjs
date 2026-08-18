/**
 * Hook resolvera dla wbudowanego test runnera Node.
 *
 * Kod aplikacji importuje bez rozszerzeń (`./project-types`), bo tak wymaga
 * `moduleResolution: bundler` w Next.js. Node ESM tego nie rozwiąże, więc
 * dokładamy rozszerzenie w locie — dzięki temu testy działają na tych samych
 * plikach co aplikacja, bez kroku budowania i bez dodatkowych zależności.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']

export function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  const hasExtension = /\.[a-z]+$/i.test(specifier)

  if (isRelative && !hasExtension && context.parentURL) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of EXTENSIONS) {
      const candidate = new URL(base.href + ext)
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context)
      }
    }
  }

  return nextResolve(specifier, context)
}
