const fs=require('node:fs');
const {config}=require('../config');
const {money,formatDate}=require('../domain');
// Provider contract: create/send instructions; later add bank checkout + verified webhook.
const provider = {
  name:'manual_qr',
  ready:()=>config.demo||fs.existsSync(config.qrPath),
  async send(telegram,b) {
    const text=`Заказ №${b.id}\nИсполнитель: ${b.worker_name}\nСумма: ${money(b.amount)}\nОплатить до ${formatDate(b.deadline)} (МСК).\nВведите точную сумму при переводе. После перевода нажмите «Я оплатил». Не переводите повторно. Если срок истёк, свяжитесь с администратором.`;
    const keyboard={reply_markup:{inline_keyboard:[[{text:'💳 Я оплатил',callback_data:`paid:${b.id}`}],[{text:'Отменить заказ',callback_data:`cancel:${b.id}`}]]}};
    if(config.demo) return telegram.sendMessage(b.customer_id,`🧪 ТЕСТОВЫЙ РЕЖИМ — НЕ ПЕРЕВОДИТЕ ДЕНЬГИ.\n${text}`,keyboard);
    if(!fs.existsSync(config.qrPath)) throw new Error('QR image missing');
    return telegram.sendPhoto(b.customer_id,{source:config.qrPath},{caption:text,...keyboard});
  }
};
module.exports=provider;
