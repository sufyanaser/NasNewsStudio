// Stamps the NAS icon and version info into the Windows exe with a pure-JS PE editor,
// so the Windows build also works from Linux/macOS (no wine/rcedit needed).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const { load } = require('resedit/cjs');
  const ResEdit = await load();
  const info = ctx.packager.appInfo;
  const exePath = path.join(ctx.appOutDir, `${info.productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icon.icons.map((i) => i.data));

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [major, minor, patch] = info.version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(major, minor, patch, 0, 1033);
  vi.setProductVersion(major, minor, patch, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: info.productName,
    FileDescription: info.productName,
    CompanyName: 'NAS FM 98.7',
    LegalCopyright: `© ${new Date().getFullYear()} NAS FM 98.7`,
    OriginalFilename: `${info.productFilename}.exe`,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • stamped icon + version info into ${path.basename(exePath)}`);
};
