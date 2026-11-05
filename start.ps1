<#
.SYNOPSIS
    Future Cup 多 Agent 前端工程平台 启动脚本 (PowerShell)
.DESCRIPTION
    只做启动前校验，不自动构建前端。服务读取 lib/web 下的静态产物，
    前端源码改动后需手动执行 build:ui 才会生效。
#>

$Host.UI.RawUI.WindowTitle = "Future Cup 多 Agent 前端工程平台"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "         Future Cup 多 Agent 前端工程平台 启动程序              " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

$uiRoot = Join-Path $PSScriptRoot "packages\experimental\future-cup-platform\lib\web"
$uiSource = Join-Path $PSScriptRoot "packages\experimental\future-cup-platform\ui\src"
$buildCommand = "pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui"
$port = 3090
$platformUrl = "http://127.0.0.1:$port"

function Fail-Startup([string]$Message, [int]$Code = 1) {
    Write-Host ""
    Write-Host "[错误] $Message" -ForegroundColor Red
    Write-Host ""
    exit $Code
}

function Test-PortListening([int]$TargetPort) {
    try {
        $connections = @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue)
        if ($connections.Count -gt 0) { return $true }
    } catch {
        # 部分系统没有该 cmdlet，继续用 netstat 兜底
    }
    $lines = @(& netstat.exe -ano -p TCP 2>$null)
    $pattern = '^\s*TCP\s+\S+:' + $TargetPort + '\s+\S+\s+LISTENING\s+\d+\s*$'
    foreach ($line in $lines) {
        if ($line -match $pattern) { return $true }
    }
    return $false
}

function Get-NodeVersionParts([string]$Text) {
    if ($Text -and $Text -match '^v?(\d+)\.(\d+)\.') {
        return @([int]$Matches[1], [int]$Matches[2])
    }
    return @(0, 0)
}

# 1. 检测与加载 DeepSeek API Key
$keyFile = "E:\密钥\apikeydeepseek.txt"
$envFile = Join-Path $PSScriptRoot ".env"

if (-not $env:DEEPSEEK_API_KEY) {
    if (Test-Path $keyFile) {
        $env:DEEPSEEK_API_KEY = (Get-Content $keyFile -Raw).Trim()
        Write-Host "[1/5] 已从 $keyFile 载入 DeepSeek API Key" -ForegroundColor Green
    } elseif (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match "^\s*DEEPSEEK_API_KEY\s*=\s*(.*)$") {
                $env:DEEPSEEK_API_KEY = $matches[1].Trim()
            }
        }
        if ($env:DEEPSEEK_API_KEY) {
            Write-Host "[1/5] 已从 .env 载入 DeepSeek API Key" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[1/5] 检测到已存在环境变量 DEEPSEEK_API_KEY" -ForegroundColor Green
}

if (-not $env:DEEPSEEK_API_KEY) {
    Write-Host "[错误] 未检测到 DEEPSEEK_API_KEY！" -ForegroundColor Red
    Write-Host "请在 $keyFile 中配置密钥，或在根目录创建 .env 文件" -ForegroundColor Yellow
    $userKey = Read-Host "请输入您的 DeepSeek API Key（直接回车退出）"
    if ([string]::IsNullOrWhiteSpace($userKey)) {
        exit 1
    }
    $env:DEEPSEEK_API_KEY = $userKey.Trim()
}

# 确保 .env 文件同步
if (-not (Test-Path $envFile)) {
    Set-Content -Path $envFile -Value "DEEPSEEK_API_KEY=$($env:DEEPSEEK_API_KEY)" -Encoding utf8
}
Write-Host "       API 密钥配置完成。" -ForegroundColor Green
Write-Host ""

# 2. 校验前端静态产物（服务只读 lib/web，本脚本不会自动构建）
Write-Host "[2/5] 正在校验前端静态产物（本脚本不自动构建）..." -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $uiRoot -PathType Container)) {
    Fail-Startup "未找到前端产物目录：$uiRoot`n         请先完整执行：$buildCommand" 2
}

$requiredArtifacts = @("index.html", "hq\index.html", "hq\hq-bridge.js")
foreach ($relative in $requiredArtifacts) {
    $artifact = Join-Path $uiRoot $relative
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        Fail-Startup "前端产物缺失：$relative`n         常见于构建被提前中断，请完整重跑：$buildCommand" 2
    }
}

