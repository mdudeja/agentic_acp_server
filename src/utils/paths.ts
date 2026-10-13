import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'path'

/** Resolves the given path to its canonical or absolute form by processing and normalizing it. */
export const resolvePath = (inputPath: string, rootDir?: string): string => {
  let resolvedPath = inputPath

  if (resolvedPath.endsWith('/')) {
    resolvedPath = resolvedPath.slice(0, -1)
  }

  if (inputPath.startsWith('~/')) {
    resolvedPath = inputPath.replace('~', homedir())
  }

  if (isAbsolute(resolvedPath)) {
    return resolvedPath
  }

  const baseDir = rootDir ?? resolve(import.meta.dir, '../../')
  resolvedPath = resolve(baseDir, resolvedPath)

  return resolvedPath
}
