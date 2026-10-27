// GitHub JSON 双向同步：Contents API（GET 取 sha → 合并 → PUT 带 sha 回写）
// 合并规则：按 id 逐条比较 updatedAt，较新者胜；删除以墓碑(deleted:true)传播。
import { state, replaceAll, saveMeta } from './store.js';

export const syncConfigured = () => !!(state.settings.token && state.settings.repo);

const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const enc = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

function url(name) {
  const s = state.settings;
  const dir = (s.dir || '').replace(/^\/+|\/+$/g, '');
  const path = (dir ? dir + '/' : '') + name;
  return `https://api.github.com/repos/${s.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}
const headers = () => ({
  Authorization: `Bearer ${state.settings.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function getRemote(name) {
  const r = await fetch(`${url(name)}?ref=${encodeURIComponent(state.settings.branch || 'main')}&_=${Date.now()}`, { headers: headers(), cache: 'no-store' });
  if (r.status === 404) return { sha: null, data: [] };
  if (!r.ok) throw new Error(await explain(r));
  const j = await r.json();
  if (!j.content) throw new Error(`${name} 超过 1MB，Contents API 不返回内容；请拆分数据或改用 Git Data API`);
  return { sha: j.sha, data: JSON.parse(dec(j.content)) };
}

async function putRemote(name, data, sha) {
  const body = {
    message: `crm sync: ${name} @ ${new Date().toISOString()}`,
    content: enc(JSON.stringify(data, null, 2)),
    branch: state.settings.branch || 'main',
  };
  if (sha) body.sha = sha;
  const r = await fetch(url(name), { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r;
}

async function explain(r) {
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch { /* ignore */ }
  if (r.status === 401) return 'GitHub 令牌无效或已过期 (401)';
  if (r.status === 403) return `无权限或触发限流 (403)：${msg}`;
  if (r.status === 404) return '仓库/分支不存在，或令牌没有该仓库的访问权限 (404)';
  if (r.status === 409 || r.status === 422) return `写入冲突 (${r.status})：${msg}`;
  return `GitHub 请求失败 (${r.status}) ${msg}`;
}

function merge(local, remote) {
  const m = new Map();
  for (const r of remote) m.set(r.id, r);
  for (const l of local) {
    const r = m.get(l.id);
    if (!r || (l.updatedAt || '') > (r.updatedAt || '')) m.set(l.id, l);
  }
  return [...m.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function syncOne(col, file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, data } = await getRemote(file);
    const merged = merge(state[col], Array.isArray(data) ? data : []);
    replaceAll(col, merged);
    const sortedRemote = JSON.stringify([...(Array.isArray(data) ? data : [])].sort((a, b) => (a.id < b.id ? -1 : 1)));
    if (sha && JSON.stringify(merged) === sortedRemote) return 'same'; // 远端文件不存在时(sha 为空)也要创建，即使内容为空列表
    const r = await putRemote(file, merged, sha);
    if (r.ok) return 'pushed';
    if ((r.status === 409 || r.status === 422) && attempt === 0) continue; // sha 过期：重取再合并一次
    throw new Error(await explain(r));
  }
  throw new Error('同步冲突，请稍后重试');
}

let running = false;
export const isSyncing = () => running;

export async function syncAll() {
  if (!syncConfigured()) throw new Error('请先在「设置」中填写 GitHub 令牌与仓库');
  if (running) return;
  running = true;
  window.dispatchEvent(new Event('crm:sync-start'));
  try {
    await syncOne('clients', 'clients.json');
    await syncOne('events', 'events.json'); // 文件须串行（官方文档要求同一仓库内写入串行）
    await syncOne('presets', 'presets.json');
    saveMeta({ lastSync: new Date().toISOString() });
    window.dispatchEvent(new CustomEvent('crm:sync-end', { detail: { ok: true } }));
    window.dispatchEvent(new Event('crm:render'));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('crm:sync-end', { detail: { ok: false, error: e.message } }));
    throw e;
  } finally {
    running = false;
  }
}
