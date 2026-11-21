// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/9b06c4ac1cad51ac.svg';
import m1 from '../shared/8e1ec67b9ab513aa.svg';
import m2 from '../shared/b367ff50cd0278f1.svg';
const assets={"assets/leaf-surface-color.webp":m0,"leaf-surface-color.webp":m0,"assets/leaf-surface-normal.webp":m1,"leaf-surface-normal.webp":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
