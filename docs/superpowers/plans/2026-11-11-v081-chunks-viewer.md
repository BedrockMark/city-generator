# v0.8.1 区块 API、Worker 池与查看器城市模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `getChunk` / `getBlock` / `worldInfo` 三个纯函数 API；查看器里能拖动、缩放漫游无限城市（后台 Worker 池按需生成）、点街区看世界层的说明、双击进入街区用现有标注层和标注工具；世界回归脚本。

**Architecture:** `app/src/world/chunk.ts` 只做组装：区块的地面直接取“拥有这一格的街区”的窗口地面（不再画世界地面，实测画一个 64 × 64 区块要约 210 ms），物件按 `foot` 所在格分给唯一的区块。查看器分两步用 Worker：先把街区分给 Worker 生成（每个街区只算一次，主线程保存去掉 trace 的精简版），再把一个区块需要的精简街区连同区块坐标交给 Worker 组装；主线程只排队和绘制。排队逻辑（`CityQueue`）和 Worker 池（`WorkerPool`）是不依赖 Phaser 的纯类，用假 Worker 做单元测试。

**Tech Stack:** TypeScript（`tsx --test`、`node:test`、`node:assert/strict`），Phaser 3（RenderTexture、Layer），Vite（module Worker），playwright-core（`shots.ts`，headless Edge）。

**Spec:** `docs/superpowers/specs/2026-11-11-v1-city-design.md`（本计划覆盖第 10 节的 v0.8.1 一行：第 5、6 节，第 7 节里 `worldInfo` 的 `why`，第 9 节的世界回归脚本和 `shots.ts --city`；特色街区占地、分区参数、C26 在 v0.8.2）。v0.8.0 的计划：`docs/superpowers/plans/2026-11-11-v080-world-layer.md`；世界层各文件见 `app/src/world/README.md`。

## Global Constraints

- 单街区模式不变：`generate(seed)` 在 200 个回归种子上和 v0.8.0-hotfix2 画面、约束记录完全相同（`regress.ts compare ../work/regress/v080 ../work/regress/v081` 0 变化），单街区查看器的导出 PNG 和改动前逐像素相同。
- 世界层所有概率、权重、尺寸只在 `app/src/world/config.ts` 里定义为具名导出常量（spec 3.8）。本计划新增：`WORKERS_MAX = 8`、`CITY_ZOOM = { min: 0.25, max: 4, default: 1 }`、`CHUNK_PREFETCH = 1`（视野外多要几圈区块）、`CHUNK_KEEP = 2`（视野外几圈之外的区块卸载）。
- 局部性：`getChunk(seed, cx, cy)` 的结果只依赖参数；缓存状态、请求顺序不影响结果（spec 验收 2）。
- 城市模式不用创新度（spec 3.9）：城市查看器和街区查看都不显示创新度滑块，`CityOptions` 没有 `novelty`。
- 区块 64 × 64 格（`CHUNK`），区块 `(cx, cy)` = `[64cx, 64cx+64) × [64cy, 64cy+64)`；坐标可为负，取整一律 `Math.floor`。
- v0.8.1 没有高度：`Chunk.height` 全是 0，`worldInfo().level` 是 0。
- 代码注释和命名跟现有代码一样：英文注释，界面文字和 `why` 用中文。
- 直接在 `main` 上开发；中间任务普通提交，最后一个任务做版本提交 + tag `v0.8.1`。
- 测试：`cd app && npm test`；类型检查 `npx tsc --noEmit`。

## Review Focus

