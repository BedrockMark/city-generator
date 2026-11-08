# 归档：A/B 选择（阶段 7）

v0.7.6（2026-11-07）起，查看器里的 A/B 模式（B 键）停用，代码挪到这里，不参与编译和测试。

## 这里有什么
- `app/` 下按原目录结构放着只属于 A/B 的文件：
  - `src/viewer/ab.ts`：查看器的 A/B 会话、绘制、回答存储；
  - `src/gen/learn/ab.ts`、`ab.test.ts`：出题（局部 A/B、大改动题、手动题）；
  - `src/gen/learn/diff.ts`：两张图的差异框；
  - `scripts/abcheck.ts`：出题检查。
- `pre-cleanup/`：清理前（v0.7.5，commit `d38c65d`）和 A/B 连在一起的文件的完整副本：`main.ts`（B 键、手动出题面板）、`index.html`（A/B 侧栏）、`gen.worker.ts`（在 Worker 里出题）、`vite.config.ts`（`/api/choices`）、`rng.ts`（`Trace.force` 强制决策）。

## 还留在项目里的
- 已有的回答：`references/choices/v0.7.0/`（17 个文件）。偏好训练（`app/scripts/prefs.ts train`）仍然读它们，`app/src/gen/learn/data.ts` 的 `loadChoiceComparisons` 不依赖 A/B 代码。
- 学到的偏好（`app/src/gen/data/prefs.json`）照常使用，查看器顶栏的“学到的偏好”复选框仍在。

## 恢复
最简单的是从 tag `v0.7.5` 取回：`git checkout v0.7.5 -- app/src/viewer/ab.ts app/src/gen/learn/ab.ts …`，再把 `pre-cleanup/` 里 A/B 相关的部分合回 `main.ts`、`index.html`、`gen.worker.ts`、`vite.config.ts`，并在 `rng.ts` 的 `Trace` 里加回 `force`。A/B 出题还依赖已删除的 exp-02（整体修图）记录的 `options.reseed` / `judgeFixed`，恢复时去掉这部分即可。
