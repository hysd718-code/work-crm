// 客户管理：列表 / 表单 / 档案详情 / 文件上传（智能重命名 + Google Drive）
import { state, live, getClient, save, remove } from './store.js';
import { $, $$, esc, openModal, confirmDialog, toast, pinyinUpper, todayStr, fmtSize, FILE_TYPES, STATUSES, statusCls, buildFileName } from './util.js';
import * as Drive from './drive.js';

let listFilter = { q: '', status: '' };

/* ================= 列表 ================= */
export function renderClients(root) {
  const all = live('clients');
  const q = listFilter.q.trim().toLowerCase();
  const rows = all
    .filter((c) => (!listFilter.status || c.status === listFilter.status))
    .filter((c) => !q || [c.name, c.pinyin, c.phone, c.cardNo, c.address].some((v) => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));

  root.innerHTML = `
  <div class="max-w-4xl mx-auto p-3 md:p-6">
    <div class="flex flex-col sm:flex-row gap-2 mb-3">
      <input id="c-q" class="input" placeholder="搜索 姓名 / 拼音 / 电话 / 医疗卡号" value="${esc(listFilter.q)}">
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
            <div class="flex items-center gap-2"><span class="font-medium truncate">${esc(c.name)}</span><span class="chip ${statusCls(c.status)}">${esc(c.status)}</span></div>
            <div class="text-xs text-[#5f6368] truncate">${esc(c.pinyin || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</div>
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
  const c = client || { name: prefillName, status: '新建', files: [] };
  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium mb-1">${client ? '编辑客户' : '新建客户'}</h2>
    <label class="label">姓名 *</label>
    <input name="name" class="input" required value="${esc(c.name)}">
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">拼音（用于文件名/云端文件夹，可手动修改）</label><input name="pinyin" class="input" value="${esc(c.pinyin || '')}"></div>
      <div><label class="label">跟进状态</label><select name="status" class="input">${STATUSES.map((s) => `<option ${c.status === s.v ? 'selected' : ''}>${s.v}</option>`).join('')}</select></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">联系电话</label><input name="phone" type="tel" class="input" value="${esc(c.phone || '')}"></div>
      <div><label class="label">医疗卡号</label><input name="cardNo" class="input" value="${esc(c.cardNo || '')}"></div>
    </div>
    <label class="label">地址</label>
    <input name="address" class="input" value="${esc(c.address || '')}">
    <div class="text-sm font-medium mt-5 mb-1 text-[#1a73e8]">医疗 / 健康档案</div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
      <div><label class="label">基础病</label><textarea name="conditions" class="input">${esc(c.conditions || '')}</textarea></div>
      <div><label class="label">过敏史</label><textarea name="allergies" class="input">${esc(c.allergies || '')}</textarea></div>
      <div><label class="label">用药史</label><textarea name="meds" class="input">${esc(c.meds || '')}</textarea></div>
      <div><label class="label">手术史</label><textarea name="surgeries" class="input">${esc(c.surgeries || '')}</textarea></div>
    </div>
    <label class="label">备注 / 补充说明</label>
    <textarea name="notes" class="input">${esc(c.notes || '')}</textarea>
    <div class="flex justify-end gap-2 mt-5">
      <button type="button" class="btn" data-close>取消</button>
      <button type="submit" class="btn btn-primary">保存</button>
    </div>
  </form>`, { wide: true });

  const form = $('form', m.el);
  const nameI = form.elements.name, pyI = form.elements.pinyin;
  let pyTouched = !!c.pinyin && !!client; // 已有客户默认不覆盖拼音
  pyI.oninput = () => { pyTouched = true; };
  let seq = 0;
  const autoPy = async () => {
    if (pyTouched) return;
    const my = ++seq;
    const p = await pinyinUpper(nameI.value);
    if (my === seq && !pyTouched) pyI.value = p;
  };
  nameI.oninput = autoPy;
  if (!c.pinyin) autoPy();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const name = f.name.trim();
    if (!name) return;
    if (live('clients').some((x) => x.id !== c.id && x.name.trim() === name)) {
      if (!(await confirmDialog(`已存在同名客户「${name}」，仍要保存吗？`))) return;
    }
    const pinyin = (f.pinyin.trim() || (await pinyinUpper(name))).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    const rec = save('clients', { ...c, ...f, name, pinyin, files: c.files || [] });
    m.close();
    toast('客户已保存', 'ok');
    onSaved && onSaved(rec);
    if (!client) location.hash = '#/client/' + rec.id;
  };
  setTimeout(() => nameI.focus(), 50);
  return m;
}

