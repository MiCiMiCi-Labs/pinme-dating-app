# PinMe 私人一对一语音通话 — 产品与技术需求规格

本文档是 PinMe「私人一对一语音通话」功能的**唯一需求来源**，取代此前的口头/零散讨论。后续实现、评审、验收均以本文档为准；文档末尾的实施进度表随开发进度更新。

## 背景与现状

**技术栈**

- Mobile：Expo SDK 54、React Native 0.81.5、Expo Router、Supabase client、LiveKit React Native，iOS bundle identifier `com.pinme.app`。
- Backend：Express、TypeScript、Prisma、PostgreSQL/Supabase、LiveKit Server SDK。

**现有私人「电话」代码**（将被本次工作取代/大幅改造）：

- `apps/backend/src/controllers/calls.ts`
- `apps/backend/src/routes/calls.ts`
- `apps/mobile/components/voice-call-modal.tsx`
- `apps/mobile/app/(main)/chats/[matchId].tsx`

**现有问题（phase 1 之前）**：`getCallToken` 只是给双方签发指向 `match:${matchId}` 的 LiveKit token；没有 Call 数据记录、没有呼叫状态机、没有振铃、没有接听/拒绝/取消/未接、没有全局来电监听、没有 PushKit/CallKit、没有锁屏或后台来电——对方必须自己进入同一聊天页并点击 Call。**本质上是私人语音房，不是真正的电话。**

> ✅ **已知遗留安全入口——已在 phase 2 移除**：`POST /api/v1/calls/:matchId/token`（`controllers/calls.ts` 的 `getCallToken`）在 phase 1 中曾被有意保留，只是为了不破坏聊天页尚未迁移的 Call 按钮，但它完全绕过 `CallPreference` 双方授权和整个 Call 状态机。phase 2 把聊天页迁移到 `CallProvider.startCall(matchId)` 之后，`apps/mobile/lib/api.ts` 里的 `getCallToken` 客户端函数已确认零调用方，`controllers/calls.ts`、旧路由注册和运行时 deprecation 警告已一并删除——不再有绕过 CallPreference 的入口。

**范围与硬性约束（贯穿全文档，不可简化）**：

1. 保留 LiveKit 作为媒体层，但必须补齐：通话授权层、呼叫信令层、Call 状态机、APNs VoIP Push、PushKit、CallKit、全局 CallProvider、通话历史记录。
2. 公共 Voice Room 与私人一对一电话是**两个独立功能**，不能相互影响，不能破坏现有公共 Voice Room。
3. 当前阶段**只实现一对一语音通话，不实现视频通话**（数据模型预留视频字段，供未来扩展）。
4. 当前 Expo/React Native/LiveKit/CallKit/PushKit 相关依赖版本已确认为目标版本，不主动降级或重新选型；只有遇到明确的编译/API 不兼容且有具体报错时才可调整。
5. **Expo Go 不支持 CallKit/PushKit**，必须使用 Expo development build / EAS build 验证。
6. 不自动对生产数据库执行迁移/部署。
7. 不得提交 Apple 私钥、证书或任何真实 secret 到仓库。

---

## 产品体验

### 目标体验链路

```
双方先同意开启语音聊天
  → 电话按钮解锁
  → 一方发起呼叫
  → 对方手机真正响铃（前台 / 后台 / 锁屏 / 冷启动）
  → 通过 iOS CallKit 接听/拒绝
  → 接听后双方进入各自独立的 LiveKit 房间
  → 任意一方挂断后同步结束
  → 聊天中生成未接、拒绝或通话时长记录
```

不能停留在「双方约好同时进入同一个 LiveKit room」的现有体验。

### 通话授权：双方同意后才能打电话

PinMe 是约会产品，不能因为 Match 成功就允许突然来电；语音通话必须**按 Match 单独授权**（对应数据模型 `CallPreference`，见下节）。

规则：

1. 双方 `audioEnabled` 都为 `true` 后，语音电话才解锁。
2. `audioEnabled` 按 Match 存储，不是账户全局设置。
3. 后端在 start call 时必须重新校验双方权限，不能只依赖前端隐藏电话按钮。
4. 一方关闭权限后立即禁止新的呼叫。
5. 关闭权限时若当前通话仍是 `RINGING`，取消该通话；已 `ACCEPTED` 的通话默认不强制打断，只阻止下一次来电。
6. unmatch 或 block 后权限自动失效。
7. `videoEnabled` 仅作为未来扩展字段，本次不实现视频。

### 聊天页交互状态

**状态 A：当前用户未开启**

点击电话按钮显示说明：「只有你们双方都同意后，语音电话才会开启。你可以随时关闭。」按钮：邀请语音聊天 / 取消。确认后：设置当前用户 `audioEnabled=true`，发送服务端生成的邀请系统消息，不直接拨号。

**状态 B：当前用户已开启、对方未开启**

显示「等待对方同意语音聊天」，电话按钮不可直接拨号。

**状态 C：收到对方邀请**

聊天中出现卡片「对方想和你开启语音聊天」，按钮：允许语音通话 / 暂时不要。
- 点击允许：设置当前用户 `audioEnabled=true`；双方都开启后显示「语音通话已开启」，电话按钮变为可拨号。
- 点击「暂时不要」：不向邀请者暴露明确拒绝行为，对方只看到「尚未开启」。

**状态 D：双方均开启**

电话按钮正常显示，点击后进入真正的 CallKit/PushKit 呼叫流程。

**状态 E：关闭权限**

聊天设置中提供「允许与此 Match 进行语音通话」开关。关闭后：电话按钮重新锁定；禁止新的 Call；当前 `RINGING` 的 Call 被取消；已接通的通话默认不强制结束。

> 邀请、授权变更和系统消息必须由服务端生成，客户端不能伪造。

### 通话中界面内容

**呼出界面**：对方头像、对方名字、「正在呼叫…」、取消按钮。对方接听前**不连接 LiveKit、不启动麦克风**。终态展示：`DECLINED` → "对方已拒绝"；`MISSED` → "无人接听"；`CANCELED` → 直接关闭界面；忙线 → "对方正在通话中"；`FAILED` → 明确错误提示。

**应用内来电界面**：来电者头像、来电者名字、接听按钮、拒绝按钮；必须与系统 CallKit 操作保持同步，防止 CallKit 和应用内 Modal 出现两个互相冲突的状态。

