# 服务器 API 与数据设计（草案 v0.1）

> ⏸ **暂停（2026-10-31）**：先做单机客户端试水，服务器设计保留备用。
>
> 内部文档。架构背景见 [architecture.md](architecture.md) §4–§6。

## 1. 约定
- 基础地址来自签名引导配置的 `api_endpoints`，路径前缀 `/api/v1`。
- 仅 HTTPS（IP 阶段为自签证书 + 客户端公钥固定）。
- 认证：`Authorization: Bearer <access_token>`（15 分钟）；刷新令牌 30 天、每次轮换。
- 格式：JSON（UTF-8）；时间用 ISO 8601 UTC；ID 用 UUIDv7。
- 错误：`{ "error": { "code": "story_not_found", "message": "..." } }`，配合 HTTP 状态码。
- 分页：游标分页 `?cursor=&limit=`（limit ≤ 50）。
- 限流：登录/注册/验证码按 IP+账号；下载按用户与全局带宽；超限返回 429 + `Retry-After`。
- 每个请求带 `X-Client-Version`；低于 `min_client_version` 返回 426。

## 2. API 列表
### 2.1 引导与系统
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/bootstrap.json` | 签名引导配置（无需认证，路径不带前缀） |
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/client/latest` | 最新客户端版本与下载地址（安装包不放 ECS） |

### 2.2 账号
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/auth/captcha` | 获取图形验证码（`captcha_id` + 图片），注册时必填，登录失败 3 次后必填 |
| POST | `/auth/register` | **内测**：`{email, password, nickname, invite_code, captcha_id, captcha_answer}`；不发验证邮件；邀请码无效/过期/用尽统一返回 `invite_invalid` |
| POST | `/auth/login` | 邮箱/用户名 + 密码（失败 3 次后要求图形验证码）→ access + refresh |
| — | `/auth/email-code`、`/auth/verify-email`、`/auth/sms-code`、`/me/phone` | **M7 正式上线前新增**：邮箱验证（DirectMail）、自助找回密码、手机短信实名；未实名账号不能上传 |
| POST | `/auth/refresh` | 用 refresh 换新的一对（旧的作废；重复使用旧 refresh → 吊销整个设备链） |
| POST | `/auth/logout` | 吊销当前设备 |
| POST | `/auth/password/reset` | M7 启用：邮箱验证码自助重置。**内测期由管理员重置**（见 §2.6） |
| GET | `/me` | 当前用户信息 |
| PATCH | `/me` | 改昵称、头像、简介 |
| PUT | `/me/password` | 改密码（需旧密码），吊销其他设备 |
| GET | `/me/sessions` | 已登录设备列表 |
| DELETE | `/me/sessions/{id}` | 下线某设备 |
| DELETE | `/me` | 注销账号（冷静期后删除，个保法要求） |

### 2.3 故事浏览与下载
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/stories` | 列表：`?q=&tag=&sort=new\|popular&cursor=`；只返回已过审、公开的 |
| GET | `/stories/{id}` | 详情（元信息、版本列表、作者、统计） |
| GET | `/stories/{id}/versions/{ver}` | 某版本信息（sha256、大小） |
| POST | `/stories/{id}/versions/{ver}/download` | 记录下载并返回 `{url, expires_at, sha256}`：本地盘阶段为本服务签名链接，OSS 阶段为 OSS 签名直链 |
| GET | `/files/{token}` | 签名下载（由 Nginx/Caddy 校验后直接发文件，支持 Range 断点续传） |
| GET | `/stories/{id}/cover?size=thumb\|full` | 封面（缩略图 ≤ 20 KB） |
| POST | `/stories/{id}/report` | 举报 |

