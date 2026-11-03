// 本地状态 + LocalStorage 缓存。每条记录带 id / updatedAt / deleted（墓碑），便于双向合并同步。
import { uid } from './util.js';
import { isEnc, deriveKey, encryptText, decryptText, makeCheck, verifyCheck, newSalt, DEFAULT_ITER } from './crypto.js';

const K = {
  clients: 'crm.clients.v1',
  events: 'crm.events.v1',
  presets: 'crm.presets.v1',
  hospitals: 'crm.hospitals.v1',
  doctors: 'crm.doctors.v1',
  exams: 'crm.exams.v1',
  settings: 'crm.settings.v1',
  meta: 'crm.meta.v1',
  lock: 'crm.lock.v1', // 安全锁配置：盐、迭代次数、校验密文、自动锁定分钟数（不含任何密码或密钥）
};
export const COLS = ['clients', 'events', 'presets', 'hospitals', 'doctors', 'exams'];
// 已加密的内容在未解锁时读不出来，先当作空；解锁后由 unlockStore 填入
const load = (k, d) => {
  const v = localStorage.getItem(k);
  if (v == null || isEnc(v)) return d;
  try { return JSON.parse(v) ?? d; } catch { return d; }
};

export const state = {
  clients: load(K.clients, []),
  events: load(K.events, []),
  presets: load(K.presets, []), // 仅保存 id='general'（所有预约通用提醒）；旧版「科室」记录会被迁移成医院+医生
  hospitals: load(K.hospitals, []), // {id,name,address,phone,hours,other}
  exams: load(K.exams, []), // {id,name,nameEs,prep,other} 检查项目库
  doctors: load(K.doctors, []), // {id,name,specialty,hospitalId,times,note,other}
  settings: {
    token: '', repo: '', branch: 'main', dir: 'data',
    googleClientId: '', googleApiKey: '', driveRootId: '', autoSync: true,
    ...load(K.settings, {}),
  },
  meta: load(K.meta, { lastSync: null }),
};

/* ================= 安全锁：本机数据加密存放 =================
 * 未启用：和以前一样明文写 LocalStorage。
 * 已启用：写入前用内存里的密钥加密（异步，按顺序排队）；未解锁时一律不写，防止空数据覆盖真实数据。 */
export const getLockCfg = () => { try { return JSON.parse(localStorage.getItem(K.lock)); } catch { return null; } };
let cryptoKey = null;
let writeChain = Promise.resolve();
export const lockEnabled = () => !!getLockCfg();
export const isLocked = () => lockEnabled() && !cryptoKey;
export const getKey = () => cryptoKey;
export const flushWrites = () => writeChain;

function persistRaw(k, value) {
  if (!lockEnabled()) { localStorage.setItem(k, JSON.stringify(value)); return; }
  if (!cryptoKey) return;
  const text = JSON.stringify(value), key = cryptoKey; // 先拍下快照，再排队加密写入
  writeChain = writeChain
    .then(async () => { localStorage.setItem(k, await encryptText(key, text, 'local:' + k)); })
    .catch((e) => console.error('加密写入失败', e));
}
const persist = (col) => persistRaw(K[col], state[col]);
const persistAll = () => { COLS.forEach(persist); persistRaw(K.settings, state.settings); };

async function readStored(key, k, d) {
  const v = localStorage.getItem(k);
  if (v == null) return d;
  if (isEnc(v)) return JSON.parse(await decryptText(key, v, 'local:' + k));
  try { return JSON.parse(v) ?? d; } catch { return d; }
}

// 用密码解锁：成功返回 true，密码不对返回 false
export async function unlockStore(pass) {
  const cfg = getLockCfg();
  if (!cfg) return true;
  const key = await deriveKey(pass, cfg.salt, cfg.iter);
  if (!(await verifyCheck(key, cfg.check))) return false;
  const loaded = {};
  for (const col of COLS) loaded[col] = await readStored(key, K[col], []);
  const st = await readStored(key, K.settings, {});
  for (const col of COLS) state[col] = loaded[col];
  Object.assign(state.settings, st);
  cryptoKey = key;
  persistAll(); // 若有残留的明文项，顺手转成密文
  return true;
}

// 只验证密码、不重新加载数据（"软锁定"后再次解锁用）
export async function verifyPass(pass) {
  const cfg = getLockCfg();
  if (!cfg) return true;
  return verifyCheck(await deriveKey(pass, cfg.salt, cfg.iter), cfg.check);
}

