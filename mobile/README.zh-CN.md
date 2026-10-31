# Hermes Bot 手机端：iOS 17.0 / 巨魔 / 中英双语

IPA：`Hermes-Bot-iOS17-ZH-EN-TrollStore.ipa`。使用 TrollStore 导入安装；不需要 Expo 登录或 Apple 开发者证书。原生构建面向 ARM64 真机，最低系统版本设为 iOS 17.0。

## 切换语言

打开 **设置 / Settings → 语言 / Language**，选择 **跟随系统 / System、简体中文、English**。初次启动跟随系统，中文地区使用简体中文，其他语言使用英文。手动选择保存在手机钥匙串，切换时不重建会话。浏览器预览仅在当前页面运行期间记住选择。

中英切换只影响界面及项目自带的演示文案；真实服务器返回的机器人名称、聊天消息和用户输入保留原文。

## 头像与模型页

机器人列表、聊天标题和机器人详情中的头像会轻轻浮动、呼吸，正在思考时动作更活跃。开启 iOS **设置 → 辅助功能 → 动态效果 → 减弱动态效果** 后头像保持静止；应用退到后台、离开对应页面时暂停动画。

在 **设置 → 模型 → 选择机器人** 查看当前模型，点模型列表即可保存；点击右上方“切换”选择另一位机器人。“自定义模型”默认折叠，展开后选择服务器提供商并输入模型 ID。聊天详情中的模型选择使用相同界面。Base URL 和 API Key 继续由 Hermes 服务器管理。

## 连接服务器

连接路径：手机 → Tailscale HTTPS → 服务器本机 `127.0.0.1:8765` 桥接服务 → `127.0.0.1:8642` Hermes API。

手机端不通过 SSH 登录，也不直接填写模型 API Key。服务器必须运行本项目的 `bridge/` 服务。以下适用于使用 systemd 的 Linux 主机；Docker 部署需按容器网络和 Hermes 数据目录另行配置。

### 1. 检查 Hermes

使用实际运行 Hermes 的 Linux 用户，确认 Python 3.11+、PyYAML、rsync 和 Tailscale 已安装。运行 `hermes gateway status` 检查网关。

主配置的 `~/.hermes/.env` 需要：

```dotenv
API_SERVER_ENABLED=true
API_SERVER_KEY=<服务器上的64位十六进制密钥>
```

保留已有 API_SERVER_KEY；如果尚未设置，可用 `python3 -c 'import secrets; print(secrets.token_hex(32))'` 在服务器本地生成并写入。修改后按现有方式重启 Hermes 网关。密钥留在服务器，不填入手机。

### 2. 安装桥接服务

将本项目源码放到服务器，在项目根目录以同一 Hermes 用户运行：

```bash
bash bridge/deploy/install.sh
```

脚本将桥接程序复制到该用户的 `~/hermes-bridge`，安装并启动 `hermes-bridge.service`。先检查目标目录不是其他用途，脚本会同步覆盖其中的桥接文件。

### 3. 通过 Tailscale 提供 HTTPS

服务器和 iPhone 的 Tailscale 登录同一网络。先运行 `sudo tailscale serve status` 检查是否已有 443 服务；确认该端口可以用于桥接服务后运行：

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8765
```

使用 Tailscale 给出的 `https://主机名.网络名.ts.net` 地址。不要开启 Funnel，也不需要把 8765 / 8642 暴露到公网。

在同一 Tailscale 网络中的设备访问 `https://主机名.网络名.ts.net/v1/health`，确认顶层 `ok` 和 `hermes.ok` 都为 `true`。

### 4. 生成配对码并连接手机

服务器运行：

```bash
cd ~/hermes-bridge
python3 -m hermes_bridge pair
```

配对码有效 20 分钟，仅能使用一次。手机打开 **设置 → 连接**：

- 地址：`https://主机名.网络名.ts.net`，填写根地址，不加 `/v1/health`。
- 配对码：上一步生成的码。
- 点击 **配对本机 / Pair this phone**。

配对后读取真实 Hermes 机器人及会话。手机仅保存桥接地址、设备令牌、界面语言和外观选择。没有配对时显示“尚未连接服务器”，会话为演示数据。无需拥有 Mac，Mac 只用于 GitHub Actions 云端编译。