# 校验页面里的本地 js/css 引用是否齐全，避免打开页面才发现白屏
$missingRefs = @()
foreach ($page in @("index.html", "hq\index.html")) {
    $pagePath = Join-Path $uiRoot $page
    $pageDirectory = Split-Path -Parent $pagePath
    $html = Get-Content -LiteralPath $pagePath -Raw -Encoding UTF8
    foreach ($match in [regex]::Matches($html, '(?:src|href)\s*=\s*"([^"]+)"')) {
        $reference = $match.Groups[1].Value.Trim()
        if ($reference -match '^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|//|#)') { continue }
        $reference = ($reference -split '[?#]')[0]
        if ([string]::IsNullOrWhiteSpace($reference)) { continue }
        if ($reference.StartsWith('/')) {
            $target = Join-Path $uiRoot ($reference.TrimStart('/').Replace('/', '\'))
        } else {
            $target = Join-Path $pageDirectory $reference.Replace('/', '\')
        }
        $target = [IO.Path]::GetFullPath($target)
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            $missingRefs += "$page -> $reference"
        }
    }
}
if ($missingRefs.Count -gt 0) {
    Fail-Startup "前端产物引用了不存在的资源：$($missingRefs -join '; ')`n         请完整重跑：$buildCommand" 2
}
Write-Host "       产物完整（index.html / hq/index.html / hq-bridge.js / 本地资源引用）" -ForegroundColor Green

# 源码比产物新时仅提示，不自动构建
if (Test-Path -LiteralPath $uiSource -PathType Container) {
    $newestSource = Get-ChildItem -LiteralPath $uiSource -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $builtAt = (Get-Item -LiteralPath (Join-Path $uiRoot "index.html")).LastWriteTime
    if ($null -ne $newestSource -and $newestSource.LastWriteTime -gt $builtAt.AddSeconds(2)) {
        Write-Host ""
        Write-Host "[提示] 前端源码比当前产物更新（源码 $($newestSource.LastWriteTime.ToString('MM-dd HH:mm')) / 产物 $($builtAt.ToString('MM-dd HH:mm'))）。" -ForegroundColor Yellow
        Write-Host "       本脚本不会自动构建，启动后看到的仍是旧页面；如需生效请手动执行：" -ForegroundColor Yellow
        Write-Host "       $buildCommand" -ForegroundColor Yellow
    }
}
Write-Host ""

# 3. 检查端口占用
Write-Host "[3/5] 正在检查端口 $port ..." -ForegroundColor Cyan
if (Test-PortListening $port) {
    Fail-Startup "端口 $port 已被占用，平台可能已经在运行。`n         可直接打开 $platformUrl 查看；若要重启，请先结束占用该端口的进程。" 3
}
Write-Host "       端口 $port 空闲" -ForegroundColor Green
Write-Host ""

# 4. 校验 Node 运行时（--env-file-if-exists / --import tsx/esm 需要 Node >= 24.9）
Write-Host "[4/5] 正在校验 Node 运行时..." -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail-Startup "未找到 node，请安装 Node.js >= 24.9 并加入 PATH。" 3
}
$nodeVersionText = (& node --version 2>$null | Select-Object -First 1)
$versionParts = Get-NodeVersionParts $nodeVersionText
if ($versionParts[0] -lt 24 -or ($versionParts[0] -eq 24 -and $versionParts[1] -lt 9)) {
    # 与 start-future-cup-local.ps1 保持一致：版本偏低时优先使用系统 Node 24
    $fallbackNodeDirectory = 'D:\New Folder'
    if (Test-Path -LiteralPath (Join-Path $fallbackNodeDirectory 'node.exe')) {
        $env:PATH = "$fallbackNodeDirectory;$env:PATH"
        $nodeVersionText = (& node --version 2>$null | Select-Object -First 1)
        $versionParts = Get-NodeVersionParts $nodeVersionText
    }
}
if ($versionParts[0] -eq 0) {
    Fail-Startup "无法读取 node 版本（$nodeVersionText）。" 3
}
if ($versionParts[0] -lt 24 -or ($versionParts[0] -eq 24 -and $versionParts[1] -lt 9)) {
    Fail-Startup "当前 node 为 $nodeVersionText，项目要求 >= v24.9；请切换 PATH 中的 Node 版本后重试。" 3
}
Write-Host "       运行时正常（node $nodeVersionText）" -ForegroundColor Green
Write-Host ""

# 5. 运行服务（平台就绪后会自动打开默认浏览器）
Write-Host "[5/5] 正在启动平台服务 ($platformUrl)..." -ForegroundColor Cyan
Write-Host "      按 Ctrl+C 停止服务；前端源码改动需手动 build:ui 后重启才会生效。" -ForegroundColor DarkGray
Write-Host ""

node --env-file-if-exists=.env --import tsx/esm apps/cli/src/bin.ts web
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "[错误] 平台服务异常退出（退出码 $exitCode），详情见上方输出。" -ForegroundColor Red
}
exit $exitCode
