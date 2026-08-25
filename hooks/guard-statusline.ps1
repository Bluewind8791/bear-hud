# statusline 가드 hook
#
# PreToolUse(Edit|Write):  설치 산출물(~/.claude/statusline-merged.js, ~/.claude/statusline-hud)
#                          직접 편집을 차단하고 원본 편집 + setup.ps1 설치로 유도(exit 2).
# PostToolUse(Edit|Write): 원본(D:\claude\claude-statusline) 수정 후 setup.ps1 실행 안내.

$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { exit 0 }

$event = $j.hook_event_name
$fp    = $j.tool_input.file_path
if (-not $fp) { exit 0 }

$norm = ($fp -replace '/', '\').ToLower()

$claude    = (Join-Path $HOME '.claude').ToLower()
$artifacts = @(
  (Join-Path $claude 'statusline-merged.js'),
  (Join-Path $claude 'statusline-hud')
)
$srcRoot = 'd:\claude\claude-statusline'

if ($event -eq 'PreToolUse') {
  foreach ($a in $artifacts) {
    if ($norm.StartsWith($a)) {
      [Console]::Error.WriteLine("이 파일은 setup.ps1 이 생성하는 설치 산출물입니다. 직접 편집하지 마세요. 원본 D:\claude\claude-statusline\statusline-merged.js (또는 vendor\claude-hud\) 를 편집한 뒤 D:\claude\claude-statusline\setup.ps1 을 실행해 설치하세요.")
      exit 2
    }
  }
  exit 0
}

if ($event -eq 'PostToolUse') {
  if ($norm.StartsWith($srcRoot) -and ($norm -notlike '*\setup.ps1') -and ($norm -notlike "*\hooks\*")) {
    $msg = "statusline 원본을 수정했습니다. 설치하려면 D:\claude\claude-statusline\setup.ps1 을 실행하세요 (실행 후 Claude Code 재시작 필요)."
    $out = @{ hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = $msg } } | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($out)
  }
  exit 0
}

exit 0
