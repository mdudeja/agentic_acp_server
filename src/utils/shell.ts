import { spawn, type Subprocess } from 'bun'
import { existsSync } from 'node:fs'

export function shellEscape(arg: string): string {
  // Replace ' with '\'' to safely escape single quotes in shell arguments
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export function spawnShellCommand({
  command,
  args,
  cwd,
  env,
}: {
  command: string
  args: string[]
  cwd?: string
  env?: Bun.Env
}): Subprocess {
  const { shell, useLoginFlag } = _resolveUnixShell()
  const shellArgs = useLoginFlag
    ? ['-l', '-c', `${command} ${args.map(shellEscape).join(' ')}`]
    : ['-c', `${command} ${args.map(shellEscape).join(' ')}`]

  const subprocess = spawn({
    cmd: [shell, ...shellArgs],
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return subprocess
}

function _resolveUnixShell(): { shell: string; useLoginFlag: boolean } {
  const userShell = process.env.SHELL

  if (!userShell) {
    //$SHELL is not set, probe for common shells
    if (existsSync('/bin/bash')) {
      return { shell: '/bin/bash', useLoginFlag: true }
    }

    if (existsSync('/usr/bin/bash')) {
      return { shell: '/usr/bin/bash', useLoginFlag: true }
    }

    return { shell: '/bin/sh', useLoginFlag: false }
  }

  const base = userShell.split('/').pop() || 'sh'

  if (['zsh', 'bash', 'ksh'].includes(base)) {
    return { shell: userShell, useLoginFlag: true }
  }

  if (['fish', 'sh', 'dash'].includes(base)) {
    return { shell: userShell, useLoginFlag: false }
  }

  return { shell: userShell, useLoginFlag: false }
}
