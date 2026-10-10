import { buildFixtures } from '../../server/tests/helpers/fixtures';

/** Reaproveita o gerador de mídias de teste do servidor (FFmpeg real). */
export default async function globalSetup() {
  await buildFixtures();
}
