// scripts/build-all.js
//
// Script intelligent multi-plateforme.
// - Sur macOS : compile Windows + macOS + Linux en une fois
// - Sur Windows ou Linux : compile Windows + Linux (skip macOS, impossible techniquement)
//   et imprime un message clair expliquant pourquoi.

const { spawnSync } = require('child_process');
const os = require('os');

const platform = os.platform(); // 'darwin', 'win32', 'linux'
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(msg, color = '') {
  console.log(`${color}${msg}${COLORS.reset}`);
}

function header(msg) {
  console.log('');
  log('═'.repeat(60), COLORS.cyan);
  log('  ' + msg, COLORS.bold + COLORS.cyan);
  log('═'.repeat(60), COLORS.cyan);
}

function runBuild(args, label) {
  header(`▶ Build ${label}`);
  const result = spawnSync('npx', ['electron-builder', ...args], {
    stdio: 'inherit',
    shell: true
  });
  if (result.status !== 0) {
    log(`✗ Échec du build ${label}`, COLORS.red);
    return false;
  }
  log(`✓ Build ${label} réussi`, COLORS.green);
  return true;
}

console.log('');
log(`Plateforme détectée : ${platform === 'darwin' ? 'macOS 🍎' : platform === 'win32' ? 'Windows 🪟' : 'Linux 🐧'}`, COLORS.bold);

const results = [];

if (platform === 'darwin') {
  // Sur macOS : on peut tout faire
  log('Build complet : Windows + macOS + Linux', COLORS.cyan);
  results.push({ target: 'Windows', ok: runBuild(['--win'], 'Windows (NSIS)') });
  results.push({ target: 'macOS', ok: runBuild(['--mac'], 'macOS (DMG arm64+x64)') });
  results.push({ target: 'Linux', ok: runBuild(['--linux'], 'Linux (AppImage + .deb)') });
} else {
  // Sur Windows/Linux : on compile Win + Linux uniquement
  log('Build limité : Windows + Linux (macOS impossible depuis cette plateforme)', COLORS.yellow);
  results.push({ target: 'Windows', ok: runBuild(['--win'], 'Windows (NSIS)') });
  results.push({ target: 'Linux', ok: runBuild(['--linux'], 'Linux (AppImage + .deb)') });
}

// Résumé final
header('Résumé');
for (const r of results) {
  if (r.ok) log(`  ✓ ${r.target}`, COLORS.green);
  else log(`  ✗ ${r.target}`, COLORS.red);
}

if (platform !== 'darwin') {
  console.log('');
  log('ℹ Pour générer aussi le .dmg macOS :', COLORS.yellow);
  log('   • soit lance "npm run build:mac" sur un Mac', COLORS.yellow);
  log('   • soit utilise GitHub Actions (workflow déjà configuré dans .github/workflows/build.yml)', COLORS.yellow);
  log('   • soit loue un Mac cloud temporaire (MacInCloud, MacStadium, ~3$/h)', COLORS.yellow);
  console.log('');
}

const allOk = results.every(r => r.ok);
if (allOk) {
  log('Tous les fichiers sont dans dist/', COLORS.green);
  process.exit(0);
} else {
  log('Au moins un build a échoué — voir logs ci-dessus', COLORS.red);
  process.exit(1);
}
