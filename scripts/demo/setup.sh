#!/usr/bin/env bash
# Builds a throwaway demo world for recording README GIFs: a fake HOME with two small sample repos
# (each with a local bare "origin"), and nothing else. Usage: scripts/demo/setup.sh <dir>
set -euo pipefail
root=${1:?usage: setup.sh <dir>}
rm -rf "$root"
mkdir -p "$root/home/code" "$root/origins"
export HOME="$root/home" GIT_AUTHOR_NAME="Sam Rivera" GIT_AUTHOR_EMAIL="sam@example.com" GIT_COMMITTER_NAME="Sam Rivera" GIT_COMMITTER_EMAIL="sam@example.com"
git config --global init.defaultBranch main
git config --global user.name "Sam Rivera"
git config --global user.email "sam@example.com"

make_repo() {
  local name=$1; shift
  local dir="$HOME/code/$name"
  mkdir -p "$dir"
  ( cd "$dir" && git init -q && "$@" && git add -A && git commit -qm "Initial commit" )
  git clone -q --bare "$dir" "$root/origins/$name.git"
  ( cd "$dir" && git remote add origin "$root/origins/$name.git" && git fetch -q origin && git branch -q -u origin/main main )
}

web() {
  mkdir -p src/components src/pages
  cat > package.json <<'J'
{ "name": "trailhead-web", "private": true, "scripts": { "dev": "vite", "test": "vitest" } }
J
  printf '# Trailhead web\n\nThe trip planner front end.\n' > README.md
  cat > src/pages/Checkout.tsx <<'J'
import { CartSummary } from '../components/CartSummary'

export function Checkout() {
  return (
    <main>
      <h1>Checkout</h1>
      <CartSummary />
    </main>
  )
}
J
  cat > src/components/CartSummary.tsx <<'J'
export function CartSummary({ items = [] }: { items?: { name: string; price: number }[] }) {
  const total = items.reduce((s, i) => s + i.price, 0)
  return <aside>Total: ${total.toFixed(2)}</aside>
}
J
  printf 'export const theme = { accent: "#3b82f6" }\n' > src/theme.ts
}
api() {
  mkdir -p src/routes
  printf '{ "name": "trailhead-api", "private": true }\n' > package.json
  printf '# Trailhead API\n\nBookings, payments and trips.\n' > README.md
  cat > src/routes/orders.ts <<'J'
export async function createOrder(req: { items: string[] }) {
  return { id: crypto.randomUUID(), items: req.items }
}
J
}
make_repo trailhead-web web
make_repo trailhead-api api
echo "$root"
