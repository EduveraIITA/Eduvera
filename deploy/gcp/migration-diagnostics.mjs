// Emit only code-owned error categories and schema identifiers, never raw job logs.
export function migrationDiagnostics(entries) {
  const summaries = new Set();
  for (const entry of entries) {
    const text = typeof entry.textPayload === 'string' ? entry.textPayload : '';
    const applied = text.match(/^Applied ([A-Za-z0-9_-]+\.sql)\s*$/);
    if (applied) summaries.add(`Last migration evidence: ${applied[1]}`);
    const categories = [
      ['checksum mismatch', /checksum mismatch/i],
      ['permission denied', /permission denied/i],
      ['ownership required', /must be owner/i],
      ['object already exists', /already exists/i],
      ['object missing', /does not exist/i],
      ['constraint violation', /violates .*constraint/i],
      ['syntax error', /syntax error/i],
      ['ambiguous reference', /ambiguous/i],
      ['dependency conflict', /cannot .*because other objects depend/i],
      ['connection failure', /ECONNREFUSED|ETIMEDOUT|connection terminated/i],
      ['authentication failure', /password authentication failed/i],
    ];
    for (const [label, pattern] of categories) {
      if (!pattern.test(text)) continue;
      const object = text.match(/\b(relation|table|column|function|type|schema|extension) "([A-Za-z_][A-Za-z0-9_.]*)"/);
      const migration = text.match(/\b([A-Za-z0-9_-]+\.sql)\b/);
      summaries.add(`Migration error: ${label}${object ? ` (${object[1]} ${object[2]})` : ''}${migration ? ` [${migration[1]}]` : ''}`);
    }
  }
  return [...summaries].slice(0, 30);
}
