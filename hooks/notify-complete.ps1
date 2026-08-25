$ErrorActionPreference = 'SilentlyContinue'

# 임계값(초) — 이보다 짧은 턴은 알림 안 함
$THRESHOLD = 30

# --- 0. stdin 파싱 ---
$raw = [Console]::In.ReadToEnd()
$sid = 'default'; $tp = $null; $cwd = $null
try {
    $j = $raw | ConvertFrom-Json
    if ($j.session_id)     { $sid = $j.session_id }
    if ($j.transcript_path){ $tp  = $j.transcript_path }
    if ($j.cwd)            { $cwd = $j.cwd }
} catch {}

# --- 1. 경과 시간 판정 ---
$f = Join-Path $env:TEMP ("claude-turnstart-{0}.txt" -f $sid)
$now = [int][double]::Parse((Get-Date -UFormat %s))
$elapsed = $THRESHOLD + 1
if (Test-Path $f) {
    $start = 0
    [int]::TryParse((Get-Content $f -Raw).Trim(), [ref]$start) | Out-Null
    if ($start -gt 0) { $elapsed = $now - $start }
    Remove-Item $f -Force
}
if ($elapsed -lt $THRESHOLD) { return }

# --- 2. 포그라운드 판정: Claude 터미널 창이 활성이면 알림 안 함 ---
Add-Type -Namespace W -Name N -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();' > $null
$fg = [W.N]::GetForegroundWindow()
$pidCur = $PID; $ownHandles = @()
for ($i = 0; $i -lt 8 -and $pidCur; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidCur"
    if (-not $p) { break }
    $proc = Get-Process -Id $pidCur -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne 0) { $ownHandles += $proc.MainWindowHandle }
    $pidCur = $p.ParentProcessId
}
if ($ownHandles -contains $fg) { return }

# --- 3. 알림 내용 구성 ---
# 프로젝트명
$proj = 'Claude Code'
if ($cwd) { $proj = Split-Path $cwd -Leaf }

# 경과시간 표기
if ($elapsed -ge 60) { $dur = '{0}m {1:d2}s' -f [int]($elapsed/60), ($elapsed%60) }
else                 { $dur = '{0}s' -f $elapsed }

# transcript 에서 세션 작업제목(ai-title) 추출
$title = ''
if ($tp -and (Test-Path $tp)) {
    $lines = Get-Content $tp -Encoding UTF8
    for ($k = $lines.Count - 1; $k -ge 0; $k--) {
        try { $e = $lines[$k] | ConvertFrom-Json } catch { continue }
        if ($e.type -eq 'ai-title' -and $e.aiTitle) { $title = $e.aiTitle; break }
    }
}
if (-not $title) { $title = '작업 완료' }
$title = $title.Trim() -replace '\s+', ' '
if ($title.Length -gt 80) { $title = $title.Substring(0,80) + '…' }

$heading = '✅ {0}' -f $title
$summary = '{0} · {1}' -f $proj, $dur

# --- 4. 토스트 ---
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode($heading)) > $null
$t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode($summary)) > $null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code').Show([Windows.UI.Notifications.ToastNotification]::new($t))
