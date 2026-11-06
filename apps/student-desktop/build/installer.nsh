; Optional NSIS hooks. Server URL is configured via resources/config.json
; and can be changed after install by admin in the student app ("我的").
!macro customInstall
  DetailPrint "Classroom Desk installed. Edit resources\\config.json or use admin UI to set apiBase."
!macroend
