import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import type { NotifyParams } from 'src/comms/ICommsInterface'
import { BaseCommsInterface } from 'src/comms/BaseCommsInterface'

class TestCommsInterface extends BaseCommsInterface {
  constructor(stateManager: any, logFilePath: string) {
    super(stateManager, logFilePath, 16, 2)
  }

  writeMessage(message: string): Promise<void> {
    return this.logMessage(message)
  }

  override notify(_params: NotifyParams): void {}
}

describe('BaseCommsInterface', () => {
  let directory: string
  let fakeStateManager: any

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'base-comms-'))
    fakeStateManager = {
      getState: mock(() => ({
        config: {
          debugLogs: true,
        },
      })),
    }
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('rotates the log at its size limit and retains only configured backups', async () => {
    const logFilePath = join(directory, 'logs', 'acp_log.txt')
    const comms = new TestCommsInterface(fakeStateManager, logFilePath)

    await comms.writeMessage('first!!!')
    await comms.writeMessage('second!!')
    await comms.writeMessage('third!!!')
    await comms.writeMessage('fourth!!')

    expect(await Bun.file(logFilePath).text()).toBe('fourth!!\n')
    expect(await Bun.file(`${logFilePath}.1`).text()).toBe('third!!!\n')
    expect(await Bun.file(`${logFilePath}.2`).text()).toBe('second!!\n')
    expect(await Bun.file(`${logFilePath}.3`).exists()).toBe(false)
  })
})
