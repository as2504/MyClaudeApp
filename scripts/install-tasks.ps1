# Registers the Lorewood Task Scheduler tasks for the current user (no admin needed).
#   \Lorewood\Watchdog   - every 10 minutes: local checks only, no AI unless actionable work waits
#   \Lorewood\PM Trigger - on demand (started by hooks/server/watchdog): one batched headless PM run
#   \Lorewood\Server     - at logon: phone backend (the watchdog also restarts it if it stops)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$vbs  = Join-Path $repo 'scripts\run-hidden.vbs'
$lw   = Join-Path $repo 'bus\lw.js'
$srv  = Join-Path $repo 'server\server.js'
$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
function Act($script, $arg) { New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}" "{1}" "{2}" {3}' -f $vbs, $node, $script, $arg) -WorkingDirectory $repo }

# Watchdog: every 10 min, forever. Skip a run if the previous one is still going.
$s1 = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$t1 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskPath '\Lorewood\' -TaskName 'Watchdog' -Action (Act $lw 'watchdog') -Trigger $t1 -Settings $s1 -Principal $principal -Force | Out-Null

# PM trigger: no schedule, started on demand. One instance at a time (the script also locks).
$s2 = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 70) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskPath '\Lorewood\' -TaskName 'PM Trigger' -Action (Act $lw 'trigger') -Settings $s2 -Principal $principal -Force | Out-Null

# Server: at logon, runs indefinitely.
$s3 = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$t3 = New-ScheduledTaskTrigger -AtLogOn -User $user
Register-ScheduledTask -TaskPath '\Lorewood\' -TaskName 'Server' -Action (Act $srv '') -Trigger $t3 -Settings $s3 -Principal $principal -Force | Out-Null

Get-ScheduledTask -TaskPath '\Lorewood\' | Select-Object TaskName, State
