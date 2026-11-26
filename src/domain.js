const ZONE = 'Europe/Moscow';
const statuses = {open:'Ищем исполнителя',awaiting_payment:'Ожидает оплаты',payment_review:'Проверка оплаты',confirmed:'Подтверждён',completed:'Услуга оказана',cancelled:'Отменён',expired:'Срок истёк',refund_review:'Проверка / возврат',refunded:'Возвращён'};
const money = n => `${Number(n).toLocaleString('ru-RU')} ₽`;
const dateKey = d => new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function dates(now = new Date(), count = 21) {
  const start = Date.parse(`${dateKey(now)}T12:00:00+03:00`);
  return Array.from({length:count},(_,i)=>dateKey(new Date(start+i*86400000)));
}
function interval(date,time,duration,role) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Некорректные дата или время');
  const start = new Date(`${date}T${time}:00+03:00`);
  if (!Number.isFinite(+start)||dateKey(start)!==date) throw new Error('Некорректная дата');
  return [start,new Date(+start+duration*(role==='rental'?86400000:3600000))];
}
const formatDate = d => new Intl.DateTimeFormat('ru-RU',{timeZone:ZONE,dateStyle:'short',timeStyle:'short'}).format(new Date(d));
function price(unit,duration,quantity,role) {return unit*duration*(role==='rental'?quantity:1);}
function instructorUnitPrice(service,worker,child=false) {
  return worker?.[service.id+(child?'_child_price':'_price')] ?? (child?service.child_price:service.unit_price);
}
function settlement(amount,type,value) {
  const commission = Math.min(amount,type==='percent'?Math.round(amount*value/100):value);
  return {commission,payout:amount-commission};
}
function availableTimes(date,duration,now=new Date()) {
  return Array.from({length:10},(_,i)=>`${String(i+8).padStart(2,'0')}:00`).filter(t=>Number(t.slice(0,2))+duration<=18&&interval(date,t,duration,'instructor')[0]>now);
}
module.exports={instructorUnitPrice,statuses,money,dates,interval,formatDate,price,settlement,availableTimes};
