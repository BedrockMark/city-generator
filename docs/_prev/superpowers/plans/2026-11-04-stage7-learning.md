# 阶段 7 实现计划：从选择中学习 + 创新度（v0.7.0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把用户的 A/B 选择和好 / 坏标注学成“每个决策点在各上下文下的选项乘子”（Bradley–Terry），实现创新度参数、局部 A/B 出题和界面、实验转正 / 废弃报告，以及“选择解决不了的问题”报告。

**Architecture:** `rng.ts` 获得三样东西：决策身份（流, 标签, 序号 k）、强制决策 `force`、一个可选的权重调整钩子 `Trace.adjust`（偏好乘子 × 创新度加成，返回 null 时走原代码路径）。新目录 `app/src/gen/learn/`：`prefs.ts`（模型、训练、乘子查询）、`novelty.ts`（稀有度、`novel` 标记）、`adjust.ts`（把两者组合成钩子）、`diff.ts`（两张场景的画面差异框）、`ab.ts`（出题）、`data.ts`（Node：选择 / 标注 → 比较）。脚本 `scripts/prefs.ts`、`scripts/experiments.ts`、`scripts/abcheck.ts`。查看器新增 A/B 模式（`src/viewer/ab.ts`）。

**Tech Stack:** TypeScript（tsx、vite、Phaser 3），`node:test`，Python（uv）只用于导出使用次数和裁图。

**Spec:** `docs/superpowers/specs/2026-11-04-stage7-learning-design.md`

## Global Constraints
- 不加 npm 依赖。测试 `node:test` + `node:assert/strict`；`package.json` 的 `test` 脚本加上 `src/gen/learn/*.test.ts`。
- `VERSION = '0.7.0'`。分支 `stage7`（从 `stage6` 切出），整个版本最后 commit 一次并打 tag `v0.7.0`，中途不 commit。
- 不变性基线：`work/regress/v0.6.1b-off`。`--nov 0 --noprefs` 必须 200/200 相同；偏好表为空时 `--nov 0` 也 200/200 相同。
- 解释字段（`i`、`kind`、`forced`、`m`、`novel`、`opts` 记录上限）只写不读，不进画面签名。
- 强制键 `"<流>|<标签>|<k>"`，值 = `show(option)`；是否型 `"true"/"false"`，`count` 用数字字符串。
- 乘子截断 [0.2, 5]；只存 |log m| ≥ 0.05；λ_θ = 1，λ_δ = 4；平局损失 0.5 × (得分差)² / 2；标注每条总权重 0.3。
- 创新度：稀有度 r = 1 − log(1+次数) / log(1+最大次数)；权重 × (1 + 创新度 × 3 × r)；窗口阈值 + 创新度 × 0.2；整体修图触发线 + 创新度 × 0.1。
- A/B：扩边 8px；大改动 = 影响外框宽或高 > 192px；小改动外框两两相距 ≥ 16px；每题最多 6 处、最多试 30 个候选；每 5 题最多 1 道大改动题；A/B 一律不开 exp-02。
- 出题打分 = 1/(1+已有比较数) × (最近 20 题出现过 ? 0.3 : 1) × (1 − 0.8 × 差不多比例)。
- 实验建议：证据 ≥ 8 且好 ≥ 70% → 建议转正；≤ 30% → 建议废弃；否则继续观察。不自动执行。
- 用户可见的文字用中文。

## Review Focus
1. **决策序号算上被 reject 的提议**：被丢掉的提议里的调用也要让计数器前进，否则强制键会在同一张图上指向不同决策。→ Task 1 测试 `k counts rejected calls`。
2. **强制的选项已不存在**（上游变了、`count` 范围变了）：不能崩、不能偷换成别的选项，而是照常抽签并记 `forceMissed`。→ Task 1 测试 `missing forced option is recorded and not applied`。
3. **画面签名里的 `sub` 序号**：多放一个物件会让之后所有物件的 `sub` 变化，按原签名做差异会把整张图都算成“改了”。差异必须忽略 `sub`。→ Task 4 测试 `diff ignores draw sequence numbers`。
4. **旧版本标注的重新生成**：v0.5.1 / v0.6.x 的标注带 `novelty: 0.1 / 0.6`，但那时创新度不起作用；按原值重新生成会让签名全部对不上。0.7.0 之前的标注一律用创新度 0、偏好关重新生成。→ Task 5 测试 `old labels regenerate with novelty 0`。
5. **训练集里标签 / 选项不存在**（旧选择文件、生成器改版）：跳过并计数，不能崩。→ Task 5 测试 `unknown labels are skipped and counted`。

---

### Task 1: 决策身份、强制决策、权重调整钩子（`rng.ts`）

**Files:**
- Modify: `app/src/gen/rng.ts`、`app/src/gen/types.ts`、`app/src/gen/generate.ts`、`app/src/gen/exp.ts`
- Test: `app/src/gen/rng.test.ts`

