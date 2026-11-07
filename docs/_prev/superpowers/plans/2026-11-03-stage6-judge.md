# 阶段 6 实现计划：局部评判器与修复（v0.6.0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给生成图和参考图的每个 8×8 格窗口打可解释的“怪异分”（参考图 vs 生成图的 L1 逻辑回归），并用“换子种子重生成 + 降级”修复最怪的窗口（实验 exp-02）。

**Architecture:** 新目录 `app/src/gen/judge/`：`align.ts` 把场景 / 参考图降到同一视力（`JWorld`），`features.ts` 在窗口上算特征，`model.ts` 训练和打分，`labelset.ts` 把用户标注变成窗口标签，`repair.ts` 做修复。`rng.ts` 加“盐”，`place.ts` 给每个放置记下随机流。`generate()` 拆成 `generateBase()`（原流程，含约束修复）+ 评判 + 修复。查看器把生成挪到 Web Worker，以显示进度。

**Tech Stack:** TypeScript（tsx、vite、Phaser 3），Node 自带 `node:test`（不加依赖），Python（uv）只用来导出数据表和画热力图。

**Spec:** `docs/superpowers/specs/2026-11-03-stage6-judge-design.md`（2026-11-03 补充版）。

## Global Constraints
- 不加 npm 依赖。测试用 `node:test` + `node:assert/strict`，跑法 `cd app && npx tsx --test src/gen/judge/*.test.ts src/gen/*.test.ts`（package.json 加 `"test"` 脚本）。
- 窗口 8×8 格（128px），步长 4 格；有效地面（≠ none）不足 32 格的窗口不用。
- 5 类地面：`road`、`paved`、`grass`、`wall`、`other`（另有 `none`）。物件类别 = `semantics.py` 的 17 类（不含 building），未知 → `other`；参考图只用 `conf = high`。
- 标签：参考图 = 0，生成图 = 1；标注坏 = 1、好 = 0，权重 5；只用 `references/labels/v0.5.1/` 起的标注，读标注时存下的 scene.json。
- 阈值 = 参考图窗口得分 90 百分位；整体档触发线 = 参考图整图平均分 90 百分位。
- 修复：最多 3 个窗口，每窗口盐 1..6；条件 2 的容差 = 0.05 × 窗口外窗口数；整体档 4 个候选，`judgeGlobal` 默认关。
- 只报告约束：`C19`、`C23`、`C24`。
- exp-02 关掉（`e=exp-02:0`）时，200/200 种子画面与 `work/regress/v0.5.1` 相同。exp-02 开着但没有窗口需要修时，画面也不变。
- 解释字段（`stream`、`exp`、`judge`、`judgeRepair`）只写不读，不进画面签名。
- `VERSION = '0.6.0'`。项目惯例：整个版本只在最后 commit 一次并打 tag `v0.6.0`；中途不 commit。
- 用户可见的文字（特征名、报告、查看器）用中文。

## Review Focus
1. **加盐流的子流**：`fronts/b7` 加盐后，它的子流（`fronts/b7/...`）也要变，而它的兄弟流不变；`reseed` 的键必须是逻辑路径（不带 `#盐`），否则嵌套加盐失效。→ Task 2 测试 `reseed salts a stream and its descendants only`。
2. **参考图坐标有相位**（`phase`、`origin`）：窗口必须按参考图的格子对齐，物件坐标换算到同一原点，否则特征全错。→ Task 3 测试 `alignRef puts objects into the right cells`。
3. **可放置面积为 0 的窗口**（全是马路或墙）：密度类特征除以 0。→ Task 4 测试 `features are finite on an all-road window`。
4. **从导出的 JSON 重现修复结果**：`options` 里带了 `reseed` + `judgeFixed`，再调 `generate` 必须得到同一画面，而且不再搜索。→ Task 8 测试 `repaired scene reproduces from its options`。
5. **标注场景是旧版本存下的**（字段可能不全：没有 `stream`、没有 `fp`）：读取不能崩。→ Task 5 测试用真实的 v0.5.1 标注文件。

---

### Task 1: 视力对齐用的数据表（Python 导出）

**Files:**
- Create: `tools/export_judge_data.py`
- Create（生成）: `app/src/gen/data/tileclass.json`、`app/src/gen/data/semclass.json`
- Modify: `app/package.json`（加 `"test": "tsx --test src/gen/judge/*.test.ts src/gen/*.test.ts"`）
- Test: `app/src/gen/judge/data.test.ts`