**已接通界面**：通话时长、静音、扬声器切换、挂断、网络重连提示、麦克风权限错误提示、对方结束提示。时长**从服务端 `answeredAt` 计算**，不从页面打开时间计算，App 切后台再回来时长仍正确。对方离开 LiveKit 后不再显示"等待对方加入"，而是与后端确认状态后结束通话并清理 UI。

### 通话历史与系统消息

Call 达到最终状态后，由**后端**生成系统消息，例如：

- `Voice call · 05:32`
- `Missed voice call`
- `Declined voice call`
- `Canceled voice call`
- `Voice call failed`

要求：服务端生成、客户端不可伪造；双方看到一致结果；重复的 end 请求不会产生多条记录（与 `Call.id` 建立唯一关联保证幂等）。邀请消息同样由服务端生成（例如 "Alex invited you to enable voice chat."），邀请卡片可操作，但权限修改必须调用后端接口。实现上优先复用现有 `MessageType.SYSTEM`；可考虑给 `Message` 增加可选 `callId String? @unique` 字段，或建立独立的 Call 历史展示逻辑。

---

## 数据模型

不复用 `VoiceRoom`，新增独立模型。所有模型需要生成**正式 Prisma migration**，不要只用 `db push`。

### CallPreference（按 Match 的双方语音授权）

```prisma
model CallPreference {
  id           String   @id @default(uuid())
  matchId      String
  userId       String
  audioEnabled Boolean  @default(false)
  videoEnabled Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([matchId, userId])
  @@index([userId])
}
```

### Call（通话记录 / 状态机唯一事实来源）

```prisma
model Call {
  id            String      @id @default(uuid())
  matchId       String
  callerId      String
  calleeId      String
  type          CallType    @default(AUDIO)
  status        CallStatus  @default(RINGING)
  roomName      String      @unique
  expiresAt     DateTime
  answeredAt    DateTime?
  endedAt       DateTime?
  endedById     String?
  durationSec   Int?
  failureReason String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@index([matchId, createdAt])
  @@index([callerId, status])
  @@index([calleeId, status])
  @@index([status, expiresAt])
}

enum CallType {
  AUDIO
  VIDEO
}

enum CallStatus {
  RINGING
  ACCEPTED
  DECLINED
  CANCELED
  MISSED
  ENDED
  FAILED
}
```

要求：

1. `Call.id` 使用 UUID，并**同时作为 CallKit UUID**（`CallKit UUID = Call.id`）。
2. `roomName` 每次通话唯一，格式为 `call:{callId}`；不能继续使用 `match:{matchId}`。
3. `expiresAt` 默认创建时间 + 45 秒。
4. `durationSec` 从 `answeredAt` 到 `endedAt` 计算。
5. `endedById` 记录主动结束者。
6. `failureReason` 取值示例：`MICROPHONE_DENIED`、`LIVEKIT_CONNECTION_FAILED`、`PUSH_FAILED`、`NETWORK_ERROR` 等明确错误。
7. `Call` 需要与 `Match`、caller、callee 建立 Prisma relation。
8. **同一用户不能同时存在多个 `RINGING` 或 `ACCEPTED` 的 Call**：若数据库无法直接用 partial unique index 表达，需在 transaction 中检查，并在 migration 中依据 PostgreSQL 能力增加必要约束或锁策略。

### VoipDeviceToken（APNs VoIP token）

```prisma
model VoipDeviceToken {
  id          String          @id @default(uuid())
  userId      String
  token       String          @unique
  platform    DevicePlatform
  environment ApnsEnvironment
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@index([userId])
}

enum DevicePlatform {
  IOS
  ANDROID
}

enum ApnsEnvironment {
  SANDBOX
  PRODUCTION
}
```

要求：token 必须与当前登录用户绑定；更新时使用 upsert；PushKit token invalidation 时删除；用户退出登录时注销当前设备 token；development/sandbox token 不能发往 production APNs，production token 不能发往 sandbox APNs。

---

## API

均挂载于 `/api/v1/calls`（`call-preference`/`call-invitation` 挂在 `/api/v1/matches/:matchId` 下），均要求 `requireAuth`。

### 设备 Token

- `POST /api/v1/calls/devices` — 注册或更新 VoIP token。Body: `{ token, platform: "IOS", environment: "SANDBOX" | "PRODUCTION" }`
- `DELETE /api/v1/calls/devices/:token` — 删除失效或退出登录的 token。

### 通话授权

- `GET /api/v1/matches/:matchId/call-preference` — 返回 `{ mineEnabled, theirsEnabled, mutuallyEnabled }`；不泄露对方具体开启时间。
- `PUT /api/v1/matches/:matchId/call-preference` — Body: `{ audioEnabled: boolean }`。
- `POST /api/v1/matches/:matchId/call-invitation` — 当前用户表达希望开启语音聊天：将当前用户 `audioEnabled` 设为 `true`，由后端生成不可伪造的语音邀请系统消息；同一 Match 不能连续刷邀请，建议 24 小时冷却。

### 呼叫流程

**`POST /api/v1/calls/:matchId/start`**

1. `requireAuth`，根据 Supabase auth ID 查询数据库 `User`。
2. 查询 Match，验证调用者属于该 Match 且尚未 unmatch。
3. 验证双方没有 block。
4. 验证双方 `CallPreference.audioEnabled=true`。
5. 验证双方都没有其他 `RINGING`/`ACCEPTED` 的 Call。
6. 创建 Call：`status=RINGING`、`expiresAt=now+45s`、`roomName=call:{callId}`。
7. 通过安全的前台信令通知 callee，并向 callee 的 iOS VoIP token 发送 APNs VoIP Push。
8. 返回 Call 信息；**此时不返回 LiveKit token**。

**`GET /api/v1/calls/incoming`** — 返回当前用户尚未过期的 `RINGING` 来电，用于 App 前台兜底、Realtime 临时断线兜底、PushKit 未配置时的开发阶段测试。**语义不变**：只覆盖 callee 一侧的 `RINGING` 来电，caller 发起的 outgoing `RINGING` 和任何一方的 `ACCEPTED` 都不在这里恢复——那是下面 `GET /calls/active` 的职责。

