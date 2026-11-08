import {reminderDate,category} from './membership';
// Internal only. Call ONLY after validating provider signature, amount, currency,
// payment reference and member identity. No public activation endpoint is exposed.
export async function assignPaidNumber(db:D1Database, memberId:string, number:number, expiry:string, paidAt:string){
 category(number);
 if(!Number.isFinite(Date.parse(expiry))||!Number.isFinite(Date.parse(paidAt))||expiry<=paidAt)throw Error('Invalid membership term');
 const statement=db.prepare(`INSERT INTO holdings(number,member_id,expires,paid_at)
 SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=?)
 ON CONFLICT(number) DO UPDATE SET member_id=excluded.member_id,expires=excluded.expires,paid_at=excluded.paid_at
 WHERE holdings.expires<=? OR (holdings.member_id=excluded.member_id AND holdings.expires<excluded.expires)`)
 .bind(number,memberId,expiry,paidAt,memberId,paidAt);
 // Transactional batch ensures a reminder exists only for the successful owner.
 const queue=db.prepare(`INSERT OR IGNORE INTO reminders(id,member_id,expiry,due,status)
 SELECT ?,?,?,?,'pending' FROM holdings WHERE number=? AND member_id=? AND expires=?`)
 .bind(memberId+':'+expiry,memberId,expiry,reminderDate(expiry),number,memberId,expiry);
 const result=await db.batch([statement,queue]);
 return {assigned:result[0].meta.changes===1};
}
// Ballots open immediately so eligibility is captured in the same transaction.
export async function openBallot(db:D1Database,title:string,region:string|null,options:string[],closes:string){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 if(!title.trim()||options.length<2||options.length>10||options.some(x=>!x.trim())||closes<=now)throw Error('Invalid ballot');
 await db.batch([db.prepare('INSERT INTO ballots(id,title,region,options,opens,closes) VALUES(?,?,?,?,?,?)').bind(id,title,region,JSON.stringify(options),now,closes),db.prepare(`INSERT INTO eligibility(id,ballot_id,member_id) SELECT ? || ':' || m.id,?,m.id FROM members m JOIN holdings h ON h.member_id=m.id WHERE h.expires>? AND (? IS NULL OR m.region=?)`).bind(id,id,now,region,region)]);
 return id;
}
// Delivery adapter must recheck matching expiry and mark sent only on provider acknowledgement.
export async function dueReminders(db:D1Database,now=new Date().toISOString()){
 return db.prepare(`SELECT r.id,r.member_id,r.expiry,m.phone,m.name,h.number FROM reminders r JOIN holdings h ON h.member_id=r.member_id AND h.expires=r.expiry JOIN members m ON m.id=r.member_id WHERE r.status='pending' AND r.due<=? AND h.expires>?`).bind(now,now).all();
}
