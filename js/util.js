// 通用工具：DOM、日期、弹窗、提示、拼音
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayStr = () => ymd(new Date());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const toMin = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
export const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

export function toast(msg, type = 'info', ms = 3200) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  const color = type === 'error' ? 'bg-[#d93025]' : type === 'ok' ? 'bg-[#188038]' : 'bg-[#323232]';
  el.className = `${color} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-[90vw] pointer-events-auto`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// 弹窗：可叠加；全部关闭后触发一次重绘
export function openModal(html, { wide = false, onClose } = {}) {
  const root = $('#modal-root');
  const layer = document.createElement('div');
  layer.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4';
  layer.innerHTML = `<div class="bg-white w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl">${html}</div>`;
  root.appendChild(layer);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    layer.remove();
    onClose && onClose();
    if (!root.childElementCount) window.dispatchEvent(new Event('crm:render'));
  };
  layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(); });
  $$('[data-close]', layer).forEach((b) => (b.onclick = close));
  return { el: layer, close };
}

export function confirmDialog(message, { ok = '确定', cancel = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal(
      `<div class="p-5"><p class="text-[15px] leading-relaxed whitespace-pre-line">${esc(message)}</p>
       <div class="flex justify-end gap-2 mt-5">
         <button class="btn" data-close>${esc(cancel)}</button>
         <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>
       </div></div>`,
      { onClose: () => resolve(result) }
    );
    $('[data-ok]', m.el).onclick = () => { result = true; m.close(); };
  });
}

// ---- 拼音（pinyin-pro 经 CDN 懒加载；失败则退化为去音标的大写字母数字）----
let pp = null;
async function loadPinyin() {
  if (pp !== null) return pp;
  try { pp = await import('https://cdn.jsdelivr.net/npm/pinyin-pro/+esm'); } catch { pp = false; }
  return pp;
}
export async function pinyinUpper(name) {
  const s = (name || '').trim();
  if (!s) return '';
  const lib = await loadPinyin();
  let out = s;
  if (lib && lib.pinyin && /[一-鿿]/.test(s)) {
    try {
      const arr = lib.pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
      out = arr.join('');
    } catch { /* 使用原文 */ }
  }
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export const FILE_TYPES = [
  { v: 'Peticion_Medica', l: 'Peticion_Medica（检查申请单）' },
  { v: 'Resultados_Informe', l: 'Resultados_Informe（检查报告）' },
  { v: 'Receta', l: 'Receta（处方/用药单）' },
  { v: 'ID_Doc', l: 'ID_Doc（证件/医疗卡）' },
  { v: 'Otros', l: 'Otros（其他）' },
];
export const STATUSES = [
  { v: '新建', cls: 'bg-[#e8f0fe] text-[#1967d2]' },
  { v: '跟进中', cls: 'bg-[#fef7e0] text-[#b06000]' },
  { v: '成交', cls: 'bg-[#e6f4ea] text-[#137333]' },
  { v: '暂停', cls: 'bg-[#f1f3f4] text-[#5f6368]' },
];
export const statusCls = (v) => (STATUSES.find((s) => s.v === v) || STATUSES[0]).cls;

export function buildFileName(pinyin, date, type, ext) {
  return `${pinyin || 'UNKNOWN'}_${date.replaceAll('-', '')}_${type}.${ext}`;
}
