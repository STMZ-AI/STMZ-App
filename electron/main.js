import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  checkDependencies,
  downloadFfmpeg,
  getInstallDir,
  getEnginePath,
  getFfmpegDir,
  getModelsDir,
} from './dependencyManager.js';

const currentDir = typeof __dirname !== 'undefined' 
  ? __dirname 
  : path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let pythonProcess = null;

// ── Window creation ────────────────────────────────────────────────────────

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(currentDir, '..', 'public', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    icon: iconPath,
    webPreferences: {
      preload: path.join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the Vite dev server in development, or the built files in production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(currentDir, '../dist/index.html'));
  }

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (line ${line} in ${sourceId})`);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  killPython();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Window controls ────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());

// ── File system dialogs ────────────────────────────────────────────────────

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'aiff', 'aif'] }
    ]
  });
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle('select-xml-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'XML Files', extensions: ['xml'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Output Folder',
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── Dependency management (replaces old check-models) ──────────────────────

ipcMain.handle('check-dependencies', async () => {
  return checkDependencies();
});

ipcMain.handle('download-dependency', async (_event, name) => {
  const sendProgress = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('setup-progress', data);
    }
  };

  try {
    if (name === 'ffmpeg') {
      await downloadFfmpeg(sendProgress);
    } else if (name === 'models') {
      // Models are downloaded by the engine itself via PyTorch Hub
      ensurePython();
      return new Promise((resolve) => {
        const sendCmd = () => {
          if (pythonProcess && !pythonProcess.killed) {
            pythonProcess.stdin.write(JSON.stringify({ cmd: 'download_models' }) + '\n');
            resolve(true);
          } else {
            resolve(false);
          }
        };
        setTimeout(sendCmd, 1500);
      });
    }
    return true;
  } catch (err) {
    sendProgress({
      step: name,
      phase: 'error',
      message: err.message,
    });
    return false;
  }
});

// ── Drag & drop support ───────────────────────────────────────────────────

ipcMain.handle('get-dropped-files', async (_event, paths) => {
  // Filter for valid audio files and folders
  const audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.aiff', '.aif'];
  const validFiles = [];

  for (const p of paths) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      // Return the directory path for the Python engine to scan
      return { type: 'folder', path: p };
    } else if (audioExts.includes(path.extname(p).toLowerCase())) {
      validFiles.push(p);
    }
  }

  return { type: 'files', files: validFiles };
});

// ── Python engine IPC ──────────────────────────────────────────────────────

function getPythonPath() {
  const installDir = getInstallDir();
  return getEnginePath(installDir);
}

function ensurePython() {
  if (pythonProcess && !pythonProcess.killed) return;

  const enginePath = getPythonPath();
  const isExe = enginePath.endsWith('.exe');
  const engineDir = path.dirname(enginePath);
  
  const installDir = getInstallDir();

  // Set up environment
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  
  // FFmpeg path
  const binDir = getFfmpegDir(installDir);
  // Models directory
  const modelsDir = getModelsDir(installDir);

  env.PATH = `${binDir}${path.delimiter}${env.PATH || ''}`;
  env.TORCH_HOME = modelsDir;
  
  console.log('[Main] Starting engine...');
  console.log(`[Main] Engine Path: ${enginePath}`);
  console.log(`[Main] Working Dir: ${engineDir}`);
  console.log(`[Main] FFmpeg Path: ${binDir}`);
  console.log(`[Main] Models Dir: ${modelsDir}`);

  // Ensure models directory exists
  if (!fs.existsSync(modelsDir)) {
    try {
      fs.mkdirSync(modelsDir, { recursive: true });
    } catch (e) {
      console.error(`[Main] Failed to create models directory: ${e.message}`);
    }
  }

  const spawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env,
    cwd: engineDir,
  };

  if (isExe) {
    pythonProcess = spawn(enginePath, [], spawnOptions);
  } else {
    pythonProcess = spawn('python', [enginePath], spawnOptions);
  }

  pythonProcess.on('error', (err) => {
    console.error(`[Main] Engine spawn error: ${err.message}`);
    mainWindow?.webContents.send('engine-message', {
      type: 'error',
      message: `Failed to start Python engine: ${err.message}. Please ensure Python is installed or the bundled engine is not blocked by antivirus.`,
    });
  });

  let buffer = '';

  pythonProcess.stdout.on('data', (data) => {
    const str = data.toString();
    buffer += str;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try {
          const msg = JSON.parse(trimmed);
          // Forward download_progress as setup-progress for SetupView
          if (msg.type === 'download_progress') {
            mainWindow.webContents.send('setup-progress', {
              step: 'models',
              phase: 'downloading',
              percent: msg.percent || 0,
              message: `Downloading AI Models... ${msg.downloaded || ''} / ${msg.total || ''}`,
            });
          } else if (msg.type === 'download_complete') {
            mainWindow.webContents.send('setup-progress', {
              step: 'models',
              phase: 'done',
              percent: 100,
              message: 'AI Models installed!',
            });
            mainWindow.webContents.send('engine-message', msg);
          } else {
            mainWindow.webContents.send('engine-message', msg);
          }
        } catch {
          // Non-JSON output (e.g., model download progress or raw print statements)
          mainWindow.webContents.send('engine-message', {
            type: 'log',
            message: trimmed,
          });
        }
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      console.log(`[Engine Error] ${msg}`);
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // Check for download progress patterns from torch hub (tqdm)
      const progressMatch = msg.match(/(\d+)%\|/);
      if (progressMatch) {
        mainWindow.webContents.send('setup-progress', {
          step: 'models',
          phase: 'downloading',
          percent: parseInt(progressMatch[1]),
          message: `Downloading AI Models... ${progressMatch[1]}%`,
        });
      }
      mainWindow.webContents.send('engine-message', {
        type: 'log',
        message: msg,
      });
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Main] Engine process exited with code ${code}`);
    pythonProcess = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('engine-message', {
      type: 'log',
      message: `Engine process exited with code ${code}. Check if a firewall or antivirus is blocking 'main.exe'.`,
    });
  });
}

function killPython() {
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
    setTimeout(() => {
      if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill();
      }
    }, 2000);
  }
}

ipcMain.handle('engine-send', async (_event, command) => {
  ensurePython();

  return new Promise((resolve) => {
    // Give the engine a moment to start if it just spawned
    const sendCommand = () => {
      if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.stdin.write(JSON.stringify(command) + '\n');
        resolve(true);
      } else {
        resolve(false);
      }
    };

    if (pythonProcess) {
      sendCommand();
    } else {
      setTimeout(sendCommand, 1000);
    }
  });
});

ipcMain.handle('engine-cancel', async () => {
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.kill('SIGINT'); // Attempt graceful kill
    setTimeout(() => {
      if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill(); // Force kill if still alive
      }
      pythonProcess = null;
    }, 100);
  }
  return true;
});