**Interfaces:**
- Produces: `tileclass.json` = `{ city: [cls, opaque][], auto: ..., terr: ... }`，按 `row * SHEET_COLS[sheet] + col` 索引。`cls` 是对图块不透明像素调用 `semantics.ground_class` 的结果（`paved / grass / road / sand / dirt / water / other`），`opaque` 是不透明像素比例（0–1，保留 2 位小数）。`semclass.json` = `{ "<pack>/<name>": cls }`，覆盖 `sprites.json` 的全部 key，值是 `semantics.sprite_class(name, pack)`。

- [ ] **Step 1: 写测试** `data.test.ts`：
  - `tileclass.terr[12 * 32 + 1]` 是 `['grass', 1]`（草坪 9 宫格的中心）；
  - `city` 表的长度 = 59 × 图片行数；
  - `semclass['<某个 Street_Lamp key>'] === 'street_lamp'`、`semclass['<某个 Bench key>'] === 'bench'`（从 sprites.json 里任选）；
  - semclass 的 key 集合 = sprites.json 的 key 集合。
- [ ] **Step 2:** `cd app && npm test`，预期失败：文件不存在。
- [ ] **Step 3:** 写 `export_judge_data.py`（`from semantics import ground_class, sprite_class`；sheet 路径照 `types.ts` 的 `SHEETS`；只对不透明像素取中位数，全透明的图块记 `['', 0]`）。运行 `cd tools && uv run python export_judge_data.py`。
- [ ] **Step 4:** `npm test` 通过。

### Task 2: 随机流加盐，放置记下随机流

**Files:**
- Modify: `app/src/gen/rng.ts`、`app/src/gen/place.ts`、`app/src/gen/types.ts`、`app/src/gen/generate.ts`、`app/src/gen/vignettes.ts`、`app/src/gen/yard.ts`、`app/src/gen/rooftop.ts`、`app/src/gen/block.ts`、`app/src/gen/neighbours.ts`
- Test: `app/src/gen/rng.test.ts`

**Interfaces:**
- Produces:
  - `GenOptions.reseed?: Record<string, number>`（逻辑流路径 → 盐）。
  - `new Rng(seed, trace?, path?)`；`Rng.path: string`（逻辑路径，不带盐，根是 `''`）；`get stream()` 返回 `path`。
  - `Trace.reseed: Record<string, number>`（构造时传入）。
  - `fork(label, ctx)`：子路径 `P = parent.path ? parent.path + '/' + label : label`；种子串 = `${parent.seed}/${label}` 加上 `trace.reseed[P] !== undefined ? '#' + salt : ''`。
  - `SceneBuilder.stream?: string`；`sb.inStream<T>(path: string, fn: () => T): T`（写法同 `withExp`）。
  - `Placed.stream?`、`GroupRec.stream?`、`ZoneRec.stream?`、`keepClear[].stream?`：放置 / 登记时的 `sb.stream`。

- [ ] **Step 1: 写测试** `rng.test.ts`：
  - `same sequence without reseed`：`new Rng('7', new Trace('7')).fork('a').fork('b')` 的前 5 个数，与重构前的算法（直接 `new Rng('7/a/b')`）相同；
  - `reseed salts a stream and its descendants only`：在 `reseed = { 'a/b': 3 }` 下，`a/b` 和 `a/b/c` 的序列变了，`a/x` 和 `a` 不变；`fork` 出来的 `.stream` 仍是 `'a/b'`、`'a/b/c'`；
  - `trace keys use logical paths`：`trace.streams` 的键不含 `#`。
- [ ] **Step 2:** 跑测试，预期失败。
- [ ] **Step 3:** 实现 `rng.ts` 的改动。`generate()` 用 `new Trace(seed, opts.reseed ?? {})`。
- [ ] **Step 4:** 加 `stream` 字段，并在每个 fork 处用 `sb.inStream(rr.stream, () => …)` 包住这个流的放置：
  - `vignettes.ts` 156、226、302、369、425 行；
  - `yard.ts` 74、86 行；
  - `rooftop.ts` 19 行；
  - `generate.ts` 里每个顶层调用（`yard`、`cross`、`zones`、`bus`、`fronts`、`nfronts`、`island`、`curb`、`cars`、`road`、`walk`），以及 `emitBuildings`（用 `'block'` / `'neigh'`）。
  - `putAt`、`putChar`、`group`、`zone`、`clear` 都写入 `stream: this.stream`。
- [ ] **Step 5:** 测试通过；`npx tsc --noEmit` 通过。
- [ ] **Step 6:** 回归：`npx tsx scripts/regress.ts snapshot ../work/regress/t2`，然后 `compare ../work/regress/v0.5.1 ../work/regress/t2`，预期 `200/200 identical`。另外写一行脚本检查：种子 1–20 的每个非建筑物件都有 `stream`。

### Task 3: 对齐（`align.ts`）

