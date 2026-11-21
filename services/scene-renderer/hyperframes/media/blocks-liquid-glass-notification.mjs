// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/f9f942c43b465616.svg';
import m1 from '../shared/b7f7d642a318ffe4.svg';
const assets={"assets/hyperframes-logo-dark.svg":m0,"hyperframes-logo-dark.svg":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
