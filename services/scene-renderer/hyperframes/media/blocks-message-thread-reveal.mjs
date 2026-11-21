// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/d4b44c9fffae5fd7.svg';
import m1 from '../shared/dc156e7c21b47474.svg';
import m2 from '../shared/26ae138fe9df6828.svg';
const assets={"assets/card-image.jpg":m0,"card-image.jpg":m0,"assets/hyperframes-logo-black.svg":m1,"hyperframes-logo-black.svg":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
