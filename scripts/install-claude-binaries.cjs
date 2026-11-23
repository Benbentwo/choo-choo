// npm only installs the Claude binary for the machine's own CPU. Install the ones for the target
// platform so a single machine can build every app for it.
//   node scripts/install-claude-binaries.cjs mac     (arm64 + x64)
//   node scripts/install-claude-binaries.cjs linux   (x64)
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const TARGETS = {
  mac: ['darwin-arm64', 'darwin-x64'],
  linux: ['linux-x64']
}

const platform = process.argv[2]
if (!TARGETS[platform]) {
  console.error(`Usage: install-claude-binaries.cjs <${Object.keys(TARGETS).join('|')}>`)
  process.exit(1)
}

// The SDK's exports map hides package.json, so read it from disk.
const sdkJson = path.join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json')
const { version } = JSON.parse(fs.readFileSync(sdkJson, 'utf8'))

const pkgs = TARGETS[platform].map((t) => `@anthropic-ai/claude-agent-sdk-${t}@${version}`)
execFileSync('npm', ['install', '--no-save', '--force', ...pkgs], { stdio: 'inherit' })
