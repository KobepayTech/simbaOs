import AdminApp from './admin-app';
export const dynamic='force-dynamic';
export const metadata={title:'SimbaOS | Administration',robots:{index:false,follow:false}};
export default function Admin(){return <AdminApp section="overview"/>;}
