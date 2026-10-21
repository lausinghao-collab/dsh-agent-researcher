# 「资料搜集员」Agent — 手动安装脚本（Windows）
#
# 作用：把同目录的 preset.patch.yml 追加到你的 DeepSeek Harness profile 补丁文件
#       （cordis.patch.yml）末尾。追加前会自动备份原文件；重复运行不会重复安装。
#       安装后 Harness 会自动热加载，新开任务即可选到「资料搜集员」。
#
# 用法（在 PowerShell 里）：
#   .\install.ps1
#   .\install.ps1 -ProfilePath "C:\Users\你\.dsh\profiles\desktop"
#
# 回滚：脚本会打印一条恢复命令；把它复制执行即可回到安装前。

[CmdletBinding()]
param(
    [string]$ProfilePath,
    [string]$PresetFile
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PresetFile) { $PresetFile = Join-Path $here 'preset.patch.yml' }

if (-not (Test-Path -LiteralPath $PresetFile)) {
    throw "找不到预设文件：$PresetFile （请确认 install.ps1 和 preset.patch.yml 在同一个文件夹）"
}

function Find-HarnessProfilesDir {
    $dshHome = $env:DSH_HOME
    if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
    $profilesDir = Join-Path $dshHome 'profiles'
    if (-not (Test-Path -LiteralPath $profilesDir)) {
        throw "找不到 Harness 的 profile 目录：$profilesDir （请先安装并运行一次 DeepSeek Harness）"
    }
    return $profilesDir
}

if (-not $ProfilePath) {
    $profilesDir = Find-HarnessProfilesDir
    foreach ($name in @('desktop', 'web')) {
        $candidate = Join-Path $profilesDir $name
        if (Test-Path -LiteralPath (Join-Path $candidate 'cordis.patch.yml')) {
            $ProfilePath = $candidate
            break
        }
    }
    if (-not $ProfilePath) {
        $candidates = @(Get-ChildItem -LiteralPath $profilesDir -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'cordis.patch.yml') })
        if ($candidates.Count -eq 1) { $ProfilePath = $candidates[0].FullName }
        else {
            throw "无法自动确定当前 profile。请用 -ProfilePath 指定，例如：`n  .\install.ps1 -ProfilePath `"$profilesDir\desktop`""
        }
    }
}

$target = Join-Path $ProfilePath 'cordis.patch.yml'
if (-not (Test-Path -LiteralPath $target)) {
    throw "这个 profile 里没有 cordis.patch.yml：$target"
}

# 以 UTF-8（无 BOM）读取，避免中文被破坏
$utf8 = New-Object System.Text.UTF8Encoding($false)
$existing = [System.IO.File]::ReadAllText($target, $utf8)

if ($existing -match '(?m)^\s*- id: preset-researcher\s*$') {
    Write-Host "✓ 已经安装过了（配置里已有 preset-researcher），无需重复安装。" -ForegroundColor Yellow
    Write-Host "  如果看不到「资料搜集员」，请重启 Harness 或新建任务后再看。"
    exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$target.bak-$stamp"
Copy-Item -LiteralPath $target -Destination $backup -Force

$block = [System.IO.File]::ReadAllText($PresetFile, $utf8)
$newContent = $existing
if (-not $newContent.EndsWith("`n")) { $newContent += "`r`n" }
$newContent += "`r`n" + $block
[System.IO.File]::WriteAllText($target, $newContent, $utf8)

Write-Host ""
Write-Host "✓ 安装完成" -ForegroundColor Green
Write-Host "  配置：$target"
Write-Host "  备份：$backup"
Write-Host ""
Write-Host "验证：打开 Harness → 设置 → 通用 → Agent 预设（或新建任务时的模式选择），"
Write-Host "      应能看到「资料搜集员」。新开任务选它即可使用。"
Write-Host ""
Write-Host "如需卸载 / 回滚，执行："
Write-Host "  Copy-Item `"$backup`" `"$target`" -Force" -ForegroundColor Cyan