**`GET /api/v1/calls/active`** — Provider/App 重新初始化后的 active Call 恢复接口。`CallProvider` 的 `activeCall` 只存在于 React 内存；App 冷启动、`CallProvider` 重新挂载、用户切换或短暂断网重连之后，内存状态会归零，但数据库里仍可能有一个未处理完的 `RINGING`/`ACCEPTED` Call——`GET /incoming` 无法发现这种情况（它只看 callee 侧的 `RINGING`），caller 自己发起的来电、以及任何一方的 `ACCEPTED` 通话都会因此"找不回来"，还可能因为"同一用户只能有一个 active Call"的约束而无法再发起新电话。

- `requireAuth`；按 `req.userId`（Supabase auth id）解析出内部 `User`。
- 只查询 `callerId` 或 `calleeId` 等于当前用户、且 `status` 为 `RINGING`/`ACCEPTED` 的 Call；不接受、也不需要客户端传入 `userId` 或 `callId`——身份完全来自鉴权 token，第三方无法借此枚举别人的 active Call。
- 只返回 `RINGING`/`ACCEPTED`；`RINGING` 已超过 `expiresAt` 时复用现有 `expireIfStale` 原子修正为 `MISSED` 后再返回 `{ call: null }`；任何终态 Call 一律不返回。
- **不返回 LiveKit token**——和 `GET /:callId`/`GET /incoming` 同一条规则，凭证只经 `POST /:callId/livekit-token` 获取。
- 依赖"同一用户同一时刻只能有一个 active RINGING/ACCEPTED Call"这一由 `createCallWithLocking` 保证的既有约束；如果这条约束被打破、查出多于一条记录，不随机挑一条掩盖问题，而是记录明确错误日志并返回 500。
- 路由必须注册在 `GET /:callId` 之前，否则 `"active"` 会被当作字面量 `callId` 被 `/:callId` 捕获（与 `/:callId/livekit-token` vs 旧 `/:matchId/token` 同一类路由形状陷阱）。

**`GET /api/v1/calls/:callId`**

- 只有 caller/callee 可以读取；返回当前 Call 状态。**不签发 LiveKit token**——这是客户端轮询（前台信令兜底、`/incoming` 之后确认状态）会反复调用的接口，若每次轮询都重新签发 JWT 纯属浪费且没有必要的 token churn。
- 若 Call 已过期但仍是 `RINGING`，先原子更新为 `MISSED`（幂等修正，不算"轮询副作用"）。

**`POST /api/v1/calls/:callId/livekit-token`** — 独立的 LiveKit 凭证签发接口。

- 只有 `status=ACCEPTED` 时才允许调用，否则 409。
- 只有 caller/callee 本人可调用；每个用户只能获得自己身份的 token。
- TTL 尽量短（建议 10～15 分钟）；token grant 只能进入对应 `call:{callId}`，不能访问其他房间。
- 客户端应在自己第一次观察到 `ACCEPTED` 时调用一次并缓存，而不是每次轮询 `GET /:callId` 都重新调用。
- **实现注意**：路径不能是 `/:callId/token`——它和上面遗留的 `/:matchId/token` 是完全相同的路由 *形状*（Express 按字面量段匹配，不看参数名），两者会互相遮蔽。当前用 `/:callId/livekit-token` 加以区分，等第二阶段删除遗留接口后可以考虑改回更短的名字。

**`POST /api/v1/calls/:callId/accept`** — 仅 callee 可调用。只能 `RINGING → ACCEPTED`；当前时间必须早于 `expiresAt`；使用 transaction 或 `updateMany where status=RINGING`；设置 `answeredAt`；重复 accept 返回当前状态、不能产生 500；accept 成功后双方才允许获取 LiveKit token；通知 caller。**纯状态转换接口——响应体不含 `livekit` 字段，也不在本请求内签发凭证**：早期实现曾在同一个 HTTP 请求里先把状态改成 `ACCEPTED` 再签发 LiveKit 凭证，凭证签发失败时接口返回 500，但数据库已经是 `ACCEPTED`，导致客户端把这次失败误当成"接听失败"而回退到 idle，与已经是 `ACCEPTED` 的服务端状态、以及已经据此往下走的 caller 产生分裂。现在两者彻底解耦：状态转换只在这里完成，凭证一律通过下面独立的 `POST /:callId/livekit-token` 获取。

**`POST /api/v1/calls/:callId/decline`** — 仅 callee 可调用。`RINGING → DECLINED`，设置 `endedAt`/`endedById`，通知 caller。

**`POST /api/v1/calls/:callId/cancel`** — 仅 caller 可调用。`RINGING → CANCELED`，设置 `endedAt`/`endedById`，通知 callee。

**`POST /api/v1/calls/:callId/end`** — caller/callee 均可调用。`ACCEPTED → ENDED`，设置 `endedAt`/`endedById`/`durationSec`；必须幂等（重复 end 不生成重复记录）；通知另一方；如 LiveKit Server SDK 支持则主动断开/关闭对应房间，至少保证后续不再签发 token。

**失败状态**：麦克风拒绝、LiveKit 严重连接失败等情况下允许 `ACCEPTED/RINGING → FAILED`，必须记录明确 `failureReason`。

**`POST /api/v1/calls/:callId/fail`** — caller/callee 均可调用，非参与者 404（不泄露存在性）。Body 仅接受 `{ failureReason }`，服务端用白名单校验（当前实现：`MICROPHONE_DENIED` / `LIVEKIT_CONNECTION_FAILED` / `NETWORK_ERROR`——`failureReason` 列本身是自由 `String?`，不是 DB enum，所以这个白名单是唯一挡在任意客户端字符串和落库之间的东西；`PUSH_FAILED` 等其他示例值留给之后的 APNs VoIP Push 工作实现）。只允许 `RINGING → FAILED` 或 `ACCEPTED → FAILED`；设置 `status`/`failureReason`/`endedAt`/`endedById`；幂等（已是 `FAILED` 直接返回当前 Call，不重复生成系统消息；已是 `DECLINED`/`CANCELED`/`MISSED`/`ENDED` 时返回 409，不能被 FAILED 覆盖）；复用既有 `transitionCall`（这次通用化为可传入 `CallStatus[]`）+ `recordCallOutcomeMessage` 模式；`FAILED` 后复用 `closeLiveKitRoom` best-effort 关闭房间（失败不回滚已提交的终态）；`callerId`/`roomName`/时长等一律不信任客户端输入，全部取自 Call 行本身。`FAILED` 之后 `livekit-token` 与其他任何终态一样返回 409。

