// Each mac build ships only the Claude binary for its own CPU. Both arch packages are installed
// before packaging (see scripts/install-mac-binaries.cjs), so drop the one that doesn't match.
const { existsSync, rmSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const ARCH = { 1: 'x64', 3: 'arm64' }

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const arch = ARCH[context.arch]
  if (!arch) throw new Error(`Unsupported mac arch ${context.arch}`)
  const app = `${context.packager.appInfo.productFilename}.app`
  const dir = join(context.appOutDir, app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai')
  const keep = `claude-agent-sdk-darwin-${arch}`
  if (!existsSync(join(dir, keep, 'claude'))) {
    throw new Error(`${keep} is missing. Run "node scripts/install-mac-binaries.cjs" before building.`)
  }
  for (const name of readdirSync(dir)) {
    if (name.startsWith('claude-agent-sdk-') && name !== keep) rmSync(join(dir, name), { recursive: true, force: true })
  }
}
