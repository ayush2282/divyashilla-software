import type { ReportInput, ReportKind } from './validation.js';
import type { CsvColumn } from './csv.js';

export interface ReportQuery {cte:string;values:unknown[];columns:CsvColumn[];orderBy:string;summary:string}
const money = (expression:string) => `(${expression})::numeric(30,2)::text`;
const sum = (column:string) => `${money(`coalesce(sum(${column}::numeric),0)`)} AS ${column}`;
const count = 'count(*)::int AS order_count';
const baseColumns:CsvColumn[] = ['order_id','order_number','order_date','order_status','customer_id','customer_name',
  'customer_phone','city','customer_address','design_id','design_number','design_name','size','material','supplier_id','supplier_name',
  'expected_delivery_date'].map(key=>({key}));
const financialColumns:CsvColumn[] = ['selling_price','buying_price','customer_net_received','balance_amount','delivery_expense',
  'other_expense','profit','supplier_net_paid','supplier_balance_amount'].map(key=>({key,numeric:true}));
const baseProjection = `o.id AS order_id,o.order_number::text,o.order_date::text,o.order_status::text,
  o.customer_id,o.delivery_name AS customer_name,o.delivery_phone AS customer_phone,o.delivery_city AS city,
  o.delivery_address AS customer_address,o.design_id,o.design_number_snapshot AS design_number,
  o.design_name_snapshot AS design_name,o.size_snapshot AS size,o.material_snapshot AS material,o.supplier_id,s.name AS supplier_name,
  o.expected_delivery_date::text`;
const financeProjection = financialColumns.map(column=>`${money('f.'+column.key)} AS ${column.key}`).join(',');
const financialSummary = `${count},${financialColumns.filter(column=>column.key!=='profit').map(column=>sum(column.key)).join(',')},
  count(*) FILTER (WHERE buying_price IS NULL)::int AS unpriced_orders,
  ${money('coalesce(sum(profit::numeric),0)')} AS known_profit,
  CASE WHEN count(*) FILTER (WHERE buying_price IS NULL)>0 THEN NULL ELSE ${money('coalesce(sum(profit::numeric),0)')} END AS profit`;

// All identifiers/projections below are static. Every user filter is a bound parameter.
export function reportQuery(kind:Exclude<ReportKind,'dashboard'>,input:ReportInput):ReportQuery {
  const values:unknown[]=[],clauses:string[]=[];
  const add=(expression:string,value:unknown)=>{values.push(value);clauses.push(expression.replace('?', '$'+values.length));};
  if(input.date_from) add('o.order_date >= ?::date',input.date_from);
  if(input.date_to) add('o.order_date <= ?::date',input.date_to);
  if(input.order_status) add('o.order_status = ?',input.order_status);
  if(input.supplier_id) add('o.supplier_id = ?::uuid',input.supplier_id);
  if(input.design_id) add('o.design_id = ?::uuid',input.design_id);
  if(input.city) add('lower(o.delivery_city) = lower(?)',input.city);
  if(kind==='profit' && !input.order_status) clauses.push("o.order_status <> 'CANCELLED'");
  if(kind==='customer-dues') clauses.push("o.order_status <> 'CANCELLED' AND f.balance_amount > 0");
  if(kind==='deliveries') {
    clauses.push("d.delivery_status IN ('READY_FOR_DELIVERY','SENT','DELIVERED','ISSUE')");
    if(input.delivery_status) add('d.delivery_status = ?',input.delivery_status);
  }
  const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
  const joins=`FROM divyashilla.orders o JOIN divyashilla.order_financials f ON f.order_id=o.id
    LEFT JOIN divyashilla.suppliers s ON s.id=o.supplier_id JOIN divyashilla.deliveries d ON d.order_id=o.id`;
  if(kind==='suppliers') {
    // Order-cohort balances and lifetime supplier payments are deliberately separate.
    // An unallocated advance cannot be attributed to any one date-filtered order.
    const columns:CsvColumn[]=[{key:'supplier_id'},{key:'supplier_name'},{key:'orders_given',numeric:true},{key:'order_count',numeric:true},
      ...['total_buying_cost','paid_amount','pending_amount','lifetime_buying_cost','lifetime_paid_amount',
        'unallocated_paid_amount','lifetime_pending_amount','lifetime_credit_amount'].map(key=>({key,numeric:true})),
      {key:'unpriced_orders',numeric:true},{key:'lifetime_unpriced_orders',numeric:true}];
    const cohortWhere=where ? where+' AND o.supplier_id IS NOT NULL' : 'WHERE o.supplier_id IS NOT NULL';
    return {values,columns,orderBy:'supplier_name ASC,supplier_id ASC',cte:`WITH cohort AS (
      SELECT o.supplier_id,count(*)::int AS orders_given,sum(f.buying_price) AS cost,
        sum(f.supplier_net_paid) AS paid,sum(f.supplier_balance_amount) AS pending,
        count(*) FILTER (WHERE f.buying_price IS NULL)::int AS unpriced_orders
      ${joins} ${cohortWhere} GROUP BY o.supplier_id
    ),report AS (
      SELECT c.supplier_id,b.name AS supplier_name,c.orders_given,c.orders_given AS order_count,
        ${money('coalesce(c.cost,0)')} AS total_buying_cost,${money('coalesce(c.paid,0)')} AS paid_amount,
        ${money('coalesce(c.pending,0)')} AS pending_amount,
        ${money('b.known_liability')} AS lifetime_buying_cost,${money('b.net_paid')} AS lifetime_paid_amount,
        ${money('b.unallocated_net_advance')} AS unallocated_paid_amount,${money('b.payable')} AS lifetime_pending_amount,
        ${money('b.credit')} AS lifetime_credit_amount,c.unpriced_orders,b.unpriced_orders::int AS lifetime_unpriced_orders
      FROM cohort c JOIN divyashilla.supplier_balances b ON b.supplier_id=c.supplier_id
    )`,summary:`count(*)::int AS supplier_count,coalesce(sum(orders_given),0)::int AS order_count,
      ${columns.filter(c=>c.numeric && !['orders_given','order_count','unpriced_orders','lifetime_unpriced_orders'].includes(c.key)).map(c=>sum(c.key)).join(',')},
      coalesce(sum(unpriced_orders),0)::int AS unpriced_orders,
      coalesce(sum(lifetime_unpriced_orders),0)::int AS lifetime_unpriced_orders`};
  }
  let columns:CsvColumn[],projection:string,summary:string;
  if(kind==='deliveries') {
    columns=[...baseColumns,...['delivery_status','driver_number','driver_or_bus_name','bus_number','delivered_at','assigned_delivery_user_id'].map(key=>({key}))];
    projection=`${baseProjection},d.delivery_status::text,d.driver_number,d.driver_or_bus_name,d.bus_number,
      to_char(d.delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS delivered_at,o.assigned_delivery_user_id`;
    summary=`${count},${['READY_FOR_DELIVERY','SENT','DELIVERED','ISSUE'].map(status=>
      `count(*) FILTER (WHERE delivery_status='${status}')::int AS ${status.toLowerCase()}_count`).join(',')}`;
  } else {
    columns=[...baseColumns,...financialColumns];projection=`${baseProjection},${financeProjection}`;summary=financialSummary;
  }
  return {values,columns,orderBy:'order_number::bigint DESC,order_id DESC',
    cte:`WITH report AS (SELECT ${projection} ${joins} ${where})`,summary};
}

