$ErrorActionPreference = "Continue"
$root = "E:\CUFE\vibecoding\course-manager\course-manager"
$log = Join-Path $root "apk-build-0.1.12.log"
$env:ANDROID_HOME = "E:\devtools\android\Sdk"
$env:NDK_HOME = "E:\devtools\android\Sdk\ndk\26.1.10909125"
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
$env:TAURI_SIGNING_PRIVATE_KEY = "E:\devtools\tauri-keys\daymark.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
$env:GRADLE_USER_HOME = "E:\devtools\gradle-home"
Set-Location $root
"START $(Get-Date -Format o)" | Out-File -Encoding utf8 $log
& "E:\devtools\tauri-cli-src\tauri-cli-2.12.1\target\release\cargo-tauri.exe" android build --ci --apk *>> $log
"EXIT=$LASTEXITCODE $(Get-Date -Format o)" | Out-File -Encoding utf8 -Append $log
