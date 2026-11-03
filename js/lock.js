// 安全锁：启动/闲置自动锁定的锁屏、启用与更改密码的对话框、云端换密码后的重新输入。
// 密码只在本机用来推出加密密钥，永远不会上传；云端只存「盐 + 校验密文」(crypto.json)。
import { state, lockEnabled, isLocked, unlockStore, verifyPass, enableLock, getLockCfg, setIdleMin, flushWrites, prepareNewLock, applyNewLock, adoptRemoteLock, clearLocal, saveMeta } from './store.js';
import { passStrength } from './crypto.js';
import { $, openModal, toast } from './util.js';
import { syncAll, syncConfigured, fetchRemoteCrypto, isSyncing } from './sync.js';

const changed = () => window.dispatchEvent(new Event('crm:lockchanged'));

/* ================= 锁屏 ================= */
let softLocked = false;

function showLockScreen(onDone, mode) {
  const root = $('#lock-root');
  root.innerHTML = `
  <div class="fixed inset-0 z-[200] bg-white flex items-center justify-center p-6 overflow-y-auto">
    <form id="lk-form" class="w-full max-w-sm" autocomplete="off">
      <div class="text-5xl text-center">🔒</div>
      <h1 class="text-xl text-center mt-2">工作 CRM 已锁定</h1>
      <p class="text-xs text-center text-[#5f6368] mt-1">输入密码后才能查看客户资料</p>
      <input id="lk-pass" type="password" class="input mt-5" placeholder="密码" autocomplete="current-password">
      <div id="lk-err" class="text-sm text-[#d93025] mt-2 min-h-[20px]"></div>
      <button id="lk-ok" type="submit" class="btn btn-primary w-full mt-1 h-11">解锁</button>
      <details class="mt-8 text-xs text-[#5f6368]">
        <summary class="cursor-pointer">忘记密码？</summary>
        <p class="mt-2 leading-relaxed">密码没有任何办法找回（云端数据也用它加密）。你可以清除本机数据重新开始，再用你的「加密备份」或知道密码的另一台设备恢复。</p>
        <button id="lk-forget" type="button" class="btn btn-sm btn-danger mt-2">清除本机数据，重新开始</button>
      </details>
    </form>
  </div>`;
  const pass = $('#lk-pass', root), err = $('#lk-err', root), ok = $('#lk-ok', root);
  let fails = 0, lockedUntil = 0;
  setTimeout(() => pass.focus(), 50);
  $('#lk-forget', root).onclick = () => {
    if (!window.confirm('将清除本机的全部数据、设置和密码。云端的加密数据还在，但没有密码就打不开。\n确定要清除吗？')) return;
    clearLocal();
    location.reload();
  };
  $('#lk-form', root).onsubmit = async (e) => {
    e.preventDefault();
    const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
    if (wait > 0) { err.textContent = `试错次数过多，请 ${wait} 秒后再试`; return; }
    if (!pass.value) return;
    ok.disabled = true; ok.textContent = '解锁中…'; err.textContent = '';
    try {
      const good = mode === 'soft' ? await verifyPass(pass.value) : await unlockStore(pass.value);
      if (good) { root.innerHTML = ''; onDone(); return; }
      fails++;
      err.textContent = '密码不对';
      if (fails >= 5) { lockedUntil = Date.now() + 30000; fails = 0; err.textContent = '连续输错 5 次，请 30 秒后再试'; }
    } catch (ex) {
      err.textContent = '解锁失败：' + (ex.message || ex);
    }
    ok.disabled = false; ok.textContent = '解锁'; pass.value = ''; pass.focus();
  };
}

// 启动时调用：没启用就直接放行；启用了就显示锁屏，输对密码后才继续
export function bootLock() {
  return new Promise((resolve) => {
    if (!lockEnabled()) return resolve();
    showLockScreen(() => { startIdleWatch(); resolve(); }, 'hard');
  });
}

// 立即锁定：没有打开的表单时直接刷新页面（内存里的明文随之清空）；有表单时只盖锁屏，保住没填完的内容
export async function lockNow() {
  if (!lockEnabled() || softLocked || isLocked()) return;
  await flushWrites();
  if (!$('#modal-root').childElementCount) { location.reload(); return; }
  softLocked = true;
  showLockScreen(() => { softLocked = false; lastActive = Date.now(); }, 'soft');
}

