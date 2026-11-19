// Applies v86runner's local patches to the portlandhodl/v86_64 engine build.
// Run from the repo root: node tools/patch-x64-engine.js
// (1) CPU execution cap (cpu_cap) on the run loop.
// (2) File-backed async disks keep written sectors in 16 KB chunks (cx/dirty),
//     expose get_as_file, and leave disk contents out of get_state.
// (3) Both IDE channels are always present, even with no drives attached, so the
//     PCI IDE controller is always visible to the guest. A disk in hard-disk B
//     without A is no longer ignored.
// (4) IDENTIFY reports an ATA major version and a valid multiple-sector count,
//     which Windows' pciide/atapi drivers expect.
const fs = require('fs');
const path = require('path');

const src = process.argv[2] || path.join(__dirname, '..', 'libv86-x64.js');
let s = fs.readFileSync(src, 'utf8');

function must(oldText, newText, label) {
    const n = s.split(oldText).length - 1;
    if (n !== 1) throw new Error(label + ': expected 1 match, found ' + n);
    s = s.replace(oldText, newText);
    console.log('patched: ' + label);
}

// (1) Execution cap: yield long enough that the guest gets `cpu_cap` of the time.
must(
    'F.prototype.do_tick=function(){if(this.stopping||!this.running)this.stopping=this.running=!1,this.bus.send("emulator-stopped");else{this.idle=!1;var a=this.cpu.main_loop();this.next_tick(a)}};',
    'F.prototype.do_tick=function(){if(this.stopping||!this.running)this.stopping=this.running=!1,this.bus.send("emulator-stopped");else{this.idle=!1;var t=F.microtick();var a=this.cpu.main_loop();var cp=this.cpu_cap;if(cp&&1>cp){var d=(F.microtick()-t)*(1/cp-1);d>a&&(a=d)}this.next_tick(a)}};',
    'cpu_cap in do_tick');

// (2) 16 KB written-sector chunks for File-backed async disks.
must(
    'function za(a){this.file=a;this.byteLength=a.size;this.block_cache=new Map;this.block_cache_is_write=new Set;this.onprogress=this.onload=void 0}',
    'function za(a){this.file=a;this.byteLength=a.size;this.cx=new Map;this.dirty=new Set;this.block_cache=new Map;this.block_cache_is_write=new Set;this.onprogress=this.onload=void 0}',
    'za constructor (cx/dirty)');

const start = 'za.prototype.get_from_cache=wa.prototype.get_from_cache;';
const endMarker = 'za.prototype.get_as_file=function(a){for(var b=[],c=Array.from(this.block_cache.keys()).sort(function(h,m){return h-m}),d=0,e=0;e<c.length;e++){var f=c[e],g=this.block_cache.get(f);f*=256;f!==d&&(b.push(this.file.slice(d,f)),d=f);b.push(g);d+=g.length}d!==this.file.size&&b.push(this.file.slice(d));return new File(b,a)};';
const startAt = s.indexOf(start);
const endAt = s.indexOf(endMarker);
if (startAt < 0 || endAt < 0 || endAt < startAt) throw new Error('za disk class block not found');
const replacement = [
    'za.prototype.get_from_cache=function(a,b){const n=Math.ceil(b/512),s=a>>9;for(let i=0;i<n;i++){const c=this.cx.get((s+i)>>5);if(!c||!c.m[(s+i)&31])return}const o=new Uint8Array(b);for(let i=0;i<n;i++){const k=s+i,c=this.cx.get(k>>5),p=(k&31)<<9,sub=c.d.subarray(p,p+512);o.set(sub.length>b-(i<<9)?sub.subarray(0,b-(i<<9)):sub,i<<9)}return o};',
    'za.prototype.get_and_cache=function(a,b,c,d){this.get(a,b,c,d)};',
    'za.prototype.set=function(a,b,cb){const n=Math.ceil(b.length/512),s=a>>9;for(let i=0;i<n;i++){const k=s+i,ci=k>>5;let c=this.cx.get(ci);if(!c){c={d:new Uint8Array(16384),m:new Uint8Array(32)};this.cx.set(ci,c)}c.d.set(b.subarray(i<<9,(i+1)<<9),(k&31)<<9);c.m[k&31]=1;this.dirty.add(ci)}cb()};',
    'za.prototype.handle_read=function(a,b,e){const n=Math.ceil(b/512),s=a>>9;for(let i=0;i<n;i++){const k=s+i,c=this.cx.get(k>>5);if(c&&c.m[k&31]){const p=(k&31)<<9,sub=c.d.subarray(p,p+512);e.set(sub.length>e.length-(i<<9)?sub.subarray(0,e.length-(i<<9)):sub,i<<9)}}};',
    'za.prototype.get_state=function(){return[[]]};za.prototype.set_state=function(){};',
    'za.prototype.get_buffer=function(a){a()};',
    'za.prototype.get_as_file=function(a){const b=[],ks=Array.from(this.cx.keys()).sort((x,y)=>x-y);let pos=0;for(const k of ks){const c=this.cx.get(k),base=k*16384;let i=0;while(i<32){if(!c.m[i]){i++;continue}let j=i;while(j<32&&c.m[j])j++;const off=base+i*512;off!==pos&&b.push(this.file.slice(pos,off));b.push(c.d.slice(i*512,j*512));pos=base+j*512;i=j}}pos!==this.file.size&&b.push(this.file.slice(pos));return new File(b,a)};'
].join('');
s = s.slice(0, startAt) + replacement + s.slice(endAt + endMarker.length);
console.log('patched: za disk chunk tracking + get_state + get_as_file');

