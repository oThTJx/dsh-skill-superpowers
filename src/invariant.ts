/**
 * Package-owned invariant companion for `@firefly0621/dsh-skill-superpowers`.
 * @module @firefly0621/dsh-skill-superpowers/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@firefly0621/dsh-skill-superpowers'

/** Cordis companion plugin name. */
export const name = 'skill-superpowers-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: skills are immutable packaged files and bootstrap is a
 * one-shot inject with no package-owned event stream for an independent companion.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
