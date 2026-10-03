import type { Database, SqlExecutor } from '../../db/database.js';
import { AppError } from '../../shared/errors.js';
import { writeActivity } from '../audit/activity-log.js';
import { encodeCsv, type CsvColumn, type ReportRow } from './csv.js';
import { dashboardQuery, reportQuery } from './queries.js';
import type { ReportInput, ReportKind } from './validation.js';

type Actor = {id:string;requestId:string};
export const MAX_EXPORT_ROWS=10000;
async function dashboard(tx:SqlExecutor,input:ReportInput):Promise<ReportRow> {
  const query=dashboardQuery(input);return (await tx.query<ReportRow>(query.sql,query.values)).rows[0]!;
}
async function auditExport(tx:SqlExecutor,kind:ReportKind,input:ReportInput,rowCount:number,actor:Actor) {
  const after:ReportRow={report_type:kind,row_count:rowCount};
  for(const key of ['date_from','date_to','order_status','city','supplier_id','design_id','delivery_status'] as const)
    if(input[key]) after[key]=input[key];
  await writeActivity(tx,{actorId:actor.id,action:'REPORT_EXPORT_STARTED',entityType:'REPORT',after,requestId:actor.requestId});
}
export function reportService(db:Database) {
  return {
    async read(kind:ReportKind,input:ReportInput) {
      return db.transaction(async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        if(kind==='dashboard') return {data:await dashboard(tx,input)};
        const query=reportQuery(kind,input);
        const summary=(await tx.query<ReportRow>(query.cte+' SELECT '+query.summary+' FROM report',query.values)).rows[0]!;
        const total=kind==='suppliers' ? Number(summary.supplier_count) : Number(summary.order_count);
        const page=input.page!,limit=input.limit!;
        const rows=await tx.query<ReportRow>(query.cte+` SELECT * FROM report ORDER BY ${query.orderBy}
          LIMIT $${query.values.length+1} OFFSET $${query.values.length+2}`,[...query.values,limit,(page-1)*limit]);
        return {data:rows.rows,summary,meta:{page,limit,total,total_pages:Math.ceil(total/limit)}};
      });
    },
    async export(kind:ReportKind,input:ReportInput,actor:Actor) {
      return db.transaction(async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        let rows:ReportRow[],columns:CsvColumn[];
        if(kind==='dashboard') {
          rows=[await dashboard(tx,input)];columns=Object.keys(rows[0]!).map(key=>({key,numeric:true}));
        } else {
          const query=reportQuery(kind,input);columns=query.columns;
          rows=(await tx.query<ReportRow>(query.cte+` SELECT * FROM report ORDER BY ${query.orderBy} LIMIT $${query.values.length+1}`,
            [...query.values,MAX_EXPORT_ROWS+1])).rows;
          if(rows.length>MAX_EXPORT_ROWS) throw new AppError(413,'EXPORT_TOO_LARGE','Narrow the filters to export at most 10,000 rows.');
        }
        const csv=encodeCsv(rows,columns);
        // Log the authorized export start, not an unverified completed download.
        // Commit succeeds before any bytes are sent; failed audit produces no CSV.
        await auditExport(tx,kind,input,rows.length,actor);
        return csv;
      });
    }
  };
}
