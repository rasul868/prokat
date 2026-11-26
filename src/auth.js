const crypto = require('node:crypto');
function verifyInitData(raw, token, now = Date.now()) {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) throw Error('Откройте приложение через Telegram');
  const p = new URLSearchParams(raw), entries = [...p.entries()];
  if (new Set(entries.map(([k])=>k)).size !== entries.length) throw Error('Некорректные данные Telegram');
  const hash=p.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) throw Error('Некорректная подпись Telegram');
  p.delete('hash');
  const check=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  const expected=crypto.createHmac('sha256',secret).update(check).digest();
  if(!crypto.timingSafeEqual(expected,Buffer.from(hash,'hex'))) throw Error('Подпись Telegram недействительна');
  const date=Number(p.get('auth_date'));
  if(!Number.isSafeInteger(date)||date>now/1000+60||now/1000-date>86400) throw Error('Сессия устарела. Откройте Mini App заново.');
  let user;try{user=JSON.parse(p.get('user'));}catch{throw Error('Telegram не передал пользователя');}
  if(!user||!Number.isSafeInteger(user.id)||user.id<=0)throw Error('Некорректный пользователь Telegram');
  return user;
}
function safeEqual(a,b){return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());}
module.exports={verifyInitData,safeEqual};
