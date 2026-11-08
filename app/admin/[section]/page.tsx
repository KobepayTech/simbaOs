import AdminApp from '../admin-app';
import {notFound} from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={title:'SimbaOS | Administration',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{section:string}>}){const {section}=await params;if(!['members','payments','methods','pricing','club','posts','branches','announcements','events','benefits','ballots','staff','notifications','audit'].includes(section))notFound();return <AdminApp section={section}/>;}
