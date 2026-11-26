const {Telegraf,Markup}=require('telegraf');
const {config}=require('./config');
const store=require('./store');
const {summary}=require('./notifications');
const {money}=require('./domain');
function createBot(){
 const bot=new Telegraf(config.token);
 const register=require('./registration').installRegistration(bot);
 const privateOnly=ctx=>ctx.chat?.type==='private';
 const menu=()=>config.publicUrl?Markup.inlineKeyboard([[Markup.button.webApp('🎿 Открыть бронирование',`${config.publicUrl}/mini/`)],[Markup.button.callback('👤 Кабинет исполнителя','cabinet')]]):Markup.inlineKeyboard([[Markup.button.callback('👤 Кабинет исполнителя','cabinet')]]);
 bot.start(async ctx=>{if(!privateOnly(ctx))return;await store.upsertUser(ctx.from);if(ctx.startPayload==='instructor')return register(ctx);await ctx.reply('Добро пожаловать в Архыз Booking!\nЗабронируйте инструктора в приложении.'+(!config.publicUrl?'\nMini App пока не настроен: администратору нужно указать PUBLIC_URL.':''),menu());});
 bot.command('menu',async ctx=>{if(privateOnly(ctx))await ctx.reply('Главное меню',menu());});
 bot.command('id',async ctx=>{if(privateOnly(ctx))await ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`);});
 bot.command('chatid',async ctx=>{if(!privateOnly(ctx))await ctx.reply(`ID чата: ${ctx.chat.id}`);});
 async function cabinet(ctx){if(!privateOnly(ctx))return;const w=await store.worker(String(ctx.from.id));if(!w)return ctx.reply('Кабинет доступен зарегистрированным исполнителям. Заполните анкету через /register и дождитесь подтверждения.');const bs=await store.workerBookings(w.telegram_id);const stats=await store.one(require('./db').pool,`SELECT COALESCE(SUM(payout_amount) FILTER (WHERE status='completed' AND paid_out_at IS NULL),0) due,COALESCE(SUM(payout_amount) FILTER (WHERE paid_out_at IS NOT NULL),0) paid FROM bookings WHERE worker_id=$1`,[w.telegram_id]);await ctx.reply(`👤 ${w.name}\nК выплате вам: ${money(stats.due)}\nВыплачено: ${money(stats.paid)}\nПоследние заказы:`,Markup.inlineKeyboard([[Markup.button.callback('🔄 Обновить','cabinet')]]));for(const b of bs.slice(0,10)){const keys=b.status==='confirmed'?Markup.inlineKeyboard([[Markup.button.callback('Услуга оказана',`done:${b.id}`)]]):{};await ctx.reply(summary(b)+(b.status==='completed'?`\nК выплате: ${money(b.payout_amount)}${b.paid_out_at?' (выплачено)':''}`:''),keys);}if(!bs.length)await ctx.reply('Заказов пока нет.');}
 bot.command('cabinet',cabinet);
 bot.action('cabinet',async ctx=>{await ctx.answerCbQuery();await cabinet(ctx);});
 bot.action(/^claim:(\d+)$/,async ctx=>{try{await store.claim(ctx.match[1],String(ctx.from.id),String(ctx.chat?.id));await require('./db').pool.query('UPDATE workers SET username=$2 WHERE telegram_id=$1',[String(ctx.from.id),ctx.from.username||null]).catch(e=>console.error('Username update:',e.message));await ctx.answerCbQuery('Заказ закреплён за вами!');}catch(e){await ctx.answerCbQuery(e.message.slice(0,180),{show_alert:true});}});
 for(const [key,action] of [['paid','report'],['cancel','cancel'],['done','complete']])bot.action(new RegExp(`^${key}:(\\d+)$`),async ctx=>{try{if(!privateOnly(ctx))throw Error('Откройте личный чат с ботом');const id=ctx.match[1],uid=String(ctx.from.id);const b=action==='report'?await store.report(id,uid):await store.transition(id,`tg:${uid}`,action);await ctx.answerCbQuery('Готово');await ctx.reply(summary(b));}catch(e){await ctx.answerCbQuery(e.message.slice(0,180),{show_alert:true});}});
 bot.command('help',async ctx=>{if(privateOnly(ctx))await ctx.reply(config.support);});
 bot.catch((err,ctx)=>console.error('Telegram update',ctx.update?.update_id,err.message));
 return bot;
}
module.exports={createBot};
