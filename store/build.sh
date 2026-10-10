#!/bin/sh
# 웹스토어 업로드용 ZIP을 만든다. 테스트·문서는 빼고 확장에 필요한 파일만 담는다.
set -e
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
rm -f "dist/gifticon-extender-$version.zip"
zip -q "dist/gifticon-extender-$version.zip" manifest.json background.js content.js confirm-override.js popup.html popup.js icon16.png icon48.png icon128.png
echo "dist/gifticon-extender-$version.zip"
