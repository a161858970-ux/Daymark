# 阶段 3 — APK 打包（2026-10-07 夜间，全程无人值守）

> 用户睡前授权：换 logo 后直接开 APK，全程自主、不弹通知、不等决策。

## 工具链（全在 E 盘，遵守 C 盘只出不进的约束）

| 组件                   | 位置 / 版本                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JDK 17                 | `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`（winget 装的，唯一在 C 的，装时未受控；体积小可接受）                                                       |
| Android cmdline-tools  | `E:\devtools\android\Sdk\cmdline-tools\latest`                                                                                                                   |
| platform / build-tools | `android-37.0` + `37.0.0`（模板 compileSdk=37，**包名带小数**，`platforms;android-37` 不存在）+ 兼容装了 35                                                      |
| NDK                    | `26.1.10909125`（tauri 环境检查的硬性缺失项，缺它 init 直接拒）                                                                                                  |
| platform-tools         | adb 等                                                                                                                                                           |
| Gradle 发行版          | 9.6.1（wrapper 首跑自下，`GRADLE_USER_HOME=E:\devtools\gradle-home`）                                                                                            |
| Rust 目标              | aarch64 / armv7-androideabi / i686 / x86_64（**注意正确三元组带 -androideabi**，写 `armv7-linux-android` 会报“工具链不支持”）                                    |
| cargo 交叉链接器       | `E:\devtools\cargo\config.toml` 三个 target 指向 NDK clang.cmd（**TOML 字符串里路径必须用正斜杠**，反斜杠转义坑）                                                |
| 发布密钥库             | `E:\devtools\keystore\daymark-release.jks`（RSA2048/10000天），密码 `daymark-release.pass`；`gen/android/keystore.properties`（gitignore 覆盖）接线 release 签名 |

## 工程

- `pnpm exec tauri android init` → `src-tauri/gen/android/`（Kotlin DSL、minSdk 24、versionCode 1000/versionName 0.1.0）
- `src-tauri/Cargo.toml` 原生就有 `[lib] daymark_lib + staticlib/cdylib/rlib`（首轮脚手架的先见之明，移动端零改动）
- 应用名：`app_name = Daymark`（与桌面快捷方式一致）

## 关键坑：符号链接权限（标准用户 + 无开发者模式 = 官方路全堵）

- `tauri android build` 把 `libdaymark_lib.so` **符号链接**进 jniLibs；Windows 无特权直接报
  `Creation symbolic link is not allowed for this system`（WinError 1314）。
- 实测结论：账号 `violet` **不在管理员组**（标准用户）、EnableLUA=1、开发者模式注册表无键——
  官方指引（开发者模式/管理员终端）**在本机物理不可行**（无人值守无法过 UAC，账号本身也无权限）。
- 社区（含 tauri issue #10937）只有“开开发者模式”一条路 → **自己动手**：
  1. 下载 `cargo-mobile2-0.22.5.crate`（真正干活的库，tauri-cli 的依赖）；
  2. 补丁 `src/os/windows/ln.rs`：`force_symlink` 捡到 ERROR_PRIVILEGE_NOT_HELD（1314）且目标是文件时
     **降级为 `fs::copy`**（Gradle 只读字节，行为等价）；目录仍报原错；
  3. tauri-cli-2.12.1 源码 Cargo.toml 加 `[patch.crates-io] cargo-mobile2 = { path = "../../cargo-mobile2-0.22.5" }`
     （**相对路径两级**，一级会解析错目录）；
  4. `cargo build --release --bin cargo-tauri` → 私有 CLI；
  5. `E:\devtools\bin\pnpm.cmd` 垫片：`pnpm tauri ...` 转发到私有二进制（防 gradle 子进程 BuildTask
     内部再走老 CLI；其余参数委托真 pnpm——真 pnpm 在 cmd 下要用 `pnpm.CMD`，裸 `pnpm` 是 sh 脚本）。
- 附带教训：预先把 .so 复制进 jniLibs **没用**（CLI 无条件删了重建链接）；`open('w')` 失败也会**先截断文件**
  （build.gradle.kts 曾被清空，靠重新 init 恢复——修改生成文件前先备份）。

## 其他踩坑（同夜）

- sdkmanager 许可证：stdin 要喂 `y\n`（空回车 = 默认 N 全部跳过）；输出含 GBK 要 `errors='replace'`。
- `ExtractAssociatedIcon` 读 exe 图标会丢 alpha（假阴性），验透明度以 `icons/icon.ico` 为准。
- rustup 目标名：`armv7-linux-android` ✗ → `armv7-linux-androideabi` ✓。

