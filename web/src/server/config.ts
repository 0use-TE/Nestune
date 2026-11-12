import path from 'node:path';

export const VERSION = '0.1.0';
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
export const dir = (...p: string[]) => path.join(DATA_DIR, ...p);
export const QUALITIES = ['standard', 'exhigh', 'lossless', 'hires'] as const;
export type Quality = (typeof QUALITIES)[number];
export const SESSION_DAYS = 30;
export const ADMIN_SESSION_HOURS = 12;
export const ACTIVATION_HOURS = 48;

export function adminKey() {
  const k = process.env.ADMIN_KEY || '';
  return k.length >= 32 ? k : '';
}
export function extraOrigins() {
  return (process.env.PUBLIC_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}
