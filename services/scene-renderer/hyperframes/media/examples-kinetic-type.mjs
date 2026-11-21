// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/c3938a570ce2f32e.mp4';
import m1 from '../shared/f9dc5b4445e90728.svg';
const assets={"https://static.heygen.ai/astral_assets/uploaded_assets/67cf5a05_e134ec83a57042b38776c952da595870.mp4":m0,"67cf5a05_e134ec83a57042b38776c952da595870.mp4":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
