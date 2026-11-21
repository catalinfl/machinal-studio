// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/34391f3497738d29.svg';
import m1 from '../shared/17160477a475166a.svg';
import m2 from '../shared/7c075d05919218c0.svg';
const assets={"assets/img/heygen-mark.svg":m0,"heygen-mark.svg":m0,"assets/img/slack-mark.svg":m1,"slack-mark.svg":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
