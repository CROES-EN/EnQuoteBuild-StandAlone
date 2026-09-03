' Launches a command completely hidden - no console window flash, no taskbar entry.
'
' Used by the ngrok-tunnel / webhook-receiver / sync-watchdog Scheduled Tasks INSTEAD of
' PowerShell's own "-WindowStyle Hidden" flag. That flag is a well-documented, long-standing
' unreliable mechanism when a task is launched by Task Scheduler - it frequently still shows
' a visible console window (this is exactly what happened: webhook-receiver.cjs's console
' was popping up despite "-WindowStyle Hidden" being set on the task action).
'
' WScript.Shell.Run's window-style parameter (0 = SW_HIDE) is a much more dependable,
' Win32-level way to suppress a console window, because wscript.exe itself has no console
' of its own to leak from.
'
' Usage: wscript.exe run-hidden.vbs "<program>" "<arg1>" "<arg2>" ...
' Every argument is individually quoted and joined into the single command-line string
' WScript.Shell.Run expects.

Set objShell = CreateObject("WScript.Shell")

Dim cmd
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
    If i > 0 Then cmd = cmd & " "
    cmd = cmd & """" & WScript.Arguments(i) & """"
Next

' Window style 0 = hidden. "False" = don't wait for it to exit - the launched process
' (ngrok/node/the watchdog's powershell.exe) keeps running independently; Task Scheduler's
' own "task is running" tracking isn't what this project relies on for crash-recovery
' anyway (see sync-watchdog.ps1, which polls for the real process directly).
objShell.Run cmd, 0, False
