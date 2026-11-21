// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/fd4b79a4e989a29e.svg';
import m1 from '../shared/8dee578d30be3bcb.svg';
import m2 from '../shared/5cc2cc3b167d1117.svg';
import m3 from '../shared/f81f49e19f046ba9.svg';
import m4 from '../shared/bde73c72c270fbfb.svg';
import m5 from '../shared/5e07557b854f6f9f.svg';
import m6 from '../shared/18abbfda89dbd043.svg';
import m7 from '../shared/9208590eb1ad7ea1.svg';
import m8 from '../shared/8a58de9e008a5188.svg';
import m9 from '../shared/cdd30ed922934529.svg';
import m10 from '../shared/781bec7c516243af.svg';
import m11 from '../shared/d3c15baeec388c31.svg';
import m12 from '../shared/a8cefff74111d045.svg';
import m13 from '../shared/2a39955b0c5ffd3a.svg';
import m14 from '../shared/4080752938190790.svg';
import m15 from '../shared/e2e526b991bafc45.svg';
import m16 from '../shared/85a7db73c903f9f2.svg';
import m17 from '../shared/05e6e68985b075a6.svg';
import m18 from '../shared/3de16c57e0d9a50b.svg';
import m19 from '../shared/080e15f317a3fbeb.svg';
import m20 from '../shared/6d9163ed5f3044ed.svg';
import m21 from '../shared/df8045b85ec3af7c.svg';
import m22 from '../shared/01d15308e51e662a.svg';
import m23 from '../shared/532b51c7b4a167b7.svg';
import m24 from '../shared/334d1caeb21ff0ff.svg';
import m25 from '../shared/092819fd0e6416de.bin';
import m26 from '../shared/b7e3c76c0e2ecbbd.svg';
const assets={"assets/icons/notify-messages.jpg":m0,"notify-messages.jpg":m0,"assets/icons/weather.jpg":m1,"weather.jpg":m1,"assets/icons/stocks.jpg":m2,"stocks.jpg":m2,"assets/icons/find-my.jpg":m3,"find-my.jpg":m3,"assets/icons/home.jpg":m4,"home.jpg":m4,"assets/icons/books.jpg":m5,"books.jpg":m5,"assets/icons/itunes-store.jpg":m6,"itunes-store.jpg":m6,"assets/icons/fitness.jpg":m7,"fitness.jpg":m7,"assets/icons/watch.jpg":m8,"watch.jpg":m8,"assets/icons/contacts.jpg":m9,"contacts.jpg":m9,"assets/icons/files.jpg":m10,"files.jpg":m10,"assets/icons/translate.jpg":m11,"translate.jpg":m11,"assets/icons/calendar.jpg":m12,"calendar.jpg":m12,"assets/icons/photos.jpg":m13,"photos.jpg":m13,"assets/icons/chatgpt.jpg":m14,"chatgpt.jpg":m14,"assets/icons/slack.jpg":m15,"slack.jpg":m15,"assets/icons/instagram.jpg":m16,"instagram.jpg":m16,"assets/icons/x.jpg":m17,"x.jpg":m17,"assets/icons/proton-mail.jpg":m18,"proton-mail.jpg":m18,"assets/icons/gmail.jpg":m19,"gmail.jpg":m19,"assets/icons/revolut.jpg":m20,"revolut.jpg":m20,"assets/icons/phone.jpg":m21,"phone.jpg":m21,"assets/icons/brave.jpg":m22,"brave.jpg":m22,"assets/icons/whatsapp.jpg":m23,"whatsapp.jpg":m23,"assets/icons/music.jpg":m24,"music.jpg":m24,"models/iphone.glb":m25,"iphone.glb":m25};
export default function asset(path){
if(!path)return m26;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m26;
}