## 外观主题

打开 **设置 → 外观**，可选择 **象牙金 / 白天 / 夜间 / 跟随系统**。象牙金使用暖象牙白、香槟金和柔和卡片。首次安装默认跟随 iPhone 外观；手动选择会保存在 iOS 钥匙串，重启后恢复。切换时不重置聊天、输入草稿或服务器模型选择。聊天页、模型页、输入框、弹窗及状态栏同步适配。

头像在空闲时轻轻浮动，机器人回复时动作加快。切换到后台、离开页面或开启系统“减弱动态效果”时停止动画。

## 手机选择机器人的模型

进入 **设置 → 模型 → 选择机器人**，或打开聊天后点机器人详情里的 **模型**。

- 每个机器人分别读取服务器可用模型；点击后保存到服务器，从下一条消息开始使用。
- **自定义模型**：如果你使用的 Base URL 没有提供模型列表，可以输入该 API 支持的准确模型 ID，继续使用该机器人已有的服务地址和密钥。
- **跟随服务器**：清除该机器人的手动选择，使用其服务器默认模型。发送前会重新读取默认配置；无法读取时由 Hermes 决定实际模型。
- 选择保存失败会显示错误，不会假装已切换。模型的展示名称与实际请求 ID 分开处理。

服务器原有的 **模型 Base URL / API Key** 不用填到手机。`API_SERVER_KEY` 是桥接访问 Hermes 的另一个密钥，也留在服务器。手机只填写 **桥接 HTTPS 地址 + 一次性配对码**。

新机器人会复制主配置的 `config.yaml` 和 `.env` 中的模型服务配置，创建后可以单独选模型。若你的 API Key 仅通过 systemd / Docker 的进程环境注入，需要确认新 profile 的 Hermes 进程也能读取它；不能假定它已经写进 `.env`。

## 当前原项目的功能限制

文字会话、每个机器人的模型选择、机器人描述、定时任务列表与运行记录已接入桥接服务。群组、语音、附件和应用内更新仍有演示或未接入部分。手机更新通过 TrollStore 导入新版 IPA。

## 聊天设置、描述与定时任务

进入机器人聊天，点右上角 **… → 聊天设置**：

- **机器人描述**：说明它的职责，修改后点保存。内容写入服务器该机器人 `SOUL.md` 中由本应用管理的段落，从下一次新会话生效。保存失败会保留输入供重试。
- **定时任务 → 任务与运行记录**：读取该机器人在服务器上的任务，显示状态、计划、下次和上次运行时间、投递位置。支持暂停、恢复、立即运行和刷新。
- 每个任务下显示最近 3 次运行对应的 **session**，点开可查看消息。例如每日新闻任务可能每天产生一个 session。这些记录来自服务器；读取失败会明确提示，刷新失败会保留此前已读取的记录。

创建任务主要通过聊天，例如：“每天早上 9 点整理科技新闻，用中文写成 5 条要点”。由 Hermes 智能体调用服务器的定时任务工具创建，成功后可在聊天设置中刷新查看。服务器必须支持并启用相应工具，网关调度器也需要持续运行；手机界面本身不执行定时任务。时间和投递渠道应在聊天中明确，并检查任务实际返回的配置。

此版提供任务与运行结果查看，**不等于已实现 iOS 锁屏或后台推送**。任务是否投递到 Telegram 等渠道取决于服务器上的配置。所有 session 的独立浏览、用量统计和服务器 CPU 监控尚未接入手机端。

## 验证命令

```bash
cd mobile
npx tsc --noEmit
node scripts/test-localization.cjs
node scripts/test-server-models.cjs
node scripts/test-appearance.cjs
node scripts/test-bot-names.cjs
node scripts/test-schedules.cjs
python scripts/verify-ios-ipa.py artifacts/Hermes-Bot-iOS17-ZH-EN-TrollStore.ipa
```

构建由 `.github/workflows/ios-unsigned-ipa.yml` 在 macOS / Xcode 上执行。源码及浏览器模拟验证不代表已在真实 iPhone 或你的 Hermes 服务器上验证。
