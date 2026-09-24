# UI Surface Audit

**审计日期**：2026-09-24  
**规格基线**：`11_UX_VISUAL_SPEC.md`、`12_MOTION_SPEC.md`、`13_RESPONSIVE_SPEC.md`  
**代码基线**：Phase 6 implementation closure 后、Phase 7 视觉改造前

## 总体判断

当前 Web 已具备大部分产品流程和基础响应式骨架，但视觉仍是工程基线：层级、页面宽度、导航语义、状态反馈与键盘行为尚未形成统一系统。Phase 7 保留现有 domain/application 行为，以 design tokens、共享 surface component 和明确的 desktop/mobile wrapper 收敛表现。

## Phase 7 progress — 2026-09-24

以下状态记录基线审计之后的实施结果。后续 20 个 surface 条目保留改造前证据，7A–7F 的当前状态以本节为准。

### 7A — Shell / Navigation / Tokens — PASS locally

- 建立 canvas、surface、ink、accent、danger、line、radius、shadow 与 motion tokens。
- Windows 使用 232px 左侧导航；Mobile 使用带安全区的底部导航；窄桌面详情改为 overlay，主内容不被强行压缩。
- 导航切页会结束临时详情/删除上下文；active、hover、focus-visible 和 reduced-motion 状态统一。
- 增加首载、本地离线说明与基础 surface state；离线文案明确新记录仍先保存在本机。
- 通过 desktop 与 390×844 viewport 人工检查，Web build/test/lint/format 均通过。

### 7B — Overview / Course / Item hierarchy — PASS locally

- 收敛 page header、eyebrow、deck、section heading、Item row、Course index、Course detail 与空态层级。
- 完成控件与 Item 主体保持两个独立 hit target；Completed 默认折叠并保持低权重视觉。
- 课程创建和 CourseInformation 新增改为按需展开；课程页显示学期上下文与未完成数量，不引入排名或 Dashboard。
- desktop/mobile 的 Overview、Course index、Course detail 已人工检查；相关静态渲染测试通过。

### 7C — Quick Capture — PASS locally

- 全局只挂载一个连续形变控件；圆形 `+` 向左展开，输入框保持同一 DOM identity。
- 自动聚焦、Enter 保存、成功后保持展开并可连续记录；外部点击与 Escape 收起，Escape 将焦点还给 `+`。
- 本地保存成功、失败和 busy 状态均有可访问反馈；Course、Overview 与 Calendar 共享同一入口。
- desktop 与 390×844 viewport 已验证输入、保存、连续记录和收起行为。

### 7D — Detail / Edit / Complete / Delete / Undo — PASS locally

- Windows 保持一个右侧 detail container；对象切换只替换容器内部内容，并用 selection/ref guard 阻止过期异步刷新写回旧对象。
- Mobile 使用带 backdrop、drag handle、独立滚动和安全区的 Bottom Sheet；390×844 计算样式与视觉检查通过。
- Detail facts、补充内容、关联、提醒、原始记录、状态动作和危险操作形成明确层级；Edit 在同一容器内完成。
- Escape 依次退出删除确认、编辑态和临时详情；打开时聚焦关闭按钮，编辑时聚焦标题，关闭后返回当前 Item 行。
- 完成先立即进入勾选/删除线状态，保持约 180ms 后短移淡出；目标区、恢复与 Undo 使用短距离进入。删除确认后使用 240ms 离场并提供限时 Undo；两类 Undo 都恢复同一 Item identity。
- 删除的真实本地行为由 application/storage 自动测试验证；浏览器人工验收到二次确认界面，没有为视觉检查删除现有本地记录。

### 7E — Calendar Month / Week / Day — PASS locally

- 月/周视图使用传统七列日历与单一范围导航；Calendar 只接收 Item，不读取或投影 CourseSchedule。
- 多日 Item 保持一个 identity，并以跨日期连续 segment 呈现；完成项仍留在原日期与时间位置，同时通过勾选、删除线和降低权重表达状态。
- Single Day 按真实投影时间排序，显示时间、课程和完成语义；点击后打开现有 Item Detail，不创建第二份对象。
- Mobile 月视图隐藏狭小 event target，整格日期进入 Single Day，再进入 Bottom Sheet；两次 Escape 分别关闭 Item Detail 与 Single Day，并把焦点还给原日期。
- 翻月/翻周使用统一短方向 transition；today、selected、overflow、empty 和 reduced-motion 状态均已覆盖。
- desktop 与 390×844 viewport 已人工检查；Calendar/domain 自动测试、Web build、全仓测试、lint 和 format 均通过。

