#!/bin/sh
# Push the locally generated skin (npm run skin) into ui-sprout/ of the private
# skin repo that Vercel builds download. Other files in that repo are kept.
# Run again whenever you regenerate the skin.
set -e
cd "$(dirname "$0")/.."
node scripts/check-skin.mjs
SRC="$PWD/src/assets/ui-sprout"
REPO="${SKIN_REPO:-kellieChung/lunar-landing-skin}"
TMP="$(mktemp -d)"
git clone -q --depth 1 "https://github.com/$REPO.git" "$TMP/repo"
cd "$TMP/repo"
rm -rf ui-sprout
mkdir ui-sprout
cp -R "$SRC/." ui-sprout/
git add -A ui-sprout
if git diff --cached --quiet; then
  echo "Skin in $REPO is already up to date."
else
  git commit -q -m "Generated skin for the Vercel build (npm run skin)"
  git push -q origin HEAD
  echo "Published skin to $REPO (ui-sprout/)"
fi
rm -rf "$TMP"
