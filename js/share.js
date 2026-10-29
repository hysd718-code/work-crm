// 行程分享：在本机用 Canvas 画一张预约提醒图（PNG），或把同一张图放进一页 A5 的 PDF。
// 不依赖任何库、不联网、内容不会发给第三方。分享走系统分享面板（navigator.share），不支持时改为保存。
import { getClient, live, hospitalOf } from './store.js';
import { esc, openModal, toast, WEEK, parseYmd, $ } from './util.js';
import { EV_TYPES, evType } from './calendar.js';

const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif';
const W = 1080, PAD = 64;

function eventFacts(e) {
  const c = getClient(e.clientId);
  const [kind, rid] = (e.presetId || '').split(/:(.*)/s);
  const d = kind === 'd' ? live('doctors').find((x) => x.id === rid) : null;
  const h = d ? hospitalOf(d.hospitalId) : kind === 'h' ? hospitalOf(rid) : null;
  const dt = parseYmd(e.date);
  const place = [h && h.name, e.location && e.location !== (h && h.address) ? e.location : h && h.address].filter(Boolean);
  return {
    client: (c && c.name) || e.clientName || '',
    type: evType(e),
    dateLine: `${dt.getMonth() + 1}月${dt.getDate()}日 周${WEEK[(dt.getDay() + 6) % 7]}`,
    year: dt.getFullYear(),
    time: e.allDay ? '全天' : e.start, // 只显示开始时间
    rows: [
      ['客户', [(c && c.name) || e.clientName].filter(Boolean)],
      ['检查项目', e.exam ? [e.exam] : []],
      ['科室 / 医生', [[d && d.specialty, d && d.name || e.doctor].filter(Boolean).join(' · ')].filter(Boolean)],
      ['医院 / 地点', place],
      ['备注', (e.notes || '').split('\n').map((x) => x.trim()).filter(Boolean)],
    ].filter(([, lines]) => lines.length),
  };
}

// 按宽度折行：中文逐字、英文优先在空格处断开
function wrap(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      const sp = /[A-Za-z0-9]$/.test(cur) && /[A-Za-z0-9]/.test(ch) ? cur.lastIndexOf(' ') : -1;
      if (sp > 0) { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; } else { lines.push(cur); cur = ch; }
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function renderCard(e) {
  const f = eventFacts(e), t = EV_TYPES[f.type];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = 4000;
  const ctx = cv.getContext('2d');
  const textW = W - PAD * 2;
  // 第一遍：计算高度
  const HEAD_H = 330;
  let y = HEAD_H + 40;
  const ops = [];
  ctx.font = `700 34px ${FONT}`; ops.push({ k: 'tag', y }); y += 88;
  for (const [label, lines] of f.rows) {
    y += 30; ops.push({ k: 'line', y }); y += 28;
    ops.push({ k: 'label', y, label }); y += 46;
    const big = label === '备注' ? 36 : 44, lh = label === '备注' ? 54 : 62;
    const wrapped = [];
    lines.forEach((ln, i) => {
      const sec = label === '医院 / 地点' && i > 0; // 医院名大字，地址小字
      ctx.font = `${sec || label === '备注' ? 400 : 700} ${sec ? 34 : big}px ${FONT}`;
      wrap(ctx, ln, textW).forEach((w) => wrapped.push({ w, sec }));
    });
    wrapped.forEach((o) => { ops.push({ k: 'text', y, ...o, label }); y += o.sec ? 50 : lh; });
  }
  y += 56;
  const H = y + 70;
  cv.height = H;
  const c2 = cv.getContext('2d');
  c2.fillStyle = '#fff'; c2.fillRect(0, 0, W, H);
  c2.fillStyle = t.color; c2.fillRect(0, 0, W, HEAD_H);
  c2.fillStyle = '#fff'; c2.textBaseline = 'alphabetic';
  c2.globalAlpha = 0.9; c2.font = `500 34px ${FONT}`; c2.fillText('预约提醒', PAD, 84);
  c2.globalAlpha = 1; c2.font = `700 64px ${FONT}`; c2.fillText(`${f.year}年${f.dateLine}`, PAD, 176);
  c2.font = `700 112px ${FONT}`; c2.fillText(f.time, PAD, 290);
  for (const o of ops) {
    if (o.k === 'tag') {
      c2.font = `700 36px ${FONT}`;
      const tw = c2.measureText(t.label).width + 64;
      c2.fillStyle = t.bg; roundRect(c2, PAD, o.y, tw, 64, 32); c2.fill();
      c2.fillStyle = t.color; c2.fillText(t.label, PAD + 32, o.y + 45);
    } else if (o.k === 'line') {
      c2.fillStyle = '#eceff1'; c2.fillRect(PAD, o.y, textW, 2);
    } else if (o.k === 'label') {
      c2.fillStyle = '#70757a'; c2.font = `400 28px ${FONT}`; c2.fillText(o.label, PAD, o.y + 26);
    } else {
      const note = o.label === '备注';
      c2.fillStyle = o.sec || note ? '#3c4043' : '#202124';
      c2.font = `${o.sec || note ? 400 : 700} ${o.sec ? 34 : note ? 36 : 44}px ${FONT}`;
      c2.fillText(o.w, PAD, o.y + (o.sec ? 34 : note ? 38 : 46));
    }
  }
  return cv;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const toBlob = (cv, type, q) => new Promise((res) => cv.toBlob(res, type, q));

// 一页 A5 的 PDF：把 JPEG 原样嵌入（DCTDecode），无需任何库
export async function cardToPdf(cv) {
  const jpg = new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.92)).arrayBuffer());
  const PW = 419.53, PH = 595.28, M = 24; // A5，pt
  let w = PW - M * 2, h = (cv.height / cv.width) * w;
  if (h > PH - M * 2) { h = PH - M * 2; w = (cv.width / cv.height) * h; }
  const x = (PW - w) / 2, y = PH - M - h;
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const push = (b) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offs[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
  push(jpg); push('\nendstream\nendobj\n');
  const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

function fileBase(e) {
  const f = eventFacts(e);
  return `${(f.client || 'CITA').replace(/\s+/g, '_')}_${e.date.replaceAll('-', '')}_Cita`;
}

async function shareOrSave(blob, name, mode) {
  const file = new File([blob], name, { type: blob.type });
  if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '预约提醒' }); return; }
    catch (err) { if (err.name === 'AbortError') return; /* 其他错误 → 退回保存 */ }
    toast('系统分享不可用，已改为保存文件');
  } else if (mode === 'share') toast('此浏览器不支持直接分享文件，已改为保存');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// 入口：行程详情里的「分享」→ 选图片 / PDF → 预览 → 分享 / 保存
