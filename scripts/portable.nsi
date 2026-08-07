; PLM 研发协同平台 —— 便携版自解压安装器（NSIS）
; 运行：解压应用到 %TEMP%\plm-workspace → 启动 PLM-Workspace.exe → 退出
Unicode true
Name "PLM研发协同平台"
OutFile "PLM平台-1.0.1-便携版.exe"
InstallDir "$TEMP\plm-workspace"
RequestExecutionLevel user
SetCompressor /SOLID lzma
XPStyle on
ShowInstDetails hide
SilentInstall normal

Page instfiles

Section "Main"
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR"
  SetOverwrite on
  File /r "E:\workbuddy_pro\dist\win-unpacked\*.*"
  Exec "$INSTDIR\PLM-Workspace.exe"
SectionEnd
