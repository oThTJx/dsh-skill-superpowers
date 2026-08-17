/**
 * Fail pack/publish when required payload is missing or `lib/` is older than `src/`.
 * Pack from a built workspace:
 *   pnpm run build:lib:host
 *   pnpm --filter @firefly0621/dsh-skill-superpowers pack
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'lib/index.js',
  'lib/invariant.js',
  'cordis.patch.yml',
  'assets/NOTICE.md',
  'skills/using-superpowers/SKILL.md',
  'skills/using-superpowers/references/dsh-tools.md',
]

const missing = required.filter((rel) => !existsSync(join(root, rel)))
if (missing.length > 0) {
  console.error(
    '@firefly0621/dsh-skill-superpowers prepack: missing required files:\n'
      + missing.map((rel) => `  - ${rel}`).join('\n')
      + '\nRun: pnpm run build:lib:host'
      + '\nThen: pnpm --filter @firefly0621/dsh-skill-superpowers pack',
  )
  process.exit(1)
}

const libIndex = join(root, 'lib/index.js')
const srcIndex = join(root, 'src/index.ts')
const libMtime = statSync(libIndex).mtimeMs
const srcMtime = statSync(srcIndex).mtimeMs
if (srcMtime > libMtime) {
  console.error(
    '@firefly0621/dsh-skill-superpowers prepack: src/index.ts is newer than lib/index.js.\n'
      + 'Run `pnpm run build:lib:host` before pack/publish so the tarball is not stale.',
  )
  process.exit(1)
}
