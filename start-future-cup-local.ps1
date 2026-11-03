param(
  [int]$Port = 3194,
  [string]$ProjectId = '',
  [string]$ApiKeyFile = '',
  [string]$LegacyDatabase = '',
  [switch]$NoBrowser,
  [switch]$SkipUiBuild,
  [switch]$SkipLegacyImport
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$pnpm = 'C:\Users\tr666\AppData\Local\npm\pnpm.ps1'
$profileName = 'future-cup-platform'
$localRoot = Join-Path $workspace '.artifacts\future-cup-local'
$patchPath = Join-Path $localRoot 'launch.patch.yml'
$uiRoot = Join-Path $workspace 'packages\experimental\future-cup-platform\lib\web'
$importScript = Join-Path $workspace 'scripts\import-future-cup-legacy.ts'
$secretDirectory = 'E:\' + [char]0x5BC6 + [char]0x94A5

function Resolve-LocalPath([string]$Path) {
  if ([IO.Path]::IsPathRooted($Path)) {
    return [IO.Path]::GetFullPath($Path)
  }
  return [IO.Path]::GetFullPath((Join-Path $workspace $Path))
}

function Find-ProfileHome {
  $candidates = @(
    $env:DSH_HOME,
    (Join-Path $workspace '.artifacts\future-cup-m42\dsh-home'),
    (Join-Path $HOME '.dsh')
  )
  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    $profilePackage = Join-Path $candidate "profiles\$profileName\package.json"
    if (Test-Path -LiteralPath $profilePackage) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }
  throw "DSH profile '$profileName' was not found. Set DSH_HOME or install the profile first."
}

if ([string]::IsNullOrWhiteSpace($ApiKeyFile)) {
  $ApiKeyFile = Join-Path $secretDirectory 'apikeydeepseek.txt'
}
if ([string]::IsNullOrWhiteSpace($LegacyDatabase)) {
  $LegacyDatabase = Join-Path $workspace '.artifacts\future-cup-platform.sqlite'
}
if (-not (Test-Path -LiteralPath $pnpm)) {
  throw "pnpm not found: $pnpm"
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use. Stop the existing Future Cup demo first."
}

$dshHome = Find-ProfileHome
$sqlitePath = if ([string]::IsNullOrWhiteSpace($env:FUTURE_CUP_SQLITE_PATH)) {
  Join-Path $localRoot 'platform.sqlite'
} else {
  Resolve-LocalPath $env:FUTURE_CUP_SQLITE_PATH
}
$runRoot = if ([string]::IsNullOrWhiteSpace($env:FUTURE_CUP_RUN_ROOT)) {
  Join-Path $workspace '.artifacts\future-cup-runs'
} else {
  Resolve-LocalPath $env:FUTURE_CUP_RUN_ROOT
}
$agentHomeRoot = if ([string]::IsNullOrWhiteSpace($env:FUTURE_CUP_AGENT_HOME_ROOT)) {
  Join-Path $localRoot 'agent-homes'
} else {
  Resolve-LocalPath $env:FUTURE_CUP_AGENT_HOME_ROOT
}

New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $sqlitePath) -Force | Out-Null
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
New-Item -ItemType Directory -Path $agentHomeRoot -Force | Out-Null

if (-not $SkipLegacyImport -and (Test-Path -LiteralPath $LegacyDatabase)) {
  Write-Host 'Importing legacy Future Cup projects when needed...' -ForegroundColor Cyan
  & $pnpm exec tsx $importScript --source $LegacyDatabase --target $sqlitePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Legacy Future Cup project import failed.'
  }
}

if (-not $SkipUiBuild) {
  Write-Host 'Building Future Cup management UI...' -ForegroundColor Cyan
  & $pnpm --filter '@deepseek-ai/dsh-experimental-future-cup-platform' build:ui
  if ($LASTEXITCODE -ne 0) {
    throw 'Future Cup management UI build failed.'
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $uiRoot 'index.html'))) {
  throw "Future Cup management UI was not found: $uiRoot"
}