**Interfaces:**
- Produces:
  - `Decision` 新字段：`i: number`（k）、`kind?: 'p' | 'count' | 'order'`（普通 choose 不写）、`forced?: true`、`m?: Record<string, number>`（偏好乘子 ≠ 1 的选项）。`MAX_OPTS` 改为 32（只影响记录）。
  - `export type Adjust = (label: string, ctx: Ctx, opts: string[], stream: string) => { w: number[]; m?: Record<string, number>; novel?: string[] } | null`。`w` 与 `opts` 等长，是相对原权重的乘子；`novel` 是“若被选中就算新贴图”的选项。
  - `new Trace(root, reseed = {}, force: Record<string, string> = {}, adjust?: Adjust)`；`Trace.forceMissed: string[]`；`Trace.novel: string[]`（被选中的新贴图，`"<流>|<选项>"`）；`Trace.counter`（按流、按标签的调用计数，私有即可）。`toJSON()` 加 `forceMissed`（非空时）。
  - `export const forceKey = (stream: string, label: string, k: number) => \`${stream}|${label}|${k}\``。
  - `export function alternatives(d: Decision): string[]`：`kind==='p'` → `['true','false']`；`kind==='count'` → 从 `opts[0]` 的 `lo..hi` 展开；有 `opts` → `opts`；否则（`order`、选项超过 32）→ `[]`。
  - `GenOptions.force?: Record<string, string>`、`GenOptions.prefs?: boolean`（`DEFAULT_OPTIONS.prefs = true`）。`generateBase` 用 `new Trace(seed, opts.reseed ?? {}, opts.force ?? {}, adjust)`，本任务 `adjust` 固定为 `undefined`（Task 2 接上）。

- [ ] **Step 1: 写测试**（`rng.test.ts` 追加）：
  - `decisions carry their per-stream index`：同一流里两次 `choose('x')`、一次 `choose('y')` → `i` 分别是 0、1、0；另一个流的 `x` 从 0 起。
  - `k counts rejected calls`：`m = r.mark(); r.choose('x',…); r.reject(m,'t'); r.choose('x',…)` → 留下的那条 `i === 1`。
  - `forced choice picks the given option and draws once`：两个同种子的 Rng，一个强制 `'a|x|0' = 'c'`，`choose('x', {}, ['a','b','c'])` 返回 `'c'`、记录 `forced: true`；之后两者的 `next()` 相同（各只消耗一个随机数）。`{p}`（强制 `'false'`）和 `count`（强制 `'3'`，范围 1..4）同样。
  - `force does not touch other streams`：强制 `a` 流的决策，`b` 流的抽签序列不变。
  - `missing forced option is recorded and not applied`：强制值 `'z'` 不在选项里 → 返回值等于不强制时的结果，`trace.forceMissed` 含这个键，记录里没有 `forced`。
  - `adjust null keeps the original draw`：`adjust` 总返回 null 时，一串 `choose`（数组 / weights / p）/ `count` 的结果和不带 `adjust` 时完全相同。
  - `adjust multipliers shift frequencies`：`choose('x', {}, ['a','b'])`，`adjust` 给 `w=[4,1]`，2000 次（每次新种子）里 `'a'` 的比例在 0.75–0.85；`{p: 0.5}` 给 `w=[4,1]`（true, false）时 true 比例在 0.75–0.85。记录带 `m`（钩子返回的 `m` 原样写入）。
  - `alternatives`：p、count（`1..3` → `['1','2','3']`）、普通 opts、order 四种。
- [ ] **Step 2:** `cd app && npx tsx --test src/gen/rng.test.ts`，预期失败。
- [ ] **Step 3:** 实现。要点：
  - 计数在 `rec()` 之前、`choose / count / order` 入口处完成（`order` 也计数，但不可强制）。
  - 强制：先 `next()` 一次，再在选项（字符串形式）里找强制值；`{p}` 的选项是 `true/false`，`count` 是 `lo..hi`。
  - 钩子：`choose` 数组 → 原权重全 1；weights → 原权重；`{p}` → 赔率 p/(1−p) × w[0]/w[1] 换回概率；`count` → 每个取值权重 1。钩子返回 null 时一行不改地走原来的代码。钩子只在 `trace.adjust` 存在时调用（要算 `opts` 字符串）。
  - 选中的选项在 `novel` 里 → `trace.novel.push(\`${stream}|${pick}\`)`。
  - `exp.ts` 的 `DEFAULT_OPTIONS` 加 `prefs: true`；加 `export const fireByNovelty = (base: number) => (n: number) => base + n * (1 - base)`（给以后的实验登记用，注释说明）。
- [ ] **Step 4:** 测试通过；`npx tsc --noEmit` 通过；`npm test` 全部通过。
- [ ] **Step 5:** 回归：`npx tsx scripts/regress.ts snapshot-par ../work/regress/t1`，`compare ../work/regress/v0.6.1b-off ../work/regress/t1` → `200/200 identical`。另跑一行脚本：种子 7 的场景 JSON 用 `options.force` = 某个决策的备选项重新生成，再用导出的 `options` 生成一次，两次签名相同。

### Task 2: 偏好模型与应用（`learn/prefs.ts`、`learn/adjust.ts`）