/* ================= 闲置自动锁定 ================= */
let lastActive = Date.now();
let watching = false;
function idleCheck() {
  const cfg = getLockCfg();
  if (!cfg || !cfg.idleMin || isLocked() || softLocked) return;
  if (Date.now() - lastActive > cfg.idleMin * 60000) lockNow();
}
export function startIdleWatch() {
  if (watching) return;
  watching = true;
  const touch = () => { lastActive = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, touch, { passive: true, capture: true }));
  setInterval(idleCheck, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') idleCheck(); }); // 切走再回来：离开太久就锁
}
export function changeIdle(min) { setIdleMin(min); toast('已设置', 'ok'); }

/* ================= 启用 ================= */
export async function openEnableDialog() {
  let remote = null;
  if (syncConfigured()) { // 云端若已设置过密码，必须沿用（否则各设备的密钥对不上）
    if (!navigator.onLine) return toast('需要联网才能检查云端是否已设置过密码，请联网后再试', 'error', 5000);
    try { remote = await fetchRemoteCrypto(); } catch (e) { return toast('读取云端设置失败：' + e.message, 'error', 6000); }
  }
  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium">启用安全锁与加密</h2>
    <ul class="text-sm text-[#3c4043] mt-2 space-y-1 list-disc pl-5">
      <li>打开应用先输密码；闲置一段时间自动锁定。</li>
      <li>本机保存的客户、行程、令牌、密钥都会加密。</li>
      <li>上传到 GitHub 的每条记录也加密，云端看不到姓名和病史。</li>
    </ul>
    <div class="mt-3 p-3 rounded-lg text-sm" style="background:#fef7e0;color:#6b3d00">密码<b>无法找回</b>。忘了就打不开本机和云端的数据，只能靠「加密备份」。请先写在纸上，放在安全的地方。</div>
    ${remote ? '<div class="mt-3 p-3 rounded-lg text-sm" style="background:#e8f0fe;color:#174ea6">云端已经设置过密码。请输入<b>同一个密码</b>，这样各台设备才能互相读取。</div>' : ''}
    <label class="label">${remote ? '云端已设置的密码' : '设置密码（至少 8 位）'}</label>
    <input name="p1" type="password" class="input" autocomplete="new-password" required>
    <div id="en-strength" class="text-xs mt-1 min-h-[16px]"></div>
    ${remote ? '' : `<label class="label">再输一次</label>
    <input name="p2" type="password" class="input" autocomplete="new-password" required>
    <label class="flex items-start gap-2 text-sm mt-3"><input name="paper" type="checkbox" class="mt-1"> <span>我已把密码写在纸上，并明白忘记后无法找回。</span></label>`}
    <div id="en-err" class="text-sm text-[#d93025] mt-2 min-h-[20px]"></div>
    <div class="flex justify-end gap-2 mt-3"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn btn-primary">启用</button></div>
  </form>`);
  const form = $('form', m.el), err = $('#en-err', m.el), st = $('#en-strength', m.el);
  if (!remote) form.elements.p1.oninput = () => { const s = passStrength(form.elements.p1.value); st.textContent = form.elements.p1.value ? s.label : ''; st.style.color = s.ok ? '#188038' : '#d93025'; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const p1 = form.elements.p1.value;
    if (!remote) {
      if (!passStrength(p1).ok) return (err.textContent = passStrength(p1).label);
      if (p1 !== form.elements.p2.value) return (err.textContent = '两次输入不一致');
      if (!form.elements.paper.checked) return (err.textContent = '请先勾选「已把密码写在纸上」');
    }
    const btn = $('button[type=submit]', m.el);
    btn.disabled = true; btn.textContent = '加密中…';
    try {
      await enableLock(p1, remote);
      m.close();
      startIdleWatch();
      changed();
      toast('已启用。下一次同步会把云端数据改写成密文', 'ok', 5000);
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      btn.disabled = false; btn.textContent = '启用';
    }
  };
}

/* ================= 更改密码 ================= */
export function openChangeDialog() {
  const m = openModal(`
  <form class="p-5" autocomplete="off">
    <h2 class="text-lg font-medium">更改密码</h2>
    <p class="text-xs text-[#5f6368] mt-1">${syncConfigured() ? '需要联网：会把云端数据全部用新密码重新加密，其他设备之后要输入一次新密码。' : '只更改本机密码。'}</p>
    <label class="label">当前密码</label>
    <input name="old" type="password" class="input" autocomplete="current-password" required>
    <label class="label">新密码（至少 8 位）</label>
    <input name="p1" type="password" class="input" autocomplete="new-password" required>
    <div id="ch-strength" class="text-xs mt-1 min-h-[16px]"></div>
    <label class="label">再输一次新密码</label>
    <input name="p2" type="password" class="input" autocomplete="new-password" required>
    <div id="ch-err" class="text-sm text-[#d93025] mt-2 min-h-[20px]"></div>
    <div class="flex justify-end gap-2 mt-3"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn btn-primary">更改</button></div>
  </form>`);
  const form = $('form', m.el), err = $('#ch-err', m.el), st = $('#ch-strength', m.el);
  form.elements.p1.oninput = () => { const s = passStrength(form.elements.p1.value); st.textContent = form.elements.p1.value ? s.label : ''; st.style.color = s.ok ? '#188038' : '#d93025'; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { old, p1, p2 } = Object.fromEntries(new FormData(form).entries());
    if (!passStrength(p1).ok) return (err.textContent = passStrength(p1).label);
    if (p1 !== p2) return (err.textContent = '两次输入不一致');
    if (syncConfigured() && !navigator.onLine) return (err.textContent = '需要联网');
    const btn = $('button[type=submit]', m.el);
    btn.disabled = true; btn.textContent = '处理中…';
    try {
      if (!(await verifyPass(old))) throw new Error('当前密码不对');
      const prep = await prepareNewLock(p1, state.meta.pendingRekeySalt || null);
      if (syncConfigured()) {
        saveMeta({ pendingRekeySalt: prep.cfg.salt }); // 万一中途断网，重试时沿用同一把盐
        for (let i = 0; i < 40 && isSyncing(); i++) await new Promise((r) => setTimeout(r, 250));
        const r = await syncAll({ sealKey: prep.key, newCfg: prep.cfg }); // 用旧密钥读、新密钥写，最后才更新 crypto.json
        if (r !== 'ok') throw new Error('同步没有完成，请稍后重试');
      }
      await applyNewLock(prep);
      saveMeta({ pendingRekeySalt: null });
      m.close();
      toast('密码已更改', 'ok');
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      btn.disabled = false; btn.textContent = '更改';
    }
  };
}

/* ================= 别的设备改了密码 ================= */
export function promptRemoteKey(remote) {
  return new Promise((resolve) => {
    if (!remote) { toast('云端加密设置文件损坏，请检查 GitHub 仓库里的 crypto.json', 'error', 6000); return resolve(false); }
    let done = false;
    const m = openModal(`
    <form class="p-5" autocomplete="off">
      <h2 class="text-lg font-medium">云端密码已更换</h2>
      <p class="text-sm text-[#3c4043] mt-1">另一台设备更改了密码。请输入<b>新密码</b>，本设备会改用它。</p>
      <label class="label">新密码</label>
      <input name="p" type="password" class="input" autocomplete="current-password" required>
      <div id="rk-err" class="text-sm text-[#d93025] mt-2 min-h-[20px]"></div>
      <div class="flex justify-end gap-2 mt-3"><button type="button" class="btn" data-close>稍后</button><button type="submit" class="btn btn-primary">确定</button></div>
    </form>`, { onClose: () => { if (!done) resolve(false); } });
    const form = $('form', m.el), err = $('#rk-err', m.el);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', m.el);
      btn.disabled = true; btn.textContent = '验证中…';
      try {
        if (await adoptRemoteLock(form.elements.p.value, remote)) { done = true; m.close(); resolve(true); return; }
        err.textContent = '密码不对';
      } catch (ex) { err.textContent = ex.message || String(ex); }
      btn.disabled = false; btn.textContent = '确定';
    };
  });
}
