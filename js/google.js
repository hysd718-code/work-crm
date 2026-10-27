// Google Maps Platform（Places API New 地址联想）与 Cloud Translation（Basic v2）封装。
// 密钥由用户在「设置」里填写，保存在本机 LocalStorage；密钥应在 Google Cloud 里限制为仅本站网址 + 仅这两个 API。
import { state } from './store.js';
import { esc } from './util.js';

export const hasKey = () => !!state.settings.googleApiKey;

/* ---------------- Places：自定义输入框 + AutocompleteSuggestion ---------------- */
let placesP = null;
export function loadPlaces() {
  if (placesP) return placesP;
  placesP = new Promise((resolve, reject) => {
    const fail = (m) => { placesP = null; reject(new Error(m)); };
    window.gm_authFailure = () => fail('Google 地图拒绝了该密钥（请检查密钥限制、Places API (New) 是否已启用、结算是否已开通）');
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.settings.googleApiKey)}&loading=async&v=weekly&language=es&region=ES`;
    s.async = true;
    s.onload = () => google.maps.importLibrary('places').then(resolve, (e) => fail(e.message));
    s.onerror = () => fail('无法加载 Google 地图脚本（可能离线）');
    document.head.appendChild(s);
  });
  return placesP;
}

export async function suggest(text) {
  const { AutocompleteSuggestion } = await loadPlaces();
  // includedRegionCodes 限定西班牙；language 西语。未传 sessionToken：每次联想按一次 Autocomplete 请求计（免费额度 10,000 次/月）
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: text, includedRegionCodes: ['es'], language: 'es',
  });
  return suggestions.map((s) => s.placePrediction).filter(Boolean).map((p) => p.text.toString());
}

// 给地址输入框挂联想下拉：≥3 个字符、停顿 350ms 后才请求；离线或没填密钥时就是普通输入框
export function attachAddress(input) {
  if (!hasKey()) return;
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const box = document.createElement('div');
  box.className = 'hidden';
  box.style.cssText = 'position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:60;background:#fff;border:1px solid #dadce0;border-radius:12px;box-shadow:0 4px 16px rgba(60,64,67,.25);overflow:hidden';
  wrap.appendChild(box);
  const hide = () => { box.classList.add('hidden'); box.innerHTML = ''; };
  let timer = null, seq = 0;

  const show = (items, err) => {
    if (err) { box.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:#c5221f">${esc(err)}</div>`; box.classList.remove('hidden'); return; }
    if (!items.length) return hide();
    box.innerHTML = items.map((t, i) => `<button type="button" data-i="${i}" style="display:block;width:100%;min-height:44px;padding:8px 14px;text-align:left;border:0;border-bottom:1px solid #f1f3f4;background:#fff;font-size:14px;color:#202124">${esc(t)}</button>`).join('')
      + '<div style="padding:4px 14px;text-align:right;font-size:11px;color:#70757a">powered by Google</div>';
    box.classList.remove('hidden');
    box.querySelectorAll('button').forEach((b) => {
      // pointerdown 早于输入框 blur，避免点选前下拉被收起
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.value = items[+b.dataset.i];
        hide();
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = input.value.trim();
    if (v.length < 3 || !navigator.onLine) return hide();
    timer = setTimeout(async () => {
      const my = ++seq;
      try { const items = await suggest(v); if (my === seq) show(items); }
      catch (e) { if (my === seq) show([], '地址联想不可用：' + (e.message || e)); }
    }, 350);
  });
  input.addEventListener('blur', () => setTimeout(hide, 200));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

/* ---------------- Cloud Translation Basic v2 ---------------- */
// 只发送传入的医疗文本；姓名/电话/卡号不会经过这里
export async function translate(text, from, to) {
  if (!hasKey()) throw new Error('未填写 Google API 密钥');
  if (!navigator.onLine) throw new Error('离线');
  const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(state.settings.googleApiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: [text], source: from, target: to, format: 'text' }),
  });
  if (!r.ok) {
    let m = '';
    try { m = (await r.json()).error?.message || ''; } catch { /* ignore */ }
    throw new Error(`翻译失败 (${r.status}) ${m}`);
  }
  const j = await r.json();
  return j.data.translations[0].translatedText;
}
