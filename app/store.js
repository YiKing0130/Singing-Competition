/* ============================================================
 * 数据层：GitHub 仓库当数据库用
 *   - 有 token → 读写仓库里的 data/*.json
 *   - 没 token → 退回 localStorage（本地演示）
 * 所有写入都带「读-改-写 + 冲突重试」，适合几十到几百人投票。
 * ============================================================ */
(function (global) {
  const CFG = global.APP_CONFIG || {};
  const API = 'https://api.github.com';
  const LOCAL_PREFIX = 'sv_local_';

  const isRemote = !!(CFG.token && CFG.owner && CFG.repo && CFG.owner.indexOf('YOUR_') !== 0);

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b64) {
    const clean = b64.replace(/\s/g, '');
    return decodeURIComponent(escape(atob(clean)));
  }

  function headers() {
    return {
      'Authorization': 'Bearer ' + CFG.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  function fileUrl(name) {
    return API + '/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' +
      (CFG.dir ? CFG.dir + '/' : '') + name + '?ref=' + (CFG.branch || 'main') + '&t=' + Date.now();
  }

  async function ghRead(name) {
    const r = await fetch(fileUrl(name), { headers: headers(), cache: 'no-store' });
    if (r.status === 404) return { data: null, sha: null };
    if (r.status === 401 || r.status === 403) {
      throw new Error('GitHub 拒绝了请求（' + r.status + '）：token 无效或没有 Contents 权限');
    }
    if (!r.ok) throw new Error('读取 ' + name + ' 失败：' + r.status);
    const j = await r.json();
    let data = null;
    try { data = JSON.parse(b64decode(j.content || '')); } catch (e) { data = null; }
    return { data: data, sha: j.sha };
  }

  async function ghWrite(name, data, sha, message) {
    const body = {
      message: message || 'update ' + name,
      content: b64encode(JSON.stringify(data, null, 2)),
      branch: CFG.branch || 'main'
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      API + '/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' +
      (CFG.dir ? CFG.dir + '/' : '') + name,
      { method: 'PUT', headers: headers(), body: JSON.stringify(body) }
    );
    if (!r.ok) {
      const t = await r.text();
      const err = new Error('写入 ' + name + ' 失败：' + r.status + ' ' + t.slice(0, 100));
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  /* 本地模式：先看浏览器里有没有，没有就去读仓库里的 data/*.json 当初始值 */
  async function localRead(name) {
    const raw = localStorage.getItem(LOCAL_PREFIX + name);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) {}
    }
    try {
      const r = await fetch('data/' + name, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (e) {}
    return null;
  }
  function localWrite(name, data) {
    localStorage.setItem(LOCAL_PREFIX + name, JSON.stringify(data));
    return true;
  }

  const Store = {
    remote: isRemote,

    async read(name) {
      if (!isRemote) {
        const d = await localRead(name);
        return { data: d, sha: d ? 'local' : null };
      }
      return ghRead(name);
    },

    async write(name, data, sha, message) {
      if (!isRemote) { localWrite(name, data); return true; }
      return ghWrite(name, data, sha, message);
    },

    /**
     * 读 → 改 → 写。mutator 返回 null 表示放弃本次修改。
     * 返回 {ok, data, reason}
     */
    async update(name, mutator, message, tries) {
      const max = tries || 6;
      let lastErr = null;
      for (let i = 0; i < max; i++) {
        let cur = { data: null, sha: null };
        try {
          cur = await this.read(name);
        } catch (e) {
          return { ok: false, reason: e.message };
        }
        const base = cur.data;
        let next;
        try {
          next = mutator(base);
        } catch (e) {
          return { ok: false, reason: e.message };
        }
        if (next === null || next === undefined) {
          return { ok: false, reason: 'rejected' };
        }
        try {
          await this.write(name, next, cur.sha, message);
          return { ok: true, data: next };
        } catch (e) {
          lastErr = e;
          // 409/422 = 有人抢先写了，重读再试
          await sleep(200 + Math.random() * 600 + i * 200);
        }
      }
      return { ok: false, reason: (lastErr && lastErr.message) || '写入冲突，请重试' };
    }
  };

  global.Store = Store;

  /* ---------------- 设备指纹 ---------------- */
  global.deviceFp = function () {
    const key = 'sv_fp';
    let v = localStorage.getItem(key);
    if (!v) {
      v = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(key, v);
    }
    let extra = '';
    try {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#123';
      ctx.fillText('singer-vote', 2, 2);
      extra = c.toDataURL().slice(-20);
    } catch (e) { extra = 'na'; }
    return v + '.' + extra;
  };

  /* ---------------- 计分 ---------------- */
  global.computeScores = function (meta, votes) {
    const list = (meta && meta.players) || [];
    const w = (meta && meta.weights) || { judge: 0.6, audience: 0.4 };
    const count = {};
    (votes || []).forEach(v => { count[v.pid] = (count[v.pid] || 0) + 1; });

    const rows = list.map(p => {
      const js = (p.judges || []).filter(x => typeof x === 'number' && !isNaN(x));
      const judgeAvg = js.length ? js.reduce((a, b) => a + b, 0) / js.length : 0;
      return {
        id: p.id, no: p.no, name: p.name, song: p.song, class: p.class,
        votes: count[p.id] || 0,
        judgeAvg: Math.round(judgeAvg * 10) / 10
      };
    });

    const maxJudge = Math.max(0, ...rows.map(r => r.judgeAvg));
    const maxVotes = Math.max(0, ...rows.map(r => r.votes));

    rows.forEach(r => {
      r.judgeNorm = maxJudge > 0 ? Math.round(r.judgeAvg / maxJudge * 1000) / 10 : 0;
      r.voteNorm = maxVotes > 0 ? Math.round(r.votes / maxVotes * 1000) / 10 : 0;
      r.final = Math.round((r.judgeNorm * w.judge + r.voteNorm * w.audience) * 10) / 10;
    });

    const byVotes = rows.slice().sort((a, b) => b.votes - a.votes || a.no - b.no);
    byVotes.forEach((r, i) => { r.voteRank = i + 1; });

    const byFinal = rows.slice().sort((a, b) =>
      b.final - a.final || b.judgeAvg - a.judgeAvg || a.no - b.no);
    byFinal.forEach((r, i) => { r.rank = i + 1; });

    const totalVotes = rows.reduce((s, r) => s + r.votes, 0);

    return {
      rows,
      totalVotes,
      order: {
        votes: byVotes.map(r => r.id),
        final: byFinal.map(r => r.id),
        no: rows.slice().sort((a, b) => a.no - b.no).map(r => r.id)
      }
    };
  };
})(window);
