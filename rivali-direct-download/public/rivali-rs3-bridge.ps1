param(
  [string]$RivaliUrl = "",
  [string]$WatchFolder = "",
  [string]$PassCode = "",
  [ValidateSet("practice","hot laps","heat","feature")]
  [string]$SessionType = "practice"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

if (-not $RivaliUrl) {
  $RivaliUrl = Read-Host "Rivali site URL (example: https://your-rivali-site.vercel.app)"
}
$RivaliUrl = $RivaliUrl.TrimEnd("/")
$endpoint = "$RivaliUrl/api/race-day/bridge-upload"

if (-not $PassCode) {
  $PassCode = Read-Host "Race Day pass code for this driver/class"
}
$PassCode = ($PassCode -replace "[^A-Za-z0-9]", "").ToUpperInvariant()

if (-not $WatchFolder) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Choose the folder where RaceStudio 3 saves downloaded XRK files"
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $WatchFolder = $dialog.SelectedPath
    }
  } catch {}
}
if (-not $WatchFolder) {
  $WatchFolder = Read-Host "Full path to the RaceStudio 3 download folder"
}
if (-not (Test-Path -LiteralPath $WatchFolder -PathType Container)) {
  throw "Folder not found: $WatchFolder"
}

$uploaded = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

function Wait-UntilStable([string]$Path) {
  $lastSize = -1
  $stable = 0
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
      Start-Sleep -Milliseconds 500
      continue
    }
    try {
      $size = (Get-Item -LiteralPath $Path).Length
      if ($size -gt 0 -and $size -eq $lastSize) {
        $stable++
        if ($stable -ge 3) { return $true }
      } else {
        $stable = 0
      }
      $lastSize = $size
    } catch {}
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Send-ToRivali([string]$Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($uploaded.Contains($fullPath)) { return }
  if (-not (Wait-UntilStable $fullPath)) {
    Write-Host "Skipped because the file never became stable: $fullPath" -ForegroundColor Yellow
    return
  }

  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromMinutes(3)
  $client.DefaultRequestHeaders.Add("X-Rivali-Pass-Code", $PassCode)
  $multipart = [System.Net.Http.MultipartFormDataContent]::new()
  $stream = $null
  try {
    $stream = [System.IO.File]::Open($fullPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $fileContent = [System.Net.Http.StreamContent]::new($stream)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/octet-stream")
    $multipart.Add($fileContent, "file", [System.IO.Path]::GetFileName($fullPath))
    $multipart.Add([System.Net.Http.StringContent]::new($SessionType), "sessionType")

    Write-Host "Uploading $([System.IO.Path]::GetFileName($fullPath))..." -ForegroundColor Cyan
    $response = $client.PostAsync($endpoint, $multipart).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if ($response.IsSuccessStatusCode) {
      $null = $uploaded.Add($fullPath)
      Write-Host "Rivali accepted the run." -ForegroundColor Green
      Write-Host $body
    } else {
      Write-Host "Rivali rejected the upload: HTTP $([int]$response.StatusCode)" -ForegroundColor Red
      Write-Host $body
    }
  } catch {
    Write-Host "Upload failed: $($_.Exception.Message)" -ForegroundColor Red
  } finally {
    if ($stream) { $stream.Dispose() }
    $multipart.Dispose()
    $client.Dispose()
  }
}

Write-Host ""
Write-Host "RIVALI RS3 BRIDGE" -ForegroundColor Red
Write-Host "Watching: $WatchFolder"
Write-Host "Session type: $SessionType"
Write-Host "Pass code: $PassCode"
Write-Host "When RaceStudio finishes a new .xrk download, Rivali will upload it automatically."
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $WatchFolder
$watcher.Filter = "*.xrk"
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
$watcher.EnableRaisingEvents = $true

$created = Register-ObjectEvent $watcher Created -SourceIdentifier "RivaliXRKCreated"
$renamed = Register-ObjectEvent $watcher Renamed -SourceIdentifier "RivaliXRKRenamed"

try {
  while ($true) {
    $event = Wait-Event -Timeout 1
    if (-not $event) { continue }
    if ($event.SourceIdentifier -in @("RivaliXRKCreated","RivaliXRKRenamed")) {
      $path = $event.SourceEventArgs.FullPath
      Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
      Send-ToRivali $path
    }
  }
} finally {
  Unregister-Event "RivaliXRKCreated" -ErrorAction SilentlyContinue
  Unregister-Event "RivaliXRKRenamed" -ErrorAction SilentlyContinue
  $watcher.Dispose()
}
