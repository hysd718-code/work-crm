# 工作日程与客户管理 PWA

纯静态应用：HTML5 + Tailwind(CDN) + ES Module，无需构建。数据：LocalStorage 缓存 ⇄ GitHub JSON；文件：Google Drive。

## 目录
```
index.html  manifest.json  sw.js
js/  app.js(路由/同步状态/PWA)  store.js(本地状态)  sync.js(GitHub)  drive.js(Google Drive)
     calendar.js(月/周/日/列表)  clients.js(客户+文件)  settings.js  util.js
icons/
```

## 部署（必须 HTTPS 或 localhost，Service Worker 与 Google 登录才可用）
- 本地：`python3 -m http.server 8080` → 打开 http://localhost:8080
- 线上：推到 GitHub 仓库，Settings → Pages 启用（得到 `https://<user>.github.io/<repo>/`）。
  **代码仓库与数据仓库请分开；数据仓库必须设为 Private。**

## 配置 GitHub 同步
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate。
2. Repository access 选「Only select repositories」，只勾选你的**私有数据仓库**（可先建空仓库，如 `work-crm-data`）。
3. Permissions → Repository permissions → **Contents: Read and write**（其余不需要）。设置到期时间。
4. 应用「设置」页填：令牌、仓库 `owner/repo`、分支（默认 main）、目录（默认 `data`）→「保存并立即同步」。
5. 首次同步会在仓库创建 `data/clients.json`、`data/events.json`。
   - 使用经典 PAT 时需要 `repo` 权限范围。
   - 单个 JSON 超过 1 MB 时，Contents API 不再返回内容（官方限制），届时需拆分数据。

## 配置 Google Drive
1. https://console.cloud.google.com → 新建项目 → API 和服务 → 库 → 启用 **Google Drive API**。
2. 「Google Auth Platform / OAuth 同意屏幕」：用户类型选外部，填应用名与邮箱；
   Scopes 添加 `https://www.googleapis.com/auth/drive.file`；
   发布状态为「测试」时，把你自己的 Google 账号加入 **Test users**。
3. 「凭据」→ 创建凭据 → **OAuth 客户端 ID** → 应用类型 **Web 应用**：
   - 已获授权的 JavaScript 来源：`http://localhost:8080`、`https://<user>.github.io`（只写来源，不带路径）。
   - 无需「重定向 URI」，无需 API Key，无需 Client Secret。
4. 把客户端 ID 填入应用「设置」→「保存并授权测试」。
5. 上传文件时自动创建 `Work_CRM_Storage / ZHANG_SAN / 文件`。客户姓名直接用大写拼音（姓 名 之间一个空格），文件名把空格换成下划线：`ZHANG_SAN_20261022_Receta.pdf`；检查报告会带检查类型：`ZHANG_SAN_20261022_Resultados_Informe_Ecografia.pdf`（同名自动加 `_2`）。
6. 上传按钮支持「拍照」与「相册/文件」；超过 1.5 MB 的图片会压缩为 JPEG（长边 2200px），PDF 不处理。

### 注意
- `drive.file` 只能访问**本应用创建**的文件；手动拖进该文件夹的文件不会被列出/预览。
- 令牌模型无刷新令牌，约 1 小时过期，之后再次上传/预览会弹出授权窗口。
- 同名客户会共用一个文件夹；如需区分，可在姓名后加数字，如 `ZHANG SAN 2`。

## 同步规则
- 逐条记录比较 `updatedAt`，新者胜；删除以墓碑（`deleted:true`）传播。
- 多设备同时编辑同一条记录时，以后保存者为准（不做字段级合并）。
- 离线可读写；联网/回到前台/修改后 4 秒自动同步，亦可手动点「同步」。

## 隐私
含医疗信息（欧盟 GDPR 属特殊类别数据）：数据仓库保持 Private，令牌最小授权并设有效期，
令牌明文存在本机浏览器 LocalStorage，勿在公用设备登录。

## 地址联想、科室库、档案互译（v4）

- **科室库**（导航「🏥 科室库」）：保存医院/科室/医生/地址/专项注意事项，以及「所有预约的通用提醒」。同步到私有仓库的 `presets.json`。
- **新建行程**：选科室后自动填医生、地址、备注（通用提醒 + 科室注意事项）。只覆盖仍是「自动填」的内容，你手改过的不会被覆盖。
- **地址联想**：Places API (New)，限定西班牙、西语；输入 ≥3 个字符并停顿 350 ms 后才请求。
- **档案互译**：Cloud Translation Basic v2（zh-CN ⇄ es）。只发送基础病/过敏/用药/手术/备注，不发送姓名、电话、卡号。对方已有手填内容时不覆盖；译文标「自动翻译 · 请核对」。
- **配置**：Google Cloud 同一项目启用 Places API (New) 与 Cloud Translation API（二者官方均要求开通结算），创建 API 密钥，限制为网址 `hysd718-code.github.io/*` + 仅这两个 API，粘贴到「设置 → Google 地图联想与自动翻译」。建议同时设预算提醒（只通知，不会自动停止扣费）和配额上限。