**Files:**
- Create: `app/src/gen/judge/align.ts`
- Modify: `app/src/viewer/overlay.ts`（`hiddenObjects` 改为从 `align.ts` 导入并重新导出）
- Test: `app/src/gen/judge/align.test.ts`

**Interfaces:**
- Consumes: Task 1 的数据表，`RefWorldJSON`（`rational/world.ts`）。
- Produces:
  ```ts
  export type JGround = 'road' | 'paved' | 'grass' | 'wall' | 'other' | 'none';
  export interface JObj { key: string; cls: string; bb: PxRect; fx: number; fy: number; stream?: string; id?: string }
  export interface JWorld { name: string; src: 'gen' | 'ref'; cols: number; rows: number; ox: number; oy: number; ground: JGround[][]; objs: JObj[] }
  export function alignScene(sc: Scene): JWorld;
  export function alignRef(j: RefWorldJSON): JWorld;
  export function hiddenObjects(sc: Scene): Set<string>;   // 从 overlay.ts 原样移过来
  ```
  - `ox, oy`：格子 (0, 0) 的像素坐标（生成图 0, 0；参考图 `phase + origin * 16`）。
  - 生成图地面：叠加层 `opaque ≥ 0.99` 就按叠加层的类别，否则按底图；颜色类别 `sand / dirt / water / other / ''` → `other`。凡被 `cls === 'building'` 的精灵图像矩形覆盖的格子 → `wall`，和参考图 `scene.py` 按楼精灵 `tw × th` 整格标 `building` 的做法一致。
  - 生成图物件：去掉人物、楼、`hiddenObjects`（参考图看不见被挡住的东西）；`cls = semclass[key] ?? 'other'`。
  - 参考图：`building → wall`、`'' → none`、`paved / grass / road` 不变，其余 → `other`；物件只用 `conf === 'high'` 且 `cls !== 'building'`。

- [ ] **Step 1: 写测试**：
  - `alignScene maps lawn overlay and building cells`：用 `generate('7', { experiments: false })` 的场景，任取一个草坪 9 宫格中心所在的格，应为 `grass`；任一楼精灵左上角所在的格，应为 `wall`；`objs` 里没有 `person` / `building`。
  - `alignRef puts objects into the right cells`：读 `work/refworld/market_on_street.json`（文件不存在就跳过），任一物件的脚点按 `(fx - ox) / 16` 换算出的格子在网格范围内；`ground` 的尺寸等于 JSON 的 `ground` 尺寸。
- [ ] **Step 2:** 跑测试，预期失败。**Step 3:** 实现。**Step 4:** 测试通过，`tsc` 通过。

### Task 4: 窗口与特征（`features.ts`）

**Files:**
- Create: `app/src/gen/judge/features.ts`、`app/src/gen/judge/blacklist.json`（`[]`）
- Test: `app/src/gen/judge/features.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Win { c0: number; r0: number; rect: PxRect }   // 8×8 格，rect 是像素
  export function windows(w: JWorld): Win[];                       // 步长 4，有效格 ≥ 32
  export interface Feature { id: string; name: string; high: string; f: (w: JWorld, win: Win, cx: FeatCtx) => number }
  export const FEATURES: Feature[];
  export function activeFeatures(): Feature[];                     // 去掉 blacklist.json 里的
  export function featureMatrix(w: JWorld, wins: Win[]): number[][];   // 行 = 窗口，列 = activeFeatures()
  ```
  - `FeatCtx` 是每张图预算一次的东西：每格到最近物件的距离、路缘格（马路与非马路相邻的边）。
  - 窗口里的物件 = 脚点 `(fx, fy)` 落在窗口内的物件。可放置格 = `paved + grass + other`。