## 状态（2026-10-07 03:2x 全部完成）

- [x] 私有 cargo-tauri 编译完成（30.9MB；补丁含一次 Cow 借用修复——`target` move 后复用，按编译器建议改 `&target`）
- [x] `cargo-tauri android build --ci --apk -v > apk-build.log` 全绿：**BUILD SUCCESSFUL in 13m 18s，130 tasks**
- [x] 产物 `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`（2.74MB）
- [x] 验证：apksigner **CN=Daymark V2 签名** ✓；清单 `com.daymark.desktop` / minSdk 24 / targetSdk 37 /
      versionName 0.1.0 (code 1000) ✓；zip 内 **lib/ 四 ABI 齐**（arm64-v8a、armeabi-v7a、x86、x86_64）✓
- [x] 提交 gen/android（keystore.properties 被 .gitignore 覆盖；密钥库与密码在 E:\devtools\keystore，均不进仓库）

### 复盘补记

- gradle 首次"假死"真相 = **configuration 阶段的 buildSrc Kotlin 编译 + 依赖解析**（CPU 满转 4-5 分钟、
  daemon 日志只见心跳），并非卡死；`-v` 直写文件日志（不隔管道）是这轮最有效的观测手段。
- AGP 运行中自动补装了 `build-tools;36.0.0` 与 `platforms;android-36`（依赖要求，之前喂过的许可证 `y` 全部复用）。
- gradle BuildTask 内部确实再走一次 `pnpm tauri android android-studio-script`——**pnpm.cmd 垫片派上用场**，
  日志证实它路由到了补丁版（`cargo_mobile2::android::jnilibs` 的 copy 降级路径被触发）。
- 装机测试：`adb install -r <apk>` 或直接传手机点装（需开"允许未知来源"）。

### 真机首测两坑（2026-10-07，已修 `de1c922`）

1. **点开即闪退**：`llvm-nm -D` 显示 .so 动态导出 **0** —— 手写 lib.rs 缺官方模板的
   `#[cfg_attr(mobile, tauri::mobile_entry_point)]`，JNI 入口没编进去，MainActivity 找不到原生方法
   必秒崩。补宏后实测 **24 个 `Java_*` 导出**；同时包体从病态 2.88MB 恢复到健康 19.78MB
   （308KB 的 .so 本来就不该装下整个 tauri——体积异常本身就是未编入完整代码的信号）。
2. **图标是模板默认双圆图**：`tauri android init` 不拷图标，工程 mipmap 全是模板货。修复 =
   `src-tauri/icons/android` **全量**（17 文件）覆盖工程 res；注意自适应图标
   `mipmap-anydpi-v26/ic_launcher.xml` 引用 `color/ic_launcher_background`，**必须连 `values/` 一起拷**，
   只拷 mipmap 会在 `processResources` 报 resource linking failed。
3. **桌面壳泄漏进手机端**（真机第二轮反馈）：`isTauri()` 在安卓壳同样为真，Windows 标题栏与
   `.tauri-shell` 规则（`top:0/padding-top:74px` 特异性 0-2-0，**压过了移动端媒体查询的底部导航**）
   全部泄漏 → 顶部出现 Win 控制条、底部标签栏被拽到顶。修复：`isAndroid()`（wry UA 含 Android）
   作为第二道门槛，标题栏与 body.tauri-shell 仅桌面生效——安卓恢复为纯响应式视图（即当初浏览器
   窄窗验收通过的那套）。另：`MainActivity.kt` 模板自带 `enableEdgeToEdge()` + targetSdk37 在
   Android15+ 强制边缘到边缘 → 顶进刘海；修复 = 去掉调用 + `values-v35/themes.xml` 加
   `windowOptOutEdgeToEdgeEnforcement`。安卓点按的蓝色高亮块 = `-webkit-tap-highlight-color`
   （styles.css 此前从未写过此规则），全局置 transparent。
4. 验证配方：`llvm-nm -D --defined-only <so> | grep Java_`（入口）+ `apksigner verify --print-certs`
   （签名）+ zip 抽 `res/*.png` 肉眼核图标（release 开了资源混淆，路径会变成 res/as.png 之类，
   按 resources.arsc 仍含 `ic_launcher` 名判断资源未丢）。
