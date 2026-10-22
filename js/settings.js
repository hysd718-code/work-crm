// 设置页：GitHub 同步、Google Drive、备份与重置
import { state, saveSettings, exportAll, importAll, clearLocal } from './store.js';
import { $, esc, toast, confirmDialog } from './util.js';
import { syncAll, syncConfigured } from './sync.js';
import { getToken } from './drive.js';

export function renderSettings(root) {
  const s = state.settings;
  root.innerHTML = `
  <div class="max-w-2xl mx-auto p-3 md:p-6 space-y-5 pb-24">
    <section class="card p-4">
      <h2 class="font-medium mb-1">GitHub 云同步</h2>
      <p class="text-xs text-[#5f6368]">数据以 <code>clients.json</code> 与 <code>events.json</code> 存入指定仓库。<b>务必使用私有（Private）仓库</b>——内含客户医疗信息。</p>
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
      <h2 class="font-medium mb-2">备份与重置</h2>
      <div class="flex flex-wrap gap-2">
        <button id="s-export" class="btn">导出 JSON 备份</button>
        <label class="btn cursor-pointer">导入备份<input id="s-import" type="file" accept="application/json" class="hidden"></label>
        <button id="s-clear" class="btn btn-danger">清除本机数据</button>
      </div>
      <p class="text-xs text-[#5f6368] mt-2">令牌保存在本机浏览器 LocalStorage，请勿在公共设备上使用；「清除本机数据」同时会清除令牌。</p>
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
  $('#s-gsave', root).onclick = () => { saveSettings({ googleClientId: $('#s-gid', root).value.trim() }); toast('已保存', 'ok'); };
  $('#s-gauth', root).onclick = async () => {
    saveSettings({ googleClientId: $('#s-gid', root).value.trim() });
    try { await getToken(true); toast('Google Drive 授权成功', 'ok'); } catch (e) { toast(e.message, 'error', 6000); }
  };
  $('#s-export', root).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportAll()], { type: 'application/json' }));
    a.download = `work-crm-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $('#s-import', root).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { importAll(await f.text()); toast('导入完成（按更新时间合并）', 'ok'); } catch (err) { toast('导入失败：' + err.message, 'error'); }
  };
  $('#s-clear', root).onclick = async () => {
    if (!(await confirmDialog('将清除本机的客户、行程与所有设置（含令牌）。\n如已同步，GitHub 上的数据不受影响。确定？', { ok: '清除', danger: true }))) return;
    clearLocal(); location.hash = '#/calendar'; location.reload();
  };
}