// 启用：remoteCfg 为云端已有的加密设置时，沿用它的盐并验证密码；否则新建
export async function enableLock(pass, remoteCfg = null) {
  let cfg, key;
  if (remoteCfg) {
    key = await deriveKey(pass, remoteCfg.salt, remoteCfg.iter);
    if (!(await verifyCheck(key, remoteCfg.check))) throw new Error('密码与云端已设置的不一致');
    cfg = { v: 1, salt: remoteCfg.salt, iter: remoteCfg.iter, check: remoteCfg.check, idleMin: 10 };
  } else {
    const salt = newSalt();
    key = await deriveKey(pass, salt, DEFAULT_ITER);
    cfg = { v: 1, salt, iter: DEFAULT_ITER, check: await makeCheck(key), idleMin: 10 };
  }
  cryptoKey = key;
  localStorage.setItem(K.lock, JSON.stringify(cfg)); // 先写配置，之后 persist 才走加密分支
  persistAll();
  await writeChain;
}

// 采用云端的新密码（别的设备改了密码之后，本设备输入新密码）
export async function adoptRemoteLock(pass, remoteCfg) {
  const key = await deriveKey(pass, remoteCfg.salt, remoteCfg.iter);
  if (!(await verifyCheck(key, remoteCfg.check))) return false;
  const old = getLockCfg() || {};
  cryptoKey = key;
  localStorage.setItem(K.lock, JSON.stringify({ v: 1, salt: remoteCfg.salt, iter: remoteCfg.iter, check: remoteCfg.check, idleMin: old.idleMin ?? 10 }));
  persistAll();
  await writeChain;
  return true;
}

// 准备新密码（不立即生效）：返回 {cfg, key}；同步成功后再 applyNewLock
export async function prepareNewLock(pass, salt = null) {
  salt = salt || newSalt(); // 上次换密码中途断了的话，沿用同一把盐，这样同一个新密码能解开已改写的那部分云端数据
  const key = await deriveKey(pass, salt, DEFAULT_ITER);
  const old = getLockCfg() || {};
  return { key, cfg: { v: 1, salt, iter: DEFAULT_ITER, check: await makeCheck(key), idleMin: old.idleMin ?? 10 } };
}
export async function applyNewLock({ key, cfg }) {
  cryptoKey = key;
  localStorage.setItem(K.lock, JSON.stringify(cfg));
  persistAll();
  await writeChain;
}
export function setIdleMin(n) {
  const cfg = getLockCfg();
  if (cfg) localStorage.setItem(K.lock, JSON.stringify({ ...cfg, idleMin: n }));
}

const notify = () => window.dispatchEvent(new Event('crm:render'));

export const live = (col) => state[col].filter((r) => !r.deleted);
export const getClient = (id) => live('clients').find((c) => c.id === id);

// 跟进状态由行程自动判定（不手选）：
//  新客户 = 没有任何行程；失联中 = 有行程但最近一年及未来都没有；
//  近一年或未来有行程：只要有「陪同翻译」→ 跟进中；全是「检查」/「无翻译」→ 自行解决
export function clientStatus(c) {
  const evs = live('events').filter((e) => e.clientId === c.id);
  if (!evs.length) return { v: '新客户', why: '还没有任何行程' };
  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
  const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const recent = evs.filter((e) => e.date >= since);
  if (!recent.length) return { v: '失联中', why: '超过一年没有任何行程' };
  if (recent.some((e) => e.type !== 'exam' && e.type !== 'none')) return { v: '跟进中', why: '近一年或未来有陪同翻译行程' };
  return { v: '自行解决', why: '近一年或未来只有「检查」或「无翻译」行程' };
}

export const DEFAULT_GENERAL = '请携带：居留证件、医疗卡、检查单或病历。';
export const getGeneralNote = () => {
  const g = live('presets').find((p) => p.id === 'general');
  return g ? g.text || '' : DEFAULT_GENERAL;
};
export const listHospitals = () => live('hospitals').sort((a, b) => a.name.localeCompare(b.name));
export const hospitalOf = (id) => live('hospitals').find((h) => h.id === id);
export const listDoctors = () => live('doctors').sort((a, b) => (hospitalOf(a.hospitalId)?.name || '').localeCompare(hospitalOf(b.hospitalId)?.name || '') || (a.name || a.specialty).localeCompare(b.name || b.specialty));
export const doctorsOf = (hid) => listDoctors().filter((d) => d.hospitalId === hid);
export const doctorTitle = (d) => [d.name, d.specialty].filter(Boolean).join(' · ') || '（未命名）';
export const doctorLabel = (d) => [doctorTitle(d), hospitalOf(d.hospitalId)?.name].filter(Boolean).join(' · ');

