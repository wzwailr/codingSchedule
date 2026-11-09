Unicode true
RequestExecutionLevel user
CRCCheck force
SetCompressor /SOLID lzma
SetCompressorDictSize 32
Name "codingSchedule WebView2"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\codingSchedule-WebView2"
ShowInstDetails show
ShowUninstDetails show

!include LogicLib.nsh
!include FileFunc.nsh
!include WinVer.nsh
!include x64.nsh
!include MUI2.nsh
!include "${PAYLOAD_FILES}"

!define APP_EXE "codingSchedule-webview2.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\codingScheduleWebView2"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 codingSchedule"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Var InstallMutex
Var DataDir
Var ProbeExit

!macro StopInstall Text Code
  DetailPrint "${Text}"
  ${IfNot} ${Silent}
    MessageBox MB_ICONSTOP|MB_OK "${Text}"
  ${EndIf}
  SetErrorLevel ${Code}
  Quit
!macroend

!macro MoveWithRetry From To
  StrCpy $R6 0
  ${Do}
    ClearErrors
    Rename "${From}" "${To}"
    ${IfNot} ${Errors}
      ${ExitDo}
    ${EndIf}
    IntOp $R6 $R6 + 1
    ${If} $R6 >= 12
      SetErrors
      ${ExitDo}
    ${EndIf}
    Sleep 250
  ${Loop}
!macroend

Function .onInit
  ${IfNot} ${AtLeastWin10}
  ${OrIfNot} ${IsNativeAMD64}
    !insertmacro StopInstall "此安装包适用于 Windows 10 或 Windows 11 x64。" 10
  ${EndIf}
  SetShellVarContext current
  StrCpy $DataDir "$PROFILE\.coding-schedule"
  !ifdef SCHEDULE_TEST_INSTALL
    ReadEnvStr $DataDir "SCHEDULE_TEST_PROFILE"
    ${If} $DataDir == ""
      !insertmacro StopInstall "测试安装需要独立的数据目录。" 13
    ${EndIf}
  !endif
  System::Call 'kernel32::CreateMutexW(p0,i0,w "Local\CodingScheduleWebView2Setup") p.s ?e'
  Pop $0
  Pop $InstallMutex
  ${If} $InstallMutex == 0
  ${OrIf} $0 == 183
    !insertmacro StopInstall "已有安装正在进行。请稍后重试。" 11
  ${EndIf}
FunctionEnd

Function CheckRuntime
  ClearErrors
  ExecWait '"$PLUGINSDIR\probe\${APP_EXE}" --probe-runtime --data-dir "$PLUGINSDIR\profile"' $ProbeExit
  ${If} ${Errors}
    StrCpy $ProbeExit 99
  ${EndIf}
FunctionEnd

Function PrepareRuntime
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\probe"
  File "${PAYLOAD}\${APP_EXE}"
  File "${PAYLOAD}\WebView2Loader.dll"
  DetailPrint "检测 WebView2 运行环境…"
  Call CheckRuntime
  ${If} $ProbeExit == 0
    DetailPrint "WebView2 可用，直接复用。"
    Return
  ${EndIf}
  ${If} $ProbeExit != 10
  ${AndIf} $ProbeExit != 12
    !insertmacro StopInstall "无法运行环境检测。请检查 Windows 版本、空间和企业策略。" 12
  ${EndIf}
  File /oname=MicrosoftEdgeWebview2Setup.exe "${BOOTSTRAPPER}"
  runtimeRetry:
  DetailPrint "正在通过微软安装程序准备 WebView2，需要联网…"
  ClearErrors
  ExecWait '"$PLUGINSDIR\probe\MicrosoftEdgeWebview2Setup.exe" /silent /install' $0
  ${IfNot} ${Errors}
    Call CheckRuntime
    ${If} $ProbeExit == 0
      DetailPrint "WebView2 已通过窗口创建检查。"
      Return
    ${EndIf}
  ${EndIf}
  ${IfNot} ${Silent}
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "WebView2 尚未就绪。请检查网络或企业安装策略后重试。" IDRETRY runtimeRetry
  ${EndIf}
  !insertmacro StopInstall "WebView2 尚未就绪。安装已停止。" 12
FunctionEnd

