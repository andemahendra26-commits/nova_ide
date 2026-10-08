/**
 * Copies Monaco and xterm out of node_modules into src/renderer/vendor so that
 * renderer asset paths are identical in development and inside the packaged asar,
 * and node_modules can be excluded from the build entirely.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'src', 'renderer', 'vendor');

function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip && skip(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function mod(...p) {
  return path.join(root, 'node_modules', ...p);
}

function run() {
  fs.rmSync(vendor, { recursive: true, force: true });

  // Monaco: the AMD "min" build only. Drop source maps, they are a third of the weight.
  copyDir(mod('monaco-editor', 'min', 'vs'), path.join(vendor, 'vs'), (n) => n.endsWith('.map'));

  // xterm core + addons
  copyFile(mod('@xterm', 'xterm', 'lib', 'xterm.js'), path.join(vendor, 'xterm', 'xterm.js'));
  copyFile(mod('@xterm', 'xterm', 'css', 'xterm.css'), path.join(vendor, 'xterm', 'xterm.css'));
  copyFile(
    mod('@xterm', 'addon-fit', 'lib', 'addon-fit.js'),
    path.join(vendor, 'xterm', 'addon-fit.js')
  );
  copyFile(
    mod('@xterm', 'addon-web-links', 'lib', 'addon-web-links.js'),
    path.join(vendor, 'xterm', 'addon-web-links.js')
  );

  let bytes = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else bytes += fs.statSync(p).size;
    }
  })(vendor);

  console.log(`vendor: ${(bytes / 1024 / 1024).toFixed(1)} MB -> src/renderer/vendor`);
}

run();
