import {database} from '@/lib/server-db';import {availability} from '@/lib/platform/core';
export async function GET(req:Request){try{return Response.json(await availability(database(),Number(new URL(req.url).searchParams.get('number'))),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Check a number between 1 and 1,000,000.'},{status:400});}}
