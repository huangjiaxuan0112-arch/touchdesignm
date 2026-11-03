param([switch]$Compile)
$ErrorActionPreference = 'Stop'
$candidateRoot = $PSScriptRoot
$sketch = Join-Path $candidateRoot 'nature_touch_unified'
$driver = Get-Content -LiteralPath (Join-Path $sketch 'real-actuators.h') -Raw
$required = @(
  'D5_MAPPING_VERIFIED', 'D6_MAPPING_VERIFIED', 'D7_MAPPING_VERIFIED',
  'D5_ROUTING_USER_REPORTED', 'POWER_CUTOFF_VERIFIED',
  'AIRBAG_DISCONNECTED_USER_CONFIRMED', 'OPEN_GAS_PATH_USER_CONFIRMED',
  'NO_PRESSURE_BUILDUP_USER_CONFIRMED', 'OPEN_AIR_BENCH_BUILD_REVIEWED'
)
if ($driver -notmatch 'OVERPRESSURE_PROTECTION_VERIFIED = false;' -or
    $driver -notmatch 'PHYSICAL_OUTPUTS_PERMITTED = false;') {
  throw 'Airbag protection and production permission locks must stay closed in this bench artifact.'
}
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
$toolchainLocal = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData/Local'
$cli = Join-Path $toolchainLocal 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe'
$libraries = Join-Path $toolchainLocal 'Arduino15/libraries'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Existing Arduino CLI not found; no installation attempted.' }
$build = Join-Path $candidateRoot ('build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $build | Out-Null
$dataPath = ConvertTo-Json -Compress (Join-Path $toolchainLocal 'Arduino15')
$userPath = ConvertTo-Json -Compress $build
$config = Join-Path $build 'arduino-cli.yaml'
Set-Content -LiteralPath $config -Encoding utf8 -Value "directories:`n  data: $dataPath`n  user: $userPath`n"
$arguments = @('--config-file', $config, 'compile', '--fqbn', 'arduino:avr:nano:cpu=atmega328',
  '--libraries', $libraries, '--build-path', $build,
  '--build-property', 'compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1 -DNATURE_TOUCH_OPEN_AIR_BENCH=1', $sketch)
& $cli @arguments 2>&1 | Tee-Object -FilePath (Join-Path $build 'compile.log')
if ($LASTEXITCODE -ne 0) { throw 'Real compilation failed; no release artifact approved.' }
$hex = Join-Path $build 'nature_touch_unified.ino.hex'
if (-not (Test-Path -LiteralPath $hex)) { throw 'Expected real HEX was not generated.' }
$record = [ordered]@{
  status = 'OPEN_AIR_BENCH_ONLY_COMPILED_NOT_UPLOAD_AUTHORIZED'
  fqbn = 'arduino:avr:nano:cpu=atmega328'
  selector = 'NATURE_TOUCH_ACTUATOR_DRIVER=1; NATURE_TOUCH_OPEN_AIR_BENCH=1'
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
