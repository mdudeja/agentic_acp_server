import { MISC_ACTION_NAMES, type MiscActionEvents } from 'src/data/events'
import { BaseManager } from './BaseManager'
import type { AgenticServer } from 'src/AgenticServer'
import { existsSync } from 'node:fs'

export class MiscActionsManager extends BaseManager<MiscActionEvents> {
  private queuedActions: (typeof MISC_ACTION_NAMES)[number][] = []

  constructor(
    private cwd: string,
    private server_instance: AgenticServer,
  ) {
    super()

    if (!cwd || cwd.trim() === '') {
      this.emit(
        'action.error',
        'Workspace root not found. Cannot create MiscActionsManager',
      )
    }
  }

  public async init() {
    const config = this.server_instance.getState().config

    if (!config) {
      this.emit(
        'action.error',
        'App config not found. Cannot create MiscActionsManager',
      )
      return
    }

    for (const action of MISC_ACTION_NAMES) {
      if (config[action]) {
        this.emit('action.queued', { data: `Queued ${action} action` })
        this.queuedActions.push(action)
      }
    }

    await this.processQueuedActions()
  }

  private async processQueuedActions() {
    for (const action of this.queuedActions) {
      this.emit('action.started', { data: `Started ${action} action` })

      switch (action) {
        case 'addToGitignore':
          await this.addToFile('.gitignore')
          break
        case 'addToNpmignore':
          await this.addToFile('.npmignore')
          break
        case 'addToDockerignore':
          await this.addToFile('.dockerignore')
          break
      }

      this.emit('action.completed', { data: `Completed ${action} action` })
    }
  }

  private async addToFile(fileName: string) {
    const filePath = `${this.cwd}/${fileName}`
    let fileContent: string = ''

    try {
      fileContent = await Bun.file(filePath).text()
    } catch (err) {
      // no-op, file may not exist yet
    } finally {
      if (!fileContent.includes('.agentic/')) {
        await Bun.write(
          filePath,
          `${fileContent}\n# All agentic stuff\n.agentic/`.trim() + '\n',
        )
      }
    }
  }
}
