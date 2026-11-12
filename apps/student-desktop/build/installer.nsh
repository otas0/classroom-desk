; Optional NSIS hooks. Prefer launching the app (first-run UI is in-app).
!include "LogicLib.nsh"

!macro customInstall
  DetailPrint "Classroom Desk installed. First-run config is inside the app."
!macroend

Function .onInstSuccess
  ; Silent / quiet installs: skip UI (MDM / scripted lab imaging).
  ${If} ${Silent}
    Return
  ${EndIf}

  ; Open the real client immediately so students land on in-app first-run setup
  ; (not a separate browser guide page).
  IfFileExists "$INSTDIR\Classroom Desk.exe" 0 try_alt
    Exec "$INSTDIR\Classroom Desk.exe"
    Goto done
  try_alt:
  IfFileExists "$INSTDIR\ClassroomDesk.exe" 0 done
    Exec "$INSTDIR\ClassroomDesk.exe"
  done:
FunctionEnd
