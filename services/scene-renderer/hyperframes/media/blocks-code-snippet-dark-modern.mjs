// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/76ecf30f67182c6e.svg';
import m1 from '../shared/d2af50a2a408149e.svg';
const assets={"assets/background.jpeg":m0,"background.jpeg":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
