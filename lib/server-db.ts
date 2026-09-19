import {env} from 'cloudflare:workers';
export function database(){if(!env.DB)throw Error('Membership storage is temporarily unavailable. Please retry.');return env.DB;}
