import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { syncReference } from '../scripts/sync-reference.mjs';
import { EDITING_STYLES } from '../src/setup-options.mjs';
import { planSkills, SKILL_FILES } from '../src/skills.mjs';
import { workspace } from './helpers.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('hosted compatibility and local runtime references stay synchronized without mixing deployment rules', async () => {
  const files = await syncReference({ check: true });
  assert.ok(files.length >= 21);
  assert.ok(files.every((file) => SKILL_FILES.includes(file)));
  assert.equal(new Set(SKILL_FILES).size, SKILL_FILES.length);
});

test('every client receives the collaborative brief and matching skill entry points', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
      const brief = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-editing', 'references', 'brief.md')))?.content;
      assert.ok(brief, 'The offline brief must be included in the installer manifest');
      for (const content of ['3–5 short', 'output resolution', 'wait for the user', 'Do not re-ask answered questions', 'you decide', '1–2 relevant alternatives', 'Do not automatically add production labels', 'not media-access or spending authorization']) {
        assert.ok(brief.includes(content), `Installed brief is missing ${content}`);
      }
      for (const skill of ['machinal-editing', 'machinal-scenes', 'machinal-recipes']) {
        const entry = bundle.plans.find((plan) => plan.file.endsWith(join(skill, 'SKILL.md'))).content;
        assert.match(entry, /get_editing_reference\(topic: brief\)/);
        assert.match(entry, /wait for the user's reply/);
        assert.match(entry, /output resolution/);
        assert.match(entry, /Do not automatically add production labels/);
      }
      const example = bundle.plans.find((plan) => plan.file.endsWith('narrated-documentary.yaml')).content;
      assert.match(example, /text: Copilăria la Ipotești/);
      assert.doesNotMatch(example, /Ilustrație artistică AI|Narațiune sintetică/);
      const timing = bundle.plans.find((plan) => plan.file.endsWith('narration-timing.yaml')).content;
      assert.match(timing, /type: speech\.generate/);
      assert.match(timing, /type: captions\.generate/);
      assert.doesNotMatch(timing, /type: (?:image\.generate|scene\.(?:generate|edit))/);
      assert.match(example, /resultAssetId: example-voice/);
      assert.match(example, /resultTextIds:/);
      assert.match(example, /synthetic test fixtures/);
      for (const skill of ['machinal-editing', 'machinal-scenes', 'machinal-recipes']) {
        const entry = bundle.plans.find((plan) => plan.file.endsWith(join(skill, 'SKILL.md'))).content;
        for (const content of ['timing-first', 'get_job_result', 'sourceJobId', 'unrequested TTS/captions', 'narration-timing']) {
          assert.ok(entry.includes(content), `${client}/${skill} is missing timing checkpoint: ${content}`);
        }
      }
    });
  }
});

test('every client receives the supported TikTok caption font without overriding existing captions', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
      const files = [
        join('machinal-editing', 'SKILL.md'),
        join('machinal-recipes', 'SKILL.md'),
        join('machinal-editing', 'references', 'brief.md'),
        join('machinal-editing', 'references', 'styles.md'),
        join('machinal-recipes', 'references', 'text-audio.md'),
      ];
      for (const file of files) {
        const plan = bundle.plans.find((plan) => plan.file.endsWith(file));
        assert.ok(plan, `${client}: missing ${file}`);
        for (const guidance of ['TikTok', 'NEW captions', 'fontFamily: montserrat', 'fontWeight: 700', 'unless the user explicitly chooses another font', 'existing caption fonts/configuration', 'font change', 'TikTok Sans']) {
          assert.ok(plan.content.includes(guidance), `${client}/${file} lacks ${guidance}`);
        }
      }
      const audio = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-recipes', 'references', 'text-audio.md'))).content;
      assert.match(audio, /fontFamily: montserrat\n      fontWeight: 700/);
      assert.match(audio, /captions\.generate\.style/);
      assert.match(audio, /generic portrait\/social brief does not imply TikTok/);
      assert.match(audio, /does not authorize adding unrequested captions/);
    });
  }
});

