import { buildFixtures } from './helpers/fixtures';

export default async function setup() {
  process.env.MEDIAFORGE_SKIP_ENV_FILE = '1';
  await buildFixtures();
}
