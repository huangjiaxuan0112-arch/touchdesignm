param([string]$ProjectRoot,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Tests require actual Windows PowerShell 5.1.'}
$fixed=Join-Path $ProjectRoot 'tools/OWNER_UPLOAD_ONLY_PS51.ps1'
$releaseName='nature_touch_v3_real_rc1_20261104T123816Z'
$release=Join-Path $ProjectRoot ('firmware/releases/'+$releaseName)
$results=New-Object 'System.Collections.Generic.List[object]'
$global:MockCimCalls=0
$global:MockCimCase='FORBID'
function global:Get-CimInstance {
 param([string]$ClassName)
 $global:MockCimCalls++
 if($ClassName -ne 'Win32_PnPEntity'){throw 'Unexpected CIM class.'}
 if($global:MockCimCase -eq 'WRONG_VENDOR'){return [pscustomobject]@{Name='USB-SERIAL CH340 (COM5)';PNPDeviceID='USB\VID_0000&PID_0000\TEST'}}
 if($global:MockCimCase -eq 'WRONG_PORT'){return [pscustomobject]@{Name='USB-SERIAL CH340 (COM6)';PNPDeviceID='USB\VID_1A86&PID_7523\TEST'}}
 throw 'FORBIDDEN_NATIVE_SERIAL_DISCOVERY'
}
function Assert-True([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Expect-Error([scriptblock]$Action,[string]$Pattern){
 $caught=$false
 try{& $Action|Out-Null}catch{$caught=$true;if($_.Exception.Message -notmatch $Pattern){throw ('Wrong rejection: '+$_.Exception.Message)}}
 if(-not $caught){throw 'Expected rejection was missing.'}
}
function Case([string]$Name,[scriptblock]$Action){
 $global:MockCimCalls=0;$global:MockCimCase='FORBID'
 try{& $Action;$results.Add([pscustomobject]@{name=$Name;result='PASS';mockCimCalls=$global:MockCimCalls})}
 catch{$results.Add([pscustomobject]@{name=$Name;result='FAIL';error=$_.Exception.Message;mockCimCalls=$global:MockCimCalls})}
}
function Fixture([string]$Name){
 $root=Join-Path $OutputDirectory ('fixtures/'+$Name)
 $target=Join-Path $root ('firmware/releases/'+$releaseName)
 New-Item -ItemType Directory -Path (Join-Path $root 'tools'),(Join-Path $target 'real') -Force|Out-Null
 Copy-Item -LiteralPath $fixed -Destination (Join-Path $root 'tools/OWNER_UPLOAD_ONLY_PS51.ps1')
 Copy-Item -LiteralPath (Join-Path $release 'build-manifest.json') -Destination (Join-Path $target 'build-manifest.json')
 Copy-Item -LiteralPath (Join-Path $release 'real/nature_touch_unified.ino.hex') -Destination (Join-Path $target 'real/nature_touch_unified.ino.hex')
 return [pscustomobject]@{root=$root;script=(Join-Path $root 'tools/OWNER_UPLOAD_ONLY_PS51.ps1');manifest=(Join-Path $target 'build-manifest.json');hex=(Join-Path $target 'real/nature_touch_unified.ino.hex')}
}
function Mutate-Manifest($Fixture,[scriptblock]$Action){
 $value=[IO.File]::ReadAllText($Fixture.manifest,[Text.Encoding]::UTF8)|ConvertFrom-Json
 & $Action $value
 [IO.File]::WriteAllText($Fixture.manifest,($value|ConvertTo-Json -Depth 100),[Text.Encoding]::UTF8)
}
Case 'fixed source is UTF8 BOM plus ASCII body' {
 $bytes=[IO.File]::ReadAllBytes($fixed)
 Assert-True ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) 'BOM missing.'
 Assert-True (@($bytes[3..($bytes.Length-1)]|Where-Object{$_ -gt 127}).Count -eq 0) 'Non-ASCII script body.'
}
Case 'PS51 file parser accepts fixed entry' {
 $tokens=$null;$errors=$null
 [System.Management.Automation.Language.Parser]::ParseFile($fixed,[ref]$tokens,[ref]$errors)|Out-Null
 Assert-True (@($errors).Count -eq 0) 'Parser errors.'
}
Case 'offline real manifest and SHA checks never discover COM' {
 $r=(& $fixed -Port COM5 -Cpu atmega328old -OfflineCheck)|ConvertFrom-Json
 Assert-True ($r.result -eq 'PASS' -and $r.uploaded -eq $false -and $r.comAccessed -eq $false) 'Wrong offline result.'
 Assert-True ($global:MockCimCalls -eq 0) 'Offline accessed CIM.'
 Assert-True ($r.hexSha256 -eq 'efffe83ee7255a8f0206febe50ac5b9d66f377b524cdf7efa140b01484ebb71d') 'Wrong HEX.'
 Assert-True ($r.uploadArguments[2] -eq 'arduino:avr:nano:cpu=atmega328old' -and $r.uploadArguments[4] -eq 'COM5' -and $r.uploadArguments[-1] -eq '--verify') 'Upload args changed.'
 Assert-True ($r.uploadArguments[0] -eq 'upload' -and $r.uploadArguments[1] -eq '--fqbn' -and $r.uploadArguments[3] -eq '--port' -and $r.uploadArguments[5] -eq '--input-file') 'Upload flags changed.'
}
Case 'new bootloader args also preserved with OfflineCheck even when confirmations supplied' {
 $r=(& $fixed -Port COM5 -Cpu atmega328 -ConfirmLoadsIsolated -ConfirmTargetNano -OfflineCheck)|ConvertFrom-Json
 Assert-True ($r.uploadArguments[2] -eq 'arduino:avr:nano:cpu=atmega328') 'CPU mapping changed.'
 Assert-True ($global:MockCimCalls -eq 0 -and $r.uploaded -eq $false) 'Offline fell through.'
}
Case 'missing isolation confirmation blocks before COM' {Expect-Error {& $fixed -Port COM5 -Cpu atmega328 -ConfirmTargetNano} 'physical load-power';Assert-True ($global:MockCimCalls -eq 0) 'COM used.'}
Case 'missing target confirmation blocks before COM' {Expect-Error {& $fixed -Port COM5 -Cpu atmega328 -ConfirmLoadsIsolated} 'physical load-power';Assert-True ($global:MockCimCalls -eq 0) 'COM used.'}
Case 'invalid port argument rejected' {Expect-Error {& $fixed -Port 'COM5;bad' -Cpu atmega328 -OfflineCheck} 'validate|validation|Port';Assert-True ($global:MockCimCalls -eq 0) 'COM used.'}
Case 'unknown bootloader rejected without guessing' {Expect-Error {& $fixed -Port COM5 -Cpu auto -OfflineCheck} 'validate|validation|Cpu';Assert-True ($global:MockCimCalls -eq 0) 'COM used.'}
Case 'wrong firmware version rejected' {$f=Fixture 'wrong-version';Mutate-Manifest $f {param($m)$m.firmwareVersion='old'};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'identity mismatch'}
Case 'simulation selector rejected' {$f=Fixture 'wrong-selector';Mutate-Manifest $f {param($m)$m.selector=0};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'identity mismatch'}
Case 'disabled output capability rejected' {$f=Fixture 'disabled-outputs';Mutate-Manifest $f {param($m)$m.hardwareOutputsEnabled=$false};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'identity mismatch'}
Case 'string output capability cannot impersonate boolean permission' {$f=Fixture 'string-outputs';Mutate-Manifest $f {param($m)$m.hardwareOutputsEnabled='true'};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'identity mismatch'}
Case 'wrong timeline rejected' {$f=Fixture 'wrong-timeline';Mutate-Manifest $f {param($m)$m.timelineVersion='wrong'};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'timeline/source'}
Case 'wrong source baseline rejected' {$f=Fixture 'wrong-source';Mutate-Manifest $f {param($m)$m.sourceRevision='wrong'};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'timeline/source'}
Case 'manifest SHA mismatch rejected' {$f=Fixture 'wrong-sha';Mutate-Manifest $f {param($m)$m.real.hexSha256='0000'};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'SHA-256 mismatch'}
Case 'tampered copied HEX rejected' {$f=Fixture 'tampered-hex';[IO.File]::AppendAllText($f.hex,'tampered');Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'SHA-256 mismatch'}
Case 'tampered copied HEX plus changed manifest SHA still rejected by pinned release SHA' {$f=Fixture 'tampered-both';[IO.File]::AppendAllText($f.hex,'tampered');$script:changedSha=(Get-FileHash -LiteralPath $f.hex -Algorithm SHA256).Hash.ToLowerInvariant();Mutate-Manifest $f {param($m)$m.real.hexSha256=$script:changedSha};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'SHA-256 mismatch'}
Case 'unexpected HEX path rejected' {$f=Fixture 'wrong-path';Mutate-Manifest $f {param($m)$m.real.hex='../simulation/nature_touch_unified.ino.hex'};Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'HEX path'}
Case 'missing manifest rejected' {$f=Fixture 'missing-manifest';Move-Item -LiteralPath $f.manifest -Destination ($f.manifest+'.test-hidden');Expect-Error {& $f.script -Port COM5 -Cpu atmega328 -OfflineCheck} 'manifest not found'}
Case 'mocked non-CH340 device refused before uploader' {$global:MockCimCase='WRONG_VENDOR';Expect-Error {& $fixed -Port COM5 -Cpu atmega328 -ConfirmLoadsIsolated -ConfirmTargetNano} 'CH340 serial port';Assert-True ($global:MockCimCalls -eq 1) 'Mock CIM was not used.'}
Case 'mocked different COM port refused before uploader' {$global:MockCimCase='WRONG_PORT';Expect-Error {& $fixed -Port COM5 -Cpu atmega328 -ConfirmLoadsIsolated -ConfirmTargetNano} 'CH340 serial port';Assert-True ($global:MockCimCalls -eq 1) 'Mock CIM was not used.'}
Case 'PS51 native exit code capture does not reuse stale success' {
 $global:LASTEXITCODE=$null
 & $env:ComSpec /d /c 'exit 7'
 Assert-True ($global:LASTEXITCODE -eq 7) 'Native failure exit code lost.'
 $global:LASTEXITCODE=$null
 & $env:ComSpec /d /c 'exit 0'
 Assert-True ($global:LASTEXITCODE -eq 0) 'Native success exit code lost.'
}
Case 'existing TLS launcher also parses in PS51' {
 $tokens=$null;$errors=$null
 [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectRoot 'START_IPAD_EXISTING_TLS.ps1'),[ref]$tokens,[ref]$errors)|Out-Null
 Assert-True (@($errors).Count -eq 0) 'Existing TLS launcher parse errors.'
}
$failed=@($results|Where-Object{$_.result -eq 'FAIL'}).Count
$result=[ordered]@{psVersion=$PSVersionTable.PSVersion.ToString();passed=$results.Count-$failed;failed=$failed;total=$results.Count;realComAccess=$false;uploaderExecuted=$false;firmwareUploaded=$false;results=$results}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'ps51-offline-results.json'),($result|ConvertTo-Json -Depth 7),(New-Object Text.UTF8Encoding($true)))
$results|ForEach-Object{Write-Output ($_.result+' '+$_.name+$(if($_.error){': '+$_.error}else{''}))}
Write-Output ('PS51 offline tests: '+$result.passed+'/'+$result.total+' PASS; failed='+$failed)
if($failed){exit 1}