1. **快速拖动 / 缩小**：排队的区块还没生成就离开视野。期望：不再需要的区块任务不再派发，晚到的结果不画、不留 RenderTexture；卸载的区块不泄漏纹理。→ Task 2 测试 `want() drops chunks no longer wanted`、`chunkDone of an unwanted chunk returns false`。
2. **某个街区生成时抛错**（生成器在个别窗口上出错、Worker 崩溃）。期望：这个街区记为失败，含它的区块照样组装（缺的格子用世界地面补，`missing` 列出街区 id），不会永远卡在“生成中”；Worker 崩溃后池里补一个新的。→ Task 1 测试 `assembleChunk paints world ground under a missing block`；Task 2 测试 `a failed block still lets its chunks assemble`；Task 3 测试 `a crashed worker is replaced and its job rejected`。
3. **切换模式时还有任务在跑**（城市 → 单街区 → 城市，或换世界种子）。期望：旧任务的结果被丢掉，不会画到新视图上。→ Task 2 测试 `reset() ignores results of earlier jobs`。
4. **街区标注的文件名**：街区场景的种子是 `1/b-1,0/RRL`，带 `/` 和 `,`；世界种子由用户输入，可能很长。期望：标注存到 `references/labels/v<版本>/seed<key>.json`，`key` 满足开发服务器的 `^[\w.-]{1,80}$`，不同街区不撞名；标注测试用 `getBlock` 重放，不用 `generate(l.seed)`。→ Task 6 测试 `storeKey`。
5. **负坐标和坏的 URL 参数**（`x=-300`、`z=abc`、`city=1` 但没有 `seed`）。期望：负区块照常工作；坏参数回到默认值（随机种子、原点、`CITY_ZOOM.default`），不抛错。→ Task 1 测试含负区块；Task 5 的 `parseCityUrl` 测试。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `app/src/world/chunk.ts`（新） | `CityBlock`、`Chunk`、`trimBlock`、`assembleChunk`、`getChunk`、`getBlock`、`worldInfo` |
| `app/src/world/chunk.test.ts`（新） | 区块和区域一致、接缝、局部性、缺街区、`worldInfo` |
| `app/src/world/config.ts`（改） | `WORKERS_MAX`、`CITY_ZOOM`、`CHUNK_PREFETCH`、`CHUNK_KEEP`；`CHUNK`、`OVERHANG_LIMIT` 的注释去掉“reserved” |
| `app/src/viewer/cityqueue.ts`（新） | `CityQueue`：想要的区块、街区 / 区块任务的先后、精简街区的 LRU |
| `app/src/viewer/pool.ts`（新） | `WorkerPool`：N 个 Worker、任务排队、崩溃替换、`poolSize()` |
| `app/src/viewer/city.worker.ts`（新） | Worker：`block` / `chunk` / `scene` 三种任务 |
| `app/src/viewer/draw.ts`（新） | 从 `main.ts` 抽出的绘制：`loadTextures`、`drawGround`、`drawObjects` |
| `app/src/viewer/city.ts`（新） | `CityMode`：城市漫游的相机、区块绘制 / 卸载、悬停、选街区、导出；`parseCityUrl` |
| `app/src/main.ts`（改） | 顶栏“单街区 / 城市”切换；城市模式时把输入交给 `CityMode`；街区查看（`getBlock` 场景 + 标注层）、Esc 返回 |
| `app/index.html`（改） | 模式切换按钮、城市侧栏 `#cityPanel`、`body.city` / `body.cityblock` 的显示规则 |
| `app/src/viewer/labels.ts`（改） | `Label.world?`、`storeKey(sc)` |
| `app/scripts/labeltests.ts`（改） | 带 `world` 的标注用 `getBlock` 重放 |
| `app/scripts/shots.ts`（改） | `--city x,y,z` |
| `app/scripts/cityregress.ts`（新）、`app/scripts/city_seeds.json`（新） | 世界回归 |
| `app/src/world/README.md`、`app/README.md`（改） | 新文件和用法 |

---

### Task 1: 区块 API（`chunk.ts`）

**Files:**
- Create: `app/src/world/chunk.ts`, `app/src/world/chunk.test.ts`
- Modify: `app/src/world/config.ts`

**Interfaces:**
- Consumes: `generateBlock(seed, blockId, opts): BlockScene`、`ownerCell`、`CityOptions`（`window.ts`）；`blocksIn(seed, r)`、`assembleRegion(seed, r, opts)`（`region.ts`，只在测试里作对照）；`ownerRaster`、`worldCell`、`roadOwner`（`cells.ts`）；`paintGround`（`ground.ts`）；`blockById`（`blocks.ts`）；`zoneAt`、`zoneValue`（`zone.ts`）；`vLine`、`hLine`、`cellAt`、`arterialWhy`（`arterials.ts`）。
- Produces（`chunk.ts`）：
  ```ts
  /** what a chunk needs of a block scene: window origin and size, ground layers, kept objects (window px) */
  export interface CityBlock { id: string; ox: number; oy: number; cols: number; rows: number; ground: (TileRef | null)[][][]; objects: Placed[] }
  export type ChunkObject = Placed & { blockId: string };   // world px; id = `${blockId}:${id}`, gid likewise
  export interface Chunk {
    cx: number; cy: number;
    ground: (TileRef | null)[][][];   // layers × 64 × 64
    height: number[][];               // 64 × 64, all 0 in v0.8.1
    objects: ChunkObject[];           // objects whose ownerCell is in this chunk, sorted by (foot, sub)
    blocks: string[];                 // blocksIn(seed, chunk rect)
    missing?: string[];               // blocks that were not available (failed); their cells use paintGround
  }
  export function chunkRect(cx: number, cy: number): Rect;
  export function chunkOf(x: number, y: number): [number, number];                 // world cell -> chunk
  export function trimBlock(id: string, b: BlockScene): CityBlock;
  export function assembleChunk(seed: string, cx: number, cy: number, block: (id: string) => CityBlock | undefined): Chunk;
  export function getChunk(seed: string, cx: number, cy: number, opts?: CityOptions): Chunk;   // assembleChunk over generateBlock
  export function getBlock(seed: string, blockId: string, opts?: CityOptions): Scene;          // generateBlock(...).scene
  export interface WorldInfo { cls: WorldCls; blockId?: string; owner: string; zone: ZoneKind; z: number; level: number; why: string[] }
  export function worldInfo(seed: string, x: number, y: number): WorldInfo;
  ```
  `config.ts`：`WORKERS_MAX = 8`、`CITY_ZOOM = { min: 0.25, max: 4, default: 1 } as const`、`CHUNK_PREFETCH = 1`、`CHUNK_KEEP = 2`。

