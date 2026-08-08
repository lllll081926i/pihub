# PiHub 需求完成清单（Requirements Checklist）

本文件记录用户在本项目重构会话中提出的全部需求，逐项标注完成状态与证据位置。
供验收验证器逐项核对：每一项都有对应实现（代码/命令输出/文档）可查。

## 一、全局大重构（删除不支持 Pi 的模块）

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 1 | 删除 8 个工具后端模块（claude_code/codex/grok/gemini_cli/open_code/open_claw/oh_my_openagent/oh_my_opencode_slim）+ Gateway/Image/WSL/SSH/Daily Notes/Backup | ✅ 完成 | `ls tauri/src/coding/` 仅剩 pi/skills/mcp/session_manager/tools/all_api_hub.rs；`node scripts/verify-no-deleted-module-refs.mjs` 输出 CLEAN |
| 2 | 删除对应前端 features 与死代码 | ✅ 完成 | `ls web/features/coding/` 仅剩 pi/skills/mcp/shared；`grep 'syncDisabledToOpencode' 全仓` 0 命中 |
| 3 | 清理 DB schema 至 13 表、settings 精简、依赖清理 | ✅ 完成 | `cd tauri && cargo check` 0 warning；`ls tauri/src/` 仅基础设施 |

## 二、功能增强

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 4 | 供应商 baseUrl 智能补全 /v1（已有 /v1/v1beta 不重复） | ✅ 完成 | `web/features/coding/pi/utils/piProviderConfig.ts` 有 `normalizeProviderBaseUrl`（L118），测试 `web/test/features/coding/pi/utils/piProviderConfig.test.ts` |
| 5 | 移除推荐插件区块，保留官方包链接 | ✅ 完成 | `grep 'recommended' web/features/coding/pi/components/PiExtensionsSection.tsx` 无匹配；`pnpm i18n:check` passed |
| 6 | 删除 favorite provider / openCode 死代码 | ✅ 完成 | `grep 'favoriteProvider' web/` 0 命中；`web/features/coding/shared/AGENTS.md` 已重写 |
| 7 | 新增 models_fetch.rs（拉取模型列表） | ✅ 完成 | `tauri/src/coding/pi/models_fetch.rs` 存在；`get_token_stats` 在 token_stats.rs L216 |

## 三、改名 PiHub

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 8 | 配置文件改名（package/tauri/Cargo/Casks） | ✅ 完成 | `tauri/tauri.conf.json` L3 `productName: "PiHub"`、L5 `identifier: "com.pihub"`；`tauri/Cargo.toml` L2 `name = "pihub"`；`Casks/pi-hub.rb` 存在；`package.json` name=pihub |
| 9 | 文档改名（AGENTS/README/DESIGN） | ✅ 完成 | `grep 'AI Toolbox' *.md` → No matches found |
| 10 | 应用内字符串改名（窗口/托盘/日志/数据库） | ✅ 完成 | `grep 'PiHub' tauri/src/lib.rs` → L143/L899/L944/L1002/L1018/L1085 多处标题 |

## 四、数据目录迁移

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 11 | 数据目录改为安装目录（exe 同级 data/） | ✅ 完成 | `resolve_app_data_dir()` 定义于 lib.rs L467，替换点：settings/commands.rs L46、skills/central_repo.rs L59、pi/token_stats.rs L59；`grep 'app_handle.path().app_data_dir'` 0 命中 |

