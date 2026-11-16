# bear-hud 설치 스크립트
#
# 동작:
#   1) 예전 방식으로 ~/.claude/ 에 복사해 둔 래퍼·HUD 가 있으면 지운다
#   2) ~/.claude/settings.json 의 statusLine 이 이 clone 의 래퍼를 바로 실행하게 한다
#      (나머지 설정 보존) → 이후 업데이트는 git pull 만으로 끝난다
#   3) claude-hud config 의 sevenDayThreshold 를 0 으로 (📅 weekly 항상 표시)
#
# clone 폴더를 옮기거나 지우면 상태표시줄이 깨진다. 옮겼으면 이 스크립트를 다시 실행.
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
$settingsPath = Join-Path $claudeDir 'settings.json'

function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# 0) 전제 조건 점검 (실패해도 진행하되 경고)
if (-not (Test-Cmd node)) {
  Write-Warning "node 를 PATH 에서 찾지 못함 → Node 18+ 설치 필요: winget install OpenJS.NodeJS.LTS"
}
if (-not (Test-Cmd bash)) {
  Write-Warning "bash 를 PATH 에서 찾지 못함 → Git Bash 설치 필요"
}

# 1) 예전 설치본(복사본) 정리 - 이제 clone 을 바로 실행하므로 남겨 두면 헷갈리기만 한다
if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Force $claudeDir | Out-Null }
foreach ($old in @((Join-Path $claudeDir 'statusline-merged.js'), (Join-Path $claudeDir 'statusline-hud'))) {
  if (Test-Path $old) { Remove-Item $old -Recurse -Force }
}
Write-Host "[1/3] 예전 복사본 정리 완료"

# 2) settings.json 의 statusLine 블록만 머지
if (Test-Path $settingsPath) {
  $settings = (Get-Content $settingsPath -Raw -Encoding UTF8) | ConvertFrom-Json
} else {
  $settings = [pscustomobject]@{}
}

# clone 위치는 PC 마다 다르므로 이 스크립트의 위치를 박는다. bash 가 읽으니 / 로 바꾼다.
$srcPath = $src -replace '\\', '/'
$statusLine = [pscustomobject]@{
  type    = 'command'
  command = "bash -c 'node `"$srcPath`"'"
}

if ($settings.PSObject.Properties.Name -contains 'statusLine') {
  $settings.statusLine = $statusLine
} else {
  $settings | Add-Member -NotePropertyName statusLine -NotePropertyValue $statusLine
}

# UTF-8 (BOM 없음) 으로 기록
$out = $settings | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($settingsPath, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[2/3] settings.json statusLine 갱신 완료: $srcPath"

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
Write-Host "[3/3] claude-hud config 갱신 완료 (weekly 항상 표시)"

Write-Host ""
Write-Host "완료. Claude Code 를 재시작하면 상태표시줄이 적용됩니다." -ForegroundColor Green
