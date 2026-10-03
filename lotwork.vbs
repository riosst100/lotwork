Set WshShell = CreateObject("WScript.Shell")
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """" & folder & "\node_modules\electron\dist\lotwork.exe"" """ & folder & """", 1, False
