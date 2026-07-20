import type { CustomerRecord } from './types.js';

export interface CsvChunk {
  chunkNumber: number;
  content: string;
  records: number;
}

const normalizeLineEndings = (value: string): string => value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

const parseCsvRow = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
};

export const parseCsvText = (csvText: string): Array<Record<string, string>> => {
  const normalized = normalizeLineEndings(csvText).trim();
  if (!normalized) {
    return [];
  }

  const rows = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length < 2) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const headers = parseCsvRow(headerRow);

  return dataRows.map((row) => {
    const values = parseCsvRow(row);
    return headers.reduce<Record<string, string>>((accumulator, header, index) => {
      accumulator[header] = values[index] ?? '';
      return accumulator;
    }, {});
  });
};

export const splitCsvIntoChunks = (csvText: string, chunkSize: number): CsvChunk[] => {
  const normalized = normalizeLineEndings(csvText).trim();
  if (!normalized) {
    return [];
  }

  const rows = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length <= 1) {
    return [];
  }

  const header = rows[0];
  const body = rows.slice(1);
  const chunks: CsvChunk[] = [];

  for (let index = 0; index < body.length; index += chunkSize) {
    const chunkRows = body.slice(index, index + chunkSize);
    chunks.push({
      chunkNumber: chunks.length + 1,
      content: [header, ...chunkRows].join('\n'),
      records: chunkRows.length,
    });
  }

  return chunks;
};

export const mapCsvRowsToCustomerRecords = (rows: Array<Record<string, string>>): CustomerRecord[] =>
  rows.map((row) => ({
    customerId: row.customerId ?? row.customer_id ?? '',
    name: row.name ?? '',
    email: row.email ?? '',
    cpf: row.cpf ?? '',
    age: Number(row.age ?? 0),
    status: 'VALID',
  }));