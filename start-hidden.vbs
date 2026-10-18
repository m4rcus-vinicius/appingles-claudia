Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""c:\Users\PC\Desktop\Nova pasta\Projetos\AppIngles\start-background.ps1""", 0, False
Set WshShell = Nothing
