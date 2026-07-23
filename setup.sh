#!/usr/bin/env bash
# bluewind-statusline 설치 스크립트 (macOS / Linux)
#
# 동작:
#   1) statusline-merged.js 를 ~/.claude/ 로 복사
#   2) vendor/claude-hud 를 ~/.claude/statusline-hud 로 복사 (vendoring 한 HUD)
#   3) ~/.claude/settings.json 의 statusLine 블록만 갱신 (나머지 설정 보존)
#
# 사용: 터미널에서  ./setup.sh   (또는  bash setup.sh)
#
# 전제:
#   - Node 18+ 가 PATH 에 있어야 함 (macOS: brew install node)
#   (claude-hud 플러그인 설치 불필요 — vendor/ 에 포함됨)

set -euo pipefail

# 스크립트가 위치한 디렉터리 (어디서 실행하든 정상 동작)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLAUDE_DIR="$HOME/.claude"
SRC="$SCRIPT_DIR/statusline-merged.js"
DST="$CLAUDE_DIR/statusline-merged.js"
SETTINGS_PATH="$CLAUDE_DIR/settings.json"

# 0) 전제 조건 점검 (실패해도 진행하되 경고)
if ! command -v node >/dev/null 2>&1; then
  echo "경고: node 를 PATH 에서 찾지 못함 → Node 18+ 설치 필요 (macOS: brew install node)" >&2
fi

# 1) 래퍼 복사
mkdir -p "$CLAUDE_DIR"
cp -f "$SRC" "$DST"
echo "[1/3] 래퍼 복사 완료: $DST"

# 1.5) vendoring 한 claude-hud 복사
HUD_SRC="$SCRIPT_DIR/vendor/claude-hud"
HUD_DST="$CLAUDE_DIR/statusline-hud"
if [ -d "$HUD_SRC" ]; then
  rm -rf "$HUD_DST"
  cp -R "$HUD_SRC" "$HUD_DST"
  echo "[2/3] HUD 복사 완료: $HUD_DST"
else
  echo "경고: vendor/claude-hud 없음 → 곰 마스코트만 표시됨" >&2
fi

# 2) settings.json 의 statusLine 블록만 머지
#    Node 로 JSON 을 읽고 statusLine 만 교체 → 나머지 설정 보존.
#    경로 하드코딩 없음: $HOME 확장은 bash 가, node 는 PATH 가 처리 → 머신 독립적.
if command -v node >/dev/null 2>&1; then
  SETTINGS_PATH="$SETTINGS_PATH" node <<'NODE'
const fs = require('fs');
const p = process.env.SETTINGS_PATH;
let settings = {};
if (fs.existsSync(p)) {
  try { settings = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch { settings = {}; }
}
settings.statusLine = {
  type: 'command',
  command: 'bash -c \'node "$HOME/.claude/statusline-merged.js"\'',
};
fs.writeFileSync(p, JSON.stringify(settings, null, 2) + '\n');
NODE
  echo "[3/3] settings.json statusLine 갱신 완료"
else
  echo "경고: node 가 없어 settings.json 을 갱신하지 못함. Node 설치 후 다시 실행하세요." >&2
fi

echo ""
echo "완료. Claude Code 를 재시작하면 상태표시줄이 적용됩니다."
