# 校园歌手大赛 · 纯静态投票站（部署到 GitHub Pages）

不需要服务器、不需要小程序、不需要买域名。
所有页面都是静态文件，数据直接读写你 GitHub 仓库里的两个 JSON。

---

## 一、五分钟部署

### 1. 建仓库

新建一个 **public** 仓库（私有仓库的 Pages 要付费），把本文件夹里的所有文件传上去：

```
index.html
screen.html
vote.html
admin.html
app/config.js
app/store.js
data/meta.json
data/votes.json
README.md
```

### 2. 开 Pages

仓库 → Settings → Pages → Source 选 **Deploy from a branch** → 分支 `main`、目录 `/ (root)` → Save。

一分钟后地址是：`https://你的用户名.github.io/仓库名/`

### 3. 建令牌（关键一步）

头像 → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token

- **Repository access**：Only select repositories → 只勾这一个仓库
- **Permissions → Repository permissions → Contents**：改成 **Read and write**
- 有效期选最短（1 天或 7 天）
- 生成后复制那串 `github_pat_...`

### 4. 填配置

打开 `app/config.js`，改三行：

```js
owner: '你的用户名',
repo:  '仓库名',
token: 'github_pat_xxxxxxxx',
```

提交后等一分钟 Pages 重新部署，就完事了。

> 不填 token 也能打开页面，但会进入「本地演示模式」：票只存在自己手机上，不会汇总。
> 投票页顶部会有橙色提示。

---

## 二、页面

| 地址 | 用途 |
| --- | --- |
| `/` | 入口导航 |
| `/screen.html` | 大屏（接投影，点一下进全屏） |
| `/vote.html` | 手机投票 |
| `/admin.html` | 后台（口令默认 `8888`，在 config.js 里改） |

---

## 三、这版新增的两个功能

**1. 后台可以设置每人能投几票**

后台 → 「投票规则」→ 每台设备最多可投 __ 票 → 保存。默认 3 票。

**2. 同一个人不能重复投同一位选手**

- 前端点了就不能再点第二次
- 提交时服务端（其实是读写时）会再查一遍：同一设备对同一选手的重复票直接剔除
- 已经投满的设备，再投会被拒绝并提示

票数限制在**投票过程中改也有效**：改成 2 票后，已经投了 3 票的设备不再增加，但历史票不删（想清零用「清空所有投票」）。

---

## 四、现场流程

| 主持人说 | 你点 |
| --- | --- |
| 比赛开始 | 后台 →「比赛进行」，每唱完一位点「下一位 ▶」 |
| 全部唱完，请投票 | 填时长（默认 180 秒）→「开始倒计时并开放」 |
| 时间到 | 「投票截止」 |
| 揭晓评委分 | 「揭晓评委分」→ 反复点「揭下一位」 |
| 揭晓观众票 | 「揭晓观众票」 |
| 最终排名 | 「最终排名」 |

大屏每 3 秒刷新一次，后台一改，大屏跟着变。

---

## 五、必须知道的三件事

**一、token 是公开的。**
前端要写数据，token 就必须在浏览器里，任何人打开源码都能看到。所以：

- 令牌只给它这一个仓库、只给 Contents 权限、有效期尽量短
- **比赛结束立刻去 GitHub 删除这个令牌**（不是改密码，是删令牌）
- 别把这种方案用在有敏感数据的场合

**二、GitHub 会限流。**
带令牌每小时 5000 次请求。大屏 3 秒一次 ≈ 1200 次/小时；投票每人 2 次（读一次写一次）。
按 300 人算：1200 + 600 = 1800 次/小时，够用，但**别把大屏刷新调到 1 秒**。

**三、并发写入靠重试。**
两个人同一秒投票时，后写的会失败一次，程序会自动重读再写（最多 6 次）。
正常不会丢票，但极短时间内上百人同时点，可能有人看到「提交失败，请重试」——点一次就好。

---

## 六、国内访问的现实问题

GitHub Pages 在国内有时慢、偶尔打不开。赛前务必：

1. 用 4G 和校园网各测一次能不能打开
2. 大屏那台电脑提前打开页面，别现场才加载
3. 准备一份截图兜底：万一打不开，就放提前录好的大屏录屏

如果学校网络实在打不开 GitHub，这套东西也可以放到任何静态托管上（Gitee Pages、Vercel、Netlify），改配置里的 `owner/repo` 即可——但那些平台的 API 不一样，需要改 `app/store.js` 里的两个地址。真要换平台跟我说一声。

---

## 七、目录

```
index.html       入口
screen.html      大屏
vote.html        投票（支持每人 N 票、不可重复投同一人）
admin.html       后台
app/config.js    配置：仓库、令牌、口令、轮询间隔
app/store.js     数据层：GitHub 读写 + 冲突重试 + 计分
data/meta.json   选手、状态、权重、每人票数
data/votes.json  每一票（fp / pid / ts）
```

比赛结束后，`data/votes.json` 就是完整投票记录，可以直接下载存档。
