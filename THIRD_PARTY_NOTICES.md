# Third-party notices

Choo Choo's own code is MIT licensed (see [LICENSE](LICENSE)). npm dependencies keep their own licenses, listed in each package under `node_modules`.

## Fonts

The app bundles [Manrope](https://github.com/sharanda/manrope) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) under the SIL Open Font License 1.1. The full license texts sit next to the font files in [src/renderer/src/assets/fonts](src/renderer/src/assets/fonts).

## Brand assets

The Choo Choo name, logo and app icon in [docs/brand](docs/brand) and [resources](resources) are not covered by the MIT license. See [docs/brand/README.md](docs/brand/README.md).

## Lucide icons

Project icons come from [Lucide](https://lucide.dev) (`lucide-react`), under the ISC license, which is MIT-compatible. The license text ships in `node_modules/lucide-react/LICENSE`.

## Claude Agent SDK

The app bundles [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and the Claude Code binary it ships with. They are not MIT licensed: their use is governed by Anthropic's terms, linked from the package's README. Choo Choo does not modify them.

## oh-my-pi

Some subagent prompts and the advisor rules are adapted from [oh-my-pi](https://github.com/can1357/oh-my-pi).

```
MIT License

Copyright (c) 2025 Mario Zechner
Copyright (c) 2025-2026 Can Bölük
Copyright (c) 2026 Stencil Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Elephant-Goldfish Model

The plan review in [src/main/planReview.ts](src/main/planReview.ts) adapts the idea and reviewer roles (design critic, implementation readiness, codebase details) from Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model), licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). The prompts were condensed and rewritten for reviewing a chat plan instead of a design document.
