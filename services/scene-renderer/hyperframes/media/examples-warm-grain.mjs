// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/c3938a570ce2f32e.mp4';
import m1 from '../shared/7a4f8366f0e67776.svg';
import m2 from '../shared/fcfe59299a5f0120.svg';
const assets={"__VIDEO_SRC__":m0,"https://www.transparenttextures.com/patterns/natural-paper.png":m1,"natural-paper.png":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