- [ ] **Step 1: 写失败的测试 `chunk.test.ts`**（种子 `'1'`；用 `_clearWindowCache` / `_clearBlockCache` 清缓存）

```ts
test('chunk ground equals assembleRegion on the chunk rect, cell by cell', ...)
  // for (cx, cy) of [(0,0), (-1,-1)]: getChunk(...).ground deep-equals assembleRegion('1', chunkRect(cx, cy)).ground
  //   (same layer count; this proves every owned cell is inside its owner's window and needs no world paint)
test('objects of a 2 x 2 chunk area equal assembleRegion of the area, each exactly once', ...)
  // union of getChunk objects for cx, cy in {-1, 0}: ids unique; as a set of `${id}@${x},${y},${foot}` equal to
  //   assembleRegion('1', {x0:-64,y0:-64,x1:64,y1:64}).objects mapped the same way
  //   (assembleRegion's px are relative to x0 = -64: add -64 * 16 to x, y, foot before comparing)
test('every chunk object stands in its chunk and carries its blockId', ...)
  // chunkOf(floor(ownerCell world x), ...) === [cx, cy]; o.id.startsWith(o.blockId + ':')
test('getChunk does not depend on cache state or request order', ...)
  // A: clear caches, getChunk (0,0) then (1,0); B: clear caches, getChunk (1,0) then (0,0) -> JSON equal per chunk
test('assembleChunk paints world ground under a missing block', ...)
  // block lookup returning undefined for blocksIn(...)[0]: chunk.missing = [that id]; on the cells that block owns,
  // ground equals paintGround('1', chunkRect(0,0)) base / over; no objects with that blockId
test('height is 64 x 64 zeros; chunkOf floors negatives', ...)
  // chunkOf(-1, -1) -> [-1, -1]; chunkOf(63, 64) -> [0, 1]
test('worldInfo explains lots, sidewalks, streets and arterials', ...)
  // a lot cell of blocksIn(...)[0]: cls 'lot', blockId set, why includes every line of blockById(...).why
  // an arterial cell (worldCell(...).arterial): cls 'road', no blockId, a why line starts with '竖向主干道' or '横向主干道'
  // a street cell (cls road, not arterial): a why line contains '支路'
  // every case: level 0, owner === ownerOf(seed, x, y), zone === zoneAt(seed, x, y), z === zoneValue(seed, x, y), a why line contains '分区'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx tsx --test src/world/chunk.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `chunk.ts` 和 `config.ts` 新常量**

- `assembleChunk`：`blocksIn(seed, chunkRect)`；`ownerRaster(seed, rect)`；地面层数 = 拿到的街区地面层数的最大值（至少 2）；每格取拥有它的街区的地面（该街区没有这一层时为 `null`）；有街区缺失时才调 `paintGround(seed, rect)`，缺失街区拥有的格子用它的 `base` / `over`。物件：每个拿到的街区里 `ownerCell` 换算到世界格后落在本区块的物件，平移到世界 px（`x`、`y`、`foot`、`solid`、`fp`、`anchor` 和 `region.ts` 一样平移），`id` / `gid` 加 `<blockId>:` 前缀，按 `(foot, sub)` 排序。
- `trimBlock` 只复制字段，不带 `trace`、`audit`、`zones`、`groups`。
- `worldInfo` 的 `why`：先一行分区（`分区：闹市（z = 0.71）`，名字沿用 `blocks.ts` 的 `ZONE_NAME`，导出它）；街区格接 `blockById(...).why` 全部和一行“街区 <id>：<rect|jog>，人行道 <sw> 格，铺地 <paving>”；马路格：主干道写所在的每条主干道的 `arterialWhy`（点在竖向主干道 i 上 = 对覆盖 y 的那一段 j，`x ∈ [vLine(i,j).x0, +w)`；横向同理；路口两条都写），支路写“支路：主干道格 (i,j) 里切出来的马路，宽 5 格”；都再写一行“这一格归 <owner>（最近的人行道，spec 2.3）”。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx tsx --test src/world/chunk.test.ts && npm test && npx tsc --noEmit`
Expected: 全部 PASS。顺便打印（测试里 `console.log` 或临时脚本）：已缓存街区时 `assembleChunk` 一次的耗时，写进 Task 8 的报告；目标 < 50 ms。

- [ ] **Step 5: Commit**

```bash
git add app/src/world/chunk.ts app/src/world/chunk.test.ts app/src/world/config.ts app/src/world/blocks.ts
git commit -m "world: chunk API (getChunk / getBlock / worldInfo)"
```

---

### Task 2: 排队（`CityQueue`）

**Files:**
- Create: `app/src/viewer/cityqueue.ts`, `app/src/viewer/cityqueue.test.ts`

