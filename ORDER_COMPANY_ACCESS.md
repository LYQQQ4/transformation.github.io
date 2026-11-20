# Order Company Access

## 本次检查与调整（2026-11-20）

- 权限范围确认：只按订单的“公司名称” (`orders.company_name`) 授权，
  不按发件人公司、收件人公司或用户资料公司授权。收发件人资料功能保留。
- 原权限选项查询和 SQL 过滤已仅使用 `orders.company_name`，本次没有扩大或缩小
  关联模块的权限边界。即使收发件人公司与已授权名称相同，也不能访问其他公司的订单。
- 找到实际字段混用：订单表单隐藏了 `companyName`；
  `app.js` 及后加载的 `user_profiles.js` 会用收发件人公司填充或覆盖它；
  后端资料补全有同样的兜底；输入建议合并了所有用户资料公司的名称。
- 已将“公司名称”恢复为独立可填写的必填字段，移除上述前后端代填和建议合并；
  Excel 导入字段及模板的必填标记同步调整。收发件人公司仍从对应资料独立补全。
  权限入口改名为“公司名称权限”，并修复该面板和订单弹窗的窄屏遮挡、溢出。
- 没有改写历史订单、现有用户角色或授权记录。若历史订单的“公司名称”已经是某个
  收发件人公司名，该名称仍属于真实订单归属，不能因名称重合就从权限选项中删除。
- 管理员仍保留全量访问；白名单仅限制普通用户。本地只读检查时，普通用户授权数均为 0。
  用管理员账号验证白名单限制会得到“仍可查看全部”的结果，这是现有角色规则。

### 入口问题与验证

- 当前 3000 服务的前端与工作区一致，权限接口在未登录时返回 401；
  不能据此确认已登录管理员曾遇到的 `User not found` 根因。
- 隔离数据库测试已覆盖：从用户列表取得 ID，再逐个加载权限成功；
  不存在用户仍返回 404，普通用户仍返回 403。未删除目标用户校验或放宽鉴权。
- 页面错误现在区分“加载公司名称失败”和“加载用户 ID 的公司权限失败”，
  便于再次出现问题时定位具体请求。原环境的已登录入口错误尚未复现，不能宣称根因已修复。
- `npm.cmd run test:order-company-access` 通过 122 项 HTTP 检查及 SQL/事务/导入断言，
  包括仅授权收发件人公司不能访问订单、仅授权订单公司可编辑关联记录、
  资料公司不进入权限选项/输入建议、公司名为空不能用资料公司兜底。
- 交接中原有十组回归命令本次均通过，含此前未完成复测的并发写入调整。
- 新增 `scripts/order_company_access_browser_test.js`，通过桌面 1440x1000、
  手机 390x844 的真实 Edge 页面检查和截图：加载全部页面脚本，覆盖权限加载/保存/错误、
  长公司名换行、页面/弹窗边界及切换收发件人不会覆盖公司名称。
  浏览器 API 使用模拟数据；真实 Session/MySQL 行为由上述隔离集成测试覆盖。
- 浏览器测试命令：`node scripts/order_company_access_browser_test.js`。
  需要可解析的 Playwright 和已安装的 Edge；本机复用了 `logs/browser-tools/node_modules`。
  截图在 `logs/order_company_access_{desktop,mobile}.png` 和
  `logs/order_company_form_{desktop,mobile}.png`。
- 修改的 JS 文件语法检查、`git diff --check` 通过。
  全仓 `npm.cmd run check` 仍因既有重复声明、引号等问题失败，未作无关 lint 清理。

### 当前服务

- 保留原 3000 服务（检查时 PID 5940），没有停止或重启它。
- 新版本地测试服务：`http://127.0.0.1:3105`，启动 PID 14252，development 模式。
  启动执行了项目原有的幂等鉴权/权限表迁移检查，未手动执行数据迁移。
- 本次未创建 Git 提交。仍需用实际管理员和普通用户账号完成人工验收；
  若旧入口报错再次出现，按下方历史交接记录中的请求/ID/数据库顺序继续排查。

## 历史交接（2026-11-17，以下为当时状态）

### 当前状态

- 公司白名单的数据表、迁移脚本、管理员 API、后端订单范围过滤及前端配置入口已实现。
- **尚未完成验收，不应视为可直接发布版本。**
- 用户实测：在用户管理页面点击“订单权限”按钮显示 `user not found`。
  按用户要求，本次保留该问题，下次修改时优先排查；尚未确认根因。
