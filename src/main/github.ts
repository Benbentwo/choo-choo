import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PrInfo } from '@shared/types'

const exec = promisify(execFile)

export async function prForBranch(cwd: string, branch: string): Promise<PrInfo | null> {
  try {
    const { stdout } = await exec('gh', ['pr', 'view', branch, '--json', 'number,url,state,isDraft,title,mergeable'], { cwd })
    return JSON.parse(stdout) as PrInfo
  } catch {
    return null
  }
}

export async function mergePr(cwd: string, number: number) {
  await exec('gh', ['pr', 'merge', String(number), '--squash', '--delete-branch=false'], { cwd })
}
