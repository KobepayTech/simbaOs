import {env} from 'cloudflare:workers';
import {cookies} from 'next/headers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {Fault,type Principal,now} from './core';
export function setting(name:string){return (env as unknown as Record<string,string>)[name]||'';}
import {hash} from './crypto';
export {hash,validSignature} from './crypto';
export async function current(db:D1Database):Promise<Principal|null>{
 const token=(await cookies()).get('simba_session')?.value;
 if(token){const s=await db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').bind(await hash(token),now()).first<any>();if(s){const r=await db.prepare('SELECT * FROM roles WHERE principal=?').bind(s.principal).first<any>();const isAdmin=setting('ADMIN_PHONES').split(',').map(x=>x.trim()).includes(s.phone);return {id:s.principal,phone:s.phone,role:isAdmin?'admin':r?.role||'fan',branchId:r?.branch_id||null};}}
 if(setting('TRUST_SITES_AUTH')==='true'){const u=await getChatGPTUser();if(u){const r=await db.prepare('SELECT * FROM roles WHERE principal=?').bind(u.userId).first<any>();const admin=setting('ADMIN_SITES_EMAILS').split(',').map(x=>x.trim().toLowerCase()).includes(u.email.toLowerCase());return {id:u.userId,phone:null,role:admin?'admin':r?.role||'fan',branchId:r?.branch_id||null};}}
 return null;
}
export async function requireUser(db:D1Database){const u=await current(db);if(!u)throw new Fault(401,'Please verify your phone to sign in.');return u;}
export async function limit(db:D1Database,key:string,max:number,seconds:number){const time=Date.now();const k=await hash(key);const r=await db.prepare(`INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<=? THEN 1 ELSE rate_limits.count+1 END,expires=CASE WHEN rate_limits.expires<=? THEN excluded.expires ELSE rate_limits.expires END RETURNING count`).bind(k,time+seconds*1000,time,time).first<any>();if(r.count>max)throw new Fault(429,'Too many attempts. Please try again later.');}
export async function signIn(db:D1Database,phone:string){const token=crypto.randomUUID()+crypto.randomUUID(),expires=new Date(Date.now()+30*86400000).toISOString();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(token),'phone:'+phone,phone,expires).run();(await cookies()).set('simba_session',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:30*86400});}
export async function signOut(db:D1Database){const jar=await cookies(),token=jar.get('simba_session')?.value;if(token)await db.prepare('DELETE FROM sessions WHERE hash=?').bind(await hash(token)).run();jar.set('simba_session','',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});}
