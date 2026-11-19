param([switch]$Execute,[switch]$ConfirmReadOnlyPassed)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
& node (Join-Path $PSScriptRoot 'verify.mjs')
if($LASTEXITCODE -ne 0){throw 'RC5 release verification failed; no application started.'}
if(-not $Execute){Write-Output 'DRY RUN: no application started; no serial access.';return}
if(-not $ConfirmReadOnlyPassed){
 $confirmation=Read-Host 'Has the matching RC5 IDENTIFY/STATUS read-only check passed? Type YES to continue'
 if($confirmation -cne 'YES'){throw 'RC5 read-only identity not confirmed; no application started.'}
}
& (Join-Path $projectRoot 'tools\rc5-valve\Owner-Launch-Main.ps1') -Release RC5 -BindAddress '192.168.137.1' -Execute -ConfirmReadOnlyPassed
