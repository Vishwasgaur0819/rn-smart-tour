// Runs before `npm publish` (prepublishOnly). A prerelease (e.g. 2.0.0-beta.2) must go
// to the `next` dist-tag: published to `latest`, every `npm install rn-smart-tour`
// would get the beta. npm versions disagree on applying publishConfig.tag (it put
// 2.0.0 on `next`), so it is not used: pass --tag next for prereleases.
const { version, publishConfig = {} } = require('../package.json');
const tag = process.env.npm_config_tag || 'latest';

if (publishConfig.tag) {
  console.error(
    `\nRemove "publishConfig.tag" ("${publishConfig.tag}") from package.json: npm versions ` +
      'disagree on whether to apply it, so a stable release can silently go to the wrong tag.\n',
  );
  process.exit(1);
}

if (version.includes('-') && tag !== 'next') {
  console.error(
    `\nRefusing to publish prerelease ${version} with tag "${tag}".\n` +
      'Publish it with: npm publish --tag next\n',
  );
  process.exit(1);
}
if (!version.includes('-') && tag === 'next') {
  console.error(`\nRefusing to publish stable ${version} with tag "next". Use: npm publish\n`);
  process.exit(1);
}
