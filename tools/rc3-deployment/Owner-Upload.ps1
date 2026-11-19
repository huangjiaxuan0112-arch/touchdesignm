param(
 [ValidateSet('RC3','RC2')][string]$Release='RC3',
 [ValidatePattern('^COM[0-9]+$')][string]$Port='COM5',
 [Parameter(Mandatory=$true)][ValidateSet('atmega328','atmega328old')][string]$Cpu,
 [switch]$Execute,[switch]$AuthorizeHardware,[switch]$ConfirmLoadsIsolated,[switch]$ConfirmTargetNano
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$package=Join-Path $projectRoot 'firmware\deployment\nature_touch_rc3_20261105'
& node (Join-Path $PSScriptRoot 'verify.mjs')
if($LASTEXITCODE -ne 0){throw 'Frozen deployment payload verification failed.'}
$manifest=[IO.File]::ReadAllText((Join-Path $package 'PACKAGE_MANIFEST.json'))|ConvertFrom-Json
$selected=if($Release -eq 'RC3'){$manifest.rc3}else{$manifest.rc2}
$hex=Join-Path $package $selected.hex
$cli=Join-Path $env:USERPROFILE 'AppData\Local\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
$uploadArgs=@('upload','--fqbn',('arduino:avr:nano:cpu='+$Cpu),'--port',$Port,'--input-file',$hex,'--verify')
if(-not $Execute){
 [pscustomobject]@{result='DRY_RUN_ONLY';release=$Release;version=$selected.version;sha256=$selected.hexSha256;
  arguments=$uploadArgs;serialOpened=$false;uploaded=$false;cpuPhysicallyConfirmed=$false}|ConvertTo-Json -Depth 4
 return
}
if(-not $AuthorizeHardware -or -not $ConfirmLoadsIsolated -or -not $ConfirmTargetNano){
 throw 'Explicit hardware authorization, physical load isolation and Nano/bootloader confirmation are required. No serial operation executed.'
}
# Fail closed if any Nature Touch Main remains running. Never close or kill it.
$mains=@(Get-CimInstance Win32_Process | Where-Object {
 $_.Name -eq 'electron.exe' -and $_.CommandLine -notmatch '--type=' -and
 $_.CommandLine -like ('*'+$projectRoot+'*')
})
if($mains.Count){throw 'Close Nature Touch normally and verify it exited before upload. No process was stopped.'}
if(@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object {$_.Port -eq 8443}).Count){
 throw '8443 is occupied. Stop and identify the owner before deployment.'
}
Import-Module (Join-Path $projectRoot 'tools\owner-ch340-discovery.psm1') -Force
$device=Resolve-OwnerCh340Port -Devices @(Get-CimInstance Win32_PnPEntity) -Port $Port
if(-not(Test-Path -LiteralPath $cli)){throw 'Existing Arduino CLI is missing.'}
$logs=Join-Path $package 'onsite-logs'
New-Item -ItemType Directory -Path $logs -Force|Out-Null
$log=Join-Path $logs ($Release+'-upload-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.log')
Write-Output ('Authorized owner upload '+$Release+' '+$selected.hexSha256+' -> '+$device.Name)
$oldAction=$ErrorActionPreference
$exitCode=$null
try{
 $ErrorActionPreference='Continue'
 $global:LASTEXITCODE=$null
 & $cli @uploadArgs 2>&1 | ForEach-Object {
  $line=$_.ToString();[IO.File]::AppendAllText($log,$line+[Environment]::NewLine,[Text.Encoding]::UTF8);Write-Output $line
 }
 $exitCode=$global:LASTEXITCODE
}finally{$ErrorActionPreference=$oldAction}
if($null -eq $exitCode -or $exitCode -ne 0){throw ('Upload/flash verification failed. No retry or START. Log: '+$log)}
Write-Output ('Flash verification passed. Keep loads isolated; IDENTIFY/STATUS next. No START was sent. Log: '+$log)