**Interfaces:**
- Consumes: `CityBlock`（Task 1）；`BLOCK_CACHE`（`config.ts`）。
- Produces:
  ```ts
  export type CityJob =
    | { kind: 'block'; epoch: number; id: string }
    | { kind: 'chunk'; epoch: number; cx: number; cy: number; blocks: CityBlock[]; missing: string[] };
  export class CityQueue {
    constructor(blocksOf: (cx: number, cy: number) => string[], cacheSize?: number);   // default BLOCK_CACHE
    epoch: number;
    want(chunks: [number, number][]): void;   // nearest first; replaces the list (already drawn chunks are not passed)
    next(): CityJob | null;                   // see Step 3
    blockDone(epoch: number, id: string, b: CityBlock | null): void;   // null = failed
    chunkDone(epoch: number, cx: number, cy: number): boolean;         // false: stale epoch or no longer wanted -> discard
    block(id: string): CityBlock | undefined;
    reset(): void;                            // epoch++, forget wanted / running / blocks
    get idle(): boolean;                      // nothing wanted, nothing running
  }
  ```

- [ ] **Step 1: 写失败的测试 `cityqueue.test.ts`**（`blocksOf` 用假表：`(0,0) -> ['a','b']`、`(1,0) -> ['b','c']`；`fake(id)` 造一个最小 `CityBlock`）

```ts
test('blocks of the nearest chunk are dispatched first, each block once', ...)
  // want([[0,0],[1,0]]): next() x3 -> block a, block b, block c; a 4th next() -> null (all running)
test('a chunk job comes as soon as its blocks are done, before further block jobs', ...)
  // after blockDone a, b: next() -> chunk (0,0) with blocks [a, b] (by id), missing []
test('a failed block still lets its chunks assemble', ...)
  // blockDone(epoch, 'a', null), blockDone 'b' ok -> chunk (0,0) job has missing ['a'], blocks [b]
test('want() drops chunks no longer wanted', ...)
  // want([[0,0],[1,0]]); want([[1,0]]) -> next() gives block b then c, never a
test('chunkDone of an unwanted chunk returns false', ...)
  // chunk (0,0) job dispatched; want([[1,0]]); chunkDone(e, 0, 0) === false; a wanted one returns true and leaves the list
test('reset() ignores results of earlier jobs', ...)
  // job from epoch 0; reset(); blockDone(0, ...) has no effect (block(id) undefined); chunkDone(0, ...) false
test('the block cache never evicts a block a wanted chunk still needs', ...)
  // cacheSize 1: blocks a, b done while (0,0) wanted -> both still there; after chunkDone(0,0) and want([]), an
  // extra block done evicts down to 1
test('idle once nothing is wanted or running', ...)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx tsx --test src/viewer/cityqueue.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `CityQueue`**

`next()` 的顺序：① 想要列表里第一个“所有街区都已完成或失败、且没有在组装”的区块 → `chunk` 任务（`blocks` 按 id 排序，`missing` 是失败的）；② 否则按想要列表的顺序，第一个“没完成、没在跑、没失败”的街区 → `block` 任务；③ 都没有 → `null`。缓存只存成功的街区，LRU；淘汰时跳过想要的区块还需要的街区。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx tsx --test src/viewer/cityqueue.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/viewer/cityqueue.ts app/src/viewer/cityqueue.test.ts
git commit -m "viewer: city job queue"
```

---

### Task 3: Worker 池和城市 Worker

**Files:**
- Create: `app/src/viewer/pool.ts`, `app/src/viewer/pool.test.ts`, `app/src/viewer/city.worker.ts`

**Interfaces:**
- Consumes: `getBlock`、`trimBlock`、`assembleChunk`、`CityBlock`、`Chunk`（Task 1）；`generateBlock`（`window.ts`）；`WORKERS_MAX`。
- Produces:
  ```ts
  // pool.ts
  export interface WorkerLike { postMessage(m: unknown): void; terminate(): void;
    onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: { message?: string }) => void) | null }
  export class WorkerPool {
    constructor(spawn: () => WorkerLike, size: number);
    get free(): number;                                        // idle workers
    run<R>(msg: object, urgent?: boolean): Promise<R>;         // queued when none is free; urgent jumps the queue
    terminate(): void;                                         // all workers; pending promises reject
  }
  export function poolSize(cores: number | undefined): number; // max(1, min(WORKERS_MAX, (cores ?? 2) - 1))
  // city.worker.ts messages
  //   in  { id, kind: 'block', seed, blockId }               out { id, block: CityBlock }
  //   in  { id, kind: 'chunk', seed, cx, cy, blocks: CityBlock[], missing: string[] }   out { id, chunk: Chunk }
  //   in  { id, kind: 'scene', seed, blockId }               out { id, scene: Scene }   (full getBlock, for annotation)
  //   any failure: out { id, error: string }
  ```

