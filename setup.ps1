# bluewind-statusline 설치 스크립트
#
# 동작:
#   1) statusline-merged.js 를 ~/.claude/ 로 복사
#   2) vendor/claude-hud 를 ~/.claude/statusline-hud 로 복사 (vendoring 한 HUD)
#   3) ~/.claude/settings.json 의 statusLine 블록만 갱신 (나머지 설정 보존)
#   4) claude-hud config 의 sevenDayThreshold 를 0 으로 (📅 weekly 항상 표시)
#
# 사용: PowerShell 에서  .\setup.ps1
#
# 전제:
#   - Node 18+ 가 PATH 에 있어야 함 (winget install OpenJS.NodeJS.LTS)
#   - Git Bash(bash) 가 PATH 에 있어야 함
#   (claude-hud 플러그인 설치 불필요 — vendor/ 에 포함됨)

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

# 1) 래퍼 복사
if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Force $claudeDir | Out-Null }
Copy-Item $src $dst -Force
Write-Host "[1/4] 래퍼 복사 완료: $dst"

# 1.5) vendoring 한 claude-hud 복사
$hudSrc = Join-Path $PSScriptRoot 'vendor\claude-hud'
$hudDst = Join-Path $claudeDir 'statusline-hud'
if (Test-Path $hudSrc) {
  if (Test-Path $hudDst) { Remove-Item $hudDst -Recurse -Force }
  Copy-Item $hudSrc $hudDst -Recurse -Force
  Write-Host "[2/4] HUD 복사 완료: $hudDst"
} else {
  Write-Warning "vendor\claude-hud 없음 → 곰 마스코트만 표시됨"
}

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
Write-Host "[3/4] settings.json statusLine 갱신 완료"

# 3) claude-hud config 의 sevenDayThreshold 만 머지
#    claude-hud 는 7일 사용률이 sevenDayThreshold(기본 80) 이상일 때만 7d 세그먼트를
#    렌더한다 → 0 으로 낮춰야 📅 weekly 줄이 항상 나온다.
#    HUD 는 vendoring 본을 실행해도 설정을 ~/.claude/plugins/claude-hud/config.json
#    에서 읽는다. 다른 키는 그대로 보존.
$hudCfgDir  = Join-Path $claudeDir 'plugins\claude-hud'
$hudCfgPath = Join-Path $hudCfgDir 'config.json'

if (Test-Path $hudCfgPath) {
  try   { $hudCfg = (Get-Content $hudCfgPath -Raw -Encoding UTF8) | ConvertFrom-Json }
  catch { $hudCfg = [pscustomobject]@{} }
} else {
  $hudCfg = [pscustomobject]@{}
}

# display 가 없거나 객체가 아니면(손상된 설정) 새 객체로 교체
if ($hudCfg.display -isnot [System.Management.Automation.PSCustomObject]) {
  $hudCfg | Add-Member -NotePropertyName display -NotePropertyValue ([pscustomobject]@{}) -Force
}
$hudCfg.display | Add-Member -NotePropertyName sevenDayThreshold -NotePropertyValue 0 -Force

if (-not (Test-Path $hudCfgDir)) { New-Item -ItemType Directory -Force $hudCfgDir | Out-Null }
$hudOut = $hudCfg | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($hudCfgPath, $hudOut, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[4/4] claude-hud config 갱신 완료 (weekly 항상 표시)"

Write-Host ""
Write-Host "완료. Claude Code 를 재시작하면 상태표시줄이 적용됩니다." -ForegroundColor Green
