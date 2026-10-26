#!/bin/sh
# Bumps the ?v= number on every file the page loads, so phones fetch the new version
# instead of a cached one. Run before pushing changes to the site.
set -e
cd "$(dirname "$0")/.."
current=$(grep -o 'app.js?v=[0-9]*' index.html | grep -o '[0-9]*$')
next=$((current + 1))
sed -i.bak "s/?v=$current'/?v=$next'/g; s/?v=$current\"/?v=$next\"/g" index.html js/*.js
rm -f index.html.bak js/*.js.bak
echo "v$current -> v$next"
