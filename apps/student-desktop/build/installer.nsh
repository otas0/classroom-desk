; Optional NSIS hooks. Server URL is configured via resources/config.json
; and can be changed after install by admin in the student app ("我的").
!macro customInstall
  DetailPrint "Classroom Desk installed. Edit resources\\config.json or use admin UI to set apiBase."
!macroend

Function .onInstSuccess
  MessageBox MB_ICONINFORMATION|MB_OK "安装完成。$\r$\n$\r$\n请设置教室服务器地址（apiBase）：$\r$\n1) 编辑安装目录下 resources\\config.json$\r$\n2) 或打开应用 →「我的」→ 管理密码后保存$\r$\n$\r$\n示例：http://192.168.1.50:8787$\r$\n然后验证登录 → 交作业 → 教师审核。"
FunctionEnd