### 7F — Search / Attention / Account / State surfaces — PASS locally

- Windows 左侧固定入口与各页面 header shortcut 打开同一套全局搜索；Mobile 只保留 header 入口，搜索不进入一级导航。
- 搜索在本机按规范化关键词匹配 Item 标题/详情、Course 名称/教师与 CourseInformation 内容，按对象类型分组并保持源顺序，不加入复杂筛选、AI 相关性排名或第二套详情对象。
- Item 结果打开现有 Item Detail；Course 进入原课程页；CourseInformation 进入对应课程信息位置并提供短暂到达提示。
- unresolved、field/collection conflict 与 ACTION_REQUIRED 使用统一轻量摘要；待确认记录启动时展开，冲突与修复默认收起，展开后仍保留既有字段选择、整组选择、删除边界和二次确认。
- 账户入口在无外部配置时也显示“仅本机”；已建模 signed-out、offline、syncing、up-to-date、needs-attention 与 error 文案。后台同步保持安静，不显示持续 spinner 或内部队列术语。
- Search、账户 popover、attention disclosure 的 Escape、外部关闭与焦点返回已验证；desktop 与 390×844 viewport 人工检查通过。
- 全仓 build/test/lint/format 通过：82 passed，1 个真实 PostgreSQL gate skipped。

### Remaining

- **7G**：全局 motion consistency、Calendar 完成态与跨 surface polish。
- **7H**：完整 responsive/accessibility matrix 与最终视觉 acceptance。

## 1. Desktop Navigation — Stage 7A

- **Current implementation**：204px 固定左栏，品牌文字与事项总览/课程/日程三个按钮；账户入口固定在左下。
- **Spec requirements**：稳定左侧导航；事项、课程、日程为核心空间；搜索在左侧或 header；充分使用桌面横向空间。
- **Missing**：搜索入口；导航图形/辅助文案；同步状态的安静呈现。
- **Visually incorrect**：按钮层级接近临时后台菜单，品牌、活动项和账户区之间缺少编辑式节奏。
- **Interactionally incorrect**：切页没有统一的 active/focus 反馈；切页未明确关闭移动端临时容器。
- **Responsive issue**：204px 和 360px detail 使用固定宽度，窄桌面容易压缩主内容。
- **Motion issue**：活动项与布局重排只有基础颜色/margin transition。

## 2. Mobile Navigation — Stage 7A

- **Current implementation**：767px 以下把同一 nav 改为底部横排，三个文本按钮常驻。
- **Spec requirements**：底部导航保留三大核心空间；触控目标约 44px；Quick Capture 独立于一级导航。
- **Missing**：安全区、选中指示与图形语义的完整组合；顶部 global search 入口。
- **Visually incorrect**：仅文本均分，选中状态与桌面相同，移动端空间语言不够明确。
- **Interactionally incorrect**：导航时可能保留详情或课程子上下文；需要明确上下文关闭规则。
- **Responsive issue**：小于 360px 时账户、header、底栏与 Quick Capture 可能竞争空间。
- **Motion issue**：选中项没有短 transition；底栏本身无需额外进出动画。

## 3. Overview — Stage 7B

- **Current implementation**：标题、学期选择、unresolved panel、ItemList；未完成展开，已完成折叠。
- **Spec requirements**：内容优先；时间未定项目在前；当前学期课程事项 + 全部无课程事项 + 历史未完成；不做 Dashboard。
- **Missing**：加载状态；更清晰的当前/历史学期上下文；header 搜索入口。
- **Visually incorrect**：页面标题与列表之间留白偏大，列表线条和空态仍像开发样式；pending panel 抢占主层级。
- **Interactionally incorrect**：全局错误固定浮层，但刷新/处理中没有局部反馈。
- **Responsive issue**：移动端 header 与学期选择的换行、长课程名需专门布局。
- **Motion issue**：事项进入、恢复与排序变化没有统一 enter/reorder 动画。

## 4. Course View — Stage 7B

- **Current implementation**：课程索引、创建课程/学期、课程详情三 tab（事项/课程信息/课程安排）、课程删除确认。
- **Spec requirements**：课程索引而非 Dashboard；事项与课程信息为平行功能；课程 context 下新增事项不再猜课程。
- **Missing**：课程详情的清晰返回/面包屑语义；课程信息/安排的成熟空态；desktop 可用宽度策略。
- **Visually incorrect**：表单长期占据索引顶部，削弱课程列表；课程 header、tab 和危险操作层级接近。
- **Interactionally incorrect**：tab 之外缺少键盘 tablist 语义；创建/编辑错误多依赖全局 banner。
- **Responsive issue**：课程安排表单在手机上字段密集；课程 header actions 易挤压。
- **Motion issue**：课程索引 → 详情及 tab 内容切换没有上下文连续性。

