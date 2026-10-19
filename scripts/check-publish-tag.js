// Runs before `npm publish` (prepublishOnly). A prerelease (e.g. 2.0.0-beta.2) must go
// to the `next` dist-tag: published to `latest`, every `npm install rn-smart-tour`
// would get the beta. npm 10 does not apply publishConfig.tag, so check explicitly.
const { version } = require('../package.json');
const tag = process.env.npm_config_tag || 'latest';

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
