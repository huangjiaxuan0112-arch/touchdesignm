param(
 [ValidateSet('IsolatedMock','Exhibition')][string]$Profile='IsolatedMock',
 [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$BindAddress='192.168.137.1'
)
$ErrorActionPreference='Stop'
if($Profile -eq 'Exhibition'){
 if($BindAddress -ne '192.168.137.1'){throw 'Official RC5 entry uses the configured 192.168.137.1 address.'}
 & (Join-Path $PSScriptRoot 'tools/official-rc5/launch.ps1') -Execute
 return
}
# Read existing network/certificates only. No OpenSSL, Wi-Fi, firewall or certificate writes.
if($BindAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'){throw 'Private local IPv4 required.'}
if(-not(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -eq $BindAddress})){throw 'Address is not assigned locally. No network setting was changed.'}
$electron=Join-Path $PSScriptRoot 'desktop/node_modules/electron/dist/electron.exe'
$listener=Get-NetTCPConnection -State Listen -LocalPort 8443 -ErrorAction SilentlyContinue | Select-Object -First 1
if($listener){
 $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess) -ErrorAction SilentlyContinue
 Import-Module (Join-Path $PSScriptRoot 'tools/nature-touch-launcher.psm1') -Force
 $sameElectron=$owner -and (Test-NatureTouchMainProcess -ProcessInfo $owner -ElectronPath $electron -ProjectRoot $PSScriptRoot)
 if($sameElectron){
  Write-Output ('Nature Touch Electron Main is already running (PID '+$owner.ProcessId+') and owns '+$listener.LocalAddress+':8443. No second instance was started.')
  return
 }
 $ownerName=if($owner){$owner.Name}else{'unknown process'}
 throw ('Port 8443 is occupied by PID '+$listener.OwningProcess+' ('+$ownerName+'). No Electron process was started.')
}
$key=Join-Path $PSScriptRoot ('.local/ipad-lan/key-'+$BindAddress+'.pem')
$cert=Join-Path $PSScriptRoot ('.local/ipad-lan/cert-'+$BindAddress+'.pem')
if(-not(Test-Path -LiteralPath $key) -or -not(Test-Path -LiteralPath $cert)){throw 'Existing TLS files are missing. No certificate was generated or changed.'}
if(-not(Test-Path -LiteralPath $electron)){throw 'Existing Electron executable not found.'}
$names=@('NATURE_TOUCH_IPAD_BIND_ADDRESS','NATURE_TOUCH_IPAD_TLS_KEY_PATH','NATURE_TOUCH_IPAD_TLS_CERT_PATH','NATURE_TOUCH_IPAD_PASSWORD','NATURE_TOUCH_IPAD_PORT','ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL')
$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$secret=Read-Host 'LAN password (12+ characters; temporary, not saved)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 if($plain.Length -lt 12){throw 'Password must contain at least 12 characters.'}
 $env:NATURE_TOUCH_IPAD_BIND_ADDRESS=$BindAddress
 $env:NATURE_TOUCH_IPAD_TLS_KEY_PATH=$key
 $env:NATURE_TOUCH_IPAD_TLS_CERT_PATH=$cert
 $env:NATURE_TOUCH_IPAD_PASSWORD=$plain
 $env:NATURE_TOUCH_IPAD_PORT='8443'
 [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process')
 [Environment]::SetEnvironmentVariable('ELECTRON_RENDERER_URL',$null,'Process')
 Write-Output ('Mode: '+$Profile+'; URL: https://'+$BindAddress+':8443/ ; existing TLS only.')
 Push-Location (Join-Path $PSScriptRoot 'desktop')
 try{
  if($Profile -eq 'IsolatedMock'){
   $entry=Join-Path $PSScriptRoot 'tools/ipad-isolated-mock.cjs'
  }else{
   $entry=Join-Path $PSScriptRoot 'desktop/out-exhibition/main/main.js'
  }
  Import-Module (Join-Path $PSScriptRoot 'tools/nature-touch-launcher.psm1') -Force
  $run=Invoke-NatureTouchChildProcess -FilePath $electron -ArgumentList @('"'+$entry+'"') `
   -WorkingDirectory (Join-Path $PSScriptRoot 'desktop') `
   -LogDirectory (Join-Path $PSScriptRoot '.local/ipad-launch-logs')
  Write-Output ('Electron PID '+$run.ProcessId+' exited with code '+$run.ExitCode+'.')
  Write-Output ('stdout log: '+$run.StdoutPath)
  Write-Output ('stderr log: '+$run.StderrPath)
  if($run.ExitCode -ne 0){
   throw ('Electron exited with code '+$run.ExitCode+'. Full stdout/stderr diagnostics were saved above.')
  }
  Write-Output 'Electron closed normally.'
 }finally{Pop-Location}
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 $plain=$null
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
}