- [ ] **Step 1: 写失败的测试 `pool.test.ts`**（假 Worker：`postMessage` 记下消息，测试手动调 `onmessage` / `onerror`）

```ts
test('runs at most size jobs at once and queues the rest in order', ...)
  // size 2, run x3: 2 posted; resolving the first posts the third
test('urgent jobs go before queued ones', ...)
test('an error reply rejects that job only', ...)   // reply { id, error: 'x' } -> that promise rejects with 'x'
test('a crashed worker is replaced and its job rejected', ...)
  // onerror on worker 1 -> its job rejects, terminate() called on it, spawn called again, free count restored
test('poolSize', ...)   // poolSize(16) === 8, poolSize(4) === 3, poolSize(1) === 1, poolSize(undefined) === 1
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx tsx --test src/viewer/pool.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `pool.ts` 和 `city.worker.ts`**

池给每条消息加 `id`（池内递增），按 `id` 对回复。Worker 里 `block` 用 `trimBlock(blockId, generateBlock(seed, blockId))`；`chunk` 用 `assembleChunk(seed, cx, cy, id => map.get(id))`，`map` 由消息里的 `blocks` 建（`missing` 里的不在 map 里）；`scene` 用 `getBlock`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx tsx --test src/viewer/pool.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/viewer/pool.ts app/src/viewer/pool.test.ts app/src/viewer/city.worker.ts
git commit -m "viewer: worker pool and city worker"
```

---

### Task 4: 抽出绘制函数（单街区画面不变）

**Files:**
- Create: `app/src/viewer/draw.ts`
- Modify: `app/src/main.ts`（`loadTextures`、`frameIndex`、`region`、`band`、`render` 的绘制循环）

**Interfaces:**
- Produces（`draw.ts`，都以 Phaser 场景为第一个参数）：
  ```ts
  export function loadTextures(sc: Phaser.Scene, sheets: Record<string, string>, objects: Placed[], done: () => void): void;
  export function drawGround(sc: Phaser.Scene, rt: Phaser.GameObjects.RenderTexture, sheets: Record<string, string>,
    ground: (TileRef | null)[][][], dx?: number, dy?: number): void;          // inside rt.beginDraw()/endDraw()
  export function drawObjects(sc: Phaser.Scene, rt: Phaser.GameObjects.RenderTexture, objects: Placed[], ghost: boolean,
    dx?: number, dy?: number): void;                                          // sorts by (foot, sub) itself
  export const ASSET_ROOT = 'assets/';
  ```
  `main.ts` 的 `render()` 改成 `beginDraw` → `drawGround` → `drawObjects` → `endDraw`。

- [ ] **Step 1: 改动前导出对照图**

Run（另开 `cd app && npx vite`）：`cd app && npx tsx scripts/shots.ts ../work/v081/before 1 2 --anno`
Expected: `citygen_v0.8.0-hotfix2_seed1.png` 等文件写出。

- [ ] **Step 2: 抽出 `draw.ts`，`main.ts` 改用它**（纯搬移，不改逻辑）

- [ ] **Step 3: 改动后导出并逐像素比较**

Run: `cd app && npx tsx scripts/shots.ts ../work/v081/after 1 2 --anno`，然后用 Python（`uv run --with pillow python -c ...`）比较 `before` / `after` 里同名的 `.png`、`_ghost.png`、`_annotated.png`。
Expected: 每对图逐像素相同；`npx tsc --noEmit` 无错。

- [ ] **Step 4: Commit**

```bash
git add app/src/viewer/draw.ts app/src/main.ts
git commit -m "viewer: move drawing helpers to draw.ts"
```

---

### Task 5: 查看器城市模式（漫游）

**Files:**
- Create: `app/src/viewer/city.ts`, `app/src/viewer/city.test.ts`
- Modify: `app/src/main.ts`, `app/index.html`, `app/scripts/shots.ts`

**Interfaces:**
- Consumes: `CityQueue`（Task 2）；`WorkerPool`、`poolSize`、`city.worker.ts`（Task 3）；`drawGround`、`drawObjects`、`loadTextures`（Task 4）；`worldInfo`、`chunkRect`、`Chunk`（Task 1）；`blocksIn`（`region.ts`，作 `CityQueue` 的 `blocksOf`）；`blockById`；`CITY_ZOOM`、`CHUNK_PREFETCH`、`CHUNK_KEEP`、`CHUNK`。
- Produces:
  ```ts
  export interface CityUrl { seed: string; x: number; y: number; z: number }   // x, y = world cell at the view centre
  export function parseCityUrl(q: URLSearchParams, randomSeed: () => string): CityUrl | null;   // null when city != 1
  export function wantedChunks(view: { x0: number; y0: number; x1: number; y1: number }, ring: number): [number, number][];
    // view in world cells; chunks meeting the view grown by `ring` chunks, nearest (chunk centre to view centre) first
  export class CityMode {
    constructor(scene: Phaser.Scene, overlay: HTMLCanvasElement, onEnterBlock: (seed: string, blockId: string) => void);
    enter(u: CityUrl): void;  exit(): void;  hide(): void;  show(): void;   // hide/show keep chunks (block view)
    update(): void;                                // each frame: wanted chunks from the camera, pump the pool
    pointerMove(wx: number, wy: number): void;     // hover: info bar `(x, y) · 分区 · 层 0 · 街区 id`
    click(wx: number, wy: number): void;           // select / unselect the block under the pointer
    enterSelected(): void;                         // double-click / Enter
    clearSelection(): boolean;                     // Esc; false when nothing was selected
    exportShot(): void;                            // E
    readonly idle: boolean;                        // every chunk meeting the view (ring 0) drawn
  }
  ```

