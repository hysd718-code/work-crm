// 医院与医生：两个资料库。医院录一次，医生通过下拉选择所属医院（地址/电话/营业时间都取自医院）。
import { live, save, remove, listHospitals, listDoctors, doctorsOf, hospitalOf, doctorTitle } from './store.js';
import { $, esc, openModal, confirmDialog, toast } from './util.js';
import { attachAddress, hasKey } from './google.js';

const GYNE_NOTE = '妇科检查请避开月经期。';
let tab = 'h', q = '';
const hit = (s) => !q || String(s || '').toLowerCase().includes(q.toLowerCase());

export function renderLibrary(root) {
  const hs = listHospitals(), ds = listDoctors();
  const hList = hs.filter((h) => hit([h.name, h.address, h.phone, h.other].join(' ')) || doctorsOf(h.id).some((d) => hit(d.name + d.specialty)));
  const dList = ds.filter((d) => hit([d.name, d.specialty, hospitalOf(d.hospitalId)?.name, d.note].join(' ')));
  const tabBtn = (k, label, n) => `<button data-tab="${k}" class="flex-1 h-12 text-sm font-medium border-b-[3px] ${tab === k ? 'text-[#1967d2] border-[#1a73e8]' : 'text-[#5f6368] border-transparent'}">${label} · ${n}</button>`;

  root.innerHTML = `
  <div class="max-w-2xl mx-auto pb-24">
    <div class="flex border-b border-[#e8eaed] bg-white sticky top-0 z-10">${tabBtn('h', '医院', hs.length)}${tabBtn('d', '医生', ds.length)}</div>
    <div class="p-3 md:p-4 space-y-3">
      <div class="flex gap-2">
        <input id="lib-q" class="input !mt-0" placeholder="搜索名称、专科、地址…" value="${esc(q)}">
        <button id="lib-new" class="btn btn-primary shrink-0">＋ 新增${tab === 'h' ? '医院' : '医生'}</button>
      </div>
      ${tab === 'h' ? (hList.length ? hList.map(hospitalCard).join('') : empty('还没有医院。先点右上「新增医院」。'))
        : (dList.length ? dList.map(doctorCard).join('') : empty(hs.length ? '还没有医生。点右上「新增医生」。' : '请先在「医院」里添加医院，再添加医生。'))}
      ${hasKey() ? '' : '<p class="text-xs text-[#5f6368]">提示：在「设置」填写 Google API 密钥后，地址栏会出现谷歌地图联想。</p>'}
    </div>
  </div>`;

  root.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; renderLibrary(root); }; });
  const qi = $('#lib-q', root);
  qi.oninput = (e) => { q = e.target.value; const pos = qi.selectionStart; renderLibrary(root); const n = $('#lib-q', root); n.focus(); n.setSelectionRange(pos, pos); };
  $('#lib-new', root).onclick = () => (tab === 'h' ? openHospitalForm(null) : openDoctorForm(null));
  root.querySelectorAll('[data-eh]').forEach((b) => { b.onclick = () => openHospitalForm(hospitalOf(b.dataset.eh)); });
  root.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => openDoctorForm(live('doctors').find((d) => d.id === b.dataset.ed)); });
  root.querySelectorAll('[data-add-doc]').forEach((b) => { b.onclick = () => openDoctorForm(null, b.dataset.addDoc); });
}

// 从别处跳转并直接打开某家医院的编辑表单
export function editHospital(id) {
  tab = 'h'; q = '';
  location.hash = '#/library';
  setTimeout(() => { const h = hospitalOf(id); if (h) openHospitalForm(h); }, 50);
}

const empty = (t) => `<div class="card p-6 text-center text-sm text-[#5f6368]">${esc(t)}</div>`;