Section "应用和所需运行组件" Core
  SectionIn RO
  ${If} ${FileExists} "$INSTDIR\*.*"
  ${AndIfNot} ${FileExists} "$INSTDIR\.codingSchedule-WebView2"
    !insertmacro StopInstall "安装目录已包含其他文件。请选择专用的应用目录。" 13
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR.__next\*.*"
  ${OrIf} ${FileExists} "$INSTDIR.__previous\*.*"
    !insertmacro StopInstall "检测到上一次安装的暂存目录。请保留其内容并检查安装目录后重试。" 13
  ${EndIf}
  Call PrepareRuntime
  DetailPrint "准备应用和私有 Node 运行组件…"
  SetOutPath "$INSTDIR.__next"
  SetOverwrite on
  AllowSkipFiles off
  !insertmacro InstallPayload "$INSTDIR.__next"
  ClearErrors
  nsExec::ExecToStack /TIMEOUT=20000 '"$INSTDIR.__next\resources\bridge-runtime\node.exe" "$INSTDIR.__next\resources\integration\setup-cli.cjs" --check-profile --data-dir "$DataDir"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetOutPath "$TEMP"
    !insertmacro DeletePayload "$INSTDIR.__next"
    !insertmacro StopInstall "请先退出使用同一数据目录的 codingSchedule，再运行安装。" 14
  ${EndIf}
  FileOpen $0 "$INSTDIR.__next\.codingSchedule-WebView2" w
  FileWrite $0 "${VERSION}"
  FileClose $0
  WriteUninstaller "$INSTDIR.__next\Uninstall.exe"
  SetOutPath "$TEMP"
  ${If} ${FileExists} "$INSTDIR\.codingSchedule-WebView2"
    ClearErrors
    !insertmacro MoveWithRetry "$INSTDIR" "$INSTDIR.__previous"
    ${If} ${Errors}
      !insertmacro DeletePayload "$INSTDIR.__next"
      !insertmacro StopInstall "已有应用文件正在使用。退出 codingSchedule 后重试。" 14
    ${EndIf}
  ${Else}
    RMDir "$INSTDIR"
  ${EndIf}
  ClearErrors
  !insertmacro MoveWithRetry "$INSTDIR.__next" "$INSTDIR"
  ${If} ${Errors}
    ${If} ${FileExists} "$INSTDIR.__previous\.codingSchedule-WebView2"
      !insertmacro MoveWithRetry "$INSTDIR.__previous" "$INSTDIR"
    ${EndIf}
    !insertmacro StopInstall "无法启用应用文件。请检查安装目录的访问权限。" 15
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR.__previous\.codingSchedule-WebView2"
    !insertmacro DeletePayload "$INSTDIR.__previous"
  ${EndIf}
  !ifndef SCHEDULE_TEST_INSTALL
    CreateShortcut "$SMPROGRAMS\codingSchedule WebView2.lnk" "$INSTDIR\${APP_EXE}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "codingSchedule WebView2"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  !endif
SectionEnd

Section "配置 Codex 和 Claude Code" Agents
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--skip-integrations" $1
  ${IfNot} ${Errors}
    Goto agentsDone
  ${EndIf}
  DetailPrint "配置 Codex 和 Claude 的 MCP、Skill、汇报规则和 Hook…"
  ClearErrors
  nsExec::ExecToStack /TIMEOUT=30000 '"$INSTDIR\resources\bridge-runtime\node.exe" "$INSTDIR\resources\integration\setup-cli.cjs" --data-dir "$DataDir" --webview2'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "应用已安装，AI 接入仍需检查。"
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_OK "应用已安装。Codex 或 Claude 的接入存在冲突或错误，请打开设置检查和修复。"
    ${EndIf}
    SetErrorLevel 16
  ${Else}
    DetailPrint "接入配置已准备。请在方便时重新连接 AI 工具。"
  ${EndIf}
  agentsDone:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  StrCpy $DataDir "$PROFILE\.coding-schedule"
  !ifdef SCHEDULE_TEST_INSTALL
    ReadEnvStr $DataDir "SCHEDULE_TEST_PROFILE"
    ${If} $DataDir == ""
      !insertmacro StopInstall "测试卸载需要独立的数据目录。" 13
    ${EndIf}
  !endif
  ClearErrors
  nsExec::ExecToStack /TIMEOUT=20000 '"$INSTDIR\resources\bridge-runtime\node.exe" "$INSTDIR\resources\integration\setup-cli.cjs" --check-profile --data-dir "$DataDir"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    !insertmacro StopInstall "请先退出使用同一数据目录的 codingSchedule。" 17
  ${EndIf}
  ClearErrors
  nsExec::ExecToStack /TIMEOUT=30000 '"$INSTDIR\resources\bridge-runtime\node.exe" "$INSTDIR\resources\integration\remove-cli.cjs" --data-dir "$DataDir" --webview2'
  Pop $0
  Pop $1
  ${If} $0 != 0
    !insertmacro StopInstall "请退出 codingSchedule 并检查接入冲突，再重试卸载。" 17
  ${EndIf}
  !ifndef SCHEDULE_TEST_INSTALL
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "codingSchedule"
    ${If} $0 == '"$INSTDIR\${APP_EXE}"'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "codingSchedule"
    ${EndIf}
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    Delete "$SMPROGRAMS\codingSchedule WebView2.lnk"
  !endif
  SetOutPath "$TEMP"
  !insertmacro DeletePayload "$INSTDIR"
SectionEnd
