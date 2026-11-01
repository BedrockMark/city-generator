# 进度

## 当前状态（2026-11-01）
- 阶段 1（分析，`docs/ANALYSIS.md`）和阶段 2（原型，`docs/STAGE2.md`，v0.2.0）已完成。
- 现在是迭代阶段，按版本号汇报。
  - 用户评价在 `references/remarks/v<版本>/remarks.md`：h3 标题是文件名，下面的列表是评价。
  - 每版报告是 `docs/v<版本>.md`，截图在 `docs/v<版本>/`。
- **v0.3.0 已完成，等待用户评价**：`docs/v0.3.0.md`。处理了 v0.2.0 的全部“需修正 / 不足”。
- git：每个版本 commit 一次，并打 tag `v<版本>`。
- 决策记录：`docs/NOTE.md`（D1–D21）。

## 怎么运行
- 查看器：`cd app && npx vite`，然后打开 http://localhost:5173/?seed=7
  - 快捷键：R 重新生成，F 适应窗口，G 虚化楼上层，E 导出（PNG、_ghost.png、JSON 三个文件）。
- 批量生成：`cd app && npx tsx scripts/batch.ts ../work/gen 1..12`
- Python 渲染：`cd tools && uv run python render_generated.py ../work/gen/scene_1.json --scale 1 [--ghost]`。注意：它会把 PNG 写在 json 旁边，可能覆盖同名文件。
- 评估：`cd tools && uv run python eval_generated.py <scene.json ...> --out report.md`
- Phaser 实拍：先启动 vite，再 `cd app && npx tsx scripts/shots.ts <outDir> 2 3 5`（用系统自带的 Edge）。
- 素材元数据有变动时：`cd tools && uv run python export_manifest.py`，写入 `app/src/gen/data/`。

## 代码结构（app/src/gen）
- `rng.ts`：种子 RNG，`fork(label)` 派生独立的随机流。
- `layout.ts`：街区形状、道路网、autotile 地面、虚线、横道。
- `buildings.ts`：模块楼和单体建筑工厂。
- `pack.ts`：建筑打包器。
- `block.ts`：主街区规划。
- `neighbours.ts`：邻近街区。
- `vignettes.ts`：路缘段、通行带、红绿灯、路缘设施、店门、巷子、广场、小岛、公交站、车、井盖、行人。
- `yard.ts`：内院逐块分配，包括停车场和车道、花园、楼前空地、过道、绿化带、杂物角、后院。
- `people.ts`：人物合成。
- `place.ts`：放置、占地和禁放区。
- `generate.ts`：总调度。
- `main.ts`：Phaser 查看器。

## 下一步
- 等用户对 v0.3.0 的评价。
- `docs/v0.3.0.md` 里列出的候选：
  - 屋顶道具；
  - 后院内容在正常视图里的可见性；
  - 花园被切成很窄的两条；
  - 停车场旁边的沥青边；
  - 路边车位线。

## 已知问题
- `semantics.py` 的类别规则基于名字关键词；参考图统计只用 conf=high 的物件。
- 人物检测召回约七到八成。
- `grid_layer.py` 较慢。
- vite 冷启动后第一次运行 shots.ts 可能超时；一次导出很多种子时也会偶尔超时。逐个种子运行就行。
