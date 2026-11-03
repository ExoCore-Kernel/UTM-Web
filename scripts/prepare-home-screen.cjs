// A static, removable iOS/iPadOS Web Clip. No device enrollment or server needed.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const iconPath = 'assets/Assets.xcassets/AppIcon.appiconset/Icon.png';
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function writeProfile(output = path.join(root, 'UTM.mobileconfig'), appURL) {
  const repository = process.env.GITHUB_REPOSITORY || 'ExoCore-Kernel/UTM-Web';
  const [owner, name] = repository.split('/');
  const defaultURL = `https://${owner.toLowerCase()}.github.io/${name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : name + '/'}`;
  const url = new URL(appURL || process.env.UTM_APP_URL || defaultURL);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The home-screen profile needs an HTTPS app URL without credentials.');
  url.hash = '';
  const digest = createHash('sha256').update(url.href).digest('hex');
  const uuid = suffix => {
    const value = createHash('sha256').update(url.href + suffix).digest('hex').slice(0, 32);
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`.toUpperCase();
  };
  const identifier = `io.github.utm-web.${digest.slice(0, 16)}`;
  const icon = fs.readFileSync(path.join(root, iconPath)).toString('base64').match(/.{1,76}/g).join('\n');
  const profile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>${identifier}</string>
<key>PayloadUUID</key><string>${uuid('profile')}</string>
<key>PayloadDisplayName</key><string>UTM</string>
<key>PayloadDescription</key><string>Adds UTM to your Home Screen.</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.apple.webClip.managed</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>${identifier}.webclip</string>
<key>PayloadUUID</key><string>${uuid('webclip')}</string>
<key>PayloadDisplayName</key><string>UTM</string>
<key>Label</key><string>UTM</string>
<key>URL</key><string>${xml(url.href)}</string>
<key>FullScreen</key><true/>
<key>IsRemovable</key><true/>
<key>Precomposed</key><true/>
<key>Icon</key><data>
${icon}
</data>
</dict></array>
</dict></plist>
`;
  fs.writeFileSync(output, profile);
  return url.href;
}
module.exports = { writeProfile };
if (require.main === module) console.log(`UTM.mobileconfig ready for ${writeProfile()}`);
