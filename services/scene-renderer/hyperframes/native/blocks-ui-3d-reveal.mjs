// Native adapter of upstream blocks-ui-3d-reveal, Apache-2.0; third-party notices remain in hyperframes-library.
import { gsap } from 'gsap';
import { loadHyperframeFonts, hyperframeFontSource } from '@machinal/hyperframes/assets';
import __hfFonts from '@machinal/hyperframes/fonts/blocks-ui-3d-reveal';
import __hfAsset from '@machinal/hyperframes/media/blocks-ui-3d-reveal';
export async function initializeNative(__hfTimelineSlot, __hfRootElement, __hfHost, __hfScene) {
const __hfRegistry = new Proxy({}, { get: () => __hfTimelineSlot.get() });
const __hfListen = (type, listener, options = {}) => window.addEventListener(type, listener, {...options, signal:__hfScene.resources.signal});
await loadHyperframeFonts(__hfFonts);

        (function () {
          var S = '[data-composition-id="ui-3d-reveal"]';
          var tl = gsap.timeline({ paused: true });

          var wrapper = document.querySelector(S + " .card-wrapper");
          var scene = document.querySelector(S + " .scene");
          var cardGlow = document.querySelector(S + " .card-glow");

          // ── Calculate intro stroke lengths ──
          document.querySelectorAll(S + " .il-stroke").forEach(function (el) {
            var len =
              el.tagName === "circle"
                ? 2 * Math.PI * parseFloat(el.getAttribute("r"))
                : el.getTotalLength();
            el.style.strokeDasharray = len;
            el.style.strokeDashoffset = len;
          });

          // ── Calculate outro stroke lengths ──
          document.querySelectorAll(S + " .ol-stroke").forEach(function (el) {
            var len =
              el.tagName === "circle"
                ? 2 * Math.PI * parseFloat(el.getAttribute("r"))
                : el.getTotalLength();
            el.style.strokeDasharray = len;
            el.style.strokeDashoffset = len;
          });

          // ─────────────────────────────────────────────────────
          // INITIAL STATE
          // ─────────────────────────────────────────────────────
          gsap.set(wrapper, { opacity: 0, scale: 0.74, rotationY: 0, y: 24 });
          gsap.set(
            [
              S + " .fig-toolbar",
              S + " .fig-layers",
              S + " .fig-props",
              S + " .fig-canvas",
              S + " .layer-item",
              S + " .selection-ring",
            ],
            { opacity: 0 },
          );
          gsap.set(S + " .fig-toolbar", { y: -10 });
          gsap.set(S + " .fig-layers", { x: -16 });
          gsap.set(S + " .fig-props", { x: 16 });
          gsap.set(S + " .layer-item", { x: -8 });
          gsap.set(S + " .artboard", { scale: 0.94, opacity: 0 });

          // ═════════════════════════════════════════════════════
          // PHASE 0 — LOGO INTRO  (0 – 1.35s)
          // Stroke draw cascade → color fill flash → scale to 0
          // ═════════════════════════════════════════════════════

          tl.to(
            S + " .il-stroke-1",
            { strokeDashoffset: 0, duration: 0.4, ease: "power1.inOut" },
            0.0,
          );
          tl.to(
            S + " .il-stroke-2",
            { strokeDashoffset: 0, duration: 0.4, ease: "power1.inOut" },
            0.06,
          );
          tl.to(
            S + " .il-stroke-3",
            { strokeDashoffset: 0, duration: 0.4, ease: "power1.inOut" },
            0.12,
          );
          tl.to(
            S + " .il-stroke-4",
            { strokeDashoffset: 0, duration: 0.4, ease: "power1.inOut" },
            0.18,
          );
          tl.to(
            S + " .il-stroke-5",
            { strokeDashoffset: 0, duration: 0.4, ease: "power1.inOut" },
            0.24,
          );

          tl.to(S + " .il-fill-1", { opacity: 1, duration: 0.08 }, 0.5);
          tl.to(S + " .il-fill-2", { opacity: 1, duration: 0.08 }, 0.54);
          tl.to(S + " .il-fill-3", { opacity: 1, duration: 0.08 }, 0.58);
          tl.to(S + " .il-fill-4", { opacity: 1, duration: 0.08 }, 0.62);
          tl.to(S + " .il-fill-5", { opacity: 1, duration: 0.08 }, 0.66);
          tl.to(S + " .il-stroke", { opacity: 0.3, duration: 0.15 }, 0.6);

          // Scale the logo down to nothing
          tl.to(S + " .il-stroke", { opacity: 0, duration: 0.2 }, 1.0);
          tl.to(
            S + " .intro-logo",
            {
              scale: 0,
              transformOrigin: "95px 142.5px",
              duration: 0.35,
              ease: "power2.in",
            },
            1.0,
          );

          // ═════════════════════════════════════════════════════
          // PHASE 1 — FLAT REVEAL  (1.5 – 3.4s)
          // ═════════════════════════════════════════════════════
          var T = 1.5;

          tl.to(
            wrapper,
            {
              opacity: 1,
              scale: 0.79,
              y: 0,
              duration: 0.55,
              ease: "expo.out",
            },
            T + 0.0,
          );

          tl.to(
            cardGlow,
            {
              opacity: 0.5,
              duration: 0.8,
              ease: "power2.out",
            },
            T + 0.05,
          );

          tl.to(
            S + " .fig-toolbar",
            {
              opacity: 1,
              y: 0,
              duration: 0.4,
              ease: "power2.out",
            },
            T + 0.23,
          );

          tl.to(
            S + " .fig-layers",
            {
              opacity: 1,
              x: 0,
              duration: 0.45,
              ease: "expo.out",
            },
            T + 0.35,
          );

          tl.to(
            S + " .fig-props",
            {
              opacity: 1,
              x: 0,
              duration: 0.45,
              ease: "expo.out",
            },
            T + 0.37,
          );

          tl.to(
            S + " .fig-canvas",
            {
              opacity: 1,
              duration: 0.4,
              ease: "power2.out",
            },
            T + 0.45,
          );

          tl.to(
            S + " .artboard",
            {
              opacity: 1,
              scale: 1,
              duration: 0.55,
              ease: "back.out(1.4)",
            },
            T + 0.5,
          );

          tl.to(
            S + " .layer-item",
            {
              opacity: 1,
              x: 0,
              duration: 0.35,
              stagger: { each: 0.045, ease: "power1.in" },
              ease: "power2.out",
            },
            T + 0.57,
          );

          tl.to(
            S + " .selection-ring",
            {
              opacity: 1,
              duration: 0.25,
              ease: "power2.out",
            },
            T + 1.25,
          );

          // ═════════════════════════════════════════════════════
          // PHASE 2 — CAMERA PUSH  (3.5 – 4.8s)
          // Bigger zoom: 0.79 → 1.15 so the UI fills the frame
          // ═════════════════════════════════════════════════════

          tl.to(
            wrapper,
            {
              scale: 1.15,
              duration: 1.3,
              ease: "power3.inOut",
            },
            3.5,
          );

          tl.to(
            cardGlow,
            {
              opacity: 0.85,
              scale: 1.25,
              duration: 1.2,
              ease: "power2.inOut",
            },
            3.5,
          );

          // ═════════════════════════════════════════════════════
          // PHASE 3 — 3D TILT  (4.2 – 5.55s)
          // Steeper angle (-34°) for more dramatic depth reveal
          // ═════════════════════════════════════════════════════

          tl.to(
            wrapper,
            {
              rotationY: -34,
              duration: 1.35,
              ease: "expo.out",
            },
            4.2,
          );

          tl.to(
            wrapper,
            {
              y: -16,
              duration: 1.1,
              ease: "power2.out",
            },
            4.3,
          );

          // ═════════════════════════════════════════════════════
          // PHASE 4 — 3D HOLD  (5.55 – 7.3s)
          // ═════════════════════════════════════════════════════

          tl.to(
            wrapper,
            {
              y: -8,
              rotationY: -31,
              duration: 0.9,
              ease: "sine.inOut",
            },
            5.55,
          );

          tl.to(
            wrapper,
            {
              y: -20,
              rotationY: -35,
              duration: 0.9,
              ease: "sine.inOut",
            },
            6.45,
          );

          tl.to(
            cardGlow,
            {
              opacity: 0.7,
              duration: 0.9,
              ease: "sine.inOut",
              yoyo: true,
              repeat: 1,
            },
            5.55,
          );

          // ═════════════════════════════════════════════════════
          // SLIDE OFF — 3D depth fly-away  (7.3 – 7.85s)
          // Scene x exits left. Wrapper z shrinks into distance.
          // Deeper z (-4000) + steeper rotation (-55°) = very
          // dramatic 3D exit — card turns away and vanishes.
          // ═════════════════════════════════════════════════════

          tl.to(
            scene,
            {
              x: -2200,
              duration: 0.55,
              ease: "power4.in",
            },
            7.3,
          );

          tl.to(
            wrapper,
            {
              z: -7500,
              rotationY: -65,
              duration: 0.55,
              ease: "power4.in",
            },
            7.3,
          );

          tl.to(
            cardGlow,
            {
              opacity: 0,
              duration: 0.3,
              ease: "power3.in",
            },
            7.3,
          );

          // ═════════════════════════════════════════════════════
          // OUTRO — LOGO BUILD + TAGLINE + PILL  (7.9 – 13s)
          // ═════════════════════════════════════════════════════
          var O = 7.9;

          tl.set(S + " .outro-layer", { opacity: 1 }, O);

          // Stroke draw cascade
          tl.to(
            S + " .ol-stroke-1",
            { strokeDashoffset: 0, duration: 0.8, ease: "power1.inOut" },
            O + 0.0,
          );
          tl.to(
            S + " .ol-stroke-2",
            { strokeDashoffset: 0, duration: 0.8, ease: "power1.inOut" },
            O + 0.15,
          );
          tl.to(
            S + " .ol-stroke-3",
            { strokeDashoffset: 0, duration: 0.8, ease: "power1.inOut" },
            O + 0.3,
          );
          tl.to(
            S + " .ol-stroke-4",
            { strokeDashoffset: 0, duration: 0.8, ease: "power1.inOut" },
            O + 0.45,
          );
          tl.to(
            S + " .ol-stroke-5",
            { strokeDashoffset: 0, duration: 0.8, ease: "power1.inOut" },
            O + 0.6,
          );

          // Color fill cascade
          tl.to(S + " .ol-fill-1", { opacity: 1, duration: 0.15, ease: "power1.out" }, O + 1.4);
          tl.to(S + " .ol-fill-2", { opacity: 1, duration: 0.15, ease: "power1.out" }, O + 1.55);
          tl.to(S + " .ol-fill-3", { opacity: 1, duration: 0.15, ease: "power1.out" }, O + 1.7);
          tl.to(S + " .ol-fill-4", { opacity: 1, duration: 0.15, ease: "power1.out" }, O + 1.85);
          tl.to(S + " .ol-fill-5", { opacity: 1, duration: 0.15, ease: "power1.out" }, O + 2.0);
          tl.to(S + " .ol-stroke", { opacity: 0.3, duration: 0.4, ease: "none" }, O + 1.8);

          // Subtle scale settle
          tl.fromTo(
            S + " .outro-logo",
            { scale: 1, transformOrigin: "80px 120px" },
            { scale: 1.04, duration: 0.2, ease: "power2.out" },
            O + 2.3,
          );
          tl.to(
            S + " .outro-logo",
            {
              scale: 1,
              transformOrigin: "80px 120px",
              duration: 0.2,
              ease: "power2.inOut",
            },
            O + 2.5,
          );

          // Tagline letter stagger
          var letters = document.querySelectorAll(S + " .otl");
          for (var k = 0; k < letters.length; k++) {
            tl.fromTo(
              letters[k],
              { opacity: 0, y: 8 },
              { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" },
              O + 2.8 + k * 0.025,
            );
          }

          // URL pill: stroke draw → fill → text
          tl.to(
            S + " .url-border",
            {
              strokeDashoffset: 0,
              duration: 0.35,
              ease: "power1.inOut",
            },
            O + 3.8,
          );
          tl.to(S + " .url-bg", { opacity: 1, duration: 0.15 }, O + 4.15);
          tl.to(S + " .url-text", { opacity: 1, duration: 0.2 }, O + 4.2);

          // Fade to black
          tl.to(
            S + " .outro-fade",
            {
              opacity: 1,
              duration: 0.6,
              ease: "none",
            },
            O + 4.8,
          );

          
          __hfTimelineSlot.set(tl);
        })();
      
__hfRootElement.querySelectorAll("img").forEach(image => { image.src = __hfAsset(image.getAttribute("src")); });
}
