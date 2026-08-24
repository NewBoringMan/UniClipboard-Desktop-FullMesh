#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const [manifestArg = 'desktop/Cargo.toml', engineArg = 'engine'] = process.argv.slice(2)
const manifest = path.resolve(manifestArg)
const engine = path.resolve(engineArg)

const crates = ['uc-engine', 'uc-observability-contract']
for (const crate of crates) {
  const crateManifest = path.join(engine, 'crates', crate, 'Cargo.toml')
  if (!fs.existsSync(crateManifest)) {
    throw new Error(`verified Engine crate is missing: ${crateManifest}`)
  }
}

const relativeEngine = path
  .relative(path.dirname(manifest), engine)
  .split(path.sep)
  .join('/')
const source = fs.readFileSync(manifest, 'utf8')
let rewritten = source

for (const crate of crates) {
  const matcher = new RegExp(
    `^${crate} = \\{ git = "https://github\\.com/UniClipboard/Engine\\.git", rev = "[0-9a-f]{40}" \\}$`,
    'm',
  )
  if (!matcher.test(rewritten)) {
    throw new Error(`expected immutable ${crate} Engine dependency was not found`)
  }
  rewritten = rewritten.replace(
    matcher,
    `${crate} = { path = "${relativeEngine}/crates/${crate}" }`,
  )
}

fs.writeFileSync(manifest, rewritten)
console.log(`resolved ${crates.join(', ')} from verified checkout ${relativeEngine}`)
