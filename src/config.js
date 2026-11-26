require('dotenv').config();
const path = require('node:path');
function integer(name, fallback, min, max) {
  const x = Number(process.env[name] || fallback);
  if (!Number.isInteger(x) || x < min || x > max) throw new Error(`Некорректное значение ${name}`);
  return x;
}
function chatId(value, group = false) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (!(group ? /^-\d+$/ : /^\d+$/).test(v)) throw new Error(`Некорректный Telegram ID: ${v}`);
  return v;
}
const config = {
  token: process.env.BOT_TOKEN?.trim(), database: process.env.DATABASE_URL,
  port: integer('PORT',3000,1,65535), host: process.env.HOST || '127.0.0.1',
  adminUser: process.env.ADMIN_USER || 'admin', adminPassword: process.env.ADMIN_PASSWORD || '',
  instructorGroup: chatId(process.env.INSTRUCTOR_GROUP_ID,true),
  rentalGroup: chatId(process.env.RENTAL_GROUP_ID,true),
  admins: (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(s=>chatId(s)).filter(Boolean),
  qrPath: path.resolve(__dirname,'..',process.env.QR_IMAGE_PATH || 'assets/payment-qr.png'),
  paymentMinutes: integer('PAYMENT_MINUTES',20,1,120), requestMinutes: integer('REQUEST_MINUTES',30,1,1440),
  demo: process.env.DEMO_MODE === 'true',
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/,''),
  localPreview: process.env.LOCAL_PREVIEW === 'true',
  apiProvider: process.env.PAYMENT_API_PROVIDER || '',
  apiKey: process.env.PAYMENT_API_KEY || '',
  apiShopId: process.env.PAYMENT_API_SHOP_ID || '',
  support: process.env.SUPPORT_TEXT || 'Для помощи обратитесь к администратору.'
};
config.rentalGroup ||= config.instructorGroup;
function validate() {
  if (!config.token || !config.database) throw new Error('Укажите BOT_TOKEN и DATABASE_URL в .env');
  if (config.adminPassword.length < 12 || config.adminPassword === 'CHANGE_THIS_LONG_PASSWORD') throw new Error('Задайте собственный ADMIN_PASSWORD (минимум 12 символов)');
  if (config.publicUrl && !/^https:\/\/[^/]+$/.test(config.publicUrl)) throw new Error('PUBLIC_URL должен быть HTTPS-адресом без пути');
  if (!config.demo && !config.admins.length) throw new Error('Для реальной оплаты укажите ADMIN_TELEGRAM_IDS');
  if (!config.demo && config.localPreview) throw new Error('Отключите LOCAL_PREVIEW для реальной оплаты');
  if (!config.demo && !config.publicUrl) throw new Error('В рабочем режиме требуется PUBLIC_URL');
  if (!config.instructorGroup) console.warn('INSTRUCTOR_GROUP_ID не задан: запустите бота, получите /chatid, затем перезапустите.');
}
module.exports = {config,validate};