test('every client receives current narration choices and bounded scene repairs', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
      const content = (path) => bundle.plans.find((plan) => plan.file.endsWith(join(...path))).content;
      const editing = content(['machinal-editing', 'SKILL.md']);
      const brief = content(['machinal-editing', 'references', 'brief.md']);
      const audio = content(['machinal-recipes', 'references', 'text-audio.md']);
      for (const source of [editing, brief, audio]) {
        for (const guidance of ['list_speech_models', 'get_speech_model', 'google/gemini-3.8-flash-tts', 'Gemini 3.8 Flash-Lite', 'hexgrad/kokoro-82m', 'English', 'ask the user']) {
          assert.ok(source.includes(guidance), `${client} lacks speech selection: ${guidance}`);
        }
      }
      assert.ok(editing.includes('two targeted repairs'));
      assert.ok(editing.includes('never rewrite its path/token'));
      assert.match(content(['machinal-recipes', 'references', 'examples', 'narration-timing.yaml']), /model: google\/gemini-3\.8-flash-tts\n/);
    });
  }
});

test('every client keeps successful narration overruns and extends visuals instead of regenerating speech', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
      const files = [
        ...['machinal-editing', 'machinal-scenes', 'machinal-recipes'].map((skill) => join(skill, 'SKILL.md')),
        join('machinal-editing', 'references', 'brief.md'),
        join('machinal-editing', 'references', 'workflow.md'),
        join('machinal-scenes', 'references', 'workflow.md'),
        join('machinal-scenes', 'references', 'authoring.md'),
        join('machinal-recipes', 'references', 'jobs-scenes.md'),
        join('machinal-recipes', 'references', 'text-audio.md'),
      ];
      for (const file of files) {
        const plan = bundle.plans.find((plan) => plan.file.endsWith(file));
        assert.ok(plan, `${client}: missing ${file}`);
        const content = plan.content.toLowerCase();
        for (const guidance of ['30-second', '38–40 seconds', 'extend the video', 'do not regenerate, truncate or speed up', 'hard duration cap', 'without reconfirmation', 'spending limit']) {
          assert.ok(content.includes(guidance), `${client}/${file} lacks ${guidance}`);
        }
      }
      const scenes = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-scenes', 'references', 'workflow.md'))).content;
      for (const guidance of ['Recompile a scene', 'pinned asset duration', 'at most 60 seconds', 'transition overlaps', 'without a blank tail or audio cutoff', 'caption words/timings unchanged']) {
        assert.ok(scenes.includes(guidance), `${client}: scene extension lacks ${guidance}`);
      }
    });
  }
});

test('every client receives image-scene integration, expressive effects and concrete spatial direction', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'cinematic' });
      const content = (...parts) => {
        const plan = bundle.plans.find((plan) => plan.file.endsWith(join(...parts)));
        assert.ok(plan, `Missing installed reference: ${parts.join('/')}`);
        return plan.content;
      };

      const brief = content('machinal-editing', 'references', 'brief.md');
      for (const guidance of ['image sourcing', 'visual presentation', 'ask once', 'Three.js', 'Doar montaj foto', 'additional rendering cost', 'standalone request', 'no-generation', 'visual intensity']) {
        assert.ok(brief.includes(guidance), `Brief lacks ${guidance}`);
      }
      assert.doesNotMatch(brief, /already requested animation, an image or no generation/);

      for (const skill of ['machinal-editing', 'machinal-scenes', 'machinal-recipes']) {
        const entry = content(skill, 'SKILL.md');
        for (const guidance of ['ask once', 'Three.js', 'still-only', 'standalone image searches', 'effect score', 'signature visual action']) {
          assert.ok(entry.includes(guidance), `${skill} lacks ${guidance}`);
        }
      }

      const effects = content('machinal-editing', 'references', 'effects.md');
      for (const guidance of ['effect score', 'target clip/track', 'start/duration', 'Implement the selected accents', 'quieter holds', 'no fixed effect count', 'noRamp', 'Avoid flashes']) {
        assert.ok(effects.includes(guidance), `Effects reference lacks ${guidance}`);
      }

      const workflow = content('machinal-scenes', 'references', 'workflow.md');
      for (const guidance of ['signature visual action', '2D/Svelte', 'Three.js/SceneThree', 'actual meshes/materials/lights', 'Product/process', 'adjacent-shot continuity', 'a realistic 3D reconstruction without actual layers/assets', 'paid preview/re-render loops', 'Compilation/layout success does not prove']) {
        assert.ok(workflow.includes(guidance), `Scene direction lacks ${guidance}`);
      }
      assert.equal(content('machinal-recipes', 'references', 'jobs-scenes.md'), workflow);
    });
  }
});

