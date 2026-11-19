param([string]$ProjectRoot)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){
 throw 'Tests require actual Windows PowerShell 5.1.'
}
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
$launcher=Join-Path $ProjectRoot 'START_IPAD_EXISTING_TLS.ps1'
$module=Join-Path $ProjectRoot 'tools/nature-touch-launcher.psm1'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('nature-touch-launcher-test-'+[Guid]::NewGuid().ToString('N'))
$results=New-Object 'System.Collections.Generic.List[object]'
function Assert-True([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Case([string]$Name,[scriptblock]$Action){
 try{& $Action;$results.Add([pscustomobject]@{name=$Name;result='PASS'})}
 catch{$results.Add([pscustomobject]@{name=$Name;result='FAIL';error=$_.Exception.Message})}
}
function New-FakeChild([string]$Name,[string]$ExitCode){
 $path=Join-Path $testRoot ($Name+'.cmd')
 $body="@echo off`r`necho fake stdout $Name`r`necho fake stderr $Name 1>&2`r`nexit /b $ExitCode`r`n"
 [IO.File]::WriteAllText($path,$body,[Text.Encoding]::ASCII)
 return $path
}
try{
 New-Item -ItemType Directory -Path $testRoot | Out-Null
 Import-Module $module -Force

 Case 'launcher parses in Windows PowerShell 5.1' {
  $tokens=$null;$errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($launcher,[ref]$tokens,[ref]$errors)|Out-Null
  Assert-True (@($errors).Count -eq 0) 'Launcher has PowerShell parse errors.'
 }
 Case 'launcher retains explicit Mock and Exhibition entry mapping and default' {
  $source=[IO.File]::ReadAllText($launcher)
  Assert-True ($source -match '\[string\]\$Profile=''IsolatedMock''') 'Expected default IsolatedMock profile.'
  Assert-True ($source.Contains('tools/ipad-isolated-mock.cjs')) 'IsolatedMock entry missing.'
  Assert-True ($source.Contains('desktop/out-exhibition/main/main.js')) 'Exhibition entry missing.'
 }
 Case 'existing Nature Touch listener is reported without launching a second instance' {
  $source=[IO.File]::ReadAllText($launcher)
  Assert-True ($source.Contains('Get-NetTCPConnection -State Listen -LocalPort 8443')) '8443 preflight missing.'
  Assert-True ($source.Contains('No second instance was started.') -and $source.Contains('if($sameElectron)')) 'Existing Main instance is not handled explicitly.'
   $root=$ProjectRoot.TrimEnd('\')
   $electron=Join-Path $root 'desktop/node_modules/electron/dist/electron.exe'
   $main=[pscustomobject]@{ExecutablePath=$electron;CommandLine=('"'+$electron+'" "'+(Join-Path $root 'desktop/out-exhibition/main/main.js')+'"')}
   Assert-True (Test-NatureTouchMainProcess -ProcessInfo $main -ElectronPath $electron -ProjectRoot $root) 'Exhibition Main was not recognized.'
   $mock=[pscustomobject]@{ExecutablePath=$electron;CommandLine=('"'+$electron+'" "'+(Join-Path $root 'tools/ipad-isolated-mock.cjs')+'"')}
   Assert-True (Test-NatureTouchMainProcess -ProcessInfo $mock -ElectronPath $electron -ProjectRoot $root) 'Isolated Mock Main was not recognized.'
   $other=[pscustomobject]@{ExecutablePath=$electron;CommandLine=('"'+$electron+'" C:\other-project\main.js')}
   Assert-True (-not (Test-NatureTouchMainProcess -ProcessInfo $other -ElectronPath $electron -ProjectRoot $root)) 'Unrelated Electron process was treated as this app.'
 }
 Case 'normal child exit saves stdout and stderr and returns success' {
  $fake=New-FakeChild 'normal' '0'
  $run=Invoke-NatureTouchChildProcess -FilePath $env:ComSpec `
   -ArgumentList @('/d','/c',('"'+$fake+'"')) -WorkingDirectory $testRoot `
   -LogDirectory (Join-Path $testRoot 'logs-normal')
  Assert-True ($run.ExitCode -eq 0) 'Normal child exit code was not preserved.'
  Assert-True ([IO.File]::ReadAllText($run.StdoutPath).Contains('fake stdout normal')) 'stdout was not captured.'
  Assert-True ([IO.File]::ReadAllText($run.StderrPath).Contains('fake stderr normal')) 'stderr was not captured.'
 }
 Case 'nonzero child exit preserves exact code and both diagnostic streams' {
  $fake=New-FakeChild 'failure' '7'
  $run=Invoke-NatureTouchChildProcess -FilePath $env:ComSpec `
   -ArgumentList @('/d','/c',('"'+$fake+'"')) -WorkingDirectory $testRoot `
   -LogDirectory (Join-Path $testRoot 'logs-failure')
  Assert-True ($run.ExitCode -eq 7) 'Nonzero child exit code was not preserved.'
  Assert-True ([IO.File]::ReadAllText($run.StdoutPath).Contains('fake stdout failure')) 'Failure stdout was not captured.'
  Assert-True ([IO.File]::ReadAllText($run.StderrPath).Contains('fake stderr failure')) 'Failure stderr was not captured.'
 }
 Case 'failed process launch reports both created diagnostic paths' {
  $caught=$null
  try{
   Invoke-NatureTouchChildProcess -FilePath (Join-Path $testRoot 'missing-electron.exe') `
    -ArgumentList @('unused') -WorkingDirectory $testRoot -LogDirectory (Join-Path $testRoot 'logs-launch-failure')|Out-Null
  }catch{$caught=$_.Exception.Message}
  Assert-True ($caught -match 'stdout=.*\.stdout\.log; stderr=.*\.stderr\.log; error=') 'Process launch failure omitted diagnostic locations.'
 }
}finally{
 Remove-Module nature-touch-launcher -ErrorAction SilentlyContinue
 if(Test-Path $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force}
}
$failed=@($results|Where-Object{$_.result -eq 'FAIL'}).Count
$results|ForEach-Object{Write-Output ($_.result+' '+$_.name+$(if($_.error){': '+$_.error}else{''}))}
Write-Output ('Launcher offline tests: '+($results.Count-$failed)+'/'+$results.Count+' PASS; failed='+$failed)
if($failed){exit 1}