- 本次收尾仅更新交接文档，不修复业务代码、不重新执行迁移或完整测试。
- 本地用户库此前已执行权限表迁移；没有自动授予任何公司权限，没有改写现有订单。
  普通用户在白名单配置成功前默认看不到订单，这是预期限制。

### 已实现范围

- 新建 `user_order_companies`，使用用户 ID 与规范化公司名作为唯一关联，
  保存权限使用事务；管理接口仅允许 Session 中角色为 `admin` 的用户调用。
- 公共权限模块为每次请求读取当前白名单，用参数化 SQL 限制订单，
  仅依据 `orders.company_name`；管理员不受限制，普通用户空白名单无可见订单。
- 已接入订单列表、搜索、分页、详情、导出、报表及相关账单、包裹、
  提货、中转、清关和输入建议接口；写入、编辑、逐条导入也加入公司校验。
- 用户管理增加公司多选、全选、取消全选和保存入口；加载失败不允许保存空权限。
  **上述为代码实现范围，不代表当前实际页面已验收通过。**
- 保持现有 Session 登录、用户 CRUD、用户资料和普通用户原有写操作规则。
  详细文件、API 与迁移说明见下文。

### 遗留问题：点击“订单权限”提示用户不存在

复现：管理员登录 → 用户管理 → 选择现有用户 → 点击“订单权限” →
出现 `user not found`，无法正常完成配置流程。

已确认的代码调用关系：

1. `frontend/app.js` 的 `displayUsers()` 从 `GET /api/users` 的 `user.id`
   生成按钮，调用 `openOrderCompanyPermissions(id)`。
2. 打开面板会并行请求 `GET /api/users/order-companies` 和
   `GET /api/users/:id/order-companies`；任一失败都会显示对应错误。
   当前反馈不足以确定具体失败的是哪个请求。
3. `backend/routes/order_company_access.js` 的 `requireTarget()` 在用户库
   执行 `SELECT id FROM users WHERE id = ?`，未找到时返回 404 `User not found`。
   旧用户路由也存在同名错误，不能只凭提示文本认定错误来源。
4. 当前 `backend/server.js` 将权限路由挂在用户路由之前，
   且两者传入同一 `userPool`；仍需核对实际运行服务是否加载了这份代码。

下次排查顺序（均为待验证项，并非已确认原因）：

1. 浏览器 Network 记录两个请求的完整 URL、状态码、响应体，
   核对 `API_BASE`、实际后端端口及按钮传入的用户 ID。
2. 将 `GET /api/users` 返回的目标 `id` 与权限请求路径中的 `id` 对照；
   区分认证用户 ID 与用户资料 ID，不使用用户名或资料 ID 替代。
3. 对照运行后端的用户数据库配置，确认目标 ID 在该库 `users` 表存在；
   不在日志或交接信息中输出密码、Cookie 等敏感信息。
4. 核对运行进程、启动时间和路由注册顺序，排除旧服务未加载新增路由；
   不应仅为消除错误而删除目标用户检查或放宽管理员鉴权。
5. 修复后补充真实页面调用链回归，验证现有用户正常加载、
   不存在用户仍为 404、普通用户仍为 403，以及保存后无需重新登录生效。

### 测试与最终复测缺口

- 此前版本已通过下文列出的十组命令；新增集成测试当时通过 103 个 HTTP
  检查，另有数据库约束、事务及前端 DOM 状态断言。
- 随后为账单、包裹、中转、清关等关联写操作补充了事务内父订单校验、
  加锁或带权限条件的 SQL，防止检查与写入之间订单归属变化。
- 调整期间曾误放中转断言、误改箱型更新 SQL，之后已修正代码位置；
  这些修正后的最终版本尚未完整复测，不能沿用此前全部通过的结论。
- 最后调整后账单相关两组测试有通过记录；新增权限集成测试曾因中转断言
  位置错误失败，修正后尚未重新执行。
- 下次应优先复跑 `npm.cmd run test:order-company-access`，并补充授权用户
  成功编辑包裹、中转、清关等关联记录的用例，再执行下文完整回归。
- 全仓 `npm.cmd run check` 此前仍有既有 lint 问题；未作无关清理。
  前端测试为 DOM stub，尚无真实浏览器截图或完整点击验收。

### 运行与工作区提醒

- 此前启动的验证服务地址为 `http://127.0.0.1:3105`，当时 PID 为 `4756`。
  服务早于最后一轮修改启动，且当时使用 production 模式；
  本次交接未核实进程是否仍在，不能将该进程视为最终代码验证结果。
