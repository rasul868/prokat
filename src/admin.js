const {pool,tx}=require('./db');
const store=require('./store');
const {config}=require('./config');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Telegraf}=require('telegraf');
const priceFields=['ski_price','snowboard_price','ski_child_price','snowboard_child_price'];
const validPrice=v=>Number.isInteger(v)&&v>=1&&v<=1000000;
const fail=m=>Object.assign(Error(m),{status:400});
async function saveWorker(w){
 if(!/^\d{1,18}$/.test(String(w.telegram_id||'')))throw fail('Выберите инструктора');
 if(!['fixed','percent'].includes(w.commission_type))throw fail('Выберите тип комиссии');
 if(!Number.isInteger(w.commission_value)||w.commission_value<0||w.commission_value>(w.commission_type==='percent'?100:1000000))throw fail(w.commission_type==='percent'?'Процент комиссии должен быть от 0 до 100':'Фиксированная комиссия должна быть от 0 до 1 000 000 ₽');
 if(typeof w.active!=='boolean')throw fail('Укажите доступ исполнителя');
 for(const k of priceFields)if(w[k]!==null&&!validPrice(w[k]))throw fail('Цена должна быть целым числом от 1 до 1 000 000 ₽ или пустой (общий тариф)');
 const old=await tx(async c=>{const old=await store.one(c,"SELECT * FROM workers WHERE telegram_id=$1 AND role='instructor' AND deleted_at IS NULL FOR UPDATE",[w.telegram_id]);if(!old)throw fail('Анкета не найдена');await c.query(`UPDATE workers SET commission_type=$2,commission_value=$3,active=$4,registration_status=CASE WHEN $4 THEN 'approved' ELSE registration_status END,ski_price=$5,snowboard_price=$6,ski_child_price=$7,snowboard_child_price=$8 WHERE telegram_id=$1`,[w.telegram_id,w.commission_type,w.commission_value,w.active,...priceFields.map(k=>w[k])]);await store.audit(c,null,'admin',`worker_saved:${w.telegram_id}`);return old;});
 if(w.active&&!old.active){const t=new Telegraf(config.token).telegram;try{await t.sendMessage(w.telegram_id,'Ваша анкета подтверждена. Теперь вы можете принимать заявки в группе. Кабинет: /cabinet');}catch(e){console.error('Approval notification:',e.message);}}
}
async function deleteWorker(id){return tx(async c=>{const w=await store.one(c,'SELECT * FROM workers WHERE telegram_id=$1 AND deleted_at IS NULL FOR UPDATE',[id]);if(!w)throw fail('Инструктор не найден');const b=await store.one(c,"SELECT id FROM bookings WHERE worker_id=$1 AND status IN ('awaiting_payment','payment_review','confirmed','refund_review') LIMIT 1",[id]);if(b)throw fail('У инструктора есть незавершённый заказ №'+b.id+'. Сначала обработайте его.');await c.query('UPDATE workers SET active=false,deleted_at=now() WHERE telegram_id=$1',[id]);await store.audit(c,null,'admin','worker_deleted:'+id);});}
async function deleteOrder(id){const b=await store.booking(id);if(!b)throw fail('Заказ не найден');if(['open','awaiting_payment'].includes(b.status))await store.transition(id,'admin','cancel');return tx(async c=>{const b=await store.one(c,'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[id]);if(!b||!['cancelled','expired','refunded','completed'].includes(b.status))throw fail('Сначала завершите заказ или оформите возврат.');if(b.status==='completed'&&!b.paid_out_at)throw fail('Сначала отметьте выплату инструктору.');await c.query('UPDATE bookings SET deleted_at=now() WHERE id=$1',[id]);await store.audit(c,id,'admin','order_hidden');});}
async function settings(){let qr=false;try{qr=(await fs.stat(config.qrPath)).isFile();}catch{}return {qr,mode:'manual',apiConfigured:!!(config.apiProvider&&config.apiKey),apiReady:false,provider:config.apiProvider||'Не выбран',demo:config.demo};}
async function uploadQr(body){const m=String(body.image||'').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);if(!m)throw fail('Выберите PNG или JPEG');const buf=Buffer.from(m[2],'base64');if(buf.length>4*1024*1024||buf.length<12)throw fail('Размер изображения — до 4 МБ');const png=buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpeg=buf[0]===255&&buf[1]===216&&buf[2]===255;if(!(m[1]==='png'?png:jpeg))throw fail('Неверный формат изображения');await fs.mkdir(path.dirname(config.qrPath),{recursive:true});const tmp=config.qrPath+'.'+require('node:crypto').randomUUID()+'.tmp';await fs.writeFile(tmp,buf,{mode:0o600});await fs.rename(tmp,config.qrPath);}
module.exports={saveWorker,deleteWorker,deleteOrder,settings,uploadQr,validPrice};
