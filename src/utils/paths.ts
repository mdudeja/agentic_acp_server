import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'path'

export const resolvePath = (
  inputPath: string,
  relativeToProject: boolean = false,
): string => {
  let resolvedPath = inputPath
  if (inputPath.startsWith('~/')) {
    resolvedPath = inputPath.replace('~', homedir())
  }

  if (isAbsolute(resolvedPath)) {
    return resolvedPath
  }

  const baseDir = relativeToProject
    ? resolve(import.meta.dir, '../../../')
    : resolve(import.meta.dir, '../../')
  resolvedPath = resolve(baseDir, resolvedPath)
  return resolvedPath
}
