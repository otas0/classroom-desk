; Optional NSIS hooks. FIRST_RUN_GUIDE.html is shipped via electron-builder extraResources.
!include "LogicLib.nsh"

!macro customInstall
  DetailPrint "Classroom Desk installed. Configure apiBase via QR or resources\\config.json."
!macroend

Function .onInstSuccess
  ; Silent / quiet installs: skip UI guide and prompts (MDM / scripted lab imaging).
  ${If} ${Silent}
    Return
  ${EndIf}

  ; Open first-run guide card (extraResources → $INSTDIR\resources\)
  IfFileExists "$INSTDIR\resources\FIRST_RUN_GUIDE.html" 0 skip_guide
    ExecShell "open" "$INSTDIR\resources\FIRST_RUN_GUIDE.html"
  skip_guide:

  MessageBox MB_ICONQUESTION|MB_YESNO "安装完成。$\r$\n$\r$\n已尝试打开《首次引导》说明卡（含 SmartScreen 说明链接）。$\r$\n$\r$\n是否立即打开 Classroom Desk？" IDYES open_app IDNO done
  open_app:
    ; electron-builder product executable name
    IfFileExists "$INSTDIR\Classroom Desk.exe" 0 try_alt
      Exec "$INSTDIR\Classroom Desk.exe"
      Goto done
    try_alt:
    IfFileExists "$INSTDIR\ClassroomDesk.exe" 0 done
      Exec "$INSTDIR\ClassroomDesk.exe"
  done:
FunctionEnd
