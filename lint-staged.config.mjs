/** @type {import('lint-staged').Config} */
const PREttier_GLOB = "*.{ts,tsx,js,mjs,cjs,json,md,css,yml,yaml}"

/** Windows CMD length limit — batch prettier invocations. */
function prettierBatched(files) {
  const chunkSize = 15
  const commands = []
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    commands.push(`prettier --write ${chunk.map((f) => `"${f}"`).join(" ")}`)
  }
  return commands
}

export default {
  [PREttier_GLOB]: prettierBatched,
}
