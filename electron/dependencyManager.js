/**
 * STMZ AI - Dependency Manager
 * Handles post-install downloads of runtime dependencies:
 *   - FFmpeg (from public BtbN builds)
 *   - AI Models (downloaded by the engine via PyTorch Hub)
 *
 * The engine itself is bundled in the installer as it IS the core logic.
 * Everything downloads into the install directory (next to the .exe).
 */

import { app } from 'electron';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

// ── FFmpeg download URL (public builds) ────────────────────────────────────
// BtbN provides reliable, up-to-date FFmpeg builds for Windows
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

// ── Path helpers ───────────────────────────────────────────────────────────

export function getInstallDir() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  // Dev: use project root
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(currentDir, '..');
}

export function getEnginePath(installDir) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'engine', 'main.exe');
  }
  const devExe = path.join(installDir, 'dist-engine', 'main', 'main.exe');
  if (fs.existsSync(devExe)) return devExe;
  return path.join(installDir, 'engine', 'main.py');
}

export function getFfmpegDir(installDir) {
  return path.join(installDir, 'bin', 'ffmpeg');
}

export function getModelsDir(installDir) {
  return path.join(installDir, 'models');
}

// ── Dependency checking ────────────────────────────────────────────────────

export function checkDependencies() {
  const installDir = getInstallDir();

  // In dev mode, skip checks
  if (!app.isPackaged) {
    return { ffmpeg: true, models: true, installDir };
  }

  const ffmpegOk = fs.existsSync(path.join(getFfmpegDir(installDir), 'ffmpeg.exe'));

  const checkpointDir = path.join(getModelsDir(installDir), 'hub', 'checkpoints');
  let modelsOk = false;
  try {
    modelsOk = fs.existsSync(checkpointDir) && fs.readdirSync(checkpointDir).length > 0;
  } catch {
    modelsOk = false;
  }

  return { ffmpeg: ffmpegOk, models: modelsOk, installDir };
}

// ── Download file with redirect following + progress ───────────────────────

function downloadFile(url, destPath, onProgress, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;

    const req = proto.get(url, { headers: { 'User-Agent': 'STMZ-AI/1.0' } }, (res) => {
      // Follow redirects (GitHub → S3/CDN)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        return downloadFile(res.headers.location, destPath, onProgress, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP error ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
      let downloadedBytes = 0;
      let lastReportTime = Date.now();
      let lastReportBytes = 0;

      const file = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (now - lastReportTime > 250 || downloadedBytes === totalBytes) {
          const elapsed = (now - lastReportTime) / 1000 || 1;
          const speed = (downloadedBytes - lastReportBytes) / elapsed;
          lastReportTime = now;
          lastReportBytes = downloadedBytes;
          if (onProgress) {
            onProgress({
              downloadedBytes,
              totalBytes,
              percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
              speed,
            });
          }
        }
      });

      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Download timed out'));
    });
  });
}

// ── Extract zip using built-in tar (Windows 10+) ──────────────────────────

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    execFile('tar', ['-xf', zipPath, '-C', destDir], { timeout: 600000 }, (error) => {
      if (error) reject(new Error(`Extraction failed: ${error.message}`));
      else resolve();
    });
  });
}

// ── Find a file recursively in a directory ─────────────────────────────────

function findFileRecursive(dir, filename) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename);
        if (found) return found;
      }
    }
  } catch { /* ignore permission errors */ }
  return null;
}

// ── Download and install FFmpeg ────────────────────────────────────────────

export async function downloadFfmpeg(onProgress) {
  const installDir = getInstallDir();
  const tempZip = path.join(installDir, '_ffmpeg_download.zip');
  const ffmpegDir = getFfmpegDir(installDir);

  try {
    // Download
    onProgress({ step: 'ffmpeg', phase: 'downloading', percent: 0, message: 'Downloading FFmpeg...' });
    await downloadFile(FFMPEG_URL, tempZip, (p) => {
      onProgress({
        step: 'ffmpeg',
        phase: 'downloading',
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
        speed: p.speed,
        message: `Downloading FFmpeg... ${formatBytes(p.downloadedBytes)} / ${formatBytes(p.totalBytes)}`,
      });
    });

    // Extract to temp dir
    onProgress({ step: 'ffmpeg', phase: 'extracting', percent: 100, message: 'Extracting FFmpeg...' });
    const tempExtract = path.join(installDir, '_ffmpeg_extract');
    fs.mkdirSync(tempExtract, { recursive: true });
    await extractZip(tempZip, tempExtract);

    // Find ffmpeg.exe / ffprobe.exe (BtbN zips have nested directories)
    fs.mkdirSync(ffmpegDir, { recursive: true });
    for (const bin of ['ffmpeg.exe', 'ffprobe.exe']) {
      const found = findFileRecursive(tempExtract, bin);
      if (found) {
        fs.copyFileSync(found, path.join(ffmpegDir, bin));
      }
    }

    // Cleanup
    fs.rmSync(tempExtract, { recursive: true, force: true });
    onProgress({ step: 'ffmpeg', phase: 'done', percent: 100, message: 'FFmpeg installed!' });
  } finally {
    try { fs.unlinkSync(tempZip); } catch {}
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
