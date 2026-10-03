export type MasterKind='customers'|'designs'|'suppliers';
export interface Field {key:string;label:string;required?:boolean;max:number;type?:'tel'|'textarea'}
interface Config {title:string;singular:string;description:string;nameKey:string;fields:Field[];columns:{key:string;label:string}[];
  filters:{key:string;label:string;max:number}[];sorts:{key:string;label:string}[]}
const contactFields:Field[]=[{key:'name',label:'Name',required:true,max:120},{key:'phone',label:'Phone number',required:true,max:40,type:'tel'},
  {key:'city',label:'City',max:100},{key:'address',label:'Address',max:1000,type:'textarea'},{key:'notes',label:'Notes',max:2000,type:'textarea'}];
const contactColumns=[{key:'name',label:'Name'},{key:'phone',label:'Phone'},{key:'city',label:'City'}];
const contactFilters=[{key:'city',label:'Exact city',max:100},{key:'phone',label:'Exact phone',max:40}];
const contactSorts=[{key:'created_at',label:'Date created'},{key:'name',label:'Name'},{key:'city',label:'City'},{key:'updated_at',label:'Last updated'}];
export const masterConfigs:Record<MasterKind,Config>={
  customers:{title:'Customers',singular:'customer',description:'A thoughtful record of every customer relationship.',nameKey:'name',
    fields:contactFields.map(field=>field.key==='city'?{...field,required:true}:field),columns:contactColumns,filters:contactFilters,sorts:contactSorts},
  suppliers:{title:'Suppliers',singular:'supplier',description:'Keep your artisan and supplier details in one place.',nameKey:'name',
    fields:contactFields,columns:contactColumns,filters:contactFilters,sorts:contactSorts},
  designs:{title:'Designs',singular:'design',description:'Organise your stone designs, dimensions and materials.',nameKey:'design_name',
    fields:[{key:'design_number',label:'Design number',required:true,max:40},{key:'design_name',label:'Design name',required:true,max:120},
      {key:'size',label:'Size',required:true,max:80},{key:'material',label:'Material',required:true,max:80},{key:'notes',label:'Notes',max:2000,type:'textarea'}],
    columns:[{key:'design_number',label:'Design no.'},{key:'design_name',label:'Design name'},{key:'size',label:'Size'},{key:'material',label:'Material'}],
    filters:[{key:'material',label:'Exact material',max:80},{key:'size',label:'Exact size',max:80},{key:'design_number',label:'Exact design number',max:40}],
    sorts:[{key:'created_at',label:'Date created'},{key:'design_number',label:'Design number'},{key:'design_name',label:'Design name'},{key:'size',label:'Size'},{key:'material',label:'Material'},{key:'updated_at',label:'Last updated'}]}
};
export const text=(value:unknown):string=>typeof value==='string'?value:'';
export function displayDate(value:string) {const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(d);}
