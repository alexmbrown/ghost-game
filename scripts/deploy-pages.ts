// Build the static site for GitHub Pages and publish it to the gh-pages branch.
//
//   npm run deploy
//
// Pages serves the branch as https://<owner>.github.io/<repo>/ (repo Settings →
// Pages → "Deploy from a branch": gh-pages, / (root)). The branch holds only
// the built game; the source stays on main. (.github/workflows/deploy.yml does
// the same on every push, for tokens allowed to push workflow files.)

import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..');
const sh = (cmd: string, cwd = root) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();

const remote = sh('git remote get-url origin');
const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
if (!m) throw new Error(`origin is not a GitHub repo: ${remote}`);
const [, owner, repo] = m;
const sha = sh('git rev-parse --short HEAD');
const dirty = sh('git status --porcelain') ? ' (with uncommitted changes)' : '';

console.log(`Building for https://${owner.toLowerCase()}.github.io/${repo}/ …`);
execSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_BASE_PATH: `/${repo}`, NEXT_PUBLIC_SITE_URL: `https://${owner.toLowerCase()}.github.io` },
});
// Pages runs Jekyll by default, which would hide the _next/ folder.
writeFileSync(join(root, 'out', '.nojekyll'), '');

// Publish out/ as a fresh single-commit gh-pages branch.
const dir = mkdtempSync(join(tmpdir(), 'ghost-pages-'));
try {
  cpSync(join(root, 'out'), dir, { recursive: true });
  const name = sh('git config user.name');
  const email = sh('git config user.email');
  const git = (args: string) => execSync(`git -c user.name="${name}" -c user.email="${email}" ${args}`, { cwd: dir, stdio: 'inherit' });
  git('init -q -b gh-pages');
  git('add -A');
  git(`commit -q -m "Deploy ${sha}${dirty}"`);
  git(`push -f ${remote} gh-pages`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nPublished. Live in a minute or two at https://${owner.toLowerCase()}.github.io/${repo}/`);
