// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/73894e0448cae90a.ttf';
import m1 from '../shared/0b63e3c2527db714.svg';
const assets={"assets/fonts/Geist-Bold.ttf":m0,"Geist-Bold.ttf":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
