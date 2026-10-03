export type ReportValue = string | number | boolean | null;
export type ReportRow = Record<string,ReportValue>;
export interface CsvColumn {key:string;numeric?:boolean}

// Quote every cell and neutralize spreadsheet formulas in user-supplied text.
// Only allowlisted numeric columns can retain a leading minus (negative profit).
export function encodeCsv(rows:ReportRow[],columns:CsvColumn[]):string {
  const cell = (value:ReportValue|undefined,numeric=false) => {
    let text = value===null || value===undefined ? '' : String(value);
    if (numeric && text && !/^-?\d+(\.\d+)?$/.test(text)) throw new Error('Invalid numeric report cell.');
    if (!numeric && (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return '\uFEFF'+[columns.map(column=>cell(column.key)).join(','),
    ...rows.map(row=>columns.map(column=>cell(row[column.key],column.numeric)).join(','))].join('\r\n')+'\r\n';
}
