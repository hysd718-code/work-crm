// 本地状态 + LocalStorage 缓存。每条记录带 id / updatedAt / deleted（墓碑），便于双向合并同步。
import { uid } from './util.js';

const K = {
  clients: 'crm.clients.v1',
  events: 'crm.events.v1',
  presets: 'crm.presets.v1',
  hospitals: 'crm.hospitals.v1',
  doctors: 'crm.doctors.v1',
  settings: 'crm.settings.v1',
  meta: 'crm.meta.v1',
};
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

export const state = {
  clients: load(K.clients, []),
  events: load(K.events, []),
  presets: load(K.presets, []), // 仅保存 id='general'（所有预约通用提醒）；旧版「科室」记录会被迁移成医院+医生
  hospitals: load(K.hospitals, []), // {id,name,address,phone,hours,other}
  doctors: load(K.doctors, []), // {id,name,specialty,hospitalId,times,note,other}
  settings: {
    token: '', repo: '', branch: 'main', dir: 'data',
    googleClientId: '', googleApiKey: '', driveRootId: '', autoSync: true,
    ...load(K.settings, {}),
  },
  meta: load(K.meta, { lastSync: null }),
};

const persist = (col) => localStorage.setItem(K[col], JSON.stringify(state[col]));
const notify = () => window.dispatchEvent(new Event('crm:render'));

export const live = (col) => state[col].filter((r) => !r.deleted);
export const getClient = (id) => live('clients').find((c) => c.id === id);

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
export const composeNotes = (p) => [getGeneralNote(), p && p.note].map((x) => (x || '').trim()).filter(Boolean).join('\n');

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
  localStorage.setItem(K.settings, JSON.stringify(state.settings));
}
export function saveMeta(patch) {
  Object.assign(state.meta, patch);
  localStorage.setItem(K.meta, JSON.stringify(state.meta));
}

export function exportAll() {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), clients: state.clients, events: state.events, presets: state.presets, hospitals: state.hospitals, doctors: state.doctors }, null, 2);
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
  notify();
}
export function clearLocal() {
  Object.values(K).forEach((k) => localStorage.removeItem(k));
}