---

## 状态机

**Call 数据库记录是唯一事实来源**——Realtime、PushKit、CallKit 和客户端 UI 都不能成为事实来源。

允许的状态转换：

```
RINGING  → ACCEPTED
RINGING  → DECLINED
RINGING  → CANCELED
RINGING  → MISSED
RINGING  → FAILED
ACCEPTED → ENDED
ACCEPTED → FAILED
```

明确禁止：`DECLINED → ACCEPTED`、`CANCELED → ACCEPTED`、`MISSED → ACCEPTED`、`ENDED → ACCEPTED`。

### 必须处理的竞态场景

- caller cancel 与 callee accept 同时发生
- 45 秒超时与 accept 同时发生
- 重复 push 投递
- 双方同时发起 Call
- 同一用户多设备同时接听
- 同一请求被重试
- CallKit 与应用内按钮同时触发结束

处理手段：transaction、带旧状态条件的 `updateMany`、必要时数据库锁或唯一约束、幂等响应。

### 超时策略

不能用 Express 的 `setTimeout` 作为唯一超时方案（服务重启/扩容/进程休眠会导致其丢失）。要求：

1. 持久化 `expiresAt`。
2. 定时 cron/job/sweeper 扫描过期的 `RINGING` Call。
3. 每次 `GET /incoming`、`GET /:callId`、`accept`、`start` 时顺带校正过期状态。
4. 过期后生成 `MISSED` 记录并通知双方。

---

## 移动端架构

### 前台实时信令

项目已使用 Supabase，可用 Supabase Realtime，但**不能创建任何人都能猜到并监听的公共 userId channel**。二选一：

- **方案 A**：Supabase private Broadcast channel + Realtime Authorization，服务端用 service role 广播，客户端只能订阅自己的 channel。
- **方案 B**：对 Call 表使用 Postgres Changes + 严格 RLS，仅 caller/callee 能 `SELECT` 自己参与的 Call。

无论哪种方案：Call 数据库记录是唯一事实来源；Realtime payload 只作为"状态可能变化"的提示，客户端收到事件后必须重新请求 `GET /calls/:id`，不直接相信 Broadcast payload 中的状态；必须保留轮询兜底。

建议轮询频率：idle 且 App 前台时约每 3 秒 `GET /incoming`；`RINGING` 时约每 1 秒查询当前 Call；`ACCEPTED` 时约每 2 秒确认远端是否结束；Realtime 正常时可降低轮询频率。**App 后台不能依赖普通 JS 轮询接收新来电**（需要 PushKit/CallKit，见下节）。

### 全局 CallProvider

新增全局 `CallProvider` + `useCall`/`useCalls` hook，统一 Call 状态机，放在根布局中（`AuthProvider` 内部、页面导航外部或足以覆盖所有主页面的位置）。**不能把完整 Call 状态只放在聊天页。**

状态至少包括：`idle`、`outgoingRinging`、`incomingRinging`、`accepting`、`connecting`、`connected`、`reconnecting`、`ending`、`ended`、`failed`。

`CallProvider` 负责：

- 初始化 CallKit / PushKit，注册与更新 VoIP token
- 监听原生早期事件、监听 Realtime、前台 `GET /incoming` 兜底
- `startCall(matchId)` / `acceptCall(callId)` / `declineCall(callId)` / `cancelCall(callId)` / `endCall(callId)`
- 获取 `ACCEPTED` 后的 LiveKit token；恢复仍然有效的 Call
- 管理当前 Call UUID、本地与远端状态、重复事件、`AppState`、网络重连
- 管理 CallKit 与 React Native UI 的同步；对方挂断后结束本地 LiveKit 和 CallKit
- 登出时清理 listeners 和 token；用户切换时清理旧用户状态

同一时间只能有一个 active Call。映射关系保持稳定：`CallKit UUID = Call.id`，`LiveKit roomName = call:{Call.id}`。

### LiveKit 接入规则

保留 LiveKit 作为媒体层，但改造为：

1. `POST start` 时不签发 token。
2. `ACCEPTED` 前不连接 LiveKit。
3. `ACCEPTED` 后双方分别请求各自的 token，只能加入 `call:{callId}`。
4. token TTL 短期（建议 10～15 分钟），只有 caller/callee 能获取，Call 最终结束后不再签发。
5. 麦克风权限拒绝时：结束或标记 `FAILED`，清理 CallKit，给用户明确提示。
6. CallKit `didActivateAudioSession` 后正确启动 LiveKit AudioSession；`didDeactivateAudioSession` 后正确停止/暂停音频。
7. 挂断时：disconnect LiveKit → `POST end/cancel/decline` → 结束 CallKit → 清理本地状态。
8. 需支持：静音、扬声器、音频路由、蓝牙耳机的系统正常行为、网络短暂断开后的 reconnecting。

### 聊天页接入

修改 `apps/mobile/app/(main)/chats/[matchId].tsx`。

旧流程：点击 Call → `getCallToken` → `setCallSession` → 直接 connect LiveKit。

新流程：点击电话按钮 → 查询双方 `CallPreference` → 未互相开启则显示邀请/等待 UI → `mutuallyEnabled=true` 时调用 `CallProvider.startCall(matchId)` → 后续全部状态交由 `CallProvider` 管理。

聊天页不能继续：自己持有唯一 `callSession`；自己直接获取 LiveKit token；自己负责后台来电；自己决定最终 Call 状态。电话可以从聊天页发起，但来电和通话必须全局存在。

通话 UI 复用并改造 `apps/mobile/components/voice-call-modal.tsx`（不要无意义地全部重写），把它从"进入房间等待对方"改为真正由 Call 状态驱动（界面内容见「产品体验」章节）。

---

## iOS 原生能力

iOS 后台、锁屏和冷启动来电必须使用 **APNs VoIP Push + PushKit + CallKit**；不能把 `expo-notifications` 普通通知当作 iOS 电话的最终方案。

### APNs VoIP Push

后端通过 APNs HTTP/2 Provider API 发送 VoIP push。`apps/backend/.env.example` 新增：

```
APNS_TEAM_ID=
APNS_KEY_ID=
APNS_PRIVATE_KEY_BASE64=
APNS_BUNDLE_ID=com.pinme.app
APNS_VOIP_TOPIC=com.pinme.app.voip
```

