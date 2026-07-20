import type { CustomerRecord, ValidationIssue } from './types.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const onlyDigits = (value: string): string => value.replaceAll(/\D/gu, '');

const isValidCpf = (value: string): boolean => {
  const cpf = onlyDigits(value);

  if (cpf.length !== 11 || /^([0-9])\1{10}$/u.test(cpf)) {
    return false;
  }

  const calculateDigit = (limit: number): number => {
    const sum = cpf
      .slice(0, limit)
      .split('')
      .reduce((accumulator, digit, index) => accumulator + Number(digit) * (limit + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const firstDigit = calculateDigit(9);
  const secondDigit = calculateDigit(10);

  return firstDigit === Number(cpf[9]) && secondDigit === Number(cpf[10]);
};

export const validateCustomerRecord = (record: CustomerRecord): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (!record.customerId.trim()) {
    issues.push({ field: 'customerId', message: 'Customer ID is required.' });
  }

  if (!record.name.trim()) {
    issues.push({ field: 'name', message: 'Name is required.' });
  }

  if (!record.email.trim() || !emailPattern.test(record.email)) {
    issues.push({ field: 'email', message: 'Email is invalid.' });
  }

  if (!record.cpf.trim() || !isValidCpf(record.cpf)) {
    issues.push({ field: 'cpf', message: 'CPF is invalid.' });
  }

  if (!Number.isFinite(record.age) || record.age < 0) {
    issues.push({ field: 'age', message: 'Age cannot be negative.' });
  }

  return issues;
};

export const validateUploadFile = (
  fileName: string,
  contentType: string,
  sizeBytes: number,
  allowedMimeTypes: string[],
  maxFileSizeBytes: number,
): void => {
  const normalizedFileName = fileName.trim().toLowerCase();

  if (!normalizedFileName.endsWith('.csv')) {
    throw new Error('Only CSV files are accepted.');
  }

  if (!allowedMimeTypes.includes(contentType.toLowerCase())) {
    throw new Error('Unsupported file content type.');
  }

  if (sizeBytes > maxFileSizeBytes) {
    throw new Error('File size exceeds the configured limit.');
  }
};