import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'path'

/** Resolves the given path to its canonical or absolute form by processing and normalizing it. */
export const resolvePath = (inputPath: string): string => {
  let resolvedPath = inputPath
  if (inputPath.startsWith('~/')) {
    resolvedPath = inputPath.replace('~', homedir())
  }

  if (isAbsolute(resolvedPath)) {
    return resolvedPath
  }

  const baseDir = resolve(import.meta.dir, '../../')
  resolvedPath = resolve(baseDir, resolvedPath)
  return resolvedPath
}