$patch = @'
- id: future-cup-platform
  config:
    host: 127.0.0.1
    port: !!js Number(process.env.FUTURE_CUP_PORT ?? 3194)
    databaseDriver: sqlite
    databaseUrl: !!js undefined
    sqlitePath: !!js process.env.FUTURE_CUP_SQLITE_PATH
    outboxPollMs: 100
    outboxBatchSize: 100
    outboxClaimMs: 30000
    workspaceRoot: !!js process.env.FUTURE_CUP_RUN_ROOT
    agentHomeRoot: !!js process.env.FUTURE_CUP_AGENT_HOME_ROOT
    uiRoot: !!js process.env.FUTURE_CUP_UI_ROOT
    runProvider: !!js process.env.FUTURE_CUP_PROVIDER ?? undefined
    runModel: !!js process.env.FUTURE_CUP_MODEL ?? undefined
    runMaxTokens: 32000
    runRequestTimeoutMs: 600000
    verificationBuildTimeoutMs: 600000
    verificationBrowserTimeoutMs: 60000
    maxRepairRounds: 3
    repairTimeoutMs: 600000
    maxAgentRetries: 1
    leaseDurationMs: 60000
    heartbeatIntervalMs: 15000
    settlementRetryMs: 1000
    settlementWaitMs: 30000
'@
[IO.File]::WriteAllText($patchPath, $patch, [Text.UTF8Encoding]::new($false))

$nodeDirectory = 'D:\New Folder'
if (Test-Path -LiteralPath (Join-Path $nodeDirectory 'node.exe')) {
  $env:PATH = "$nodeDirectory;$env:PATH"
}
$env:DSH_HOME = $dshHome
$env:DSH_TELEMETRY_DISABLED = '1'
$env:FUTURE_CUP_PORT = [string]$Port
$env:FUTURE_CUP_SQLITE_PATH = $sqlitePath
$env:FUTURE_CUP_RUN_ROOT = $runRoot
$env:FUTURE_CUP_AGENT_HOME_ROOT = $agentHomeRoot
$env:FUTURE_CUP_UI_ROOT = $uiRoot
$env:FUTURE_CUP_PROVIDER = 'deepseek-official'
$env:FUTURE_CUP_MODEL = 'deepseek-flash'
Remove-Item Env:FUTURE_CUP_DATABASE_URL -ErrorAction SilentlyContinue

if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
  if (Test-Path -LiteralPath $ApiKeyFile) {
    $env:DEEPSEEK_API_KEY = (Get-Content -Raw -LiteralPath $ApiKeyFile).Trim()
    Write-Host 'DeepSeek API key loaded. It is not displayed or written to the repository.' -ForegroundColor DarkGray
  } else {
    Write-Warning "API key file not found: $ApiKeyFile. Existing projects remain viewable, but new runs are disabled."
  }
}

$managementUrl = "http://127.0.0.1:$Port/"
$openJob = $null
if (-not $NoBrowser) {
  $openJob = Start-Job -ScriptBlock {
    param($BaseUrl, $ManagementUrl, $RequestedProjectId)
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
      try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
          Start-Process $ManagementUrl
          $selectedProjectId = $RequestedProjectId
          if ([string]::IsNullOrWhiteSpace($selectedProjectId)) {
            $projects = Invoke-RestMethod -Uri "$BaseUrl/api/v1/projects" -TimeoutSec 5
            $selectedProjectId = ($projects | Sort-Object lastEventSeq -Descending | Select-Object -First 1).id
          }
          if (-not [string]::IsNullOrWhiteSpace($selectedProjectId)) {
            $encodedProjectId = [uri]::EscapeDataString($selectedProjectId)
            Start-Process "$BaseUrl/hq/index.html?projectId=$encodedProjectId"
          }
          return
        }
      } catch {
        Start-Sleep -Milliseconds 500
      }
    }
  } -ArgumentList "http://127.0.0.1:$Port", $managementUrl, $ProjectId
}

Write-Host ''
Write-Host 'Future Cup local demo is starting' -ForegroundColor Green
Write-Host "Management UI: $managementUrl"
Write-Host "SQLite:        $sqlitePath"
Write-Host "Run root:      $runRoot"
Write-Host "DSH home:      $dshHome"
if ([string]::IsNullOrWhiteSpace($ProjectId)) {
  Write-Host 'HQ display:    auto-select latest project'
} else {
  Write-Host "HQ display:    project $ProjectId"
}
Write-Host 'Press Ctrl+C to stop the platform.'
Write-Host ''

Push-Location $workspace
try {
  & $pnpm dsh --profile $profileName --patch $patchPath --no-open
  if ($LASTEXITCODE -ne 0) {
    throw "Future Cup platform exited with code $LASTEXITCODE."
  }
} finally {
  Pop-Location
  if ($openJob) {
    Stop-Job $openJob -ErrorAction SilentlyContinue
    Remove-Job $openJob -Force -ErrorAction SilentlyContinue
  }
}