### 2.4 创作与上传
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/me/works` | 我的作品（含审核状态） |
| POST | `/stories` | 创建故事草稿（id、标题）|
| POST | `/stories/{id}/uploads` | 申请上传：声明大小与 sha256 → 返回上传地址（本地阶段为本服务；OSS 阶段为直传签名） |
| PUT | `/uploads/{upload_id}` | 上传故事包（zip，≤ 2 MB）|
| POST | `/uploads/{upload_id}/complete` | 服务端校验（Schema、大小、文件白名单、压缩炸弹、分级），生成版本，进入审核队列 |
| PATCH | `/stories/{id}` | 改元信息、上下架（自己的）|
| DELETE | `/stories/{id}` | 删除（软删除）|

### 2.5 用户数据
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/me/downloads` | 下载记录 |
| GET | `/me/library` | 我收藏/已安装的故事 |
| PUT/DELETE | `/me/library/{story_id}` | 收藏 / 取消 |
| GET | `/me/saves` | 云存档列表（只含元信息） |
| GET | `/me/saves/{slot_id}` | 下载存档（最新版本，或 `?rev=`）|
| PUT | `/me/saves/{slot_id}` | 上传存档：带 `base_rev` 做乐观并发；冲突返回 409 + 服务器版本，由客户端让玩家选择 |
| DELETE | `/me/saves/{slot_id}` | 删除云存档 |
| GET/PUT | `/me/settings` | 可同步的设置（含 UI 覆盖；**不含 API Key**）|

### 2.6 管理（内部）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/reviews` | 待审核版本 |
| POST | `/admin/reviews/{version_id}` | 通过 / 拒绝（附原因）|
| POST | `/admin/stories/{id}/takedown` | 下架 |
| POST | `/admin/users/{id}/ban` | 封禁 |
| POST | `/admin/users/{id}/password-reset` | 内测期忘记密码：管理员生成一次性临时密码（24 小时有效，首次登录强制修改），线下告知用户；吊销该用户全部设备；写审计日志 |
| GET | `/admin/invite-codes` | 邀请码列表（状态、已用/总次数、过期时间、使用者） |
| POST | `/admin/invite-codes` | 批量生成：`{count, max_uses, expires_at, note}`；返回明文码（只显示这一次） |
| PATCH | `/admin/invite-codes/{id}` | 修改次数上限、过期时间、备注 |
| POST | `/admin/invite-codes/{id}/revoke` | 作废（已注册的账号不受影响） |
| GET | `/admin/invite-codes/{id}/uses` | 使用记录 |
| GET | `/admin/audit-logs` | 操作日志 |

## 2.7 内测注册与防刷
**邀请码**
- 格式：12 位，去掉易混淆字符（0/O、1/I/L），分组显示如 `OASIS-7KQ4-M9XT`；服务端只存哈希（HMAC-SHA256），明文只在生成时显示一次。
- 每个码可设最大使用次数（默认 1）、过期时间（默认 30 天）、备注（发给谁）；可随时作废。
- 注册时在同一事务里校验并扣减次数（`used_count < max_uses`、未过期、未作废），防止并发超用。

**频率限制**（默认值，可配置）
| 维度 | 限制 |
|---|---|
| 注册 | 同一 IP 1 小时 5 次；邀请码错误同一 IP 1 小时 10 次后封禁该 IP 1 小时 |
| 登录 | 同一账号失败 3 次要求图形验证码，10 次锁定 15 分钟；同一 IP 指数退避 |
| 图形验证码 | 每个 5 分钟有效、只能用一次 |

**图形验证码**：注册必填；先用服务端自生成的图片验证码（开源库，无外部依赖），被刷严重时换阿里云验证码 2.0（滑块）。

**忘记密码（内测）**：玩家联系管理员 → 管理员在后台核实身份后重置为临时密码 → 玩家登录后强制改密码。

## 2.8 正式上线前（M7）再加
- **邮件**：阿里云邮件推送 DirectMail，需要自有域名（配 SPF/DKIM/DMARC）；SMTP 465 或 API 发信（ECS 默认封 25 端口）；异步队列 + 重试 + 退信记录。用于邮箱验证与自助找回密码。限流：同一邮箱 60 秒 1 封、每小时 5 封、每天 10 封；同一 IP 每小时 20 封；全局每日告警；拒绝一次性邮箱。
- **手机短信实名**：阿里云短信服务；老账号登录后引导绑定，未绑定只能游玩不能上传。
- 邀请码可保留为可选（如定向邀请创作者）。

