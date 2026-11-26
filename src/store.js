const {pool,tx}=require('./db');
const {config}=require('./config');
const {price,settlement,interval,instructorUnitPrice}=require('./domain');
const payment=require('./payments');
const one=async(c,q,p=[]) => (await c.query(q,p)).rows[0];
const rows=async(c,q,p=[]) => (await c.query(q,p)).rows;
async function audit(c,id,actor,action){await c.query('INSERT INTO audit_log(booking_id,actor,action) VALUES($1,$2,$3)',[id,actor,action]);}
async function queue(c,id,...kinds){for(const k of kinds)await c.query('INSERT INTO outbox(booking_id,kind) VALUES($1,$2)',[id,k]);}
async function upsertUser(u){return one(pool,`INSERT INTO users(telegram_id,name,username) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET name=EXCLUDED.name,username=EXCLUDED.username,updated_at=now() RETURNING *`,[String(u.id),[u.first_name,u.last_name].filter(Boolean).join(' ')||String(u.id),u.username||null]);}
const services=()=>rows(pool,"SELECT * FROM services WHERE active AND role='instructor' ORDER BY id");
const service=id=>one(pool,"SELECT * FROM services WHERE id=$1 AND active AND role='instructor'",[id]);
const worker=id=>one(pool,'SELECT * FROM workers WHERE telegram_id=$1 AND active',[id]);
const booking=id=>one(pool,`SELECT b.*,u.name customer_name,u.username customer_username,w.username worker_username,p.status payment_status,p.proof_file_id,p.reported_at FROM bookings b JOIN users u ON u.telegram_id=b.customer_id LEFT JOIN payments p ON p.booking_id=b.id LEFT JOIN workers w ON w.telegram_id=b.worker_id WHERE b.id=$1`,[id]);
const userBookings=id=>rows(pool,'SELECT b.*,w.username worker_username FROM bookings b LEFT JOIN workers w ON w.telegram_id=b.worker_id WHERE b.customer_id=$1 ORDER BY b.created_at DESC LIMIT 50',[id]);
const workerBookings=id=>rows(pool,`SELECT b.*,u.name customer_name,u.username customer_username FROM bookings b JOIN users u ON u.telegram_id=b.customer_id WHERE worker_id=$1 ORDER BY starts_at DESC LIMIT 30`,[id]);
async function createBooking(customer,d) {
 return tx(async c=>{
  const existing=await one(c,'SELECT * FROM bookings WHERE request_key=$1 AND customer_id=$2',[d.key,customer]);if(existing)return existing;
  const s=await one(c,"SELECT * FROM services WHERE id=$1 AND active AND role='instructor' FOR SHARE",[d.service]);if(!s)throw Error('Услуга недоступна');
  const group=s.role==='rental'?config.rentalGroup:config.instructorGroup;
  if(!group)throw Error('Чат заявок не настроен. Обратитесь к администратору.');
  if(!payment.ready())throw Error('Оплата пока не настроена. Обратитесь к администратору.');
  const [start,end]=interval(d.date,d.time,d.duration,s.role);
  if(start<=new Date())throw Error('Выбранное время уже прошло');
  const amount=price(d.level==='Дети'?s.child_price:s.unit_price,d.duration,d.quantity,s.role);
  if(amount!==d.amount)throw Error('Цена изменилась. Начните бронирование заново.');
  const b=await one(c,`INSERT INTO bookings(customer_id,service_id,service_name,role,starts_at,ends_at,quantity,duration,details,amount,status,deadline,group_id,request_key,child_rate)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',LEAST(now()+$11*interval '1 minute',$5::timestamptz),$12,$13,$14) ON CONFLICT(request_key) DO NOTHING RETURNING *`,[customer,s.id,s.name,s.role,start,end,d.quantity,d.duration,d.details,amount,config.requestMinutes,group,d.key,d.level==='Дети']);
  if(!b){const prior=await one(c,'SELECT * FROM bookings WHERE request_key=$1 AND customer_id=$2',[d.key,customer]);if(!prior)throw Error('Не удалось создать заказ. Повторите попытку.');return prior;}
  await audit(c,b.id,`tg:${customer}`,'created');await queue(c,b.id,'group','admin_new');return b;
 });
}
async function claim(id,workerId,chatId) {
 return tx(async c=>{
  const b=await one(c,'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[id]);
  if(!b||String(b.group_id)!==String(chatId))throw Error('Заявка недоступна');
  if(b.role!=='instructor'||b.status!=='open'||+new Date(b.deadline)<=Date.now()||+new Date(b.starts_at)<=Date.now())throw Error('Заявку уже забрали или срок истёк');
  const w=await one(c,'SELECT * FROM workers WHERE telegram_id=$1 AND active FOR UPDATE',[workerId]);
  if(!w||w.deleted_at||w.registration_status!=='approved'||w.role!==b.role)throw Error('У вас нет доступа к этой заявке');
  if((b.service_id==='ski'||b.service_id==='rent_ski')&&!w.ski||(b.service_id==='snowboard'||b.service_id==='rent_snowboard')&&!w.snowboard)throw Error('Эта услуга не входит в вашу специализацию');
  if(b.role==='instructor'){
   const busy=await one(c,`SELECT id FROM bookings WHERE worker_id=$1 AND status IN ('awaiting_payment','payment_review','confirmed','completed') AND starts_at<$3 AND ends_at>$2 AND (status<>'awaiting_payment' OR deadline>now()) LIMIT 1`,[workerId,b.starts_at,b.ends_at]);
   if(busy)throw Error('На это время у вас уже есть заказ');
  }
  const svc=await one(c,'SELECT * FROM services WHERE id=$1 FOR SHARE',[b.service_id]);
  const unit=instructorUnitPrice(svc,w,b.child_rate);
  const amount=price(unit,b.duration,b.quantity,b.role);
  const {commission,payout}=settlement(amount,w.commission_type,w.commission_value);
  const updated=await one(c,`UPDATE bookings SET status='awaiting_payment',worker_id=$2,worker_name=$3,commission_amount=$4,payout_amount=$5,amount=$7,deadline=LEAST(now()+$6*interval '1 minute',starts_at),updated_at=now() WHERE id=$1 RETURNING *`,[id,workerId,w.name,commission,payout,config.paymentMinutes,amount]);
  await c.query(`INSERT INTO payments(booking_id,amount,status,provider) VALUES($1,$2,'pending',$3)`,[id,amount,payment.name]);
  await audit(c,id,`tg:${workerId}`,'claimed');await queue(c,id,'group','payment','worker_claim');return updated;
 });
}
async function report(id,customer){return tx(async c=>{
 const b=await one(c,'SELECT * FROM bookings WHERE id=$1 AND customer_id=$2 FOR UPDATE',[id,customer]);if(!b||!b.worker_id)throw Error('Заказ недоступен');
 if(b.status==='payment_review'||b.status==='refund_review')return b;
 if(!['awaiting_payment','expired','cancelled'].includes(b.status))throw Error('Оплата для этого заказа уже обработана');
 const late=b.status!=='awaiting_payment'||+new Date(b.deadline)<=Date.now();
 const status=late?'refund_review':'payment_review';
 const u=await one(c,`UPDATE bookings SET status=$2,deadline=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[id,status]);
 await c.query(`UPDATE payments SET status=$2,reported_at=now() WHERE booking_id=$1`,[id,late?'refund_review':'reported']);
 await audit(c,id,`tg:${customer}`,late?'late_payment_reported':'payment_reported');await queue(c,id,'group','admin_report');return u;
});}
async function transition(id,actor,action){return tx(async c=>{
 const b=await one(c,'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[id]);if(!b)throw Error('Заказ не найден');
 const isAdmin=actor==='admin', tg=actor.startsWith('tg:')?actor.slice(3):null;
 const isCustomer=tg===String(b.customer_id), isWorker=tg!==null&&tg===String(b.worker_id)&&!!(await one(c,'SELECT telegram_id FROM workers WHERE telegram_id=$1 AND active',[tg]));
 let status, payStatus, kinds=['group'];
 if(action==='confirm'&&isAdmin&&b.status==='payment_review'){
  if(+new Date(b.starts_at)<=Date.now())throw Error('Время занятия уже наступило. Проверьте перевод и оформите возврат или согласуйте заказ вручную.');
  status='confirmed';payStatus='verified';kinds.push('customer_confirm','worker_confirm');
 }else if(action==='reject_payment'&&isAdmin&&b.status==='payment_review'){
  status='cancelled';payStatus='closed';kinds.push('customer_closed','worker_closed');
 }else if(action==='complete'&&(isAdmin||isWorker)&&b.status==='confirmed'){
  if(+new Date(b.starts_at)>Date.now()&&!config.demo)throw Error('Услуга ещё не началась');
  status='completed';kinds.push('customer_complete','worker_complete');
 }else if(action==='cancel'&&(isAdmin||isCustomer)&&['open','awaiting_payment'].includes(b.status)){
  status='cancelled';payStatus='closed';kinds.push('customer_closed');if(b.worker_id)kinds.push('worker_closed');
 }else if(action==='refund_review'&&isAdmin&&['payment_review','confirmed'].includes(b.status)){
  status='refund_review';payStatus='refund_review';kinds.push('customer_refund','worker_closed');
 }else if(action==='refund_done'&&isAdmin&&b.status==='refund_review'){
  status='refunded';payStatus='refunded';kinds.push('customer_refunded');
 }else if(action==='no_payment'&&isAdmin&&b.status==='refund_review'){
  status='cancelled';payStatus='closed';kinds.push('customer_closed');
 }else if(action==='payout'&&isAdmin&&b.status==='completed'&&!b.paid_out_at){
  const u=await one(c,'UPDATE bookings SET paid_out_at=now(),updated_at=now() WHERE id=$1 RETURNING *',[id]);await audit(c,id,actor,'payout_marked');await queue(c,id,'worker_payout');return u;
 }else throw Error('Действие недоступно для этого заказа');
 const u=await one(c,'UPDATE bookings SET status=$2,deadline=NULL,updated_at=now() WHERE id=$1 RETURNING *',[id,status]);
 if(payStatus)await c.query(`UPDATE payments SET status=$2,verified_at=CASE WHEN $2='verified' THEN now() ELSE verified_at END,refunded_at=CASE WHEN $2='refunded' THEN now() ELSE refunded_at END WHERE booking_id=$1`,[id,payStatus]);
 await audit(c,id,actor,action);await queue(c,id,...kinds);return u;
});}
async function expire(){return tx(async c=>{
 const expired=await rows(c,`UPDATE bookings SET status='expired',updated_at=now() WHERE status IN ('open','awaiting_payment') AND deadline<=now() RETURNING id,worker_id`);
 for(const b of expired){await c.query(`UPDATE payments SET status='closed' WHERE booking_id=$1 AND status='pending'`,[b.id]);await audit(c,b.id,'system','expired');await queue(c,b.id,'group','customer_closed',...(b.worker_id?['worker_closed']:[]));}return expired.length;
});}
module.exports={one,rows,audit,queue,upsertUser,services,service,worker,booking,userBookings,workerBookings,createBooking,claim,report,transition,expire};
