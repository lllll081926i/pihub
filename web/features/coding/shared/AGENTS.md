# Coding Shared 前端模块说明

## 一句话职责

- `shared/` 提供 Pi 页面共用的前端语义层（当前仅 Pi 页面使用），不拥有独立业务主数据，但封装了跨模块必须一致的交互规则。

## Source of Truth

- `shared/` 中的大多数组件只是消费 Pi 模块自己的 service/store，不能反过来成为业务事实源。
- root path source、prompt 列表、session 数据等真实数据都在 Pi 后端命令或模块 store 中。
- `shared/` 真正需要维护的是"相同概念在不同页面的统一解释"，例如 root path source、session tool API 形态。

## 核心设计决策（Why）

- `useRootDirectoryConfig` + `RootDirectoryModal` 把根目录编辑语义统一起来。
- `GlobalPromptSettings`、`SessionManagerPanel` 等共享组件都要求业务方通过 service/api 注入，不自己硬编码某个模块的存储细节。
- `SessionManagerPanel` 的标题栏可通过 `extra` 注入模块自有动作；动作归 owning page 处理，shared 面板只负责摆放入口。
- `sessionManager/detail/` 是共享会话详情二级页和 workbench。它只消费后端 normalized message/block 契约，并通过 domain helpers 做搜索、过滤、导航、工具块配对和工具展示归一化。
- `allApiHub` 共享 modal 和模型缓存属于"共享交互层"，不是某个页面的私有实现。
- `management/` 下的控件和 `VirtualGrid` 只提供高密度管理页的纯 UI 行为。
- `magicContext/` 是 Pi 使用的 CortexKit 用户级配置管理入口。

## 易错点与历史坑（Gotchas）

- 不要把 `shared/` 写成新的业务层。它应该统一交互语义，而不是偷存一份自己的持久化状态。
- `RootDirectoryModal` 只对 `source === custom` 的值做输入框回填；不要把 env/shell/default 的当前生效路径直接塞回输入框。
- `SessionManagerPanel` 依赖 `tool + sourcePath` 契约，不能把 `sourcePath` 当作纯展示字段。
- 改会话详情展示时，要优先维护 `sessionManager/detail/domain/` 的纯函数，再让组件消费这些结果。
- 会话详情顶部过滤 chip 是独立"显示/隐藏"开关，不是单选 Tab。
- 会话详情右侧 navigator 点击定位依赖消息/工具 target refs。
- 会话详情里的 Markdown 文本必须复用全局提示词同款 `MarkdownPreview`。
- 会话详情必须走隐藏二级路由页面，不再用大 Modal 承载。
- `SessionManagerPanel` 如果加批量操作，选择范围必须和当前已加载列表严格一致。
- `SessionManagerPanel` 运行在 KeepAlive 页面里，切页后组件通常不会卸载，只会隐藏。任何异步操作完成后的 `message.success/error`、loading 收尾或详情回写，都必须先判断当前页面是否仍处于可见上下文。
- `SessionManagerPanel` 禁止出现"加载更多"按钮或滚动翻页 sentinel。
- `SessionManagerPanel` 的首屏加载 effect 必须按 `tool/sourceMode/query/pathFilter/refreshNonce` 这类真实请求条件去重。
- `SessionManagerPanel` 的后台 `full` 必须等首屏 `cache-first` 请求已经落地后才能启动。
- 高密度管理列表可复用 `management/VirtualGrid`，但拖拽排序模式不要和虚拟化混用。
- `GlobalPromptSettings` 的 `__local__` 只是本地 prompt 文件的临时桥接项，UI 不能把它当正式已应用预设。

## 跨模块依赖

- 被 `pi/` 页面依赖。
- 依赖 Pi 的 service/api，而不是直接操作数据库。
- 与后端 `session_manager/`、Pi commands 形成跨模块契约。

## 最小验证

- 至少验证：一个共享改动在 Pi 页面中表现一致。
- 至少验证：session manager 的 key/sourcePath 契约未被破坏。