import sharp from 'sharp';
import fs from 'node:fs';

const SRC_ICON = './public/assets/aistudio/file_000000009c3c820e88e3723beb528c7e_c911c872.png';

async function buildIcons() {
  if (!fs.existsSync(SRC_ICON)) {
    console.error(`Fonte oficial do ícone não encontrada: ${SRC_ICON}`);
    process.exit(1);
  }

  // 1. icon-512.png (512x512)
  await sharp(SRC_ICON)
    .resize(512, 512, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile('./icon-512.png');
  console.log('✔ Criado icon-512.png (512x512)');

  // 2. icon-192.png (192x192)
  await sharp(SRC_ICON)
    .resize(192, 192, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile('./icon-192.png');
  console.log('✔ Criado icon-192.png (192x192)');

  // 3. apple-touch-icon.png (180x180)
  await sharp(SRC_ICON)
    .resize(180, 180, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile('./apple-touch-icon.png');
  console.log('✔ Criado apple-touch-icon.png (180x180)');

  // 4. favicon.png (64x64)
  await sharp(SRC_ICON)
    .resize(64, 64, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile('./favicon.png');
  console.log('✔ Criado favicon.png (64x64)');

  // 5. favicon.ico (32x32)
  await sharp(SRC_ICON)
    .resize(32, 32, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile('./favicon.ico');
  console.log('✔ Criado favicon.ico (32x32)');

  // 6. Maskable icons (área de segurança circular 82% com fundo preto contínuo)
  const inner512 = await sharp(SRC_ICON)
    .resize(420, 420, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    }
  })
  .composite([{ input: inner512, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile('./icon-512-maskable.png');
  console.log('✔ Criado icon-512-maskable.png (512x512)');

  const inner192 = await sharp(SRC_ICON)
    .resize(158, 158, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 192,
      height: 192,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    }
  })
  .composite([{ input: inner192, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile('./icon-192-maskable.png');
  console.log('✔ Criado icon-192-maskable.png (192x192)');

  // 7. icon.svg (SVG com o PNG oficial incorporado em alta definição)
  const b64 = fs.readFileSync('./icon-512.png').toString('base64');
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${b64}" width="512" height="512" />
</svg>`;
  fs.writeFileSync('./icon.svg', svgContent);
  console.log('✔ Criado icon.svg');

  // 8. logo.png e logo-192.png dedicados
  fs.copyFileSync('./icon-512.png', './logo.png');
  fs.copyFileSync('./icon-192.png', './logo-192.png');
  console.log('✔ Criados logo.png e logo-192.png');

  // 9. Cópia para /public para redundância
  fs.mkdirSync('./public', { recursive: true });
  fs.copyFileSync('./icon-512.png', './public/icon-512.png');
  fs.copyFileSync('./icon-192.png', './public/icon-192.png');
  fs.copyFileSync('./icon-512-maskable.png', './public/icon-512-maskable.png');
  fs.copyFileSync('./icon-192-maskable.png', './public/icon-192-maskable.png');
  fs.copyFileSync('./apple-touch-icon.png', './public/apple-touch-icon.png');
  fs.copyFileSync('./favicon.png', './public/favicon.png');
  fs.copyFileSync('./favicon.ico', './public/favicon.ico');
  fs.copyFileSync('./logo.png', './public/logo.png');
  fs.copyFileSync('./icon.svg', './public/icon.svg');
  console.log('✔ Copiados todos os ícones para ./public/');

  // 10. Sincronização com o diretório de build do Android
  if (fs.existsSync('./tmp/apk_build/res/drawable')) {
    fs.copyFileSync('./icon-192.png', './tmp/apk_build/res/drawable/ic_launcher.png');
    console.log('✔ Sincronizado ./tmp/apk_build/res/drawable/ic_launcher.png');
  }
  if (fs.existsSync('./tmp/apk_build/assets')) {
    fs.copyFileSync('./icon-192.png', './tmp/apk_build/assets/icon-192.png');
    fs.copyFileSync('./icon-512.png', './tmp/apk_build/assets/icon-512.png');
    fs.copyFileSync('./favicon.png', './tmp/apk_build/assets/favicon.png');
    fs.copyFileSync('./apple-touch-icon.png', './tmp/apk_build/assets/apple-touch-icon.png');
    fs.copyFileSync('./icon-512-maskable.png', './tmp/apk_build/assets/icon-512-maskable.png');
    fs.copyFileSync('./icon-192-maskable.png', './tmp/apk_build/assets/icon-192-maskable.png');
    fs.copyFileSync('./logo.png', './tmp/apk_build/assets/logo.png');
    console.log('✔ Sincronizados ./tmp/apk_build/assets/');
  }
}

buildIcons().catch(err => {
  console.error(err);
  process.exit(1);
});

