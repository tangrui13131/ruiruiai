<#
.SYNOPSIS
    Future Cup 多 Agent 前端工程平台 启动脚本 (PowerShell)
#>

$Host.UI.RawUI.WindowTitle = "Future Cup 多 Agent 前端工程平台"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "         Future Cup 多 Agent 前端工程平台 启动程序              " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

# 1. 检测与加载 DeepSeek API Key
$keyFile = "E:\密钥\apikeydeepseek.txt"
$envFile = Join-Path $PSScriptRoot ".env"

if (-not $env:DEEPSEEK_API_KEY) {
    if (Test-Path $keyFile) {
        $env:DEEPSEEK_API_KEY = (Get-Content $keyFile -Raw).Trim()
        Write-Host "[1/3] 已从 $keyFile 载入 DeepSeek API Key" -ForegroundColor Green
    } elseif (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match "^\s*DEEPSEEK_API_KEY\s*=\s*(.*)$") {
                $env:DEEPSEEK_API_KEY = $matches[1].Trim()
            }
        }
        if ($env:DEEPSEEK_API_KEY) {
            Write-Host "[1/3] 已从 .env 载入 DeepSeek API Key" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[1/3] 检测到已存在环境变量 DEEPSEEK_API_KEY" -ForegroundColor Green
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

Write-Host "[2/3] API 密钥配置完成。" -ForegroundColor Green
Write-Host "[3/3] 正在启动平台服务 (http://127.0.0.1:3090)..." -ForegroundColor Cyan
Write-Host ""

# 2. 异步在浏览器中打开平台页面
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://127.0.0.1:3090/"
} | Out-Null

# 3. 运行服务
node --env-file-if-exists=.env --import tsx/esm apps/cli/src/bin.ts web