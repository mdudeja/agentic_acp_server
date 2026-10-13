import pkg from '../package.json' with { type: 'json' }

/** Server version; `package.json` is the single source of truth. */
export const VERSION: string = pkg.version
