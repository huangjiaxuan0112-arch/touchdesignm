param(
 [Parameter(Mandatory=$true)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$BindAddress,
 [switch]$SoftwareOnly
)
$ErrorActionPreference='Stop'
$local=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -eq $BindAddress}
if(-not $local){throw 'BindAddress must be an assigned local private IPv4 address.'}
if($BindAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'){throw 'Only private LAN addresses are allowed.'}
$openssl=Join-Path $env:ProgramFiles 'Git/usr/bin/openssl.exe'
if(-not(Test-Path -LiteralPath $openssl)){throw 'Existing Git OpenSSL not found. Supply reviewed TLS files using README environment configuration; no dependency installation attempted.'}
$work=Join-Path $PSScriptRoot '.local/ipad-lan'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$key=Join-Path $work ('key-'+$BindAddress+'.pem')
$cert=Join-Path $work ('cert-'+$BindAddress+'.pem')
$public=Join-Path $work ('cert-'+$BindAddress+'.cer')
if(-not(Test-Path -LiteralPath $key) -and -not(Test-Path -LiteralPath $cert)){
 & $openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes -keyout $key -out $cert -subj ('/CN=Nature Touch '+$BindAddress) -addext ('subjectAltName=IP:'+$BindAddress)
 if($LASTEXITCODE -ne 0){throw 'TLS generation failed.'}
 $who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
 & icacls.exe $key /inheritance:r /grant:r ($who+':F') | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Private key ACL setup failed.'}
}
if(-not(Test-Path -LiteralPath $key) -or -not(Test-Path -LiteralPath $cert)){throw 'Incomplete TLS files; no files overwritten.'}
& $openssl x509 -in $cert -outform DER -out $public
if($LASTEXITCODE -ne 0){throw 'Public certificate export failed.'}
Write-Output ('Install and explicitly trust ONLY this public certificate on the onsite iPad: '+$public)
Write-Output ('Certificate SHA256: '+(Get-FileHash -LiteralPath $public -Algorithm SHA256).Hash)
$secret=Read-Host 'Exhibition LAN password (12+ characters; not stored)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 if($plain.Length -lt 12){throw 'Password must contain at least 12 characters.'}
 $env:NATURE_TOUCH_IPAD_BIND_ADDRESS=$BindAddress
 $env:NATURE_TOUCH_IPAD_TLS_KEY_PATH=$key
 $env:NATURE_TOUCH_IPAD_TLS_CERT_PATH=$cert
 $env:NATURE_TOUCH_IPAD_PASSWORD=$plain
 Write-Output ('Onsite iPad URL: https://'+$BindAddress+':8443/ ; same private LAN required.')
 Push-Location (Join-Path $PSScriptRoot 'desktop')
 try{
  if($SoftwareOnly){
   Write-Output 'Mode: MOCK software-only. No real device connection is required.'
   & npm.cmd run preview -- --skipBuild
  }else{
   Write-Output 'Mode: EXHIBITION. Real device readiness is required; this is not Mock.'
   & npm.cmd run preview:exhibition
  }
 }finally{Pop-Location}
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 Remove-Item Env:NATURE_TOUCH_IPAD_PASSWORD -ErrorAction SilentlyContinue
 $plain=$null
}
