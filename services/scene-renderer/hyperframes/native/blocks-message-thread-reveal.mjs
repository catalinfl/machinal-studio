// Native adapter of upstream blocks-message-thread-reveal, Apache-2.0; third-party notices remain in hyperframes-library.
import { gsap } from 'gsap';
import __hfAsset from '@machinal/hyperframes/media/blocks-message-thread-reveal';
export async function initializeNative(__hfTimelineSlot, __hfRootElement, __hfHost, __hfScene) {
const __hfRegistry = new Proxy({}, { get: () => __hfTimelineSlot.get() });
const __hfListen = (type, listener, options = {}) => window.addEventListener(type, listener, {...options, signal:__hfScene.resources.signal});

      
      (function () {
        "use strict";
        var vars =
          __hfHost && typeof __hfHost.getVariables === "function"
            ? __hfHost.getVariables()
            : {};
        function text(value, fallback, max) {
          if (typeof value !== "string") return fallback;
          var t = value.trim();
          if (!t) return fallback;
          return t.length > max ? t.slice(0, max) : t;
        }
        var contact = text(vars.contactName, "Rachel", 16);
        document.getElementById("mtr-hdr-avatar").textContent = contact.charAt(0).toUpperCase();
        var namePill = document.getElementById("mtr-hdr-name");
        namePill.innerHTML = "";
        namePill.appendChild(document.createTextNode(contact));
        var chev = document.createElement("span");
        chev.className = "chev";
        chev.textContent = "\u203A";
        namePill.appendChild(chev);
        function setText(id, value) {
          document.getElementById(id).textContent = value;
        }
        function setTyped(group, value) {
          var frames = Array.from(document.querySelectorAll('[id^="mtr-ty-' + group + '-"]')).sort(
            function (a, b) {
              return Number(a.id.split("-").pop()) - Number(b.id.split("-").pop());
            },
          );
          var characters = Array.from(value);
          frames.forEach(function (frame, index) {
            var prefixLength = Math.max(
              1,
              Math.ceil((characters.length * (index + 1)) / frames.length),
            );
            var textNode = Array.from(frame.childNodes).find(function (node) {
              return node.nodeType === 3;
            });
            if (textNode) textNode.nodeValue = characters.slice(0, prefixLength).join("");
          });
        }
        function setTwoLines(id, value) {
          var lines = value.split("|").slice(0, 2);
          var container = document.getElementById(id);
          Array.from(container.children).forEach(function (line, index) {
            line.textContent = lines[index] || lines[0] || "";
          });
        }
        var teaserMessage = text(vars.teaserMessage, "wait look 👀", 20);
        var benefitMessage = text(vars.benefitMessage, "renders in 4K. no editor", 32);
        var sourceMessage = text(vars.sourceMessage, "on heygen", 20);
        var workflowMessage = text(vars.workflowMessage, "u just write plain html tags", 34);
        var ownershipMessage = text(vars.ownershipMessage, "the code is yours forever", 32);
        setText(
          "mtr-message-question",
          text(vars.questionMessage, "what r u using for the launch video??", 46),
        );
        setText("mtr-message-teaser", teaserMessage);
        setText("mtr-message-reaction", text(vars.reactionMessage, "OMG IT'S HTML", 24));
        setText("mtr-message-emoji", text(vars.reactionEmoji, "🤯🤯🤯", 12));
        setText("mtr-message-benefit", benefitMessage);
        setText("mtr-message-discovery", text(vars.discoveryMessage, "where did u find this", 28));
        setText("mtr-message-source", sourceMessage);
        setText("mtr-message-workflow", workflowMessage);
        setText("mtr-message-ownership", ownershipMessage);
        setText("mtr-message-install", text(vars.installMessage, "installing rn", 20));
        setText("mtr-message-thanks", text(vars.thanksMessage, "ty bestie 💚", 20));
        setTyped(1, teaserMessage);
        setTyped(2, benefitMessage);
        setTyped(3, sourceMessage);
        setTyped(4, workflowMessage);
        setTyped(5, ownershipMessage);
        document.querySelector(".cardtitle").textContent = text(
          vars.cardTitle,
          "HyperFrames | Write HTML, render pixel-perfect video",
          80,
        );
        document.querySelector(".carddomain").textContent = text(
          vars.cardDomain,
          "hyperframes.heygen.com",
          40,
        );
        document.getElementById("mtr-ec-fam").textContent = text(
          vars.ecProof,
          "12,000+ creators",
          30,
        );
        setTwoLines("mtr-ec-feature-1", text(vars.ecFeature1, "Write|plain HTML", 32));
        setTwoLines("mtr-ec-feature-2", text(vars.ecFeature2, "Render|pixel-perfect", 32));
        setTwoLines("mtr-ec-feature-3", text(vars.ecFeature3, "Own|every line", 32));
        document.getElementById("mtr-ec-cta").textContent = text(
          vars.ecCta,
          "Start rendering free",
          26,
        );
      })();
      // initial states applied immediately (CSS hides all .item; m1 must be live at frame 0)
      gsap.set("#mtr-it-m1", { autoAlpha: 1 });
      const tl = gsap.timeline({ paused: true });
      gsap.set("#mtr-it-m1", { y: 1264 });
      tl.fromTo(
        "#mtr-it-m1 .pop",
        { scale: 0.75, autoAlpha: 0.6 },
        { scale: 1, autoAlpha: 1, duration: 0.12, ease: "power2.out" },
        0.0,
      );
      tl.set("#mtr-it-m1", { autoAlpha: 1 }, 0.0);
      tl.set("#mtr-it-m1", { y: 1179 }, 0.7662);
      tl.set("#mtr-it-dots", { y: 1278 }, 0.7662);
      tl.fromTo(
        "#mtr-it-dots .pop",
        { scale: 0.6, autoAlpha: 0.4 },
        { scale: 1, autoAlpha: 1, duration: 0.1, ease: "power2.out" },
        0.7662,
      );
      tl.set("#mtr-it-dots", { autoAlpha: 1 }, 0.7662);
      tl.set("#mtr-it-m1", { y: 1036 }, 2.9662);
      tl.set("#mtr-it-dots", { y: 1135 }, 2.9662);
      tl.set("#mtr-it-m2", { y: 1218 }, 2.9662);
      tl.fromTo(
        "#mtr-it-m2 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        2.9662,
      );
      tl.set("#mtr-it-m2", { autoAlpha: 1 }, 2.9662);
      tl.set("#mtr-it-m1", { y: 416 }, 3.6995);
      tl.set("#mtr-it-dots", { y: 515 }, 3.6995);
      tl.set("#mtr-it-m2", { y: 598 }, 3.6995);
      tl.set("#mtr-it-m3", { y: 735 }, 3.6995);
      tl.fromTo(
        "#mtr-it-m3 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        3.6995,
      );
      tl.set("#mtr-it-m3", { autoAlpha: 1 }, 3.6995);
      tl.set("#mtr-it-dots", { autoAlpha: 0 }, 7.2995);
      tl.set("#mtr-it-m1", { y: 400 }, 7.2995);
      tl.set("#mtr-it-m2", { y: 499 }, 7.2995);
      tl.set("#mtr-it-m3", { y: 636 }, 7.2995);
      tl.set("#mtr-it-m4", { y: 1264 }, 7.2995);
      tl.fromTo(
        "#mtr-it-m4 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        7.2995,
      );
      tl.set("#mtr-it-m4", { autoAlpha: 1 }, 7.2995);
      tl.set("#mtr-it-m1", { y: 250 }, 8.0328);
      tl.set("#mtr-it-m2", { y: 349 }, 8.0328);
      tl.set("#mtr-it-m3", { y: 486 }, 8.0328);
      tl.set("#mtr-it-m4", { y: 1114 }, 8.0328);
      tl.set("#mtr-it-m5", { y: 1205 }, 8.0328);
      tl.fromTo(
        "#mtr-it-m5 .pop",
        { scale: 0.5, autoAlpha: 0.3 },
        { scale: 1, autoAlpha: 1, duration: 0.1, ease: "power2.out" },
        8.0328,
      );
      tl.set("#mtr-it-m5", { autoAlpha: 1 }, 8.0328);
      tl.set("#mtr-it-m1", { y: 113 }, 10.5995);
      tl.set("#mtr-it-m2", { y: 212 }, 10.5995);
      tl.set("#mtr-it-m3", { y: 349 }, 10.5995);
      tl.set("#mtr-it-m4", { y: 977 }, 10.5995);
      tl.set("#mtr-it-m5", { y: 1068 }, 10.5995);
      tl.set("#mtr-it-m6", { y: 1218 }, 10.5995);
      tl.fromTo(
        "#mtr-it-m6 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        10.5995,
      );
      tl.set("#mtr-it-m6", { autoAlpha: 1 }, 10.5995);
      tl.set("#mtr-it-m1", { y: 28 }, 11.3662);
      tl.set("#mtr-it-m2", { y: 127 }, 11.3662);
      tl.set("#mtr-it-m3", { y: 264 }, 11.3662);
      tl.set("#mtr-it-m4", { y: 892 }, 11.3662);
      tl.set("#mtr-it-m5", { y: 983 }, 11.3662);
      tl.set("#mtr-it-m6", { y: 1133 }, 11.3662);
      tl.set("#mtr-it-dots2", { y: 1278 }, 11.3662);
      tl.fromTo(
        "#mtr-it-dots2 .pop",
        { scale: 0.6, autoAlpha: 0.4 },
        { scale: 1, autoAlpha: 1, duration: 0.1, ease: "power2.out" },
        11.3662,
      );
      tl.set("#mtr-it-dots2", { autoAlpha: 1 }, 11.3662);
      tl.set("#mtr-it-dots2", { autoAlpha: 0 }, 12.3662);
      tl.set("#mtr-it-m1", { y: 14 }, 12.3662);
      tl.set("#mtr-it-m2", { y: 113 }, 12.3662);
      tl.set("#mtr-it-m3", { y: 250 }, 12.3662);
      tl.set("#mtr-it-m4", { y: 878 }, 12.3662);
      tl.set("#mtr-it-m5", { y: 969 }, 12.3662);
      tl.set("#mtr-it-m6", { y: 1119 }, 12.3662);
      tl.set("#mtr-it-m7", { y: 1264 }, 12.3662);
      tl.fromTo(
        "#mtr-it-m7 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        12.3662,
      );
      tl.set("#mtr-it-m7", { autoAlpha: 1 }, 12.3662);
      tl.set("#mtr-it-m1", { y: -85 }, 14.0662);
      tl.set("#mtr-it-m2", { y: 14 }, 14.0662);
      tl.set("#mtr-it-m3", { y: 151 }, 14.0662);
      tl.set("#mtr-it-m4", { y: 779 }, 14.0662);
      tl.set("#mtr-it-m5", { y: 870 }, 14.0662);
      tl.set("#mtr-it-m6", { y: 1020 }, 14.0662);
      tl.set("#mtr-it-m7", { y: 1165 }, 14.0662);
      tl.set("#mtr-it-m8", { y: 1264 }, 14.0662);
      tl.fromTo(
        "#mtr-it-m8 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        14.0662,
      );
      tl.set("#mtr-it-m8", { autoAlpha: 1 }, 14.0662);
      tl.set("#mtr-it-m1", { y: -176 }, 17.0995);
      tl.set("#mtr-it-m2", { y: -77 }, 17.0995);
      tl.set("#mtr-it-m3", { y: 60 }, 17.0995);
      tl.set("#mtr-it-m4", { y: 688 }, 17.0995);
      tl.set("#mtr-it-m5", { y: 779 }, 17.0995);
      tl.set("#mtr-it-m6", { y: 929 }, 17.0995);
      tl.set("#mtr-it-m7", { y: 1074 }, 17.0995);
      tl.set("#mtr-it-m8", { y: 1173 }, 17.0995);
      tl.set("#mtr-it-m9", { y: 1264 }, 17.0995);
      tl.fromTo(
        "#mtr-it-m9 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        17.0995,
      );
      tl.set("#mtr-it-m9", { autoAlpha: 1 }, 17.0995);
      tl.set("#mtr-it-m1", { y: -313 }, 19.8995);
      tl.set("#mtr-it-m2", { y: -214 }, 19.8995);
      tl.set("#mtr-it-m3", { y: -77 }, 19.8995);
      tl.set("#mtr-it-m4", { y: 551 }, 19.8995);
      tl.set("#mtr-it-m5", { y: 642 }, 19.8995);
      tl.set("#mtr-it-m6", { y: 792 }, 19.8995);
      tl.set("#mtr-it-m7", { y: 937 }, 19.8995);
      tl.set("#mtr-it-m8", { y: 1036 }, 19.8995);
      tl.set("#mtr-it-m9", { y: 1127 }, 19.8995);
      tl.set("#mtr-it-m10", { y: 1218 }, 19.8995);
      tl.fromTo(
        "#mtr-it-m10 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        19.8995,
      );
      tl.set("#mtr-it-m10", { autoAlpha: 1 }, 19.8995);
      tl.set("#mtr-it-m1", { y: -412 }, 20.6662);
      tl.set("#mtr-it-m2", { y: -313 }, 20.6662);
      tl.set("#mtr-it-m3", { y: -176 }, 20.6662);
      tl.set("#mtr-it-m4", { y: 452 }, 20.6662);
      tl.set("#mtr-it-m5", { y: 543 }, 20.6662);
      tl.set("#mtr-it-m6", { y: 693 }, 20.6662);
      tl.set("#mtr-it-m7", { y: 838 }, 20.6662);
      tl.set("#mtr-it-m8", { y: 937 }, 20.6662);
      tl.set("#mtr-it-m9", { y: 1028 }, 20.6662);
      tl.set("#mtr-it-m10", { y: 1119 }, 20.6662);
      tl.set("#mtr-it-m11", { y: 1264 }, 20.6662);
      tl.fromTo(
        "#mtr-it-m11 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        20.6662,
      );
      tl.set("#mtr-it-m11", { autoAlpha: 1 }, 20.6662);
      tl.set("#mtr-it-m1", { y: -503 }, 21.4328);
      tl.set("#mtr-it-m2", { y: -404 }, 21.4328);
      tl.set("#mtr-it-m3", { y: -267 }, 21.4328);
      tl.set("#mtr-it-m4", { y: 361 }, 21.4328);
      tl.set("#mtr-it-m5", { y: 452 }, 21.4328);
      tl.set("#mtr-it-m6", { y: 602 }, 21.4328);
      tl.set("#mtr-it-m7", { y: 747 }, 21.4328);
      tl.set("#mtr-it-m8", { y: 846 }, 21.4328);
      tl.set("#mtr-it-m9", { y: 937 }, 21.4328);
      tl.set("#mtr-it-m10", { y: 1028 }, 21.4328);
      tl.set("#mtr-it-m11", { y: 1173 }, 21.4328);
      tl.set("#mtr-it-m12", { y: 1264 }, 21.4328);
      tl.fromTo(
        "#mtr-it-m12 .pop",
        { autoAlpha: 0.55 },
        { autoAlpha: 1, duration: 0.0667, ease: "none" },
        21.4328,
      );
      tl.set("#mtr-it-m12", { autoAlpha: 1 }, 21.4328);
      tl.set("#mtr-ph", { autoAlpha: 0 }, 2.0328);
      tl.set("#mtr-mic", { autoAlpha: 0 }, 2.0328);
      tl.set("#mtr-sendbtn", { autoAlpha: 1 }, 2.0328);
      tl.set("#mtr-ph", { autoAlpha: 1 }, 2.9662);
      tl.set("#mtr-mic", { autoAlpha: 1 }, 2.9662);
      tl.set("#mtr-sendbtn", { autoAlpha: 0 }, 2.9662);
      tl.set("#mtr-ty-1-0", { autoAlpha: 1 }, 2.0328);
      tl.set("#mtr-ty-1-0", { autoAlpha: 0 }, 2.0995);
      tl.set("#mtr-ty-1-1", { autoAlpha: 1 }, 2.0995);
      tl.set("#mtr-ty-1-1", { autoAlpha: 0 }, 2.1662);
      tl.set("#mtr-ty-1-2", { autoAlpha: 1 }, 2.1662);
      tl.set("#mtr-ty-1-2", { autoAlpha: 0 }, 2.2328);
      tl.set("#mtr-ty-1-3", { autoAlpha: 1 }, 2.2328);
      tl.set("#mtr-ty-1-3", { autoAlpha: 0 }, 2.2995);
      tl.set("#mtr-ty-1-4", { autoAlpha: 1 }, 2.2995);
      tl.set("#mtr-ty-1-4", { autoAlpha: 0 }, 2.3995);
      tl.set("#mtr-ty-1-5", { autoAlpha: 1 }, 2.3995);
      tl.set("#mtr-ty-1-5", { autoAlpha: 0 }, 2.4328);
      tl.set("#mtr-ty-1-6", { autoAlpha: 1 }, 2.4328);
      tl.set("#mtr-ty-1-6", { autoAlpha: 0 }, 2.4995);
      tl.set("#mtr-ty-1-7", { autoAlpha: 1 }, 2.4995);
      tl.set("#mtr-ty-1-7", { autoAlpha: 0 }, 2.5662);
      tl.set("#mtr-ty-1-8", { autoAlpha: 1 }, 2.5662);
      tl.set("#mtr-ty-1-8", { autoAlpha: 0 }, 2.5995);
      tl.set("#mtr-ty-1-9", { autoAlpha: 1 }, 2.5995);
      tl.set("#mtr-ty-1-9", { autoAlpha: 0 }, 2.7995);
      tl.set("#mtr-ty-1-10", { autoAlpha: 1 }, 2.7995);
      tl.set("#mtr-ty-1-10", { autoAlpha: 0 }, 2.9662);
      tl.set("#mtr-ph", { autoAlpha: 0 }, 8.8662);
      tl.set("#mtr-mic", { autoAlpha: 0 }, 8.8662);
      tl.set("#mtr-sendbtn", { autoAlpha: 1 }, 8.8662);
      tl.set("#mtr-ph", { autoAlpha: 1 }, 10.5995);
      tl.set("#mtr-mic", { autoAlpha: 1 }, 10.5995);
      tl.set("#mtr-sendbtn", { autoAlpha: 0 }, 10.5995);
      tl.set("#mtr-ty-2-0", { autoAlpha: 1 }, 8.8662);
      tl.set("#mtr-ty-2-0", { autoAlpha: 0 }, 8.9662);
      tl.set("#mtr-ty-2-1", { autoAlpha: 1 }, 8.9662);
      tl.set("#mtr-ty-2-1", { autoAlpha: 0 }, 8.9995);
      tl.set("#mtr-ty-2-2", { autoAlpha: 1 }, 8.9995);
      tl.set("#mtr-ty-2-2", { autoAlpha: 0 }, 9.0662);
      tl.set("#mtr-ty-2-3", { autoAlpha: 1 }, 9.0662);
      tl.set("#mtr-ty-2-3", { autoAlpha: 0 }, 9.1662);
      tl.set("#mtr-ty-2-4", { autoAlpha: 1 }, 9.1662);
      tl.set("#mtr-ty-2-4", { autoAlpha: 0 }, 9.2328);
      tl.set("#mtr-ty-2-5", { autoAlpha: 1 }, 9.2328);
      tl.set("#mtr-ty-2-5", { autoAlpha: 0 }, 9.2662);
      tl.set("#mtr-ty-2-6", { autoAlpha: 1 }, 9.2662);
      tl.set("#mtr-ty-2-6", { autoAlpha: 0 }, 9.3662);
      tl.set("#mtr-ty-2-7", { autoAlpha: 1 }, 9.3662);
      tl.set("#mtr-ty-2-7", { autoAlpha: 0 }, 9.3995);
      tl.set("#mtr-ty-2-8", { autoAlpha: 1 }, 9.3995);
      tl.set("#mtr-ty-2-8", { autoAlpha: 0 }, 9.4328);
      tl.set("#mtr-ty-2-9", { autoAlpha: 1 }, 9.4328);
      tl.set("#mtr-ty-2-9", { autoAlpha: 0 }, 9.5662);
      tl.set("#mtr-ty-2-10", { autoAlpha: 1 }, 9.5662);
      tl.set("#mtr-ty-2-10", { autoAlpha: 0 }, 9.5995);
      tl.set("#mtr-ty-2-11", { autoAlpha: 1 }, 9.5995);
      tl.set("#mtr-ty-2-11", { autoAlpha: 0 }, 9.6662);
      tl.set("#mtr-ty-2-12", { autoAlpha: 1 }, 9.6662);
      tl.set("#mtr-ty-2-12", { autoAlpha: 0 }, 9.7995);
      tl.set("#mtr-ty-2-13", { autoAlpha: 1 }, 9.7995);
      tl.set("#mtr-ty-2-13", { autoAlpha: 0 }, 9.8662);
      tl.set("#mtr-ty-2-14", { autoAlpha: 1 }, 9.8662);
      tl.set("#mtr-ty-2-14", { autoAlpha: 0 }, 9.8995);
      tl.set("#mtr-ty-2-15", { autoAlpha: 1 }, 9.8995);
      tl.set("#mtr-ty-2-15", { autoAlpha: 0 }, 9.9662);
      tl.set("#mtr-ty-2-16", { autoAlpha: 1 }, 9.9662);
      tl.set("#mtr-ty-2-16", { autoAlpha: 0 }, 9.9995);
      tl.set("#mtr-ty-2-17", { autoAlpha: 1 }, 9.9995);
      tl.set("#mtr-ty-2-17", { autoAlpha: 0 }, 10.0662);
      tl.set("#mtr-ty-2-18", { autoAlpha: 1 }, 10.0662);
      tl.set("#mtr-ty-2-18", { autoAlpha: 0 }, 10.1662);
      tl.set("#mtr-ty-2-19", { autoAlpha: 1 }, 10.1662);
      tl.set("#mtr-ty-2-19", { autoAlpha: 0 }, 10.2328);
      tl.set("#mtr-ty-2-20", { autoAlpha: 1 }, 10.2328);
      tl.set("#mtr-ty-2-20", { autoAlpha: 0 }, 10.2995);
      tl.set("#mtr-ty-2-21", { autoAlpha: 1 }, 10.2995);
      tl.set("#mtr-ty-2-21", { autoAlpha: 0 }, 10.3995);
      tl.set("#mtr-ty-2-22", { autoAlpha: 1 }, 10.3995);
      tl.set("#mtr-ty-2-22", { autoAlpha: 0 }, 10.4662);
      tl.set("#mtr-ty-2-23", { autoAlpha: 1 }, 10.4662);
      tl.set("#mtr-ty-2-23", { autoAlpha: 0 }, 10.5995);
      tl.set("#mtr-ph", { autoAlpha: 0 }, 13.3995);
      tl.set("#mtr-mic", { autoAlpha: 0 }, 13.3995);
      tl.set("#mtr-sendbtn", { autoAlpha: 1 }, 13.3995);
      tl.set("#mtr-ph", { autoAlpha: 1 }, 14.0662);
      tl.set("#mtr-mic", { autoAlpha: 1 }, 14.0662);
      tl.set("#mtr-sendbtn", { autoAlpha: 0 }, 14.0662);
      tl.set("#mtr-ty-3-0", { autoAlpha: 1 }, 13.3995);
      tl.set("#mtr-ty-3-0", { autoAlpha: 0 }, 13.4328);
      tl.set("#mtr-ty-3-1", { autoAlpha: 1 }, 13.4328);
      tl.set("#mtr-ty-3-1", { autoAlpha: 0 }, 13.4995);
      tl.set("#mtr-ty-3-2", { autoAlpha: 1 }, 13.4995);
      tl.set("#mtr-ty-3-2", { autoAlpha: 0 }, 13.5995);
      tl.set("#mtr-ty-3-3", { autoAlpha: 1 }, 13.5995);
      tl.set("#mtr-ty-3-3", { autoAlpha: 0 }, 13.6662);
      tl.set("#mtr-ty-3-4", { autoAlpha: 1 }, 13.6662);
      tl.set("#mtr-ty-3-4", { autoAlpha: 0 }, 13.6995);
      tl.set("#mtr-ty-3-5", { autoAlpha: 1 }, 13.6995);
      tl.set("#mtr-ty-3-5", { autoAlpha: 0 }, 13.7995);
      tl.set("#mtr-ty-3-6", { autoAlpha: 1 }, 13.7995);
      tl.set("#mtr-ty-3-6", { autoAlpha: 0 }, 13.9662);
      tl.set("#mtr-ty-3-7", { autoAlpha: 1 }, 13.9662);
      tl.set("#mtr-ty-3-7", { autoAlpha: 0 }, 14.0328);
      tl.set("#mtr-ty-3-8", { autoAlpha: 1 }, 14.0328);
      tl.set("#mtr-ty-3-8", { autoAlpha: 0 }, 14.0662);
      tl.set("#mtr-ph", { autoAlpha: 0 }, 15.1662);
      tl.set("#mtr-mic", { autoAlpha: 0 }, 15.1662);
      tl.set("#mtr-sendbtn", { autoAlpha: 1 }, 15.1662);
      tl.set("#mtr-ph", { autoAlpha: 1 }, 17.0995);
      tl.set("#mtr-mic", { autoAlpha: 1 }, 17.0995);
      tl.set("#mtr-sendbtn", { autoAlpha: 0 }, 17.0995);
      tl.set("#mtr-ty-4-0", { autoAlpha: 1 }, 15.1662);
      tl.set("#mtr-ty-4-0", { autoAlpha: 0 }, 15.1995);
      tl.set("#mtr-ty-4-1", { autoAlpha: 1 }, 15.1995);
      tl.set("#mtr-ty-4-1", { autoAlpha: 0 }, 15.2328);
      tl.set("#mtr-ty-4-2", { autoAlpha: 1 }, 15.2328);
      tl.set("#mtr-ty-4-2", { autoAlpha: 0 }, 15.2995);
      tl.set("#mtr-ty-4-3", { autoAlpha: 1 }, 15.2995);
      tl.set("#mtr-ty-4-3", { autoAlpha: 0 }, 15.3995);
      tl.set("#mtr-ty-4-4", { autoAlpha: 1 }, 15.3995);
      tl.set("#mtr-ty-4-4", { autoAlpha: 0 }, 15.4328);
      tl.set("#mtr-ty-4-5", { autoAlpha: 1 }, 15.4328);
      tl.set("#mtr-ty-4-5", { autoAlpha: 0 }, 15.4995);
      tl.set("#mtr-ty-4-6", { autoAlpha: 1 }, 15.4995);
      tl.set("#mtr-ty-4-6", { autoAlpha: 0 }, 15.5662);
      tl.set("#mtr-ty-4-7", { autoAlpha: 1 }, 15.5662);
      tl.set("#mtr-ty-4-7", { autoAlpha: 0 }, 15.6328);
      tl.set("#mtr-ty-4-8", { autoAlpha: 1 }, 15.6328);
      tl.set("#mtr-ty-4-8", { autoAlpha: 0 }, 15.6662);
      tl.set("#mtr-ty-4-9", { autoAlpha: 1 }, 15.6662);
      tl.set("#mtr-ty-4-9", { autoAlpha: 0 }, 15.6995);
      tl.set("#mtr-ty-4-10", { autoAlpha: 1 }, 15.6995);
      tl.set("#mtr-ty-4-10", { autoAlpha: 0 }, 15.7995);
      tl.set("#mtr-ty-4-11", { autoAlpha: 1 }, 15.7995);
      tl.set("#mtr-ty-4-11", { autoAlpha: 0 }, 15.8662);
      tl.set("#mtr-ty-4-12", { autoAlpha: 1 }, 15.8662);
      tl.set("#mtr-ty-4-12", { autoAlpha: 0 }, 15.8995);
      tl.set("#mtr-ty-4-13", { autoAlpha: 1 }, 15.8995);
      tl.set("#mtr-ty-4-13", { autoAlpha: 0 }, 16.0662);
      tl.set("#mtr-ty-4-14", { autoAlpha: 1 }, 16.0662);
      tl.set("#mtr-ty-4-14", { autoAlpha: 0 }, 16.0995);
      tl.set("#mtr-ty-4-15", { autoAlpha: 1 }, 16.0995);
      tl.set("#mtr-ty-4-15", { autoAlpha: 0 }, 16.2328);
      tl.set("#mtr-ty-4-16", { autoAlpha: 1 }, 16.2328);
      tl.set("#mtr-ty-4-16", { autoAlpha: 0 }, 16.2662);
      tl.set("#mtr-ty-4-17", { autoAlpha: 1 }, 16.2662);
      tl.set("#mtr-ty-4-17", { autoAlpha: 0 }, 16.2995);
      tl.set("#mtr-ty-4-18", { autoAlpha: 1 }, 16.2995);
      tl.set("#mtr-ty-4-18", { autoAlpha: 0 }, 16.3995);
      tl.set("#mtr-ty-4-19", { autoAlpha: 1 }, 16.3995);
      tl.set("#mtr-ty-4-19", { autoAlpha: 0 }, 16.4662);
      tl.set("#mtr-ty-4-20", { autoAlpha: 1 }, 16.4662);
      tl.set("#mtr-ty-4-20", { autoAlpha: 0 }, 16.4995);
      tl.set("#mtr-ty-4-21", { autoAlpha: 1 }, 16.4995);
      tl.set("#mtr-ty-4-21", { autoAlpha: 0 }, 16.5662);
      tl.set("#mtr-ty-4-22", { autoAlpha: 1 }, 16.5662);
      tl.set("#mtr-ty-4-22", { autoAlpha: 0 }, 16.6328);
      tl.set("#mtr-ty-4-23", { autoAlpha: 1 }, 16.6328);
      tl.set("#mtr-ty-4-23", { autoAlpha: 0 }, 16.6995);
      tl.set("#mtr-ty-4-24", { autoAlpha: 1 }, 16.6995);
      tl.set("#mtr-ty-4-24", { autoAlpha: 0 }, 16.7995);
      tl.set("#mtr-ty-4-25", { autoAlpha: 1 }, 16.7995);
      tl.set("#mtr-ty-4-25", { autoAlpha: 0 }, 16.8328);
      tl.set("#mtr-ty-4-26", { autoAlpha: 1 }, 16.8328);
      tl.set("#mtr-ty-4-26", { autoAlpha: 0 }, 16.8995);
      tl.set("#mtr-ty-4-27", { autoAlpha: 1 }, 16.8995);
      tl.set("#mtr-ty-4-27", { autoAlpha: 0 }, 17.0995);
      tl.set("#mtr-ph", { autoAlpha: 0 }, 18.1662);
      tl.set("#mtr-mic", { autoAlpha: 0 }, 18.1662);
      tl.set("#mtr-sendbtn", { autoAlpha: 1 }, 18.1662);
      tl.set("#mtr-ph", { autoAlpha: 1 }, 19.8995);
      tl.set("#mtr-mic", { autoAlpha: 1 }, 19.8995);
      tl.set("#mtr-sendbtn", { autoAlpha: 0 }, 19.8995);
      tl.set("#mtr-ty-5-0", { autoAlpha: 1 }, 18.1662);
      tl.set("#mtr-ty-5-0", { autoAlpha: 0 }, 18.2328);
      tl.set("#mtr-ty-5-1", { autoAlpha: 1 }, 18.2328);
      tl.set("#mtr-ty-5-1", { autoAlpha: 0 }, 18.2662);
      tl.set("#mtr-ty-5-2", { autoAlpha: 1 }, 18.2662);
      tl.set("#mtr-ty-5-2", { autoAlpha: 0 }, 18.3662);
      tl.set("#mtr-ty-5-3", { autoAlpha: 1 }, 18.3662);
      tl.set("#mtr-ty-5-3", { autoAlpha: 0 }, 18.4328);
      tl.set("#mtr-ty-5-4", { autoAlpha: 1 }, 18.4328);
      tl.set("#mtr-ty-5-4", { autoAlpha: 0 }, 18.4995);
      tl.set("#mtr-ty-5-5", { autoAlpha: 1 }, 18.4995);
      tl.set("#mtr-ty-5-5", { autoAlpha: 0 }, 18.5995);
      tl.set("#mtr-ty-5-6", { autoAlpha: 1 }, 18.5995);
      tl.set("#mtr-ty-5-6", { autoAlpha: 0 }, 18.6662);
      tl.set("#mtr-ty-5-7", { autoAlpha: 1 }, 18.6662);
      tl.set("#mtr-ty-5-7", { autoAlpha: 0 }, 18.7328);
      tl.set("#mtr-ty-5-8", { autoAlpha: 1 }, 18.7328);
      tl.set("#mtr-ty-5-8", { autoAlpha: 0 }, 18.7995);
      tl.set("#mtr-ty-5-9", { autoAlpha: 1 }, 18.7995);
      tl.set("#mtr-ty-5-9", { autoAlpha: 0 }, 18.8328);
      tl.set("#mtr-ty-5-10", { autoAlpha: 1 }, 18.8328);
      tl.set("#mtr-ty-5-10", { autoAlpha: 0 }, 18.9995);
      tl.set("#mtr-ty-5-11", { autoAlpha: 1 }, 18.9995);
      tl.set("#mtr-ty-5-11", { autoAlpha: 0 }, 19.0328);
      tl.set("#mtr-ty-5-12", { autoAlpha: 1 }, 19.0328);
      tl.set("#mtr-ty-5-12", { autoAlpha: 0 }, 19.0995);
      tl.set("#mtr-ty-5-13", { autoAlpha: 1 }, 19.0995);
      tl.set("#mtr-ty-5-13", { autoAlpha: 0 }, 19.1662);
      tl.set("#mtr-ty-5-14", { autoAlpha: 1 }, 19.1662);
      tl.set("#mtr-ty-5-14", { autoAlpha: 0 }, 19.1995);
      tl.set("#mtr-ty-5-15", { autoAlpha: 1 }, 19.1995);
      tl.set("#mtr-ty-5-15", { autoAlpha: 0 }, 19.2662);
      tl.set("#mtr-ty-5-16", { autoAlpha: 1 }, 19.2662);
      tl.set("#mtr-ty-5-16", { autoAlpha: 0 }, 19.3662);
      tl.set("#mtr-ty-5-17", { autoAlpha: 1 }, 19.3662);
      tl.set("#mtr-ty-5-17", { autoAlpha: 0 }, 19.4328);
      tl.set("#mtr-ty-5-18", { autoAlpha: 1 }, 19.4328);
      tl.set("#mtr-ty-5-18", { autoAlpha: 0 }, 19.4995);
      tl.set("#mtr-ty-5-19", { autoAlpha: 1 }, 19.4995);
      tl.set("#mtr-ty-5-19", { autoAlpha: 0 }, 19.5328);
      tl.set("#mtr-ty-5-20", { autoAlpha: 1 }, 19.5328);
      tl.set("#mtr-ty-5-20", { autoAlpha: 0 }, 19.5995);
      tl.set("#mtr-ty-5-21", { autoAlpha: 1 }, 19.5995);
      tl.set("#mtr-ty-5-21", { autoAlpha: 0 }, 19.6662);
      tl.set("#mtr-ty-5-22", { autoAlpha: 1 }, 19.6662);
      tl.set("#mtr-ty-5-22", { autoAlpha: 0 }, 19.7662);
      tl.set("#mtr-ty-5-23", { autoAlpha: 1 }, 19.7662);
      tl.set("#mtr-ty-5-23", { autoAlpha: 0 }, 19.7995);
      tl.set("#mtr-ty-5-24", { autoAlpha: 1 }, 19.7995);
      tl.set("#mtr-ty-5-24", { autoAlpha: 0 }, 19.8995);
      tl.set("#mtr-ec-wrap", { autoAlpha: 0 }, 23.257);
      tl.fromTo(
        "#mtr-ec-wrap",
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.3, ease: "none" },
        23.2667,
      );
      __hfTimelineSlot.set(tl);
    
__hfRootElement.querySelectorAll("img").forEach(image => { image.src = __hfAsset(image.getAttribute("src")); });
}