要求：使用 Apple `.p8` Auth Key、ES256 provider token；私钥通过安全 secret/Base64 注入；不把 `.p8` 或真实私钥提交 Git。

- Sandbox endpoint：`api.development.push.apple.com`
- Production endpoint：`api.push.apple.com`
- Headers：`apns-push-type: voip`、`apns-topic: com.pinme.app.voip`、`apns-priority: 10`、`apns-expiration: 当前时间 + 45 秒`
- Payload 至少包含：`{ "aps": {}, "uuid": "call UUID", "callId": "Call ID", "callerName": "...", "handle": "...", "hasVideo": false }`
- **不得包含**：LiveKit token、Supabase access token、API access token、私密照片、不必要的用户资料及其他敏感数据。

APNs 错误处理：遇到 `410`/`BadDeviceToken`/`Unregistered`/`DeviceTokenNotForTopic` 等永久性错误时删除或禁用 token。发送失败不能让 Express 进程崩溃，需记录结构化日志；开发环境 APNs 未配置时允许通过前台 Realtime/轮询测试，生产环境应报告明确配置错误；普通推送失败不应破坏已持久化的 Call 状态。

VoIP push **只能用于真实新来电**，不得用于普通聊天消息、数据同步、营销、取消通话或非来电后台任务。对方取消/结束来电时优先使用现有 Realtime/WebSocket 信令，必要时使用普通 background notification，不滥用 VoIP push 冒充来电取消事件。

### CallKit 与 PushKit

使用项目当前确认的最新兼容版本和现有依赖方案，预计使用 `react-native-callkeep`（对应 Expo config plugin）+ `react-native-voip-push-notification`。若 PushKit 没有适合当前 Expo 版本的 config plugin，则在项目内编写受控 Expo config plugin 自动配置生成的 iOS 原生项目，不依赖每次 prebuild 后人工修改 AppDelegate。

**iOS capabilities**：Push Notifications；Background Modes 需包含 Voice over IP、Remote notifications、（如 LiveKit 后台音频需要）Audio/AirPlay/Picture in Picture。

**Info.plist / entitlements**：`UIBackgroundModes` 包含 `voip`、`remote-notification`、`audio`；`NSMicrophoneUsageDescription`；正确的 `aps-environment`、bundle identifier、VoIP topic。

**CallKit 配置**：`appName: PinMe`、`supportsVideo: false`、`maximumCallsPerCallGroup: 1`、`maximumCallGroups: 1`、合理的 handle type、使用 `Call.id` UUID。

**关键要求**：iOS 13+ 收到 VoIP Push 后，必须在原生层尽快调用 `reportNewIncomingCall`，不能等 React Native JS 完整启动、Supabase Realtime 连接、API 请求完全结束或 React Navigation 初始化完成——否则 iOS 可能终止 App 或停止后续 VoIP push 投递。

必须正确处理：PushKit 注册、`didUpdatePushCredentials`（token 上传后端）、`didInvalidatePushToken`；冷启动/后台/锁屏收到 VoIP push；CallKit `answerCall`/`endCall`/`startCall`/`setCurrentCallActive`/`reportEndCallWithUUID`/`didActivateAudioSession`/`didDeactivateAudioSession`/`didLoadWithEvents`；JS 尚未初始化时的早期事件缓存与恢复；重复 push 去重；同一 Call 多次 report 去重；登录用户变化后重新绑定 token；退出登录后注销 token。

如果 CallKit 已经显示来电，但 JS 启动后发现 Call 已取消/已过期/不存在，或用户已 block/unmatch，或双方语音权限已关闭，则**立即结束 CallKit 来电**并显示合理状态。

> 不得声称用户主动从多任务界面强制结束 App 后仍能保证来电——需按 Apple 实际系统限制在文档中说明。

---

## 安全规则

所有接口 `requireAuth`。服务端必须：

- 根据 Supabase auth ID 查询数据库 `User`；**不相信客户端传入** `callerId`、`calleeId`、`roomName`、`duration`、最终状态。
- 从 Match 推导双方身份；检查 unmatch；检查 block；检查双方 `CallPreference`。
- 限制 Call 查询权限、限制 LiveKit token 权限；防止枚举其他 `callId`；防止重复邀请；防止连续骚扰式呼叫。

**频率限制建议**：同一 caller 对同一 callee 的 start call 设置数秒冷却；短时间内连续未接/拒绝后增加冷却；同一 Match 的语音邀请 24 小时冷却；同一用户只能有一个 active Call。

APNs payload 不包含不必要的隐私数据（见「iOS 原生能力」章节）。

### 拉黑与解除 Match 联动

复用现有 block/unmatch 逻辑，规则：

1. block/unmatch 后不能创建 Call。
2. block/unmatch 后不能接受现有 `RINGING` 的 Call。
3. 当前 `RINGING` 的 Call 立即变为 `CANCELED` 或 `FAILED`。
4. 当前 `ACCEPTED` 的 Call 立即变为 `ENDED`。
5. 服务端主动结束对应的 LiveKit room。
6. 双方 CallKit/UI 立即清理，**不能只依赖客户端调用 end**。
7. `CallPreference` 自动失效，或后端始终根据 Match/block 状态实时判定。

---

## 分阶段实施计划

各阶段按依赖顺序推进；前一阶段代码完成并通过验证后再进入下一阶段。

**阶段 0 — 数据层**
新增 `CallPreference` / `Call` / `VoipDeviceToken` 模型与枚举，生成正式 Prisma migration（禁止 `db push`）；确认「同一用户同时只能有一个 RINGING/ACCEPTED Call」的约束或事务策略。

**阶段 1 — 后端 API 与状态机**
实现 `call-preference`、`call-invitation`、`devices`、`start`/`incoming`/`:callId`/`accept`/`decline`/`cancel`/`end` 全部接口；实现状态机允许/禁止的转换、事务与幂等处理；实现过期 sweeper（不依赖 `setTimeout`）；接入 block/unmatch 联动。

**阶段 2 — 移动端前台通话（无 CallKit/PushKit）**
实现全局 `CallProvider` 及状态机、Supabase Realtime 私有信令 + 轮询兜底；聊天页 `CallPreference` 交互状态 A–E；改造 `voice-call-modal.tsx` 为状态驱动；通话历史系统消息。此阶段可在前台/开发环境完整验证呼叫→接听→通话→结束的全流程，但后台/锁屏来电尚不可用。

