import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const logoPath = path.join(projectRoot, 'src', 'assets', 'STMZ logo.png');
const pngPath = path.join(projectRoot, 'public', 'icon.png');

// Generate a 256x256 PNG from the STMZ logo for Electron Builder
sharp(logoPath)
  .resize(256, 256, { fit: 'contain', background: { r: 10, g: 10, b: 15, alpha: 1 } })
  .png()
  .toFile(pngPath)
  .then(() => console.log('Icon generated:', pngPath))
  .catch((err) => console.error('Error:', err));
