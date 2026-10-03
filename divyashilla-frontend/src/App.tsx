import { DeliveryListPage } from './modules/delivery/DeliveryListPage';
import { DeliveryDetailPage } from './modules/delivery/DeliveryDetailPage';
import { LedgerListPage } from './modules/finance/LedgerListPage';
import { LedgerFormPage } from './modules/finance/LedgerFormPage';
import { LedgerDetailPage } from './modules/finance/LedgerDetailPage';
import { SupplierAllocationPage } from './modules/finance/SupplierAllocationPage';
import { OrderListPage } from './modules/orders/OrderListPage';
import { OrderFormPage } from './modules/orders/OrderFormPage';
import { OrderDetailPage } from './modules/orders/OrderDetailPage';
import { Navigate,Outlet,Route,Routes } from 'react-router-dom';
import { home,useAuth } from './auth/AuthProvider';
import { ChangePasswordPage,LoginPage } from './auth/AuthPages';
import { Layout } from './components/Layout';
import { ErrorState,Loading } from './components/States';
import { DashboardPage } from './modules/dashboard/DashboardPage';
import { MasterListPage } from './modules/masters/MasterListPage';
import { MasterFormPage } from './modules/masters/MasterFormPage';
import { MasterDetailPage } from './modules/masters/MasterDetailPage';
function RequireSession({password=false}:{password?:boolean}) {
  const {session}=useAuth();if(!session)return <Navigate to="/login" replace/>;
  if(session.user.mustChangePassword&&!password)return <Navigate to="/change-password" replace/>;
  return <Outlet/>;
}
function RequireAdmin() {const {session}=useAuth();return session!.user.role==='ADMIN'?<Outlet/>:<Navigate to="/workspace" replace/>;}
function WorkspacePage() {
  const {session}=useAuth();if(session!.user.role==='ADMIN') return <Navigate to="/dashboard" replace/>;
  return <DeliveryListPage workspace/>;
}
function Home() {const {session}=useAuth();return <Navigate to={session?home(session):'/login'} replace/>;}
export function App() {
  const auth=useAuth();if(auth.loading)return <Loading label="Checking your session…"/>;
  if(auth.error)return <ErrorState message={auth.error} retry={()=>{void auth.refresh();}}/>;
  return <Routes><Route path="/login" element={<LoginPage/>}/><Route element={<RequireSession password/>}><Route path="/change-password" element={<ChangePasswordPage/>}/></Route><Route element={<RequireSession/>}><Route element={<Layout/>}><Route path="/workspace" element={<WorkspacePage/>}/><Route path="/deliveries" element={<DeliveryListPage/>}/><Route path="/deliveries/:id" element={<DeliveryDetailPage/>}/><Route element={<RequireAdmin/>}><Route path="/dashboard" element={<DashboardPage/>}/><Route path="/orders"><Route index element={<OrderListPage/>}/><Route path="new" element={<OrderFormPage/>}/><Route path=":id" element={<OrderDetailPage/>}/><Route path=":id/edit" element={<OrderFormPage editing/>}/></Route>{(['customer-payments','supplier-payments','order-expenses'] as const).map(kind=><Route key={kind} path={'/'+kind}><Route index element={<LedgerListPage key={kind} kind={kind}/>}/><Route path="new" element={<LedgerFormPage key={kind} kind={kind}/>}/><Route path=":id" element={<LedgerDetailPage key={kind} kind={kind}/>}/>{kind==='supplier-payments'&&<Route path=":id/allocations" element={<SupplierAllocationPage/>}/>}</Route>)}{(['customers','designs','suppliers'] as const).map(kind=><Route key={kind} path={'/'+kind}><Route index element={<MasterListPage key={kind} kind={kind}/>}/><Route path="new" element={<MasterFormPage key={kind} kind={kind}/>}/><Route path=":id" element={<MasterDetailPage key={kind} kind={kind}/>}/><Route path=":id/edit" element={<MasterFormPage key={kind} kind={kind} editing/>}/></Route>)}</Route><Route path="*" element={<Home/>}/></Route></Route><Route path="*" element={<Home/>}/></Routes>;
}
