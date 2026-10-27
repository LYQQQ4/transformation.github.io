# 账单批量填写

## 数据来源

- `frontend/app.js` 中的账单页面及 `backend/routes/billing.js`。
- 列表以 `orders.serial_number` 为主键关联 `billing_info`、提货、转运和包裹汇总。
- 成本为 `billing_info.cost_items` JSON 数组的 `amount` 汇总。
- 销售为 `billing_info.billing_items` JSON 数组的 `amount` 汇总。
- 账期来自销售费用项的 `billing_period`，保持现有自由文本含义，支持年月、多账期和“月结30天”等文本，不改为天数或固定日期。
- `transfer.billing_period` 不是账单编辑的写入目标。

## 使用

1. 登录后在账单页勾选流水号。跨页保留选择，表头复选框仅选择当前页。
2. 导出 Excel，在前 16 列内填写成本、销售和账期，不改动隐藏的原值快照。
3. 导入 Excel 并确认覆盖。查看行处理结果、业务字段差异和错误报告。

限制：仅 `.xlsx`，单文件 5MB，最多 500 行/500 个流水号；每个服务进程同时最多处理两次导入。
没有选择不能导出。订单已存在但尚未保存账单时，可直接导出填写并导入，系统按现有模板首次保存对应账单；
流水号对应的订单不存在时仍然失败，不创建订单。成本、销售、账期全空或校验失败时，不创建空账单。

金额允许正负数及零，绝对值最多 999999999999.99，最多两位小数。
账期为最多 255 字符的普通文本；日期单元格转为 YYYY-MM-DD；日期/月份形态的无效值拒绝。
空白字段保持原值，不执行清空。公式和超链接拒绝；导出及报告文本以 Excel 字符串单元格保存。
业务字段只比较并提示差异，不写回数据库。

## 更新语义

导出文件的隐藏快照用于判断用户实际修改的字段。未修改的旧值不会覆盖并发新值；
修改字段与当前数据冲突时该行失败。无快照的手工文件按非空字段更新，不具备导出快照的冲突保护。
快照不承担权限校验；所有请求均重新校验数据库中存在的登录用户。
金额只调整模板首个费用项的差额，保留其他费用项和供应商、备注等信息；
修改账期会统一该账单所有销售费用项的账期，未修改则保留原来的多账期。

模式为 `valid_rows_atomic`：校验失败行不写入，所有有效行与审计在同一事务提交；
首次保存和更新均计入 `updated`；任何 SQL/审计异常全部回滚，包括本次首次保存的账单，返回失败且不报告成功更新。重复流水号的所有行跳过，
`duplicated` 是重复行数量，也是 `skipped` 的子集；`total = updated + failed + skipped`。
订单和账单按流水号稳定排序加锁，防止同流水号并发导入丢失更新。

## 接口与迁移

- `POST /api/billing/export`，JSON `{ "serial_numbers": ["..."] }`，返回 Excel。
- `POST /api/billing/import`，multipart 字段 `file`，返回 summary、results、errors、warnings、
  notFoundSerialNumbers、unauthorizedSerialNumbers、errorReport（base64 Excel）。
- 接口使用现有 `x-user-id` 和 `requireUserAccess`。当前项目所有登录用户均可访问全部账单，
  没有行级归属或独立的账单授权表；不能凭空按公司、客户等字段限制权限。
- 该项目现有身份机制信任可伪造的 `x-user-id`，不是安全会话认证。上线前应在认证网关或全站认证改造中解决；
  本功能不会把 Excel 快照、前端勾选或上传业务字段当成授权依据。
- 不新增成本、销售、账期列。唯一新增表为 `billing_import_log`，记录操作人、时间、
  文件基本名称、SHA-256、大小及数量汇总，不记录业务明细。
- 部署时运行 `npm run migrate:billing-import`；幂等、不回填、不删除现有数据。接口也会确保该表存在。

## 验证

- `npm run test:billing-batch`：HTTP/Excel/前端状态、权限、校验、报告、模拟回滚、500 行。
- `npm run test:billing-batch-mysql`：需要 MySQL 创建临时数据库权限；克隆现有表结构，
  在独立测试库验证真实事务、并发冲突、迁移幂等、500 行和既有列表/单条编辑，结束清理测试库。
- 项目为 JavaScript，无 TypeScript 类型检查任务；可用 `node --check` 检查语法。
