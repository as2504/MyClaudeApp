' Runs a command with no visible console window (used by Task Scheduler).
' Usage: wscript.exe run-hidden.vbs <program> [args...]
Dim sh, i, cmd
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & """" & WScript.Arguments(i) & """ "
Next
sh.Run cmd, 0, True
