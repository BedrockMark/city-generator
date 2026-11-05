# 选择解决不了的问题（gaps）

由 `npx tsx scripts/prefs.ts gaps` 生成（v0.7.0）。每条坏标注用“去掉这条标注所在种子的全部标注”训练的模型（A/B 选择 0 条）判断：
归因到的决策里有备选项得分比已选项高 ≥ 0.05 → 选择能改善；否则 → 选择解决不了。

坏标注 12 条：选择能改善 5，选择解决不了 7（其中无法归因 0 条）；跳过的标注 0 条。

## 选择解决不了（按标签归类）

### 位置不合理（2 条）

- 种子 225713（v0.5.1，v0.5.1/seed225713.json#L1）：位置不合理 — 已经有楼间道了，不需要再有小巷子了，应该二选一
  - 归因到的决策 7 个；选择解决不了
  - 区域 (432,384)–(448,560)，截图 seed225713_L1.png
- 种子 791885（v0.5.1，v0.5.1/seed791885.json#L1）：位置不合理 — 往上去一点更好
  - 归因到的决策 13 个；选择解决不了
  - 区域 (179,275)–(253,366)，截图 seed791885_L1.png

### 太空（2 条）

- 种子 311958（v0.5.1，v0.5.1/seed311958.json#L2）：太空、方正呆板 — （无备注）
  - 归因到的决策 33 个；选择解决不了
  - 区域 (624,272)–(688,512)，截图 seed311958_L2.png
- 种子 87709（v0.5.1，v0.5.1/seed87709.json#L1）：太空、方正呆板 — （无备注）
  - 归因到的决策 23 个；选择解决不了
  - 区域 (224,224)–(736,272)，截图 seed87709_L1.png

### 方正呆板（2 条）

- 种子 311958（v0.5.1，v0.5.1/seed311958.json#L2）：太空、方正呆板 — （无备注）
  - 归因到的决策 33 个；选择解决不了
  - 区域 (624,272)–(688,512)，截图 seed311958_L2.png
- 种子 87709（v0.5.1，v0.5.1/seed87709.json#L1）：太空、方正呆板 — （无备注）
  - 归因到的决策 23 个；选择解决不了
  - 区域 (224,224)–(736,272)，截图 seed87709_L1.png

### 挡路（2 条）

- 种子 791885（v0.5.1，v0.5.1/seed791885.json#L3）：挡路 — （无备注）
  - 归因到的决策 2 个；选择解决不了
  - 区域 (336,514)–(352,542)，截图 seed791885_L3.png
- 种子 791885（v0.5.1，v0.5.1/seed791885.json#L4）：挡路 — （无备注）
  - 归因到的决策 5 个；选择解决不了
  - 区域 (338,544)–(350,570)，截图 seed791885_L4.png

### 不通向任何地方（1 条）

- 种子 864319（v0.5.1，v0.5.1/seed864319.json#L1）：不通向任何地方、没有存在理由 — （无备注）
  - 归因到的决策 17 个；选择解决不了
  - 区域 (480,336)–(624,400)，截图 seed864319_L1.png

### 没有存在理由（1 条）

- 种子 864319（v0.5.1，v0.5.1/seed864319.json#L1）：不通向任何地方、没有存在理由 — （无备注）
  - 归因到的决策 17 个；选择解决不了
  - 区域 (480,336)–(624,400)，截图 seed864319_L1.png

## 选择能改善

- 种子 311958（v0.5.1，v0.5.1/seed311958.json#L1）：太挤 — （无备注）
  - 归因到的决策 38 个；选择能改善：`bld.single` 4_Generic_Building/Condo_5_2 → 9_Shopping_Center_and_Markets/Market_Medium_1（+0.068）、`bld.single` 4_Generic_Building/Condo_5_1 → 9_Shopping_Center_and_Markets/Market_Medium_1（+0.061）、`bld.single` 4_Generic_Building/Condo_5_1 → 24_Additional_Houses/24_Terraced_House_6（+0.051）
  - 区域 (336,208)–(432,384)，截图 seed311958_L1.png
- 种子 445498（v0.5.1，v0.5.1/seed445498.json#L1）：太挤 — 太挤了，两排房子中间应该隔着一个院子，而不是院子前有两排房子
  - 归因到的决策 35 个；选择能改善：`bld.single` 4_Generic_Building/Condo_3_45 → 9_Shopping_Center_and_Markets/Market_Medium_1（+0.059）、`bld.single` 4_Generic_Building/Condo_5_2 → 9_Shopping_Center_and_Markets/Market_Medium_1（+0.065）、`bld.single` 4_Generic_Building/Condo_5_1 → 24_Additional_Houses/24_Terraced_House_6（+0.052）、`bld.single` 4_Generic_Building/Condo_5_1 → 24_Additional_Houses/24_Terraced_House_6（+0.052）
  - 区域 (352,384)–(448,560)，截图 seed445498_L1.png
- 种子 664616（v0.5.1，v0.5.1/seed664616.json#L1）：不通向任何地方 — （无备注）
  - 归因到的决策 17 个；选择能改善：`garden.treeModel` 3_City_Props/Tree_1 → 3_City_Props/Tree_8（+0.06）、`garden.treeModel` 3_City_Props/Tree_1 → 3_City_Props/Tree_8（+0.06）
  - 区域 (384,368)–(432,512)，截图 seed664616_L1.png
- 种子 664616（v0.5.1，v0.5.1/seed664616.json#L2）：太挤 — （无备注）
  - 归因到的决策 38 个；选择能改善：`bld.single` 4_Generic_Building/Condo_5_2 → 9_Shopping_Center_and_Markets/Market_Medium_1（+0.059）、`bld.single` 4_Generic_Building/Condo_5_1 → 24_Additional_Houses/24_Terraced_House_6（+0.055）
  - 区域 (176,256)–(272,416)，截图 seed664616_L2.png
- 种子 87709（v0.5.1，v0.5.1/seed87709.json#L2）：太空、方正呆板 — （无备注）
  - 归因到的决策 32 个；选择能改善：`garden.treeModel` 3_City_Props/Tree_1 → 3_City_Props/Tree_3（+0.091）、`garden.treeModel` 3_City_Props/Tree_1 → 3_City_Props/Tree_3（+0.091）
  - 区域 (672,272)–(736,512)，截图 seed87709_L2.png
