$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
try { $sid = ($raw | ConvertFrom-Json).session_id } catch { $sid = 'default' }
if (-not $sid) { $sid = 'default' }
$f = Join-Path $env:TEMP ("claude-turnstart-{0}.txt" -f $sid)
[int][double]::Parse((Get-Date -UFormat %s)) | Out-File -FilePath $f -Encoding ascii -Force
