// Builds FYNZA into the dist/ folder (static website). Run: npm install && npm run build
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

const serve = process.argv.includes('--serve');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
writeFileSync('dist/index.html', readFileSync('index.html', 'utf8'));

const opts = {
  entryPoints: { app: 'src/main.jsx' },
  bundle: true,
  outdir: 'dist',
  minify: !serve,
  sourcemap: serve,
  loader: { '.jsx': 'jsx', '.js': 'jsx' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': serve ? '"development"' : '"production"' },
  logLevel: 'info',
};
if (serve) {
  const ctx = await context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
  console.log('Open http://localhost:' + port);
} else {
  await build(opts);
}
