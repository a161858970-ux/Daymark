# Responsive Acceptance Matrix

**验证日期**：2026-09-24  
**代码基线**：`ba9fad8 Complete Phase 7H responsive refinement`  
**规格基线**：`11_UX_VISUAL_SPEC.md`、`12_MOTION_SPEC.md`、`13_RESPONSIVE_SPEC.md`

## 1. Result

> **PHASE 7H RESPONSIVE / ACCESSIBILITY: PASS LOCALLY**

本轮使用真实运行中的 Vite 页面、IndexedDB 本地数据和浏览器 viewport override 做断点验收。没有把浏览器 viewport 验收描述成物理手机、Windows 触屏设备或辅助技术实机验收。

## 2. Viewport coverage

### Mobile lane

- `360 × 800`：最小支持宽度；Overview、Course detail、CourseSchedule、Calendar month/week/day、Search、Account、Quick Capture 与 Item Bottom Sheet 均无文档级水平溢出。
- `390 × 844`：主手机基线；底部导航、Quick Capture 安全区与 Bottom Sheet 保持既有语义。
- `430 × 932`：较大手机；仍使用底部导航和 Bottom Sheet，没有提前切换为桌面空间结构。

### Compact desktop lane

- `768 × 900`、`1023 × 900`、`1024 × 900`、`1100 × 900`：保持左侧导航、桌面页面层级和独立侧边详情容器。
- 实现把 `1024–1100px` 继续作为紧凑桌面宽度处理，只缩窄导航与使用 overlay side panel，不切换为 Mobile UI。规格允许在实际测试后微调断点，产品语义未变化。
- Detail 为 Quick Capture 预留右下安全列与底部滚动空间；删除确认操作区与浮动按钮的实测交叠面积为 `0`。

### Full desktop lane

- `1101 × 900`、`1366 × 768`、`1440 × 900`：232px 左侧导航、主内容和持久 Detail container 并存；Quick Capture 在详情打开时移动到主内容侧。
- 所有测试宽度的 `documentElement.scrollWidth <= innerWidth`，未发现页面级横向滚动。

## 3. Touch and spacing

- 在 `360px` 下逐页扫描所有可见且可操作的 `button`、`input`、`select` 与 `textarea`；Overview、Course、CourseSchedule、Calendar、Search、Account 和 Item Detail 中没有小于约 `44 × 44px` 的可见操作目标。
- Quick Capture 与底部导航保持 `18px` 垂直间隔；圆形入口为 `58 × 58px`。
- `360px` 账户 popover 左侧安全距离实测为 `18px`，不会贴边或越出 viewport。
- Calendar Mobile 月视图仍以日期格作为操作目标；狭小 Item segment 在月视图隐藏，日期进入 Single Day 后再打开同一 Item。

## 4. Keyboard and focus

- Windows 主导航可用 Tab 进入；焦点样式实测为 `2px solid` outline，并带约 `3px` offset。
- Enter 可激活当前导航按钮，激活后 `aria-current="page"` 与页面标题同步。
- Quick Capture、Search、Account、Item Detail 均可用 Escape 关闭并返回原 trigger 或 Item 行。
- 临时层采用最上层优先的 Escape 顺序。Calendar Single Day 上分别打开 Quick Capture、Account、Search、Item Detail 后，第一次 Escape 只关闭当前最上层，Single Day 保持打开。
- Course index 被浏览器自动滚动后进入 Course detail，页面会回到 `scrollY = 0`；返回入口实测位于视口内。

## 5. Screen reader semantics

- 主导航使用 `nav` landmark；页面内容使用 `main`；待确认、未完成、已完成、Calendar 与关联事项使用有名称的 region/list 结构。
- Course 与 Calendar mode 使用 `tablist` / `tab` / `aria-selected`；当前主导航使用 `aria-current="page"`。
- Search 使用 `role="dialog"` 与 `aria-modal="true"`，输入自动聚焦并循环 Tab。
- Mobile Item Detail 根据 `<768px` media query 暴露 `aria-modal="true"`；pointer backdrop 从 accessibility tree 隐藏；Shift+Tab 从第一个控件循环到最后一个控件，Tab 从最后一个控件回到关闭按钮。
- Compact/full desktop Item Detail 不声明 modal，保留桌面持久/overlay side container 语义。
- 从 `1366 → 390 → 1023 → 1366` 调整宽度时，Detail 始终保持同一 `data-item-id`；只改变空间容器和 modal 语义。

## 6. Motion and state semantics

- `prefers-reduced-motion` 规则仍把动画与 transition 压缩到 `0.01ms`；JavaScript exit presence 在 reduced motion 下不增加等待。
- 完成状态继续同时使用勾选、删除线和文字，未只依赖颜色。
- Resize、Search、Calendar 和 Detail 验收过程中没有创建第二份 Item；Calendar 仍只投影 Item，不读取 CourseSchedule。

## 7. Automated and runtime evidence

- `pnpm build`：PASS；Vite 仅报告约 `545 kB` 主 bundle 的非阻塞 size warning。
- `pnpm test`：**88 passed，1 skipped**。
  - domain：10 passed
  - application：4 passed
  - storage：30 passed
  - API：21 passed，1 个真实 PostgreSQL gate skipped
  - Web：23 passed
- `pnpm lint`：PASS。
- `pnpm format:check`：PASS。
- Vite dev server：HTTP 200；本轮浏览器 console error：0。

## 8. Limits of this evidence

- 尚未在物理手机、Windows 触屏设备、屏幕阅读器或移动软键盘上执行实机验收。
- 真实 PostgreSQL、Supabase authentication 与两个独立浏览器/物理设备同步生命周期仍受外部配置阻塞。
- 这些限制进入 Phase 8 / release validation，不改变本轮本地响应式实现的 PASS 结论。
