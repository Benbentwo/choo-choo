#!/usr/bin/env bash
# Prints the Homebrew cask for a Choo Choo release.
# Usage: scripts/homebrew-cask.sh VERSION ARM64_SHA256 X64_SHA256 SIGNED(true|false)
# The Release workflow runs this and pushes the result to Benbentwo/homebrew-tap as Casks/choo-choo.rb.
set -euo pipefail
version="${1:?version}" arm="${2:?arm64 sha256}" intel="${3:?x64 sha256}" signed="${4:-false}"

cat <<CASK
cask "choo-choo" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${arm}",
         intel: "${intel}"

  url "https://github.com/Benbentwo/choo-choo/releases/download/v#{version}/ChooChoo-#{version}-#{arch}.dmg"
  name "Choo Choo"
  desc "Run parallel Claude Code agents in git worktrees"
  homepage "https://github.com/Benbentwo/choo-choo"

  livecheck do
    url :url
    strategy :github_latest
  end

CASK

if [ "$signed" = "true" ]; then
  # Signed builds update themselves, so brew upgrade leaves them alone unless --greedy.
  echo '  auto_updates true'
  echo
fi

cat <<'CASK'
  depends_on macos: ">= :monterey"

  app "Choo Choo.app"

CASK

if [ "$signed" != "true" ]; then
  cat <<'CASK'
  # The build isn't signed by Apple yet, so Gatekeeper would block the first launch.
  # Clearing the download quarantine is the same step the README asks for with a manual install.
  postflight do
    system_command "/usr/bin/xattr", args: ["-cr", "#{appdir}/Choo Choo.app"]
  end

CASK
fi

cat <<'CASK'
  zap trash: [
    "~/Library/Application Support/Choo Choo",
    "~/Library/Caches/choo-choo-updater",
    "~/Library/Caches/dev.benbentwo.choochoo",
    "~/Library/Caches/dev.benbentwo.choochoo.ShipIt",
    "~/Library/Logs/Choo Choo",
    "~/Library/Preferences/dev.benbentwo.choochoo.plist",
    "~/Library/Saved Application State/dev.benbentwo.choochoo.savedState",
  ]
end
CASK
