/**
 * Turbopack loader for the NodeNext workspace packages
 * (@vagapilot/core, db, ai, jobs, gmail, ats-adapters, browser-pool).
 * Their relative imports end in `.js` (required by `moduleResolution: NodeNext`) but the files
 * are `.ts`; Turbopack has no `extensionAlias`, so the suffix is dropped before resolution.
 */
const RELATIVE_JS =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']+?)\.js\2/g

module.exports = function stripRelativeJsExtension(source) {
  return source.replace(RELATIVE_JS, "$1$2$3$2")
}
