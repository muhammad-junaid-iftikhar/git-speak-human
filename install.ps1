# gitbuddy installer for Windows:
#   irm https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo = "muhammad-junaid-iftikhar/git-speak-human"
$dir = if ($env:GITBUDDY_INSTALL_DIR) { $env:GITBUDDY_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "gitbuddy" }
$url = "https://github.com/$repo/releases/latest/download/gitbuddy-windows-x64.exe"

Write-Host "🐙 Downloading gitbuddy..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -Uri $url -OutFile (Join-Path $dir "gitbuddy.exe")

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($userPath -split ";" | Where-Object { $_ -eq $dir })) {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  Write-Host "🐙 Added $dir to your PATH (open a new terminal)." -ForegroundColor Cyan
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Heads up: git isn't installed yet. Get it from https://git-scm.com/downloads" -ForegroundColor Yellow
}
Write-Host "🐙 Done! Type: gitbuddy" -ForegroundColor Cyan
