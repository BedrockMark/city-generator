# 进度

## 当前状态（2026-11-01）
- 阶段 1（分析）已完成：`docs/ANALYSIS.md`。
- **阶段 2（原型）已完成，等待用户反馈**：`docs/STAGE2.md`，截图在 `docs/stage2/`（种子 2、3、5、7、8、9 + overview + eval.md）。生成器版本 v0.2.0。
- 决策记录：`docs/NOTE.md`（D1–D15）。

## 怎么运行
- 查看器：`cd app && npx vite`，然后打开 http://localhost:5173/?seed=7
  - 快捷键：R 重新生成，F 适应窗口，E 导出 PNG + JSON。
- 批量生成：`cd app && npx tsx scripts/batch.ts ../work/gen 1..12`
- Python 渲染：`cd tools && uv run python render_generated.py ../work/gen/scene_1.json --scale 1`
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
- `vignettes.ts`：所有功能小组和路缘节奏带。
- `people.ts`：人物合成。
- `place.ts`：放置、占地和禁放区。
- `generate.ts`：总调度。
- `main.ts`：Phaser 查看器。

## 下一步（等用户反馈后定优先级）
STAGE2.md 的不足 1–7：
- 建筑剪影：任意宽度、屋顶道具；
- 街面密度和人群；
- 内院边角；
- 交通设施数量；
- 楼前过渡；
- 车位线；
- 邻近街区的表现。

## 已知问题
- `semantics.py` 的类别规则基于名字关键词；参考图统计只用 conf=high 的物件。
- 人物检测召回约七到八成。
- `grid_layer.py` 较慢。
- vite 冷启动后第一次运行 shots.ts 可能超时，再跑一次即可。
