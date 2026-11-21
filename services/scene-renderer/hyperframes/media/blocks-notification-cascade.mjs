// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/9d446ea514842654.svg';
import m1 from '../shared/f9f942c43b465616.svg';
import m2 from '../shared/772bd4627a5d73f0.svg';
const assets={"assets/desk-backdrop.jpg":m0,"desk-backdrop.jpg":m0,"assets/hyperframes-logo-white.svg":m1,"hyperframes-logo-white.svg":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
