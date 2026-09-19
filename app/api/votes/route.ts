import {database} from '@/lib/server-db';import {current} from '@/lib/platform/security';import {listBallots} from '@/lib/platform/core';
export async function GET(){try{const db=database();return Response.json({ballots:await listBallots(db,await current(db))});}catch{return Response.json({error:'Voting unavailable'},{status:503});}}
export async function POST(){return Response.json({error:'Use the verified voting flow.'},{status:410});}
