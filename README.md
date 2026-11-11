# agy-customify

通过 CDP 为 Antigravity 注入自定义终端字体，并为原生文件查看器补全编辑、保存、新建与删除等文件管理能力。基于 Bun 运行，无需额外依赖。

## 快速开始

1. 在项目根目录的 `config.json` 中配置 Antigravity 可执行文件路径和调试端口：

   ```json
   {
     "executablePath": ".\\Antigravity.exe",
     "port": 9222
   }
   ```

2. 运行启动与注入命令（若 CDP 端口尚未开启，会自动以 `--remote-debugging-port` 启动 Antigravity 并完成注入）：

   ```powershell
   bun run start
   ```

   > 保持进程运行即可自动监听新窗口与重载刷新。常用选项：`--exe <path>`、`--port <port>`、`--no-launch`（不自动启动程序）、`--list`（仅列出页面）、`--once`（单次注入）、`--match <text>`（按 URL 过滤）。

## 主要特性

- **终端字体**：注入自定义等宽字体（可在 `src/injections/styles.css` 中配置）。
- **原生文件编辑**：
  - 在原生查看器中无缝切换 **Preview / Raw / Edit** 模式。
  - 支持 `Ctrl+S` / `Cmd+S` 保存、行号与 Prism 语法高亮。
  - 自动保留未保存草稿，关闭时带确认提示；具备外部文件修改冲突保护。
- **文件与目录管理**：
  - 支持右侧文件树新建文件、新建文件夹与右键删除。
  - 直接调用宿主原生上下文菜单与 Language Server 文件接口，无外部服务依赖。

## 测试

```powershell
bun run test
```

## 项目结构

```text
src/
├─ cli.js                  # CDP 连接与注入管理
└─ injections/
   ├─ styles.css           # 终端字体、编辑器与 UI 增强样式
   ├─ native-files.js      # 宿主环境与文件/菜单接口适配
   ├─ raw-text-editor.js   # 编辑器核心（行号、高亮、快捷键）
   └─ file-editor-entry.js # 原生查看器入口与 UI 增强
```
