import fs from 'node:fs';

const requiredFiles = [
  './index.html',
  './manifest.json',
  './sw.js',
  './icon-512.png',
  './icon-192.png',
  './apple-touch-icon.png',
  './favicon.png'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    console.error(`Error: ${file} not found`);
    process.exit(1);
  }
}

console.log('Build completed successfully: index.html and all brand icon assets verified.');

