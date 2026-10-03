import type { Database, SqlExecutor } from '../db/database.js';
import { writeActivity } from '../modules/audit/activity-log.js';
import { AppError } from './errors.js';

export interface MasterRow {
  id: string; is_active: boolean; created_by: string; updated_by: string;
  created_at: Date; updated_at: Date;
}
export interface ChangeActor { id: string; requestId: string }
export interface ListOptions {
  page: number; limit: number; q: string; status: 'active' | 'inactive' | 'all';
  sort_by: string; sort_order: 'asc' | 'desc';
  city?: string; phone?: string; material?: string; size?: string; design_number?: string;
}
interface MasterDefinition {
  table: 'customers' | 'designs' | 'suppliers';
  entity: 'CUSTOMER' | 'DESIGN' | 'SUPPLIER';
  fields: readonly string[];
  searchFields: readonly string[];
  sortFields: readonly string[];
  filters: Record<string,{column: string; caseInsensitive?: boolean}>;
  validateUpdate?: (tx: SqlExecutor,id: string,input: Record<string,unknown>) => Promise<void>;
}
const escapeLike = (value: string) => value.replace(/[\\%_]/g,char => '\\'+char);

// Shared SQL mechanics only. Each module owns its fields, schemas and rules.
// Every SQL identifier comes from module constants, never from the request.
export function masterService<Row extends MasterRow>(db: Database, definition: MasterDefinition) {
  const table = `divyashilla.${definition.table}`;
  const columns = ['id',...definition.fields,'is_active','created_by','updated_by','created_at','updated_at'].join(',');
  function checkedFields(input: Record<string,unknown>) {
    const fields = Object.keys(input);
    if (fields.some(field => !definition.fields.includes(field))) throw new AppError(400,'INVALID_FIELD','This field cannot be edited.');
    return fields;
  }
  function snapshot(row: Row) {
    const source = row as unknown as Record<string,unknown>;
    const data: Record<string,string | boolean | null> = {id:row.id,is_active:row.is_active};
    for (const field of definition.fields) {
      const value = source[field];
      if (typeof value !== 'string' && value !== null) throw new Error('Unexpected master-record audit value.');
      data[field] = value;
    }
    return data;
  }
  async function find(tx: SqlExecutor,id: string,lock = false) {
    const result = await tx.query<Row>(`SELECT ${columns} FROM ${table} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,[id]);
    if (!result.rows[0]) throw new AppError(404,'RECORD_NOT_FOUND','Record not found.');
    return result.rows[0];
  }
  return {
    async list(options: ListOptions) {
      if (!definition.sortFields.includes(options.sort_by) || !['asc','desc'].includes(options.sort_order)) {
        throw new AppError(400,'INVALID_SORT','Choose an allowed sort field and direction.');
      }
      const values: unknown[] = [];
      const conditions: string[] = [];
      const bind = (value: unknown) => {values.push(value);return '$'+values.length;};
      if (options.status !== 'all') conditions.push(`is_active = ${bind(options.status === 'active')}`);
      if (options.q) {
        const placeholder = bind('%'+escapeLike(options.q)+'%');
        conditions.push('('+definition.searchFields.map(field => `${field} ILIKE ${placeholder}`).join(' OR ')+')');
      }
      for (const [filter,setting] of Object.entries(definition.filters)) {
        const value = (options as unknown as Record<string,unknown>)[filter];
        if (value !== undefined) {
          const placeholder = bind(value);
          conditions.push(setting.caseInsensitive ? `lower(${setting.column}) = lower(${placeholder})` : `${setting.column} = ${placeholder}`);
        }
      }
      const where = conditions.length ? ' WHERE '+conditions.join(' AND ') : '';
      return db.transaction(async tx => {
        // One snapshot keeps list rows and total consistent during concurrent edits.
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        const totalResult = await tx.query<{total: string}>(`SELECT count(*)::text AS total FROM ${table}${where}`,values);
        const total = Number(totalResult.rows[0]!.total);
        const result = await tx.query<Row>(`SELECT ${columns} FROM ${table}${where}
          ORDER BY ${options.sort_by} ${options.sort_order.toUpperCase()},id ASC
          LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,options.limit,(options.page-1)*options.limit]);
        return {data:result.rows,meta:{page:options.page,limit:options.limit,total,total_pages:Math.ceil(total/options.limit)}};
      });
    },
    get: (id: string) => find(db,id),
    async create(input: Record<string,unknown>,actor: ChangeActor) {
      const fields = checkedFields(input);
      try {
        return await db.transaction(async tx => {
          const values = fields.map(field => input[field]);
          values.push(actor.id,actor.id);
          const placeholders = values.map((_value,index) => '$'+(index+1));
          const result = await tx.query<Row>(`INSERT INTO ${table} (${fields.join(',')},created_by,updated_by)
            VALUES (${placeholders.join(',')}) RETURNING ${columns}`,values);
          const row = result.rows[0]!;
          await writeActivity(tx,{actorId:actor.id,action:definition.entity+'_CREATED',entityType:definition.entity,
            entityId:row.id,after:snapshot(row),requestId:actor.requestId});
          return row;
        });
      } catch (error) {
        if (definition.table === 'designs' && (error as {code?: string}).code === '23505') {
          throw new AppError(409,'DESIGN_NUMBER_EXISTS','This design number already exists.');
        }
        throw error;
      }
    },
    async update(id: string,input: Record<string,unknown>,actor: ChangeActor) {
      const fields = checkedFields(input);
      if (!fields.length) throw new AppError(400,'EMPTY_UPDATE','Provide at least one editable field.');
      try {
        return await db.transaction(async tx => {
          const before = await find(tx,id,true);
          if (definition.validateUpdate) await definition.validateUpdate(tx,id,input);
          const previous = before as unknown as Record<string,unknown>;
          if (fields.every(field => previous[field] === input[field])) return before;
          const values = fields.map(field => input[field]);
          const assignments = fields.map((field,index) => `${field} = $${index+1}`);
          values.push(actor.id,id);
          const result = await tx.query<Row>(`UPDATE ${table} SET ${assignments.join(',')},updated_by = $${values.length-1}
            WHERE id = $${values.length} RETURNING ${columns}`,values);
          const after = result.rows[0]!;
          await writeActivity(tx,{actorId:actor.id,action:definition.entity+'_UPDATED',entityType:definition.entity,
            entityId:id,before:snapshot(before),after:snapshot(after),requestId:actor.requestId});
          return after;
        });
      } catch (error) {
        if (definition.table === 'designs' && (error as {code?: string}).code === '23505') {
          throw new AppError(409,'DESIGN_NUMBER_EXISTS','This design number already exists.');
        }
        throw error;
      }
    },
    async setActive(id: string,active: boolean,reason: string,actor: ChangeActor) {
      return db.transaction(async tx => {
        const before = await find(tx,id,true);
        if (before.is_active === active) return before;
        const result = await tx.query<Row>(`UPDATE ${table} SET is_active = $2,updated_by = $3 WHERE id = $1 RETURNING ${columns}`,[id,active,actor.id]);
        const after = result.rows[0]!;
        await writeActivity(tx,{actorId:actor.id,action:definition.entity+(active ? '_REACTIVATED' : '_DEACTIVATED'),
          entityType:definition.entity,entityId:id,before:{id,is_active:before.is_active},after:{id,is_active:active},reason,requestId:actor.requestId});
        return after;
      });
    }
  };
}
