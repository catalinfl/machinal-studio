$ErrorActionPreference = 'Stop'
Get-Command docker -ErrorAction Stop | Out-Null
docker compose --project-directory $PSScriptRoot -f (Join-Path $PSScriptRoot 'compose.editengine.yaml') up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw 'Local Docker startup failed. Check Docker and the selected ports.' }
$port = if ($env:CLIENT_PORT) { $env:CLIENT_PORT } else { '5173' }
Write-Host "machinal local: http://localhost:$port — configure your own OpenRouter key in Settings, or edit without AI."
