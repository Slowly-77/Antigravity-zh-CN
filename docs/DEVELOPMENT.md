# 开发与测试

安装 Node.js 22+。不需要 npm install，也不需要下载第三方打包库。

## 构建

```powershell
node build_localized.js
node test_localized.js
```

构建需要本机已安装兼容版本的 Antigravity。它只在当前工具目录产生 `app_localized.asar` 和 `build-manifest.json`，不会自动替换客户端；替换由 `install.ps1` 完成。

公开版只保存原生 preload 的 SHA-256 指纹，构建时读取并保留本机客户端原生代码。仓库不包含官方程序或旧版基底。不要只修改版本号或指纹来绕过不兼容检查。

## 回归检查

```powershell
node tests/auto-adapt-test.cjs
node tests/installer-test.cjs
node tests/restore-test.cjs
node tests/prepare-background-test.cjs
node tests/run-browser-tests.cjs background-startup-test
node tests/run-browser-tests.cjs metrics-test
node tests/run-browser-tests.cjs metrics-recovery-test
node tests/run-browser-tests.cjs composer-scroll-test
node tests/run-browser-tests.cjs context-test
node tests/run-browser-tests.cjs history-navigation-test
node tests/run-browser-tests.cjs layout-test
node tests/run-browser-tests.cjs codex-chat-test
```

自动适配测试默认使用本机客户端作只读输入，也可以通过 `AG_TEST_BASE_ASAR` 指定合法获得的本地资源。所有变更测试均在临时目录进行。安装器和还原测试模拟客户端进程，不会真的替换本机程序。

浏览器测试需要 Microsoft Edge。测试使用独立的临时浏览器资料，不读取日常浏览器数据。页面测试基于模拟数据和自写基础样式，不等于每个未来客户端版本的实机验收。

`metrics-recovery-test` 覆盖请求挂起、超时重试、切换会话后迟到的结果、工具执行期间的平均速度、额度恢复和减少布局扫描。用模拟计时触发超时，不需要真的等待网络故障，也不发送模型消息。

## 发布前

只提交源码和 `docs/images` 里的展示图。不要提交生成的 ASAR、`backups`、测试截图/报告、浏览器资料、真实 AGENTS.md、账号文件或聊天记录。

修复补丁时尽量保持改动范围小。不要修改安全权限、模型配置或历史消息。