## 5. Calendar Month — Stage 7E

- **Current implementation**：七列月历、周次、日期与多日 segment；桌面可点事项，手机点日期进入 day view。
- **Spec requirements**：传统月历；Calendar 只显示 Item；多日 Item 为连续对象；周行显示学期周次/假期边界。
- **Missing**：溢出策略、today emphasis、loading/empty state 与更清晰的 month navigation。
- **Visually incorrect**：日期格高度偏小，segment 像紧凑标签，连续范围的视觉连接较弱。
- **Interactionally incorrect**：桌面日期与事项点击层次需更明确；手机不能要求命中狭小 event。
- **Responsive issue**：小屏七列仍展示 event text，易造成误触与拥挤。
- **Motion issue**：翻月只有数据瞬换，未表达方向与稳定 header。

## 6. Calendar Week — Stage 7E

- **Current implementation**：CalendarView 内存在 week mode，按七日投影事项。
- **Spec requirements**：按周观察事项的日期分布；不是课表；多日事项连续跨日。
- **Missing**：更明确的周范围标题、无时间事项排除说明与 dense content strategy。
- **Visually incorrect**：与月视图共享过多视觉结构，周视图缺少独立时间层级。
- **Interactionally incorrect**：事件 hit target 与日期选择需要分离。
- **Responsive issue**：移动端横向密度仍高，应保留七日语义并降低单格操作负担。
- **Motion issue**：前后周导航没有方向性短 transition。

## 7. Calendar Day — Stage 7E

- **Current implementation**：选中日期后在月历下方显示列表；手机隐藏月历，只保留 day detail。
- **Spec requirements**：日期/星期、按时间排序的全部有时间事项、课程信息；点击 Item 打开原生详情。
- **Missing**：明确返回月视图的手机控制；更完整时间/课程层级与 day empty state。
- **Visually incorrect**：目前更像月历附属列表，未形成精细操作空间。
- **Interactionally incorrect**：手机进入/返回路径不够显式。
- **Responsive issue**：day view 与底部导航、Quick Capture、Bottom Sheet 的滚动边界需验证。
- **Motion issue**：日期 → 单日空间为突然替换。

## 8. Search — Stage 7F

- **Current implementation**：未实现 UI 或查询流程。
- **Spec requirements**：全局关键词定位；Windows 左栏与 header 可达，Mobile header 可达；按事项/课程信息轻量分组；不做复杂筛选或自动排名。
- **Missing**：全部。
- **Visually incorrect**：不适用。
- **Interactionally incorrect**：不适用。
- **Responsive issue**：需分别设计 desktop search surface 与 mobile overlay/sheet，同时复用同一查询语义。
- **Motion issue**：只需短 reveal/close，结果更新不得炫技。

## 9. Quick Capture — Stage 7C

- **Current implementation**：右下圆形 `+`，点击后 CSS width 向左展开；外部 pointerdown 收起；保存后清空并保持展开。
- **Spec requirements**：同一控件连续形变；本地保存后轻量成功反馈；连续记录；不打开 modal。
- **Missing**：Escape 收起；保存/失败的控件内状态；更完整的 success 内容层级。
- **Visually incorrect**：整条深绿色胶囊较重，输入与提交区边界弱；桌面与详情打开时的位置关系未精调。
- **Interactionally incorrect**：展开时点击提交按钮在空输入下无反馈；按钮 disabled 语义不明显；外部点击会丢弃未提交文字而无提示策略。
- **Responsive issue**：宽度基于视口和固定 nav，窄桌面/detail open 时可能重叠；手机键盘弹起未验证。
- **Motion issue**：只有 width transition，缺少 icon morph、输入 reveal 与 reduced-motion 下的专门状态。

## 10. Item Detail — Stage 7D

- **Current implementation**：Windows 固定右侧 aside；Mobile bottom sheet + backdrop；查看课程、时间、提醒、详情、关联、原始记录、状态操作与删除。
- **Spec requirements**：单一对象容器；Windows 持久 side container；Mobile Bottom Sheet；对象切换保留容器；内容顺序清晰。
- **Missing**：语义化时间摘要、drag handle/移动端容器提示、Escape close、焦点管理。
- **Visually incorrect**：360px 全高面板偏工具栏感；元信息为连续段落，主要动作与关联内容层级不足。
- **Interactionally incorrect**：未做 focus trap/return focus；desktop close 后上下文焦点不恢复。
- **Responsive issue**：窄桌面应转 temporary side panel；当前只在 767px 切成 sheet。
- **Motion issue**：每次 item id 变化重置内容但没有同容器内淡出/淡入；进入动画已存在但 timing/token 未统一。

