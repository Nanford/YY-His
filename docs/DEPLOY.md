# 部署方案 · his.hootoolai.com（Debian）

老年健康智能评估系统 Demo 的生产部署 runbook。方案：**Nginx（反向代理 + certbot 证书）+ systemd（进程守护）+ 服务器本地构建**，单机即可。适配"这台服务器已有 Nginx 在服务其它站点"的情况——只加一个 `his.hootoolai.com` 的 server 块，不动现有配置。

> ⚠️ **HTTPS 是硬性要求**：患者端用麦克风（`getUserMedia`）和音频自动播放，浏览器只在**安全上下文（HTTPS）**下允许。HTTP 部署会导致语音链路直接不可用。

> 📌 **所有命令都在项目目录 `/opt/his` 里跑**（除非另注）。开新终端会掉回 `/root`，记得先 `cd /opt/his`——否则会遇到"找不到 schema.prisma / Missing script: build"。

---

## 0. 架构总览

```
患者/医生浏览器
   │  https://his.hootoolai.com  (443, TLS)
   ▼
┌─────────────┐   已有 Nginx，加一个反代 server 块 + certbot 证书
│   Nginx     │
└─────┬───────┘
      │  http 127.0.0.1:3000  (仅本机)
      ▼
┌─────────────┐   next start (systemd 守护)
│  Next.js    │──► SQLite  prisma/dev.db     （PII 只在本地）
│  16.2       │──► storage/audio-cache/       （TTS 音频 + 录音）
└─────┬───────┘
      │  出网 HTTPS（仅携带患者编号，无 PII）
      ▼  DeepSeek / 火山 TTS·ASR
```

---

## 1. 前置准备

1. **DNS**：把 `his.hootoolai.com` 的 **A 记录**指向服务器公网 IP（certbot 签证书要它先解析对）。
2. **服务器**：Debian 12+，**≥2GB 内存**（`next build` 偏吃内存，1GB 机器请先加 swap），x86_64。
3. **端口**：`80`、`443`（Nginx；80 用于 certbot 验证与跳转）、`22`（SSH）。**不要**对外开 `3000`。
4. **密钥就绪**：DeepSeek、火山 APP_ID/ACCESS_TOKEN（缺失时语音自动降级，流程仍可跑）。

---

## 2. 安装运行环境

```bash
# Node 20 LTS（Next 16 需 ≥20.9；22 LTS 亦可）
# ⚠️ Debian 默认源的 nodejs 是 18，不够用——必须走 NodeSource。先卸旧再装：
sudo apt-get remove -y nodejs
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 必须 ≥ v20.9，否则后续 npm/prisma/next 全部报 EBADENGINE

# 原生模块 better-sqlite3 的编译兜底（有预编译时用不上，装了保险）
sudo apt-get install -y build-essential python3 git

# Nginx + certbot（若已装 Nginx 只需补 certbot）
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

---

## 3. 拉代码

```bash
sudo mkdir -p /opt/his && sudo chown "$USER":"$USER" /opt/his
git clone https://github.com/Nanford/YY-His.git /opt/his
cd /opt/his
git checkout feature/patient-interview-voice-redesign   # 或已合并后的 main
```

---

## 4. 配置环境变量

生产密钥放 `/opt/his/.env.local`（**不入库**，Next 会自动加载）。⚠️ **真实密钥只写在服务器这个文件里，别写进任何要提交的文档/代码**：

```bash
cat > /opt/his/.env.local <<'EOF'
# —— 数据库（SQLite 本地文件，相对 /opt/his）——
DATABASE_URL=file:./prisma/dev.db

# —— DeepSeek 回答归一化（缺失则走规则兜底）——
DEEPSEEK_API_KEY=你的deepseek_key

# —— 火山语音（豆包 TTS + 录音识别，一套密钥）——
VOLC_APP_ID=你的appid
VOLC_ACCESS_TOKEN=你的access_token
VOLC_TTS_VOICE=zh_female_xiaohe_uranus_bigtts

