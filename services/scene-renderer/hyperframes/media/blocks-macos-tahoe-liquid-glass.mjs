// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/98f63c5ac56ea536.svg';
import m1 from '../shared/4ecf637b926f6b8f.svg';
import m2 from '../shared/e45f192b462b9298.svg';
import m3 from '../shared/781bec7c516243af.svg';
import m4 from '../shared/21791fbde6f73e05.svg';
import m5 from '../shared/521500ad51b867fb.svg';
import m6 from '../shared/2a39955b0c5ffd3a.svg';
import m7 from '../shared/334d1caeb21ff0ff.svg';
import m8 from '../shared/ccfde4dd50ca5049.svg';
import m9 from '../shared/67d802f2223dff46.svg';
import m10 from '../shared/d9c9f8cafca1c788.svg';
import m11 from '../shared/a8cefff74111d045.svg';
import m12 from '../shared/e6ea6493cc29aba6.svg';
import m13 from '../shared/014723efe776c5c5.svg';
import m14 from '../shared/4b9dc511fc85bbb4.svg';
import m15 from '../shared/01d15308e51e662a.svg';
import m16 from '../shared/e2e526b991bafc45.svg';
import m17 from '../shared/9a7c28a50029ad1f.bin';
import m18 from '../shared/faacb41ad3ca9084.svg';
const assets={"assets/wallpapers/golden-gate-bridge-san-francisco-5k-0g.jpg":m0,"golden-gate-bridge-san-francisco-5k-0g.jpg":m0,"assets/icons/toast-messages.jpg":m1,"toast-messages.jpg":m1,"assets/icons/finder.png":m2,"finder.png":m2,"assets/icons/files.jpg":m3,"files.jpg":m3,"assets/icons/safari.jpg":m4,"safari.jpg":m4,"assets/icons/mail.jpg":m5,"mail.jpg":m5,"assets/icons/photos.jpg":m6,"photos.jpg":m6,"assets/icons/music.jpg":m7,"music.jpg":m7,"assets/icons/dock-finder.png":m8,"dock-finder.png":m8,"assets/icons/dock-safari.jpg":m9,"dock-safari.jpg":m9,"assets/icons/dock-mail.jpg":m10,"dock-mail.jpg":m10,"assets/icons/calendar.jpg":m11,"calendar.jpg":m11,"assets/icons/dock-photos.jpg":m12,"dock-photos.jpg":m12,"assets/icons/messages.jpg":m13,"messages.jpg":m13,"assets/icons/dock-music.jpg":m14,"dock-music.jpg":m14,"assets/icons/brave.jpg":m15,"brave.jpg":m15,"assets/icons/slack.jpg":m16,"slack.jpg":m16,"models/macbook.glb":m17,"macbook.glb":m17};
export default function asset(path){
if(!path)return m18;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m18;
}
