const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const {config}=require('./config');
const pool=new Pool({connectionString:config.database});
pool.on('error',err=>console.error('PostgreSQL:',err.message));
async function init(){await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));}
async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
module.exports={pool,init,tx};