- 特征表（26 个）：

  | id | 中文名 | 值的含义 |
  |---|---|---|
  | `g.road` / `g.paved` / `g.grass` / `g.wall` / `g.other` | 马路 / 铺地 / 草地 / 墙 / 其他地面占比 | 占有效格的比例 |
  | `d.curb` | 路缘设施密度 | street_lamp、traffic_light、hydrant、bollard、manhole 的个数 ÷ 可放置格 |
  | `d.plant` | 植物密度 | tree、plant |
  | `d.trash` | 垃圾桶密度 | trash |
  | `d.seat` | 座位密度 | bench、table |
  | `d.vehicle` | 车密度 | vehicle |
  | `d.sign` | 标牌密度 | info_sign、traffic_sign |
  | `d.other` | 其他物件密度 | utility、fence、crate、other |
  | `d.all` | 物件总密度 | 全部 |
  | `e.rect` | 最大空地 | 没有物件外框压着的可放置格里，最大矩形 ÷ 可放置格 |
  | `e.far` | 远离物件的地面 | 离所有物件外框 ≥ 32px 的可放置格的比例 |
  | `r.same` | 同类扎堆 | 40px 内有同类物件的物件比例 |
  | `r.lift` | 常见搭配 | 40px 内的（table, bench）、（trash, trash）、（tree, bench）、（traffic_light, traffic_light）对数 ÷ 物件数 |
  | `r.wall` | 贴墙 | 外框离墙格 ≤ 8px 的物件比例 |
  | `r.curb` | 贴路缘 | 脚点离路缘 ≤ 8px 的物件比例 |
  | `r.road` | 站在马路上 | 脚点在马路格上的非车、非 manhole 物件比例 |
  | `p.tex` | 同一贴图重复 | key 在窗口内出现 ≥ 2 次的物件比例 |
  | `p.row` | 成排等距 | 属于“≥ 3 个、脚点 y（或 x）相差 ≤ 4px、相邻间距差 ≤ 4px”一排的物件比例 |
  | `p.keys` | 贴图种类 | 不同 key 数 ÷ 物件数（没有物件时为 0） |
  | `s.straight` | 长直边 | 草地 / 铺地边界里，属于 ≥ 4 格直线段的边所占的比例 |
  | `s.corner` | 转角数 | 草地区域边界的转角数 × 100 ÷ 有效格 |

- [ ] **Step 1: 写测试**（手搭 `JWorld`，不依赖生成器）：
  - `windows skip mostly-empty ground`：12×12 的世界，左边 6 列是 `none`，只出 4 个窗口里有效格 ≥ 32 的那几个（按手算）；
  - `ground fractions sum to 1`；
  - `features are finite on an all-road window`：全 `road`、没有物件，所有特征都是有限数；
  - `p.row detects an evenly spaced row`：4 棵树脚点 y 相同、间距 32/32/34 → `p.row = 1`；间距 32/60/20 → 0；
  - `r.lift counts table–bench pairs`：1 张桌子 + 2 把椅子在 40px 内 → `r.lift = 2/3`；
  - `blacklist removes a feature`：`activeFeatures()` 在 blacklist 含 `g.other` 时少一列（测试里临时写，测完还原）。
- [ ] **Step 2:** 跑测试，预期失败。**Step 3:** 实现。**Step 4:** 测试通过。
- [ ] **Step 5:** 性能检查：`featureMatrix(alignScene(generate('7')), …)` 在 50ms 内。

### Task 5: 标注 → 窗口标签（`labelset.ts`）

**Files:**
- Create: `app/src/gen/judge/labelset.ts`
- Test: `app/src/gen/judge/labelset.test.ts`

**Interfaces:**
- Consumes: `Label`（`viewer/labels.ts`）、`windows()`。
- Produces:
  ```ts
  export interface LabelRegion { file: string; id: string; seed: string; verdict: 'good' | 'bad'; rect: PxRect; scene: Scene }
  export function loadLabelRegions(minVersion = '0.5.1'): LabelRegion[];
  export function labelRegion(l: Label, sc: Scene): PxRect;
  export function coveredWindows(region: PxRect, wins: Win[]): number[];
  ```
  - 只读版本号 ≥ `minVersion` 的目录，场景读标注里的 `scene` 字段指的文件。
  - `labelRegion`：有物件或框选比一格大的，用 `target.rect`；单击一格（宽、高都 ≤ 16 且没有物件）的，用 `target.zones` 里 `layer` 为 `yard` / `block` 的最小区域的矩形；都没有就用 `target.rect`。
  - `coveredWindows`：重叠面积 ÷ min(区域面积, 窗口面积) ≥ 0.5。

- [ ] **Step 1: 写测试**（读真实的 `references/labels/v0.5.1/`）：
  - `loads only v0.5.1 labels`：16 条，5 好 11 坏；
  - `click label resolves to its zone`：seed87709 L1 → 512×48 的花园矩形；seed225713 L1 → `z10`（block、alley，16×176）；
  - `box label keeps its rect`：seed791885 L5 → 192×240；
  - `big region maps to several windows`：seed87709 L1 至少对应 2 个窗口。
- [ ] **Step 2–4:** 测试失败 → 实现 → 测试通过。

### Task 6: 模型（`model.ts`）与训练、评估脚本

