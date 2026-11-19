param([string]$ProjectRoot,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Actual Windows PowerShell 5.1 is required.'}
$module=Join-Path $ProjectRoot 'tools/owner-ch340-discovery.psm1'
$entry=Join-Path $ProjectRoot 'tools/OWNER_UPLOAD_ONLY_PS51.ps1'
Import-Module -Name $module -Force
$results=New-Object 'System.Collections.Generic.List[object]'
function Assert-True([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Expect-Error([scriptblock]$Action,[string]$Pattern){
 $caught=$false
 try{& $Action|Out-Null}catch{$caught=$true;if($_.Exception.Message -notmatch $Pattern){throw ('Unexpected rejection: '+$_.Exception.Message)}}
 if(-not $caught){throw 'Expected rejection was missing.'}
}
function Case([string]$Name,[scriptblock]$Action){
 try{& $Action;$results.Add([pscustomobject]@{name=$Name;result='PASS'})}
 catch{$results.Add([pscustomobject]@{name=$Name;result='FAIL';error=$_.Exception.Message})}
}
function Device([string]$Port='COM5',[string]$Instance='5&TEST&0&9'){
 return [pscustomobject]@{Name=('USB-SERIAL CH340 ('+$Port+')');PNPDeviceID=('USB\VID_1A86&PID_7523\'+$Instance);Present=$true;ConfigManagerErrorCode=0;Status='OK'}
}
function Resolve($Devices,[string]$Port='COM5'){Resolve-OwnerCh340Port -Devices $Devices -Port $Port}
$global:MockPnPRows=@()
$global:MockQueries=@()
function global:Get-CimInstance {
 param([string]$ClassName)
 $global:MockQueries+=$ClassName
 if($ClassName -eq 'Win32_PnPEntity'){return $global:MockPnPRows}
 if($ClassName -eq 'Win32_SerialPort'){return @([pscustomobject]@{DeviceID='COM3';PNPDeviceID='BTHENUM'},[pscustomobject]@{DeviceID='COM4';PNPDeviceID='BTHENUM'})}
 throw 'Real CIM is forbidden.'
}
Case 'module and entry parse in Windows PowerShell 5.1' {
 foreach($file in @($module,$entry)){
  $tokens=$null;$errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null
  Assert-True (@($errors).Count -eq 0) 'PS51 parser errors.'
 }
}
Case 'module and entry keep BOM with ASCII-only body' {
 foreach($file in @($module,$entry)){
  $b=[IO.File]::ReadAllBytes($file)
  Assert-True ($b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191) 'Missing UTF8 BOM.'
  Assert-True (@($b[3..($b.Length-1)]|Where-Object{$_ -gt 127}).Count -eq 0) 'Unexpected non-ASCII body.'
 }
}
Case 'confirmed CH340 PnP COM5 accepted without consulting Win32_SerialPort' {
 $d=Device;$r=Resolve @($d)
 Assert-True ($r.Port -eq 'COM5' -and $r.PNPDeviceID -eq $d.PNPDeviceID -and $r.DiscoveryClass -eq 'Win32_PnPEntity') 'Wrong selected entity.'
}
Case 'production discovery expression handles Bluetooth-only SerialPort and valid PnP CH340' {
 $tokens=$null;$errors=$null
 $ast=[System.Management.Automation.Language.Parser]::ParseFile($entry,[ref]$tokens,[ref]$errors)
 $assignment=$ast.Find({param($a)$a -is [System.Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -eq '$portInfo'},$true)
 Assert-True ($null -ne $assignment) 'Discovery assignment not found.'
 foreach($command in $assignment.Right.FindAll({param($a)$a -is [System.Management.Automation.Language.CommandAst]},$true)){
  Assert-True ($command.GetCommandName() -in @('Resolve-OwnerCh340Port','Get-CimInstance')) 'Unexpected executable discovery expression.'
 }
 $global:MockPnPRows=@([pscustomobject]@{Name='Bluetooth (COM3)';PNPDeviceID='BTHENUM\TEST'},[pscustomobject]@{Name='Bluetooth (COM4)';PNPDeviceID='BTHENUM\TEST2'},(Device))
 $global:MockQueries=@()
 $Port='COM5'
 $r=& ([scriptblock]::Create($assignment.Right.Extent.Text))
 Assert-True ($r.Port -eq 'COM5') 'COM5 not resolved.'
 Assert-True (($global:MockQueries -join ',') -eq 'Win32_PnPEntity') 'Wrong CIM class queried.'
}
Case 'requested COM name is case-insensitive but exact' {$r=Resolve @((Device)) 'com5';Assert-True ($r.Port -ceq 'COM5') 'Port normalization failed.'}
Case 'COM50 does not impersonate COM5' {Expect-Error {Resolve @((Device 'COM50'))} 'missing'}
Case 'COM05 does not alias COM5' {Expect-Error {Resolve @((Device 'COM05'))} 'missing'}
Case 'missing port rejected' {Expect-Error {Resolve @((Device 'COM6'))} 'missing'}
Case 'empty results rejected' {Expect-Error {Resolve @()} 'missing'}
Case 'name missing does not fall back to Caption or DeviceID' {$d=[pscustomobject]@{Caption='USB-SERIAL CH340 (COM5)';DeviceID='COM5';PNPDeviceID='USB\VID_1A86&PID_7523\TEST'};Expect-Error {Resolve @($d)} 'missing'}
Case 'name suffix and embedded multiple COM names rejected' {$d=Device;$d.Name='USB-SERIAL CH340 (COM5) (COM6)';Expect-Error {Resolve @($d)} 'name mismatch'}
Case 'similar product name rejected even with correct VID/PID' {$d=Device;$d.Name='Other CH340 (COM5)';Expect-Error {Resolve @($d)} 'name mismatch'}
Case 'wrong VID rejected' {$d=Device;$d.PNPDeviceID='USB\VID_0000&PID_7523\TEST';Expect-Error {Resolve @($d)} 'VID/PID mismatch'}
Case 'wrong PID rejected' {$d=Device;$d.PNPDeviceID='USB\VID_1A86&PID_0000\TEST';Expect-Error {Resolve @($d)} 'VID/PID mismatch'}
Case 'PID prefix collision rejected' {$d=Device;$d.PNPDeviceID='USB\VID_1A86&PID_75230\TEST';Expect-Error {Resolve @($d)} 'VID/PID mismatch'}
Case 'VID prefix collision rejected' {$d=Device;$d.PNPDeviceID='USB\VID_1A860&PID_7523\TEST';Expect-Error {Resolve @($d)} 'VID/PID mismatch'}
Case 'missing PNPDeviceID rejected' {$d=[pscustomobject]@{Name='USB-SERIAL CH340 (COM5)'};Expect-Error {Resolve @($d)} 'VID/PID mismatch'}
Case 'non-USB instance and missing instance rejected' {foreach($id in @('BTHENUM\VID_1A86&PID_7523\TEST','USB\VID_1A86&PID_7523','USB\VID_1A86&PID_7523\')){$d=Device;$d.PNPDeviceID=$id;Expect-Error {Resolve @($d)} 'VID/PID mismatch'}}
Case 'Windows revision and interface tokens retain exact vendor/product match' {$d=Device;$d.PNPDeviceID='USB\VID_1A86&PID_7523&REV_0264&MI_00\TEST';$r=Resolve @($d);Assert-True ($r.Port -eq 'COM5') 'Revision/interface variant rejected.'}
Case 'case-insensitive PNP ID accepted' {$d=Device;$d.PNPDeviceID='usb\vid_1a86&pid_7523\test';$r=Resolve @($d);Assert-True ($r.Port -eq 'COM5') 'PNP case handling failed.'}
Case 'duplicate matching COM5 rows rejected, even identical' {$d=Device;Expect-Error {Resolve @($d,$d)} 'ambiguous'}
Case 'different CH340 instances claiming COM5 rejected' {Expect-Error {Resolve @((Device 'COM5' 'ONE'),(Device 'COM5' 'TWO'))} 'ambiguous'}
Case 'non-CH340 entity also claiming COM5 makes results ambiguous' {$other=[pscustomobject]@{Name='Bluetooth (COM5)';PNPDeviceID='BTHENUM\TEST'};Expect-Error {Resolve @((Device),$other)} 'ambiguous'}
Case 'same PNP instance claiming a different port rejected' {Expect-Error {Resolve @((Device 'COM5'),(Device 'COM6'))} 'ambiguous'}
Case 'different CH340 on another port does not replace requested device' {$r=Resolve @((Device 'COM6' 'OTHER'),(Device 'COM5' 'TARGET'));Assert-True ($r.PNPDeviceID -like '*\TARGET') 'Wrong CH340 selected.'}
Case 'explicitly non-present entity rejected' {$d=Device;$d.Present=$false;Expect-Error {Resolve @($d)} 'not present'}
Case 'PnP problem code rejected' {$d=Device;$d.ConfigManagerErrorCode=22;Expect-Error {Resolve @($d)} 'not operational'}
Case 'PnP non-OK status rejected' {$d=Device;$d.Status='Error';Expect-Error {Resolve @($d)} 'not operational'}
Case 'optional PnP status fields may be absent without guessing identity' {$d=[pscustomobject]@{Name='USB-SERIAL CH340 (COM5)';PNPDeviceID='USB\VID_1A86&PID_7523\TEST'};$r=Resolve @($d);Assert-True ($r.Port -eq 'COM5') 'Optional status fields incorrectly required.'}
$failed=@($results|Where-Object{$_.result -eq 'FAIL'}).Count
$result=[ordered]@{psVersion=$PSVersionTable.PSVersion.ToString();passed=$results.Count-$failed;failed=$failed;total=$results.Count;realCimQueries=$false;realComAccess=$false;uploaderExecuted=$false;results=$results}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'pnp-offline-results.json'),($result|ConvertTo-Json -Depth 7),(New-Object Text.UTF8Encoding($true)))
$results|ForEach-Object{Write-Output ($_.result+' '+$_.name+$(if($_.error){': '+$_.error}else{''}))}
Write-Output ('PnP offline tests: '+$result.passed+'/'+$result.total+' PASS; failed='+$failed)
if($failed){exit 1}
