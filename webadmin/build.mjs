import { build } from 'esbuild';

await build({
    entryPoints: ['web/plugin.jsx'],
    outfile: 'web/plugin.js',
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    external: ['@oie/web-api', '@oie/web-ui', '@oie/web-shell'],
});
console.log('built web/plugin.js');
