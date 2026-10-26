#!/usr/bin/env bash
# claude-statusline 설치 스크립트 (macOS / Linux)
#
# 동작:
#   1) 예전 방식으로 ~/.claude/ 에 복사해 둔 래퍼·HUD 가 있으면 지운다
#   2) ~/.claude/settings.json 의 statusLine 이 이 clone 의 래퍼를 바로 실행하게 한다
#      (나머지 설정 보존) → 이후 업데이트는 git pull 만으로 끝난다
#   3) claude-hud config 의 sevenDayThreshold 를 0 으로 (📅 weekly 항상 표시)
#
# clone 폴더를 옮기거나 지우면 상태표시줄이 깨진다. 옮겼으면 이 스크립트를 다시 실행.
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
SETTINGS_PATH="$CLAUDE_DIR/settings.json"

# 0) 전제 조건 점검 (실패해도 진행하되 경고)
if ! command -v node >/dev/null 2>&1; then
  echo "경고: node 를 PATH 에서 찾지 못함 → Node 18+ 설치 필요 (macOS: brew install node)" >&2
fi

# 1) 예전 설치본(복사본) 정리 - 이제 clone 을 바로 실행하므로 남겨 두면 헷갈리기만 한다
mkdir -p "$CLAUDE_DIR"
rm -rf "$CLAUDE_DIR/statusline-merged.js" "$CLAUDE_DIR/statusline-hud"
echo "[1/3] 예전 복사본 정리 완료"

# 2) settings.json 의 statusLine 블록만 머지
#    Node 로 JSON 을 읽고 statusLine 만 교체 → 나머지 설정 보존.
#    clone 위치는 PC 마다 다르므로 이 스크립트의 위치를 박는다.
if command -v node >/dev/null 2>&1; then
  SETTINGS_PATH="$SETTINGS_PATH" SRC="$SRC" node <<'NODE'
const fs = require('fs');
const p = process.env.SETTINGS_PATH;
let settings = {};
if (fs.existsSync(p)) {
  try { settings = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch { settings = {}; }
}
settings.statusLine = {
  type: 'command',
  command: `bash -c 'node "${process.env.SRC}"'`,
};
fs.writeFileSync(p, JSON.stringify(settings, null, 2) + '\n');
NODE
  echo "[2/3] settings.json statusLine 갱신 완료: $SRC"
else
  echo "경고: node 가 없어 settings.json 을 갱신하지 못함. Node 설치 후 다시 실행하세요." >&2
fi

# 3) claude-hud config 의 sevenDayThreshold 만 머지
#    claude-hud 는 7일 사용률이 sevenDayThreshold(기본 80) 이상일 때만 7d 세그먼트를
#    렌더한다 → 0 으로 낮춰야 📅 weekly 줄이 항상 나온다.
#    HUD 는 vendoring 본을 실행해도 설정을 ~/.claude/plugins/claude-hud/config.json
#    에서 읽는다. 다른 키는 그대로 보존.
if command -v node >/dev/null 2>&1; then
  node <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = path.join(os.homedir(), '.claude', 'plugins', 'claude-hud');
const p = path.join(dir, 'config.json');
let cfg = {};
if (fs.existsSync(p)) {
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch { cfg = {}; }
}
if (typeof cfg.display !== 'object' || cfg.display === null) cfg.display = {};
cfg.display.sevenDayThreshold = 0;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
NODE
  echo "[3/3] claude-hud config 갱신 완료 (weekly 항상 표시)"
else
  echo "경고: node 가 없어 claude-hud config 를 갱신하지 못함 → weekly 가 80% 미만일 때 안 보임" >&2
fi

echo ""
echo "완료. Claude Code 를 재시작하면 상태표시줄이 적용됩니다."
