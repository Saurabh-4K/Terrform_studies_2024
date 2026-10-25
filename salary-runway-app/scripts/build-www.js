// Prepares www/ for the Android app: the same web files, with fonts bundled
// (no Google Fonts request) and the Capacitor bridge script added.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

['i18n.js', 'i18n-mr.js', 'i18n-hi.js', 'core.js', 'demo.js', 'app.js', 'styles.css'].forEach((f) => fs.copyFileSync(path.join(root, f), path.join(out, f)));
fs.copyFileSync(path.join(root, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(out, 'capacitor.js'));

const fonts = [
  ['Bricolage Grotesque', '@fontsource-variable/bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2', '200 800'],
  ['Instrument Sans', '@fontsource-variable/instrument-sans', 'instrument-sans-latin-wght-normal.woff2', '400 700'],
  // Marathi and Hindi.
  ['Noto Sans Devanagari', '@fontsource-variable/noto-sans-devanagari', 'noto-sans-devanagari-devanagari-wght-normal.woff2', '100 900'],
];
const faces = fonts.map(([family, pkg, file, weight]) => {
  fs.copyFileSync(path.join(root, 'node_modules', pkg, 'files', file), path.join(out, 'fonts', file));
  return '@font-face { font-family: \'' + family + '\'; font-style: normal; font-display: swap; font-weight: ' + weight + '; src: url(fonts/' + file + ') format(\'woff2\'); }';
});
fs.writeFileSync(path.join(out, 'fonts.css'), faces.join('\n') + '\n');

// The build number for Profile → About (the CI run number; "dev" when built by hand).
fs.writeFileSync(path.join(out, 'build-info.js'), 'window.HISAB_BUILD = ' + JSON.stringify(process.env.GITHUB_RUN_NUMBER || 'dev') + ';\n');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html
  // The app allows only its own files: no font hosts in its security policy.
  .replace(' https://fonts.googleapis.com;', ';')
  .replace(' https://fonts.gstatic.com;', ';')
  .split('\n')
  .filter((line) => !/fonts\.(googleapis|gstatic)\.com/.test(line))
  .join('\n')
  .replace('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="fonts.css">\n  <link rel="stylesheet" href="styles.css">')
  .replace('<script src="i18n-mr.js"></script>', '<script src="capacitor.js"></script>\n  <script src="build-info.js"></script>\n  <script src="i18n-mr.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('www/ ready');
