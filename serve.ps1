# Простой локальный сервер для разработки: .\serve.ps1  →  http://localhost:8080
param([int]$Port = 8080)
$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.glb' = 'model/gltf-binary'
}
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Vacuum Rush: http://localhost:$Port  (Ctrl+C - stop)"
try {
  while ($l.IsListening) {
    $ctx = $l.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      # Итоги симуляции баланса (index.html?sim=N) — в sim/results.json
      if ($ctx.Request.HttpMethod -eq 'POST' -and $path -eq 'sim-results') {
        $body = (New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
        $dir = Join-Path $root 'sim'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
        $name = $ctx.Request.QueryString['out']; if ($name -notmatch '^[\w-]{1,40}$') { $name = 'results' }
        [IO.File]::WriteAllText((Join-Path $dir "$name.json"), $body, (New-Object Text.UTF8Encoding($false)))
        Write-Host "Sim results saved: sim/$name.json"
        $res.StatusCode = 200; $res.Close(); continue
      }
      # Итоги замера производительности (index.html?perf=1) — в perf/results.json
      if ($ctx.Request.HttpMethod -eq 'POST' -and $path -eq 'perf-results') {
        $body = (New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
        $dir = Join-Path $root 'perf'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
        $name = if ($ctx.Request.Url.Query -like '*leak*') { 'leak.json' } else { 'results.json' }
        [IO.File]::WriteAllText((Join-Path $dir $name), $body, (New-Object Text.UTF8Encoding($false)))
        Write-Host "Perf results saved: perf/$name"
        $res.StatusCode = 200; $res.Close(); continue
      }
      if ($path -eq '') { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-store')
        $res.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else { $res.StatusCode = 404 }
    } catch { Write-Host "Error: $($_.Exception.Message)" }
    try { $res.Close() } catch {}
  }
} finally { $l.Stop() }
