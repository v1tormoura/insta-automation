/**
 * Diagnóstico do ambiente: `npm run doctor`.
 * Verifica Node, FFmpeg/FFprobe, encoders/filtros e o diretório de dados.
 */
import './silenceSqliteWarning';
import fs from 'node:fs';
import { loadConfig } from './config';
import { MediaTools } from './media/tools';

const ok = (m: string) => console.log(`  [ok]   ${m}`);
const bad = (m: string) => console.log(`  [FALHA] ${m}`);
const warn = (m: string) => console.log(`  [aviso] ${m}`);

async function main() {
  console.log('MediaForge — diagnóstico do ambiente\n');
  let failures = 0;
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major! > 22 || (major === 22 && minor! >= 13)) ok(`Node.js ${process.versions.node}`);
  else {
    bad(`Node.js ${process.versions.node} — é necessário 22.13 ou superior (módulo node:sqlite).`);
    failures++;
  }

  const config = loadConfig();
  const tools = new MediaTools(config.ffmpegPath, config.ffprobePath);
  await tools.detect();
  for (const t of [tools.ffmpeg, tools.ffprobe]) {
    if (t.available) ok(`${t.path} — versão ${t.version}`);
    else {
      bad(t.error ?? t.path);
      failures++;
    }
  }
  if (tools.ffmpeg.available) {
    const c = tools.capabilities;
    const list: Array<[keyof typeof c, string, boolean]> = [
      ['h264', 'libx264 (H.264)', true],
      ['aac', 'AAC', true],
      ['drawtext', 'filtro drawtext (textos)', true],
      ['hevc', 'libx265 (HEVC)', false],
      ['vp9', 'libvpx-vp9 (WebM)', false],
      ['opus', 'libopus (WebM)', false],
      ['av1', 'AV1 (libsvtav1/libaom)', false],
      ['mp3', 'libmp3lame (MP3)', false],
      ['webp', 'libwebp (WEBP)', false],
      ['subtitles', 'filtro subtitles/libass (legendas)', false],
      ['filterUnits', 'bitstream filter filter_units (remoção de SEI)', false],
    ];
    for (const [k, label, required] of list) {
      if (c[k]) ok(label);
      else if (required) {
        bad(`${label} ausente — use uma build "full" do FFmpeg.`);
        failures++;
      } else warn(`${label} ausente — o recurso correspondente ficará indisponível.`);
    }
  }
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.accessSync(config.dataDir, fs.constants.W_OK);
    ok(`Diretório de dados gravável: ${config.dataDir}`);
  } catch {
    bad(`Sem permissão de escrita em ${config.dataDir}`);
    failures++;
  }
  console.log(failures ? `\n${failures} problema(s) impedem o funcionamento.` : '\nAmbiente pronto.');
  process.exit(failures ? 1 : 0);
}

void main();
