import {z} from 'zod';import {regions} from '../membership';
export const phone=z.string().regex(/^\+255[67]\d{8}$/,'Use a Tanzanian mobile number such as +255712345678.');
const text=(max=200)=>z.string().trim().min(1).max(max);
const region=z.string().refine(x=>regions.includes(x),'Select a valid region.');
const date=z.string().datetime();
const number=z.number().int().min(1).max(1000000);
export const actions={
 'otp-send':z.object({phone}), 'otp-check':z.object({phone,code:z.string().regex(/^\d{6}$/)}),logout:z.object({}),
 register:z.object({name:text(100),number,region,district:text(100),locale:z.enum(['sw','en']),referrer:z.string().max(100).optional()}),
 preferences:z.object({locale:z.enum(['sw','en'])}),checkout:z.object({number}),waitlist:z.object({number}),'leave-waitlist':z.object({id:text()}),
 'claim-benefit':z.object({id:text()}),vote:z.object({id:text(),choice:z.number().int().min(0).max(9)}),
 settings:z.object({prices:z.object({'Standard':z.number().int().min(1).max(100000000),'First 100':z.number().int().min(1).max(100000000),'Prestige':z.number().int().min(1).max(100000000),'Repeated digits':z.number().int().min(1).max(100000000)}),months:z.number().int().min(1).max(24),reservationMinutes:z.number().int().min(5).max(30),remind7:z.boolean(),remind1:z.boolean(),renewalPoints:z.number().int().min(0).max(10000),referralPoints:z.number().int().min(0).max(10000)}).refine(x=>x.prices['First 100']>x.prices.Standard&&x.prices.Prestige>x.prices['First 100']&&x.prices['Repeated digits']>x.prices.Prestige,'Prices must increase: Standard < First 100 < Prestige < Repeated digits.'),
 branch:z.object({name:text(100),region,district:z.string().trim().max(100)}),
 role:z.object({principal:text(),role:z.enum(['leader','scanner','fan']),branchId:z.string().max(100)}),
 announcement:z.object({title:text(),body:text(3000),branchId:z.string().max(100)}),
 benefit:z.object({title:text(),description:text(2000),partner:text(),cost:z.number().int().min(0).max(1000000),expires:date}),
 'disable-benefit':z.object({id:text()}),
 event:z.object({title:text(),venue:text(),starts:date,ends:date,branchId:z.string().max(100),points:z.number().int().min(0).max(1000)}).refine(x=>x.ends>x.starts,'End must follow start.'),
 'check-in':z.object({eventId:text(),cardToken:text()}),'redeem':z.object({token:text()}),
 ballot:z.object({title:text(),region:z.string().refine(x=>!x||regions.includes(x)),district:z.string().trim().max(100),closes:date,candidates:z.array(z.object({name:text(100),bio:text(1000)})).min(2).max(10)}).refine(x=>new Set(x.candidates.map(c=>c.name.toLowerCase())).size===x.candidates.length,'Candidate names must be unique.').refine(x=>!x.district||!!x.region,'District voting requires a region.'),
};
export const callback=z.object({eventId:text(),orderId:z.string().uuid(),amount:z.number().int().positive(),currency:z.literal('TZS'),receipt:text(),status:z.literal('paid')});
