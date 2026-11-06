// In dev, macOS reads the Dock and menu bar name from node_modules/electron's own Electron.app,
// so it says "Electron". Rename that bundle to the product name. Packaged builds already get
// productName from electron-builder, so this only matters for `npm run dev`.
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

if (process.platform !== 'darwin') process.exit(0)

const root = join(__dirname, '..')
const name = require(join(root, 'package.json')).productName
const appDir = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = join(appDir, 'Contents', 'Info.plist')
if (!existsSync(plist)) process.exit(0)

const read = (key) => {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
if (read('CFBundleName') === name && read('CFBundleDisplayName') === name) process.exit(0)

for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  execFileSync('plutil', ['-replace', key, '-string', name, plist])
}
// Editing Info.plist breaks the bundle's signature, which Apple Silicon refuses to run. Re-sign ad hoc.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'ignore' })
// Make Launch Services drop the cached "Electron" name.
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
try {
  execFileSync(lsregister, ['-f', appDir])
} catch {
  // Not fatal: the new name shows after the next login if the cache is stale.
}
console.log(`Renamed dev Electron.app to "${name}"`)
