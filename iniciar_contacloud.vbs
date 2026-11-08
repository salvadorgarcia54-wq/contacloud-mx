Set WshShell = CreateObject("WScript.Shell")
' Verificar e iniciar Backend (8000) de forma silenciosa en segundo plano
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.open "GET", "http://127.0.0.1:8000/api/clients", False
http.send
If Err.Number <> 0 Or http.status >= 500 Then
    Err.Clear
    WshShell.CurrentDirectory = "C:\Users\MAQRFDCSVDR01\.gemini\antigravity\scratch\contacloud-mx\backend"
    WshShell.Run "C:\Users\MAQRFDCSVDR01\.gemini\antigravity\scratch\contacloud-mx\backend\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000", 0, False
End If

' Verificar e iniciar Frontend (5173) de forma silenciosa en segundo plano
http.open "GET", "http://127.0.0.1:5173", False
http.send
If Err.Number <> 0 Then
    Err.Clear
    WshShell.CurrentDirectory = "C:\Users\MAQRFDCSVDR01\.gemini\antigravity\scratch\contacloud-mx\frontend"
    WshShell.Run "cmd /c npm run dev -- --host 127.0.0.1 --port 5173", 0, False
    WScript.Sleep 3500
End If
On Error GoTo 0

' Abrir el navegador en ContaCloud MX
WshShell.Run "http://127.0.0.1:5173", 1, False
