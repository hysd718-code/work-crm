// 加密工具：密码 → PBKDF2-HMAC-SHA256 → AES-GCM 256 位密钥。全部用浏览器自带的 Web Crypto，无需任何外部库。
// 密文格式："enc1:" + base64( 12 字节随机 IV + 密文 + 16 字节认证标签 )。AES-GCM 自带防篡改：任何一位被改动都会解密失败。
const te = new TextEncoder();
const td = new TextDecoder();

export const ENC = 'enc1:';
export const DEFAULT_ITER = 600000; // OWASP 密码存储备忘录对 PBKDF2-HMAC-SHA256 的建议值（浏览器原生只提供 PBKDF2）
const CHECK_TEXT = 'work-crm-ok';

export const isEnc = (s) => typeof s === 'string' && s.startsWith(ENC);

export const toB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(pass, saltB64, iter = DEFAULT_ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// aad：附加认证数据（不加密，但参与认证）。把密文"绑定"到它所在的位置，防止有人把 A 记录的密文换到 B 记录上。
export async function encryptText(key, text, aad = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, te.encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return ENC + toB64(out);
}

export async function decryptText(key, s, aad = '') {
  if (!isEnc(s)) throw new Error('不是加密数据');
  const raw = fromB64(s.slice(ENC.length));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: te.encode(aad) }, key, raw.subarray(12));
  return td.decode(pt);
}

// 校验口令：加密一句固定的话保存起来，之后能解开说明密码对
export const makeCheck = (key) => encryptText(key, CHECK_TEXT, 'check');
export async function verifyCheck(key, check) {
  try { return (await decryptText(key, check, 'check')) === CHECK_TEXT; } catch { return false; }
}

// ---- 备份文件：每份备份自带随机盐，换设备也能用密码打开 ----
export async function encryptBackup(text, pass) {
  const salt = newSalt();
  const key = await deriveKey(pass, salt, DEFAULT_ITER);
  return { format: 'work-crm-backup', v: 1, enc: true, salt, iter: DEFAULT_ITER, data: await encryptText(key, text, 'backup') };
}
export async function decryptBackup(obj, pass) {
  const key = await deriveKey(pass, obj.salt, obj.iter || DEFAULT_ITER);
  try { return await decryptText(key, obj.data, 'backup'); } catch { throw new Error('备份密码不对，或文件已损坏'); }
}
export const isEncryptedBackup = (o) => !!o && o.format === 'work-crm-backup' && o.enc === true && typeof o.data === 'string';

// 密码强度（只做粗略提示，不上传）：返回 {ok, label}
export function passStrength(p) {
  const s = String(p || '');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
  if (s.length < 8) return { ok: false, label: '太短：至少 8 位' };
  if (/^\d+$/.test(s) && s.length < 12) return { ok: false, label: '纯数字太容易被猜：请加字母，或用 12 位以上数字' };
  if (s.length >= 12 || (s.length >= 10 && classes >= 2)) return { ok: true, label: '强度：较强' };
  return { ok: true, label: '强度：一般（建议 10 位以上，或用 3～4 个词组成的长句）' };
}
