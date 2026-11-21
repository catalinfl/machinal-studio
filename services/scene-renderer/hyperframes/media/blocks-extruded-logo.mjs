// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/0413a22e5ea454b0.json';
import m1 from '../shared/ea4b8fff99854f6a.svg';
const assets={"assets/fonts/Geist-Bold.typeface.json":m0,"Geist-Bold.typeface.json":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
