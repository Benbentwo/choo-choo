// In dev, macOS reads the Dock name, menu bar name and app icon (Notifications settings, Finder,
// Launch Services) from node_modules/electron's own Electron.app, so it says "Electron" with
// Electron's icon. Rename that bundle to the product name and swap in our icon. Packaged builds
// already get both from electron-builder, so this only matters for `npm run dev`.
const { execFileSync } = require('node:child_process')
const { copyFileSync, existsSync, readFileSync, utimesSync } = require('node:fs')
const { join } = require('node:path')

if (process.platform !== 'darwin') process.exit(0)

const root = join(__dirname, '..')
const name = require(join(root, 'package.json')).productName
const appDir = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = join(appDir, 'Contents', 'Info.plist')
const ourIcon = join(root, 'resources', 'icon.icns')
if (!existsSync(plist)) process.exit(0)

const read = (key) => {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
let iconFile = read('CFBundleIconFile') || 'electron.icns'
if (!iconFile.endsWith('.icns')) iconFile += '.icns'
const bundleIcon = join(appDir, 'Contents', 'Resources', iconFile)

const nameDone = read('CFBundleName') === name && read('CFBundleDisplayName') === name
const iconDone =
  !existsSync(ourIcon) || (existsSync(bundleIcon) && readFileSync(bundleIcon).equals(readFileSync(ourIcon)))
if (nameDone && iconDone) process.exit(0)

for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  execFileSync('plutil', ['-replace', key, '-string', name, plist])
}
if (existsSync(ourIcon)) copyFileSync(ourIcon, bundleIcon)
// Editing the bundle breaks its signature, which Apple Silicon refuses to run. Re-sign ad hoc.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'ignore' })
// Bump the bundle's mtime and re-register so Launch Services drops the cached name and icon.
const now = new Date()
utimesSync(appDir, now, now)
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
try {
  execFileSync(lsregister, ['-f', appDir])
} catch {
  // Not fatal: the new name and icon show after the next login if the cache is stale.
}
console.log(`Renamed dev Electron.app to "${name}" and set its icon`)
