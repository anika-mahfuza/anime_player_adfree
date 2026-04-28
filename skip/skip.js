import { getMegaplayTimestamps, toMMSS } from './megaplay-timestamps.js';

async function test() {
  // Example: Classroom of the Elite S1, episode 1
  const malId = '35507';
  const ep = '1';
  const lang = 'sub';

  const ts = await getMegaplayTimestamps(malId, ep, lang);
  console.log('Intro:', ts.introStart, `(${toMMSS(ts.introStart)})`, '→', ts.introEnd, `(${toMMSS(ts.introEnd)})`);
  console.log('Outro:', ts.outroStart, `(${toMMSS(ts.outroStart)})`, '→', ts.outroEnd, `(${toMMSS(ts.outroEnd)})`);
}

test().catch(console.error);