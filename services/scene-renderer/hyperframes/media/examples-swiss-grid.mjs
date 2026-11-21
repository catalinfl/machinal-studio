// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/710b2ff8208d15a7.svg';
import m1 from '../shared/c3938a570ce2f32e.mp4';
import m2 from '../shared/c4a68c5a0c7da3f0.svg';
const assets={"assets/swiss-grid.svg":m0,"swiss-grid.svg":m0,"__VIDEO_SRC__":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
