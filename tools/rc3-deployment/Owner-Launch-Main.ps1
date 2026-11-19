param(
 [ValidateSet('RC3','RC2')][string]$Release='RC3',
 [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$BindAddress='192.168.137.1',
 [switch]$Execute,[switch]$ConfirmReadOnlyPassed
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$package=Join-Path $projectRoot 'firmware\deployment\nature_touch_rc3_20261105'
& node (Join-Path $PSScriptRoot 'verify.mjs')
if($LASTEXITCODE -ne 0){throw 'Package verification failed.'}
$manifest=[IO.File]::ReadAllText((Join-Path $package 'PACKAGE_MANIFEST.json'))|ConvertFrom-Json
$selected=if($Release -eq 'RC3'){$manifest.rc3}else{$manifest.rc2}
& node (Join-Path $PSScriptRoot 'verify-final-main.mjs')
if($LASTEXITCODE -ne 0){throw 'Final Main verification failed.'}
$entry=Join-Path $projectRoot 'desktop\out-exhibition-rc3\main\bootstrap.cjs'
$electron=Join-Path $projectRoot 'desktop\node_modules\electron\dist\electron.exe'
if(-not $Execute){
 [pscustomobject]@{result='DRY_RUN_ONLY';release=$Release;version=$selected.version;entry=$entry;port=8443;
  started=$false;serialOpened=$false}|ConvertTo-Json
 return
}
if(-not $ConfirmReadOnlyPassed){throw 'Confirm the matching release IDENTIFY/STATUS passed before launching.'}
& (Join-Path $PSScriptRoot 'Assert-ApplicationStopped.ps1')
if($BindAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'){throw 'Private IPv4 required.'}
if(-not(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -eq $BindAddress})){throw 'Bind address is not assigned locally.'}
$key=Join-Path $projectRoot ('.local\ipad-lan\key-'+$BindAddress+'.pem')
$cert=Join-Path $projectRoot ('.local\ipad-lan\cert-'+$BindAddress+'.pem')
if(-not(Test-Path -LiteralPath $key) -or -not(Test-Path -LiteralPath $cert)){throw 'Existing TLS certificate/key missing. No certificate was changed.'}
if(-not(Test-Path -LiteralPath $electron)){throw 'Existing Electron runtime missing.'}
$names=@('NODE_PATH','NATURE_TOUCH_IPAD_BIND_ADDRESS','NATURE_TOUCH_IPAD_TLS_KEY_PATH','NATURE_TOUCH_IPAD_TLS_CERT_PATH','NATURE_TOUCH_IPAD_PASSWORD','NATURE_TOUCH_IPAD_PORT','ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL')
$previous=@{};foreach($n in $names){$previous[$n]=[Environment]::GetEnvironmentVariable($n,'Process')}
try{$Host.UI.RawUI.WindowTitle='Nature Touch '+$Release+' - Secure startup'}catch{}
$secret=Read-Host 'Existing LAN password (12+ characters; not saved)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 if($plain.Length -lt 12){throw 'LAN password needs at least 12 characters.'}
 [Environment]::SetEnvironmentVariable('NODE_PATH',$null,'Process')
 $env:NATURE_TOUCH_IPAD_BIND_ADDRESS=$BindAddress
 $env:NATURE_TOUCH_IPAD_TLS_KEY_PATH=$key
 $env:NATURE_TOUCH_IPAD_TLS_CERT_PATH=$cert
 $env:NATURE_TOUCH_IPAD_PASSWORD=$plain
 $env:NATURE_TOUCH_IPAD_PORT='8443'
 [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process')
 [Environment]::SetEnvironmentVariable('ELECTRON_RENDERER_URL',$null,'Process')
 # Owner-requested interactive Main. No automatic connect, upload or START.
 & node (Join-Path $PSScriptRoot 'launch-final-main.mjs') --release $Release --execute
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$plain=$null
 foreach($n in $names){[Environment]::SetEnvironmentVariable($n,$previous[$n],'Process')}
}