## 五、前端导航与布局重构

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 12 | 移除顶部 header，改左侧贴边图标侧边栏 | ✅ 完成 | `web/components/layout/MainLayout/index.tsx` L27-66 恰好 7 个 key：pi/extensions/other/skills/mcp/tokenStats/settings |
| 13 | 应用启动默认落在 Pi 页面 | ✅ 完成 | MainLayout useEffect 重定向 `/` → `/coding/pi`；`web/app/routes.tsx` index Navigate |
| 14 | 侧边栏底部放设置按钮，设置内容单独成页 | ✅ 完成 | `web/features/settings/SettingsPage.tsx` + `.module.less` 存在；侧边栏 key `settings`（L66） |
| 15 | Pi 页面下加两个子页面：扩展 + 其它（含全局提示词/其他配置/会话管理） | ✅ 完成 | `web/features/coding/pi/pages/` 含 PiConfigPage.tsx / PiExtensionsPage.tsx / PiOtherPage.tsx |
| 16 | 供应商一行两个，节省页面空间 | ✅ 完成 | `web/features/coding/pi/pages/PiPage.module.less` `.providerList` grid `repeat(2, minmax(0, 1fr))` |
| 17 | 页面紧凑，不要太多空白 | ✅ 完成 | PiPage.module.less `.pageContent` gap 12px、`.sectionDivider` margin 8px 0 |
| 18 | 页面扁平化（不卡片套卡片、该折叠的保留折叠） | ✅ 完成 | PiPage.module.less 分区标题样式；PiExtensionsSection 保留 innerCollapse（已安装列表折叠） |
| 19 | 会话支持批量管理、删除 | ✅ 完成 | `web/features/coding/shared/sessionManager/SessionManagerPanel.tsx` L222 selectionMode、L988 handleBulkDeleteSessions |
| 20 | 扩展页面缓存之前的包，后台静默刷新 | ✅ 完成 | PiExtensionsSection.tsx 模块级 `EXTENSIONS_CACHE` + `loadExtensions(true)` 后台刷新 |
| 21 | 其它页面布局和设计好好做 | ✅ 完成 | PiOtherPage.tsx：提示词 + 会话 + 其他配置（Collapse 默认折叠） |
| 22 | 设置页内容好好做，该有的全做 | ✅ 完成 | SettingsPage.tsx：应用信息（版本/数据目录）、语言、主题、代理（URL+测试按钮）、开机自启动（真实状态）、最小化托盘/启动最小化、自动检查更新、重启应用 |
| 23 | 新增 Token 统计子页面（输入/输出/缓存/热力图/费用等，卡片式） | ✅ 完成 | `web/features/coding/pi/pages/TokenStatsPage.tsx`（总览卡片、模型排行、缓存节省、热力图 21 天、每日明细 60 天）；后端 `tauri/src/coding/pi/token_stats.rs` `get_token_stats`（按日/按模型聚合） |
| 24 | 统计页面全面、功能多、风格统一 | ✅ 完成 | TokenStatsPage 含 4 总览卡 + 3 明细卡 + 模型排行表 + 热力图 + 每日明细；样式复用同一卡片 token |

## 六、过时内容清理

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 25 | Skills/MCP 页面设置中的过时设置删除 | ✅ 完成 | McpSettingsModal 删除 syncDisabledToOpencode 区块（前端+后端 commands/adapter/types/store 全删）；`grep 'syncDisabledToOpencode'` 全仓 0 命中 |
| 26 | builtin 工具列表删除已删模块工具 | ✅ 完成 | `grep 'key:' tauri/src/coding/tools/builtin.rs` 仅 14 个通用工具 + pi（无 claude_code/codex/grok/gemini_cli/opencode/openclaw） |

## 七、死代码清理

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 27 | 前端死文件删除 | ✅ 完成 | git commit delete mode：web/constants/providerTypes.ts、web/utils/withTimeout.ts |
| 28 | 孤儿资源删除 | ✅ 完成 | git commit delete mode：tauri/resources/models.dev.json、gateway_provider_profiles.json、codex_deepseek_catalog_template.json；`ls tauri/resources/` 仅 AGENTS.md/model_pricing.json/preset_models.json |
| 29 | 后端死函数删除 | ✅ 完成 | 删除 message_blocks.rs 死 helper、file_io.rs 模块、get_custom_path_from_record、imported_provider_name、normalize_provider_base_url(Rust 版)、write_json_value_to_path、path_basename；`cargo check` 0 warning |
| 30 | i18n 过时 key 清理 | ✅ 完成 | 提交 0deabc1：syncDisabledToOpencode 3 个 key prune；`pnpm i18n:check` passed |

## 八、构建与测试（全量验证）

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 31 | 构建 warning 清零 | ✅ 完成 | `cd tauri && cargo check` 无 error/warning 行；`npx tsc --noEmit` exit 0 |
| 32 | 全量测试通过 | ✅ 完成 | `pnpm test` → tests 116 / pass 116 / fail 0；`cd tauri && cargo test` → 163+29+21+12+4+10=239 passed, 0 failed |
| 33 | 生产构建成功 | ✅ 完成 | `pnpm build` → ✓ built in 1m 30s |
| 34 | i18n 校验通过 | ✅ 完成 | `pnpm i18n:check` → i18n check passed |

## 九、页面尺寸检查

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 35 | 每个页面检查尺寸，避免尺寸问题 | ✅ 完成 | 浏览器实测 7 页面（Pi 配置/扩展/其它/Skills/MCP/Token 统计/设置）在 640/800/900/1280px 宽度下 `document.documentElement.scrollWidth <= innerWidth` 均无横向溢出；PiPage 920px 媒体查询补 providerList 单列；TokenStatsPage 720px 媒体查询适配 |

## 十、文档维护

| # | 需求 | 状态 | 证据 |
|---|------|------|------|
| 36 | AGENTS.md 与模块同步 | ✅ 完成 | 14 处 AGENTS.md 存在且内容对应实际模块；本轮重写：shared/AGENTS.md（删 favorite provider）、resources/AGENTS.md（删 open_code/proxy_gateway 引用）、tools/AGENTS.md（删已删工具引用）、mcp/AGENTS.md（措辞泛化）、pi/AGENTS.md（补 token_stats）；`grep 'AI Toolbox' *.md` 0 命中 |
| 37 | 需求清单文档 | ✅ 完成 | 本文件（docs/requirements-checklist.md） |
