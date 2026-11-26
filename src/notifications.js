const {pool}=require('./db');
const store=require('./store');
const {config}=require('./config');
const {statuses,money,formatDate}=require('./domain');
function summary(b){return `Заявка №${b.id}\n${b.service_name}\n📅 ${formatDate(b.starts_at)} — ${formatDate(b.ends_at)} (МСК)\n👥 ${b.quantity} ${b.role==='rental'?'компл.':'чел.'}\n${b.details}\n💰 ${b.status==='open'?'Базовая цена '+money(b.amount)+' (итог по тарифу инструктора)':money(b.amount)}\n${statuses[b.status]}`;}
function contact(id,name,username){return username?`@${username}`:`${name||'Пользователь'} (Telegram ID ${id})`;}
function contactKeyboard(id,name){return {text:name,url:`tg://user?id=${id}`};}
async function sendGroup(t,b){
 const text=`${b.status==='open'?'🔔 Новая заявка':'📋 Заказ'}\n${summary(b)}${b.worker_name?`\nИсполнитель: ${b.worker_name}`:''}`;
 const markup={inline_keyboard:b.status==='open'?[[{text:'✅ Принять заказ',callback_data:`claim:${b.id}`}]]:[]};
 if(b.group_message_id){try{await t.editMessageText(b.group_id,Number(b.group_message_id),undefined,text,{reply_markup:markup});return;}catch(e){if(/message is not modified/i.test(e.message))return;if(!/message to edit not found|message can't be edited/i.test(e.message))throw e;}}
 if(b.status!=='open')return;
 const m=await t.sendMessage(b.group_id,text,{reply_markup:markup});await pool.query('UPDATE bookings SET group_message_id=$2 WHERE id=$1',[b.id,m.message_id]);
}
async function dispatch(t,b,kind){
 const send=(id,text,extra)=>id&&String(id)!=='999000000001'?t.sendMessage(id,text,extra):Promise.resolve();
 const customer=b.customer_id,worker=b.worker_id;
 const closeStatuses=['cancelled','expired','refund_review','refunded'];
 switch(kind){
 case 'group':return sendGroup(t,b);
 case 'admin_new':case 'admin_report':{
  if(kind==='admin_new'&&b.status!=='open')return;
  if(kind==='admin_report'&&!['payment_review','refund_review'].includes(b.status))return;
  const msg=kind==='admin_new'?'Новая заявка':'⚠️ Клиент сообщил об оплате. Проверьте банковский перевод в CRM.';
  let delivered=0;let error;for(const a of config.admins){try{await send(a,`${msg}\n${summary(b)}`,config.publicUrl?{reply_markup:{inline_keyboard:[[{text:'Открыть CRM',url:config.publicUrl+'/admin/mobile/'}]]}}:undefined);delivered++;}catch(e){error=e;console.error('Admin notification:',e.message);}}if(kind==='admin_report'&&!delivered&&!config.demo)throw error||Error('Не настроены ID администраторов');return;
 }
 case 'payment':if(b.status==='awaiting_payment')return send(customer,`Заказ №${b.id} принят. Итоговая стоимость: ${money(b.amount)}. Откройте Мои заказы в приложении для оплаты.`,config.publicUrl?{reply_markup:{inline_keyboard:[[{text:'Открыть заказ',web_app:{url:config.publicUrl+'/mini/?orders=1'}}]]}}:undefined);return;
 case 'worker_claim':if(['awaiting_payment','payment_review'].includes(b.status))return send(worker,`Вы приняли заказ №${b.id}. Ожидаем подтверждения оплаты.\n${summary(b)}`);return;
 case 'customer_confirm':if(['confirmed','completed'].includes(b.status))return send(customer,`✅ Оплата подтверждена!\n${summary(b)}\nИсполнитель: ${b.worker_name}`,{reply_markup:{inline_keyboard:[[b.worker_username?{text:'Связаться с исполнителем',url:'https://t.me/'+b.worker_username}:contactKeyboard(worker,'Связаться с исполнителем')]]}});return;
 case 'worker_confirm':if(b.status==='confirmed')return send(worker,`✅ Заказ оплачен.\n${summary(b)}\nКлиент: ${contact(customer,b.customer_name,b.customer_username)}`,{reply_markup:{inline_keyboard:[[contactKeyboard(customer,'Связаться с клиентом')],[{text:'Услуга оказана',callback_data:`done:${b.id}`}]]}});return;
 case 'customer_complete':if(b.status==='completed')return send(customer,`Спасибо! Услуга по заказу №${b.id} отмечена как оказанная.`);return;
 case 'worker_complete':if(b.status==='completed')return send(worker,`Заказ №${b.id} выполнен. К выплате: ${money(b.payout_amount)}.`);return;
 case 'worker_payout':if(b.paid_out_at)return send(worker,`В CRM отмечена выплата ${money(b.payout_amount)} по заказу №${b.id}.`);return;
 case 'customer_closed':if(closeStatuses.includes(b.status))return send(customer,`Заказ №${b.id}: ${statuses[b.status]}. Если вы уже перевели деньги, сообщите администратору и сообщите о переводе в разделе «Мои заказы».`);return;
 case 'worker_closed':if(closeStatuses.includes(b.status))return send(worker,`Заказ №${b.id}: ${statuses[b.status]}.`);return;
 case 'customer_refund':if(b.status==='refund_review')return send(customer,`Заказ №${b.id} передан администратору на проверку/возврат. Не переводите деньги повторно.`);return;
 case 'customer_refunded':if(b.status==='refunded')return send(customer,`Администратор отметил возврат средств по заказу №${b.id}. Проверьте поступление.`);return;
 default:throw Error('Unknown notification '+kind);
 }
}
function startNotifications(t){let running=false;async function tick(){if(running)return;running=true;try{
 await store.expire();
 const pending=await store.rows(pool,`SELECT * FROM outbox WHERE sent_at IS NULL AND available_at<=now() AND attempts<12 ORDER BY id LIMIT 50`);
 for(const item of pending){try{const b=await store.booking(item.booking_id);if(b)await dispatch(t,b,item.kind);await pool.query('UPDATE outbox SET sent_at=now(),last_error=NULL WHERE id=$1',[item.id]);}catch(e){console.error('Notification',item.id,e.message);await pool.query(`UPDATE outbox SET attempts=attempts+1,last_error=$2,available_at=now()+LEAST(300,5*power(2,attempts))*interval '1 second' WHERE id=$1`,[item.id,String(e.message).slice(0,500)]);}}
 }catch(e){console.error('Background:',e.message);}finally{running=false;}}
 const timer=setInterval(tick,2000);void tick();return ()=>clearInterval(timer);
}
module.exports={startNotifications,summary,contactKeyboard};
