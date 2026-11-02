# 进度

## 当前状态（2026-11-01）
- 阶段 1（分析，`docs/ANALYSIS.md`）和阶段 2（原型，`docs/STAGE2.md`，v0.2.0）已完成。
- 现在是迭代阶段，按版本号汇报。
  - 用户评价在 `references/remarks/v<版本>/remarks.md`：h3 标题是文件名，下面的列表是评价。
  - 每版报告是 `docs/v<版本>.md`，截图在 `docs/v<版本>/`。
- v0.3.0：`docs/v0.3.0.md`。处理了 v0.2.0 的全部“需修正 / 不足”。
- 2026-11-01 用户更新了 `docs/BRIEF.md`：阶段 1–3 完成，新增阶段 4–7，迭代方式改为“标注 → 约束 / 评判 → 学习”。方法现状见 `docs/methodology.md`。
- **阶段 4（v0.4.0）已完成，等待用户确认**：`docs/v0.4.0.md`。可解释字段、标注层（A）、好 / 坏标注工具、实验框架。画面与 v0.3.0 完全相同。下一步是阶段 5（合理化后处理）。
- git：每个版本 commit 一次，并打 tag `v<版本>`。
- 决策记录：`docs/NOTE.md`（D1–D28）。实验功能登记：`docs/EXPERIMENTS.md`。v0.3.0 之后修了两处，没有单独发版：虚化开关的 bug；楼后物件露出屋顶、花园被楼切断（D22）。

## 怎么运行
- 查看器：`cd app && npx vite`，然后打开 http://localhost:5173/?seed=7
  - 快捷键：R 重新生成，F 适应窗口，G 虚化楼上层，A 标注层，E 导出（PNG、_ghost.png、_annotated.png、JSON，有标注时加 _labels.json）。
  - 标注模式：单击选中，Shift+拖动框选，1 / 2 标好 / 坏，Ctrl+Enter 保存，Esc 取消。标注由开发服务器写到 `references/labels/v<版本>/`。
  - URL 参数：`nov=0.3`（创新度），`x=0`（关闭全部实验），`e=exp-01:0`（逐个开关）。可以把 scene JSON 拖进页面查看。
- 回归：`cd app && npx tsx scripts/regress.ts snapshot ../work/regress/<名>`，然后 `compare <旧> <新>`（画面签名逐项对比）；`explain` 检查解释覆盖率。种子集在 `scripts/regression_seeds.json`（200 个，只增不改）。基线在 `work/regress/v0.3.0`、`v0.4.0`（work/ 不进 git，丢了就从对应 tag 重建）。
- 批量生成：`cd app && npx tsx scripts/batch.ts ../work/gen 1..12`
- Python 渲染：`cd tools && uv run python render_generated.py ../work/gen/scene_1.json --scale 1 [--ghost]`。注意：它会把 PNG 写在 json 旁边，可能覆盖同名文件。
- 评估：`cd tools && uv run python eval_generated.py <scene.json ...> --out report.md`
- Phaser 实拍：先启动 vite，再 `cd app && npx tsx scripts/shots.ts <outDir> [--anno] 2 3 5`（用系统自带的 Edge；--anno 额外截标注层）。
- 素材元数据有变动时：`cd tools && uv run python export_manifest.py && uv run python export_opaque.py`，写入 `app/src/gen/data/`。

## 代码结构（app/src/gen）
- `rng.ts`：种子 RNG，`fork(label, ctx)` 派生独立的随机流；`choose / count / order / tex` 记录决策轨迹（D24）。
- `exp.ts`：实验功能登记和开关。
- `explain.ts`：车行道和横道的区域说明。
- `layout.ts`：街区形状、道路网、autotile 地面、虚线、横道。
- `buildings.ts`：模块楼和单体建筑工厂。
- `pack.ts`：建筑打包器。
- `block.ts`：主街区规划。
- `neighbours.ts`：邻近街区。
- `vignettes.ts`：路缘段、通行带、红绿灯、路缘设施、店门、巷子、广场、小岛、公交站、车、井盖、行人。
- `yard.ts`：内院逐块分配，包括停车场和车道、花园、楼前空地、过道、绿化带、杂物角、后院。
- `people.ts`：人物合成。
- `place.ts`：放置、占地和禁放区；小组（`group`）、区域（`zone`）、实验标记（`withExp`）、`finish()`。
- `generate.ts`：总调度。
- `main.ts`：Phaser 查看器；`src/viewer/overlay.ts`（标注层绘制，屏幕和 _annotated.png 共用），`src/viewer/labels.ts`（标注格式和存储）。`vite.config.ts` 里有 `/api/labels`。

## 下一步
- 等用户确认阶段 4（`docs/v0.4.0.md` 第 4 节有三个问题）。
- 阶段 5：功能连通图、声明式约束清单（初版交用户确认）、存在理由剪枝、回归报告脚本（在 regress.ts 上扩展）、坏标注 → 约束测试用例。
- v0.3.0 报告里列出的旧候选（屋顶道具等）暂缓：新原则要求反馈优先变成标注和约束，而不是新规则。

## 已知问题
- 建筑 id 很大（b13144）：被拒绝的候选建筑也占编号。id 是随机流标签，改编号会改变画面（D23）。
- 每张图约 27 个空小组（决定放但全被约束拒绝），见 v0.4.0 报告第 3 节。
- `semantics.py` 的类别规则基于名字关键词；参考图统计只用 conf=high 的物件。
- 人物检测召回约七到八成。
- `grid_layer.py` 较慢。
- vite 冷启动后第一次运行 shots.ts 可能超时；一次导出很多种子时也会偶尔超时。逐个种子运行就行。
