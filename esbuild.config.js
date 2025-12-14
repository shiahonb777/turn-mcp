const esbuild = require('esbuild');

// 打包MCP服务器（独立运行，包含所有依赖）
esbuild.build({
  entryPoints: ['src/mcp-server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/mcp-server.js',
  format: 'cjs',
  external: [], // 不排除任何依赖，全部打包
  minify: false,
  sourcemap: true,
}).then(() => {
  console.log('MCP服务器打包完成');
}).catch(() => process.exit(1));

// 打包VSCode扩展（排除vscode模块）
esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  format: 'cjs',
  external: ['vscode'], // VSCode模块由运行时提供
  minify: false,
  sourcemap: true,
}).then(() => {
  console.log('扩展打包完成');
}).catch(() => process.exit(1));
