/**
 * 校园歌手大赛 · H5 投票与大屏服务
 * 纯 Node.js，零依赖，数据存本地 JSON 文件。
 * 启动：node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ------------------------------------------------------------------ 数据 */

function defaultDB() {
  const players = [];
  const demo = [
    ['林小满', '夜空中最亮的星', '计算机 2301'],
    ['陈鹿', '起风了', '软件 2302'],
    ['苏禾', '光年之外', '中文 2301'],
    ['周允', '我只在乎你', '法学 2303'],
    ['何一诺', '如愿', '临床 2301'],
    ['沈星野', '海阔天空', '机械 2302'],
    ['许知遥', '慢冷', '新闻 2301'],
    ['白露', '可能', '数学 2301'],
    ['江照', '这世界那么多人', '经济 2302'],
    ['顾南', '山海', '材料 2301'],
    ['温言', '红豆', '英语 2301'],
    ['程野', '生生', '电子 2302'],
  ];
  demo.forEach((d, i) => {
    players.push({
      id: 'p' + (i + 1),
      no: i + 1,
      name: d[0],
      song: d[1],
      class: d[2],
      judges: [],
      votes: 0,
    });
  });
  return {
    config: {
      title: '2026 校园歌手大赛',
      subtitle: '决赛 · 现场投票',
      status: 'idle',
      voteCode: 'A7K2',
      weights: { judge: 0.6, audience: 0.4 },
      judgeCount: 5,
      deadline: 0,
      currentPlayer: 0,
      revealCount: 0,
      votesPerDevice: 1,
      adminPass: 'admin123',
      updatedAt: Date.now(),
    },
    players,
    votes: [],
  };
}

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB(), null, 2), 'utf8');
  }
}

let db = null;
function loadDB() {
  ensureData();
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('数据文件损坏，使用默认数据：', e.message);
    db = defaultDB();
  }
  if (!db.config) db.config = defaultDB().config;
  if (!Array.isArray(db.players)) db.players = [];
  if (!Array.isArray(db.votes)) db.votes = [];
  // 补齐可能缺失的字段
  db.players.forEach((p, i) => {
    if (!p.id) p.id = 'p' + (i + 1) + '_' + Date.now();
    if (typeof p.votes !== 'number') p.votes = 0;
    if (!Array.isArray(p.judges)) p.judges = [];
  });
}

let saving = false;
function saveDB() {
  if (saving) return;
  saving = true;
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('保存失败：', e.message);
  } finally {
    saving = false;
  }
}

/* ------------------------------------------------------------------ 工具 */

function lanIP() {
  const nets = require('os').networkInterfaces();
  let best = '';
  Object.values(nets).forEach((arr) =>
    (arr || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) {
        if (!best || /^192\.168\./.test(n.address)) best = n.address;
      }
    })
  );
  return best;
}

/* 公网地址：优先读 tunnel.url（穿透脚本会写），其次环境变量 PUBLIC_URL */
let pubCache = { v: '', t: 0 };
function publicUrl() {
  if (Date.now() - pubCache.t < 2000) return pubCache.v;
  let v = '';
  try {
    const f = path.join(ROOT, 'tunnel.url');
    if (fs.existsSync(f)) v = fs.readFileSync(f, 'utf8').trim();
  } catch (e) {}
  if (!v) v = process.env.PUBLIC_URL || '';
  pubCache.v = v.replace(/\/+$/, '');
  pubCache.t = Date.now();
  return pubCache.v;
}

const STATUSES = ['idle', 'running', 'voting', 'closed', 'reveal_judge', 'reveal_audience', 'final'];