# —— 数字人：未商务开通用 fallback ——
AVATAR_MODE=fallback
EOF
chmod 600 /opt/his/.env.local
```

> Prisma CLI 只读 `.env`（不读 `.env.local`），所以下一步迁移命令里显式带 `DATABASE_URL`。

---

## 5. 安装依赖 + 数据库迁移 + 构建

```bash
cd /opt/his
# 用 npm install（非 npm ci）：lockfile 在 Windows 上生成，缺 Linux 平台的可选依赖
# （@emnapi/* 等 WASM 原生模块变体），npm ci 会因 lockfile 不同步而失败；install 会补齐。
npm install                             # 会触发 postinstall: prisma generate
DATABASE_URL=file:./prisma/dev.db npx prisma migrate deploy   # 建表/迁移（首次即建库）
npm run build                           # 生产构建 .next
```

> `storage/audio-cache/` 首次运行会自动创建；确认运行用户对 `/opt/his` 有写权限即可。
> 若之前用 `npm ci` 半装失败过，先 `rm -rf node_modules` 再 `npm install`。

---

## 6. 进程守护（systemd）

```bash
sudo tee /etc/systemd/system/his.service >/dev/null <<'EOF'
[Unit]
Description=YY-His (Next.js)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/his
# 只监听本机，由 Nginx 反代；端口 3000
ExecStart=/usr/bin/npm run start -- -H 127.0.0.1 -p 3000
Restart=always
RestartSec=3
Environment=NODE_ENV=production
User=%i
EOF

# 把 User=%i 改成实际运行用户（如 www-data 或你的账号），或直接写死：
sudo sed -i "s/User=%i/User=$USER/" /etc/systemd/system/his.service

sudo systemctl daemon-reload
sudo systemctl enable --now his
sudo systemctl status his          # 看是否 running
curl -I http://127.0.0.1:3000      # 本机应 200（这是 Nginx 反代的前提，先确认通）
```

---

## 7. Nginx 反向代理 + HTTPS（certbot）

> 若你之前上过 Caddy 并占了 443，先让出来：`sudo systemctl disable --now caddy`。
> "443 address already in use" = 端口被占（多半是现有 Nginx/Apache）；用 `sudo ss -tlnp | grep -E ':80|:443'` 看是谁。

**① 先看现有 Nginx 有没有 his.hootoolai.com 的配置，避免撞车：**

```bash
sudo nginx -T 2>/dev/null | grep -iE 'server_name|hootoolai' | head
ls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
```
> 已经有 `his.hootoolai.com` 的 server 块就**改那个**（`location /` 指到 `proxy_pass http://127.0.0.1:3000;`），别新建重复的。

**② 加反代 server 块（标准 Debian sites-available 布局；用 conf.d 的把文件放 `/etc/nginx/conf.d/his.hootoolai.com.conf` 即可，不用 ln）：**

