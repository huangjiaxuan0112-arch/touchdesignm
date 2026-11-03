param([switch]$Compile)
$ErrorActionPreference = 'Stop'
$candidateRoot = $PSScriptRoot
$sketch = Join-Path $candidateRoot 'nature_touch_unified'
$driver = Get-Content -LiteralPath (Join-Path $sketch 'real-actuators.h') -Raw
$required = @(
  'D5_MAPPING_VERIFIED', 'D6_MAPPING_VERIFIED', 'D7_MAPPING_VERIFIED',
  'D5_ROUTING_USER_REPORTED', 'POWER_CUTOFF_VERIFIED',
  'OVERPRESSURE_PROTECTION_VERIFIED', 'STOP_VALVE_VERIFIED',
  'STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED',
  'PUMP_OFF_SETTLE_VERIFIED', 'VALVE_SETTLE_VERIFIED',
  'PHYSICAL_OUTPUTS_PERMITTED', 'D5_D6_OUTPUTS_PERMITTED', 'D7_ACTIVATION_REVIEWED'
)
$blocked = @($required | Where-Object {
  $driver -notmatch ('static constexpr bool\s+' + [regex]::Escape($_) + '\s*=\s*true\s*;')
})
if ($blocked.Count) {
  Write-Output ('BLOCKED: real-actuators.h fields: ' + ($blocked -join ', '))
  Write-Output 'No compiler, upload, COM connection or START was executed. Do not set fields true without the corresponding evidence and review.'
  exit 2
}
if (-not $Compile) {
  Write-Output 'Source review gates are true. Use -Compile only after physical prerequisites and release review are satisfied. This script never uploads.'
  exit 0
}
$cli = Join-Path $env:LOCALAPPDATA 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe'
$libraries = Join-Path $env:LOCALAPPDATA 'Arduino15/libraries'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Existing Arduino CLI not found; no installation attempted.' }
$build = Join-Path $candidateRoot ('build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $build | Out-Null
$dataPath = ConvertTo-Json -Compress (Join-Path $env:LOCALAPPDATA 'Arduino15')
$userPath = ConvertTo-Json -Compress $build
$config = Join-Path $build 'arduino-cli.yaml'
Set-Content -LiteralPath $config -Encoding utf8 -Value "directories:`n  data: $dataPath`n  user: $userPath`n"
$arguments = @('--config-file', $config, 'compile', '--fqbn', 'arduino:avr:nano:cpu=atmega328',
  '--libraries', $libraries, '--build-path', $build,
  '--build-property', 'compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1', $sketch)
& $cli @arguments 2>&1 | Tee-Object -FilePath (Join-Path $build 'compile.log')
if ($LASTEXITCODE -ne 0) { throw 'Real compilation failed; no release artifact approved.' }
$hex = Join-Path $build 'nature_touch_unified.ino.hex'
if (-not (Test-Path -LiteralPath $hex)) { throw 'Expected real HEX was not generated.' }
$record = [ordered]@{
  status = 'COMPILED_NOT_UPLOAD_AUTHORIZED'
  fqbn = 'arduino:avr:nano:cpu=atmega328'
  selector = 'NATURE_TOUCH_ACTUATOR_DRIVER=1'
  hexPath = $hex
  hexSha256 = (Get-FileHash -LiteralPath $hex -Algorithm SHA256).Hash.ToLowerInvariant()
  flashAndSramUsage = @(Get-Content -LiteralPath (Join-Path $build 'compile.log') | Where-Object { $_ -match 'Sketch uses|Global variables use' })
  sourceSha256 = @(Get-ChildItem -LiteralPath $sketch -File | Where-Object { $_.Extension -in '.ino', '.h' } | ForEach-Object {
    @{ file = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  uploaded = $false
}
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $build 'real-artifact.json') -Encoding utf8
Write-Output ('Real HEX compiled and hashed: ' + $hex + '. Upload and first START require separate explicit authorization.')
