import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

// Ensure single instance lock for desktop stability
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || process.argv.includes('--dev'));

  function createMainWindow() {
    const preloadPath = fs.existsSync(path.join(__dirname, 'preload.cjs'))
      ? path.join(__dirname, 'preload.cjs')
      : path.join(__dirname, 'preload.js');

    mainWindow = new BrowserWindow({
      width: 1366,
      height: 850,
      minWidth: 1024,
      minHeight: 680,
      title: 'Bipin Petroleum Co. - Powered by ZenterPrime',
      backgroundColor: '#F7F8FC',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      }
    });

    // Remove default electron menu bar
    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);
    if (mainWindow.removeMenu) {
      mainWindow.removeMenu();
    }

    // Graceful ready-to-show to prevent white flashing
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      mainWindow.focus();
    });

    // Intercept external links and open in default web browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') || url.startsWith('file://')) {
        return;
      }
      if (url.startsWith('http:') || url.startsWith('https:')) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    const devServerUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
    const distIndexPath = path.join(__dirname, 'dist', 'index.html');

    if (isDev) {
      mainWindow.loadURL(devServerUrl).catch(() => {
        console.log('[Electron] Dev server unreachable, falling back to dist/index.html');
        if (fs.existsSync(distIndexPath)) {
          mainWindow.loadFile(distIndexPath);
        }
      });
    } else {
      if (fs.existsSync(distIndexPath)) {
        mainWindow.loadFile(distIndexPath);
      } else {
        mainWindow.loadURL(devServerUrl).catch((err) => {
          console.error('[Electron] Failed to load URL/file:', err);
        });
      }
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  // App lifecycle
  app.whenReady().then(() => {
    // IPC handlers
    ipcMain.handle('app:version', () => app.getVersion());
    ipcMain.handle('app:platform', () => process.platform);
    ipcMain.on('app:quit', () => app.quit());
    ipcMain.on('app:minimize', () => mainWindow && mainWindow.minimize());
    ipcMain.on('app:maximize', () => {
      if (mainWindow) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
      }
    });
    ipcMain.on('app:reload', () => mainWindow && mainWindow.reload());
    ipcMain.on('app:toggle-devtools', () => mainWindow && mainWindow.webContents.toggleDevTools());
    ipcMain.handle('app:print', async (event, options) => {
      if (!mainWindow) return { success: false, error: 'No active window' };
      return new Promise((resolve) => {
        mainWindow.webContents.print(options || {}, (success, failureReason) => {
          resolve({ success, failureReason });
        });
      });
    });

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
