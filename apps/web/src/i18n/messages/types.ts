/**
 * Message catalogs are nested string trees. Domain modules export the same
 * key shape in zh-CN and en-US; `messages/index.ts` merges and type-checks
 * parity.
 */
export type MessageTree = { [key: string]: string | MessageTree };

export type MessageParams = Record<string, string | number>;

/** Flatten `a.b.c` paths into a dotted lookup map. */
export function flattenMessages(
  tree: MessageTree,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flattenMessages(value, path));
  }
  return out;
}

/**
 * `{name}` interpolation only — no concatenation of fragments into sentences.
 * Unknown placeholders are left intact so tests can catch them.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
