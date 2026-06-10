@echo off
set PATH=C:\Go\bin;E:\nodejs;%LOCALAPPDATA%\\Microsoft\\WinGet\\Packages\\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\\mingw64\\bin;%PATH%
set GOPATH=C:\Users\Administrator\go
%GOPATH%\bin\wails.exe build DEV=true BUILD_FLAGS="-tags cgorpa" CGO_ENABLED=1
