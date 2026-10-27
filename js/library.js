// 科室库：常用医院/科室/医生 + 地址 + 注意事项；以及「所有预约通用提醒」
import { state, live, save, remove, listPresets, getGeneralNote, presetLabel } from './store.js';
import { $, esc, openModal, confirmDialog, toast } from './util.js';
import { attachAddress, hasKey } from './google.js';

const GYNE_NOTE = '妇科检查请避开月经期。';

export function renderLibrary(root) {
  const list = listPresets();
  root.innerHTML = `
  <div class="max-w-2xl mx-auto p-3 md:p-6 space-y-4 pb-24">
    <section class="card p-4">
      <label class="label !mt-0" for="lib-general">所有预约的通用提醒（新建行程时自动写进备注）</label>
      <textarea id="lib-general" class="input" rows="2">${esc(getGeneralNote())}</textarea>
      <div class="flex justify-end mt-2"><button id="lib-save-general" class="btn btn-sm">保存通用提醒</button></div>
    </section>
    <div class="flex items-center justify-between">
      <div class="text-sm text-[#5f6368]">已保存 ${list.length} 项</div>
      <button id="lib-new" class="btn btn-primary">＋ 新增科室</button>
    </div>
    ${list.length ? list.map((p) => `
      <section class="card p-4">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="font-medium break-words">${esc([p.hospital, p.dept].filter(Boolean).join(' · '))}</div>
            <div class="text-sm text-[#5f6368]">${esc(p.doctor || '未填医生')}</div>
          </div>
          <button class="btn btn-sm" data-edit="${esc(p.id)}">编辑</button>
        </div>
        ${p.address ? `<div class="text-sm mt-2">📍 ${esc(p.address)}</div>` : ''}
        ${p.note ? `<div class="mt-2 text-sm rounded-lg px-3 py-2 whitespace-pre-line" style="background:#fef7e0;color:#6b3d00">${esc(p.note)}</div>` : '<div class="mt-2 text-xs text-[#70757a]">未添加专项注意事项，只带通用提醒</div>'}
      </section>`).join('') : '<div class="card p-6 text-center text-sm text-[#5f6368]">还没有常用科室。点右上「新增科室」添加第一个。</div>'}
    ${hasKey() ? '' : '<p class="text-xs text-[#5f6368]">提示：在「设置」里填写 Google API 密钥后，地址栏会出现谷歌地图联想。</p>'}
  </div>`;

  $('#lib-save-general', root).onclick = () => {
    const rec = live('presets').find((p) => p.id === 'general') || { id: 'general', kind: 'general' };
    save('presets', { ...rec, text: $('#lib-general', root).value.trim() });
    toast('已保存', 'ok');
  };
  $('#lib-new', root).onclick = () => openPresetForm(null);
  root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openPresetForm(live('presets').find((p) => p.id === b.dataset.edit)); });
}

function openPresetForm(p) {
  const x = p || {};
  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium mb-1">${p ? '编辑科室' : '新增常用科室'}</h2>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">医院 / 诊所 *</label><input name="hospital" class="input" required value="${esc(x.hospital || '')}"></div>
      <div><label class="label">科室 *</label><input name="dept" class="input" required placeholder="妇科 Ginecología" value="${esc(x.dept || '')}"></div>
    </div>
    <label class="label">医生（可选）</label>
    <input name="doctor" class="input" value="${esc(x.doctor || '')}">
    <label class="label">地址${hasKey() ? '（输入后选谷歌地图联想）' : ''}</label>
    <input name="address" class="input" value="${esc(x.address || '')}">
    <label class="label">该科室的注意事项（可留空）</label>
    <textarea name="note" class="input" rows="3">${esc(x.note || '')}</textarea>
    <div class="mt-2"><button type="button" class="chip" data-gyne style="cursor:pointer">＋ 插入「${esc(GYNE_NOTE)}」</button></div>
    <div class="flex justify-between gap-2 mt-5">
      <div>${p ? '<button type="button" class="btn btn-danger" data-del>删除</button>' : ''}</div>
      <div class="flex gap-2"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn btn-primary">保存</button></div>
    </div>
  </form>`);
  const form = $('form', m.el);
  attachAddress(form.elements.address);
  $('[data-gyne]', m.el).onclick = () => {
    const t = form.elements.note;
    if (!t.value.includes(GYNE_NOTE)) t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + GYNE_NOTE;
  };
  const d = $('[data-del]', m.el);
  if (d) d.onclick = async () => {
    if (!(await confirmDialog('删除这个常用科室？已建的行程不受影响。', { ok: '删除', danger: true }))) return;
    remove('presets', p.id); m.close(); toast('已删除');
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    save('presets', {
      ...x, id: x.id, kind: 'dept',
      hospital: f.hospital.trim(), dept: f.dept.trim(), doctor: f.doctor.trim(), address: f.address.trim(), note: f.note.trim(),
    });
    m.close(); toast('已保存', 'ok');
  };
}