- [ ] **Step 1: 写失败的测试 `city.test.ts`**（只测纯函数）

```ts
test('parseCityUrl reads city, seed, x, y, z and falls back on bad values', ...)
  // 'city=1&seed=7&x=-300&y=40&z=2' -> { seed: '7', x: -300, y: 40, z: 2 }
  // 'city=1&z=abc&x=foo' -> seed from randomSeed(), x 0, y 0, z CITY_ZOOM.default; z=100 -> clamped to CITY_ZOOM.max
  // 'seed=7' (no city) -> null
test('wantedChunks covers the view plus the ring, nearest first, negatives included', ...)
  // view {x0:-10,y0:-10,x1:10,y1:10}, ring 0 -> the 4 chunks (-1,-1),(0,-1),(-1,0),(0,0); ring 1 -> 16 chunks;
  // first element is one of the 4 central chunks
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx tsx --test src/viewer/city.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `city.ts`，接进 `main.ts` 和 `index.html`**

- URL：`?city=1&seed=…&x=…&y=…&z=…`（spec 6）；拖动结束和缩放后 `history.replaceState` 更新 `x`、`y`、`z`。顶栏加按钮“城市 / 单街区”切换；城市模式 `body.city`：隐藏特色街区菜单、创新度、学到的偏好、网格、虚化楼上层、标注按钮；种子框和“生成 / 重新生成”换成世界种子。单街区模式的行为和 URL 不变。
- 绘制：所有城市的东西放在一个 `Phaser.GameObjects.Layer` 里（`hide()` 时整层隐藏）。每个画好的区块两张 RenderTexture：地面一张，放在 `(64cx·16, 64cy·16)`，深度 `-1e6`；物件一张，大小 = 本区块物件精灵外包框，深度 `cy`（下面一行盖住上面一行；同一行左右相邻区块伸过边界的大精灵可能排序不对，spec 6 已接受，写进已知问题）。先 `loadTextures` 再画。
- 每帧：相机视野换算成世界格 → `wantedChunks(view, CHUNK_PREFETCH)` 去掉已画的 → `queue.want`；空闲 Worker 有几个就从 `queue.next()` 取几个任务派给池；`block` 结果 `queue.blockDone`，失败也调（`null`）并 `toast`；`chunk` 结果 `queue.chunkDone` 为真才画。视野外超过 `CHUNK_KEEP` 圈的区块销毁两张纹理。
- 悬停：世界格变了才调 `worldInfo`。单击：选中格子所在的街区（马路格选它的 `owner`），在 overlay 画布上描它的 `foot` 矩形，`#cityPanel` 显示 `worldInfo(...).why` 和按钮“进入街区 (Enter)”；再单击同一个街区取消。
- 缩放：滚轮 / 按钮，限制在 `CITY_ZOOM`；以视野中心缩放（和单街区一样）。
- 导出（E）：`renderer.snapshot` 当前画面 → `citygen_v<版本>_world<seed>_x<x>_y<y>_z<z>.png`，加同名 `.json`：`{ version, seed, x, y, z, chunks: [[cx, cy]...], blocks: [...] }`；`window.__exportCount = 2`。
- `window.__cityIdle = this.idle`（给 `shots.ts` 等），`window.__cityT0` = 进入城市模式的时间戳，`idle` 第一次变真时在信息栏写“一屏画满 x.x 秒”。
- `shots.ts`：`--city x,y,z`（可多个，用同一个世界种子）：打开 `?city=1&seed=<seed>&x=&y=&z=`，等 `__cityIdle` 为真（超时 180 s），截界面图 `ui_city_<seed>_<x>_<y>_<z>.png`，按 E 导出，打印画满用的秒数。

- [ ] **Step 4: 跑测试和截图**

Run: `cd app && npx tsx --test src/viewer/city.test.ts && npx tsc --noEmit`，再（vite 在跑）`npx tsx scripts/shots.ts ../work/v081/city 1 --city 0,0,1 --city -200,-150,0.5`
Expected: 测试 PASS；两张界面图和两张导出图写出，打印画满时间。用 Read 看图：路网和街区连续，区块之间没有缝、没有重复的物件；`z = 0.5` 那张也画满。

- [ ] **Step 5: Commit**

