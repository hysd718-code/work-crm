// GitHub JSON 双向同步。
// 读取：先列目录拿到每个文件的 sha，再用 Git Blob 接口读内容（支持到 100 MB；旧的 Contents 接口超过 1 MB 就不返回内容）。
// 写入：Contents 接口 PUT（带 sha），同一仓库内的写入必须串行。
// 合并规则：按 id 逐条比较 updatedAt，较新者胜；删除以墓碑(deleted:true)传播。
// 加密（启用安全锁后）：每条记录单独加密成 {id, updatedAt, enc}，云端看不到姓名、病史、备注；
//   id（随机编号）与 updatedAt（修改时间）仍是明文，用来合并；删除标记 {id, deleted:true, updatedAt} 本来就不含内容。
import { state, replaceAll, saveMeta, lockEnabled, isLocked, getKey, getLockCfg } from './store.js';
import { encryptText, decryptText } from './crypto.js';

export const syncConfigured = () => !!(state.settings.token && state.settings.repo);

const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const enc = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const dirPath = () => (state.settings.dir || '').replace(/^\/+|\/+$/g, '');
const branch = () => state.settings.branch || 'main';
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const api = (path) => `https://api.github.com/repos/${state.settings.repo}/${path}`;
const fileUrl = (name) => api('contents/' + encPath((dirPath() ? dirPath() + '/' : '') + name));
const headers = () => ({
  Authorization: `Bearer ${state.settings.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function explain(r) {
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch { /* ignore */ }
  if (r.status === 401) return 'GitHub 令牌无效或已过期 (401)';
  if (r.status === 403) return `无权限或触发限流 (403)：${msg}`;
  if (r.status === 404) return '仓库/分支不存在，或令牌没有该仓库的访问权限 (404)';
  if (r.status === 409 || r.status === 422) return `写入冲突 (${r.status})：${msg}`;
  return `GitHub 请求失败 (${r.status}) ${msg}`;
}

// 目录清单：文件名 → {sha, size}
async function listDir() {
  const d = dirPath();
  const r = await fetch(`${api('contents' + (d ? '/' + encPath(d) : ''))}?ref=${encodeURIComponent(branch())}&_=${Date.now()}`, { headers: headers(), cache: 'no-store' });
  if (r.status === 404) return new Map();
  if (!r.ok) throw new Error(await explain(r));
  const j = await r.json();
  if (!Array.isArray(j)) return new Map();
  return new Map(j.filter((x) => x.type === 'file').map((x) => [x.name, { sha: x.sha, size: x.size }]));
}

async function readBlob(sha) {
  const r = await fetch(api('git/blobs/' + sha), { headers: headers(), cache: 'no-store' });
  if (!r.ok) throw new Error(await explain(r));
  const j = await r.json();
  return dec(j.content);
}

async function getRemote(name, ctx) {
  const e = ctx.listing.get(name);
  if (!e) return { sha: null, data: [] };
  if (!e.size) return { sha: e.sha, data: [] };
  return { sha: e.sha, data: JSON.parse(await readBlob(e.sha)) };
}

async function putRemote(name, data, sha, compact) {
  const body = {
    message: `crm sync: ${name} @ ${new Date().toISOString()}`,
    content: enc(JSON.stringify(data, null, compact ? 0 : 2)),
    branch: branch(),
  };
  if (sha) body.sha = sha;
  return fetch(fileUrl(name), { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/* ---------------- 加密 / 解密记录 ---------------- */
function cloudError(code, msg, extra = {}) { const e = new Error(msg); e.code = code; Object.assign(e, extra); return e; }

async function openRecords(col, arr, keys) {
  const out = [];
  for (const r of arr) {
    if (r && r.enc !== undefined) {
      if (!keys.length) throw cloudError('CLOUD_ENCRYPTED', '云端数据已加密。请先在「设置 → 安全锁与加密」输入同一个密码启用，再同步。');
      let obj = null;
      for (const key of keys) { // 换密码中途中断时，云端可能新旧密钥的记录并存，两把都试
        try { obj = JSON.parse(await decryptText(key, r.enc, col + ':' + r.id)); break; } catch { /* 试下一把 */ }
      }
      if (!obj) throw cloudError('CLOUD_DECRYPT', '云端数据解密失败：密码不对，或数据被改动过。');
      if (obj.id !== r.id) throw cloudError('CLOUD_DECRYPT', '云端数据校验失败（记录编号不一致）。');
      out.push(obj);
    } else out.push(r);
  }
  return out;
}
const sealRecords = (col, arr, key) => Promise.all(arr.map(async (r) => (r.deleted
  ? { id: r.id, deleted: true, updatedAt: r.updatedAt }
  : { id: r.id, updatedAt: r.updatedAt, enc: await encryptText(key, JSON.stringify(r), col + ':' + r.id) })));
const hasPlainLive = (arr) => arr.some((r) => r && !r.deleted && r.enc === undefined);

/* ---------------- 云端加密设置 crypto.json（盐、迭代次数、校验密文；不含密码） ---------------- */
export async function fetchRemoteCrypto() {
  const listing = await listDir();
  const e = listing.get('crypto.json');
  if (!e || !e.size) return null;
  try { return JSON.parse(await readBlob(e.sha)); } catch { return null; }
}

// phase 'before'：首次创建 / 发现别的设备改了密码；phase 'after'：换密码时，等所有数据都重写完，最后才更新 crypto.json
async function syncCryptoFile(ctx, phase) {
  if (!lockEnabled()) return;
  const rekeying = !!ctx.opts.newCfg;
  const cfg = ctx.opts.newCfg || getLockCfg();
  const pub = { v: 1, salt: cfg.salt, iter: cfg.iter, check: cfg.check };
  const e = ctx.listing.get('crypto.json');
  if (phase === 'before') {
    if (!e) {
      const r = await putRemote('crypto.json', pub, null, false);
      if (!r.ok) throw new Error(await explain(r));
      return;
    }
    if (rekeying) return;
    let remote = null;
    try { remote = JSON.parse(await readBlob(e.sha)); } catch { /* 当作损坏 */ }
    if (remote && remote.salt === cfg.salt && remote.iter === cfg.iter) return;
    throw cloudError('REMOTE_KEY_CHANGED', '云端的加密密码已被更换，请输入新密码。', { remote });
  }
  if (phase === 'after' && rekeying) {
    const cur = (await listDir()).get('crypto.json');
    const r = await putRemote('crypto.json', pub, cur ? cur.sha : null, false);
    if (!r.ok) throw new Error(await explain(r));
  }
}

/* ---------------- 合并与同步 ---------------- */
const byId = (a, b) => (a.id < b.id ? -1 : 1);
function merge(local, remote) {
  const m = new Map();
  for (const r of remote) m.set(r.id, r);
  for (const l of local) {
    const r = m.get(l.id);
    if (!r || (l.updatedAt || '') > (r.updatedAt || '')) m.set(l.id, l);
  }
  return [...m.values()].sort(byId);
}

async function syncOne(col, file, ctx) {
  const encOn = lockEnabled();
  const readKeys = [getKey(), ctx.opts.sealKey].filter(Boolean);
  const sealKey = ctx.opts.sealKey || getKey();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, data } = await getRemote(file, ctx);
    const raw = Array.isArray(data) ? data : [];
    const remote = await openRecords(col, raw, readKeys);
    const merged = merge(state[col], remote);
    replaceAll(col, merged);
    const needUpgrade = encOn && (hasPlainLive(raw) || !!ctx.opts.newCfg); // 云端还有明文，或刚换了密码 → 重写
    const sameAsRemote = JSON.stringify(merged) === JSON.stringify([...remote].sort(byId));
    if (sha && !needUpgrade && sameAsRemote) return 'same'; // 远端文件不存在时(sha 为空)也要创建，即使内容为空列表
    const payload = encOn ? await sealRecords(col, merged, sealKey) : merged;
    const r = await putRemote(file, payload, sha, encOn);
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j?.content?.sha) ctx.listing.set(file, { sha: j.content.sha, size: 1 });
      return 'pushed';
    }
    if ((r.status === 409 || r.status === 422) && attempt === 0) { ctx.listing = await listDir(); continue; } // sha 过期：重取再合并一次
    throw new Error(await explain(r));
  }
  throw new Error('同步冲突，请稍后重试');
}

const FILES = [['clients', 'clients.json'], ['events', 'events.json'], ['presets', 'presets.json'], ['hospitals', 'hospitals.json'], ['doctors', 'doctors.json'], ['exams', 'exams.json']];

let running = false;
export const isSyncing = () => running;

// opts.sealKey/opts.newCfg：换密码时用——用旧密钥读、用新密钥写，并更新 crypto.json
export async function syncAll(opts = {}) {
  if (!syncConfigured()) throw new Error('请先在「设置」中填写 GitHub 令牌与仓库');
  if (isLocked()) throw new Error('应用已锁定，请先解锁');
  if (running) return 'busy';
  running = true;
  window.dispatchEvent(new Event('crm:sync-start'));
  try {
    const ctx = { listing: await listDir(), opts };
    await syncCryptoFile(ctx, 'before');
    for (const [col, file] of FILES) await syncOne(col, file, ctx); // 文件须串行（官方文档要求同一仓库内写入串行）
    await syncCryptoFile(ctx, 'after');
    saveMeta({ lastSync: new Date().toISOString() });
    window.dispatchEvent(new CustomEvent('crm:sync-end', { detail: { ok: true } }));
    window.dispatchEvent(new Event('crm:render'));
    return 'ok';
  } catch (e) {
    window.dispatchEvent(new CustomEvent('crm:sync-end', { detail: { ok: false, error: e.message } }));
    throw e;
  } finally {
    running = false;
  }
}
