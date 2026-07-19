const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

async function captureBootstrap() {
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  await window.webContents.executeJavaScript(`
    document.fonts.ready.then(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
  `);

  const image = await window.webContents.capturePage();
  const outputPath = path.join(__dirname, '../docs/day-01-bootstrap.png');
  await writeFile(outputPath, image.toPNG());
  console.log(`Bootstrap screenshot written to ${outputPath}`);
  window.destroy();
}

app
  .whenReady()
  .then(captureBootstrap)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
