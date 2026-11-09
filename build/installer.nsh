!include nsDialogs.nsh
; Scope Node mode to the helper child. Restore it before runAfterFinish launches
; the normal GUI, including when the helper returns an error.
!macro scheduleNodeStart
  ReadEnvStr $R8 "ELECTRON_RUN_AS_NODE"
  System::Call 'Kernel32::SetEnvironmentVariableW(w "ELECTRON_RUN_AS_NODE", w "1") i .r9'
!macroend
!macro scheduleNodeEnd
  ${If} $R8 == ""
    System::Call 'Kernel32::SetEnvironmentVariableW(w "ELECTRON_RUN_AS_NODE", p 0) i .r9'
  ${Else}
    System::Call 'Kernel32::SetEnvironmentVariableW(w "ELECTRON_RUN_AS_NODE", w "$R8") i .r9'
  ${EndIf}
!macroend
!ifndef BUILD_UNINSTALLER
Var configureAgents
Var configureAgentsControl
!macro customInit
  StrCpy $configureAgents ${BST_CHECKED}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--skip-integrations" $R1
  ${IfNot} ${Errors}
    StrCpy $configureAgents ${BST_UNCHECKED}
  ${EndIf}
!macroend
!macro customPageAfterChangeDir
  Page custom ConfigureAgentsPage ConfigureAgentsLeave
Function ConfigureAgentsPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 48u "Configure automatic progress reporting for your Windows user. Existing settings are backed up. AI tools are not installed or restarted, and approval permissions stay unchanged."
  Pop $0
  ${NSD_CreateCheckbox} 0 54u 100% 28u "Configure Codex and Claude Code (MCP, Skill, default rules and async ETA hooks)"
  Pop $configureAgentsControl
  ${NSD_SetState} $configureAgentsControl $configureAgents
  ${NSD_CreateLabel} 0 90u 100% 35u "You can check, repair or undo this later in codingSchedule settings. Reconnect your AI tools when convenient after installation."
  Pop $0
  nsDialogs::Show
FunctionEnd
Function ConfigureAgentsLeave
  ${NSD_GetState} $configureAgentsControl $configureAgents
FunctionEnd
!macroend
!macro customInstall
  ${If} $configureAgents == ${BST_CHECKED}
    !insertmacro scheduleNodeStart
    nsExec::ExecToStack '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\integration\setup-cli.cjs"'
    Pop $0
    Pop $2
    !insertmacro scheduleNodeEnd
    ${If} $0 != 0
      DetailPrint "Automatic AI setup incomplete. Open codingSchedule settings to check and repair."
      ${IfNot} ${Silent}
        MessageBox MB_ICONEXCLAMATION|MB_OK "The application was installed, but automatic AI setup could not finish. Existing settings were preserved. Open codingSchedule settings and use Check / Repair."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
!endif
!ifdef BUILD_UNINSTALLER
Var keepProgress
Var keepProgressControl
!endif
!macro customUnWelcomePage
  UninstPage custom un.ProgressPage un.ProgressPageLeave
Function un.ProgressPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 48u "Uninstall codingSchedule (unsigned internal build). Owned MCP, Skill, rules and hooks are reverted first. If an owned entry was edited, removal stops for review. AI source logs are never removed."
  Pop $0
  ${NSD_CreateCheckbox} 0 55u 100% 24u "Keep my progress database and migration backups (recommended)"
  Pop $keepProgressControl
  ${NSD_Check} $keepProgressControl
  nsDialogs::Show
FunctionEnd
Function un.ProgressPageLeave
  ${NSD_GetState} $keepProgressControl $keepProgress
FunctionEnd
!macroend
!macro customUnInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_OK "Recursive app-data deletion is disabled. Use the progress retention choice in this uninstaller. No files were changed."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $keepProgress ${BST_CHECKED}
!macroend
!macro customUnInstall
  ${IfNot} ${isUpdated}
    StrCpy $1 ""
    ${If} $keepProgress == ${BST_UNCHECKED}
      StrCpy $1 "--delete-progress"
    ${EndIf}
    StrCpy $3 "$PROFILE\.coding-schedule"
    IfFileExists "$3\schedule.db" profileReady
    IfFileExists "$3\profile-migration.json" profileReady
    IfFileExists "$3\receipts.json" profileReady
    IfFileExists "$3\integration-transaction.json" profileReady
    StrCpy $3 "$APPDATA\${APP_PACKAGE_NAME}"
    profileReady:
    !insertmacro scheduleNodeStart
    nsExec::ExecToStack '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\integration\remove-cli.cjs" --data-dir "$3" $1'
    Pop $0
    Pop $2
    !insertmacro scheduleNodeEnd
    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "Removal stopped. Progress and application files were preserved. Restore/review edited MCP entries in codingSchedule settings, then try again. Details: $2"
      Abort
    ${EndIf}
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "codingSchedule"
    ${If} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "codingSchedule"
    ${EndIf}
  ${EndIf}
!macroend
