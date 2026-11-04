// npm only installs the Claude binary for the machine's own CPU. Install both mac ones so a
// single machine can build the arm64 and x64 apps.
const { execFileSync } = require('node:child_process')
const { version } = require('@anthropic-ai/claude-agent-sdk/package.json')

const pkgs = ['arm64', 'x64'].map((a) => `@anthropic-ai/claude-agent-sdk-darwin-${a}@${version}`)
execFileSync('npm', ['install', '--no-save', '--force', ...pkgs], { stdio: 'inherit' })