```bash
sudo tee /etc/nginx/sites-available/his.hootoolai.com >/dev/null <<'EOF'
server {
    listen 80;
    server_name his.hootoolai.com;
    client_max_body_size 25m;          # 患者录音 WAV 上传，别用默认 1MB（会截断录音）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;       # DeepSeek/TTS 服务端调用略久，放宽超时
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/his.hootoolai.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**③ certbot 自动签证书并加 443（会自动改上面这个 server 块）：**

```bash
sudo certbot --nginx -d his.hootoolai.com
```

certbot 跑完，访问 **https://his.hootoolai.com** 即应打开（锁图标正常）。证书 90 天有效，certbot 装好会自带自动续期定时器（`systemctl status certbot.timer`）。

---

## 8. 防火墙

```bash
sudo apt-get install -y ufw
sudo ufw allow 22,80,443/tcp
sudo ufw enable
# 3000 不放通；Next 已用 -H 127.0.0.1 绑本机，双保险
```

---

## 9. 更新 / 发布流程

以后每次发新版本：

```bash
cd /opt/his
git pull
npm install
DATABASE_URL=file:./prisma/dev.db npx prisma migrate deploy   # 有新迁移才需要，跑一遍也无害
npm run build
sudo systemctl restart his
```

> **数据库和录音不会被 git 覆盖**：`prisma/dev.db` 与 `storage/` 都在 `.gitignore`，`git pull` 不动它们。

---

## 10. 备份（重要，SQLite 单文件很好备）

```bash
# 一次性/定时：用 sqlite 在线备份，避免直接 cp 撞上写入
sudo apt-get install -y sqlite3
mkdir -p /opt/his-backups
sqlite3 /opt/his/prisma/dev.db ".backup '/opt/his-backups/dev-$(date +%F).db'"
# 录音/音频缓存
tar czf /opt/his-backups/storage-$(date +%F).tgz -C /opt/his storage
```

建议加进 `crontab -e` 每日跑一次。

---

## 11. 本项目专属注意点（务必看）

| 点 | 说明 |
|---|---|
| **HTTPS 必须** | 麦克风 + 音频自动播放只在 HTTPS 生效；证书没签好前患者端语音不可用。 |
| **ASR body size** | `/api/asr` 上传 WAV，Nginx `client_max_body_size` 已设 25MB；默认 1MB 会截断录音。 |
| **PII 留本地** | 姓名/身份证/手机等只在 `prisma/dev.db`；出网只带患者编号。别把 DB 文件放进任何 public 目录或对象存储。 |
| **密钥不入库** | 只在 `/opt/his/.env.local`（`chmod 600`）；切勿写进文档或提交。 |
| **降级可用** | 密钥缺失/网络异常时语音链路自动降级为字幕 + 按钮/文字，流程仍完整——可先无密钥上线验流程。 |
| **数字人** | `AVATAR_MODE=fallback`（内置 3D 形象）；火山虚拟数字人商务开通后再切 `sdk`。 |
| **出网白名单** | 若服务器有出站限制，放通到 DeepSeek、火山（openspeech/tts/asr）的 HTTPS。 |

---

## 12. 上线自检清单

- [ ] `his.hootoolai.com` A 记录已生效（`dig his.hootoolai.com` 指向本机 IP）
- [ ] Node ≥ v20.9（`node -v`）
- [ ] `systemctl status his` = running，`curl -I http://127.0.0.1:3000` = 200
- [ ] `sudo nginx -t` 通过，`his.hootoolai.com` server 块已 reload
- [ ] 浏览器打开 `https://his.hootoolai.com`，锁图标正常（证书有效）
- [ ] `/patient/register` 建档 → 语音评估能出报告；`/doctor` 能看列表
- [ ] 麦克风授权弹窗正常出现（证明安全上下文 OK）
- [ ] 备份 cron 已配置

---

## 常见报错速查

| 报错 | 原因 / 修法 |
|---|---|
| `EBADENGINE ... required node >=20` | Node 还是 18，走第 2 步 NodeSource 升到 20。 |
| `npm ci ... can only install ... in sync`（Missing @emnapi/*） | lockfile 缺 Linux 平台依赖；用 `npm install` 代替 `npm ci`。 |
| `Could not find Prisma Schema` / `Missing script: build` | 不在项目目录；先 `cd /opt/his`。 |
| `P2021 The table 'main.Patient' does not exist`（页面 500） | 迁移没成功、库是空的（App 空跑时自动建了空 dev.db）；`cd /opt/his` 后 `sudo systemctl stop his` → `DATABASE_URL=file:./prisma/dev.db npx prisma migrate deploy` → `sudo systemctl start his`。 |
| `Failed to find Server Action "xxx"` | 浏览器开着旧构建的页面提交到新构建；硬刷新（Ctrl+F5）即可，非 bug。 |
| Caddy/Nginx `:443 address already in use` | 端口被占；`ss -tlnp | grep :443` 查谁占，Caddy 用 `disable --now caddy` 让出。 |
| `caddy.service is not active, cannot reload` | 服务没起来（多因 Caddyfile 错或端口占用）；本方案已改用 Nginx。 |

---

## 备选方案（Caddy / PM2）

- **Caddy 替代 Nginx**（适合这台没有其它站、想要自动 HTTPS）：官方源装 caddy，`/etc/caddy/Caddyfile` 写 `his.hootoolai.com { reverse_proxy 127.0.0.1:3000; request_body { max_size 25MB } }` + 全局 `email`，`sudo systemctl enable --now caddy`。
- **PM2 替代 systemd**：`pm2 start "npm run start -- -H 127.0.0.1 -p 3000" --name his && pm2 save && pm2 startup`。