**Files:**
- Create: `app/src/gen/learn/prefs.ts`、`app/src/gen/learn/adjust.ts`、`app/src/gen/data/prefs.json`（初始 `{ "version": "", "trained": "", "labels": {} }`）、`app/src/gen/learn/blacklist.json`（`{ "labels": [], "options": [] }`）
- Modify: `app/src/gen/generate.ts`、`app/package.json`
- Test: `app/src/gen/learn/prefs.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Adjust`、`Ctx`。
- Produces:
  - `export interface Comparison { label: string; ctx: Ctx; a: string; b: string; answer: 'a' | 'b' | 'same'; w: number; batch: string; src: { seed: string; rect?: PxRect; file: string } }`
  - `export interface PrefEntry { global: Record<string, number>; ctx: Record<string, Record<string, number>>; n: number }`；`export interface PrefTable { version: string; trained: string; labels: Record<string, PrefEntry> }`（值都是乘子 m）。
  - `export const ctxKeys = (ctx: Ctx) => string[]`（`"key=value"`，按 key 排序）。
  - `export function fit(cs: Comparison[], o?: { lambdaTheta?: number; lambdaDelta?: number }): PrefModel`；`PrefModel = Record<label, { theta: Record<opt, number>; delta: Record<kv, Record<opt, number>>; n: number }>`（对数）。
  - `export function score(model: PrefModel, label: string, ctx: Ctx, opt: string): number`（对数得分，未知 → 0）。
  - `export function toTable(model: PrefModel, version: string): PrefTable`（只存 |log m| ≥ 0.05，`n` = 这个标签的比较数）。
  - `export function multiplier(t: PrefTable, label: string, ctx: Ctx, opt: string): number`（总对数相加后 exp，截断 [0.2, 5]）。
  - `export const PREFS: PrefTable`（读 `data/prefs.json`）。
  - `adjust.ts`：`export function makeAdjust(opts: GenOptions, prefs?: PrefTable): Adjust | undefined` —— `prefs` 关或表空、且创新度 0 时返回 `undefined`；标签不在表里且创新度部分（Task 3 接上，本任务先只做偏好）不适用时钩子返回 null。`m` 只记 ≠ 1 的。
- [ ] **Step 1: 写测试** `prefs.test.ts`：
  - `fit recovers known multipliers`：标签 `x` 选项 a/b/c，真实对数得分 0 / 0.8 / −0.8；用固定种子模拟 3000 次比较（按 σ(差) 抽胜者），`fit` 之后 `score(b) − score(a)` 在 0.6–1.0，`score(c) − score(a)` 在 −1.0 – −0.6。
  - `ties pull multipliers to 1`：只有“差不多”的 200 条 → 所有 |score| < 0.05。
  - `context falls back to global with little data`：全局 b 胜 a 300 次；`ctx {rows: 2}` 下 a 胜 b 只有 2 次 → `ctx` 的 δ 绝对值 < 0.3，总得分仍是 b 高。
  - `multiplier clamps to [0.2, 5]`：手写一张表，`global` 写 m=20 → 返回 5；不存在的标签 → 1。
  - `blacklist removes labels and options`：`fit` 前过滤掉黑名单（`filterBlacklist(cs, bl)`，放在 `prefs.ts`）。
  - `empty table gives no adjust`：`makeAdjust({ ...defaults, novelty: 0 }, emptyTable) === undefined`。
- [ ] **Step 2:** 跑测试，预期失败。
- [ ] **Step 3:** 实现 `fit`：标签之间参数不共享，所以逐个标签独立用牛顿法。参数 = 这个标签出现过的 θ(o) + δ(kv, o)；目标 = Σ w·log(1+e^{−(s_win − s_lose)}) + Σ_平局 0.5·w·(s_b − s_a)²/2 + λ_θ/2·Σθ² + λ_δ/2·Σδ²。稠密海森矩阵 + Cholesky（L2 保证正定），最多 50 次迭代，步长减半保证下降，梯度范数 < 1e-6 停止。
- [ ] **Step 4:** `generate.ts`：`generateBase` 里 `makeAdjust(opts, PREFS)` 传给 `Trace`。`package.json` 的 test 脚本加 `src/gen/learn/*.test.ts`。
- [ ] **Step 5:** 测试、`tsc` 通过；回归 `snapshot-par ../work/regress/t2 --nov 0`（Task 9 才加 `--nov`；本任务先在 `regress.ts` 里加上 `--nov <x>` 和 `--noprefs` 两个 snapshot 参数，`modeOpts` 带上 `novelty`、`prefs`），`compare v0.6.1b-off t2` → 200/200。

### Task 3: 创新度（使用次数、稀有度、`novel`、评判器放宽）

