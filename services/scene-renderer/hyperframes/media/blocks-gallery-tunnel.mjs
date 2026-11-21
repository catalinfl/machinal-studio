// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/f6ac22ec98bdadc8.svg';
import m1 from '../shared/b9da71621f6b5ac2.svg';
const assets={"assets/shot-1.png,assets/shot-2.png":m0,"shot-2.png":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
