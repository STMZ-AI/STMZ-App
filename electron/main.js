import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
  // In production, use the bundled Python
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'engine', 'main.py');
  }
  return path.join(currentDir, '..', 'engine', 'main.py');
}

function ensurePython() {
  if (pythonProcess && !pythonProcess.killed) return;

  const enginePath = getPythonPath();
  pythonProcess = spawn('python', [enginePath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  pythonProcess.on('error', (err) => {
    mainWindow?.webContents.send('engine-message', {
      type: 'error',
      message: `Failed to start Python engine: ${err.message}. Make sure Python is installed and in your PATH.`,
    });
  });

  let buffer = '';

  pythonProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try {
          const msg = JSON.parse(line.trim());
          mainWindow.webContents.send('engine-message', msg);
        } catch {
          // Non-JSON output (e.g., model download progress)
          mainWindow.webContents.send('engine-message', {
            type: 'log',
            message: line.trim(),
          });
        }
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('engine-message', {
        type: 'log',
        message: msg,
      });
    }
  });

  pythonProcess.on('close', (code) => {
    pythonProcess = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('engine-message', {
      type: 'log',
      message: `Engine process exited with code ${code}`,
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
