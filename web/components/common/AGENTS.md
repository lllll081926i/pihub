# Shared Components Development Guide

## 一句话职责

- 为多个页面提供编辑器和基础交互组件，并保证用户输入规模或内容形态不会阻塞前端主线程。

## 核心设计决策（Why）

- Monaco Monarch tokenizer 在 WebView 主线程执行。字符串规则必须保持线性时间；正则分支不能重叠消费同一字符，否则包含大量转义符的配置行会触发灾难性回溯并冻结整个主窗口。
- `JsonEditor` / `JsoncEditor` / `MarkdownEditor` 静态依赖 `monaco-editor`（约 4MB 解析体积），但它们只在弹窗/折叠区内渲染。业务页必须通过 `web/components/common/lazyMonaco.tsx` 的 `LazyJsonEditor` / `LazyJsoncEditor` / `LazyMarkdownEditor` 使用，让 Monaco 与 react-markdown 进入独立懒加载 chunk；不要直接静态 import 这三个编辑器组件（会把 Monaco 打进启动主 chunk）。`vite.config.ts` 的 `modulePreload.resolveDependencies` 已排除 monaco chunk，避免 HTML 预拉取抵消懒加载。

## 易错点与历史坑（Gotchas）

- TOML 双引号字符串的“未闭合”规则中，转义分支 `\\.` 与普通字符分支必须互斥。普通字符分支必须排除反斜杠，使用 `[^"\\]`，不能退回会同时匹配反斜杠的 `[^\"]`。
- 不要只用普通短配置验证 tokenizer。含 JSON 嵌入的 TOML 字符串（例如带大量反斜杠和转义引号的超长单行）必须覆盖。
- 新增使用 Monaco 的编辑器组件时，同步在 `lazyMonaco.tsx` 提供对应 lazy 包装并让业务页引用它；不要新增直接静态 import `monaco-editor` 的共享组件。

## 最小验证

- 修改 TOML tokenizer 后，运行 `web/test/components/common/TomlEditor/invalidDoubleQuoteStringPattern.test.ts`。
- 语义覆盖要同时包含：未闭合串、普通 closed 串、真实含 JSON 嵌入的 Windows 路径 closed 串（如 `notify` 风格），以及会触发指数回溯的 adversarial closed 串。
- 指数回溯回归必须在可终止的 Worker 中执行（超时即失败），避免危险正则重新出现时把完整测试进程永久卡住。
