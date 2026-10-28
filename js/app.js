// 入口：路由、导航、同步状态、PWA 注册
import { state, saveSettings, live, migrateLegacyPresets } from './store.js';
import { $, $$, toast } from './util.js';
import { renderCalendar, openEventForm, gotoDate, isPast } from './calendar.js';
import { renderClients, renderClientDetail, openClientForm } from './clients.js';
import { renderSettings } from './settings.js';
import { renderLibrary } from './library.js';
import { syncAll, syncConfigured, isSyncing } from './sync.js';

const view = $('#view');
const TITLES = { calendar: '日程', clients: '客户', client: '客户档案', library: '医院与医生', settings: '设置与同步' };

function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'calendar';
  const [path, query = ''] = raw.split('?');
  const [name, arg] = path.split('/');
  return { name: TITLES[name] ? name : 'calendar', arg, params: new URLSearchParams(query) };
}

function render() {
  if ($('#modal-root').childElementCount) return; // 有弹窗时不重绘，避免丢失表单输入
  const r = route();
  $('#page-title').textContent = TITLES[r.name];
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (r.name === 'client' ? 'clients' : r.name)));
  $('#fab').style.display = r.name === 'settings' || r.name === 'client' || r.name === 'library' ? 'none' : '';
  const keepScroll = view.scrollTop;
  if (r.name === 'calendar') { if (r.params.get('d')) gotoDate(r.params.get('d')); view.className = 'flex-1 overflow-hidden bg-white'; renderCalendar(view); }
  else {
    view.className = 'flex-1 overflow-y-auto bg-white';
    if (r.name === 'clients') renderClients(view);
    else if (r.name === 'client') renderClientDetail(view, r.arg);
    else if (r.name === 'library') renderLibrary(view);
    else renderSettings(view);
    view.scrollTop = keepScroll;
  }
}

window.addEventListener('hashchange', () => { view.scrollTop = 0; render(); });
window.addEventListener('crm:render', render);

/* ---- 新建按钮 ---- */
const create = () => (route().name === 'clients' ? openClientForm(null) : openEventForm(null));
$('#side-new').onclick = () => {
  const r = route();
  if (r.name === 'clients') openClientForm(null); else openEventForm(null);
};
$('#fab').onclick = create;

/* ---- 同步 ---- */
const label = $('#sync-label'), icon = $('#sync-icon'), sideInfo = $('#side-sync-info');
function setSyncUi(status, msg) {
  icon.classList.toggle('spin', status === 'run');
  label.textContent = status === 'run' ? '同步中' : status === 'err' ? '同步失败' : '同步';
  const t = state.meta.lastSync ? '上次同步 ' + new Date(state.meta.lastSync).toLocaleTimeString() : '未同步';
  sideInfo.textContent = msg || (syncConfigured() ? t : 'GitHub 同步未配置');
}
window.addEventListener('crm:sync-start', () => setSyncUi('run'));
window.addEventListener('crm:sync-end', () => migrateLegacyPresets()); // 其他设备同步来的旧科室也迁移
window.addEventListener('crm:sync-end', (e) => setSyncUi(e.detail.ok ? 'ok' : 'err', e.detail.ok ? '' : e.detail.error));

async function doSync(manual) {
  if (!syncConfigured()) { if (manual) { toast('请先配置 GitHub 同步', 'error'); location.hash = '#/settings'; } return; }
  if (!navigator.onLine) { if (manual) toast('当前离线，联网后将自动同步', 'error'); return; }
  try { await syncAll(); if (manual) toast('同步完成', 'ok'); } catch (e) { toast('同步失败：' + e.message, 'error', 6000); }
}
$('#sync-btn').onclick = () => doSync(true);

let timer = null;
window.addEventListener('crm:changed', (e) => {
  if (e.detail.source !== 'local' || !state.settings.autoSync) return;
  clearTimeout(timer);
  timer = setTimeout(() => !isSyncing() && doSync(false), 4000); // 修改后 4 秒防抖自动同步
});
window.addEventListener('online', () => { $('#offline-badge').classList.add('hidden'); if (state.settings.autoSync) doSync(false); });
window.addEventListener('offline', () => $('#offline-badge').classList.remove('hidden'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.settings.autoSync) return;
  const last = state.meta.lastSync ? Date.parse(state.meta.lastSync) : 0;
  if (Date.now() - last > 60000) doSync(false);
});
if (!navigator.onLine) $('#offline-badge').classList.remove('hidden');

/* ---- PWA ---- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 注册失败', e));
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#install-btn').classList.remove('hidden'); });
$('#install-btn').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#install-btn').classList.add('hidden'); };

// 每分钟只刷新「已结束」的淡化样式，不重绘页面（避免打断滚动/输入）
setInterval(() => view.querySelectorAll('[data-ev]').forEach((b) => {
  const e = live('events').find((x) => x.id === b.dataset.ev);
  if (e) b.classList.toggle(b.classList.contains('ev-chip') ? 'past' : 'is-past', isPast(e));
}), 60000);
migrateLegacyPresets();
render();
setSyncUi('ok');
if (state.settings.autoSync) doSync(false);
