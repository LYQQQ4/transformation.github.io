# 包装信息库 / 箱型联动改造进度

更新时间：2026-07-13

## 已完成

### 1. 后端 `backend/routes/packages.js` 已重写

当前版本已经从原来的单纯包装维护，扩展为：

- 新增箱型主数据表能力：
  - 表名：`package_box_types`
  - 字段：`box_type_id`、`package_type`、`length_cm`、`width_cm`、`height_cm`、`volume_cm3`
- 保留原有包装接口骨架：
  - `GET /api/packages`
  - `GET /api/packages/:id`
  - `GET /api/packages/serial/:serial_number`
  - `PUT /api/packages/:id`
  - `PUT /api/packages/serial/:serial_number`
  - `POST /api/packages/parse-excel`
  - `POST /api/packages/import-excel`
- 新增箱型库接口：
  - `GET /api/packages/box-types`
  - `GET /api/packages/box-types/:id`
  - `POST /api/packages/box-types`
  - `PUT /api/packages/box-types/:id`
  - `DELETE /api/packages/box-types/:id`
- 新增包装 Excel 模板接口：
  - `GET /api/packages/import-template`

### 2. 后端 schema/bootstrap 逻辑已接入

`ensurePackageSchema(db)` 已覆盖：

- `package` 表缺失字段自动补齐：
  - `package_label`
  - `package_order`
  - `box_type_id`
- `package_box_types` 表自动建表
- 默认箱型自动创建：
  - `BOX-DEFAULT`
- 历史包装数据回填策略已落地：
  - 优先按旧 `package_type` 自动生成/映射箱型
  - 其余未映射数据回填到 `BOX-DEFAULT`

### 3. 后端联动/兼容逻辑已接入

- `box_type_id` 已进入包装保存与返回结构
- 包装快照字段仍保留：
  - `package_type`
  - `length`
  - `width`
  - `height`
  - `volume`
- 未显式传 `box_type_id` 时：
  - 会尝试按 `package_type + length + width + height` 推断
  - 推断不到则落到 `BOX-DEFAULT`
- Excel 导入已兼容字段：
  - `箱型ID`
  - `包装类型`
  - `包装种类`（兼容旧字段）
  - `长(cm)` / `长`
  - `宽(cm)` / `宽`
  - `高(cm)` / `高`
  - `体积(cm³)` / `体积(cm3)` / `体积`

### 4. 后端校验已做过一次语法检查

已执行并通过：

```powershell
node --check .\backend\routes\packages.js
```

## 前端当前状态

### 已完成

`frontend/app.js` 目前只做了最基础的数据结构预埋：

- 新增了全局变量：
  - `let packageBoxTypes = [];`
- 扩展了 `createEmptyPackageItem()`：
  - `box_type_id`
  - `product_code`
  - `customs_port`
  - `customs_title`
  - `regulatory_conditions`
- 扩展了 `packageItemHasContent()`，让以上字段参与“是否为空包裹项”的判断

### 未完成

包装前端主体还没有替换，当前仍是旧实现：

- `frontend/app.js`
  - `// Package functions` 到 `// Pickup tracking functions` 这一整段仍是旧逻辑
  - 还没有接入：
    - 箱型ID下拉
    - 设置按钮展开详情
    - 箱型联动回填尺寸/体积
    - 包装信息库管理页逻辑
    - 包装模板下载按钮逻辑
- `frontend/index.html`
  - 包装维护页表头还是旧字段
  - 包装信息库页仍是占位文案
  - 还没有加：
    - 箱型ID列表列
    - cm / cm³ 单位文案
    - 包装信息库表单与表格

## 当前最重要的后续工作

下次继续时，建议按以下顺序：

### 1. 先替换 `frontend/index.html`

需要改的区域：

- 包装维护页 `#packagingPage`
  - 增加“下载模板”按钮
  - 表格列建议改成：
    - 流水号
    - 箱型ID
    - 件数
    - 长(cm)
    - 宽(cm)
    - 高(cm)
    - 体积(cm³)
    - 计费重量
    - 包装类型
    - 品名
    - 备注1
    - 备注2
- 包装信息库页 `#packagingDBPage`
  - 替换掉占位文案
  - 增加：
    - 加载箱型按钮
    - 新增箱型按钮
    - 折叠编辑区 `#packagingDbForm`
    - 列表表格 `#packagingDbTable`

### 2. 再整体替换 `frontend/app.js` 的包装模块

目标区段：

- 从：

```js
// Package functions
```

- 到：

```js
// Pickup tracking functions
```

需要整体替换成新的包装模块，实现：

- `loadPackageBoxTypes()`
- `ensurePackageBoxTypesLoaded()`
- `downloadPackageImportTemplate()`
- 新版 `loadPackages()`
- 新版 `displayPackages()`
- 新版 `showPackageForm()`
- 新版 `savePackage()`
- 新版 Excel 预览/导入函数
- 包装信息库页函数：
  - `loadPackagingDb()`
  - `showPackagingDbForm()`
  - `savePackagingBoxType()`
  - `editPackagingBoxType()`
  - `deletePackagingBoxType()`

### 3. 再补订单详情中的包装展示文案

需要把以下展示从旧文案改成带单位的新文案：

- `长(cm)`
- `宽(cm)`
- `高(cm)`
- `体积(cm³)`
- 新增 `箱型ID`

## 已知风险 / 注意事项

### 1. `frontend/app.js` 和 `frontend/index.html` 存在历史编码问题

表现：

- 终端里读出来很多中文是乱码
- 这会导致：
  - `apply_patch` 对某些包含乱码的整段匹配不稳定
  - 用 shell 直接做大段替换时也容易失败

建议：

- 下次继续尽量用“整段替换”而不是碎片式 patch
- 优先用固定英文锚点替换，例如：
  - `// Package functions`
  - `// Pickup tracking functions`
  - `id="packagingPage"`
  - `id="packagingDBPage"`

### 2. 前端包装模块当前有重复实现

`frontend/app.js` 里包装相关函数有旧版和新版重复定义，后定义会覆盖前定义。

因此下次修改时，最安全的方式是：

- 不要继续在旧函数上打补丁
- 直接整段替换 `// Package functions` 到 `// Pickup tracking functions`

### 3. 后端虽然已通过语法检查，但还没做端到端联调

还没有验证：

- 箱型库接口实际联表行为
- 历史数据回填效果
- Excel 模板下载
- Excel 预览/导入联动
- 前端联调

## 建议的下次验证清单

完成前端后，至少跑：

```powershell
node --check .\backend\routes\packages.js
node --check .\frontend\app.js
```

然后手动验证：

1. 打开“包装信息库”页，能新增/编辑箱型
2. 打开“包装信息维护”页，箱型ID下拉可选
3. 选择箱型ID后，自动回填包装类型、长、宽、高、体积
4. 点“设置”可展开手工修改
5. 下载包装导入模板，确认表头包含箱型ID和单位
6. 用包含 `箱型ID + 长宽高` 的 Excel 做预览与导入

## 当前修改文件

- 已重写：
  - `backend/routes/packages.js`
- 已部分修改：
  - `frontend/app.js`
- 尚未开始修改：
  - `frontend/index.html`
  - `backend/server.js`（目前不需要改）