**Files:**
- Create: `app/src/gen/judge/model.ts`、`app/scripts/judge.ts`、`tools/heatmap.py`
- Create（生成）: `app/src/gen/data/judge.json`、`docs/JUDGE.md`、`docs/v0.6.0/heat_*.png`
- Test: `app/src/gen/judge/model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface JudgeModel { features: string[]; mean: number[]; std: number[]; w: number[]; b: number; lambda: number; threshold: number; refMeanP90: number; trained: string; data: Record<string, unknown> }
  export function fitL1(X: number[][], y: number[], sw: number[], lambda: number): { w: number[]; b: number };   // X 已标准化
  export function auc(score: number[], y: number[]): number;
  export function scoreMatrix(m: JudgeModel, X: number[][]): { p: number[]; contrib: number[][] };
  export interface JudgeWin { rect: PxRect; score: number; top: { f: string; contrib: number }[] }
  export interface JudgeResult { model: string; windows: JudgeWin[]; mean: number; max: number }
  export function scoreWorld(w: JWorld, m?: JudgeModel): JudgeResult;   // m 默认读 data/judge.json
  ```
  - `fitL1`：样本加权的逻辑回归，坐标下降（截距不惩罚），用二次近似，迭代到 |Δw| 最大值 < 1e-5 或 200 轮。
  - `JudgeResult.model` = 训练日期。
  - 标准化：std 为 0 的特征，std 记为 1。

- `scripts/judge.ts train`：
  1. 参考图：`work/refworld/*.json` → 全部窗口，标签 0，组 = `refs_meta.json` 的 `group`（没有就用文件名）。
  2. 生成图：`SEEDS.slice(0, 100)`，每个种子 `generate(s)`，用不带评判修复的版本（Task 7 加 `judgeRepair: false` 之前，就是当前的 `generate`）；全部窗口池里用 `new Rng('judge-sample')` 抽 3 × 参考窗口数个，标签 1。
  3. 标注：`loadLabelRegions()`，每个区域覆盖的窗口，坏 = 1、好 = 0，权重 5。
  4. 类别平衡：参考图样本权重 = 生成图样本数 ÷ 参考图样本数（标注另外乘 5）。
  5. λ 网格 `[0.3, 0.1, 0.03, 0.01, 0.003, 0.001]`，按参考图组做留一组交叉验证（生成图种子按组数均分）。取 AUC 最高的 λ；在最高值 0.005 以内的，取最大的 λ。
  6. 全量重训，`threshold` = 参考图窗口得分的 90 百分位，`refMeanP90` = 21 张参考图整图平均分的 90 百分位。写 `judge.json`。
- `scripts/judge.ts eval` → `docs/JUDGE.md`（由代码生成，开头注明“由 scripts/judge.ts eval 生成”）：
  - 留一组交叉验证 AUC，验证集（`SEEDS.slice(100)`）AUC；
  - 标注成对准确率：按标注种子留一（这个种子的标注不参与训练）。区域得分 = 它覆盖的窗口里的最高分。另附训练集上的数字；
  - AUC > 0.97 时写报警段，列出贡献最大的 5 个特征；
  - 权重表：按 |w| 排序，非零的每行写“生成图比参考图更 <high> / 更少 <high>”，附该特征 z 值最大的一个参考图窗口和一个生成图窗口（图名 + 格坐标）；
  - 热力图：种子 `SEEDS[0..2]`（generate 后写 scene JSON 到 `work/judge/`）和参考图 `market_on_street`、`suburb_neighborhood_1`，各写 `<name>.heat.json`（窗口与得分），再调 `uv run python tools/heatmap.py` 出 `docs/v0.6.0/heat_<name>.png`。
- `tools/heatmap.py <heat.json> <out.png>`：
  - 底图：生成图用 `render_generated.py` 的渲染函数，参考图用 `work/refs/<name>.png`；
  - 窗口按得分着色：每像素取覆盖它的窗口里的最高分，从透明到红（alpha = 0.6 × score）；
  - 阈值以上的窗口画描边，2 倍放大。

- [ ] **Step 1: 写测试** `model.test.ts`：
  - `fitL1 separates a separable toy set`：两个特征，只有第 1 个有信息 → `w[0] > 0`；λ = 0.1 时 `w[1] === 0`；
  - `auc of perfect / reversed / random ranking` → 1、0、0.5（并列算 0.5）；
  - `contrib equals w times z`。
- [ ] **Step 2–4:** 测试失败 → 实现 → 测试通过。
- [ ] **Step 5:** 运行 `npx tsx scripts/judge.ts train` 和 `eval`。检查：
  - `judge.json` 写出；
  - `JUDGE.md` 有 AUC、成对准确率、权重表、热力图。
- [ ] **Step 6（检查点）：** 读 `JUDGE.md`。
  - 出现 AUC 报警或排前面的特征明显是视力差异（例如某类物件参考图根本检测不到）时，修对齐（Task 3），或把特征放进黑名单，重训；在 NOTE 里记下每一次这样的调整。
  - 不为了凑成对准确率去调参数。
  - 结果作为向用户汇报的一部分，不在这里停下等确认。

### Task 7: 场景输出 `scene.judge`

**Files:**
- Modify: `app/src/gen/generate.ts`、`app/src/gen/types.ts`
- Test: `app/src/gen/judge/scene.test.ts`