## 11. Item Edit — Stage 7D

- **Current implementation**：同一 detail container 原地切 form；包含规格字段；保存/取消可用。
- **Spec requirements**：保持详情上下文；字段不强制填满；保存回 detail，取消不改数据；Windows Escape 可退出编辑。
- **Missing**：字段分组、inline validation、未保存保护/明确取消反馈、Escape。
- **Visually incorrect**：长表单字段权重一致，时间语义难扫读；save/cancel 与 destructive 区域层级需拉开。
- **Interactionally incorrect**：切换其他 Item 会直接重置未保存编辑；resize/context switch 行为需保护。
- **Responsive issue**：手机键盘、datetime fields 和 sheet 内滚动尚未专门处理。
- **Motion issue**：detail ↔ edit 突然替换，没有短 crossfade；错误仅由全局 banner 呈现。

## 12. Course Detail / Course Information — Stage 7B

- **Current implementation**：课程 header、tab、内联新增事项、课程信息增改删与课程安排维护。
- **Spec requirements**：事项和课程信息并列但分离；信息统一列表；添加入口简单低干扰。
- **Missing**：信息列表成熟空态、编辑状态层级、课程详情 context summary。
- **Visually incorrect**：新增表单长期展开，`+ 添加` 的轻量入口语义未实现；多类操作按钮样式不统一。
- **Interactionally incorrect**：信息删除缺少与 Item 删除一致的明确反馈语言。
- **Responsive issue**：手机必须保持单 tab 纵向流；桌面可利用宽度但不能混成 feed。
- **Motion issue**：内联新增/编辑没有 reveal/collapse transition。

## 13. Semester Context — Stage 7A/7B/7E

- **Current implementation**：Overview/Course 使用 select；Calendar 根据可见月份显示学期并显示周次。
- **Spec requirements**：当前与历史严格区分；Calendar context 随月份变化；不覆盖核心导航。
- **Missing**：历史状态的醒目标注、无当前学期状态、窄屏 selector 策略。
- **Visually incorrect**：原生 select 在 header 中偏工程化，context 层级与 page title 联系弱。
- **Interactionally incorrect**：切换 semester 会重置 course，但缺少可感知的 context change。
- **Responsive issue**：移动 header 横向空间不足时需独立行。
- **Motion issue**：内容切换无轻量过渡；不得做整页滑动。

## 14. Completed Section — Stage 7B/7D

- **Current implementation**：默认折叠，显示数量；完成项降灰、删除线；完成 420ms 后移出未完成区。
- **Spec requirements**：原位完成反馈 → completion hold → 短移/淡出 → completed 区进入；恢复为反向语义。
- **Missing**：已完成区新项 enter/restore motion；完成控件在已完成项上目前不可直接恢复，仅详情可恢复。
- **Visually incorrect**：折叠控制的箭头与 section typography 粗糙；完成项仍保持相近行高但层级可更安静。
- **Interactionally incorrect**：连续快速完成时 timer/refresh 需要视觉稳定性检查。
- **Responsive issue**：触控目标已接近规格，但完成与正文之间需用可见空间边界强化。
- **Motion issue**：现有 420ms 合并 hold+leave，未使用 180ms hold token；目标区没有对应进入。

## 15. Ambiguity / Unresolved Capture — Stage 7F

- **Current implementation**：Overview 顶部 pending panel；支持 Item/CourseInformation、split、defer、delete 与完整字段确认。
- **Spec requirements**：只处理实质性歧义；轻量、非 wizard；多条纵向独立处理；用户可查看/删除未解决 RawCapture。
- **Missing**：优先级更安静的 summary/expand；处理中状态；与 capture success 明显但一致的 surface language。
- **Visually incorrect**：完整 resolution form 会大面积占据 Overview，像管理后台表单。
- **Interactionally incorrect**：复杂 split/resolution 原地展开可能把用户推离当前浏览位置。
- **Responsive issue**：移动端多列 resolution grid 已折行但表单仍很长。
- **Motion issue**：展开、解决、defer、删除均为突然变化。

## 16. Conflict UI — Stage 7F

