type Name='dashboard'|'customers'|'designs'|'suppliers'|'arrow'|'plus'|'menu'|'close'|'logout'|'check'|'search'|'lock';
const paths:Record<Name,string>={dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  customers:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  designs:'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',suppliers:'M3 21V7l9-4 9 4v14 M3 21h18 M8 21v-7h8v7 M7 8h2 M15 8h2',
  arrow:'M5 12h14 M13 6l6 6-6 6',plus:'M12 5v14 M5 12h14',menu:'M4 6h16 M4 12h16 M4 18h16',close:'M6 6l12 12 M6 18L18 6',
  logout:'M9 4H4v16h5 M12 12h9 M17 8l4 4-4 4',check:'M5 12l4 4L19 6',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  lock:'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3'};
export function Icon({name,size=20}:{name:Name;size?:number}) {return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;}
