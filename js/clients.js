// 客户管理：列表 / 表单（姓名=拼音，医疗信息中西双语）/ 档案详情 / 文件上传（拍照或选文件 + 智能重命名 + Google Drive）
import { state, live, getClient, save, remove, hospitalOf, getGeneralNote, clientStatus } from './store.js';
import { EV_TYPES, evType, isPast, openEventDetail } from './calendar.js';
import { $, $$, esc, openModal, confirmDialog, toast, normName, toPinyinName, fileSlug, todayStr, fmtSize, FILE_TYPES, REPORT_KINDS, MED_FIELDS, STATUSES, statusCls, buildFileName } from './util.js';
import * as Drive from './drive.js';
import { hasKey, translate } from './google.js';

let listFilter = { q: '', status: '' };
const kindLabel = (v) => REPORT_KINDS.find((k) => k.v === v)?.l || v;
const typeLabel = (v) => FILE_TYPES.find((t) => t.v === v)?.l.split('（')[0] || v;

/* ================= 列表 ================= */
export function renderClients(root) {
  const all = live('clients');
  const q = listFilter.q.trim().toLowerCase();
  const rows = all
    .filter((c) => !listFilter.status || clientStatus(c).v === listFilter.status)
    .filter((c) => !q || [c.name, c.phone, c.cardNo, c.address].some((v) => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  root.innerHTML = `
  <div class="max-w-4xl mx-auto p-3 md:p-6">
    <div class="flex flex-col sm:flex-row gap-2 mb-3">
      <input id="c-q" class="input" placeholder="搜索 姓名 / 电话 / 医疗卡号" value="${esc(listFilter.q)}">
      <select id="c-st" class="input sm:w-40">
        <option value="">全部状态</option>
        ${STATUSES.map((s) => `<option ${listFilter.status === s.v ? 'selected' : ''}>${s.v}</option>`).join('')}
      </select>
      <button id="c-new" class="btn btn-primary shrink-0 hidden sm:inline-flex">＋ 新建客户</button>
    </div>
    <div class="text-xs text-[#5f6368] mb-2">共 ${rows.length} / ${all.length} 位客户</div>
    <div class="grid gap-2">
      ${rows.map((c) => `
        <a href="#/client/${c.id}" class="card p-3 flex items-center gap-3 hover:shadow-md transition">
          <div class="w-10 h-10 rounded-full bg-[#1a73e8] text-white flex items-center justify-center text-base font-medium shrink-0">${esc((c.name || '?').slice(0, 1))}</div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2"><span class="font-medium truncate">${esc(c.name)}</span><span class="chip ${statusCls(clientStatus(c).v)}">${esc(clientStatus(c).v)}</span></div>
            <div class="text-xs text-[#5f6368] truncate">${esc(c.phone || '')}</div>
          </div>
          <div class="text-xs text-[#5f6368] shrink-0">${(c.files || []).length} 个文件</div>
        </a>`).join('') || `<div class="text-center text-[#5f6368] py-16">暂无客户，点击「＋」新建</div>`}
    </div>
  </div>`;
  $('#c-q', root).oninput = (e) => { listFilter.q = e.target.value; const pos = e.target.selectionStart; renderClients(root); const i = $('#c-q', root); i.focus(); i.setSelectionRange(pos, pos); };
  $('#c-st', root).onchange = (e) => { listFilter.status = e.target.value; renderClients(root); };
  $('#c-new', root).onclick = () => openClientForm(null);
}

/* ================= 新建 / 编辑表单 ================= */
export function openClientForm(client, { prefillName = '', onSaved } = {}) {
  const c = client || { name: prefillName, files: [] };
  const medHtml = MED_FIELDS.map((m) => `
    <div class="mt-3">
      <div class="text-sm font-medium">${m.zh} <span class="text-[#5f6368] font-normal">/ ${m.es}</span></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
        <div><textarea name="${m.k}_zh" class="input" rows="2" placeholder="中文">${esc(c[m.k + '_zh'] || '')}</textarea><div class="text-[11px] text-[#1967d2] min-h-[16px]" data-b="${m.k}_zh"></div></div>
        <div><textarea name="${m.k}_es" class="input" rows="2" placeholder="Español">${esc(c[m.k + '_es'] || '')}</textarea><div class="text-[11px] text-[#1967d2] min-h-[16px]" data-b="${m.k}_es"></div></div>
      </div>
      ${hasKey() ? `<div class="flex gap-3 mt-1 text-xs"><button type="button" class="text-[#1a73e8]" data-re="${m.k}:zh">用中文重译西语</button><button type="button" class="text-[#1a73e8]" data-re="${m.k}:es">用西语重译中文</button></div>` : ''}
    </div>`).join('');

  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium mb-1">${client ? '编辑客户' : '新建客户'}</h2>
    <label class="label">姓名（拼音，姓与名之间留一个空格）*</label>
    <input name="name" class="input uppercase" required placeholder="ZHANG SAN" value="${esc(c.name)}" autocapitalize="characters">
    <div id="name-hint" class="text-xs text-[#5f6368] mt-1">文件名与云端文件夹将写作：<b>${esc(fileSlug(c.name) || 'ZHANG_SAN')}</b>。输入中文会自动转拼音（首字作姓，复姓请手动改）。</div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">跟进状态（自动）</label><div class="input flex items-center" style="background:#f1f3f4"><span class="chip ${statusCls(client ? clientStatus(client).v : '新客户')}">${client ? clientStatus(client).v : '新客户'}</span></div></div>
      <div><label class="label">联系电话 / Teléfono</label><input name="phone" type="tel" class="input" value="${esc(c.phone || '')}"></div>
    </div>
    <label class="label">医疗卡号 / Nº tarjeta sanitaria</label>
    <input name="cardNo" class="input" value="${esc(c.cardNo || '')}">
    <label class="label">地址 / Dirección</label>
    <input name="address" class="input" value="${esc(c.address || '')}">
    <div class="text-sm font-medium mt-5 text-[#1a73e8]">医疗 / 健康档案 · Historial médico</div>
    ${medHtml}
    <div class="flex justify-end gap-2 mt-5">
      <button type="button" class="btn" data-close>取消</button>
      <button type="submit" class="btn btn-primary">保存</button>
    </div>
  </form>`, { wide: true });

  const form = $('form', m.el);
  const nameI = form.elements.name, hint = $('#name-hint', m.el);
  const refreshHint = () => { hint.innerHTML = `文件名与云端文件夹将写作：<b>${esc(fileSlug(nameI.value) || 'ZHANG_SAN')}</b>。输入中文会自动转拼音（首字作姓，复姓请手动改）。`; };
  nameI.oninput = refreshHint;

  /* ---- 中西自动互译：只翻译这几个医疗字段；对方已有手填内容时不覆盖；译文打「自动翻译」标记 ---- */
  const auto = {};
  MED_FIELDS.forEach((mf) => ['zh', 'es'].forEach((s) => { auto[mf.k + '_' + s] = !!c[mf.k + '_' + s + '_auto']; }));
  const badge = (name, txt) => { const b = $(`[data-b="${name}"]`, m.el); if (b) b.textContent = txt; };
  const showBadges = () => Object.keys(auto).forEach((n) => badge(n, auto[n] ? '自动翻译 · 请核对' : ''));
  showBadges();
  const LANG = { zh: 'zh-CN', es: 'es' };
  async function doTranslate(k, from, force) {
    const to = from === 'zh' ? 'es' : 'zh';
    const src = form.elements[k + '_' + from], dst = form.elements[k + '_' + to];
    const text = src.value.trim();
    if (!text || !hasKey()) return;
    if (!force && dst.value.trim() && !auto[dst.name]) return; // 对方是手填的，不覆盖
    if (!navigator.onLine) return badge(dst.name, '离线：联网后点下方「重译」');
    badge(dst.name, '翻译中…');
    try {
      const out = await translate(text, LANG[from], LANG[to]);
      if (src.value.trim() !== text) return showBadges(); // 翻译期间原文又改了，丢弃过期结果
      dst.value = out; auto[dst.name] = true; auto[src.name] = false;
    } catch (e) { toast(e.message, 'error', 5000); }
    showBadges();
  }
  MED_FIELDS.forEach((mf) => ['zh', 'es'].forEach((s) => {
    const ta = form.elements[mf.k + '_' + s];
    ta.addEventListener('input', () => { auto[ta.name] = false; badge(ta.name, ''); });
    ta.addEventListener('focus', () => { ta.dataset.v = ta.value; });
    ta.addEventListener('blur', () => { if (ta.value !== ta.dataset.v) doTranslate(mf.k, s, false); });
  }));
  m.el.querySelectorAll('[data-re]').forEach((b) => {
    b.onclick = async () => {
      const [k, from] = b.dataset.re.split(':');
      const dst = form.elements[k + '_' + (from === 'zh' ? 'es' : 'zh')];
      if (dst.value.trim() && !auto[dst.name] && !(await confirmDialog('对方已有你手填的内容，重译会覆盖它。继续？', { ok: '覆盖重译' }))) return;
      doTranslate(k, from, true);
    };
  });
  nameI.onblur = async () => { // 失焦时规范化；含中文则转拼音
    const v = await toPinyinName(nameI.value);
    if (v) nameI.value = v;
    refreshHint();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const name = (await toPinyinName(f.name)) || normName(f.name);
    if (!name) return toast('请输入拼音姓名', 'error');
    if (live('clients').some((x) => x.id !== c.id && x.name === name)) {
      if (!(await confirmDialog(`已存在同名客户「${name}」。\n同名客户会共用同一个云端文件夹，仍要保存吗？`))) return;
    }
    const flags = Object.fromEntries(Object.entries(auto).map(([n, v]) => [n + '_auto', v]));
    const rec = save('clients', { ...c, ...f, ...flags, name, pinyin: fileSlug(name), files: c.files || [] });
    m.close();
    toast('客户已保存', 'ok');
    onSaved && onSaved(rec);
    if (!client) location.hash = '#/client/' + rec.id;
  };
  if (!client && prefillName) nameI.onblur();
  setTimeout(() => nameI.focus(), 50);
  return m;
}

/* ================= 详情 / 档案 ================= */
const bi = (c, k) => {
  const zh = (c[k + '_zh'] || '').trim(), es = (c[k + '_es'] || '').trim();
  if (!zh && !es) return '—';
  const at = (s) => (c[k + '_' + s + '_auto'] ? ' <span class="text-[10px] px-1 rounded bg-[#e8f0fe] text-[#1967d2]">自动翻译</span>' : '');
  return [zh && `<div><span class="text-[10px] px-1 rounded bg-[#f1f3f4] text-[#5f6368] mr-1">中</span>${esc(zh)}${at('zh')}</div>`, es && `<div><span class="text-[10px] px-1 rounded bg-[#f1f3f4] text-[#5f6368] mr-1">ES</span>${esc(es)}${at('es')}</div>`].filter(Boolean).join('');
};

/* ================= 看诊总结：按年折叠，月份 · 专科 · 医生/医院 · 备注 ================= */
const openYears = new Set(); // 记住展开的年份；null 表示尚未初始化（默认展开最近一年）
let yearsInit = false;

function visitOf(e) {
  const [kind, rid] = (e.presetId || '').split(/:(.*)/s);
  const d = kind === 'd' ? live('doctors').find((x) => x.id === rid) : null;
  const h = d ? hospitalOf(d.hospitalId) : kind === 'h' ? hospitalOf(rid) : null;
  const t = evType(e);
  const spec = t === 'exam' && e.exam ? '检查：' + e.exam : (d && d.specialty) || '—';
  const who = [d && d.name, h && h.name].filter(Boolean).join(' / ') || (e.location || '').split(',')[0].trim() || '—';
  // 备注只显示用户自己加的内容：去掉自动写入的通用提醒、医生注意事项、检查前准备
  const auto = new Set([...getGeneralNote().split('\n'), ...((d && d.note) || '').split('\n')].map((x) => x.trim()).filter(Boolean));
  const note = (e.notes || '').split('\n').map((x) => x.trim())
    .filter((x) => x && !auto.has(x) && !x.startsWith('检查前准备：') && x !== '请携带：居留证件、医疗卡、检查单或病历。').join('；');
  return { month: +e.date.slice(5, 7), year: e.date.slice(0, 4), spec, who, note, color: EV_TYPES[t].color, id: e.id };
}

function summaryHtml(evs) {
  const past = evs.filter((e) => isPast(e));
  if (!past.length) return '<div class="card p-4 text-sm text-[#5f6368]">还没有已结束的行程，看诊记录会在行程结束后自动出现在这里。</div>';
  const byYear = new Map();
  past.map(visitOf).forEach((v) => { if (!byYear.has(v.year)) byYear.set(v.year, []); byYear.get(v.year).push(v); });
  const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a)); // evs 已按日期倒序
  if (!yearsInit) { openYears.add(years[0]); yearsInit = true; }
  return `<div class="card px-4">
    <div class="flex items-center py-3 text-xs text-[#5f6368]"><span class="flex-1">共 ${past.length} 次 · 仅已结束的行程</span></div>
    ${years.map((y) => `<details data-y="${y}" class="border-t border-[#e8eaed]" ${openYears.has(y) ? 'open' : ''}>
      <summary class="flex items-center gap-2 h-12 cursor-pointer font-medium select-none">${y} 年 <span class="text-xs font-normal text-[#5f6368]">${byYear.get(y).length} 次</span></summary>
      <div class="pb-2">${byYear.get(y).map((v) => `<button data-sev="${esc(v.id)}" class="w-full flex gap-2.5 py-2.5 border-t border-[#f1f3f4] text-left">
        <span class="w-11 shrink-0 text-sm font-medium">${v.month}月</span>
        <span class="w-1 rounded shrink-0" style="background:${v.color}"></span>
        <span class="min-w-0 flex-1"><span class="block text-sm font-medium">${esc(v.spec)}</span><span class="block text-[13px] text-[#3c4043]">${esc(v.who)}</span>${v.note ? `<span class="block text-xs text-[#5f6368] mt-0.5">${esc(v.note)}</span>` : ''}</span>
      </button>`).join('')}</div>
    </details>`).join('')}
    <div class="flex gap-3 py-3 border-t border-[#e8eaed] text-[11px] text-[#5f6368]">${Object.values(EV_TYPES).map((t) => `<span><b style="color:${t.color}">▌</b>${t.label}</span>`).join('')}</div>
  </div>`;
}

export function renderClientDetail(root, id) {
  const c = getClient(id);
  if (!c) {
    root.innerHTML = `<div class="p-10 text-center text-[#5f6368]">客户不存在或已删除。<br><a class="text-[#1a73e8]" href="#/clients">返回客户列表</a></div>`;
    return;
  }
  const evs = live('events').filter((e) => e.clientId === id).sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')));
  const files = [...(c.files || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  root.innerHTML = `
  <div class="max-w-4xl mx-auto p-3 md:p-6">
    <a href="#/clients" class="text-sm text-[#1a73e8]">← 客户列表</a>
    <div class="card p-4 mt-2">
      <div class="flex items-start gap-3">
        <div class="w-14 h-14 rounded-full bg-[#1a73e8] text-white flex items-center justify-center text-2xl shrink-0">${esc((c.name || '?').slice(0, 1))}</div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2"><h2 class="text-xl font-medium">${esc(c.name)}</h2><span class="chip ${statusCls(clientStatus(c).v)}" title="${esc(clientStatus(c).why)}">${esc(clientStatus(c).v)}</span><span class="text-xs text-[#5f6368]">${esc(clientStatus(c).why)}</span></div>
          <div class="text-sm text-[#5f6368] mt-0.5">${c.phone ? `<a class="text-[#1a73e8]" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'}</div>
        </div>
        <div class="flex gap-2 shrink-0">
          <button id="d-edit" class="btn btn-sm">编辑</button>
          <button id="d-del" class="btn btn-sm btn-danger">删除</button>
        </div>
      </div>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
        <div><dt class="text-xs text-[#5f6368]">医疗卡号 / Tarjeta sanitaria</dt><dd>${esc(c.cardNo) || '—'}</dd></div>
        <div><dt class="text-xs text-[#5f6368]">地址 / Dirección</dt><dd>${esc(c.address) || '—'}</dd></div>
      </dl>
    </div>

    <h3 class="text-sm font-medium text-[#1a73e8] mt-5 mb-2">医疗 / 健康档案 · Historial médico</h3>
    <div class="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      ${MED_FIELDS.map((m) => `<div class="${m.k === 'notes' ? 'sm:col-span-2' : ''}"><div class="text-xs text-[#5f6368]">${m.zh} / ${m.es}</div><div class="whitespace-pre-line">${bi(c, m.k)}</div></div>`).join('')}
    </div>

    <h3 class="text-sm font-medium text-[#1a73e8] mt-5 mb-2">文件库（Google Drive）</h3>
    <div class="card p-4">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label class="label !mt-0">文件类型</label><select id="up-type" class="input">${FILE_TYPES.map((t) => `<option value="${t.v}">${t.l}</option>`).join('')}</select></div>
        <div id="up-kind-wrap"><label class="label !mt-0">检查类型（仅「检查报告」可选）</label>
          <select id="up-kind" class="input" disabled><option value="">— 选择检查类型 —</option>${REPORT_KINDS.map((k) => `<option value="${k.v}">${k.l}</option>`).join('')}</select></div>
        <div id="up-custom-wrap" class="hidden"><label class="label !mt-0">检查名称（英文/西语）</label><input id="up-custom" class="input" placeholder="例如 Espirometria"></div>
        <div><label class="label !mt-0">日期</label><input id="up-date" type="date" class="input" value="${todayStr()}"></div>
      </div>
      <div class="flex flex-wrap gap-2 mt-3">
        <label class="btn cursor-pointer">📷 拍照<input id="up-cam" type="file" accept="image/*" capture="environment" class="hidden"></label>
        <label class="btn cursor-pointer">🖼️ 相册 / 文件<input id="up-file" type="file" accept="application/pdf,image/*" class="hidden"></label>
        <button id="up-btn" class="btn btn-primary" type="button" disabled>上传</button>
      </div>
      <div id="up-picked" class="text-xs text-[#5f6368] mt-2"></div>
      <div id="up-preview" class="text-xs text-[#1a73e8] mt-1 break-all"></div>
      <div class="mt-3 divide-y divide-[#e8eaed]">
        ${files.map((f) => `
        <div class="py-2.5 flex items-center gap-3">
          <div class="text-xl">${(f.mime || '').includes('pdf') ? '📄' : '🖼️'}</div>
          <div class="min-w-0 flex-1">
            <div class="text-sm truncate" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="text-xs text-[#5f6368]">${esc(typeLabel(f.type))}${f.sub ? ' · <b>' + esc(kindLabel(f.sub)) + '</b>' : ''} · ${esc(f.date)}${f.size ? ' · ' + fmtSize(+f.size) : ''}</div>
          </div>
          <button class="btn btn-sm" data-f="view" data-id="${f.id}">预览</button>
          <button class="btn btn-sm" data-f="dl" data-id="${f.id}">下载</button>
          <button class="btn btn-sm btn-danger" data-f="rm" data-id="${f.id}">删</button>
        </div>`).join('') || '<div class="text-sm text-[#5f6368] py-4 text-center">尚未上传文件</div>'}
      </div>
    </div>

    <h3 class="text-sm font-medium text-[#1a73e8] mt-5 mb-2">看诊总结</h3>
    ${summaryHtml(evs)}
    <h3 class="text-sm font-medium text-[#1a73e8] mt-5 mb-2">相关行程（${evs.length}）</h3>
    <div class="card divide-y divide-[#e8eaed] mb-10">
      ${evs.map((e) => `<a href="#/calendar?d=${e.date}" class="flex gap-3 p-3 text-sm hover:bg-[#f8f9fa]"><span class="text-[#5f6368] w-24 shrink-0">${esc(e.date)}</span><span class="w-24 shrink-0">${e.allDay ? '全天' : esc(e.start) + '–' + esc(e.end)}</span><span class="truncate">${esc(e.location || e.notes || '')}</span></a>`).join('') || '<div class="p-4 text-sm text-[#5f6368] text-center">暂无行程</div>'}
    </div>
  </div>`;

  $('#d-edit', root).onclick = () => openClientForm(c);
  $('#d-del', root).onclick = async () => {
    if (!(await confirmDialog(`确定删除客户「${c.name}」？\n其已关联的行程会保留但显示为已删除客户。\nDrive 中的文件不会被删除。`, { ok: '删除', danger: true }))) return;
    remove('clients', c.id);
    toast('已删除');
    location.hash = '#/clients';
  };
  $$('details[data-y]', root).forEach((d) => d.addEventListener('toggle', () => { d.open ? openYears.add(d.dataset.y) : openYears.delete(d.dataset.y); }));
  $$('[data-sev]', root).forEach((b) => { b.onclick = () => openEventDetail(b.dataset.sev); });
  bindUpload(root, c);
  $$('[data-f]', root).forEach((b) => (b.onclick = () => fileAction(c, b.dataset.f, b.dataset.id)));
}

/* ================= 上传：拍照/选文件 + 智能重命名 ================= */
const SHRINK_OVER = 1.5 * 1048576;
const isShrinkable = (f) => f.type.startsWith('image/') && f.size >= SHRINK_OVER;

// 手机拍照原图常有 3–8 MB：超过 1.5 MB 的图片缩到长边 2200px、JPEG 质量 0.88（PDF 与小图保持原样）
async function maybeShrink(file) {
  if (!isShrinkable(file)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

function bindUpload(root, c) {
  const el = (id) => $(id, root);
  const typeI = el('#up-type'), kindI = el('#up-kind'), customI = el('#up-custom'), dateI = el('#up-date'), btn = el('#up-btn');
  const camI = el('#up-cam'), fileI = el('#up-file'), picked = el('#up-picked'), prev = el('#up-preview');
  let file = null;

  const extOf = (f) => (isShrinkable(f) ? 'jpg' : (f.name.split('.').pop() || (f.type.includes('pdf') ? 'pdf' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin');
  const subValue = () => {
    if (typeI.value !== 'Resultados_Informe') return '';
    if (kindI.value !== 'Otros') return kindI.value;
    return customI.value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
  };
  const nameFor = (f) => {
    const ext = extOf(f);
    let name = buildFileName(c.pinyin || fileSlug(c.name), dateI.value || todayStr(), typeI.value, ext, subValue());
    const taken = new Set((c.files || []).map((x) => x.name));
    if (taken.has(name)) { // 同名自动加序号
      const base = name.replace(/\.[^.]+$/, ''); let n = 2;
      while (taken.has(`${base}_${n}.${ext}`)) n++;
      name = `${base}_${n}.${ext}`;
    }
    return name;
  };
  const refresh = () => {
    const isReport = typeI.value === 'Resultados_Informe';
    kindI.disabled = !isReport; // 非「检查报告」时检查类型不可用并清空
    if (!isReport) kindI.value = '';
    el('#up-custom-wrap').classList.toggle('hidden', !(isReport && kindI.value === 'Otros'));
    btn.disabled = !file;
    picked.textContent = file ? `已选择：${file.name}（${fmtSize(file.size)}）${isShrinkable(file) ? ' · 上传前会压缩为 JPEG' : ''}` : '';
    prev.textContent = file ? `将保存为：Work_CRM_Storage / ${c.pinyin} / ${nameFor(file)}` : '';
  };
  [typeI, kindI, customI, dateI].forEach((x) => x.addEventListener('input', refresh));
  const pick = (input, other) => input.addEventListener('change', () => { file = input.files[0] || null; other.value = ''; refresh(); });
  pick(camI, fileI); pick(fileI, camI);

  btn.onclick = async () => {
    if (!file) return;
    if (!/^(application\/pdf|image\/)/.test(file.type)) return toast('仅支持 PDF 和图片', 'error');
    if (typeI.value === 'Resultados_Informe' && !kindI.value) return toast('请选择检查类型（验血、彩超、CT…）', 'error');
    if (typeI.value === 'Resultados_Informe' && kindI.value === 'Otros' && !subValue()) return toast('请填写检查名称', 'error');
    btn.disabled = true; btn.textContent = '上传中…';
    try {
      const f2 = await maybeShrink(file);
      const name = nameFor(f2);
      let meta;
      try {
        meta = await Drive.uploadFile(f2, name, await Drive.ensureClientFolder(c));
      } catch (err) {
        if (err.status !== 404) throw err; // 缓存的文件夹 ID 失效 → 重建后重试一次
        meta = await Drive.uploadFile(f2, name, await Drive.ensureClientFolder(c, { fresh: true }));
      }
      const latest = getClient(c.id) || c;
      latest.files = [...(latest.files || []), { id: meta.id, name, type: typeI.value, sub: subValue(), date: dateI.value || todayStr(), mime: meta.mimeType || f2.type, size: meta.size || f2.size, link: meta.webViewLink || '', uploadedAt: new Date().toISOString() }];
      latest.driveFolderId = c.driveFolderId;
      save('clients', latest);
      toast('已上传：' + name, 'ok');
    } catch (err) {
      toast(err.message, 'error', 5000);
      btn.disabled = false; btn.textContent = '上传';
    }
  };
}

/* ================= 文件：预览 / 下载 / 删除 ================= */
async function fileAction(c, action, fid) {
  const f = (c.files || []).find((x) => x.id === fid);
  if (!f) return;
  try {
    if (action === 'view') {
      const w = window.open('', '_blank'); // 先同步开窗，避免异步后被拦截
      try {
        const blob = await Drive.fetchBlob(fid);
        const url = URL.createObjectURL(new Blob([blob], { type: f.mime || blob.type }));
        if (w) w.location.href = url; else location.href = url;
      } catch (e) { w && w.close(); throw e; }
    } else if (action === 'dl') {
      const blob = await Drive.fetchBlob(fid);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } else if (action === 'rm') {
      if (!(await confirmDialog(`删除文件「${f.name}」？\n云端 Drive 中的文件会移入回收站。`, { ok: '删除', danger: true }))) return;
      try { await Drive.trashFile(fid); } catch (e) { if (e.status !== 404) throw e; }
      const latest = getClient(c.id);
      latest.files = latest.files.filter((x) => x.id !== fid);
      save('clients', latest);
      toast('已删除');
    }
  } catch (e) {
    toast(e.message, 'error', 5000);
  }
}
