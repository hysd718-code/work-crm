// 日历：月 / 周 / 日 / 列表视图（Google Calendar 风格），行程新增、详情、客户联动
import { state, live, getClient, save, remove, listPresets, presetLabel, composeNotes } from './store.js';
import { attachAddress } from './google.js';
import { $, $$, esc, normName, pad, ymd, parseYmd, todayStr, addDays, toMin, fromMin, WEEK, openModal, confirmDialog, toast } from './util.js';
import { openClientForm } from './clients.js';

const cal = { view: localStorage.getItem('crm.calview') || (innerWidth < 768 ? 'agenda' : 'month'), cursor: new Date() };
const HOUR_PX = 48;
const VIEWS = [['month', '月'], ['week', '周'], ['day', '日'], ['agenda', '列表']];

const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const evsOn = (ds) => live('events').filter((e) => e.date === ds).sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || (a.start || '').localeCompare(b.start || ''));
const evTitle = (e) => e.title || getClient(e.clientId)?.name || e.clientName || '（无标题）';
const evTime = (e) => (e.allDay ? '全天' : `${e.start}–${e.end}`);

export function gotoDate(ds) { if (ds) cal.cursor = parseYmd(ds); }

/* ============ 渲染 ============ */
export function renderCalendar(root) {
  const c = cal.cursor;
  let title = '';
  if (cal.view === 'month') title = `${c.getFullYear()}年${c.getMonth() + 1}月`;
  else if (cal.view === 'week') { const s = mondayOf(c), e = addDays(s, 6); title = `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 – ${e.getMonth() + 1}月${e.getDate()}日`; }
  else if (cal.view === 'day') title = `${c.getFullYear()}年${c.getMonth() + 1}月${c.getDate()}日 周${WEEK[(c.getDay() + 6) % 7]}`;
  else title = '日程列表';

  root.innerHTML = `
  <div class="h-full flex flex-col">
    <div class="shrink-0 flex flex-wrap items-center gap-2 px-3 md:px-5 py-2 border-b border-[#e8eaed]">
      <button id="c-today" class="btn btn-sm">今天</button>
      <button id="c-prev" class="btn btn-sm !px-2" aria-label="上一个">‹</button>
      <button id="c-next" class="btn btn-sm !px-2" aria-label="下一个">›</button>
      <div class="text-base md:text-lg font-normal text-[#3c4043] ml-1">${title}</div>
      <div class="ml-auto inline-flex rounded-lg border border-[#dadce0] overflow-hidden">
        ${VIEWS.map(([v, l]) => `<button data-view="${v}" class="px-3 h-8 text-sm ${cal.view === v ? 'bg-[#e8f0fe] text-[#1a73e8] font-medium' : 'bg-white text-[#3c4043]'}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="cal-body" class="flex-1 overflow-auto"></div>
  </div>`;

  const body = $('#cal-body', root);
  ({ month: renderMonth, week: renderWeek, day: renderDay, agenda: renderAgenda })[cal.view](body);

  $('#c-today', root).onclick = () => { cal.cursor = new Date(); renderCalendar(root); };
  $('#c-prev', root).onclick = () => { step(-1); renderCalendar(root); };
  $('#c-next', root).onclick = () => { step(1); renderCalendar(root); };
  $$('[data-view]', root).forEach((b) => (b.onclick = () => { cal.view = b.dataset.view; localStorage.setItem('crm.calview', cal.view); renderCalendar(root); }));
  // 事件委托：点行程 → 详情；点空白 → 新建
  body.onclick = (e) => {
    const chip = e.target.closest('[data-ev]');
    if (chip) { e.stopPropagation(); return openEventDetail(chip.dataset.ev); }
    const more = e.target.closest('[data-day]');
    if (more && more.dataset.more) { cal.cursor = parseYmd(more.dataset.day); cal.view = 'day'; return renderCalendar(root); }
    const col = e.target.closest('[data-slot]');
    if (col) {
      const rect = col.getBoundingClientRect();
      const mins = Math.max(0, Math.min(23 * 60, Math.floor(((e.clientY - rect.top) / HOUR_PX) * 60 / 30) * 30));
      return openEventForm(null, { date: col.dataset.slot, start: fromMin(mins), end: fromMin(Math.min(mins + 60, 24 * 60 - 1)) });
    }
    if (more) return openEventForm(null, { date: more.dataset.day });
  };
}

function step(n) {
  const c = new Date(cal.cursor);
  if (cal.view === 'month') c.setMonth(c.getMonth() + n, 1);
  else if (cal.view === 'week') c.setDate(c.getDate() + 7 * n);
  else c.setDate(c.getDate() + n);
  cal.cursor = c;
}

/* ---- 月视图 ---- */
function renderMonth(el) {
  const c = cal.cursor;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = mondayOf(first);
  const today = todayStr();
  let html = `<div class="min-w-[560px] md:min-w-0 h-full flex flex-col">
    <div class="grid grid-cols-7 border-b border-[#e8eaed] text-xs text-[#5f6368] text-center py-1.5">${WEEK.map((w) => `<div>周${w}</div>`).join('')}</div>
    <div class="grid grid-cols-7 grid-rows-6 flex-1">`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), ds = ymd(d), inMonth = d.getMonth() === c.getMonth();
    const evs = evsOn(ds);
    html += `<div data-day="${ds}" class="border-r border-b border-[#e8eaed] p-1 min-h-[84px] cursor-pointer hover:bg-[#f8f9fa] ${inMonth ? '' : 'bg-[#fafafa]'}">
      <div class="text-center mb-0.5"><span class="inline-flex w-6 h-6 items-center justify-center rounded-full text-xs ${ds === today ? 'bg-[#1a73e8] text-white font-medium' : inMonth ? 'text-[#3c4043]' : 'text-[#9aa0a6]'}">${d.getDate() === 1 ? `${d.getMonth() + 1}月${d.getDate()}日` : d.getDate()}</span></div>
      <div class="flex flex-col gap-0.5">
        ${evs.slice(0, 3).map((e) => `<button data-ev="${e.id}" class="ev-chip ${e.allDay ? 'allday' : ''}">${e.allDay ? '' : esc(e.start) + ' '}${esc(evTitle(e))}</button>`).join('')}
        ${evs.length > 3 ? `<button data-day="${ds}" data-more="1" class="text-[11px] text-[#5f6368] text-left px-1 hover:underline">还有 ${evs.length - 3} 项</button>` : ''}
      </div></div>`;
  }
  el.innerHTML = html + '</div></div>';
}

/* ---- 周 / 日 时间网格 ---- */
function layout(evs) {
  const items = evs.map((e) => ({ e, s: toMin(e.start), en: Math.max(toMin(e.end), toMin(e.start) + 30) })).sort((a, b) => a.s - b.s || a.en - b.en);
  const out = []; let cluster = [], cEnd = -1;
  const flush = () => {
    const cols = [];
    cluster.forEach((it) => { let k = cols.findIndex((end) => end <= it.s); if (k < 0) { k = cols.length; cols.push(0); } cols[k] = it.en; it.col = k; });
    cluster.forEach((it) => (it.n = cols.length));
    out.push(...cluster); cluster = []; cEnd = -1;
  };
  for (const it of items) { if (cluster.length && it.s >= cEnd) flush(); cluster.push(it); cEnd = Math.max(cEnd, it.en); }
  if (cluster.length) flush();
  return out;
}

function renderGrid(el, days) {
  const today = todayStr();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const cols = `grid-template-columns:48px repeat(${days.length},minmax(0,1fr))`;
  let html = `<div class="min-w-[${days.length > 1 ? 640 : 0}px] md:min-w-0">
    <div class="grid sticky top-0 bg-white z-10 border-b border-[#e8eaed]" style="${cols}">
      <div></div>
      ${days.map((d) => { const ds = ymd(d); const all = evsOn(ds).filter((e) => e.allDay); return `<div class="border-l border-[#e8eaed] p-1 text-center">
        <div class="text-xs text-[#5f6368]">周${WEEK[(d.getDay() + 6) % 7]}</div>
        <div class="inline-flex w-8 h-8 items-center justify-center rounded-full text-lg ${ds === today ? 'bg-[#1a73e8] text-white' : ''}">${d.getDate()}</div>
        ${all.map((e) => `<button data-ev="${e.id}" class="ev-chip allday mt-0.5">${esc(evTitle(e))}</button>`).join('')}</div>`; }).join('')}
    </div>
    <div class="grid relative" style="${cols}">
      <div>${Array.from({ length: 24 }, (_, h) => `<div class="relative" style="height:${HOUR_PX}px"><span class="absolute -top-2 right-1 text-[10px] text-[#70757a]">${h ? pad(h) + ':00' : ''}</span></div>`).join('')}</div>
      ${days.map((d) => {
        const ds = ymd(d);
        const evs = layout(evsOn(ds).filter((e) => !e.allDay));
        return `<div data-slot="${ds}" class="relative border-l border-[#e8eaed] cursor-pointer" style="height:${HOUR_PX * 24}px;background-image:linear-gradient(#e8eaed 1px,transparent 1px);background-size:100% ${HOUR_PX}px">
          ${evs.map(({ e, s, en, col, n }) => `<button data-ev="${e.id}" class="absolute ev-chip !whitespace-normal !leading-4 !py-0.5 shadow-sm" style="top:${(s / 60) * HOUR_PX}px;height:${Math.max(((en - s) / 60) * HOUR_PX - 2, 20)}px;left:calc(${(col / n) * 100}% + 1px);width:calc(${100 / n}% - 3px)"><b>${esc(e.start)}</b> ${esc(evTitle(e))}${e.location ? `<br><span class="opacity-80">${esc(e.location)}</span>` : ''}</button>`).join('')}
          ${ds === today ? `<div class="absolute left-0 right-0 border-t-2 border-[#ea4335] pointer-events-none" style="top:${(nowMin / 60) * HOUR_PX}px"></div>` : ''}
        </div>`;
      }).join('')}
    </div></div>`;
  el.innerHTML = html;
  if (!el.dataset.scrolled) { el.scrollTop = 7 * HOUR_PX; el.dataset.scrolled = '1'; }
}
const renderWeek = (el) => renderGrid(el, Array.from({ length: 7 }, (_, i) => addDays(mondayOf(cal.cursor), i)));
const renderDay = (el) => renderGrid(el, [cal.cursor]);

/* ---- 列表视图 ---- */
function renderAgenda(el) {
  const from = ymd(cal.cursor);
  const list = live('events').filter((e) => e.date >= from).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''))).slice(0, 200);
  const groups = new Map();
  list.forEach((e) => { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); });
  el.innerHTML = `<div class="max-w-3xl mx-auto p-3 md:p-6">
    <div class="text-xs text-[#5f6368] mb-2">显示 ${from} 之后的行程</div>
    ${[...groups].map(([ds, evs]) => { const d = parseYmd(ds); return `<div class="flex gap-4 py-3 border-b border-[#e8eaed]">
      <div class="w-14 text-center shrink-0"><div class="text-xs text-[#5f6368]">周${WEEK[(d.getDay() + 6) % 7]}</div><div class="text-2xl ${ds === todayStr() ? 'text-[#1a73e8]' : ''}">${d.getDate()}</div><div class="text-[11px] text-[#5f6368]">${d.getMonth() + 1}月</div></div>
      <div class="flex-1 min-w-0 flex flex-col gap-1.5">${evs.map((e) => `<button data-ev="${e.id}" class="text-left card px-3 py-2 hover:shadow-md"><div class="text-sm font-medium truncate">${esc(evTitle(e))}</div><div class="text-xs text-[#5f6368] truncate">${evTime(e)}${e.location ? ' · ' + esc(e.location) : ''}</div></button>`).join('')}</div></div>`; }).join('') || '<div class="text-center text-[#5f6368] py-16">没有即将到来的行程</div>'}
  </div>`;
}

/* ============ 行程详情 ============ */
export function openEventDetail(id) {
  const e = live('events').find((x) => x.id === id);
  if (!e) return;
  const c = getClient(e.clientId);
  const m = openModal(`
  <div class="p-5">
    <div class="flex items-start gap-3">
      <div class="w-3 h-3 rounded-sm bg-[#1a73e8] mt-2 shrink-0"></div>
      <div class="min-w-0 flex-1"><h2 class="text-xl break-words">${esc(evTitle(e))}</h2>
      <div class="text-sm text-[#5f6368]">${esc(e.date)}（周${WEEK[(parseYmd(e.date).getDay() + 6) % 7]}） ${evTime(e)}</div></div>
    </div>
    <dl class="mt-4 space-y-3 text-sm">
      <div><dt class="text-xs text-[#5f6368]">关联客户</dt><dd>${c ? esc(c.name) : esc(e.clientName || '—') + (e.clientId ? '（客户已删除）' : '')}</dd></div>
      ${e.doctor ? `<div><dt class="text-xs text-[#5f6368]">医生</dt><dd>${esc(e.doctor)}</dd></div>` : ''}
      <div><dt class="text-xs text-[#5f6368]">地点</dt><dd>${e.location ? `<a class="text-[#1a73e8]" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}">${esc(e.location)}</a>` : '—'}</dd></div>
      <div><dt class="text-xs text-[#5f6368]">备注</dt><dd class="whitespace-pre-line">${esc(e.notes) || '—'}</dd></div>
    </dl>
    <div class="flex flex-wrap gap-2 mt-5 justify-end">
      ${c ? `<button class="btn btn-primary" data-profile>查看客户档案与文件</button>` : ''}
      <button class="btn" data-edit>编辑</button>
      <button class="btn btn-danger" data-del>删除</button>
      <button class="btn" data-close>关闭</button>
    </div>
  </div>`);
  const p = $('[data-profile]', m.el);
  if (p) p.onclick = () => { m.close(); location.hash = '#/client/' + c.id; };
  $('[data-edit]', m.el).onclick = () => { m.close(); openEventForm(e); };
  $('[data-del]', m.el).onclick = async () => {
    if (!(await confirmDialog('确定删除该行程？', { ok: '删除', danger: true }))) return;
    remove('events', e.id); m.close(); toast('已删除');
  };
}

/* ============ 行程表单（客户联动） ============ */
export function openEventForm(ev, defaults = {}) {
  const e = { ...(ev || { date: todayStr(), start: '09:00', end: '10:00', allDay: false }), ...defaults };
  const startName = e.clientId ? (getClient(e.clientId)?.name || e.clientName || '') : (e.clientName || '');
  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium mb-1">${ev ? '编辑行程' : '新建行程'}</h2>
    <label class="label">关联客户（输入或选择）</label>
    <input name="client" list="client-list" class="input" placeholder="拼音姓名，如 ZHANG SAN" value="${esc(startName)}">
    <datalist id="client-list">${live('clients').map((c) => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
    <label class="label">标题（可选，默认用客户姓名）</label>
    <input name="title" class="input" value="${esc(e.title || '')}">
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">日期</label><input name="date" type="date" class="input" required value="${esc(e.date)}"></div>
      <div class="flex items-end pb-2"><label class="flex items-center gap-2 text-sm"><input name="allDay" type="checkbox" ${e.allDay ? 'checked' : ''}> 全天</label></div>
      <div data-t><label class="label">开始</label><input name="start" type="time" class="input" value="${esc(e.start || '09:00')}"></div>
      <div data-t><label class="label">结束</label><input name="end" type="time" class="input" value="${esc(e.end || '10:00')}"></div>
    </div>
    <label class="label" style="color:#1967d2">科室 / 医生（来自「科室库」，选一项自动填写）</label>
    <select name="preset" class="input"><option value="">— 手动填写 —</option>${listPresets().map((p) => `<option value="${esc(p.id)}" ${p.id === e.presetId ? 'selected' : ''}>${esc(presetLabel(p))}</option>`).join('')}</select>
    <label class="label">医生（可选）</label>
    <input name="doctor" class="input" value="${esc(e.doctor || '')}">
    <label class="label">地点（输入部分地址，选谷歌地图联想）</label>
    <input name="location" class="input" value="${esc(e.location || '')}" placeholder="医院 / 科室 / 地址">
    <label class="label">备注 / 注意事项</label>
    <textarea name="notes" class="input" rows="5">${esc(ev ? (e.notes || '') : (e.notes ?? composeNotes(null)))}</textarea>
    <div class="flex justify-end gap-2 mt-5">
      <button type="button" class="btn" data-close>取消</button>
      <button type="submit" class="btn btn-primary">保存</button>
    </div>
  </form>`);
  const form = $('form', m.el);
  const toggle = () => $$('[data-t]', form).forEach((x) => (x.style.display = form.elements.allDay.checked ? 'none' : ''));
  form.elements.allDay.onchange = toggle; toggle();
  attachAddress(form.elements.location);

  // 选科室：自动填医生/地址/备注。只覆盖「还是自动填的」内容；用户手改过的不动
  const presetOf = (id) => live('presets').find((p) => p.id === id);
  const autoOf = (p) => ({ doctor: p?.doctor || '', location: p?.address || '', notes: composeNotes(p) });
  let auto = autoOf(ev ? presetOf(e.presetId) : null);
  if (!ev) auto.notes = composeNotes(null);
  form.elements.preset.onchange = () => {
    const p = presetOf(form.elements.preset.value), next = autoOf(p);
    let kept = false;
    for (const k of ['doctor', 'location', 'notes']) {
      const el = form.elements[k];
      if (!el.value.trim() || el.value === auto[k]) el.value = next[k];
      else if (next[k] && el.value !== next[k]) kept = true;
    }
    auto = next;
    if (kept) toast('有已手改的内容未被覆盖', 'info');
  };
  form.elements.start.onchange = () => { // 开始时间变化时，结束时间自动顺延 1 小时
    const s = toMin(form.elements.start.value); if (toMin(form.elements.end.value) <= s) form.elements.end.value = fromMin(Math.min(s + 60, 1439));
  };

  form.onsubmit = async (evn) => {
    evn.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const allDay = form.elements.allDay.checked;
    if (!allDay && toMin(f.end) <= toMin(f.start)) return toast('结束时间必须晚于开始时间', 'error');
    const name = (f.client || '').trim();
    let clientId = '';
    if (name) {
      const key = normName(name);
      const hit = key && live('clients').find((c) => c.name === key);
      if (hit) clientId = hit.id;
      else {
        // 客户不存在 → 提示并快速跳转建档；建档完成后回到本行程表单并自动关联
        const draft = { ...e, ...f, allDay };
        const yes = await confirmDialog('该客户不存在，是否立即添加新客户？', { ok: '立即添加', cancel: '暂不' });
        if (!yes) return;
        m.close();
        openClientForm(null, {
          prefillName: name,
          onSaved: (rec) => { location.hash = '#/calendar'; setTimeout(() => openEventForm(ev, { ...draft, clientId: rec.id, clientName: rec.name }), 0); },
        });
        return;
      }
    }
    const rec = save('events', {
      ...(ev || {}),
      id: ev?.id,
      clientId,
      clientName: name,
      title: (f.title || '').trim(),
      date: f.date,
      allDay,
      start: allDay ? '' : f.start,
      end: allDay ? '' : f.end,
      presetId: f.preset || '',
      doctor: (f.doctor || '').trim(),
      location: (f.location || '').trim(),
      notes: (f.notes || '').trim(),
    });
    cal.cursor = parseYmd(rec.date);
    m.close();
    toast('行程已保存', 'ok');
  };
  return m;
}
