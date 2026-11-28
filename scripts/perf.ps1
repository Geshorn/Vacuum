# Замер производительности без окна: .\scripts\perf.ps1 [-Secs 6] [-Map all] [-Gpu]
# Поднимает свой serve.ps1 на порту 8091 (чтобы не мешать игровому на 8080), открывает index.html?perf=N в безголовом Chrome/Edge,
# ждёт perf/results.json и печатает его. По умолчанию рисует программно (SwiftShader) — вызовы
# отрисовки, треугольники и память от этого не зависят, а FPS/время кадра — только для сравнения между прогонами.
# -Leak N — вместо замера: N кругов смены всех карт, память после каждого (perf/leak.json).
# -Gpu — пробовать настоящую видеокарту (цифры FPS ближе к жизни, но зависят от машины).
param([int]$Secs = 6, [string]$Map = 'all', [int]$Port = 8091, [switch]$Gpu, [int]$TimeoutS = 180, [int]$Leak = 0)
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root $(if ($Leak) { 'perf\leak.json' } else { 'perf\results.json' })
$started = $null
function Test-Server { try { (Invoke-WebRequest "http://localhost:$Port/index.html" -Method Head -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
if (-not (Test-Server)) {
  $started = Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'serve.ps1'),'-Port',$Port -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 30 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 300 }
}
$browser = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Write-Error 'Не найден Chrome или Edge'; exit 2 }
if (Test-Path $out) { Remove-Item $out }
$prof = Join-Path $env:TEMP "vacuum-perf-$PID"
$gl = if ($Gpu) { @('--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist') } else { @('--use-angle=swiftshader', '--enable-unsafe-swiftshader') }
$bargs = @('--headless=new', "--user-data-dir=$prof", '--no-first-run', '--mute-audio', '--window-size=1280,720',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-frame-rate-limit', '--enable-precise-memory-info', '--js-flags=--expose-gc') + $gl +
  @($(if ($Leak) { "http://localhost:$Port/index.html?leak=$Leak" } else { "http://localhost:$Port/index.html?perf=$Secs&map=$Map" }))
$p = Start-Process $browser -ArgumentList $bargs -PassThru
$deadline = (Get-Date).AddSeconds($TimeoutS)
while (-not (Test-Path $out) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
Start-Sleep -Milliseconds 300
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$prof*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($started) { Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue }
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path $out)) { Write-Error "Нет perf/results.json за $TimeoutS с"; exit 1 }
Get-Content $out -Raw -Encoding UTF8
