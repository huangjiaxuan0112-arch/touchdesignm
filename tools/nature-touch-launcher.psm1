function Test-NatureTouchMainProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object]$ProcessInfo,
        [Parameter(Mandatory = $true)][string]$ElectronPath,
        [Parameter(Mandatory = $true)][string]$ProjectRoot
    )

    if (-not $ProcessInfo.ExecutablePath -or -not $ProcessInfo.CommandLine) { return $false }
    try {
        $sameExecutable = [IO.Path]::GetFullPath($ProcessInfo.ExecutablePath) -ieq [IO.Path]::GetFullPath($ElectronPath)
    } catch {
        return $false
    }
    $sameProject = $ProcessInfo.CommandLine.IndexOf($ProjectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $natureTouchEntry = $ProcessInfo.CommandLine -match '(?i)(out(-exhibition)?\\main\\main\.js|tools\\ipad-isolated-mock\.cjs)'
    return $sameExecutable -and $sameProject -and $natureTouchEntry
}

function Invoke-NatureTouchChildProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$LogDirectory
    )

    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $logId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $stdoutPath = Join-Path $LogDirectory ($logId + '.stdout.log')
    $stderrPath = Join-Path $LogDirectory ($logId + '.stderr.log')
    [System.IO.File]::WriteAllText($stdoutPath, '')
    [System.IO.File]::WriteAllText($stderrPath, '')

    try {
        $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
            -WorkingDirectory $WorkingDirectory -PassThru -Wait `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    } catch {
        throw "Failed to start Electron child process. stdout=$stdoutPath; stderr=$stderrPath; error=$($_.Exception.Message)"
    }

    [pscustomobject]@{
        ProcessId = $process.Id
        ExitCode = $process.ExitCode
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
    }
}

Export-ModuleMember -Function Test-NatureTouchMainProcess, Invoke-NatureTouchChildProcess
