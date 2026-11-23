#!/usr/bin/env node
const fs = require('node:fs/promises');
const net = require('node:net');

function call(port, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setEncoding('utf8');
    socket.setTimeout(23_000);
    let response = '';
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => { response += chunk; });
    socket.once('timeout', () => socket.destroy(new Error('Desktop command timed out.')));
    socket.once('error', reject);
    socket.once('end', () => {
      try { resolve(JSON.parse(response)); } catch { reject(new Error('The desktop editor returned an invalid result.')); }
    });
  });
}

async function main([flag, file, name, rawParams, ...extra]) {
  if (flag !== '--session-file' || !file || !name || extra.length) {
    throw new Error('Usage: node panda-live.cjs --session-file <file in the desktop tool drawer> <command> [JSON parameters]');
  }
  const descriptor = JSON.parse(await fs.readFile(file, 'utf8'));
  const { protocol, port, credential } = descriptor;
  if (protocol !== 1 || !Number.isInteger(port) || port < 1 || port > 65535 ||
    typeof credential !== 'string' || !/^[a-f0-9]{64}$/u.test(credential)) {
    throw new Error('Open the desktop tool drawer and copy the current session command.');
  }
  const params = rawParams === '-' ? JSON.parse(await fs.readFile(0, 'utf8')) : rawParams ? JSON.parse(rawParams) : {};
  if (!params || Array.isArray(params) || typeof params !== 'object') throw new Error('Parameters must be a JSON object.');
  return call(port, { protocol, credential, command: { ...params, name } });
}

main(process.argv.slice(2)).then(result => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}).catch(error => {
  process.stdout.write(`${JSON.stringify({ ok: false, code: 'CLI_ERROR', message: error.message })}\n`);
  process.exitCode = 1;
});
