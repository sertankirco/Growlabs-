import { readFileSync } from 'fs';
import { join } from 'path';
import { PgPool } from './PgPool';

// ── Basit Migration Runner ────────────────────────────────────────────────────
//
// Kullanım:
//   const pool = new PgPool(config);
//   await migrate(pool);
//
// schema.sql dosyasını okur ve tüm DDL ifadelerini çalıştırır.
// IF NOT EXISTS kullandığından her çalıştırmada güvenle tekrar edilebilir.

export async function migrate(pool: PgPool): Promise<void> {
  const schemaPath = join(__dirname, 'schema.sql');
  const sql        = readFileSync(schemaPath, 'utf8');

  // Noktalı virgülle ayrılmış ifadeleri çalıştır (yorumları atla)
  const statements = sql
    .split(';')
    .map(s => s.replace(/--[^\n]*/g, '').trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await pool.query(stmt);
  }

  console.log(`✓ Migration tamamlandı — ${statements.length} DDL ifadesi`);
}

// CLI olarak doğrudan çalıştırılabilir:
//   DATABASE_URL=postgres://... node --require ts-node/register src/db/migrate.ts
if (require.main === module) {
  const { parseDatabaseUrl } = require('./PgPool');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL tanımlı değil'); process.exit(1); }

  const pool = new PgPool(parseDatabaseUrl(url));
  migrate(pool)
    .then(() => pool.end())
    .catch(err => { console.error('Migration hatası:', err); process.exit(1); });
}
