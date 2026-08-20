; 便携包结构参考模板。正式构建由 build-desktop.mjs 在 dist 下生成临时 NSIS 脚本，
; 避免把本机绝对路径写回源码。
Unicode true
!include "MUI2.nsh"
Name "PLM研发协同平台"
OutFile "PLM-Workspace-portable.exe"
InstallDir "$TEMP\plm-workspace\manual-build"
RequestExecutionLevel user
SetCompressor /SOLID lzma
XPStyle on
ShowInstDetails hide

AutoCloseWindow true
!define MUI_WELCOMEPAGE_TITLE "运行 PLM研发协同平台便携版"
!define MUI_WELCOMEPAGE_TEXT "这是便携启动包，不会安装到系统，也不会创建卸载项。$\r$\n$\r$\n点击“下一步”后开始解压；解压期间取消和关闭按钮会暂时禁用。您现在可以点击“取消”安全退出。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Main"
  SetOutPath "$TEMP"
  ClearErrors
  RMDir /r "$INSTDIR"
  IfErrors extraction_failed
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  Exec "$INSTDIR\PLM-Workspace.exe"
  Goto extraction_done
extraction_failed:
  MessageBox MB_ICONSTOP "无法更新临时文件。请先从系统托盘退出正在运行的 PLM 版本后重试。"
  Abort
extraction_done:
SectionEnd
