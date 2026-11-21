param([int]$TargetPid)
$sig = @"
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint dwProcessId);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
"@
$k = Add-Type -MemberDefinition $sig -Name K -Namespace W -PassThru
$null = $k::FreeConsole()
if (-not $k::AttachConsole([uint32]$TargetPid)) {
  Write-Output "AttachConsole failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  exit 1
}
$null = $k::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
$ok = $k::GenerateConsoleCtrlEvent(0, 0)
Write-Output "GenerateConsoleCtrlEvent: $ok"
$null = $k::FreeConsole()
