'use strict';

function orderedBodyArmRecords(byName) {
  const com2 = byName.get('com2');
  const com5 = byName.get('com5');
  if (!com2 || !com5) {
    throw new Error('C0 Body+Arm inputs com2 and com5 are required.');
  }
  if (com2.drawOrder === com5.drawOrder) {
    throw new Error('C0 Body+Arm Parts must have distinct drawOrder values.');
  }
  return [com2, com5].sort((left, right) => left.drawOrder - right.drawOrder);
}

function bodyArmOverlayArgs(backPath, frontPath, outputPath) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', backPath,
    '-i', frontPath,
    '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto[v]',
    '-map', '[v]', '-frames:v', '1', '-pix_fmt', 'rgba', outputPath,
  ];
}

module.exports = { bodyArmOverlayArgs, orderedBodyArmRecords };