- **Current implementation**：显示对象、冲突字段、本机/已同步/显式值；collection 只按整组选择；不泄露内部字段。
- **Spec requirements**：仅展示用户可理解的信息；真正冲突才要求选择；保留删除边界。
- **Missing**：统一的 attention summary、解决中和成功 transition。
- **Visually incorrect**：大块浅色 panel + 多 fieldset 容易压过当前页面；radio card 密度偏高。
- **Interactionally incorrect**：冲突长期插在所有 page 顶部，缺少定位与折叠策略。
- **Responsive issue**：手机单列可用但长冲突需要独立滚动/逐条清晰结束点。
- **Motion issue**：解决后直接消失；需短 collapse/fade 保留因果。

## 17. ACTION_REQUIRED — Stage 7F

- **Current implementation**：显示可读原因、查看对象、允许时重交或二次确认采用已同步状态。
- **Spec requirements**：不清空错误、不静默删除；修复行为有明确语义和 provenance。
- **Missing**：legacy migration issue 的更针对性文案；同步恢复中的持续状态。
- **Visually incorrect**：与 Conflict 共用同一大 panel，严重程度与操作性质区分不足。
- **Interactionally incorrect**：查看无法恢复 local object 的 legacy delete 会回 Overview，但缺少“重新保存父集合”的明确路径说明。
- **Responsive issue**：确认区在手机上需要保持主要/次要动作顺序。
- **Motion issue**：重交/采用已同步状态完成后没有局部离场反馈。

## 18. Reminder / Notification Settings — Stage 7D/7F

- **Current implementation**：Item Detail/Edit 可查看并设置 OFF/NORMAL/HIGH；无全局 notification settings。
- **Spec requirements**：提醒附属于已有 Item；不做自动规划；生产 numeric policy 保持 release gate。
- **Missing**：平台权限/通知可用性状态、quiet hours 等全局设置 UI 尚未实现；R-01 仍未决。
- **Visually incorrect**：提醒等级只是普通 select/文本，没有解释语义。
- **Interactionally incorrect**：无法区分“Item 关闭提醒”和“系统通知不可用”。
- **Responsive issue**：详情内字段可共享；未来设置 surface 需适配 desktop/mobile。
- **Motion issue**：级别改变只需微反馈，无需额外动画。

## 19. Account / Sync State — Stage 7F

- **Current implementation**：desktop 左下、mobile 右上账户按钮和 popover；支持邮箱/密码登录、退出；冲突/repair 另行显示。
- **Spec requirements**：账户与同步状态可理解但不主导产品；离线 capture 仍可用。
- **Missing**：offline/syncing/up-to-date 状态、上次同步信息、真实环境错误分类。
- **Visually incorrect**：账户入口漂浮于 shell 外，移动端与 page header 竞争；popover 像开发工具。
- **Interactionally incorrect**：点击外部/Escape 关闭和焦点管理不足；同步状态不可见。
- **Responsive issue**：mobile popover 宽度可用但顶部布局需纳入统一 header。
- **Motion issue**：popover 无 reveal/close token；同步状态不应使用持续 loading 动画。

## 20. Loading / Empty / Error / Offline States — Stage 7A/7B/7F

- **Current implementation**：ItemList 有简单 empty text；全局 error banner；按钮局部 busy 文案；没有 app loading、offline 或 syncing surface。
- **Spec requirements**：Loading、Empty、Error、Offline、Syncing、Conflict、Completed、Unresolved、ACTION_REQUIRED 都要可区分；反馈非阻塞。
- **Missing**：首载 skeleton/progress、页面级 empty pattern、offline persistent indicator、syncing quiet state、可恢复 error action。
- **Visually incorrect**：error 和 feedback 都是底部深色条，层级/语义区分有限；empty state 只是留白文字。
- **Interactionally incorrect**：error 只能关闭，缺少与具体失败动作关联的重试；离线没有解释“已保存在本机”。
- **Responsive issue**：feedback、Quick Capture、bottom nav、mobile keyboard 可能重叠。
- **Motion issue**：feedback 有固定 timeout 但无 enter/exit keyframe；loading 不应加入无意义动画。

## Phase 7 execution gates

- **7A — PASS locally**：shell、导航、layout tokens、viewport ranges、shared page header 与基础 state surfaces。
- **7B — PASS locally**：Overview/Course/Item hierarchy、空态、completed section 基础视觉。
- **7C — PASS locally**：Quick Capture 连续形变、键盘/外部点击、保存/失败反馈。
- **7D — PASS locally**：detail/edit、completion/delete/undo；desktop 单容器、mobile sheet。
- **7E — PASS locally**：Calendar month/week/day、连续 range、移动日视图、方向 motion 与焦点返回。
- **7F — PASS locally**：全局 Search、unresolved、Conflict、ACTION_REQUIRED、Account/Sync 与状态 surface。
- **7G–7H — PENDING**：未完成项保留在本审计中，继续按阶段验证。
