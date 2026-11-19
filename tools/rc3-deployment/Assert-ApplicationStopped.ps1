$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$mains=@(Get-CimInstance Win32_Process | Where-Object {
 $_.Name -eq 'electron.exe' -and $_.CommandLine -notmatch '--type=' -and
 $_.CommandLine -like ('*'+$projectRoot+'*')
})
if($mains.Count){
 & node (Join-Path $PSScriptRoot 'status.mjs')
 throw 'Existing Main or residual process found; NOT assumed READY. Close normally only after owner approval. No process was stopped.'
}
if(@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object {$_.Port -eq 8443}).Count){
 throw '8443 has a listener. Refusing duplicate launch or serial ownership assumptions.'
}
Write-Output 'Application/8443 ownership check passed. COM availability was NOT probed.'
