<#
.SYNOPSIS
    NovaHub 平板 ADB 优先更新发布脚本模板（公开安全版，不含密钥）
.DESCRIPTION
    1. 优先检测是否有在线 ADB 设备；有则走 USB ADB 通道（adb install -r / adb push），不走公网网络。
    2. 未连接 ADB 或 ADB 安装/推送失败时，提示并回退原有网络更新（pad.ps1 / GitHub Pages）。
#>
param(
    [string]$ApkPath,
    [string]$Serial,
    [switch]$UpdateBackend,
    [switch]$NoFallback
)

$ErrorActionPreference = "Stop"

function Find-AdbDevice {
    param([string]$TargetSerial)
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { return $null }
    $lines = & adb devices 2>$null
    $devs = @()
    foreach ($ln in $lines) {
        if ($ln -match '^\s*([^\s]+)\s+device(\s|$)') { $devs += $Matches[1] }
    }
    if (-not $devs.Count) { return $null }
    if ($TargetSerial) { return $(if ($devs -contains $TargetSerial) { $TargetSerial } else { $null }) }
    return $devs[0]
}

$dev = Find-AdbDevice -TargetSerial $Serial

if ($ApkPath) {
    if (-not (Test-Path $ApkPath)) { Write-Error "APK 文件不存在: $ApkPath" }
    if ($dev) {
        Write-Host "[ADB] 已连接设备 $dev，走 USB ADB 安装 APK（不走网络）..." -ForegroundColor Cyan
        & adb -s $dev install -r $ApkPath
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] ADB 安装成功" -ForegroundColor Green
            exit 0
        }
        Write-Warning "ADB 安装失败 (exit=$LASTEXITCODE)"
        if ($NoFallback) { exit $LASTEXITCODE }
    } else {
        Write-Warning "未检测到在线 ADB 设备"
        if ($NoFallback) { exit 1 }
    }
    Write-Host "[FALLBACK] 回退至网络分发更新（请确认已更新 GitHub Releases / apk-version.json）。" -ForegroundColor Yellow
}

if ($UpdateBackend) {
    if (Test-Path ".\pad.ps1") {
        $files = @(
            "server.py", "db.py", "catalog.py", "sync_state.py",
            "index.html", "admin.html", "app.js", "style.css", "history_state.js"
        )
        foreach ($f in $files) {
            if (Test-Path $f) {
                $argsList = @("-Push", $f)
                if ($NoFallback) { $argsList += "-NoFallback" }
                if ($Serial) { $argsList += @("-Serial", $Serial) }
                & .\pad.ps1 @argsList
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            }
        }
        Write-Host "[OK] 后端与静态资源更新推送完成" -ForegroundColor Green
    } else {
        Write-Warning "未找到本地运维脚本 pad.ps1，请按 TABLET_OPS_MANUAL.md 配置。"
    }
}
