# Hermes Bot 手机端：iOS 17.0 / 巨魔 / 中英双语

IPA：`Hermes-Bot-iOS17-ZH-EN-TrollStore.ipa`。使用 TrollStore 导入安装；不需要 Expo 登录或 Apple 开发者证书。原生构建面向 ARM64 真机，最低系统版本设为 iOS 17.0。

## 切换语言

打开 **设置 / Settings → 语言 / Language**，选择 **跟随系统 / System、简体中文、English**。初次启动跟随系统，中文地区使用简体中文，其他语言使用英文。手动选择保存在手机钥匙串，切换时不重建会话。浏览器预览仅在当前页面运行期间记住选择。

中英切换只影响界面及项目自带的演示文案；真实服务器返回的机器人名称、聊天消息和用户输入保留原文。

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

配对后读取真实 Hermes 机器人及会话。手机仅保存桥接地址和设备令牌。没配对时看到的 `mac-studio` 和机器人是示例，不是你的服务器。

## 当前原项目的功能限制

文字会话已接入桥接服务。模型选择列表、群组、语音、附件和应用内更新仍有演示或未接入部分；实际聊天使用服务器当前模型。手机更新通过 TrollStore 导入新版 IPA。

## 验证命令

```bash
cd mobile
npx tsc --noEmit
node scripts/test-localization.cjs
python scripts/verify-ios-ipa.py artifacts/Hermes-Bot-iOS17-ZH-EN-TrollStore.ipa
```

构建由 `.github/workflows/ios-unsigned-ipa.yml` 在 macOS / Xcode 上执行。源码及浏览器模拟验证不代表已在真实 iPhone 或你的 Hermes 服务器上验证。
