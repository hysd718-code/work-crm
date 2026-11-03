// 设置页：GitHub 同步、Google Drive、备份与重置
import { state, saveSettings, exportAll, importAll, clearLocal, live, save, getGeneralNote, lockEnabled, getLockCfg } from './store.js';
import { encryptBackup, decryptBackup, isEncryptedBackup, passStrength } from './crypto.js';
import { openEnableDialog, openChangeDialog, lockNow, changeIdle } from './lock.js';
import { $, esc, toast, confirmDialog, openModal } from './util.js';
import { syncAll, syncConfigured } from './sync.js';
import { getToken } from './drive.js';
import { suggest, translate } from './google.js';

// 弹窗问一个密码（备份加密 / 解密用）；取消返回 null
function askPass(title, desc, { confirm = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(`
    <form class="p-5" autocomplete="off">
      <h2 class="text-lg font-medium">${esc(title)}</h2>
      <p class="text-sm text-[#5f6368] mt-1">${esc(desc)}</p>
      <label class="label">密码</label>
      <input name="p1" type="password" class="input" required autocomplete="off">
      ${confirm ? '<div id="ap-st" class="text-xs mt-1 min-h-[16px]"></div><label class="label">再输一次</label><input name="p2" type="password" class="input" required autocomplete="off">' : ''}
      <div id="ap-err" class="text-sm text-[#d93025] mt-2 min-h-[20px]"></div>
      <div class="flex justify-end gap-2 mt-3"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn btn-primary">确定</button></div>
    </form>`, { onClose: () => { if (!done) resolve(null); } });
    const form = $('form', m.el), err = $('#ap-err', m.el);
    if (confirm) form.elements.p1.oninput = () => { const r = passStrength(form.elements.p1.value); const st = $('#ap-st', m.el); st.textContent = form.elements.p1.value ? r.label : ''; st.style.color = r.ok ? '#188038' : '#d93025'; };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (confirm) {
        if (!passStrength(form.elements.p1.value).ok) return (err.textContent = passStrength(form.elements.p1.value).label);
        if (form.elements.p1.value !== form.elements.p2.value) return (err.textContent = '两次输入不一致');
      }
      done = true; m.close(); resolve(form.elements.p1.value);
    };
  });
}
const download = (text, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

export function renderSettings(root) {
  const s = state.settings;
  root.innerHTML = `
  <div class="max-w-2xl mx-auto p-3 md:p-6 space-y-5 pb-24">
    <section class="card p-4">
      <h2 class="font-medium mb-1">安全锁与加密</h2>
      ${lockEnabled() ? `
      <p class="text-sm">状态：<b style="color:#188038">已启用</b>。本机数据和 GitHub 上的每条记录都已加密；令牌、密钥也加密保存。</p>
      <label class="label">闲置多久自动锁定</label>
      <select id="s-idle" class="input sm:w-56">${[[1, '1 分钟'], [5, '5 分钟'], [10, '10 分钟'], [30, '30 分钟'], [60, '60 分钟'], [0, '从不（不推荐）']].map(([v, l]) => `<option value="${v}" ${(getLockCfg().idleMin ?? 10) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="flex flex-wrap gap-2 mt-3"><button id="s-lock-now" class="btn">🔒 立即锁定</button><button id="s-lock-change" class="btn">更改密码</button></div>
      <p class="text-xs text-[#5f6368] mt-2">密码只在本机使用，不会上传，也无法找回。请把它写在纸上保存好。</p>` : `
      <p class="text-sm">状态：<b style="color:#d93025">未启用</b>。现在任何人拿到你的手机、打开应用都能看到全部客户资料；GitHub 令牌也是明文放在本机。</p>
      <p class="text-xs text-[#5f6368] mt-1">启用后：打开应用先输密码，闲置自动锁定，本机和 GitHub 上的数据都加密。</p>
      <div class="mt-3"><button id="s-lock-on" class="btn btn-primary">启用安全锁与加密</button></div>`}
    </section>

    <section class="card p-4">
      <h2 class="font-medium mb-1">GitHub 云同步</h2>
      <p class="text-xs text-[#5f6368]">数据以 <code>clients.json</code>、<code>events.json</code> 等文件存入指定仓库。<b>务必使用私有（Private）仓库</b>——内含客户医疗信息。启用「安全锁与加密」后，每条记录在上传前先加密。</p>
      <label class="label">Personal Access Token（建议 Fine-grained，仅授权该仓库 Contents: Read and write）</label>
      <input id="s-token" type="password" class="input" placeholder="github_pat_…" value="${esc(s.token)}" autocomplete="off">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="sm:col-span-2"><label class="label">仓库（owner/repo）</label><input id="s-repo" class="input" placeholder="yourname/work-crm-data" value="${esc(s.repo)}"></div>
        <div><label class="label">分支</label><input id="s-branch" class="input" value="${esc(s.branch)}"></div>
      </div>
      <label class="label">数据目录（仓库内路径，留空为根目录）</label>
      <input id="s-dir" class="input" value="${esc(s.dir)}">
      <label class="flex items-center gap-2 text-sm mt-3"><input id="s-auto" type="checkbox" ${s.autoSync ? 'checked' : ''}> 自动同步（启动 / 联网 / 修改后）</label>
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <button id="s-save-gh" class="btn">保存</button>
        <button id="s-sync" class="btn btn-primary">保存并立即同步</button>
        <span class="text-xs text-[#5f6368]">${state.meta.lastSync ? '上次同步：' + new Date(state.meta.lastSync).toLocaleString() : '尚未同步'}</span>
      </div>
    </section>

    <section class="card p-4">
      <h2 class="font-medium mb-1">所有预约的通用提醒</h2>
      <p class="text-xs text-[#5f6368]">新建行程时自动写进备注（例如要带的证件）。会随 GitHub 同步到其他设备。</p>
      <textarea id="s-general" class="input" rows="2">${esc(getGeneralNote())}</textarea>
      <div class="mt-2"><button id="s-gen-save" class="btn btn-sm">保存通用提醒</button></div>
    </section>

    <section class="card p-4">
      <h2 class="font-medium mb-1">Google Drive 文件存储</h2>
      <p class="text-xs text-[#5f6368]">使用 <code>drive.file</code> 范围：应用只能访问它自己创建的文件/文件夹。需要在 Google Cloud 创建 Web 类型 OAuth 客户端，并把本应用的网址加入「已获授权的 JavaScript 来源」。</p>
      <label class="label">OAuth 客户端 ID</label>
      <input id="s-gid" class="input" placeholder="xxxx.apps.googleusercontent.com" value="${esc(s.googleClientId)}">
      <div class="flex flex-wrap gap-2 mt-3">
        <button id="s-gsave" class="btn">保存</button>
        <button id="s-gauth" class="btn btn-primary">保存并授权测试</button>
      </div>
      <p class="text-xs text-[#5f6368] mt-2">授权令牌约 1 小时有效，过期后下次上传/预览会再次弹出授权窗口（令牌模型无刷新令牌）。</p>
    </section>

    <section class="card p-4">
      <h2 class="font-medium mb-1">Google 地图联想与自动翻译</h2>
      <p class="text-xs text-[#5f6368]">一个 API 密钥同时用于：行程地址联想（Places API (New)）和客户档案中西互译（Cloud Translation）。翻译只发送「基础病/过敏/用药/手术/备注」文字，不发送姓名、电话、卡号。密钥请在 Google Cloud 限制为仅 <code>hysd718-code.github.io/*</code> 网址、仅这两个 API。</p>
      <label class="label">API 密钥</label>
      <input id="s-gkey" type="password" class="input" placeholder="AIza…" value="${esc(s.googleApiKey)}" autocomplete="off">
      <div class="flex flex-wrap gap-2 mt-3">
        <button id="s-gksave" class="btn">保存</button>
        <button id="s-gktest-p" class="btn">测试地址联想</button>
        <button id="s-gktest-t" class="btn">测试翻译</button>
      </div>
      <div id="s-gktest-out" class="text-xs text-[#5f6368] mt-2 whitespace-pre-line"></div>
    </section>

    <section class="card p-4">
      <h2 class="font-medium mb-2">备份与重置</h2>
      <div class="flex flex-wrap gap-2">
        <button id="s-export-enc" class="btn btn-primary">导出加密备份（推荐）</button>
        <button id="s-export" class="btn">导出明文备份</button>
        <label class="btn cursor-pointer">导入备份<input id="s-import" type="file" accept="application/json,.json" class="hidden"></label>
        <button id="s-clear" class="btn btn-danger">清除本机数据</button>
      </div>
      <p class="text-xs text-[#5f6368] mt-2">加密备份用你设的密码加密，换设备也能打开。明文备份含全部客户医疗信息，下载后会留在手机里，请尽快转存并删除。备份文件不包含令牌和密钥。「清除本机数据」会同时清除令牌和安全锁设置。</p>
    </section>
  </div>`;

  const saveGh = () => saveSettings({
    token: $('#s-token', root).value.trim(),
    repo: $('#s-repo', root).value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''),
    branch: $('#s-branch', root).value.trim() || 'main',
    dir: $('#s-dir', root).value.trim(),
    autoSync: $('#s-auto', root).checked,
  });
  $('#s-save-gh', root).onclick = () => { saveGh(); toast('已保存', 'ok'); };
  $('#s-sync', root).onclick = async () => {
    saveGh();
    if (!syncConfigured()) return toast('请填写令牌与仓库', 'error');
    try { await syncAll(); toast('同步完成', 'ok'); } catch (e) { toast(e.message, 'error', 6000); }
  };
  // 换了 OAuth 客户端 ID（比如换 Google 账户）：旧的根文件夹编号作废，下次上传会在新账户里重建
  const saveClientId = () => {
    const v = $('#s-gid', root).value.trim();
    saveSettings(v !== state.settings.googleClientId ? { googleClientId: v, driveRootId: '' } : { googleClientId: v });
  };
  $('#s-gsave', root).onclick = () => { saveClientId(); toast('已保存', 'ok'); };
  $('#s-gauth', root).onclick = async () => {
    saveClientId();
    try { await getToken(true); toast('Google Drive 授权成功', 'ok'); } catch (e) { toast(e.message, 'error', 6000); }
  };
  $('#s-gen-save', root).onclick = () => {
    const rec = live('presets').find((p) => p.id === 'general') || { id: 'general', kind: 'general' };
    save('presets', { ...rec, text: $('#s-general', root).value.trim() });
    toast('已保存', 'ok');
  };
  const out = $('#s-gktest-out', root);
  const saveKey = () => saveSettings({ googleApiKey: $('#s-gkey', root).value.trim() });
  $('#s-gksave', root).onclick = () => { saveKey(); toast('已保存（地址联想需刷新页面后生效）', 'ok'); };
  $('#s-gktest-p', root).onclick = async () => {
    saveKey(); out.textContent = '测试中…';
    try { const r = await suggest('Hospital Germans Trias Badalona'); out.textContent = r.length ? '成功，示例结果：\n' + r.slice(0, 3).join('\n') : '请求成功但没有结果'; }
    catch (e) { out.textContent = '失败：' + (e.message || e); }
  };
  $('#s-gktest-t', root).onclick = async () => {
    saveKey(); out.textContent = '测试中…';
    try { out.textContent = '成功：高血压 → ' + (await translate('高血压', 'zh-CN', 'es')); }
    catch (e) { out.textContent = '失败：' + e.message; }
  };
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('#s-export-enc', root).onclick = async () => {
    const pass = await askPass('加密备份', '为这份备份设一个密码（可以和安全锁密码相同）。恢复时需要它，忘了无法打开。', { confirm: true });
    if (!pass) return;
    try { download(JSON.stringify(await encryptBackup(exportAll(), pass)), `work-crm-backup-${stamp()}.enc.json`); toast('已导出加密备份', 'ok'); }
    catch (err) { toast('导出失败：' + err.message, 'error'); }
  };
  $('#s-export', root).onclick = async () => {
    if (!(await confirmDialog('明文备份包含全部客户的姓名、证件号、病史，任何人拿到文件都能直接读。\n建议改用「加密备份」。仍要导出明文吗？', { ok: '仍要导出', danger: true }))) return;
    download(exportAll(), `work-crm-backup-${stamp()}.json`);
  };
  $('#s-import', root).onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      let text = await f.text();
      const obj = JSON.parse(text);
      if (isEncryptedBackup(obj)) {
        const pass = await askPass('输入备份密码', '这是一份加密备份，请输入导出时设置的密码。');
        if (!pass) return;
        text = await decryptBackup(obj, pass);
      }
      importAll(text);
      toast('导入完成（按更新时间合并）', 'ok');
    } catch (err) { toast('导入失败：' + err.message, 'error', 5000); }
  };
  const lockOn = $('#s-lock-on', root); if (lockOn) lockOn.onclick = () => openEnableDialog();
  const idle = $('#s-idle', root); if (idle) idle.onchange = () => changeIdle(+idle.value);
  const lockNowB = $('#s-lock-now', root); if (lockNowB) lockNowB.onclick = () => lockNow();
  const lockChg = $('#s-lock-change', root); if (lockChg) lockChg.onclick = () => openChangeDialog();
  $('#s-clear', root).onclick = async () => {
    if (!(await confirmDialog('将清除本机的客户、行程与所有设置（含令牌）。\n如已同步，GitHub 上的数据不受影响。确定？', { ok: '清除', danger: true }))) return;
    clearLocal(); location.hash = '#/calendar'; location.reload();
  };
}
