function Resolve-OwnerCh340Port {
 [CmdletBinding()]
 param(
  [Parameter(Mandatory=$true)][AllowNull()][AllowEmptyCollection()][object[]]$Devices,
  [Parameter(Mandatory=$true)][ValidatePattern('^COM[0-9]+$')][string]$Port
 )
 $requested=$Port.ToUpperInvariant()
 $options=[Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [Text.RegularExpressions.RegexOptions]::CultureInvariant
 $candidates=@()
 foreach($device in @($Devices)){
  if($null -eq $device){continue}
  $nameProperty=$device.PSObject.Properties['Name']
  if($null -eq $nameProperty -or $nameProperty.Value -isnot [string]){continue}
  $name=$nameProperty.Value.Trim()
  $mentionsRequested=$false
  foreach($match in [regex]::Matches($name,'\((?<Port>COM[0-9]+)\)',$options)){
   if([string]::Equals($match.Groups['Port'].Value,$requested,[StringComparison]::OrdinalIgnoreCase)){$mentionsRequested=$true}
  }
  if($mentionsRequested){$candidates+=$device}
 }
 if($candidates.Count -eq 0){throw ('CH340 serial port missing: no PnP Name contains ('+$requested+'). Nothing uploaded.')}
 if($candidates.Count -ne 1){throw ('CH340 serial port ambiguous: multiple PnP entities claim ('+$requested+'). Nothing uploaded.')}
 $target=$candidates[0]
 $displayName=([string]$target.PSObject.Properties['Name'].Value).Trim()
 $nameMatch=[regex]::Match($displayName,'^USB-SERIAL CH340 \((?<Port>COM[0-9]+)\)$',$options)
 if(-not $nameMatch.Success -or -not [string]::Equals($nameMatch.Groups['Port'].Value,$requested,[StringComparison]::OrdinalIgnoreCase)){
  throw 'CH340 serial port name mismatch. Expected exactly USB-SERIAL CH340 (requested COM). Nothing uploaded.'
 }
 $idProperty=$target.PSObject.Properties['PNPDeviceID']
 if($null -eq $idProperty -or $idProperty.Value -isnot [string]){throw 'CH340 serial port VID/PID mismatch: missing PNPDeviceID.'}
 $pnpId=$idProperty.Value.Trim()
 # Exact USB VID/PID tokens, optional Windows revision/interface tokens, and a nonempty instance ID.
 if(-not [regex]::IsMatch($pnpId,'^USB\\VID_1A86&PID_7523(?:&(?:REV_[0-9A-F]{4}|MI_[0-9A-F]{2}))*\\[^\\\s]+$',$options)){
  throw 'CH340 serial port VID/PID mismatch. Nothing uploaded.'
 }
 $sameInstance=0
 foreach($device in @($Devices)){
  if($null -eq $device){continue}
  $id=$device.PSObject.Properties['PNPDeviceID']
  if($null -ne $id -and $id.Value -is [string] -and [string]::Equals($id.Value.Trim(),$pnpId,[StringComparison]::OrdinalIgnoreCase)){$sameInstance++}
 }
 if($sameInstance -ne 1){throw 'CH340 serial port ambiguous: duplicate PnP instance. Nothing uploaded.'}
 $present=$target.PSObject.Properties['Present']
 if($null -ne $present -and $null -ne $present.Value -and ($present.Value -isnot [bool] -or $present.Value -eq $false)){
  throw 'CH340 serial port is not present. Nothing uploaded.'
 }
 $problem=$target.PSObject.Properties['ConfigManagerErrorCode']
 if($null -ne $problem -and $null -ne $problem.Value -and $problem.Value -ne 0){
  throw 'CH340 serial port is not operational (device problem code). Nothing uploaded.'
 }
 $status=$target.PSObject.Properties['Status']
 if($null -ne $status -and $null -ne $status.Value -and -not [string]::IsNullOrWhiteSpace([string]$status.Value) -and $status.Value -ne 'OK'){
  throw 'CH340 serial port is not operational (PnP status). Nothing uploaded.'
 }
 [pscustomobject]@{Port=$requested;Name=$displayName;PNPDeviceID=$pnpId;DiscoveryClass='Win32_PnPEntity'}
}
Export-ModuleMember -Function Resolve-OwnerCh340Port
