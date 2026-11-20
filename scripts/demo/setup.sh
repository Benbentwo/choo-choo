#!/usr/bin/env bash
# Builds a throwaway demo world for recording README GIFs: a fake HOME with two small sample repos
# (each with a local bare "origin"), and nothing else. Usage: scripts/demo/setup.sh <dir>
set -euo pipefail
assets="$(cd "$(dirname "$0")" && pwd)/assets"
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
  mkdir -p public
  cp "$assets/hero-before.png" public/hero.png
  cat > public/logo.svg <<'J'
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="#3b82f6"/>
  <path d="M14 74 L40 34 L54 54 L62 44 L82 74 Z" fill="#ffffff"/>
</svg>
J
  mkdir -p docs
  cat > docs/checkout.md <<'J'
# Checkout

How a trip gets paid for, from cart to confirmation.

## Steps

1. The cart shows each booking and the total.
2. The traveler enters card details.
3. We create an order in the API and show the confirmation page.

## Payment methods

- Visa and Mastercard
- American Express

## Totals

Totals are rounded to cents on the server. The client only shows them.

| Fee | Amount |
| --- | --- |
| Booking fee | $4.00 |
| Card fee | 2.9% |

## Flow

```mermaid
flowchart LR
  Cart --> Card[Card details] --> Order --> Confirmation
```
J
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