**阶段 3 — iOS PushKit / CallKit 原生集成**
集成 `react-native-callkeep` + `react-native-voip-push-notification`（或自研 config plugin）；实现 APNs VoIP Push 发送；打通 PushKit token 注册/上传/失效、CallKit `reportNewIncomingCall` 与 `CallProvider` 的双向同步；处理冷启动/后台/锁屏来电与早期事件缓存。

**阶段 4 — Apple/EAS 人工配置与真机验证**
按「Apple/EAS 人工配置」章节完成 Apple Developer / EAS 侧配置；使用两台真实 iPhone（development build）完整走查「验收清单」中的全部场景。

**阶段 5 — 收尾验证**
运行以下命令并修复错误：

```
npx prisma format
npx prisma validate
npm run db:generate --workspace=apps/backend
npm run build --workspace=apps/backend
npx tsc --noEmit -p apps/mobile/tsconfig.json
```

运行项目已有的 lint / tests / 其他检查脚本；检查 Expo 配置：`npx expo config --type introspect`；如环境允许，执行 Expo prebuild 并检查生成的 AppDelegate、entitlements、Info.plist、`UIBackgroundModes`、Push Notifications capability、`aps-environment`、CallKit/PushKit 原生注册代码。**不得为了验证而覆盖用户现有 ios/android 原生目录的修改。**

### 完成定义（Definition of Done）

只有以下条件**全部**满足，才能称为完整实现：双方同意授权、完整 Call 状态机、前台来电、APNs VoIP Push、PushKit、CallKit、后台/锁屏/冷启动代码链路、`ACCEPTED` 后才签发 LiveKit token、全局 CallProvider、接听/拒绝/取消/挂断/未接、通话记录、block/unmatch 联动、安全校验、Prisma migration、配置文档、构建与类型检查通过。

**不得把"代码能编译"描述成"锁屏来电已经验证成功"**——两者分别对应实施进度表中的 `CODE COMPLETE` 与 `DEVICE VERIFIED`。

---

## 验收清单

**通话授权**

1. 双方未开启时不能直接拨号。
2. A 可以邀请 B 开启语音聊天。
3. 邀请消息由服务端生成。
4. A 开启、B 未开启时不能拨号。
5. B 同意后双方按钮解锁。
6. 任意一方关闭后不能创建新 Call。
7. 同一邀请不能连续刷。
8. block/unmatch 后授权失效。

**基础通话**

9. A 前台呼叫 B，B 前台收到来电。
10. B 接听后双方进入同一个独立 LiveKit room。
11. B 拒绝后 A 立即显示拒绝。
12. A 响铃中取消后 B 来电立即结束。
13. 45 秒未接听后状态变为 MISSED。
14. 已在通话中的用户收到新呼叫时返回 busy。
15. 双方同时呼叫时不能创建两个冲突 Call。
16. 重复 accept/end 请求幂等。
17. caller cancel 与 callee accept 竞态只有一个结果。

**iOS 系统来电**

18. B 锁屏时收到系统 CallKit 来电。
19. B 的 App 在后台时收到来电。
20. B 冷启动时通过 CallKit 接听。
21. CallKit 接听后正确进入 LiveKit。
22. CallKit 拒绝后后端状态变为 DECLINED。
23. CallKit 挂断后双方状态变为 ENDED。
24. App 内按钮与 CallKit 操作保持同步。
25. 重复 VoIP push 不显示两次来电。
26. 过期/取消 Call 的 Push 不会留下幽灵来电。

**媒体与异常**

27. 任意一方挂断，另一方立即结束。
28. 网络短暂断开后 LiveKit 重连。
29. 麦克风权限拒绝时不会卡在 connecting。
30. CallKit 音频激活/停用与 LiveKit 配合正确。
31. 静音正常。
32. 扬声器切换正常。
33. 通话时长从 answeredAt 计算。
34. LiveKit token 在 ACCEPTED 前无法获取。
35. 最终状态后无法获取新 token。

**推送**

36. PushKit token 注册并上传。
37. token 更新后 upsert。
38. token invalidation 后删除。
39. 退出登录后注销 token。
40. sandbox token 发送到 sandbox APNs。
41. production token 发送到 production APNs。
42. BadDeviceToken/Unregistered 会清理 token。

**记录和安全**

43. 通话结束生成一条系统消息。
44. 未接、拒绝、取消显示正确。
45. 重复 end 不产生重复系统消息。
46. 其他用户不能读取 Call。
47. 其他用户不能获取 LiveKit token。
48. block/unmatch 后不能呼叫或接听。
49. 通话中 block 会结束通话。

---

## Apple/EAS 人工配置

需新增独立文档 `docs/ios-voip-calling-setup.md`，明确写出以下人工步骤：

1. 登录 Apple Developer。
2. 找到或创建 App ID：`com.pinme.app`。
3. 启用 Push Notifications capability。
4. 配置 VoIP/PushKit 所需能力。
5. 创建 APNs Auth Key（`.p8`）。
6. 保存 Key ID、Team ID。
7. 将 `.p8` 内容安全转换为 Base64。
8. 配置到后端 secret：`APNS_TEAM_ID`、`APNS_KEY_ID`、`APNS_PRIVATE_KEY_BASE64`、`APNS_BUNDLE_ID`、`APNS_VOIP_TOPIC`。
9. **不允许**将 `.p8`、证书或 Base64 私钥提交 Git。
10. 在 EAS 中配置正确的 Apple credentials。
11. 重新生成 provisioning profile，确保包含新 capabilities。
12. 创建 development build：`npx eas build --profile development --platform ios`。
13. 说明 development/sandbox APNs 的使用方式。
14. 说明 TestFlight/production APNs 的使用方式。
15. 必须用**两台真实 iPhone**测试。
16. 模拟器不能完整测试 PushKit。
17. Expo Go 不能测试 CallKit/PushKit。
18. App Store Review 说明：VoIP push 只用于真实电话，不用于普通消息、营销或后台同步。
19. 说明 iOS 用户主动从多任务界面强制结束 App 后的系统限制。

同时需要更新：`apps/backend/.env.example`、`apps/mobile/.env.example`（如需要）、README 或运行说明、`eas.json`/config plugin 配置说明。

---

## 实施进度表

