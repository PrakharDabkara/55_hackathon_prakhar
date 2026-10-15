export const ROLES = ['seeker', 'shop', 'admin'] as const;

export type Role = (typeof ROLES)[number];
