# 进度

## 当前状态（2026-11-01）
- 阶段 1（分析，`docs/ANALYSIS.md`）和阶段 2（原型，`docs/STAGE2.md`，v0.2.0）已完成。
- 现在是迭代阶段，按版本号汇报。
  - 用户评价在 `references/remarks/v<版本>/remarks.md`：h3 标题是文件名，下面的列表是评价。
  - 每版报告是 `docs/v<版本>.md`，截图在 `docs/v<版本>/`。
- v0.3.0：`docs/v0.3.0.md`。处理了 v0.2.0 的全部“需修正 / 不足”。
- 2026-11-01 用户更新了 `docs/BRIEF.md`：阶段 1–3 完成，新增阶段 4–7，迭代方式改为“标注 → 约束 / 评判 → 学习”。方法现状见 `docs/methodology.md`。
- 阶段 4（v0.4.0）已确认（2026-11-02）：标注存放位置、预设标签、创新度默认 0.10 都可以。
- **阶段 5（v0.5.0）已完成，等待用户确认约束清单**：报告在 `docs/v0.5.0.md`，约束清单在 `docs/CONSTRAINTS.md`（由代码生成）。
  - 24 条约束全部是“草案”。默认画面只因两处生成修正而变化（D35）；在查看器里勾“修复预览”（`pd=1`）才能看到剪枝和修复。
  - 用户在 2026-11-02 做了 26 条标注（`references/labels/v0.4.0/`），C17–C24 由这些标注而来。
- git：每个版本 commit 一次，并打 tag `v<版本>`。
- 决策记录：`docs/NOTE.md`（D1–D28）。实验功能登记：`docs/EXPERIMENTS.md`。v0.3.0 之后修了两处，没有单独发版：虚化开关的 bug；楼后物件露出屋顶、花园被楼切断（D22）。

## 怎么运行
- 查看器：`cd app && npx vite`，然后打开 http://localhost:5173/?seed=7
  - 快捷键：R 重新生成，F 适应窗口，G 虚化楼上层，A 标注层，E 导出（PNG、_ghost.png、_annotated.png、JSON，有标注时加 _labels.json）。
  - 标注模式：单击选中，Shift+拖动框选，1 / 2 标好 / 坏，Ctrl+Enter 保存，Esc 取消。标注由开发服务器写到 `references/labels/v<版本>/`。
  - URL 参数：`nov=0.3`（创新度），`x=0`（关闭全部实验），`e=exp-01:0`（逐个开关），`pd=1`（修复预览：草案约束也修复），`p=0`（完全不剪枝）。可以把 scene JSON 拖进页面查看。
  - 标注层的“约束”图层：红框 = 违规，灰色叉框 = 已删除的物件，紫框 = 降级的区域，青框 = 改过的地面。
- 回归：`cd app && npx tsx scripts/regress.ts snapshot ../work/regress/<名> [--pd]`，然后：
  - `compare <旧> <新>`：画面签名逐项对比；
  - `report <A> <B>`：画面变化、各约束违规与修复、标注测试；
  - `labels [--pd]`：只跑标注测试；
  - `explain`：检查解释覆盖率。
  - 种子集在 `scripts/regression_seeds.json`（200 个，只增不改）。基线在 `work/regress/v0.3.0`、`v0.4.0`、`v0.5.0`、`v0.5.0-pd`（work/ 不进 git，丢了就从对应 tag 重建）。
- 约束：`npx tsx scripts/constraints.ts gen [n] | refs | doc`。参考图世界先要导出：`cd tools && uv run python export_refworld.py`。
- 修复前后对比图：`cd work/<截图目录> && uv run python ../../tools/compare_crops.py <版本> <输出目录>`。截图要有 `off/`（`--q=p=0`）和 `pd/`（`--q=pd=1`）两组。
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
- `rational/`：阶段 5。
  - `world.ts`：场景 / 参考图 → 统一的世界视图；
  - `graph.ts`：功能连通图；
  - `constraints.ts`：约束清单和判定；
  - `rationalize.ts`：修复，写入 `scene.audit`。
  - 在 `generate()` 的最后调用。
- `main.ts`：Phaser 查看器；`src/viewer/overlay.ts`（标注层绘制，屏幕和 _annotated.png 共用），`src/viewer/labels.ts`（标注格式和存储）。`vite.config.ts` 里有 `/api/labels`。

## 下一步
- 等用户确认阶段 5。`docs/v0.5.0.md` 第 6 节有 7 个问题：约束的生效 / 关闭、空调外机、C02 删哪个、C18 路线、消防栓和垃圾桶的标注、只报告的约束怎么修、空椅子 bug。
- 确认后：
  - 把同意的约束 `status` 改成 `'active'`；
  - 重跑 `constraints.ts doc`；
  - 用 `regress.ts snapshot` 和 `report` 重建基线；
  - 发 v0.5.1。
- 阶段 6：局部评判器与修复。换子种子重生成，可以修那些“只报告”的约束（C19 小路撞墙、C23、C24）。

## 已知问题
- 空椅子从来没放成过：椅子的占地和桌子重叠（v0.5.0 报告 5.1），等用户决定是否修。
- 每张图约 260ms，原来约 80ms，多出来的是连通图和约束判定。
- 建筑 id 很大（b13144）：被拒绝的候选建筑也占编号。id 是随机流标签，改编号会改变画面（D23）。
- 每张图约 27 个空小组（决定放但全被约束拒绝），见 v0.4.0 报告第 3 节。
- `semantics.py` 的类别规则基于名字关键词；参考图统计只用 conf=high 的物件。
- 人物检测召回约七到八成。
- `grid_layer.py` 较慢。
- vite 冷启动后第一次运行 shots.ts 可能超时；一次导出很多种子时也会偶尔超时。逐个种子运行就行。
