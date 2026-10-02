import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.js'], outfile: 'dist/game.js', bundle: true, format: 'iife', target: 'es2017', minify: true, legalComments: 'eof' });
await copyFile('index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/styles.css');
await copyFile('node_modules/three/LICENSE', 'dist/THREE-LICENSE.txt');
console.log('Built offline game in dist/');