```bash
git add app/src/viewer/city.ts app/src/viewer/city.test.ts app/src/main.ts app/index.html app/scripts/shots.ts
git commit -m "viewer: city mode (streaming chunks, hover, block selection, export)"
```

---

### Task 6: 进入街区查看和标注

**Files:**
- Modify: `app/src/main.ts`, `app/index.html`, `app/src/viewer/labels.ts`, `app/scripts/labeltests.ts`
- Create: `app/src/viewer/labels.test.ts`

**Interfaces:**
- Consumes: `CityMode`（Task 5，`onEnterBlock`、`hide`、`show`）；池的 `scene` 任务（Task 3，`urgent = true`）；`getBlock`（Task 1）。
- Produces:
  ```ts
  // labels.ts
  export interface Label { /* existing fields */ world?: { seed: string; blockId: string } }
  export function storeKey(sc: Scene): string;
    // single-block scenes: sc.seed (unchanged); city blocks (sc.params.world): `w${world.seed}_${blockId}` with every
    // char outside [\w.-] replaced by '_'; longer than 80: first 71 chars + '_' + 8 hex digits of a hash of the full key
  ```
  `LabelStore` 用 `storeKey(sc)` 作 `seed` 参数；`Label.seed` 仍是 `sc.seed`。

- [ ] **Step 1: 写失败的测试 `labels.test.ts`**

```ts
test('storeKey keeps single-block seeds and makes city block keys file-safe and distinct', ...)
  // scene { seed: '42', params: {} } -> '42'
  // world { seed: '1', blockId: 'b-1,0/RRL' } -> 'w1_b-1_0_RRL', matches /^[\w.-]{1,80}$/
  // blockIds 'b0,1/L' and 'b0,1/R' -> different keys
  // world seed of 200 chars -> length 80, matches the regex; two such seeds differing in the last char -> different keys
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx tsx --test src/viewer/labels.test.ts`
Expected: FAIL（`storeKey` 不存在）

- [ ] **Step 3: 实现**

- 城市里双击街区、或选中后按 Enter / 点“进入街区”：池跑 `scene` 任务（urgent），信息栏“生成中… 街区 <id>”；拿到场景后记下城市相机（scroll、zoom），`CityMode.hide()`，用现有的 `show(scene)` 显示，`body.cityblock`：顶栏只留“返回城市 (Esc)”、标注 (A)、网格、虚化楼上层、导出；信息栏开头“世界 <seed> · 街区 <id>”。`reload()` 在街区查看里不做任何事。
- Esc：有钉住的选择先取消（现有行为）；没有时回到城市（`show()`，恢复相机，清掉 `current`）。
- 标注：`saveLabel` 在场景有 `params.world` 时加 `world`；`LabelStore` 用 `storeKey`。导出文件名用 `sceneStem`（已经把非法字符换成 `_`）。
- `labeltests.ts`：`l.world` 存在时场景用 `getBlock(l.world.seed, l.world.blockId, { prefs: l.options?.prefs })`，缓存键加上 `world`。

- [ ] **Step 4: 跑测试并手动走一遍**

Run: `cd app && npm test && npx tsc --noEmit`。用 playwright（可以在 `scratch` 脚本里，不提交）：打开 `?city=1&seed=1&x=0&y=0&z=1`，等 `__cityIdle`，在画面中心双击，等信息栏出现“街区”，按 A 截图，按 Esc，确认回到城市（截图）。
Expected: 测试 PASS；街区查看的标注层正常（小组框、悬停详情），返回城市后视野和返回前相同。在街区查看里存一条标注，确认写到 `references/labels/v<版本>/seedw1_b…json`，然后删掉这条测试标注（`references/labels/` 不能留测试数据）。

- [ ] **Step 5: Commit**

```bash
git add app/src/main.ts app/index.html app/src/viewer/labels.ts app/src/viewer/labels.test.ts app/scripts/labeltests.ts
git commit -m "viewer: enter a city block for annotation; city labels"
```

---

### Task 7: 世界回归脚本

**Files:**
- Create: `app/scripts/cityregress.ts`, `app/scripts/city_seeds.json`

**Interfaces:**
- Consumes: `getChunk`、`chunkRect`（Task 1）；`assembleRegion`、`blocksIn`（`region.ts`）；`generateBlock`、`_clearWindowCache`；`_clearBlockCache`；`classRaster`、`blockRaster`、`ownerRaster`；`blockById`。
- Produces: `npx tsx scripts/cityregress.ts <outDir> [--seeds a,b,…] [--jobs n] [--locality k] [--base <regress snapshot dir>]`，写 `<outDir>/<seed>.json`（每个种子的统计）和 `<outDir>/report.md`。

- [ ] **Step 1: `city_seeds.json`**：`["1", "2", …, "20"]`（只增不改，spec 9）。区域：每个种子区块 `cx, cy ∈ [-2, 2]`（5 × 5 个，世界格 `[-128, 192)²`）。

- [ ] **Step 2: 实现 `cityregress.ts`**