**Files:**
- Create: `tools/export_usage.py`、`app/src/gen/data/usage.json`（生成）、`app/src/gen/learn/novelty.ts`
- Modify: `app/src/gen/learn/adjust.ts`、`app/src/gen/generate.ts`、`app/src/gen/judge/align.ts`、`app/src/gen/judge/features.ts`、`app/src/gen/judge/model.ts`、`app/src/gen/judge/repair.ts`
- Test: `app/src/gen/learn/novelty.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Trace.novel`，Task 2 的 `makeAdjust`。
- Produces:
  - `usage.json` = `{ "counts": { key: n }, "max": n, "sources": { "refworld": n文件, "holdout": n文件 } }`。次数：`work/refworld/*.json` 里 `conf == 'high'` 的物件 key；`references/holdout/*.json` 里 `kind == 'sprite'` 的物件 key；外加每个模块楼部件族（`modular.json` 的键）= 它所有部件 key 的次数之和。
  - `novelty.ts`：`export function rarity(key: string): number | undefined`（key 既不在 `sprites.json` 也不是部件族 → `undefined`，即“不适用”；次数缺省为 0）；`export function noveltyFactors(novelty: number, opts: string[]): { w: number[]; novel: string[] } | null`（没有一个选项适用 → null；`novel` = 次数为 0 的适用选项）；`export function markNovel(sc: Scene, picks: string[])`（`picks` 是 `Trace.novel`；物件的 `stream|key` 命中，或 key 属于命中的部件族且流相同 → `novel: true`）。
  - `makeAdjust` 把偏好乘子和创新度加成相乘（偏好在前），两者都不适用时返回 null。
  - `scoreWorld(w, m = MODEL, novelty = 0)`：`threshold = m.threshold + 0.2 * novelty`。`judgeRepair` 的触发线 `MODEL.refMeanP90 + 0.1 * opts.novelty`。
  - `JObj.novel?: boolean`；`WinData.known: JObj[]`（去掉 `novel` 的物件）；`d.*` 和 `p.*` 特征用 `known`，其余特征照旧用 `objs`。
- [ ] **Step 1: 写测试** `novelty.test.ts`：
  - `novelty 0 changes nothing`：种子 1–5，`generate(s, { novelty: 0, prefs: false })` 与 `{ novelty: 0 }`（表为空）签名相同，且没有物件带 `novel`。
  - `rare sprites are picked more at high novelty`：取 `cars.model` 这类决策的选项（从 `sprites.json` 拿两个 key：一个次数最多的 `top`、一个次数 0 的 `rare`），`noveltyFactors(1, [top, rare])` → `w[1] / w[0] ≈ 4`（r=1 → 1+3）且 `novel = [rare]`；`noveltyFactors(0.5, …)` → 2.5；全部不适用 → null。
  - `novel objects are marked`：`generate('7', { novelty: 1 })` 里带 `novel` 的物件 ≥ 1，每个的 key 在 `usage.counts` 里为 0 或缺席。
  - `judge ignores novel objects in density`：构造两个 `JWorld`，只差一个 `novel` 物件，`d.all` 相同、`e.*`（不过滤）可以不同。
  - `threshold relaxes with novelty`：`scoreWorld(w, MODEL, 0.5).threshold === MODEL.threshold + 0.1`。
- [ ] **Step 2:** 跑测试，预期失败。
- [ ] **Step 3:** 写 `export_usage.py`（照 `export_judge_data.py` 的写法；`references/holdout/` 不存在时次数为 0、照样输出），运行 `cd tools && uv run python export_usage.py`。
- [ ] **Step 4:** 实现 `novelty.ts`、`adjust.ts` 的组合、`generateBase` 在 `sb.finish()` 之后调用 `markNovel(scene, trace.novel)`（`rationalize` 之前）、`align.ts` 带上 `novel`、`features.ts` 的 `known`、`generate()` 把 `opts.novelty` 传给 `scoreWorld`。
- [ ] **Step 5:** 测试、`tsc`、`npm test` 通过；回归 `snapshot-par ../work/regress/t3 --nov 0` 对 `v0.6.1b-off` → 200/200。再跑默认（创新度 0.10）`snapshot-par ../work/regress/t3-def`，记录变化的种子数（预期有一部分变化，写进 ledger）。

### Task 4: 画面差异和 A/B 出题（`learn/diff.ts`、`learn/ab.ts`、`scripts/abcheck.ts`）

