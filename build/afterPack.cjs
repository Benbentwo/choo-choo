// Each build ships only the Claude binary for its own platform and CPU. The packages are installed
// before packaging (see scripts/install-claude-binaries.cjs), so drop the ones that don't match.
const { existsSync, rmSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const ARCH = { 1: 'x64', 3: 'arm64' }

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName
  if (platform !== 'darwin' && platform !== 'linux') return
  const arch = ARCH[context.arch]
  if (!arch) throw new Error(`Unsupported ${platform} arch ${context.arch}`)
  const resources =
    platform === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')
  const dir = join(resources, 'app.asar.unpacked', 'node_modules', '@anthropic-ai')
  const keep = `claude-agent-sdk-${platform}-${arch}`
  if (!existsSync(join(dir, keep, 'claude'))) {
    throw new Error(
      `${keep} is missing. Run "node scripts/install-claude-binaries.cjs ${platform === 'darwin' ? 'mac' : 'linux'}" before building.`
    )
  }
  for (const name of readdirSync(dir)) {
    if (name.startsWith('claude-agent-sdk-') && name !== keep) rmSync(join(dir, name), { recursive: true, force: true })
  }
}
