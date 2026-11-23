import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const BRIDGE_STATUS_URL = 'http://127.0.0.1:17420/status';

async function isBridgeAlive(timeoutMs = 350): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BRIDGE_STATUS_URL, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function buildBridgeRelease(rootDir: string): Promise<boolean> {
  return new Promise((resolveBuild) => {
    const proc = spawn('dotnet', ['build', 'bridge', '-c', 'Release', '--nologo', '-v', 'q'], {
      cwd: rootDir,
      windowsHide: true,
      stdio: 'ignore',
    });
    proc.once('error', () => resolveBuild(false));
    proc.once('exit', (code) => resolveBuild(code === 0));
  });
}

/**
 * Automatically starts and supervises the native zero-GC Windows ASIO audio service
 * (`bridge/bin/Release/net9.0-windows/sonicmambo-bridge.exe`) during `npm run dev`
 * so the guitar AMP runs at ~5–8 ms hardware RTL instead of falling back to laggy WebAudio.
 */
function sonicmamboAsioBridgePlugin(): Plugin {
  let child: ChildProcess | null = null;
  let startingPromise: Promise<boolean> | null = null;

  const stopChild = () => {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    child = null;
  };

  const ensureBridgeRunning = (rootDir: string): Promise<boolean> => {
    if (process.platform !== 'win32') {
      return Promise.resolve(false);
    }
    if (startingPromise) {
      return startingPromise;
    }

    startingPromise = (async () => {
      if (await isBridgeAlive()) {
        return true;
      }

      const exePath = resolve(
        rootDir,
        'bridge',
        'bin',
        'Release',
        'net9.0-windows',
        'sonicmambo-bridge.exe',
      );

      if (!existsSync(exePath)) {
        console.log('[ASIO Bridge] Building native Release ASIO host (one-time)...');
        await buildBridgeRelease(rootDir);
      }

      if (existsSync(exePath)) {
        child = spawn(exePath, [], {
          cwd: rootDir,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        child = spawn('dotnet', ['run', '--project', 'bridge', '-c', 'Release', '--no-launch-profile'], {
          cwd: rootDir,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text.includes('[OK] ASIO Active') || text.includes('[!] ASIO warning')) {
          for (const line of text.split(/\r?\n/)) {
            if (line.includes('[OK]') || line.includes('[!]')) {
              console.log(`[ASIO Bridge] ${line.trim()}`);
            }
          }
        }
      });

      child.once('exit', () => {
        child = null;
      });

      // Poll briefly until HTTP /status responds (~80-250ms for compiled .exe)
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 120));
        if (await isBridgeAlive(250)) {
          return true;
        }
      }
      return false;
    })().finally(() => {
      startingPromise = null;
    });

    return startingPromise;
  };

  return {
    name: 'sonicmambo-asio-bridge',
    configureServer(server) {
      const rootDir = server.config.root || process.cwd();

      // Auto-launch ASIO bridge immediately when Vite dev server boots
      void ensureBridgeRunning(rootDir);

      // Expose on-demand endpoint so frontend can wake the bridge if needed
      server.middlewares.use('/__sonicmambo/ensure-bridge', async (_req, res) => {
        const alive = await ensureBridgeRunning(rootDir);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: alive }));
      });

      server.httpServer?.once('close', stopChild);
      process.once('exit', stopChild);
    },
  };
}

export default defineConfig({
  plugins: [react(), sonicmamboAsioBridgePlugin()],
});