**Files:**
- Create: `app/src/gen/learn/diff.ts`、`app/src/gen/learn/ab.ts`、`app/scripts/abcheck.ts`
- Modify: `app/src/viewer/gen.worker.ts`
- Test: `app/src/gen/learn/ab.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `forceKey`、`alternatives`、`Decision`；`generateBase`。
- Produces:
  - `diff.ts`：`export interface DiffItem { id: string; rect: PxRect }`；`export function diffItems(a: Scene, b: Scene): DiffItem[]`（物件按 `signature` 的元组**去掉 `sub`** 做多重集差，两边多出来的都算，id = 元组 JSON + `#序号`，框 = x,y,w,h；地面按层逐格比较，id = `g:层:x:y`，框 = 这一格）；`export const pad = (r: PxRect, p = 8) => PxRect`；`export const bbox = (rs: PxRect[]) => PxRect | null`；`export const gap = (a: PxRect, b: PxRect) => number`（两框间距，重叠为 0）。
  - `ab.ts`：
    - `export interface Change { stream: string; label: string; k: number; ctx?: Ctx; a: string; b: string; rect: PxRect; big: boolean; answer?: 'a' | 'b' | 'same'; note?: string }`
    - `export interface AbQuestion { seed: string; options: GenOptions; kind: 'auto' | 'manual'; big: boolean; changes: Change[]; noEffect: string[]; tried: number; ms: number }`
    - `export interface AbStats { pairs: Record<string, number>; optPairs: Record<string, number>; recent: string[]; same: Record<string, { same: number; n: number }> }`（键：`label|ctxKey`、`label|ctxKey|opt`；`recent` = 最近 20 题的标签）；`export function statsFrom(changes: { label: string; ctx?: Ctx; a: string; b: string; answer: string }[], recent: string[]): AbStats`。
    - `export function makeQuestion(req: { seed: string; options: GenOptions; stats: AbStats; big: boolean; first?: { stream: string; label: string; k: number; b: string }; only?: boolean }, onProgress?: (n: number, N: number) => void): { q: AbQuestion; a: Scene; b: Scene }`
    - `export const isStructural = (d: Decision) => /^(layout|block)(\/|$)/.test(d.s) || d.label.startsWith('pack.') || d.label === 'bld.modularOrSingle'`
  - Worker：新增请求 `{ id, ab: <makeQuestion 的 req> }` → `{ id, progress }`…`{ id, ab: { q, a, b } }`。
- 出题算法（spec 3.1，写进 `ab.ts` 顶部注释）：
  1. A = `generateBase(seed, { ...options, exp: { ...options.exp, 'exp-02': false }, force: {} })`。
  2. 候选 = A 的决策里 `alternatives(d).length ≥ 2` 的；备选项 = 除当前选项外 `optPairs` 最少的那个，平局用 `new Rng(\`ab/${seed}\`)` 的 `choose`（不带 trace）定。
  3. 按打分降序（Global Constraints 的公式；`isStructural` 只在 `big` 题里参与，非大题里跳过）。
  4. 依次单独强制生成（最多 30 次），`diffItems` 为空 → `noEffect` 记标签；否则 `rect = pad(bbox(...))`，`big = 宽或高 > 192`。
  5. 非大题：贪心收 `!big` 的候选，与已收的框 `gap ≥ 16`，收满 6 个停；大题：取第一个 `big` 的候选，只出这一处（没有就退回非大题）。
  6. 验证：同时强制全部入选的生成 B；`diffItems(A, B)` 的 id 集合必须等于各处单独差异 id 的并集。不等时，撤掉框与差异对称差里任一项相交的改动（没有相交的就撤最后一处），重新生成 B，直到相等；剩 0 处 → 用剩下的候选继续（仍 0 → 返回 `changes: []`，由界面提示“这张图出不了题，按 Enter 换一张”）。
  7. `first`：作为第一处强制入选（不受 big / 结构性限制）；`only` = 只出这一处。
- [ ] **Step 1: 写测试** `ab.test.ts`（这些用真实生成，种子小一些、`maxTry` 可以作为 req 的可选参数调小加速）：
  - `diff ignores draw sequence numbers`：两份只差 `sub` 的场景 → `diffItems` 为空；多一个物件 → 恰好 1 项。
  - `question changes are isolated`：种子 7 出一道非大题，每处改动单独强制生成的差异全在它自己的 `rect` 里，且框两两 `gap ≥ 16`；B 的差异全落在框的并集里。
  - `overlapping changes are dropped`：用 `first` 指定一处改动，再手工构造第二处与它影响范围重叠的候选（同一流里相邻的两个决策），验证最终题目里不会同时出现（可以直接测导出的内部函数 `verify(A, changes, gen)`，`gen` 注入一个假的生成函数，返回事先拼好的场景）。
  - `question reproduces`：用 `q.options` + 合并后的 force 再 `generateBase` 一次，签名等于返回的 `b`；不带 force 的签名等于 `a`。
- [ ] **Step 2:** 跑测试，预期失败。
- [ ] **Step 3:** 实现 `diff.ts`、`ab.ts`、worker 消息。
- [ ] **Step 4:** `scripts/abcheck.ts [n=50]`：种子取 `SEEDS` 前 n 个，每个出一道题（非大题，第 5、10… 道出大题），逐处验证“单独差异 ⊆ 自己的框、框不和别的框重叠”，打印“n 题、m 处改动、溢出 0 处、平均每题 x 处、平均 y 秒”，溢出 > 0 时退出码 1。
- [ ] **Step 5:** 测试、`tsc` 通过；`npx tsx scripts/abcheck.ts 50` 溢出 0。

### Task 5: 训练数据、`scripts/prefs.ts train | eval | gaps`