export function dashboardQuery(input:ReportInput) {
  const values:unknown[]=[],clauses:string[]=[];
  for(const [key,operator] of [['date_from','>='],['date_to','<=']] as const) if(input[key]) {
    values.push(input[key]);clauses.push(`o.order_date ${operator} $${values.length}::date`);
  }
  const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
  const month="date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date";
  return {values,sql:`WITH selected AS (
    SELECT f.*,d.delivery_status FROM divyashilla.orders o
    JOIN divyashilla.order_financials f ON f.order_id=o.id
    JOIN divyashilla.deliveries d ON d.order_id=o.id ${where}
  ) SELECT count(*)::int AS total_orders,
    count(*) FILTER (WHERE order_status='CANCELLED')::int AS cancelled_orders,
    count(*) FILTER (WHERE delivery_status IN ('READY_FOR_DELIVERY','SENT','ISSUE'))::int AS pending_delivery,
    count(*) FILTER (WHERE delivery_status='ISSUE')::int AS delivery_issues,
    count(*) FILTER (WHERE order_status<>'CANCELLED' AND balance_amount>0)::int AS payment_pending_orders,
    ${money("coalesce(sum(balance_amount) FILTER (WHERE order_status<>'CANCELLED'),0)")} AS payment_pending_amount,
    ${money("coalesce(sum(selling_price) FILTER (WHERE order_status<>'CANCELLED'),0)")} AS sales,
    ${money("coalesce(sum(profit) FILTER (WHERE order_status<>'CANCELLED'),0)")} AS known_profit,
    count(*) FILTER (WHERE order_status<>'CANCELLED' AND buying_price IS NULL)::int AS unpriced_orders,
    ${money(`coalesce(sum(selling_price) FILTER (WHERE order_status<>'CANCELLED' AND order_date>=${month}
      AND order_date<(${month}+interval '1 month')),0)`)} AS monthly_sales,
    ${money(`coalesce(sum(profit) FILTER (WHERE order_status<>'CANCELLED' AND order_date>=${month}
      AND order_date<(${month}+interval '1 month')),0)`)} AS monthly_known_profit,
    count(*) FILTER (WHERE order_status<>'CANCELLED' AND buying_price IS NULL AND order_date>=${month}
      AND order_date<(${month}+interval '1 month'))::int AS monthly_unpriced_orders,
    (SELECT ${money('coalesce(sum(b.payable),0)')} FROM divyashilla.supplier_balances b
      WHERE b.supplier_id IN (SELECT supplier_id FROM selected)) AS supplier_payment_pending_amount,
    (SELECT count(*)::int FROM divyashilla.supplier_balances b WHERE b.payable>0
      AND b.supplier_id IN (SELECT supplier_id FROM selected)) AS supplier_payment_pending_suppliers
    FROM selected`};
}
