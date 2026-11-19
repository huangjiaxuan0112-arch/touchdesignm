[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^COM[0-9]+$')][string]$Port,
 [Parameter(Mandatory=$true)][ValidateSet('atmega328','atmega328old')][string]$Cpu,
 [switch]$ConfirmLoadsIsolated,
 [switch]$ConfirmTargetNano,
 [switch]$OfflineCheck
)
$ErrorActionPreference='Stop'
# Independent PS 5.1 entry. The frozen RC1 release is read, never rewritten.
# ASCII source plus UTF-8 BOM avoids ANSI source decoding and smart-quote errors.
if(-not $OfflineCheck -and (-not $ConfirmLoadsIsolated -or -not $ConfirmTargetNano)){
 throw 'Owner must confirm physical load-power isolation and the target Nano/bootloader. Nothing uploaded.'
}
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release=Join-Path $projectRoot 'firmware/releases/nature_touch_v3_real_rc1_20261104T123816Z'
$manifestPath=Join-Path $release 'build-manifest.json'
if(-not(Test-Path -LiteralPath $manifestPath -PathType Leaf)){throw 'Frozen RC1 manifest not found.'}
$manifest=[IO.File]::ReadAllText($manifestPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
if($manifest.selector -ne 1 -or $manifest.hardwareOutputsEnabled -isnot [bool] -or $manifest.hardwareOutputsEnabled -ne $true -or $manifest.firmwareVersion -ne '3.0.0-rc1'){
 throw 'Real RC1 identity mismatch. Nothing uploaded.'
}
if($manifest.timelineVersion -ne '25s-4c1e4167' -or $manifest.sourceRevision -ne '5356f28e'){
 throw 'RC1 timeline/source mismatch. Nothing uploaded.'
}
$expectedSha='efffe83ee7255a8f0206febe50ac5b9d66f377b524cdf7efa140b01484ebb71d'
$expectedHex=[IO.Path]::GetFullPath((Join-Path $release 'real/nature_touch_unified.ino.hex'))
if(-not($manifest.real.hex -is [string]) -or [string]::IsNullOrWhiteSpace($manifest.real.hex)){throw 'Real HEX path is missing.'}
$hex=[IO.Path]::GetFullPath((Join-Path $release $manifest.real.hex))
if(-not [string]::Equals($hex,$expectedHex,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected Real HEX path.'}
if(-not(Test-Path -LiteralPath $hex -PathType Leaf)){throw 'Real HEX not found.'}
$actual=(Get-FileHash -LiteralPath $hex -Algorithm SHA256).Hash.ToLowerInvariant()
if($actual -ne $expectedSha -or $manifest.real.hexSha256 -ne $expectedSha){
 throw 'Real HEX SHA-256 mismatch. Nothing uploaded.'
}
$uploadArguments=@('upload','--fqbn',('arduino:avr:nano:cpu='+$Cpu),'--port',$Port,'--input-file',$hex,'--verify')
if($OfflineCheck){
 [pscustomobject]@{
  result='PASS';scope='OFFLINE_MANIFEST_AND_SHA_ONLY';firmwareVersion=$manifest.firmwareVersion
  timelineVersion=$manifest.timelineVersion;hexSha256=$actual;uploadArguments=$uploadArguments
  cpuWasPhysicallyVerified=$false;comAccessed=$false;uploaded=$false
 }|ConvertTo-Json -Depth 4 -Compress
 return
}
# No serial discovery happens above this line. OfflineCheck always returned already.
Import-Module -Name (Join-Path $PSScriptRoot 'owner-ch340-discovery.psm1') -Force -ErrorAction Stop
$portInfo=Resolve-OwnerCh340Port -Devices @(Get-CimInstance Win32_PnPEntity) -Port $Port
Write-Output ('Verified PnP device: '+$portInfo.Name+'; '+$portInfo.PNPDeviceID)
$cli=Join-Path $env:USERPROFILE 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe'
if(-not(Test-Path -LiteralPath $cli -PathType Leaf)){throw 'Existing Arduino CLI not found. Nothing uploaded.'}
Write-Output ('Owner upload: Real RC1 '+$actual+' -> '+$Port+'; cpu='+$Cpu)
$logs=Join-Path $projectRoot '.local/onsite-acceptance'
New-Item -ItemType Directory -Path $logs -Force|Out-Null
$log=Join-Path $logs ('upload-ps51-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+$PID+'.log')
$previousErrorAction=$ErrorActionPreference
$uploadExitCode=$null
try{
 $ErrorActionPreference='Continue' # Normal avrdude progress on stderr is not an upload failure.
 $global:LASTEXITCODE=$null # A failed process launch must not reuse a previous success code.
 & $cli @uploadArguments 2>&1 | ForEach-Object {
  $line=$_.ToString()
  [IO.File]::AppendAllText($log,($line+[Environment]::NewLine),[Text.Encoding]::UTF8)
  Write-Output $line
 }
 $uploadExitCode=$global:LASTEXITCODE
}finally{$ErrorActionPreference=$previousErrorAction}
if($null -eq $uploadExitCode -or $uploadExitCode -ne 0){
 throw ('Upload/verify failed. Stop; no automatic retry, bootloader change or START. Log: '+$log)
}
Write-Output ('Upload and flash verify succeeded. Keep loads isolated; perform read-only IDENTIFY/STATUS next. No START sent. Log: '+$log)
