// node render.js frames|all [video] [lang]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const S = require('./script.js');
const D = __dirname, TTS = '/tmp/claude-0/tts';
const mode = process.argv[2], only = process.argv[3], onlyLang = process.argv[4];
const VOICE = { ht: [`${TTS}/fr_FR-siwis-medium.onnx`, '1.0'], en: [`${TTS}/en_US-joe-medium.onnx`, '1.0'] };
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
const dur = (f) => Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const [vid, states] of Object.entries(S)) {
    if (only && only !== vid) continue;
    for (const lang of ['ht', 'en']) {
      if (onlyLang && onlyLang !== lang) continue;
      const dir = path.join(D, 'build', vid, lang); fs.mkdirSync(dir, { recursive: true });
      const parts = [];
      for (const [i, st] of states.entries()) {
        const n = String(i).padStart(2, '0');
        const capTxt = lang === 'ht' ? st.ht : st.en;
        await page.goto(`file://${D}/stage.html?lang=${lang}&v=${st.v}&cap=${encodeURIComponent(capTxt)}`);
        await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150);
        const jpg = `${dir}/${n}.jpg`;
        await page.screenshot({ path: jpg, type: 'jpeg', quality: 92 });
        if (mode === 'frames') continue;
        const wav = `${dir}/${n}.wav`;
        execFileSync('python3', ['-m', 'piper', '-m', VOICE[lang][0], '--length-scale', VOICE[lang][1], '-f', wav], { input: lang === 'ht' ? st.fr : st.en, stdio: ['pipe', 'ignore', 'ignore'] });
        const d = (dur(wav) + 0.75).toFixed(2);
        const tmp = `${dir}/${n}.tmp.mp4`, out = `${dir}/${n}.mp4`;
        sh('ffmpeg', ['-y', '-v', 'error', '-framerate', '30', '-i', jpg, '-i', wav,
          '-filter_complex', `[0:v]format=yuv420p,loop=-1:1,trim=duration=${d},fade=in:st=0:d=0.25,setpts=PTS-STARTPTS[v];[1:a]adelay=300|300,apad,atrim=duration=${d},aresample=44100,aformat=channel_layouts=stereo[a]`,
          '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp]);
        fs.renameSync(tmp, out); parts.push(out);
      }
      if (mode === 'frames') continue;
      const list = `${dir}/list.txt`; fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
      const final = path.join(D, 'out', `haiti-p2p-${vid}-${lang}.mp4`); fs.mkdirSync(path.dirname(final), { recursive: true });
      sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final + '.tmp.mp4']);
      fs.renameSync(final + '.tmp.mp4', final);
      console.log('done', final, dur(final).toFixed(1) + 's');
    }
  }
  await b.close();
})();
