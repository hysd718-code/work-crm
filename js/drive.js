// Google Drive：GIS 令牌模型 + Drive REST v3（scope = drive.file）
// 目录结构：Work_CRM_Storage / <客户拼音> / <重命名后的文件>
import { state, saveSettings } from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_NAME = 'Work_CRM_Storage';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
let accessToken = null;
let expiresAt = 0;

export const driveConfigured = () => !!state.settings.googleClientId;

function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = res;
    s.onerror = () => rej(new Error('无法加载 Google 登录脚本（离线或被拦截）'));
    document.head.appendChild(s);
  });
}

// 必须由用户点击触发（弹窗限制）；令牌约 1 小时有效，过期后下一次操作会重新弹窗授权
export async function getToken(forcePrompt = false) {
  if (!driveConfigured()) throw new Error('请先在「设置」中填写 Google OAuth 客户端 ID');
  if (!forcePrompt && accessToken && Date.now() < expiresAt) return accessToken;
  await loadGsi();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: state.settings.googleClientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error('Google 授权失败：' + (r.error_description || r.error)));
        accessToken = r.access_token;
        expiresAt = Date.now() + ((r.expires_in || 3600) - 60) * 1000;
        resolve(accessToken);
      },
      error_callback: (e) => reject(new Error('授权窗口被关闭或被浏览器拦截：' + (e?.type || ''))),
    });
    client.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

async function api(path, opt = {}, retry = true) {
  const token = await getToken();
  const r = await fetch(path, { ...opt, headers: { ...(opt.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401 && retry) { accessToken = null; return api(path, opt, false); }
  if (!r.ok) {
    let m = '';
    try { m = (await r.json()).error?.message || ''; } catch { /* ignore */ }
    const err = new Error(`Drive 请求失败 (${r.status}) ${m}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findFolder(name, parentId) {
  const query = `name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false and '${parentId}' in parents`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`);
  return (await r.json()).files?.[0]?.id || null;
}
async function createFolder(name, parentId) {
  const r = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return (await r.json()).id;
}
async function ensureFolder(name, parentId) {
  return (await findFolder(name, parentId)) || (await createFolder(name, parentId));
}

// 返回客户文件夹 ID；会缓存根目录 ID（settings）与客户目录 ID（client.driveFolderId，随 JSON 同步）
export async function ensureClientFolder(client, { fresh = false } = {}) {
  let root = fresh ? null : state.settings.driveRootId;
  if (!root) { root = await ensureFolder(ROOT_NAME, 'root'); saveSettings({ driveRootId: root }); }
  if (!fresh && client.driveFolderId) return client.driveFolderId;
  const id = await ensureFolder(client.pinyin || 'UNKNOWN', root);
  client.driveFolderId = id;
  return id;
}

export async function uploadFile(file, name, folderId) {
  const boundary = 'crm' + Math.random().toString(36).slice(2);
  const meta = { name, parents: [folderId] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ]);
  const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.json();
}

export async function fetchBlob(fileId) {
  const r = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return r.blob();
}

export async function trashFile(fileId) {
  await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}