**Interfaces:**
- Produces:
  - `generateBase(seed, opts): Scene`：现在 `generate()` 的全部内容（含 `rationalize`）。
  - `generate(seed, options)`：`generateBase` + `scene.judge = scoreWorld(alignScene(scene))`，然后在 Task 8 里接修复。
  - `Scene.judge?: JudgeResult`；`VERSION = '0.6.0'`。

- [ ] **Step 1: 写测试**：`generate('7').judge` 有窗口，`0 ≤ score ≤ 1`，`max ≥ mean`，每个窗口的 `top` 有 3 项。
- [ ] **Step 2–4:** 测试失败 → 实现 → 测试通过。
- [ ] **Step 5:** 回归 `compare v0.5.1 <新快照>`，预期 200/200 相同（评判只写不读）。

### Task 8: 局部档修复与降级（exp-02）

**Files:**
- Create: `app/src/gen/judge/repair.ts`
- Modify: `app/src/gen/exp.ts`、`app/src/gen/generate.ts`、`app/src/gen/types.ts`、`app/src/gen/rational/rationalize.ts`（导出 `lawn`，供降级用）、`docs/EXPERIMENTS.md`
- Test: `app/src/gen/judge/repair.test.ts`

**Interfaces:**
- Consumes: `generateBase`、`scoreWorld`、`alignScene`、`rationalize`、`Audit.violations`。
- Produces:
  - `EXPERIMENTS` 加 `{ id: 'exp-02', title: '评判修复：换子种子重生成最怪的窗口，修不好就降级', status: 'experimental', default: true }`（不设 `fire`：开了就运行）。
  - `GenOptions` 增加：
    - `judgeRepair?: boolean`（内部用：候选生成时为 false）；
    - `judgeFixed?: { degrade: PxRect[] }`（有它就不搜索，直接按 `reseed` 生成，再降级这些窗口）；
    - `judgeGlobal?: boolean`（Task 9）。
  - `repair.ts`：
    ```ts
    export const REPORT_ONLY = ['C19', 'C23', 'C24'];
    export interface Target { rect: PxRect; score: number; why: 'score' | string /* 约束 id */; violation?: string }
    export function selectTargets(j: JudgeResult, au: Audit, threshold: number): Target[];          // 贪心、互不重叠、最多 3 个
    export function saltableStreams(sc: Scene, rect: PxRect): string[];
    export function qualifies(orig: Cand, cand: Cand, t: Target): { ok: boolean; why: string };
    export interface Cand { scene: Scene; judge: JudgeResult; violations: number; reseed: Record<string, number> }
    export function judgeRepair(seed: string, opts: GenOptions, base: Scene, onProgress?: (n: number, N: number) => void): Scene;
    export function degradeWindow(sc: Scene, rect: PxRect): { zones: string[]; removed: string[] };
    ```
  - `selectTargets`：
    - 分数超阈值的窗口；
    - 只报告约束的违规：违规矩形中心所在、重叠最大的那个窗口，`why` 记约束 id；
    - 按 score 从高到低，跳过与已选窗口重叠的。
  - `saltableStreams`：脚点在窗口内的物件的 `stream`，加上与窗口重叠的 `yard` 层区域的 `stream`。排除：`layout*`、`block*`、`neigh*`、正好是 `yard` 的、`exp/*`、空串。
  - `qualifies`（`orig` 指当前已采用的场景）：
    1. 剩余违规数（`audit.counts` 中生效约束的总和）≤ orig；
    2. 和目标窗口不重叠的窗口：Σ(cand − orig) ≤ 0.05 × 窗口数；
    3. 目标窗口分数 < orig；如果目标是只报告约束，按 `violation` 的 target 找，这条违规必须消失。
  - `judgeRepair`：
    - 依次处理目标窗口。每个窗口试盐 1..6：`reseed = { ...accepted, ...streams 都设为该盐 }`，`generateBase`，再打分；
    - 合格的候选里取目标窗口分数最低的，采用它的 `reseed`；
    - 没有合格的、窗口分数仍超阈值时，对当前场景 `degradeWindow`，并重跑 `rationalize`（之前的 `pruned` 并进新的 audit）。违规数变多就撤销（降级前先深拷贝场景），只记录；
    - 最后：
      - 采用的流（以及它们的子流）上的物件、小组、区域打 `exp: 'exp-02'`（已有 `exp` 的保留原值）；降级的区域也打；
      - 写 `scene.judge`（重新打分）和 `scene.judgeRepair`；
      - `scene.options.reseed = accepted`，`scene.options.judgeFixed = { degrade }`。
  - `degradeWindow`：
    - 中心在窗口内的 `yard` 层区域：`garden / strip / corner` 改草坪（`lawn(sc, rect)`），删掉区域内的非植物物件；其他种类（`parking`、`front`…）只删非植物物件；
    - 窗口内锚点 `kind` 为 `zone / yard / block / slot` 的装饰物（cls 是 `plant / crate / other / utility / info_sign`）也删掉。
    - 设计里写的是“删掉没有锚点的装饰物”，但目前每个物件都有锚点（`regress explain` 要求），所以这里把“弱锚点”当成没有锚点，会在 NOTE 里登记。
    - 不新增物件。
  - `scene.judgeRepair`：
    ```ts
    { windows: { rect: PxRect; why: string; before: number; after: number;
                 cands: { salt: number; score: number; violations: number; ok: boolean; why: string }[];
                 adopted?: number; degraded?: { zones: string[]; removed: string[] } | 'rejected' }[];
      reseed: Record<string, number>; global?: { salt: number; mean: number; ok: boolean }[];
      meanBefore: number; meanAfter: number; ms: number; gens: number }
    ```
  - `generate()`：
    - `opts.judgeFixed` 存在时：`generateBase`，按 `degrade` 逐个 `degradeWindow`，重跑 `rationalize`，再打分；
    - 否则，`expEnabled(opts, 'exp-02') && opts.judgeRepair !== false` 时调 `judgeRepair`；
    - 都不满足，只打分。