**Files:**
- Create: `app/src/gen/learn/data.ts`、`app/scripts/prefs.ts`、`tools/crop_region.py`
- Modify: `app/src/gen/learn/prefs.ts`（如需导出辅助函数）
- Test: `app/src/gen/learn/data.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Comparison`、`fit`、`toTable`、`score`；Task 1 的 `alternatives`；`labelset.ts` 的 `LABEL_DIR` 写法；`signature`。
- Produces:
  - `CHOICE_DIR = references/choices`。选择文件格式见 spec 3.4。
  - `export function loadChoiceComparisons(dir = CHOICE_DIR): { cs: Comparison[]; files: number; skipped: number }`（`answer` 缺失的改动不算；`batch` = 文件相对路径）。
  - `export interface LabelAttribution { label: Label; file: string; scene: Scene; decisions: Decision[] }`；`export function attributeLabels(minVersion = '0.5.1'): { items: LabelAttribution[]; skipped: { file: string; id: string; why: string }[] }`：
    - 版本 < 0.7.0 的标注：`generate(seed, { ...l.options, novelty: 0, prefs: false, force: undefined })`；≥ 0.7.0：`{ ...l.options, force: undefined }`。签名等于存下的场景 → 用新生成的场景；否则，存下的场景物件有 `stream` → 用存下的；都不行 → 跳过，`why` 写原因。
    - 归因：物件型目标 → 按 key + x/y（±2px）在场景里找到这些物件，取它们的 `stream`；区域型 → 脚（`objBox` 底边中点）落在区域里的物件的 `stream`；决策 = `trace.decisions` 里 `s` 属于这些流、`alternatives ≥ 2` 的。
  - `export function labelComparisons(items: LabelAttribution[]): Comparison[]`：坏标注 → 每个决策的已选项对每个备选项“输”（`a` = 已选，`b` = 备选，`answer: 'b'`）；好标注 → `answer: 'a'`；总权重 0.3 平分；`batch` = `label:<文件>#<id>`。
  - `scripts/prefs.ts`：
    - `train` → `fit`（过滤黑名单）→ `toTable(…, VERSION)` 写 `app/src/gen/data/prefs.json`，打印条目数。
    - `eval` → 写 `docs/PREFS.md`（spec 4.3 的全部条目；“按批次 5 折留出准确率”只用选择文件的比较，按文件分折，不含平局，得分差为 0 记 0.5；基线 = 留出集里 `answer === 'b'` 的比例；选择文件少于 5 个时用留一批次；没有选择数据时写“还没有 A/B 选择数据”）。
    - `gaps` → 对每条坏标注，用“去掉这条标注所在种子的全部标注”的数据训练的模型（留一种子），看归因决策里有没有备选项得分比已选项高 ≥ 0.05：有 → “选择能改善”，否则 → “选择解决不了”；写 `work/gaps/gaps.md`（每条：种子、版本、标签、备注、归因到的决策数、分类、`crop_region.py` 生成的截图路径）和 `work/gaps/gaps.json`。
  - `crop_region.py <scene.json> <x0> <y0> <x1> <y1> <out.png> [--pad 32]`：调用 `render_generated.py` 的渲染函数画整图（不写到 json 旁边），裁出区域，画红框，放大 2 倍保存。
- [ ] **Step 1: 写测试** `data.test.ts`：
  - `old labels regenerate with novelty 0`：`attributeLabels()` 对 `references/labels/v0.5.1/` 的标注，`skipped` 里因为“签名不同”被跳过的 ≤ 2 条（v0.6.x 与 v0.5.1 画面一致，NOTE D45 之前已验证）；每条 `items` 都有 ≥ 1 个决策。
  - `bad label makes chosen option lose`：对一条坏标注，`labelComparisons` 里所有比较 `answer === 'b'`，权重和 = 0.3。
  - `unknown labels are skipped and counted`：在临时目录写一个选择文件，含一条 `answer` 缺失的改动和一条正常的 → `cs.length === 1`，`skipped === 1`（缺 answer 的计 skipped）。
- [ ] **Step 2:** 跑测试，预期失败。
- [ ] **Step 3:** 实现 `data.ts`、`scripts/prefs.ts`、`crop_region.py`。
- [ ] **Step 4:** 运行 `npx tsx scripts/prefs.ts train`、`eval`、`gaps`。`train` 之后偏好表不再为空：重跑 `snapshot-par ../work/regress/t5-l1 --nov 0`，记录相对 `v0.6.1b-off` 变化的种子数（偏好开的效果），以及 `--nov 0 --noprefs` 仍 200/200。
- [ ] **Step 5:** 测试、`tsc` 通过；`docs/PREFS.md` 生成。

### Task 6: 实验转正 / 废弃报告（`scripts/experiments.ts`）

**Files:**
- Create: `app/scripts/experiments.ts`、`app/src/gen/data/experiments.json`（生成）
- Test: `app/src/gen/learn/experiments.test.ts`（放 `learn/` 以便被 `npm test` 收进；被测函数放 `app/src/gen/learn/expreport.ts`）