每个种子（`--jobs n` 时分给 n 个子进程，做法照 `regress.ts snapshot-par`；子进程写 `<seed>.json`，父进程汇总写报告）：
- 逐个区块 `getChunk`（行优先），记每个街区的生成时间（先对 `blocksIn` 的每个街区计时调 `generateBlock`）和每个区块的组装时间。
- **接缝 / 唯一**（验收 3）：25 个区块的地面拼起来和 `assembleRegion(seed, 整个区域).ground` 逐格相同；物件 id 不重复，集合和 `assembleRegion` 的相同（坐标换算同 Task 1 的测试）。
- **局部性**（验收 2）：前 `--locality k`（默认 3）个种子再清空缓存、按相反顺序算一遍，每个区块 JSON 相同。
- **马路连通**（验收 4 的马路部分；人行道步行可达是 v0.8.2 的 C26）：区域内马路格的每个四连通块都碰到区域边界；每个在区域里有地块格的街区，人行道至少有一格四邻是马路。
- **分布**：街区数、地块宽 / 高 最小 / 中位 / 最大、分区占比、jog 占比（同 `cityshot.ts`）。
- **约束**（验收 5）：每街区剩余违规数（按 `cityshot.ts` 的“中心落在本街区拥有的格”规则），按约束列出；`--base` 给出单街区快照目录时，读它的 `*.audit.json`，每个种子的剩余违规 = `counts` 各项之和，报告两边的平均值。
- 报告每一项写“通过 / 不通过”和数字；任何接缝、局部性、连通不通过时进程退出码 1。

- [ ] **Step 3: 小规模试跑**

Run: `cd app && npx tsx scripts/cityregress.ts ../work/cityregress/try --seeds 1,2 --locality 1`
Expected: 写出 `report.md`，接缝 / 局部性 / 连通全部通过；打印总耗时。

- [ ] **Step 4: Commit**

```bash
git add app/scripts/cityregress.ts app/scripts/city_seeds.json
git commit -m "scripts: city regression"
```

---

### Task 8: 版本 v0.8.1：回归、报告、文档

**Files:**
- Modify: `app/src/gen/generate.ts`（`VERSION = '0.8.1'`）、`app/src/world/README.md`、`app/README.md`、`docs/PROGRESS.md`、`docs/NOTE.md`
- Create: `docs/reports/v0.8.1.md`、`docs/reports/v0.8.1/`（截图）

- [ ] **Step 1: 单街区回归**

Run: `cd app && npx tsx scripts/regress.ts snapshot-par ../work/regress/v081 --jobs 8 && npx tsx scripts/regress.ts compare ../work/regress/v080 ../work/regress/v081`
Expected: 0 个种子变化（签名只含画面，`src/gen/signature.ts`，不含版本号）；约束记录（`*.audit.json`）逐个相同（`diff -r` 只比 `*.audit.json`）。

- [ ] **Step 2: 世界回归全量**

Run: `cd app && npx tsx scripts/cityregress.ts ../work/cityregress/v081 --jobs 8 --base ../work/regress/v081`
Expected: 退出码 0；记下耗时和各项数字。

- [ ] **Step 3: 截图**（vite 在跑）

Run: `cd app && npx tsx scripts/shots.ts ../docs/reports/v0.8.1 1 --city 0,0,1 --city 0,0,0.5 --city -250,120,0.5`，再照 Task 6 Step 4 截一张街区查看 + 标注层的图。
Expected: 图都写出；报告里引用。

- [ ] **Step 4: 文档**

- `docs/reports/v0.8.1.md`：做了什么（三个 API、Worker 两步、城市模式的操作说明：拖动、滚轮、单击看说明、双击 / Enter 进入街区标注、Esc、E 导出）；截图；单街区回归和世界回归的数字；一屏画满的时间（验收 7，注明 headless Edge 用的是软件 WebGL，实际浏览器会更快）；已知问题（同一行相邻区块大精灵的排序；城市模式没有虚化楼上层和网格）；要用户看的：在查看器里漫游、标几个街区。
- `docs/NOTE.md`：新决定（编号接 D83）——区块地面取拥有者街区的窗口地面而不是重画世界地面（原因：210 ms / 区块；被否决：主线程组装、每个 Worker 独立 `getChunk`（边界街区在几个 Worker 里重复算））；查看器 Worker 两步（街区、组装）；城市标注的存放键 `storeKey`。另在 D83 后补一句：用户 2026-11-11 确认 hotfix2 的路宽“现在这样就很好”，横向主干道不加 17 格。
- `docs/PROGRESS.md`：当前状态、代码结构（新文件）、下一步（等用户看 v0.8.1；之后写 v0.8.2 的计划）、已知问题。
- `app/src/world/README.md` 加 `chunk.ts`；`app/README.md` 加城市模式和两个新脚本的用法。

- [ ] **Step 5: 版本提交和 tag**

```bash
git add -A app docs
git commit -m "v0.8.1: chunk API, worker pool, viewer city mode, city regression"
git tag v0.8.1
```