- [ ] **Step 1: 写测试** `repair.test.ts`：
  - `selectTargets picks non-overlapping windows, at most 3`（手搭 `JudgeResult`：5 个超阈值的窗口，其中两两重叠）；
  - `saltableStreams excludes structural streams`：手搭场景里物件的 stream 有 `curb/curbS3`、`yard`、`layout`、`exp/exp-01/roof:b1`、`yard/garden3,4` → 只剩 `curb/curbS3`、`yard/garden3,4`；
  - `qualifies rejects more violations / worse outside / not better inside`（3 个用例，外加 1 个合格的）；
  - `exp-02 off gives the base picture`：`signature(generate('7', { exp: { 'exp-02': false } }))` 等于 `signature(generateBase('7', withDefaults({})))`；
  - `repaired scene reproduces from its options`：找一个 `judgeRepair.windows` 非空的种子（种子 1–30 里第一个），`generate(seed, sc.options)` 的签名与原场景相同；
  - `degradeWindow never adds objects`：物件数不增加。
- [ ] **Step 2–4:** 测试失败 → 实现 → 测试通过。
- [ ] **Step 5:** 回归：`snapshot` 带 `--off exp-02`（Task 10 的参数；这一步可以先用临时的一行脚本），`compare v0.5.1`，预期 200/200 相同。
- [ ] **Step 6:** `docs/EXPERIMENTS.md` 登记 exp-02（内容、开关 `e=exp-02:0`、默认开、状态实验、2026-11-03）。

### Task 9: 整体档（`judgeGlobal`，默认关）

**Files:**
- Modify: `app/src/gen/judge/repair.ts`
- Test: `app/src/gen/judge/repair.test.ts`

**Interfaces:**
- Produces: `judgeRepair` 在局部档之后，满足 `opts.judgeGlobal && scene.judge.mean > model.refMeanP90` 时：
  - 盐 g = 1..4：以 `{ block: g }` 为基础 `reseed` 生成，再在它上面走一遍局部档（盐叠加在 `{ block: g }` 上）；
  - 候选与局部档结果一起，取满足条件 1（相对原图）且整图平均分最低的；
  - 采用整体档时：所有 `stream` 不以 `neigh`、`nfronts`、`island` 开头的物件、小组、区域，都打 `exp: 'exp-02'`；
  - 记录到 `judgeRepair.global`。

- [ ] **Step 1: 写测试**：
  - `global tier off by default`：`judgeRepair.global` 为 undefined；
  - `global tier respects condition 1`：开 `judgeGlobal` 跑一个种子，采用的结果违规数 ≤ 原图。
- [ ] **Step 2–4:** 测试失败 → 实现 → 测试通过。

### Task 10: 回归与报告

**Files:**
- Modify: `app/scripts/regress.ts`、`app/scripts/labeltests.ts`