**Interfaces:**
- Consumes: Task 5 的 `loadChoiceComparisons`、`loadLabels`（`scripts/labeltests.ts` 的写法：全部版本的标注，读存下的场景）。
- Produces:
  - `expreport.ts`：`export interface ExpEvidence { id: string; good: number; bad: number; abWin: number; abLose: number; total: number; goodShare: number | null; suggestion: '建议转正' | '建议废弃' | '继续观察' }`；`export function expEvidence(id: string, labels: { verdict: 'good' | 'bad'; rect: PxRect; scene: Scene }[], cs: Comparison[]): ExpEvidence`（标注：区域内有 `exp === id` 的物件或区域；A/B：`label === 'exp.fire'` 且所在流是 `exp/<id>`——比较里存 `ctx.exp`——`true` 胜 = abWin）。
  - `scripts/experiments.ts report` → 打印 markdown 表（编号、标题、好 / 坏、A/B 胜 / 负、建议、说明“执行要你确认后手动改 exp.ts 和 EXPERIMENTS.md”），写 `data/experiments.json` = `{ [id]: ExpEvidence }`。
- [ ] **Step 1: 写测试**：`expEvidence` 构造数据：好 6 坏 2 → 总 8、75% → `建议转正`；好 2 坏 6 → `建议废弃`；好 3 坏 1 → `继续观察`（不足 8）。区域外的实验物件不算。
- [ ] **Step 2:** 跑测试，预期失败。
- [ ] **Step 3:** 实现；运行 `npx tsx scripts/experiments.ts report`。
- [ ] **Step 4:** 测试、`tsc` 通过。

### Task 7: 查看器 A/B 模式（`src/viewer/ab.ts`、`/api/choices`）

**Files:**
- Create: `app/src/viewer/ab.ts`
- Modify: `app/src/main.ts`、`app/index.html`、`app/vite.config.ts`、`app/src/viewer/gen.worker.ts`（若 Task 4 未完成消息部分）

**Interfaces:**
- Consumes: Task 4 的 `makeQuestion` 请求 / 返回、`AbStats`、`statsFrom`、`Change`。
- Produces:
  - `/api/choices`：`POST { version, seed, file?, data }` → 写 `references/choices/v<版本>/seed<种子>_<时间戳>.json`（时间戳 `YYYYMMDD-HHMMSS`，文件名过 `safe()`）；`GET` → `{ changes: [{ label, ctx, a, b, answer, created }] }`（全部版本，给出题打分用）。
  - `ab.ts`：`export class AbSession`（题号、最近 20 题的标签、`stats`、当前题 `{ q, a, b }`、每处的回答）+ 绘制函数 `drawAb(ctx, q, view, sel)`（编号实线框、选中高亮、已回答的框按 A 绿 / B 蓝 / 差不多灰着色）。
- 行为（spec 3.2、3.3）：
  - B 进出 A/B 模式（标注模式里有选中物件 / 区域时，B 改为打开手动发起面板，见下）。进入时第一题用当前种子，之后每题换随机新种子（NOTE 记录）；第 5、10… 题 `big: true`。
  - 顶栏信息：“A/B 第 n 题 · 出题中…（k / 30）”；完成后“A/B 第 n 题 · m 处改动 · 正在看 A”。
  - 空格切 A / B；V 切并排（B 画在 A 右侧，间隔 2 格，框两边都画）；数字 1–6 选中某处，← A 好、→ B 好、↓ 差不多；侧栏列出每处“`label`（ctx）：A 选项 → B 选项”和回答，选中时可输入备注；Enter 保存（只保存已回答的改动，没有回答的整题等同跳过）并出下一题；S 跳过；Esc 退出。
  - 手动发起：标注模式里选中物件或框选区域后按 B → 侧栏列出相关流（物件：它的 `stream`；区域：区域内物件的流）的决策（`alternatives ≥ 2`，按 `i` 排），每行一个下拉框选备选项，两个按钮“只看这一处”“再配几处”。
  - 保存的 `options` 去掉 `force`；`kind`、`novelty` 按 spec 3.4。
- [ ] **Step 1:** 实现 `/api/choices` 与 `ab.ts`、`main.ts` 接线、`index.html` 的侧栏区块和按键说明。
- [ ] **Step 2:** `npx tsc --noEmit`、`npx vite build` 通过。
- [ ] **Step 3:** 浏览器验证（启动 vite，Playwright 用 `scripts/shots.ts` 的写法写一个一次性脚本 `work/ab_smoke.ts`）：按 B 出题，截图 A、B、并排三张；按 ← → ↓ 各回答一处，Enter；确认 `references/choices/v0.7.0/` 下出现文件且内容符合格式；之后删掉这个测试文件（不要留下假数据）。

### Task 8: 查看器其余改动（偏好开关、存档为合格、新贴图样式、偏好悬停、实验菜单证据）

**Files:**
- Modify: `app/src/main.ts`、`app/index.html`、`app/vite.config.ts`、`app/src/viewer/overlay.ts`、`app/src/viewer/labels.ts`

