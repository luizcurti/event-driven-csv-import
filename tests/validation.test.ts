import { describe, expect, it } from '@jest/globals';
import { validateCustomerRecord } from '../shared/validation.js';

describe('customer validation', () => {
  it('accepts a valid record', () => {
    const issues = validateCustomerRecord({
      customerId: '1',
      name: 'Alice',
      email: 'alice@example.com',
      cpf: '52998224725',
      age: 30,
      status: 'VALID',
    });

    expect(issues).toHaveLength(0);
  });

  it('rejects invalid email and age', () => {
    const issues = validateCustomerRecord({
      customerId: '1',
      name: 'Alice',
      email: 'invalid',
      cpf: '52998224725',
      age: -1,
      status: 'VALID',
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'age' }),
      ]),
    );
  });

  it('rejects cpf values with the wrong length', () => {
    const issues = validateCustomerRecord({
      customerId: '1',
      name: 'Alice',
      email: 'alice@example.com',
      cpf: '1234567890',
      age: 30,
      status: 'VALID',
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'cpf' }),
      ]),
    );
  });

  it('accepts a cpf that follows the alternate digit path', () => {
    const issues = validateCustomerRecord({
      customerId: '1',
      name: 'Alice',
      email: 'alice@example.com',
      cpf: '00000000604',
      age: 30,
      status: 'VALID',
    });

    expect(issues).toHaveLength(0);
  });
});