- 下次先确认服务归属与端口，再按需重启为本地开发模式；不要误停其他服务。
- 工作区还有本需求以外的既有修改。`git status` 不是本功能独占文件清单；
  下次继续前应查看差异，不要整体回滚、覆盖或一并提交无关修改。
- 本次未创建 Git 提交。

## Behavior

Authentication remains the existing server-side session cookie. Only the role
loaded from the session's user record grants administrator access.

Every order-related request loads the ordinary user's current whitelist from
the user database. There is no session, browser, environment, or shared cache of
permissions. Administrators bypass the whitelist. An ordinary user with no
entries gets an empty list and cannot access any order detail.

Only `orders.company_name` determines order access. Names are trimmed using the
same ECMAScript whitespace set in JavaScript and MySQL, then compared as exact
binary strings. Case, accents, internal spaces, and Unicode spelling remain
significant. There is no fuzzy matching or Unicode compatibility folding.
Legacy surrounding spaces, tabs, and full-width spaces do not change ownership.
NULL, empty, and whitespace-only order companies are visible only to admins.
Sender and receiver company fields are never authorization substitutes.
The order company is now an explicit form/import field. Neither selecting a
profile nor server-side profile enrichment fills or replaces it. Company-name
suggestions come only from scoped orders, not the profile catalog. Historical
order ownership is not rewritten, even when it happens to match a profile name.

The user and business databases may be hosted separately. The user database
supplies names; the business database applies parameterized `IN` predicates in
SQL before returning orders, aggregating reports, or exporting Excel.
An empty whitelist emits `1 = 0`, not an unrestricted query.
Permission database errors fail the request instead of returning empty success.

## Migration

Requires MySQL 8.0.16+ (REGEXP_REPLACE and enforced CHECK constraints).
Verified locally with MySQL 8.0.46.

```powershell
npm.cmd run migrate:order-company-access
```

The script reads the existing USER_DB_* / DB_* configuration and creates
`user_order_companies` in the user database:

- `user_id BIGINT UNSIGNED`, referencing `users.id`, cascading on deletion.
- `company_name VARCHAR(200)`, utf8mb4 binary collation, normalized and nonempty.
- `created_at TIMESTAMP`.
- Primary/unique key `(user_id, company_name)`; index on `company_name`.
- CHECK constraint rejects empty, whitespace-only, or untrimmed names.

Startup runs the same idempotent migration after the authentication migration.
Migration failure stops startup. Existing users, sessions, profiles, and orders
are not rewritten. No companies are granted automatically.

IMPORTANT: provision ordinary users' whitelists before expecting them to see
orders after deployment. Admins retain their full view.
Restart each application instance to load the changed server code.

## Administrator APIs

All endpoints require a session and exact role `admin`; otherwise 401 or 403.

| Method | Path | Body / Result |
| --- | --- | --- |
| GET | `/api/users/order-companies` | `{companies: [...]}` from normalized order companies |
| GET | `/api/users/:id/order-companies` | `{user_id, companies: [...]}` |
| PUT | `/api/users/:id/order-companies` | `{companies: [...]}` replaces all; `[]` revokes all |
| POST | `/api/users/:id/order-companies` | `{company_name: "Acme"}` adds idempotently |
| DELETE | `/api/users/:id/order-companies` | `{company_name: "Acme"}` revokes idempotently |

Write responses contain `{message, user_id, companies}` with the saved state.
Invalid IDs, arrays, names, and names over 200 Unicode code points return 400.
Unknown users return 404. Database failures return 500, not success.
Company options omit NULL/empty/duplicate names. An admin may also authorize a
valid name before any orders exist for that company.

All permission mutations use a transaction and lock the target user row,
serializing replacements/additions/deletions, including empty whitelists.
Any failed insert rolls back the entire replacement.

## Existing API Coverage

Existing URLs and JSON response structures are preserved:

- Orders: list/search, ID and serial details, basic-info template export,
  basic-info preview/import, create/edit, normal Excel preview/import,
  unified batch dates and receive dates.
- Reports: summary and Excel export.
- Billing: list/detail, selected Excel export, each imported row, single edits.
- Packages: list, ID/serial details, edits, per-row Excel import.
- Pickup, transfer, and customs: lists/details, edits, batch dates; transfer
  Excel import checks every row.
- Input memory: order/tracking suggestions are SQL-scoped. Ordinary users
  never read the administrator's shared suggestion cache. Product/profile
  catalog visibility is unchanged.