export function openShareMenu(e) {
  const m = openModal(`
  <div class="p-5">
    <h2 class="text-lg font-medium mb-3">分享为</h2>
    <button class="btn w-full justify-start mb-2" data-fmt="png" style="height:52px">🖼️ 图片（PNG）</button>
    <button class="btn w-full justify-start" data-fmt="pdf" style="height:52px">📄 PDF（A5 一页）</button>
    <div class="flex justify-end mt-4"><button class="btn" data-close>取消</button></div>
  </div>`);
  m.el.querySelectorAll('[data-fmt]').forEach((b) => { b.onclick = () => { m.close(); openPreview(e, b.dataset.fmt); }; });
}

async function openPreview(e, fmt) {
  let blob, url;
  try {
    await (document.fonts && document.fonts.ready);
    const cv = renderCard(e);
    blob = fmt === 'pdf' ? await cardToPdf(cv) : await toBlob(cv, 'image/png');
    url = cv.toDataURL('image/jpeg', 0.85); // 预览用
  } catch (err) { return toast('生成失败：' + err.message, 'error'); }
  const name = `${fileBase(e)}.${fmt}`;
  const m = openModal(`
  <div class="p-4">
    <div class="text-xs text-[#5f6368] mb-2">${fmt === 'pdf' ? 'PDF（A5 一页，预览为其中的图片）' : '图片预览'} · ${esc(name)}</div>
    <div class="rounded-lg border border-[#dadce0] bg-[#eceff1] p-2 max-h-[60vh] overflow-y-auto"><img src="${url}" alt="预约提醒" class="w-full rounded"></div>
    <div class="flex flex-wrap justify-end gap-2 mt-4">
      <button class="btn" data-close>关闭</button>
      <button class="btn" id="sh-save">保存</button>
      <button class="btn btn-primary" id="sh-go">📤 分享</button>
    </div>
  </div>`);
  $('#sh-save', m.el).onclick = () => shareOrSave(blob, name, 'save');
  $('#sh-go', m.el).onclick = () => shareOrSave(blob, name, 'share');
}