/* ================= 详情 / 档案 ================= */
export function renderClientDetail(root, id) {
  const c = getClient(id);
  if (!c) {
    root.innerHTML = `<div class="p-10 text-center text-[#5f6368]">客户不存在或已删除。<br><a class="text-[#1a73e8]" href="#/clients">返回客户列表</a></div>`;
    return;
  }
  const evs = live('events').filter((e) => e.clientId === id).sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')));
  const medical = [['基础病', c.conditions], ['过敏史', c.allergies], ['用药史', c.meds], ['手术史', c.surgeries]];
  const files = [...(c.files || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  root.innerHTML = `
  <div class="max-w-4xl mx-auto p-3 md:p-6">
    <a href="#/clients" class="text-sm text-[#1a73e8]">← 客户列表</a>
    <div class="card p-4 mt-2">
      <div class="flex items-start gap-3">
        <div class="w-14 h-14 rounded-full bg-[#1a73e8] text-white flex items-center justify-center text-2xl shrink-0">${esc((c.name || '?').slice(0, 1))}</div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2"><h2 class="text-xl font-medium">${esc(c.name)}</h2><span class="chip ${statusCls(c.status)}">${esc(c.status)}</span></div>
          <div class="text-sm text-[#5f6368] mt-0.5">${esc(c.pinyin || '')}</div>
        </div>
        <div class="flex gap-2 shrink-0">
          <button id="d-edit" class="btn btn-sm">编辑</button>
          <button id="d-del" class="btn btn-sm btn-danger">删除</button>
        </div>
      </div>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
        <div><dt class="text-xs text-[#5f6368]">联系电话</dt><dd>${c.phone ? `<a class="text-[#1a73e8]" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'}</dd></div>
        <div><dt class="text-xs text-[#5f6368]">医疗卡号</dt><dd>${esc(c.cardNo) || '—'}</dd></div>
        <div class="sm:col-span-2"><dt class="text-xs text-[#5f6368]">地址</dt><dd>${esc(c.address) || '—'}</dd></div>
      </dl>
    </div>

    <h3 class="text-sm font-medium text-[#1a73e8] mt-5 mb-2">医疗 / 健康档案</h3>
    <div class="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      ${medical.map(([k, v]) => `<div><div class="text-xs text-[#5f6368]">${k}</div><div class="whitespace-pre-line">${esc(v) || '—'}</div></div>`).join('')}
      <div class="sm:col-span-2"><div class="text-xs text-[#5f6368]">备注 / 补充说明</div><div class="whitespace-pre-line">${esc(c.notes) || '—'}</div></div>
    </div>

    <h3 class="text-sm font-medium text-[#1a73e8] mt-5 mb-2">文件库（Google Drive）</h3>
    <div class="card p-4">
      <form id="up-form" class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div><label class="label !mt-0">文件类型</label><select id="up-type" class="input">${FILE_TYPES.map((t) => `<option value="${t.v}">${t.l}</option>`).join('')}</select></div>
        <div><label class="label !mt-0">日期</label><input id="up-date" type="date" class="input" value="${todayStr()}"></div>
        <button id="up-btn" class="btn btn-primary h-10" type="submit" disabled>上传</button>
        <div class="sm:col-span-3"><input id="up-file" type="file" accept="application/pdf,image/*" class="text-sm w-full"></div>
      </form>
      <div id="up-preview" class="text-xs text-[#5f6368] mt-2 break-all"></div>
      <div class="mt-3 divide-y divide-[#e8eaed]">
        ${files.map((f) => `
        <div class="py-2.5 flex items-center gap-3">
          <div class="text-xl">${(f.mime || '').includes('pdf') ? '📄' : '🖼️'}</div>
          <div class="min-w-0 flex-1">
            <div class="text-sm truncate" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="text-xs text-[#5f6368]">${esc(f.type)} · ${esc(f.date)}${f.size ? ' · ' + fmtSize(+f.size) : ''}</div>
          </div>
          <button class="btn btn-sm" data-f="view" data-id="${f.id}">预览</button>
          <button class="btn btn-sm" data-f="dl" data-id="${f.id}">下载</button>
          <button class="btn btn-sm btn-danger" data-f="rm" data-id="${f.id}">删</button>
        </div>`).join('') || '<div class="text-sm text-[#5f6368] py-4 text-center">尚未上传文件</div>'}
      </div>
    </div>

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
  bindUpload(root, c);
  $$('[data-f]', root).forEach((b) => (b.onclick = () => fileAction(c, b.dataset.f, b.dataset.id)));
}

/* ================= 上传：智能重命名 ================= */
function bindUpload(root, c) {
  const fileI = $('#up-file', root), typeI = $('#up-type', root), dateI = $('#up-date', root), btn = $('#up-btn', root), prev = $('#up-preview', root);
  const nameFor = (file) => {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    let name = buildFileName(c.pinyin, dateI.value || todayStr(), typeI.value, ext);
    const taken = new Set((c.files || []).map((f) => f.name));
    if (taken.has(name)) { // 同名自动加序号 _2 _3
      const base = name.replace(/\.[^.]+$/, ''); let n = 2;
      while (taken.has(`${base}_${n}.${ext}`)) n++;
      name = `${base}_${n}.${ext}`;
    }
    return name;
  };
  const refresh = () => {
    const f = fileI.files[0];
    btn.disabled = !f;
    prev.textContent = f ? `将保存为：Work_CRM_Storage / ${c.pinyin} / ${nameFor(f)}` : '';
  };
  [fileI, typeI, dateI].forEach((el) => el.addEventListener('change', refresh));

  $('#up-form', root).onsubmit = async (e) => {
    e.preventDefault();
    const file = fileI.files[0];
    if (!file) return;
    if (!/^(application\/pdf|image\/)/.test(file.type)) return toast('仅支持 PDF 和图片', 'error');
    if (!c.pinyin) return toast('请先为客户设置拼音（编辑客户）', 'error');
    btn.disabled = true; btn.textContent = '上传中…';
    try {
      const name = nameFor(file);
      let meta;
      try {
        meta = await Drive.uploadFile(file, name, await Drive.ensureClientFolder(c));
      } catch (err) {
        if (err.status !== 404) throw err; // 缓存的文件夹 ID 失效 → 重建后重试一次
        meta = await Drive.uploadFile(file, name, await Drive.ensureClientFolder(c, { fresh: true }));
      }
      const latest = getClient(c.id) || c;
      latest.files = [...(latest.files || []), { id: meta.id, name, type: typeI.value, date: dateI.value || todayStr(), mime: meta.mimeType || file.type, size: meta.size || file.size, link: meta.webViewLink || '', uploadedAt: new Date().toISOString() }];
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
