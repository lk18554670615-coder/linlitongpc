# 邻里通桌面客户端

这是一个 Electron 桌面壳，用于把邻里通网页端作为 Windows、macOS、Linux 客户端运行。

## 功能

- 多账号同时在线。
- 每个账号使用独立持久化 Electron session partition，隔离 cookie、localStorage、sessionStorage、IndexedDB 和缓存。
- 关闭后重新进入会恢复每个账号上次打开的站内页面/聊天路由。
- 登录后账号栏会自动显示登录账户昵称；用户手动重命名后会保留手动名称。
- 左侧账号栏支持添加、切换、重命名、移除账号。
- 只允许邻里通业务站点申请通知、摄像头、麦克风权限。
- 外部链接使用系统浏览器打开。

## 开发运行

```bash
npm install
npm start
```

## 检查

```bash
npm run lint
npm run smoke
```

## 打包

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Windows 产物为 NSIS 安装包，macOS 产物为 DMG，Linux 产物为 AppImage。

### GitHub Actions 打包 macOS

仓库已包含 `.github/workflows/build-macos.yml`，推送到 GitHub 后可以在 Actions 页面手动运行 `Build macOS DMG`。工作流会分别生成：

- `linlitong-macos-x64`，适用于 Intel Mac。
- `linlitong-macos-arm64`，适用于 Apple Silicon Mac。

当前产物未做 Apple Developer ID 签名和 notarization，首次打开可能会被 macOS Gatekeeper 提示。

### GitHub Actions 打包 Windows

仓库已包含 `.github/workflows/build-windows.yml`，推送到 GitHub 后可以在 Actions 页面手动运行 `Build Windows Installer`。工作流会生成：

- `linlitong-windows-x64`，包含 Windows x64 的 NSIS 安装包。

当前产物未做代码签名，首次安装时 Windows SmartScreen 可能会提示未知发布者。

## 会话数据

账号列表和 Electron session 数据保存在系统应用数据目录中。移除账号时会清理对应 partition 的存储和缓存，不影响其他账号。

每个账号会额外保存上次访问的站内路由。重新启动时，客户端会先恢复账号列表和登录态，再按账号加载上次路由；如果网站把聊天选择写在路由、cookie、localStorage 或 IndexedDB 中，就会回到之前的对话位置。