**Interfaces:**
- Consumes: Task 2 的 `PREFS`（`n`）、Task 6 的 `data/experiments.json`。
- Produces:
  - 顶栏复选框“学到的偏好”（`opts.prefs`，URL `l=0`）；`sceneStem` 在 `prefs === false` 时加 `_l0`。
  - “存档为合格”按钮 + 快捷键 K → `POST /api/holdout { version, name: \`v${version}_${sceneStem(sc)}.json\`, scene }` → 写 `references/holdout/`；已存在同名文件时覆盖前 `confirm`；成功 toast 提示“重新运行 export_usage.py 才会计入使用次数”。
  - `NOVEL_COLOR` 改金色 `#ffc107`，金色虚线框；图例新增“新贴图”一行（有 `novel` 物件时显示，可勾选隐藏）；详情面板“新贴图（参考图里没用过）”。
  - 物件详情面板：列出它的流里带 `m` 的决策：“`label`：pick 偏好 ×1.8（12 次选择）”（`n` 来自 `PREFS.labels[label].n`）。
  - “实验 ▾”菜单每行追加“好 5 / 坏 1，建议转正”（没有证据时“暂无证据”）。
- [ ] **Step 1:** 实现。
- [ ] **Step 2:** `tsc`、`vite build` 通过。
- [ ] **Step 3:** 浏览器验证：`?seed=7&nov=1` 截一张开标注层的图，能看到金色虚线框；`l=0` 生效（URL、info 栏显示“偏好关”）；K 存档后 `references/holdout/` 出现文件（验证后删掉，除非用户要保留）。

### Task 9: 回归报告扩展（`regress.ts`）

**Files:**
- Modify: `app/scripts/regress.ts`

**Interfaces:**
- Consumes: Task 2 已加的 `--nov`、`--noprefs`。
- Produces: snapshot 额外写 `<seed>.learn.json` = `{ novel: number; adjusted: number; forced: number; novelty: number; prefs: boolean }`（`adjusted` = 带 `m` 的决策数）；`index.json` 带 `novelty`、`prefs`；`report` 新增一段“学习与创新度”：`novel` 物件合计 / 涉及种子、被乘子改动的决策数（平均每张）A → B；旧快照没有 `learn.json` 时写“（旧快照，无记录）”。`report` 的标注测试照旧按 B 的模式重放（`modeOpts` 带 novelty / prefs）。
- [ ] **Step 1:** 实现。
- [ ] **Step 2:** `snapshot-par ../work/regress/t9 --nov 0.5` 与 `report ../work/regress/t3-def ../work/regress/t9` 能跑通、输出新段落。

### Task 10: 发布 v0.7.0

**Files:**
- Modify: `app/src/gen/generate.ts`（`VERSION = '0.7.0'`）、`docs/NOTE.md`、`docs/PROGRESS.md`、`docs/EXPERIMENTS.md`、`docs/methodology.md`、`docs/CONSTRAINTS.md`（若 `constraints.ts doc` 有变化）
- Create: `docs/v0.7.0.md`、`docs/v0.7.0/`（截图）

- [ ] **Step 1:** 全量验证并记录数字：
  - `npm test`、`tsc`、`regress.ts explain`（`unlabelled draws: 0`）；
  - `snapshot-par ../work/regress/v0.7.0-n0-l0 --nov 0 --noprefs`，对 `v0.6.1b-off` → 200/200（验收 1）；
  - `snapshot-par ../work/regress/v0.7.0`（默认）、`v0.7.0-n0`（`--nov 0`）、`v0.7.0-n05`（`--nov 0.5`）、`v0.7.0-n1`（`--nov 1`）；`report v0.7.0-n0 v0.7.0-n05`、`report v0.7.0-n0 v0.7.0-n1`：硬约束（active）违规合计不多于创新度 0（验收 5），`novel` 物件随创新度增加；
  - `report v0.6.1b-off v0.7.0`（默认相对上一版的变化）；
  - `abcheck.ts 50`（验收 3）；`prefs.ts eval`、`gaps`；`experiments.ts report`。
- [ ] **Step 2:** 截图（`scripts/shots.ts`，逐个种子）：A/B 模式的一道题（A、B、并排），创新度 0 / 0.5 / 1 的同一种子带标注层，存到 `docs/v0.7.0/`。
- [ ] **Step 3:** 写 `docs/v0.7.0.md`：做了什么、怎么用（A/B 按键、K、`l=0`、`nov`）、回归数字、`PREFS.md` 摘要（当前数据只有标注，A/B 还没有数据，如实写）、实验报告表、**“选择解决不了的问题”**一节（根据 `work/gaps/gaps.md` 归类：每类写例子（种子、截图）、原因（打包几何 / 连续位置 / 缺少提议）、2–3 个扩展提议空间的方案，每个写改动范围、风险、要不要新约束）、要用户回答的问题（乘子表核对、选哪个扩展方案作为 exp-03、实验 exp-01 的建议）。
- [ ] **Step 4:** 更新 NOTE（本阶段的决策 D46 起，包括执行中的 Ruling）、PROGRESS（当前状态、怎么运行里的新命令、代码结构里的 `learn/`、下一步 = 等用户做 A/B 和核对）、EXPERIMENTS（`fireByNovelty`、证据报告）、methodology（阶段 7 一段）。
- [ ] **Step 5:** `git add -A`（确认 `work/` 不进 git、没有测试残留的 choices / holdout 文件），commit “v0.7.0: stage 7 - learning from choices, novelty”，打 tag `v0.7.0`。
