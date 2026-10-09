import { ForbiddenException } from '@nestjs/common';
import { sql } from 'kysely';
import type { DatabaseService } from '../database/database.service.js';

export async function proFeaturesEnabled(db: DatabaseService, userId: string): Promise<boolean> {
  const result = await sql<{ enabled: boolean }>`SELECT pro_features_enabled AS enabled FROM users WHERE id=${userId}::uuid AND is_active`.execute(db);
  return result.rows[0]?.enabled === true;
}

export async function requireProFeatures(db: DatabaseService, userId: string): Promise<void> {
  if (!(await proFeaturesEnabled(db, userId))) throw new ForbiddenException('Turn on Pro features in your profile to use this assistant feature.');
}