**Interfaces:**
- Produces：
  - `snapshot <dir> [--pd] [--off exp-02] [--global] [--shard i/n]`：每个种子另写 `<seed>.judge.json`，内容是 `{ mean, max, meanBefore, windows, adopted, degraded, global, ms, gens, reportOnly: { C19, C23, C24 }, goodTouched }`；`index.json` 记录这些参数。
  - `snapshot-par <dir> [同样的参数] [--jobs 8]`：起 n 个子进程（`--shard k/n`），等全部结束后写 `index.json`。
  - `report` 增加：
    - 整图平均怪异分（平均 / 中位数），最怪窗口的得分；
    - 修复的窗口数、降级数，局部档 / 整体档的采用次数；
    - C19、C23、C24 的变化；
    - 平均耗时。
    - 原来的“评判器得分：阶段 6 才有”删掉。
  - `labeltests.ts`：好标注变了的，如果标注区域里有带 `exp: 'exp-02'` 的物件，或者与 `judgeRepair.windows` 的某个矩形重叠，归到单独一组“被 exp-02 改动的好标注”。

- [ ] **Step 1:** 实现。
- [ ] **Step 2:** `snapshot-par ../work/regress/v0.6.0-off --off exp-02`，然后 `compare ../work/regress/v0.5.1 ../work/regress/v0.6.0-off`，预期 `200/200 identical`（验收 3）。
- [ ] **Step 3:** `snapshot-par ../work/regress/v0.6.0`，然后 `report ../work/regress/v0.6.0-off ../work/regress/v0.6.0`。保存输出到 `work/regress/v0.6.0-report.txt`。
- [ ] **Step 4:** `snapshot-par ../work/regress/v0.6.0-global --global`，同样出报告。只用于给用户的统计，默认仍关。

### Task 11: 查看器

**Files:**
- Create: `app/src/viewer/gen.worker.ts`、`app/src/viewer/heat.ts`
- Modify: `app/src/main.ts`、`app/index.html`

**Interfaces:**
- Produces:
  - `gen.worker.ts`：收 `{ seed, opts }`，生成过程中发 `{ progress: [n, N] }`，最后发 `{ scene }`。
  - `main.ts` 的 `load_` 改为异步：
    - 生成时 `#info` 显示“评判修复中…（n / N）”；
    - 新的请求到来时丢弃旧结果（按请求序号）；
    - URL 增加 `jg=1`（整体档）。
  - `heat.ts`：`drawHeat(ctx, sc, view, hover?: {x, y})`。窗口按得分着色（透明 → 红，alpha = 0.6 × score，每像素取最高分），阈值以上的画描边；修复过的窗口画虚线框，标“前 → 后”分数。
  - 顶栏加“热力图 (H)”按钮，快捷键 H。热力图的绘制不依赖标注层是否打开（`update()` 里单独画）。
  - 悬停时，浮动提示 `#heatTip` 显示：得分，以及前 3 个原因（中文特征名 +“偏高 / 偏低”，按 contrib 的正负）。
  - 导出时，热力图开着就附带 `<base>_heat.png`（2 倍图加 `drawHeat`）。
  - exp-02 物件在标注层沿用实验样式（现有的 `exp` 字段已经支持，只需确认）。

- [ ] **Step 1:** 实现。
- [ ] **Step 2:** `npx tsc --noEmit`、`npx vite build` 通过。
- [ ] **Step 3:** 启动 vite，`npx tsx scripts/shots.ts ../work/shots06 7`。确认能出图，导出文件数正确；再加 `?seed=7` 手动核对热力图和进度显示（截图给用户）。

### Task 12: 版本报告与文档

**Files:**
- Create: `docs/v0.6.0.md`、`docs/v0.6.0/*`
- Modify: `docs/PROGRESS.md`、`docs/NOTE.md`、`docs/methodology.md`（加一节“评判器与修复”）

- [ ] **Step 1:** 修复前后对比图：
  - 从回归里挑分数下降最多的 3 个种子，以及 1 个降级的种子；
  - 用 `shots.ts` 分别截 `off/`（`--q=e=exp-02:0`）和默认两组，再用 `tools/compare_crops.py` 出对比图。
- [ ] **Step 2:** 写 `docs/v0.6.0.md`：
  - 评判器学到的规律（`JUDGE.md` 摘要和权重表），注明“等用户核对”；
  - 热力图示例；
  - 修复前后对比图；
  - 200 个种子的统计（Task 10 的报告）；
  - 整体档的触发率和收益；
  - 需要用户决定的问题。
- [ ] **Step 3:** NOTE 新增 D40 起的决策：地面颜色对齐、标注只用 v0.5.1、标注区域规则、整体档默认关、“弱锚点”的解释、Task 6 检查点里做过的调整。PROGRESS 更新当前状态、怎么运行（H、`jg=1`、`judge.ts`、`snapshot-par`、`npm test`）和下一步。
- [ ] **Step 4:** `npm test`、`tsc`、`regress.ts explain`（`unlabelled` 为 0）全部通过后，commit：`v0.6.0: stage 6 - local judge, heatmap, exp-02 judge repair`，并打 tag `v0.6.0`。`work/` 不进 git。
- [ ] **Step 5:** 停下，向用户汇报，等确认。
