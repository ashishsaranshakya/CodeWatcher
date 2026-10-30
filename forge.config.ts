import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { join } from 'node:path';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ['migrations'],
    icon: join(__dirname, 'assets', 'CodeMirror'),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'CodeMirror',
      authors: 'CodeMirror',
      setupIcon: join(__dirname, 'assets', 'CodeMirror.ico'),
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
