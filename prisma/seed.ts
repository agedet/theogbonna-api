/**
 * Seed: create the first super-admin account.
 *
 * Run:
 *   npx tsx prisma/seed.ts
 *
 * Safe to run multiple times — it skips creation if the email already exists.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const SUPER_ADMIN_EMAIL    = 'culmerin@gmail.com';
const SUPER_ADMIN_PASSWORD = 'SuperAgent$9060';
const SUPER_ADMIN_FIRST    = 'Culme';
const SUPER_ADMIN_LAST     = 'Rin';

async function main() {
  console.log('🌱 Seeding super-admin…\n');

  // ── Guard: skip if already seeded ──────────────────────────────────────────
  const existing = await prisma.profile.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
  });

  if (existing) {
    console.log(`✅ Super-admin already exists (${SUPER_ADMIN_EMAIL}). Nothing to do.`);
    return;
  }

  // ── Hash password ──────────────────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
  const userId = randomUUID();
  const now    = new Date();

  // ── Create auth.users + public.profile in one nested write ────────────────
  await prisma.users.create({
    data: {
      id:                 userId,
      email:              SUPER_ADMIN_EMAIL,
      encrypted_password: hashedPassword,
      instance_id:        '00000000-0000-0000-0000-000000000000',
      is_anonymous:       false,
      // Setting email_confirmed_at marks the account as verified in Supabase auth.
      // confirmed_at is a generated column (LEAST of email/phone confirmed_at) — do NOT set it directly.
      email_confirmed_at: now,
      raw_user_meta_data: { tokenVersion: 0 },
      profile: {
        create: {
          email:               SUPER_ADMIN_EMAIL,
          first_name:          SUPER_ADMIN_FIRST,
          last_name:           SUPER_ADMIN_LAST,
          role:                'super_admin',
          terms_and_conditions: true,
          is_email_verified:   true,
        },
      },
    },
  });

  console.log('✅ Super-admin created successfully!\n');
  console.log(`   Email    : ${SUPER_ADMIN_EMAIL}`);
  console.log(`   Password : ${SUPER_ADMIN_PASSWORD}`);
  console.log(`   Role     : super_admin`);
  console.log(`   User ID  : ${userId}`);
  console.log('\n⚠️  Change this password after first login.\n');
}

main()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
