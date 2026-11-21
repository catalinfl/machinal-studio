// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/dc71dcbd63987298.svg';
import m1 from '../shared/c3938a570ce2f32e.mp4';
import m2 from '../shared/56d4af65701c26df.wav';
import m3 from '../shared/b883346dd1191a48.svg';
const assets={"assets/heygen-logo.svg?t=1":m0,"assets/heygen-logo.svg":m0,"heygen-logo.svg":m0,"assets/heygen-logo.svg?t=2":m0,"assets/av_r1k1.mp4":m1,"av_r1k1.mp4":m1,"assets/av_r1k3.mp4":m1,"av_r1k3.mp4":m1,"assets/av_r1k4.mp4":m1,"av_r1k4.mp4":m1,"assets/av_r2k0.mp4":m1,"av_r2k0.mp4":m1,"assets/av_r2k2.mp4":m1,"av_r2k2.mp4":m1,"assets/bgm.m4a":m2,"bgm.m4a":m2};
export default function asset(path){
if(!path)return m3;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m3;
}