function avg(arr) {
  const a = (arr || []).filter((x) => typeof x === 'number' && !isNaN(x));
  if (!a.length) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function computeScreen() {
  const c = db.config;
  const w = c.weights || { judge: 0.6, audience: 0.4 };
  const rows = db.players.map((p) => ({
    id: p.id,
    no: p.no,
    name: p.name,
    song: p.song,
    class: p.class,
    votes: p.votes || 0,
    judgeAvg: round1(avg(p.judges)),
  }));

  const maxJudge = Math.max(0, ...rows.map((r) => r.judgeAvg));
  const maxVotes = Math.max(0, ...rows.map((r) => r.votes));

  rows.forEach((r) => {
    r.judgeNorm = maxJudge > 0 ? round1((r.judgeAvg / maxJudge) * 100) : 0;
    r.voteNorm = maxVotes > 0 ? round1((r.votes / maxVotes) * 100) : 0;
    r.final = round1(r.judgeNorm * w.judge + r.voteNorm * w.audience);
  });

  const byVotes = rows.slice().sort((a, b) => b.votes - a.votes || a.no - b.no);
  byVotes.forEach((r, i) => (r.voteRank = i + 1));

  const byJudge = rows.slice().sort((a, b) => b.judgeAvg - a.judgeAvg || a.no - b.no);

  const byFinal = rows.slice().sort((a, b) => b.final - a.final || b.judgeAvg - a.judgeAvg || a.no - b.no);
  byFinal.forEach((r, i) => (r.rank = i + 1));

  const totalVotes = rows.reduce((s, r) => s + r.votes, 0);
  const now = Date.now();
  const remain = c.deadline && c.deadline > now ? c.deadline - now : 0;

  return {
    title: c.title,
    subtitle: c.subtitle,
    status: c.status,
    voteCode: c.voteCode,
    weights: w,
    judgeCount: c.judgeCount,
    currentPlayer: c.currentPlayer || 0,
    revealCount: c.revealCount || 0,
    remainMs: remain,
    deadline: c.deadline || 0,
    totalVotes,
    voteUrl: '/vote',
    lanUrl: 'http://' + (lanIP() || 'localhost') + ':' + PORT + '/vote',
    publicUrl: publicUrl() ? publicUrl() + '/vote' : '',
    bench: byJudge.map((r) => r.id),
    players: rows.map((r) => {
      const bv = byVotes.find((x) => x.id === r.id);
      const bf = byFinal.find((x) => x.id === r.id);
      return Object.assign({}, r, { voteRank: bv.voteRank, rank: bf.rank });
    }),
    order: {
      votes: byVotes.map((r) => r.id),
      final: byFinal.map((r) => r.id),
      judge: byJudge.map((r) => r.id),
      no: rows.slice().sort((a, b) => a.no - b.no).map((r) => r.id),
    },
    serverTime: now,
  };
}

function publicState() {
  const s = computeScreen();
  return {
    title: s.title,
    subtitle: s.subtitle,
    status: s.status,
    remainMs: s.remainMs,
    deadline: s.deadline,
    players: s.players.map((p) => ({
      id: p.id,
      no: p.no,
      name: p.name,
      song: p.song,
      class: p.class,
      votes: p.votes,
    })),
  };
}

/* ------------------------------------------------------------------ 鉴权 */

const tokens = new Map();
const TOKEN_TTL = 8 * 3600 * 1000;

function issueToken() {
  const t = crypto.randomBytes(18).toString('hex');
  tokens.set(t, Date.now() + TOKEN_TTL);
  return t;
}

/* 只允许在本机/局域网访问后台，避免公网穿透后别人点开后台 */
function isLocalRequest(req) {
  const h = String(req.headers.host || '').split(':')[0].replace(/[\[\]]/g, '');
  if (!h) return true;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function authed(req) {
  const t = req.headers['x-token'];
  if (!t || !tokens.has(t)) return false;
  if (tokens.get(t) < Date.now()) {
    tokens.delete(t);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ HTTP */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  const map = {
    '/': 'index.html',
    '/vote': 'vote.html',
    '/screen': 'screen.html',
    '/admin': 'admin.html',
  };
  if ((urlPath === '/admin' || urlPath === '/admin.html') && !isLocalRequest(req)) {
    return send(res, 403, '<meta charset="utf-8"><body style="font:16px/1.8 system-ui;padding:60px">'
      + '<h2>后台不对外开放</h2><p>请在现场那台电脑上打开 http://localhost:8080/admin 进行控制。</p></body>',
      { 'Content-Type': 'text/html; charset=utf-8' });
  }

  let rel = map[urlPath] || urlPath.replace(/^\/+/, '');
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) {
      send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

async function handleAPI(req, res, urlPath) {
  const m = req.method;

  /* 后台相关接口一律只允许本机/局域网访问（公网穿透时也要挡住） */
  if (urlPath.startsWith('/api/admin/') && !isLocalRequest(req)) {
    return json(res, 403, { ok: false, msg: '后台只能在现场那台电脑上使用' });
  }

  /* ---------- 公开接口 ---------- */

  if (urlPath === '/api/state' && m === 'GET') return json(res, 200, publicState());

  if (urlPath === '/api/screen' && m === 'GET') return json(res, 200, computeScreen());

  if (urlPath === '/api/vote' && m === 'POST') {
    const c = db.config;
    const body = await readBody(req);
    const pid = String(body.playerId || '');
    const code = String(body.code || '').trim().toUpperCase();
    const fp = String(body.fp || '').slice(0, 64);

    if (c.status !== 'voting') return json(res, 200, { ok: false, msg: '投票尚未开始或已结束' });
    if (c.deadline && Date.now() > c.deadline) return json(res, 200, { ok: false, msg: '投票已截止' });
    if (!fp) return json(res, 200, { ok: false, msg: '设备标识缺失，请刷新页面重试' });
    if (code !== String(c.voteCode || '').toUpperCase()) return json(res, 200, { ok: false, msg: '口令不对，看一下大屏上的四个字' });

    const player = db.players.find((p) => p.id === pid);
    if (!player) return json(res, 200, { ok: false, msg: '选手不存在' });

    const limit = c.votesPerDevice || 1;
    const mine = db.votes.filter((v) => v.fp === fp);
    if (mine.length >= limit) return json(res, 200, { ok: false, msg: '这台设备已经投过票了' });

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0];
    db.votes.push({ fp, pid, ts: Date.now(), ip });
    player.votes = (player.votes || 0) + 1;
    saveDB();
    return json(res, 200, { ok: true, name: player.name, votes: player.votes });
  }

  /* ---------- 管理接口 ---------- */

  if (urlPath === '/api/admin/login' && m === 'POST') {
    const body = await readBody(req);
    if (String(body.pass || '') !== String(db.config.adminPass)) {
      await new Promise((r) => setTimeout(r, 400)); // 简单节流
      return json(res, 200, { ok: false, msg: '密码不对' });
    }
    return json(res, 200, { ok: true, token: issueToken() });
  }

  if (urlPath.startsWith('/api/admin/') && !authed(req)) {
    return json(res, 401, { ok: false, msg: '登录已失效，请重新登录' });
  }

  if (urlPath === '/api/admin/db' && m === 'GET') {
    return json(res, 200, { ok: true, config: db.config, players: db.players, voteCount: db.votes.length });
  }

  if (urlPath === '/api/admin/config' && m === 'POST') {
    const body = await readBody(req);
    const c = db.config;
    const p = body.patch || body;
    if (p.status !== undefined) {
      if (!STATUSES.includes(p.status)) return json(res, 200, { ok: false, msg: '未知状态' });
      c.status = p.status;
      if (p.status === 'voting') c.revealCount = 0;
      if (p.status === 'final' || p.status === 'reveal_judge') c.revealCount = 0;
    }
    if (p.title !== undefined) c.title = String(p.title).slice(0, 60);
    if (p.subtitle !== undefined) c.subtitle = String(p.subtitle).slice(0, 60);
    if (p.voteCode !== undefined) c.voteCode = String(p.voteCode).toUpperCase().slice(0, 8);
    if (p.deadline !== undefined) c.deadline = Number(p.deadline) || 0;
    if (p.durationSec !== undefined && p.durationSec > 0) c.deadline = Date.now() + Number(p.durationSec) * 1000;
    if (p.weights !== undefined) {
      const j = Number(p.weights.judge);
      const a = Number(p.weights.audience);
      if (isFinite(j) && isFinite(a) && j >= 0 && a >= 0 && j + a > 0) {
        const s = j + a;
        c.weights = { judge: Math.round((j / s) * 1000) / 1000, audience: Math.round((a / s) * 1000) / 1000 };
      }
    }
    if (p.judgeCount !== undefined) {
      const n = Math.max(1, Math.min(20, Number(p.judgeCount) || 5));
      c.judgeCount = n;
    }
    if (p.currentPlayer !== undefined) c.currentPlayer = Number(p.currentPlayer) || 0;
    if (p.revealCount !== undefined) c.revealCount = Math.max(0, Number(p.revealCount) || 0);
    if (p.votesPerDevice !== undefined) c.votesPerDevice = Math.max(1, Number(p.votesPerDevice) || 1);
    if (p.adminPass !== undefined && String(p.adminPass).length >= 4) c.adminPass = String(p.adminPass);
    c.updatedAt = Date.now();
    saveDB();
    return json(res, 200, { ok: true, config: c });
  }

  if (urlPath === '/api/admin/players' && m === 'POST') {
    const body = await readBody(req);
    const list = Array.isArray(body.players) ? body.players : [];
    const old = new Map(db.players.map((p) => [p.id, p]));
    const next = list.map((p, i) => {
      const prev = old.get(p.id);
      return {
        id: p.id || 'p' + Date.now() + '_' + i,
        no: Number(p.no) || i + 1,
        name: String(p.name || '').slice(0, 20),
        song: String(p.song || '').slice(0, 40),
        class: String(p.class || '').slice(0, 30),
        judges: Array.isArray(p.judges)
          ? p.judges.map((x) => Number(x) || 0)
          : prev
          ? prev.judges
          : [],
        votes: p.votes !== undefined ? Number(p.votes) || 0 : prev ? prev.votes : 0,
      };
    });
    db.players = next;
    // 清掉指向已删除选手的票（保留记录不影响，但计数要一致）
    const ids = new Set(next.map((p) => p.id));
    db.votes = db.votes.filter((v) => ids.has(v.pid));
    saveDB();
    return json(res, 200, { ok: true, players: db.players });
  }

  if (urlPath === '/api/admin/judge' && m === 'POST') {
    const body = await readBody(req);
    const p = db.players.find((x) => x.id === body.playerId);
    if (!p) return json(res, 200, { ok: false, msg: '选手不存在' });
    p.judges = (body.scores || []).map((x) => (x === '' || x === null ? null : Number(x))).filter((x) => x !== null && !isNaN(x));
    saveDB();
    return json(res, 200, { ok: true, judges: p.judges });
  }

  if (urlPath === '/api/admin/resetVotes' && m === 'POST') {
    db.votes = [];
    db.players.forEach((p) => (p.votes = 0));
    saveDB();
    return json(res, 200, { ok: true });
  }

  if (urlPath === '/api/admin/reset' && m === 'POST') {
    db = defaultDB();
    saveDB();
    return json(res, 200, { ok: true });
  }

  if (urlPath === '/api/admin/export' && m === 'GET') {
    const s = computeScreen();
    const head = ['排名', '序号', '姓名', '曲目', '班级', '评委均分', '观众票数', '评委归一', '观众归一', '总分'];
    const lines = [head.join(',')];
    s.players
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .forEach((p) => {
        lines.push(
          [p.rank, p.no, p.name, p.song, p.class, p.judgeAvg, p.votes, p.judgeNorm, p.voteNorm, p.final]
            .map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v))
            .join(',')
        );
      });
    const csv = '\ufeff' + lines.join('\r\n');
    return send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="scores.csv"',
    });
  }

  return json(res, 404, { ok: false, msg: 'no such api' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = url.pathname;
  if (p.startsWith('/api/')) {
    handleAPI(req, res, p).catch((e) => {
      console.error('API 错误：', e.message);
      json(res, 500, { ok: false, msg: 'server error: ' + e.message });
    });
    return;
  }
  serveStatic(req, res, p);
});

loadDB();
server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips = [];
  Object.values(nets).forEach((arr) =>
    (arr || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    })
  );
  console.log('歌手大赛投票服务已启动');
  console.log('  本机：   http://localhost:' + PORT);
  ips.forEach((ip) => console.log('  局域网： http://' + ip + ':' + PORT));
  console.log('  投票页： /vote    大屏页： /screen    后台： /admin');
  console.log('  后台初始密码：' + db.config.adminPass + '（请在后台修改）');
});
