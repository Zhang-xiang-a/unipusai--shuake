# 给刚装完系统的电脑准备 Node.js：不写注册表、不要管理员权限，
# 直接下载官方 zip 解压到项目里的 runtime\node\。
#
# 退出码：
#   0 = 已有可用的 Node（系统装的或之前下过的）
#   1 = 装失败
param(
  [int]$NeedMajor = 20,
  [string]$Version = 'v22.14.0'
)

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $root 'runtime\node'
$nodeExe = Join-Path $nodeDir 'node.exe'

function Test-NodeMajor([string]$exe) {
  if (-not $exe) { return $false }
  try {
    $raw = & $exe -v 2>$null
    if (-not $raw) { return $false }
    $major = [int](($raw -replace '^v', '').Split('.')[0])
    return $major -ge $NeedMajor
  } catch { return $false }
}

# 1) runtime 里已经有一份
if (Test-Path $nodeExe) {
  if (Test-NodeMajor $nodeExe) {
    Write-Host "  已有自带 Node：$(& $nodeExe -v)"
    exit 0
  }
  Write-Host '  自带 Node 版本太旧，重新下载'
  Remove-Item $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
}

# 2) 系统 PATH 里有
$sysNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($sysNode -and (Test-NodeMajor $sysNode)) {
  Write-Host "  系统已装 Node：$(& $sysNode -v)"
  exit 0
}

Write-Host "  系统没有可用的 Node.js $NeedMajor+，开始自动下载（约 30MB，可能慢，请耐心等）……"

$tmp  = Join-Path $env:TEMP ('node-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$file = "node-$Version-win-x64"
$zip  = Join-Path $tmp "$file.zip"

# 官方源优先，慢或失败就换国内镜像
$urls = @(
  "https://nodejs.org/dist/$Version/$file.zip",
  "https://npmmirror.com/mirrors/node/$Version/$file.zip",
  "https://cdn.npmmirror.com/binaries/node/$Version/$file.zip"
)

$ok = $false
foreach ($url in $urls) {
  Write-Host "  尝试：$url"
  try {
    # 关掉进度条，否则 PowerShell 的进度渲染会把下载拖到很慢
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 600
    if ((Get-Item $zip).Length -gt 10MB) { $ok = $true; break }
    Write-Host '  文件太小，换下一个源'
  } catch {
    Write-Host '  这个源失败了，换下一个'
  }
}

if (-not $ok) {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host '  自动下载失败。可以手动做：'
  Write-Host "    1. 用浏览器打开 https://nodejs.org/zh-cn/download"
  Write-Host '    2. 下载 Windows 安装包（.msi，LTS 版），一路下一步装完'
  Write-Host '    3. 关掉这个窗口，重新双击 一键刷课.bat'
  exit 1
}

Write-Host '  下载完成，正在解压……'
Expand-Archive -Path $zip -DestinationPath $tmp -Force

$unpacked = Join-Path $tmp $file
if (-not (Test-Path (Join-Path $unpacked 'node.exe'))) {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host '  解压出来的目录不对，可能下载到了错误页面。'
  exit 1
}

New-Item -ItemType Directory -Path (Split-Path -Parent $nodeDir) -Force | Out-Null
Move-Item $unpacked $nodeDir -Force
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $nodeExe)) {
  Write-Host '  解压后没找到 node.exe。'
  exit 1
}

Write-Host "  装好了：$(& $nodeExe -v)"
exit 0