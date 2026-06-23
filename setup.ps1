# bluewind-statusline 설치 스크립트
#
# 동작:
#   1) statusline-merged.js 를 ~/.claude/ 로 복사
#   2) ~/.claude/settings.json 의 statusLine 블록만 갱신 (나머지 설정 보존)
#
# 사용: PowerShell 에서  .\setup.ps1
#
# 전제:
#   - Node 18+ 가 PATH 에 있어야 함 (winget install OpenJS.NodeJS.LTS)
#   - Git Bash(bash) 가 PATH 에 있어야 함
#   - claude-hud 플러그인이 설치돼 있어야 함
#     (/plugin marketplace add jarrodwatts/claude-hud → /plugin install claude-hud)

#requires -version 5
$ErrorActionPreference = 'Stop'

$claudeDir    = Join-Path $HOME '.claude'
$src          = Join-Path $PSScriptRoot 'statusline-merged.js'
$dst          = Join-Path $claudeDir 'statusline-merged.js'
$settingsPath = Join-Path $claudeDir 'settings.json'

function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# 0) 전제 조건 점검 (실패해도 진행하되 경고)
if (-not (Test-Cmd node)) {
  Write-Warning "node 를 PATH 에서 찾지 못함 → Node 18+ 설치 필요: winget install OpenJS.NodeJS.LTS"
}
if (-not (Test-Cmd bash)) {
  Write-Warning "bash 를 PATH 에서 찾지 못함 → Git Bash 설치 필요"
}
$hudBase = Join-Path $claudeDir 'plugins\cache\claude-hud\claude-hud'
if (-not (Test-Path $hudBase)) {
  Write-Warning "claude-hud 플러그인 미설치 → '/plugin marketplace add jarrodwatts/claude-hud' 후 install. (없으면 곰만 표시됨)"
}

# 1) 래퍼 복사
if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Force $claudeDir | Out-Null }
Copy-Item $src $dst -Force
Write-Host "[1/2] 복사 완료: $dst"

# 2) settings.json 의 statusLine 블록만 머지
if (Test-Path $settingsPath) {
  $settings = (Get-Content $settingsPath -Raw -Encoding UTF8) | ConvertFrom-Json
} else {
  $settings = [pscustomobject]@{}
}

# 경로 하드코딩 없음: $HOME 확장은 bash 가, node 는 PATH 가 처리 → 머신 독립적
$statusLine = [pscustomobject]@{
  type    = 'command'
  command = 'bash -c ''node "$HOME/.claude/statusline-merged.js"'''
}

if ($settings.PSObject.Properties.Name -contains 'statusLine') {
  $settings.statusLine = $statusLine
} else {
  $settings | Add-Member -NotePropertyName statusLine -NotePropertyValue $statusLine
}

# UTF-8 (BOM 없음) 으로 기록
$out = $settings | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($settingsPath, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[2/2] settings.json statusLine 갱신 완료"
Write-Host ""
Write-Host "완료. Claude Code 를 재시작하면 상태표시줄이 적용됩니다." -ForegroundColor Green
