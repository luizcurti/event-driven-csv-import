import { describe, expect, it } from '@jest/globals';
import { mapCsvRowsToCustomerRecords, parseCsvText, splitCsvIntoChunks } from '../shared/csv.js';

describe('csv helpers', () => {
  it('splits csv into chunked files', () => {
    const csv = ['customerId,name,email,cpf,age', '1,Alice,alice@example.com,52998224725,30', '2,Bob,bob@example.com,12345678909,40'].join('\n');

    const chunks = splitCsvIntoChunks(csv, 1);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toContain('Alice');
  });

  it('parses csv rows into objects', () => {
    const csv = ['customerId,name,email,cpf,age', '1,Alice,alice@example.com,52998224725,30'].join('\n');

    const rows = parseCsvText(csv);

    expect(rows).toEqual([
      {
        customerId: '1',
        name: 'Alice',
        email: 'alice@example.com',
        cpf: '52998224725',
        age: '30',
      },
    ]);
  });

  it('handles escaped quotes and missing fields', () => {
    const csv = ['customerId,name,email,cpf,age', '1,"Alice ""Ace"" Smith",alice@example.com,52998224725'].join('\n');

    expect(parseCsvText(csv)).toEqual([
      {
        customerId: '1',
        name: 'Alice "Ace" Smith',
        email: 'alice@example.com',
        cpf: '52998224725',
        age: '',
      },
    ]);

    expect(mapCsvRowsToCustomerRecords([{}])).toEqual([
      {
        customerId: '',
        name: '',
        email: '',
        cpf: '',
        age: 0,
        status: 'VALID',
      },
    ]);
  });
});