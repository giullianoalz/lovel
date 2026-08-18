import 'dotenv/config';
const ADMIN = 'lovelearningfl@gmail.com';
const BASE = 'http://localhost:4000/api/lesson-plans';
const ids = ["1adde3ac-9553-41dc-bdba-955d82dd0062","935b0dc2-f422-4d48-be3c-05f6e5d63431","e67b4716-507e-4b00-bf0e-e6b6e2a77568","8de89d8b-f687-4939-8eb7-1b4e6b4ecbde","a10a7287-3e6a-4615-98a2-9ffabc280859","a4c89d8e-7a15-4397-9283-a20287633d3e","fd399426-8e85-475a-ae17-4254dfaae1c7","58d236c4-1020-4d8f-b798-ecd51e251e1a","de54112b-9062-4d21-af49-c02b409d5302","c3edf412-0e43-4c4f-be30-2c02b8101d40","54d77cf4-9119-4ff6-97ce-ee38821eaf0e","123e2cda-1a3b-4b5e-b58d-7c92fd72271d","1f8e19ef-68ce-4958-876d-3ce869cf113e","6b2b1189-acea-476f-bcfa-4a601f95a6f2","5f7a72e8-2fb8-4ce4-8f52-cf8037ba1c98","4fcb89ab-d50d-42c5-a0f8-41a4c0e71017","fd089543-f941-45a3-b1bb-017829cb2463","ce200711-61eb-41fd-8819-b6591019c76f","3540cd64-ec3c-4fe1-82c1-68180cb438f3","f413cd5e-d530-4e58-8ccc-3df92d71cc9b","a00aeb89-cd6d-4e12-8d00-28c1c0150fb6","0164be66-de4c-46fd-9589-92c69a9dd1b1"];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ok = 0, failed = [];

for (const [i, id] of ids.entries()) {
  try {
    const regenRes = await fetch(`${BASE}/${id}/regenerate-summary`, {
      method: 'POST', headers: { 'x-dev-user-email': ADMIN },
    });
    const regen = await regenRes.json();
    if (!regenRes.ok || !regen.notesSummary) throw new Error(`regenerate HTTP ${regenRes.status}: ${JSON.stringify(regen)}`);

    const isFallback = regen.notesSummary.startsWith("This week's activity:");
    if (isFallback) throw new Error('AI still returned the fallback — leaving the plan untouched');

    const reviewRes = await fetch(`${BASE}/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-dev-user-email': ADMIN },
      body: JSON.stringify({ status: 'APPROVED', notesSummary: regen.notesSummary }),
    });
    const review = await reviewRes.json();
    if (!reviewRes.ok) throw new Error(`review HTTP ${reviewRes.status}: ${JSON.stringify(review)}`);

    console.log(`[${i + 1}/${ids.length}] OK   ${review.lessonPlan.class?.name} — "${regen.notesSummary.slice(0, 70)}..."`);
    ok++;
  } catch (e) {
    console.log(`[${i + 1}/${ids.length}] FAIL ${id} — ${e.message}`);
    failed.push(id);
  }
  await sleep(1500); // stay well clear of the free-tier rate limit
}

console.log(`\n──── fixed: ${ok}/${ids.length}  failed: ${failed.length} ────`);
if (failed.length) console.log('failed ids:', JSON.stringify(failed));
