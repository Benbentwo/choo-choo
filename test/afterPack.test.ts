import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const afterPack = (require('../build/afterPack.cjs') as { default: (ctx: unknown) => Promise<void> }).default

const PKGS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']
let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

/** A packaged app folder with every Claude binary package, laid out the way electron-builder does it. */
function app(platform: 'darwin' | 'linux') {
  const out = mkdtempSync(join(tmpdir(), 'afterpack-'))
  dirs.push(out)
  const resources = platform === 'darwin' ? join(out, 'Choo Choo.app', 'Contents', 'Resources') : join(out, 'resources')
  const sdk = join(resources, 'app.asar.unpacked', 'node_modules', '@anthropic-ai')
  for (const p of PKGS) {
    mkdirSync(join(sdk, `claude-agent-sdk-${p}`), { recursive: true })
    writeFileSync(join(sdk, `claude-agent-sdk-${p}`, 'claude'), '')
  }
  mkdirSync(join(sdk, 'claude-agent-sdk'))
  const ctx = (arch: number) => ({ electronPlatformName: platform, arch, appOutDir: out, packager: { appInfo: { productFilename: 'Choo Choo' } } })
  return { sdk, ctx }
}

describe('afterPack', () => {
  it('keeps only the Linux x64 Claude binary in a Linux build', async () => {
    const { sdk, ctx } = app('linux')
    await afterPack(ctx(1))
    expect(readdirSync(sdk).sort()).toEqual(['claude-agent-sdk', 'claude-agent-sdk-linux-x64'])
  })

  it('keeps only the matching mac binary in a mac build', async () => {
    const { sdk, ctx } = app('darwin')
    await afterPack(ctx(3))
    expect(readdirSync(sdk).sort()).toEqual(['claude-agent-sdk', 'claude-agent-sdk-darwin-arm64'])
  })

  it('fails when the binary for the target was not installed', async () => {
    const { sdk, ctx } = app('linux')
    rmSync(join(sdk, 'claude-agent-sdk-linux-x64'), { recursive: true })
    await expect(afterPack(ctx(1))).rejects.toThrow(/install-claude-binaries\.cjs linux/)
  })
})