状态取值：`NOT STARTED` / `IN PROGRESS` / `CODE COMPLETE` / `DEVICE VERIFIED`。

`CODE COMPLETE` 仅表示代码已实现且通过静态验证（类型检查/构建），**不代表**已在真机上验证锁屏/后台/冷启动来电；只有走完两台真实 iPhone 场景验证后才能标记 `DEVICE VERIFIED`。

| 模块 | 说明 | 状态 |
|---|---|---|
| Prisma 数据层 | `CallPreference` / `Call` / `VoipDeviceToken` 模型 + migration `20260716010000_add_private_voice_calling`，含手写 partial unique index | CODE COMPLETE |
| 后端：通话授权 API | `call-preference` GET/PUT、`call-invitation`（含 24h 冷却） | CODE COMPLETE |
| 后端：设备 Token API | `POST/DELETE /calls/devices` | CODE COMPLETE |
| 后端：呼叫生命周期 API | `start`/`incoming`/`:callId`/`accept`/`decline`/`cancel`/`end` | CODE COMPLETE |
| 后端：active Call 恢复接口 | 新增 `GET /calls/active`，注册于 `GET /:callId` 之前；只查当前用户为 caller/callee 且状态为 RINGING/ACCEPTED 的 Call，过期 RINGING 经 `expireIfStale` 修正为 MISSED 后返回 `{ call: null }`，终态一律 `{ call: null }`；不返回 livekit；若同一用户查出多条 active Call（理论上应被 `createCallWithLocking` 的行锁排除）不随机选择，记录错误日志并 500。已用测试验证：caller 恢复 outgoing RINGING、callee 恢复 incoming RINGING、caller/callee 各自恢复 ACCEPTED（均不含 livekit）、终态返回 null、过期 RINGING 修正为 MISSED 后返回 null、无 active call 返回 null、未认证 401、路由不被 `/:callId` 捕获 | CODE COMPLETE |
| 后端：accept 与 LiveKit 凭证解耦 | `acceptCall` 只做 `RINGING→ACCEPTED` 状态转换（含幂等：已是 `ACCEPTED` 直接返回当前 CallSummary），响应不含 `livekit` 字段，也不再调用 `issueLiveKitCredentials`；凭证签发失败不再污染状态转换的原子性。已用测试验证：accept 在 `issueLiveKitCredentials` 被 mock 为失败时仍返回 200/ACCEPTED 且不调用该函数；`livekit-token` 端点在 RINGING 拒绝（409）、ACCEPTED 后 caller/callee 均可各自获取、非参与者拒绝（404）、终态后拒绝（409） | CODE COMPLETE |
| 后端：状态机与竞态处理 | 条件 `updateMany` + 幂等；跨 Match 的"同一用户唯一 active call"由 `createCallWithLocking` 按稳定升序对 caller/callee 的 User 行加 `SELECT...FOR UPDATE` 锁保证（不再单靠 Serializable 隔离级别），带有限次数重试；同 Match 由 partial unique index 兜底；已用真实并发测试验证（同 Match 竞态 + 跨两个不同 Match 抢同一 callee 的竞态） | CODE COMPLETE（已过 Backend Gate Review） |
| 后端：过期 Sweeper | 持久化 `expiresAt` + `setInterval` 定时扫描（15s）+ 每次读取时校正 | CODE COMPLETE |
| 后端：block/unmatch 联动 | `endActiveCallsForPair` 挂入 `blockUser`/`unmatch`，已用测试验证 RINGING→CANCELED、ACCEPTED→ENDED | CODE COMPLETE |
| 后端：通话历史系统消息 | 服务端生成、`Message.callId` 唯一约束保证幂等，已用测试验证重复 end 不产生重复消息 | CODE COMPLETE |
| 后端：APNs VoIP Push 发送 | HTTP/2 Provider API、sandbox/production 分流 | NOT STARTED |
| 后端：遗留 `/calls/:matchId/token` 入口 | 已确认零调用方后彻底删除（controller/route/mobile 客户端函数全部移除） | CODE COMPLETE |
| 后端：Realtime 信令准备 | migration `20260716020000_prepare_calls_realtime`（REPLICA IDENTITY FULL + 加入 `supabase_realtime` publication）+ `20260716030000_calls_realtime_rls`（启用 RLS，`calls_select_participants` 策略：仅 caller/callee 可 SELECT，经 `SECURITY DEFINER` 函数 `public.current_app_user_id()` 把 `auth.uid()` 映射到内部 `users.id`，不额外开放 `users` 表权限）+ `20260716031000_calls_realtime_rls_schema_usage`（补 `authenticated` 对 `public` schema 的 USAGE 授权，否则策略不可达）。已用真实角色模拟测试验证 caller/callee 可读、第三方不可读；**Realtime 实际 websocket 投递未做端到端验证**（见下方说明） | CODE COMPLETE（SELECT 授权已验证；Realtime 投递路径未验证） |
| 后端：FAILED 状态入口 | 新增 `POST /calls/:callId/fail`，白名单 `failureReason`（`MICROPHONE_DENIED`/`LIVEKIT_CONNECTION_FAILED`/`NETWORK_ERROR`），只允许 RINGING/ACCEPTED → FAILED，幂等，非参与者 404，FAILED 后 `livekit-token` 409，best-effort 关闭 LiveKit room。已用测试验证：caller/callee 均可对 RINGING 和 ACCEPTED 报告 FAILED、非参与者 404、非白名单 reason 400、重复 fail 幂等且只生成一条系统消息、已终态（如 CANCELED）不能被 FAILED 覆盖、FAILED 后 livekit-token 409、HTTP 路由不被 `/:callId` 捕获 | CODE COMPLETE |
| 移动端：全局 CallProvider | 状态机（`contexts/call.tsx`）、`useCall` hook、挂载于根布局 `AuthProvider` 内部 | CODE COMPLETE |
| 移动端：Realtime 信令 | Postgres Changes（`callee_id`/`caller_id` filter）+ 轮询兜底（idle 3s / ringing 1s / accepted 2s），App 后台时暂停轮询 | CODE COMPLETE |
| 移动端：聊天页交互 | CallPreference 状态 A/B/D 用 Alert 弹窗、状态 C 用可操作系统消息按钮、状态 E 用 actions tray 开关 | CODE COMPLETE |
| 移动端：通话 UI 改造 | `voice-call-modal.tsx` 拆成 `PreConnectScreen`（未 ACCEPTED 前，不连 LiveKit）+ `ConnectedCallScreen`（复用原有视觉设计），新增全局 `IncomingCallOverlay` + `GlobalCallHost` | CODE COMPLETE |
| 移动端：LiveKit 接入规则 | ACCEPTED 后才经 `POST /:callId/livekit-token` 取 token 再连接；时长从服务端 `answeredAt` 计算 | CODE COMPLETE |
| 移动端：accept 状态分裂修复 | `acceptCall` 响应改为纯 `CallSummary`（无 `livekit`）；`CallProvider` 收到 ACCEPTED 后立即进入 `connecting`，再单独调用新增的 `ensureLiveKitToken` 取凭证，已取到后不再重复请求；`ensureLiveKitToken` 用 `tokenRequestRef` 做同一 `callId` 的 in-flight 去重，防止 Realtime/轮询/accept 响应同时触发重复签发；accept 请求本身失败（网络错误/响应丢失）不再直接 `resetToIdle`，改由新增的 `reconcileAfterAcceptFailure` 调 `GET /:callId` 对账：服务端已 `ACCEPTED` 则继续走 connecting+取 token，仍 `RINGING` 则恢复 `incomingRinging` 并提示错误，终态则应用对应结果，对账请求本身也失败则保留来电状态、留给轮询重试，不假定 Call 已消失 | CODE COMPLETE |
| 移动端：active Call 恢复（Provider 重新初始化） | 新增 `getActiveCall` API + `CallProvider` 内 `recoverActiveCall`/`recoverOrRefresh`：`accessToken`+`dbUserId` 就绪（挂载/用户切换）、App 回到前台、idle 轮询三处都会调用，不再等 idle 轮询的第一个 3 秒 tick；本地已有 `activeCall` 时优先 `refreshCall` 当前 `callId`，绝不用恢复结果覆盖更新的本地状态；`recoveryInFlightRef` 保证同一时刻只有一个 `GET /calls/active` 请求在途；response 返回后做迟到响应保护（已登出/`dbUserId` 已变化/本地已建立新 `activeCall` 均丢弃结果）。RINGING 按角色恢复 `outgoingRinging`/`incomingRinging`；ACCEPTED 恢复 `connecting` 并复用 `ensureLiveKitToken` 取凭证（ACCEPTED 前不取 token）；`resetToIdle`（登出/终态清理）一并清空 `recoveryInFlightRef`，旧账号的迟到 response 因 `dbUserId` 判断失配而不会写入新账号状态；未额外持久化 Supabase access token 或 LiveKit token 到 AsyncStorage（本来就没有）。类型检查通过；初始化/前后台切换/用户切换的实际运行时行为未做设备验证，移动端项目无自动化测试框架，无法自动化验证 | CODE COMPLETE（未做真机/模拟器人工验证） |
| 移动端：麦克风权限 preflight | `voice-call-modal.tsx` 新增 `MicPreflightGate`：`livekit` 凭证到手后、挂载 `<LiveKitRoom audio>` 前，用项目已有的 `expo-av` `Audio.requestPermissionsAsync()`（与聊天页语音消息录制同一 API）做一次性检查；granted 才继续挂载 LiveKitRoom，denied 或该 API 本身抛错都调用 `reportMediaFailure('MICROPHONE_DENIED')`（服务端 FAILED 为唯一事实来源，不只本地 `setPhase('failed')`），并展示明确的权限提示文案 | CODE COMPLETE |
| 移动端：LiveKit 连接状态与断线处理 | 新增 `LiveKitConnectionSection` 承载 `<LiveKitRoom onConnected/onError/onDisconnected>`：`onError` 仅在从未连接成功时上报（已连接后的瞬时错误交给 LiveKit 自身重连机制，避免网络抖动被误判 FAILED）；`onDisconnected`（重连耗尽后的最终断线）与一个 20s 连接 watchdog 超时都统一走新增的 `confirmCallOrFail`：先 `GET /:callId` 对账，服务端已终态则采用该终态（不会把对方正常挂断的 ENDED 覆盖成 FAILED），仍是 ACCEPTED 才上报 `LIVEKIT_CONNECTION_FAILED`；对方离开房间不再只显示 banner 后无限等待，`ConnectedCallScreen` 新增 8s grace timer，对方回来则清掉计时器，超时未回来则同样调用 `confirmCallOrFail`；`ConnectedCallScreen` 的状态文案区分 connecting/reconnecting（含 `signalReconnecting`）；所有连接/重连/grace timer 在成功连接、组件卸载时清理（Call 终态/用户切换会连带卸载整个 LiveKitRoom 子树，定时器随卸载一起清理） | CODE COMPLETE |
| 移动端：扬声器切换 | `ConnectedCallScreen` 原第三个空白控制位替换为扬声器按钮，使用 `@livekit/react-native` 的 `AudioSession.getAudioOutputs()`/`selectAudioOutput()`（已读取当前安装版本类型声明确认 API，未引入新依赖）；切换前用 `getAudioOutputs()` 校验目标 deviceId 是否可用，不可用/调用失败时保留原状态并 toast 提示，不结束通话；通话结束/组件卸载沿用既有 `AudioSession.stopAudioSession()` 清理；**iOS 平台限制**：类型声明中 iOS 只暴露 `"default"`/`"force_speaker"` 两种 deviceId，没有真正的 "earpiece" 选项（OS 限制，非本实现缺陷），"speaker 关闭" 在 iOS 上等价于交还给系统默认路由（`default`），不是强制走听筒；Android 有对应的真实 `"speaker"`/`"earpiece"` deviceId。**未在真机/模拟器上验证实际音频路由效果**，仅完成类型检查与代码走查 | CODE COMPLETE（iOS 无真正 earpiece 选项，见说明；未做设备音频验证） |
| iOS：PushKit 集成 | token 注册/上传/失效、原生早期事件处理 | NOT STARTED |
| iOS：CallKit 集成 | `reportNewIncomingCall` 等全部生命周期回调 | NOT STARTED |
| iOS：Expo config plugin | entitlements / Info.plist / Background Modes | NOT STARTED |
| Apple/EAS 人工配置 | `docs/ios-voip-calling-setup.md` + 实际后台操作 | NOT STARTED |
| 真机场景验证 | 验收清单 49 项，双 iPhone 走查 | NOT STARTED |
