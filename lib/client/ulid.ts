import { ulid } from 'ulid';

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const newId = (): string => ulid();

export const isValidUlid = (s: string): boolean => ULID_REGEX.test(s);
