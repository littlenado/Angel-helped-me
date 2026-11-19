// Builds index-standalone.html: one file with both engines, the firmware and all
// wasm builds embedded, so it works from file:// with no extra files.
// Run from the repo root: node tools/build-standalone.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const b64 = name => read(name).toString('base64');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function inlineScript(html, src, label) {
    const tag = '<script src="' + src + '"></script>';
    if (!html.includes(tag)) throw new Error('script tag not found: ' + src);
    const code = read(src).toString('utf8');
    if (code.includes('</script')) throw new Error(src + ' contains </script>');
    console.log('embedded engine: ' + label + ' (' + code.length + ' bytes)');
    return html.replace(tag, '<script>\n' + code + '\n</script>');
}

html = inlineScript(html, 'libv86-x64.js', 'x86-64');
html = inlineScript(html, 'libv86.js', '32-bit');

// Firmware and engine binaries, base64 in window.EMBEDDED. loadBinary() looks up
// these exact names, so the page behaves the same as it does over HTTP.
const files = [
    'v86.wasm',
    'v86-x64.wasm',
    'v86-x64-fallback.wasm',
    'v86-x64-mem64.wasm',
    'seabios.bin',
    'bios.bin-1.10.0',
    'seabios-debug.bin',
    'vgabios.bin',
];
const embedded = {};
for (const name of files) {
    embedded[name] = b64(name);
    console.log('embedded binary: ' + name + ' (' + Math.round(read(name).length / 1024) + ' KB)');
}
const embeddedTag = '<script>window.EMBEDDED = ' + JSON.stringify(embedded) + ';</script>';

const marker = '    <script>\n        const $ = id => document.getElementById(id);';
if (!html.includes(marker)) throw new Error('main page script marker not found');
html = html.replace(marker, '    ' + embeddedTag + '\n' + marker);

// Tell the reader the binaries are built in rather than fetched.
html = html.replace('<h3>1. System Binaries &amp; Firmware (auto-loaded over HTTP)</h3>',
                    '<h3>1. System Binaries &amp; Firmware (built in; pick files only to override)</h3>');
html = html.replace('<h3>1. System Binaries & Firmware (auto-loaded over HTTP)</h3>',
                    '<h3>1. System Binaries &amp; Firmware (built in; pick files only to override)</h3>');

const out = path.join(root, 'index-standalone.html');
fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + (html.length / 1048576).toFixed(1) + ' MB)');
