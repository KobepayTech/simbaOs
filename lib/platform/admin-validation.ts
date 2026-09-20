import {z} from 'zod';
import {phone,actions} from './validation';
import {regions} from '../membership';
const text=(max=200)=>z.string().trim().min(1).max(max),optional=(max=200)=>z.string().trim().max(max),key=z.string().uuid();
const url=z.string().trim().max(500).refine(s=>!s||/^https:\/\//i.test(s)&&(()=>{try{return !!new URL(s).hostname}catch{return false}})(),'Use a full HTTPS link.');
const region=z.string().refine(s=>regions.includes(s),'Choose a Tanzania region.');
export const adminActions={
 'create-member':z.object({name:text(100),phone,region,district:text(100),locale:z.enum(['en','sw']),number:z.number().int().min(1).max(1000000)}),
 'update-member':z.object({id:key,name:text(100),region,district:text(100),locale:z.enum(['en','sw'])}),
 'quote-payment':z.object({memberId:key,number:z.number().int().min(1).max(1000000)}),
 'record-payment':z.object({orderId:key,amount:z.number().int().positive(),methodId:key,receipt:text(100),receivedAt:z.string().datetime(),note:optional(1000),confirmed:z.literal(true)}),
 'record-refund':z.object({orderId:key,reference:text(100),note:text(1000),confirmed:z.literal(true)}),
 'club':z.object({name:text(100),shortName:text(40),tagline:optional(100),about:optional(5000),phone:optional(50),email:z.union([z.literal(''),z.string().email().max(200)]),address:optional(500),website:url,facebook:url,instagram:url,terms:optional(10000),privacy:optional(10000)}),
 'payment-method':z.object({id:key.optional(),name:text(100),kind:z.enum(['mobile_money','bank','cash']),accountName:optional(150),accountNumber:optional(100),instructions:optional(2000),active:z.boolean()}).refine(b=>b.kind==='cash'||!!b.accountName&&!!b.accountNumber,'Account name and number are required for bank and mobile-money methods.'),
 'post':z.object({id:key.optional(),title:text(200),body:text(5000),url,published:z.boolean()}),
 'announcement-edit':z.object({id:key,title:text(),body:text(3000),branchId:optional()}),
 'announcement-delete':z.object({id:key}),
 'branch-edit':z.object({id:key,name:text(100),region,district:optional(100)}),
 'event-edit':z.object({id:key,title:text(),venue:text(),starts:z.string().datetime(),ends:z.string().datetime(),branchId:optional(),points:z.number().int().min(0).max(1000)}).refine(b=>b.ends>b.starts,'End must follow start.'),
 'benefit-edit':z.object({id:key,title:text(),description:text(2000),partner:text(),cost:z.number().int().min(0).max(1000000),expires:z.string().datetime(),active:z.boolean()}),
 'staff-role':z.object({principal:text(),role:z.enum(['admin','leader','scanner','fan']),branchId:optional()}),
 'close-ballot':z.object({id:key,reason:text(500)}),
};
