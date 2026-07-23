const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const builderCli = require.resolve('electron-builder/cli.js');
const args = [builderCli, '--win', 'nsis', '--x64'];
const override = process.env.ELECTRON_OVERRIDE_DIST_PATH?.trim();
const installedElectronDist = path.join(projectRoot, 'node_modules', 'electron', 'dist');
const electronDist = override || (fs.existsSync(installedElectronDist) ? installedElectronDist : null);

if (electronDist) {
  if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
    throw new Error(`Electron distribution is incomplete: ${electronDist}`);
  }
  args.push(`--config.electronDist=${electronDist}`);
}

const result = spawnSync(process.execPath, args, {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
