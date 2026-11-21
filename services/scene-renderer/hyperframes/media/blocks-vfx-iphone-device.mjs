// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/092819fd0e6416de.bin';
import m1 from '../shared/9a7c28a50029ad1f.bin';
import m2 from '../shared/c176efd6ee07145e.svg';
const assets={"models/iphone.glb":m0,"iphone.glb":m0,"models/macbook.glb":m1,"macbook.glb":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