## 3. 数据库表设计草案（PostgreSQL）
```sql
users(id uuid pk, email citext unique, email_verified_at timestamptz null,   -- M7 启用验证
      invite_code_id fk null, must_change_password bool default false,
      phone_hash bytea unique null, phone_enc bytea null, phone_verified_at null,  -- 上线前启用，手机号加密存储 + 哈希查找
      username citext unique, nickname text, avatar_blob text,
      password_hash text,            -- argon2id 编码串
      role text default 'user',      -- user | admin | reviewer
      status text default 'active',  -- active | banned | deleting
      created_at, updated_at, deleted_at)

refresh_tokens(id uuid pk, user_id fk, family_id uuid, token_hash bytea unique,
      device_name text, ip inet, user_agent text,
      created_at, expires_at, revoked_at, replaced_by uuid)

invite_codes(id uuid pk, code_hash bytea unique, max_uses int default 1,
      used_count int default 0, expires_at timestamptz, revoked_at timestamptz null,
      note text, created_by fk, created_at)
invite_code_uses(id bigserial pk, invite_code_id fk, user_id fk, ip inet, used_at)

-- 以下为 M7 启用
verification_codes(id, channel text,   -- email | sms
      target_hash bytea, code_hash bytea, link_token_hash bytea null,
      purpose text, attempts int, expires_at, used_at, ip inet, created_at)
      -- 验证码 6 位、10 分钟有效、最多尝试 5 次、用后作废

captchas(id uuid pk, answer_hash bytea, expires_at, used_at)   -- 也可放进程内缓存

email_send_log(id, target_hash, purpose, provider_msg_id, status, ip inet, created_at)
      -- 用于频率限制与退信统计

stories(id uuid pk, slug text unique, owner_id fk, title text, summary text,
      tags text[], rating text, language text,
      status text,                   -- draft | published | hidden | taken_down
      latest_version_id fk null, download_count bigint default 0,
      created_at, updated_at, deleted_at)

story_versions(id uuid pk, story_id fk, version text, blob_key text, sha256 bytea,
      size_bytes int, engine_min text, meta jsonb,
      review_status text,            -- pending | approved | rejected
      review_note text, reviewed_by fk null, reviewed_at,
      created_at, unique(story_id, version))

blobs(key text pk, sha256 bytea unique, size_bytes bigint, content_type text,
      storage text,                  -- local | oss
      ref_count int, created_at)

uploads(id uuid pk, user_id fk, story_id fk, declared_size int, declared_sha256 bytea,
      status text, expires_at, created_at)

downloads(id bigserial pk, user_id fk null, story_version_id fk, ip inet, created_at)
      -- 按月分区或定期汇总到 stories.download_count 后清理

library(user_id fk, story_id fk, added_at, primary key(user_id, story_id))

saves(id uuid pk, user_id fk, story_id fk, slot int, title text,
      rev int, blob_key text, size_bytes int, client_updated_at, updated_at,
      unique(user_id, story_id, slot))
save_revisions(save_id fk, rev int, blob_key text, created_at, primary key(save_id, rev))
      -- 每槽只保留最近 3 个版本

user_settings(user_id pk fk, data jsonb, updated_at)

reports(id, story_id fk, reporter_id fk, reason text, status text, created_at, handled_by, handled_at)

audit_logs(id bigserial, actor_id, action text, target text, detail jsonb, ip inet, created_at)
      -- 合规：保留 ≥ 6 个月
```
索引：`stories(status, updated_at)`、`stories using gin(tags)`、标题全文检索（中文用 `pg_trgm` 起步）、`downloads(story_version_id, created_at)`。

## 4. 存档格式（客户端 ↔ 服务器）
zstd/gzip 压缩的 JSON：规则集 id + 版本 + 内容哈希、状态快照、PRNG 种子与游标、事件触发记录、消息历史（可选裁剪）、回合日志。**不含 API Key**。可选：客户端用由用户密码派生的密钥端到端加密后再上传（待定）。

## 5. 备份
见 architecture.md §4.5：每日 ECS 快照 + 每日 `pg_dump` 加密上传 OSS + 故事文件增量同步，每月恢复演练。
