/** SQL rewriting is confined to the independently configured Simulation store. */
export function quoteSimulationIdentifier(value) {
    if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value))
        throw new Error("Invalid Simulation SQL identifier.");
    return `"${value}"`;
}
/** Preserve literals, quoted identifiers and comments while binding SQL time. */
export function bindSimulationSql(source, schema) {
    const identifier = quoteSimulationIdentifier(schema);
    const tokens = source.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|[a-z_][a-z_0-9$]*|\s+|./giu) ?? [];
    let output = "";
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const lower = token.toLowerCase();
        if (lower === "pg_catalog" && tokens[index + 1] === "."
            && /^(?:now|transaction_timestamp|statement_timestamp|clock_timestamp)$/iu.test(tokens[index + 2] ?? "")) {
            // System time functions must still bind to the selected virtual clock.
            index += 1;
            continue;
        }
        if ((lower === "public" || lower === '"public"') && tokens[index + 1] === ".") {
            output += identifier;
        }
        else if (lower === "current_timestamp" || lower === "localtimestamp") {
            output += `${identifier}.simulation_now()`;
            if (tokens[index + 1] === "(") {
                while (index + 1 < tokens.length && tokens[index + 1] !== ")")
                    index += 1;
                if (tokens[index + 1] === ")")
                    index += 1;
            }
        }
        else if (lower === "current_date") {
            output += `${identifier}.simulation_now()::date`;
        }
        else if ((lower === "now" || lower === "transaction_timestamp" || lower === "statement_timestamp" || lower === "clock_timestamp")
            && tokens[index + 1] === "(" && tokens[index + 2] === ")") {
            output += `${identifier}.simulation_now()`;
            index += 2;
        }
        else
            output += token;
    }
    return output;
}
/** Names only come from the captured, server-owned catalogue, never request data. */
export function writtenSimulationTables(query, tables, includeLocks = true) {
    const result = new Set();
    const pattern = /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:(?:"?[a-z_][a-z_0-9]*"?)\.)?"?([a-z_][a-z_0-9]*)"?/giu;
    for (const match of query.matchAll(pattern))
        if (tables.has(match[1]))
            result.add(match[1]);
    if (includeLocks && /\bfor\s+(?:no\s+key\s+update|key\s+share|update|share)\b/iu.test(query)) {
        for (const table of tables)
            if (new RegExp(`\\b${table}\\b`, "u").test(query))
                result.add(table);
    }
    return [...result].sort();
}
//# sourceMappingURL=simulation-sql.js.map