test('every supported installation style has a real profile and valid catalog recommendations', async () => {
  const profiles = JSON.parse(await readFile(join(packageRoot, 'skills/machinal-editing/references/styles.json'), 'utf8'));
  const catalog = JSON.parse(await readFile(join(packageRoot, 'skills/machinal-recipes/references/catalog.v1.json'), 'utf8'));
  assert.deepEqual(EDITING_STYLES, profiles.map((profile) => profile.id));
  for (const name of ['cinematic', 'documentary', 'product', 'noir', 'retro', 'cyberpunk', 'dreamy', 'sports']) {
    assert.ok(EDITING_STYLES.includes(name));
  }
  for (const profile of profiles) {
    for (const category of ['looks', 'motions', 'effects', 'transitions', 'textPresets']) {
      for (const id of profile[category]) {
        assert.ok(catalog[category].some((entry) => entry.id === id), `${profile.id}: unknown ${category} ID ${id}`);
      }
    }
  }
});

test('every client receives YAML type and timeline preflight safeguards', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
      const recipes = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-recipes', 'SKILL.md'))).content;
      for (const guidance of ['after every edit', 'no error diagnostics or unresolved requirements', 'catalogVersion', 'compilerVersion', 'never numeric `1`', 'ad-hoc YAML emitter', 'outPoint = inPoint + timelineDuration * playbackRate', 'Never use paid rendering']) {
        assert.ok(recipes.includes(guidance), `${client} recipe skill lacks ${guidance}`);
      }
      const yaml = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-recipes', 'references', 'yaml.md'))).content;
      for (const guidance of ['Optional **string** compatibility pins', 'unlike numeric `version`', 'outPoint = inPoint + D * playbackRate', 'integer microseconds', 'ad-hoc JSON-to-YAML emitter', '`validate_recipe` after every edit', 'Any edit invalidates the previous check']) {
        assert.ok(yaml.includes(guidance), `${client} YAML reference lacks ${guidance}`);
      }
    });
  }
});

test('installed skills include scene guidance and complete offline examples, without needing the source repo at runtime', async (t) => {
  const cwd = await workspace(t);
  const bundle = await planSkills({ client: 'codex', scope: 'project', cwd, style: 'noir' });
  assert.ok(bundle.plans.some((plan) => plan.file.endsWith(join('machinal-scenes', 'SKILL.md'))));
  assert.ok(bundle.plans.some((plan) => plan.file.endsWith('scene-generation.yaml')));
  assert.ok(bundle.plans.some((plan) => plan.file.endsWith('scene-image-insert.yaml')));
  const spatial = bundle.plans.find((plan) => plan.file.endsWith('scene-three-explainer.yaml')).content;
  for (const content of ['visualMode: 3d', 'quarter-orbit', 'SceneThree', 'stable three-quarter view', 'No on-screen text']) {
    assert.ok(spatial.includes(content), `3D storyboard is missing ${content}`);
  }
  assert.ok(bundle.plans.some((plan) => plan.file.endsWith('catalog.v1.json')));
  assert.match(bundle.plans.find((plan) => plan.file.endsWith('preferences.md')).content, /\*\*noir\*\*/);
  const recipes = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-recipes', 'SKILL.md'))).content;
  assert.match(recipes, /get_editing_reference/);
  assert.match(recipes, /synthetic fixtures/);
  const scenes = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-scenes', 'SKILL.md'))).content;
  const authoring = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-scenes', 'references', 'authoring.md')))?.content;
  assert.ok(authoring, 'Current-client scene authoring guide must ship with every installation');
  for (const content of ['compile_scene', 'get_scene_source', 'current client', 'zero machinal credits', 'sourceFile']) {
    assert.ok(authoring.includes(content), `Client authoring guide is missing ${content}`);
  }
  assert.match(scenes, /CURRENT client AI/);
  assert.ok(bundle.plans.some((plan) => plan.file.endsWith('client-scene.yaml')));
  for (const content of ['beat sheet', 'Svelte', 'independently moving objects', 'scene-image-insert', 'no-generation', 'explicit authorization']) {
    assert.ok(scenes.includes(content), `Installed scene skill is missing ${content}`);
  }
  const workflow = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-scenes', 'references', 'workflow.md'))).content;
  assert.match(workflow, /Metadata alone is not visual inspection/);
  assert.match(workflow, /two paid stages/);
  const editing = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-editing', 'SKILL.md'))).content;
  assert.match(editing, /machinal-scenes/);
  assert.match(editing, /timeline start\/duration/);
});
