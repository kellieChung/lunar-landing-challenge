#!/bin/sh
# Push the locally generated skin (npm run skin) to the private skin repo that
# Vercel builds download. Run again whenever you regenerate the skin.
set -e
cd "$(dirname "$0")/.."
node scripts/check-skin.mjs
REPO="${SKIN_REPO:-kellieChung/lunar-landing-skin}"
TMP="$(mktemp -d)"
cp -R src/assets/ui-sprout/. "$TMP/"
cd "$TMP"
git init -q -b main
git add -A
git commit -q -m "Generated Sprout Lands skin (private: licence forbids redistribution)"
git push -f "https://github.com/$REPO.git" main
rm -rf "$TMP"
echo "Published skin to $REPO"
