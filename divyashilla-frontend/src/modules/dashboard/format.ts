// Format decimal strings without Number(), retaining precision for large totals.
export function rupees(value:string):string {
  const negative=value.startsWith('-'),[whole='0',fraction='00']=(negative?value.slice(1):value).split('.');
  const last=whole.slice(-3),leading=whole.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g,',');
  return (negative?'−':'')+'₹'+(leading?leading+',':'')+last+'.'+fraction.padEnd(2,'0');
}
export const count=(value:number)=>new Intl.NumberFormat('en-IN').format(value);