// (3a) A hard disk in B is honoured even when A is empty.
must(
    'a.hda&&(c[0][0]={buffer:a.hda},c[0][1]={buffer:a.hdb})',
    '(a.hda||a.hdb)&&(c[0][0]={buffer:a.hda},c[0][1]={buffer:a.hdb})',
    'hdb without hda');

// (3b) Always create both IDE channels (and therefore the PCI IDE controller),
// whether or not drives are attached. This is what lets Windows Setup see the
// controller instead of reporting that it found no drives.
must(
    'function ld(a,b,c){this.cpu=a;this.bus=b;this.secondary=this.primary=void 0;b=c&&c[0][0];const d=c&&c[1][0];if(b||d){b&&(this.primary=new md(this,0,c[0],496,1014,14));d&&(this.secondary=new md(this,1,c[1],368,886,15));c=b?this.primary.command_base:0;const e=b?this.primary.control_base:0,f=d?this.secondary.command_base:0,g=d?this.secondary.control_base:0;this.name="ide";',
    'function ld(a,b,c){this.cpu=a;this.bus=b;this.secondary=this.primary=void 0;this.primary=new md(this,0,c&&c[0],496,1014,14);this.secondary=new md(this,1,c&&c[1],368,886,15);c=this.primary.command_base;const e=this.primary.control_base,f=this.secondary.command_base,g=this.secondary.control_base;this.name="ide";',
    'always-present IDE channels');
must(
    'this.pci_bars=[b?{size:8}:void 0,b?{size:1}:void 0,d?{size:8}:void 0,d?{size:1}:void 0,{size:16}];a.devices.pci.register_device(this)}Object.seal(this)}',
    'this.pci_bars=[{size:8},{size:1},{size:8},{size:1},{size:16}];a.devices.pci.register_device(this);Object.seal(this)}',
    'IDE PCI BARs');
must(
    'ld.prototype.set_state=function(a){this.primary&&this.primary.set_state(a[0]);this.secondary&&this.secondary.set_state(a[1])};',
    'ld.prototype.set_state=function(a){this.primary&&a[0]&&this.primary.set_state(a[0]);this.secondary&&a[1]&&this.secondary.set_state(a[1])};',
    'IDE set_state guard');

// (4) IDENTIFY: claim ATA-4..8 (QEMU does the same) and a valid multiple-sector
// count. Without a major version some Windows storage drivers ignore the drive.
must(
    'this.data_end=this.data_length=512};',
    'this.data16[47]|=32768;this.data16[59]=128;this.data16[80]=496;this.data_end=this.data_length=512};',
    'IDENTIFY major version / multiple sectors');

// A visible marker so the page/report can tell the engine build apart.
must(
    'F.prototype.do_tick=function(){',
    '/* v86runner x64 engine: local patches (cpu_cap, 16 KB disk chunks, get_state without disk data, always-present IDE, IDENTIFY fixes) */F.prototype.do_tick=function(){',
    'patch marker');

fs.writeFileSync(src, s);
console.log('wrote ' + src + ' (' + s.length + ' bytes)');