Unauthorized details return the same 404 as missing orders. Batch operations
preserve existing partial-result semantics: unauthorized serials are reported
as not found and are not updated. Basic-info/billing selected exports reject a
selection containing an unauthorized serial without returning a partial file.

Ordinary users may continue creating/editing orders in authorized companies.
They must supply an explicit nonempty company; profile enrichment cannot grant
access. Editing locks and checks the original order and validates the new
company. Basic-info updates check both the existing order and changed company.
Each new-order Excel row is validated independently. Existing admin-only
deletion rules remain unchanged.

## Administrator UI

Log in as admin, open user management, then choose a user's order permissions.
The inline section loads company checkboxes with current selections, including
previously granted names that no longer appear in orders. Select all, clear all,
adjust individual entries, and save. The saved response refreshes the selections
and count. Failures remain visible and do not show a success message.
Loading disables controls; failed/stale loads cannot save an empty replacement.
Company labels are text nodes, not interpolated HTML.

Ordinary users do not see the user-management/permission entry. Empty order
results show the existing pagination count of zero with a clear empty message.
The next server request uses any permission change without re-login.

## Tests

```powershell
npm.cmd run test:order-company-access
npm.cmd run test:auth-security
npm.cmd run test:order-summary
npm.cmd run test:order-basic-info-import
npm.cmd run test:billing-batch
npm.cmd run test:billing-batch-mysql
npm.cmd run test:batch-date-unified
npm.cmd run test:batch-date-modules
npm.cmd run test:batch-receive-date
npm.cmd run test:order-remarks
```

All commands above passed again on November 20, 2026, including the concurrency
refinements. The feature suite now includes 122 HTTP checks plus direct database
and frontend state assertions. The original environment's authenticated
`User not found` report still needs reproduction; see the current dated section.
It uses real sessions, separate temporary user/business schemas, and cloned
empty business table definitions. It does not copy production order data,
modify existing accounts, or leave test schemas behind. The database account
running the integration tests needs temporary schema/trigger permissions and
read access to the configured business schema definitions.

Coverage includes exact normalization/case/accent behavior, admin and empty
whitelist behavior, management 401/403, detail and export bypasses, searches,
related module IDs/serials/case variants, batch updates, per-row imports, new
and edited companies, duplicate grants, invalid users/names, real SQL rollback,
permission service failures, immediate revocation, and frontend error states.

`npm.cmd run check` still fails on pre-existing repository-wide lint issues,
including duplicate declarations in frontend/app.js and quote-style violations
in unrelated files. No unrelated lint cleanup was applied.
Node syntax checks and `git diff --check` also passed in the current verification
round; they do not replace the real-account acceptance still outstanding.

## Changed Files

New:
`backend/lib/order_access.js`, `backend/routes/order_company_access.js`,
`scripts/migrate_order_company_access.js`, `scripts/order_company_access_test.js`,
`scripts/order_company_access_frontend_test.js`, `ORDER_COMPANY_ACCESS.md`.

Integration:
`backend/server.js`, `backend/routes/orders.js`, `backend/routes/reports.js`,
`backend/routes/billing.js`, `backend/routes/packages.js`,
`backend/routes/pickup_trackings.js`, `backend/routes/transfer.js`,
`backend/routes/customs_clearance.js`, `backend/routes/input_memory.js`,
`frontend/app.js`, `frontend/index.html`, `package.json`.

Existing test adaptations:
`scripts/report_management_feature_test.js`,
`scripts/order_basic_info_import_route_test.js`,
`scripts/batch_date_unified_test.js`, `scripts/batch_date_modules_test.js`,
`scripts/batch_receive_date_test.js`, `scripts/billing_batch_test.js`,
`scripts/billing_batch_mysql_test.js`, `scripts/order_remarks_unified_test.js`.
These tests now supply explicit test identities/whitelists where necessary;
production code does not trust `x-user-id`.

Existing user changes elsewhere in the working tree were preserved.
Authentication helpers, users CRUD, and user-profile behavior were not changed.

## Manual Verification

- Use two browser sessions to confirm grant/revoke takes effect on refresh.
- Inspect the permissions section at desktop/mobile widths and with very long
  company names. DOM checks and mocked-API browser screenshots now cover this,
  but real-account acceptance remains necessary.
- Check real administrator and ordinary-user workflows with representative
  legacy NULL/blank company data and Excel files.
- Confirm ordinary-user pagination totals and downloads match their scoped list.
- Load-test normalization predicates against production-scale order volumes;
  no index or data rewrite was added to the existing orders table.
