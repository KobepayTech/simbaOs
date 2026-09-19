import {category,regions,reminderDate} from '../membership.ts';
export class Fault extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export type Principal={id:string;phone:string|null;role:string;branchId:string|null};
export const defaults={prices:{'Standard':0,'First 100':0,'Prestige':0,'Repeated digits':0},months:12,reservationMinutes:15,remind7:true,remind1:true,renewalPoints:50,referralPoints:25};
export const now=()=>new Date().toISOString();
export const id=()=>crypto.randomUUID();
export function monthsAfter(value:string,months:number){const d=new Date(value),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString();}
export async function config(db:D1Database){const r:any=await db.prepare('SELECT value FROM settings WHERE id=1').first();return r?JSON.parse(r.value):defaults;}
export async function member(db:D1Database,user:Principal){return db.prepare(`SELECT m.*,p.ordinal,p.district,p.locale,p.verified_phone,p.referrer,p.card_token,h.number,h.expires,COALESCE(w.points,0) AS points FROM members m LEFT JOIN profiles p ON p.member_id=m.id LEFT JOIN holdings h ON h.member_id=m.id AND h.expires>? LEFT JOIN wallets w ON w.member_id=m.id WHERE m.user_id=?`).bind(now(),user.id).first<any>();}
export async function needMember(db:D1Database,u:Principal){const m=await member(db,u);if(!m)throw new Fault(409,'Create your membership profile first.');return m;}
export function admin(u:Principal){if(u.role!=='admin')throw new Fault(403,'Club administrator access is required.');}
export function sameOrigin(req:Request){if(req.headers.get('origin')!==new URL(req.url).origin)throw new Fault(403,'Invalid request origin.');}
export function auditStmt(db:D1Database,u:Principal,action:string,target:string){return db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').bind(id(),u.id,action,target,now());}
export async function register(db:D1Database,u:Principal,b:any){
 if(!u.phone)throw new Fault(403,'Verify your phone before registering.');
 const existing=await member(db,u);if(existing)return existing;
 category(b.number);const mid=id();const ref=b.referrer?await db.prepare('SELECT m.id FROM members m JOIN profiles p ON p.member_id=m.id WHERE p.card_token=? AND m.user_id<>?').bind(b.referrer,u.id).first<any>():null;
 await db.batch([db.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?)').bind(mid,u.id,b.name,u.phone,b.region,b.number,now()),db.prepare('INSERT INTO profiles(member_id,district,locale,verified_phone,referrer,card_token) VALUES(?,?,?,?,?,?)').bind(mid,b.district,b.locale,u.phone,ref?.id||null,id()),db.prepare('INSERT INTO wallets VALUES(?,0)').bind(mid),auditStmt(db,u,'register',mid)]);
 return member(db,u);
}
export async function availability(db:D1Database,n:number){const tier=category(n),time=now();const held=await db.prepare('SELECT number FROM holdings WHERE number=? AND expires>?').bind(n,time).first();const reserved=await db.prepare('SELECT expires FROM reservations WHERE number=? AND expires>?').bind(n,time).first<any>();const c=await config(db);return {number:n,tier,available:!held&&!reserved,held:!!held,reservedUntil:reserved?.expires||null,price:c.prices[tier],months:c.months};}
export async function reserve(db:D1Database,u:Principal,n:number){
 const m=await needMember(db,u);if(!m.verified_phone)throw new Fault(403,'Verified phone required.');const tier=category(n),c=await config(db),amount=c.prices[tier];if(!amount)throw new Fault(409,'The club has not published prices yet.');
 if(m.number&&m.number!==n)throw new Fault(409,'Renew your existing number while your membership is active.');
 const time=now(),oid=id(),holdUntil=new Date(Date.now()+c.reservationMinutes*60000).toISOString(),expiry=monthsAfter(m.expires&&m.expires>time?m.expires:time,c.months);
 const existing=await db.prepare(`SELECT o.*,r.expires AS reservation_expires FROM orders o JOIN reservations r ON r.order_id=o.id WHERE o.member_id=? AND r.expires>? AND o.status IN ('reserved','pending')`).bind(m.id,time).first<any>();
 if(existing){if(existing.number!==n)throw new Fault(409,'Finish or wait for your current number reservation to expire.');return existing;}
 await db.batch([
 db.prepare('DELETE FROM reservations WHERE member_id=? AND expires<=?').bind(m.id,time),
 db.prepare(`INSERT INTO reservations(number,member_id,order_id,expires) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM holdings WHERE number=? AND expires>? AND member_id<>?) ON CONFLICT(number) DO UPDATE SET member_id=excluded.member_id,order_id=excluded.order_id,expires=excluded.expires WHERE reservations.expires<=?`).bind(n,m.id,oid,holdUntil,n,time,m.id,time),
 db.prepare(`INSERT INTO orders(id,member_id,number,amount,currency,expires,status,created) SELECT ?,?,?,?,'TZS',?,'reserved',? FROM reservations WHERE order_id=?`).bind(oid,m.id,n,amount,expiry,time,oid)
 ]);
 const o=await db.prepare('SELECT * FROM orders WHERE id=?').bind(oid).first<any>();if(!o)throw new Fault(409,'Number was just reserved or assigned. Please choose another.');return {...o,reservation_expires:holdUntil};
}
export async function applyPayment(db:D1Database,b:any,digest:string){
 const o=await db.prepare('SELECT * FROM orders WHERE id=?').bind(b.orderId).first<any>();if(!o)throw new Fault(404,'Unknown order');
 if(o.amount!==b.amount||o.currency!==b.currency)throw new Fault(400,'Payment amount or currency mismatch');
 const previous=await db.prepare('SELECT digest FROM payment_events WHERE id=?').bind(b.eventId).first<any>();if(previous){if(previous.digest!==digest)throw new Fault(409,'Event ID reused with different content');return {duplicate:true};}
 if(o.status==='paid'||o.status==='review'){if(o.receipt!==b.receipt)throw new Fault(409,'Order already settled');return {duplicate:true};}
 const time=now(),c=await config(db);
 // Assignment requires a still-valid reservation; a late paid event enters review.
 await db.batch([
 db.prepare('INSERT INTO payment_events VALUES(?,?,?,?)').bind(b.eventId,o.id,digest,time),
 db.prepare('DELETE FROM holdings WHERE member_id=? AND number<>? AND expires<=? AND EXISTS(SELECT 1 FROM reservations WHERE order_id=? AND expires>?)').bind(o.member_id,o.number,time,o.id,time),
 db.prepare(`INSERT INTO holdings(number,member_id,expires,paid_at) SELECT o.number,o.member_id,o.expires,? FROM orders o JOIN reservations r ON r.order_id=o.id WHERE o.id=? AND o.status IN ('reserved','pending') AND r.expires>? AND NOT EXISTS(SELECT 1 FROM holdings h WHERE h.member_id=o.member_id AND h.number<>o.number AND h.expires>?) ON CONFLICT(number) DO UPDATE SET member_id=excluded.member_id,expires=excluded.expires,paid_at=excluded.paid_at WHERE holdings.expires<=? OR (holdings.member_id=excluded.member_id AND holdings.expires<excluded.expires)`).bind(time,o.id,time,time,time),
 db.prepare(`UPDATE orders SET receipt=?,paid_at=?,status=CASE WHEN EXISTS(SELECT 1 FROM holdings h WHERE h.number=orders.number AND h.member_id=orders.member_id AND h.expires=orders.expires) THEN 'paid' ELSE 'review' END WHERE id=? AND status IN ('reserved','pending')`).bind(b.receipt,time,o.id),
 db.prepare(`INSERT OR IGNORE INTO points SELECT 'payment:'||id,member_id,?,'Membership renewal',? FROM orders WHERE id=? AND status='paid'`).bind(c.renewalPoints,time,o.id),
 db.prepare(`INSERT OR IGNORE INTO points SELECT 'referral:'||o.member_id,p.referrer,?,'Verified referral',? FROM orders o JOIN profiles p ON p.member_id=o.member_id WHERE o.id=? AND o.status='paid' AND p.referrer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orders old WHERE old.member_id=o.member_id AND old.status='paid' AND old.id<>o.id)`).bind(c.referralPoints,time,o.id),
 db.prepare(`UPDATE wallets SET points=COALESCE((SELECT SUM(amount) FROM points WHERE points.member_id=wallets.member_id),0) WHERE member_id=? OR member_id=(SELECT referrer FROM profiles WHERE member_id=?)`).bind(o.member_id,o.member_id),
 ...[{label:'month',due:reminderDate(o.expires)},...(c.remind7?[{label:'7days',due:new Date(Date.parse(o.expires)-7*86400000).toISOString()}]:[]),...(c.remind1?[{label:'1day',due:new Date(Date.parse(o.expires)-86400000).toISOString()}]:[])].map(r=>db.prepare(`INSERT OR IGNORE INTO reminders(id,member_id,expiry,due,status) SELECT ?,member_id,expires,?,'pending' FROM orders WHERE id=? AND status='paid'`).bind('renew:'+o.member_id+':'+o.expires+':'+r.label,r.due,o.id)),
 db.prepare('DELETE FROM reservations WHERE order_id=?').bind(o.id),
 db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').bind(id(),'payment-gateway','payment-confirmed',o.id,time)
 ]);
 return db.prepare('SELECT id,status FROM orders WHERE id=?').bind(o.id).first();
}
export async function claimBenefit(db:D1Database,u:Principal,benefitId:string){
 const m=await needMember(db,u),token=id(),time=now();
 const previous=await db.prepare('SELECT * FROM claims WHERE member_id=? AND benefit_id=?').bind(m.id,benefitId).first();if(previous)return previous;
 const b=await db.prepare('SELECT * FROM benefits WHERE id=? AND active=1 AND expires>?').bind(benefitId,time).first<any>();if(!b)throw new Fault(404,'Benefit is no longer available.');
 await db.batch([
 db.prepare(`INSERT OR IGNORE INTO claims(id,member_id,benefit_id,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM holdings WHERE member_id=? AND expires>?) AND EXISTS(SELECT 1 FROM wallets WHERE member_id=? AND points>=?)`).bind(token,m.id,b.id,time,m.id,time,m.id,b.cost),
 db.prepare(`INSERT INTO points SELECT ?,member_id,?,'Benefit claim',? FROM claims WHERE id=?`).bind('claim:'+token,-b.cost,time,token),
 db.prepare(`UPDATE wallets SET points=COALESCE((SELECT SUM(amount) FROM points WHERE points.member_id=wallets.member_id),0) WHERE member_id=?`).bind(m.id)
 ]);
 const claim=await db.prepare('SELECT * FROM claims WHERE member_id=? AND benefit_id=?').bind(m.id,b.id).first();if(!claim)throw new Fault(409,'Active membership and sufficient points are required.');return claim;
}
export async function ballotOpen(db:D1Database,u:Principal,b:any){admin(u);const bid=id(),time=now();if(b.closes<=time)throw new Fault(400,'Closing time must be in the future.');
 await db.batch([db.prepare('INSERT INTO ballots VALUES(?,?,?,?,?,?)').bind(bid,b.title,b.region||null,JSON.stringify(b.candidates.map((x:any)=>x.name)),time,b.closes),db.prepare('INSERT INTO ballot_details VALUES(?,?,?)').bind(bid,b.district||null,JSON.stringify(b.candidates)),db.prepare(`INSERT INTO eligibility(id,ballot_id,member_id) SELECT ?||':'||m.id,?,m.id FROM members m JOIN profiles p ON p.member_id=m.id JOIN holdings h ON h.member_id=m.id WHERE h.expires>? AND p.verified_phone IS NOT NULL AND (?='' OR m.region=?) AND (?='' OR p.district=?)`).bind(bid,bid,time,b.region,b.region,b.district,b.district),auditStmt(db,u,'open-ballot',bid)]);return {id:bid};}
export async function castVote(db:D1Database,u:Principal,bid:string,choice:number){const m=await needMember(db,u),time=now();const b=await db.prepare('SELECT * FROM ballots WHERE id=? AND opens<=? AND closes>?').bind(bid,time,time).first<any>();if(!b||choice<0||choice>=JSON.parse(b.options).length)throw new Fault(400,'Invalid or closed ballot.');
 const receipt=id(),anonymousId=id();
 // No identity, receipt or timestamp is stored with the choice.
 const r=await db.batch([db.prepare(`INSERT OR IGNORE INTO participation SELECT ?,?,m.id FROM members m JOIN profiles p ON p.member_id=m.id JOIN eligibility e ON e.member_id=m.id AND e.ballot_id=? JOIN holdings h ON h.member_id=m.id WHERE m.id=? AND h.expires>? AND p.verified_phone IS NOT NULL`).bind(receipt,bid,bid,m.id,time),db.prepare(`INSERT INTO sealed_votes SELECT ?,?,? FROM participation WHERE id=?`).bind(anonymousId,bid,choice,receipt)]);
 if(!r[0].meta.changes)throw new Fault(409,'You already voted or are not an eligible active member.');return {receipt};
}
export async function listBallots(db:D1Database,u:Principal|null){
 const m=u?await member(db,u):null,time=now();
 const rows=(await db.prepare(`SELECT b.*,d.candidates,d.district,EXISTS(SELECT 1 FROM eligibility e WHERE e.ballot_id=b.id AND e.member_id=?) AS eligible,EXISTS(SELECT 1 FROM participation p WHERE p.ballot_id=b.id AND p.member_id=?) AS voted FROM ballots b LEFT JOIN ballot_details d ON d.ballot_id=b.id ORDER BY b.opens DESC LIMIT 100`).bind(m?.id||'',m?.id||'').all<any>()).results;
 const totals=(await db.prepare(`SELECT v.ballot_id,v.choice,COUNT(*) AS votes FROM sealed_votes v JOIN ballots b ON b.id=v.ballot_id WHERE b.closes<=? GROUP BY v.ballot_id,v.choice`).bind(time).all<any>()).results;
 return rows.map(b=>({...b,options:JSON.parse(b.options),candidates:JSON.parse(b.candidates||'[]'),eligible:!!b.eligible,voted:!!b.voted,results:b.closes<=time?totals.filter(v=>v.ballot_id===b.id):null}));
}
export async function queueReminders(db:D1Database){const time=now();let queued=0;
 const due=(await db.prepare(`SELECT r.*,h.number,p.locale FROM reminders r JOIN holdings h ON h.member_id=r.member_id AND h.expires=r.expiry JOIN profiles p ON p.member_id=r.member_id WHERE r.status='pending' AND r.due<=? AND h.expires>? AND NOT EXISTS(SELECT 1 FROM reminders newer WHERE newer.member_id=r.member_id AND newer.expiry=r.expiry AND newer.status='pending' AND newer.due>r.due AND newer.due<=?) ORDER BY r.due LIMIT 100`).bind(time,time,time).all<any>()).results;
 for(const r of due){const body=r.locale==='sw'?`Simba #${r.number}: uanachama wako unaisha ${r.expiry.slice(0,10)}. Ingia kwenye tovuti ya uanachama kufanya malipo.`:`Simba #${r.number}: membership expires ${r.expiry.slice(0,10)}. Sign in to the membership website to renew.`;
 const result=await db.batch([db.prepare('INSERT OR IGNORE INTO outbox(id,member_id,kind,body,status,created) VALUES(?,?,?,?,?,?)').bind(r.id,r.member_id,'renewal',body,'pending',time),db.prepare(`UPDATE reminders SET status='queued' WHERE member_id=? AND expiry=? AND due<=? AND status='pending'`).bind(r.member_id,r.expiry,time)]);queued+=result[0].meta.changes;}
 const waiting=(await db.prepare(`SELECT w.*,p.locale FROM waitlist w JOIN profiles p ON p.member_id=w.member_id WHERE w.notified IS NULL AND NOT EXISTS(SELECT 1 FROM holdings h WHERE h.number=w.number AND h.expires>?) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.number=w.number AND r.expires>?) LIMIT 100`).bind(time,time).all<any>()).results;
 for(const w of waiting){await db.prepare('INSERT OR IGNORE INTO outbox(id,member_id,kind,body,status,created) VALUES(?,?,?,?,?,?)').bind('wait:'+w.id,w.member_id,'waitlist',w.locale==='sw'?`Simba #${w.number} sasa inapatikana. Angalia tovuti; namba haijahifadhiwa kwa ajili yako.`:`Simba #${w.number} is available. Check the website; it is not reserved for you.`,'pending',time).run();}
 return {queued};
}
