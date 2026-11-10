// Cut a release: bump the version, tag it and push. GitHub Actions then builds every installer
// and publishes the release (.github/workflows/release.yml).
//
//   npm run release            # 0.3.0 → 0.3.1
//   npm run release minor      # 0.3.0 → 0.4.0
//   npm run release 1.0.0      # an exact version
import { execSync } from 'node:child_process'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

const bump = process.argv[2] ?? 'patch'
if (!/^(patch|minor|major|prepatch|preminor|premajor|prerelease|\d+\.\d+\.\d+(-[\w.]+)?)$/.test(bump)) {
  console.error(`Unknown version "${bump}". Use patch, minor, major or an exact version like 1.2.0.`)
  process.exit(1)
}
if (out('git status --porcelain')) {
  console.error('Commit or stash your changes first: the release is built from what is on GitHub.')
  process.exit(1)
}
const branch = out('git rev-parse --abbrev-ref HEAD')
if (branch !== 'main') console.warn(`Note: releasing from "${branch}", not main.`)

// checks first, so a broken build never gets a tag
run('npm run typecheck')
run('npm test')
// bumps package.json + package-lock.json, commits "Release vX.Y.Z" and tags vX.Y.Z
run(`npm version ${bump} -m "Release v%s"`)
run('git push --follow-tags')
const v = out('node -p "require(\'./package.json\').version"')
console.log(`\nPushed v${v}. GitHub Actions is building it: https://github.com/prezine/toom-software/actions`)