function hospitalCard(h) {
  const docs = doctorsOf(h.id);
  return `<section class="card p-4">
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0 font-medium break-words">${esc(h.name)}</div>
      <button class="btn btn-sm" data-eh="${esc(h.id)}">编辑</button>
    </div>
    ${h.address ? `<div class="text-sm mt-1.5">📍 <a class="text-[#1a73e8]" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address)}">${esc(h.address)}</a></div>` : ''}
    <div class="text-sm text-[#5f6368] mt-1">${h.phone ? '☎ ' + esc(h.phone) : ''}${h.phone && h.hours ? ' · ' : ''}${h.hours ? '🕘 ' + esc(h.hours) : ''}</div>
    ${h.other ? `<div class="text-sm text-[#5f6368] mt-1 whitespace-pre-line">${esc(h.other)}</div>` : ''}
    <div class="flex flex-wrap items-center gap-1.5 mt-3">
      <span class="text-xs text-[#5f6368]">${docs.length} 位医生</span>
      ${docs.map((d) => `<button class="chip" data-ed="${esc(d.id)}" style="cursor:pointer">${esc(doctorTitle(d))}</button>`).join('')}
      <button class="chip" data-add-doc="${esc(h.id)}" style="cursor:pointer;color:#1967d2">＋ 添加医生</button>
    </div>
  </section>`;
}

function doctorCard(d) {
  const h = hospitalOf(d.hospitalId);
  return `<section class="card p-4">
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0"><div class="font-medium break-words">${esc(d.name || d.specialty || '（未命名）')} ${d.name && d.specialty ? `<span class="chip">${esc(d.specialty)}</span>` : ''}</div>
      <div class="text-sm text-[#5f6368]">${esc(h?.name || '（未选医院）')}</div></div>
      <button class="btn btn-sm" data-ed="${esc(d.id)}">编辑</button>
    </div>
    ${d.times ? `<div class="text-sm mt-1.5">🕘 ${esc(d.times)}</div>` : ''}
    ${d.note ? `<div class="mt-2 text-sm rounded-lg px-3 py-2 whitespace-pre-line" style="background:#fef7e0;color:#6b3d00">${esc(d.note)}</div>` : ''}
    ${d.other ? `<div class="text-sm text-[#5f6368] mt-1 whitespace-pre-line">${esc(d.other)}</div>` : ''}
  </section>`;
}

/* ---------------- 医院表单 ---------------- */
function openHospitalForm(h, onSaved) {
  const x = h || {};
  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium mb-1">${h ? '编辑医院' : '新增医院'}</h2>
    <label class="label">医院 / 诊所名称 *</label>
    <input name="name" class="input" required value="${esc(x.name || '')}">
    <label class="label">地址${hasKey() ? '（输入后选谷歌地图联想）' : ''}</label>
    <input name="address" class="input" value="${esc(x.address || '')}">
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">电话</label><input name="phone" type="tel" class="input" value="${esc(x.phone || '')}"></div>
      <div><label class="label">营业时间</label><input name="hours" class="input" value="${esc(x.hours || '')}" placeholder="周一–周五 8:00–20:00"></div>
    </div>
    <label class="label">其他信息</label>
    <textarea name="other" class="input" rows="3" placeholder="入口、停车、挂号窗口位置等">${esc(x.other || '')}</textarea>
    <div class="flex justify-between gap-2 mt-5">
      <div>${h ? '<button type="button" class="btn btn-danger" data-del>删除</button>' : ''}</div>
      <div class="flex gap-2"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn btn-primary">保存</button></div>
    </div>
  </form>`);
  const form = $('form', m.el);
  attachAddress(form.elements.address);
  const d = $('[data-del]', m.el);
  if (d) d.onclick = async () => {
    const n = doctorsOf(h.id).length;
    if (!(await confirmDialog(n ? `该医院下还有 ${n} 位医生，删除医院后他们会显示「未选医院」。仍要删除？` : '删除这家医院？', { ok: '删除', danger: true }))) return;
    remove('hospitals', h.id); m.close(); toast('已删除');
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const rec = save('hospitals', { ...x, id: x.id, name: f.name.trim(), address: f.address.trim(), phone: f.phone.trim(), hours: f.hours.trim(), other: f.other.trim() });
    m.close(); toast('已保存', 'ok');
    onSaved && onSaved(rec);
  };
}

/* ---------------- 医生表单 ---------------- */
function openDoctorForm(d, presetHospitalId = '') {
  const x = d || {};
  const hid = x.hospitalId || presetHospitalId;
  const optionsHtml = (sel) => listHospitals().map((h) => `<option value="${esc(h.id)}" ${h.id === sel ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium mb-1">${d ? '编辑医生' : '新增医生'}</h2>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">医生姓名</label><input name="name" class="input" value="${esc(x.name || '')}" placeholder="Dra. Puig"></div>
      <div><label class="label">专科</label><input name="specialty" class="input" value="${esc(x.specialty || '')}" placeholder="妇科 Ginecología"></div>
    </div>
    <label class="label">所属医院（从医院库选，不用重写）</label>
    <select name="hospitalId" class="input"><option value="">— 请选择 —</option>${optionsHtml(hid)}<option value="__new">＋ 新建医院…</option></select>
    <label class="label">看诊时间</label>
    <input name="times" class="input" value="${esc(x.times || '')}" placeholder="周二、周四 上午">
    <label class="label">注意事项（新建行程选这位医生时自动写入备注）</label>
    <textarea name="note" class="input" rows="3">${esc(x.note || '')}</textarea>
    <div class="mt-2"><button type="button" class="chip" data-gyne style="cursor:pointer">＋ 插入「${esc(GYNE_NOTE)}」</button></div>
    <label class="label">其他信息</label>
    <textarea name="other" class="input" rows="2">${esc(x.other || '')}</textarea>
    <div class="flex justify-between gap-2 mt-5">
      <div>${d ? '<button type="button" class="btn btn-danger" data-del>删除</button>' : ''}</div>
      <div class="flex gap-2"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn btn-primary">保存</button></div>
    </div>
  </form>`);
  const form = $('form', m.el), sel = form.elements.hospitalId;
  let last = sel.value;
  sel.onchange = () => {
    if (sel.value !== '__new') { last = sel.value; return; }
    sel.value = last;
    openHospitalForm(null, (h) => { // 当场新建医院，回到本表单并选中它（本表单内容不丢）
      sel.innerHTML = `<option value="">— 请选择 —</option>${optionsHtml(h.id)}<option value="__new">＋ 新建医院…</option>`;
      last = h.id;
    });
  };
  $('[data-gyne]', m.el).onclick = () => {
    const t = form.elements.note;
    if (!t.value.includes(GYNE_NOTE)) t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + GYNE_NOTE;
  };
  const del = $('[data-del]', m.el);
  if (del) del.onclick = async () => {
    if (!(await confirmDialog('删除这位医生？已建的行程不受影响。', { ok: '删除', danger: true }))) return;
    remove('doctors', d.id); m.close(); toast('已删除');
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    if (!f.name.trim() && !f.specialty.trim()) return toast('医生姓名和专科至少填一项', 'error');
    save('doctors', {
      ...x, id: x.id, name: f.name.trim(), specialty: f.specialty.trim(), hospitalId: f.hospitalId === '__new' ? '' : f.hospitalId,
      times: f.times.trim(), note: f.note.trim(), other: f.other.trim(),
    });
    m.close(); toast('已保存', 'ok');
  };
}
