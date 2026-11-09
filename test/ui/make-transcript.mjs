// Writes a plausible transcript.json for the demo recording (stand-in for Whisper output).
import fs from 'node:fs'
const text = `So here's our payments dashboard. Let me um open the payments page first. Now I'll create a new invoice for Kofi. I'll type his email, add the amount, and uh send it. And that's it, the invoice is on its way.`
const words = text.split(' ')
const spans = [
  [0.6, 3.0],
  [3.1, 6.2],
  [6.4, 8.4],
  [8.6, 11.6],
  [12.9, 14.4]
]
const groups = [6, 7, 7, 13, 8]
let k = 0
const out = []
groups.forEach((n, g) => {
  const [a, b] = spans[g]
  const step = (b - a) / n
  for (let i = 0; i < n && k < words.length; i++, k++)
    out.push({ text: ' ' + words[k], start: +(a + i * step).toFixed(2), end: +(a + (i + 0.8) * step).toFixed(2) })
})
fs.writeFileSync(process.argv[2], JSON.stringify({ version: 1, model: 'demo', createdAt: Date.now(), words: out }))
console.log(out.length, 'words')
