const {config,validate}=require('./config');
const {init,pool}=require('./db');
const {createBot}=require('./bot');
const {createWeb}=require('./web');
const {startNotifications}=require('./notifications');
async function main(){validate();await init();const bot=createBot();await bot.telegram.getMe();await bot.telegram.setMyCommands([{command:'start',description:'Открыть меню'},{command:'cabinet',description:'Кабинет исполнителя'},{command:'register',description:'Анкета инструктора'},{command:'id',description:'Мой Telegram ID'},{command:'help',description:'Помощь'}]);
 const server=createWeb().listen(config.port,config.host,()=>console.log(`CRM: http://localhost:${config.port}/admin/\nMini App: http://localhost:${config.port}/mini/`));
 const stop=startNotifications(bot.telegram);let stopping=false;async function shutdown(){if(stopping)return;stopping=true;stop();try{bot.stop();}catch{}server.close();server.closeAllConnections?.();await pool.end();}process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 console.log('Бот запускается.');try{await bot.launch({dropPendingUpdates:false});}catch(e){console.error('Ошибка бота:',e.message);await shutdown();process.exitCode=1;}}
 main().catch(async e=>{console.error(e.message);await pool.end().catch(()=>{});process.exitCode=1;});