// 旧版「科室库」(hospital/dept/doctor/address/note 一条记录) → 医院 + 医生。用确定性 id，多台设备各自迁移也会合并成同一条
export function migrateLegacyPresets() {
  const old = live('presets').filter((p) => p.id !== 'general' && (p.hospital || p.dept || p.doctor));
  if (!old.length) return;
  for (const p of old) {
    const hname = (p.hospital || '').trim() || '（未填医院）';
    const hid = 'h-' + hname.toLowerCase().replace(/\s+/g, '-');
    const h = state.hospitals.find((x) => x.id === hid && !x.deleted);
    if (!h) save('hospitals', { id: hid, name: hname, address: p.address || '', phone: '', hours: '', other: '' });
    else if (!h.address && p.address) save('hospitals', { ...h, address: p.address });
    save('doctors', { id: 'd-' + p.id, name: p.doctor || '', specialty: p.dept || '', hospitalId: hid, times: '', note: p.note || '', other: '' });
    remove('presets', p.id);
  }
}
export const listExams = () => live('exams').sort((a, b) => a.name.localeCompare(b.name));
const nk = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const examByName = (n) => n && live('exams').find((x) => nk(x.name) === nk(n) || (x.nameEs && nk(x.nameEs) === nk(n)));
// 备注 = 通用提醒 + 医生注意事项 + 检查前准备
export const composeNotes = (p, examPrep = '') => [getGeneralNote(), p && p.note, examPrep && '检查前准备：' + examPrep].map((x) => (x || '').trim()).filter(Boolean).join('\n');

// source: 'local'（用户操作，触发自动同步） | 'sync'
export function save(col, rec, source = 'local') {
  if (!rec.id) rec.id = uid();
  rec.updatedAt = new Date().toISOString();
  const i = state[col].findIndex((x) => x.id === rec.id);
  if (i >= 0) state[col][i] = rec; else state[col].push(rec);
  persist(col);
  window.dispatchEvent(new CustomEvent('crm:changed', { detail: { col, source } }));
  notify();
  return rec;
}

export function remove(col, id) {
  const i = state[col].findIndex((x) => x.id === id);
  if (i < 0) return;
  // 墓碑：仅保留 id，清掉敏感内容，避免已删除数据继续留在 JSON 中
  state[col][i] = { id, deleted: true, updatedAt: new Date().toISOString() };
  persist(col);
  window.dispatchEvent(new CustomEvent('crm:changed', { detail: { col, source: 'local' } }));
  notify();
}

export function replaceAll(col, arr) {
  state[col] = arr;
  persist(col);
}

export function saveSettings(patch) {
  Object.assign(state.settings, patch);
  persistRaw(K.settings, state.settings);
}
export function saveMeta(patch) {
  Object.assign(state.meta, patch);
  localStorage.setItem(K.meta, JSON.stringify(state.meta));
}

export function exportAll() {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), clients: state.clients, events: state.events, presets: state.presets, hospitals: state.hospitals, doctors: state.doctors, exams: state.exams }, null, 2);
}
export function importAll(text) {
  const d = JSON.parse(text);
  if (!Array.isArray(d.clients) || !Array.isArray(d.events)) throw new Error('文件格式不正确');
  const merge = (local, incoming) => {
    const m = new Map(local.map((r) => [r.id, r]));
    for (const r of incoming) { const l = m.get(r.id); if (!l || (r.updatedAt || '') > (l.updatedAt || '')) m.set(r.id, r); }
    return [...m.values()];
  };
  replaceAll('clients', merge(state.clients, d.clients));
  replaceAll('events', merge(state.events, d.events));
  if (Array.isArray(d.presets)) replaceAll('presets', merge(state.presets, d.presets));
  if (Array.isArray(d.hospitals)) replaceAll('hospitals', merge(state.hospitals, d.hospitals));
  if (Array.isArray(d.doctors)) replaceAll('doctors', merge(state.doctors, d.doctors));
  if (Array.isArray(d.exams)) replaceAll('exams', merge(state.exams, d.exams));
  notify();
}
export function clearLocal() {
  Object.values(K).forEach((k) => localStorage.removeItem(k));
  cryptoKey = null;
}

// 彻底删除一位客户在本应用里的全部记录（云端文件夹由调用方另行删除）
export function purgeClient(id, { withEvents = true } = {}) {
  if (withEvents) live('events').filter((e) => e.clientId === id).forEach((e) => remove('events', e.id));
  remove('clients', id);
}
