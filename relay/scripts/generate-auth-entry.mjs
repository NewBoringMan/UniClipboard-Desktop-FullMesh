import { createHash, randomBytes } from 'node:crypto';

const spaceId = randomBytes(24).toString('base64url');
const token = randomBytes(32).toString('base64url');
const tokenSha256 = createHash('sha256').update(token).digest('hex');

process.stdout.write(
  `${JSON.stringify(
    {
      client: { spaceId, token },
      serverDocument: {
        schemaVersion: 2,
        spaces: { [spaceId]: { tokenSha256 } },
      },
    },
    null,
    2,
  )}\n`,
);
