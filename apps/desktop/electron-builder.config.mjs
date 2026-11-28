/** electron-builder configuration for the Future Cup desktop shell. */
export default {
  appId: 'com.ruirui.futurecup',
  productName: 'Future Cup',
  copyright: 'Copyright © 2026 Future Cup',
  directories: {
    output: 'release-final',
    buildResources: 'build',
  },
  files: [
    'lib/**/*',
    'renderer/**/*',
    'package.json',
  ],
  extraResources: [
    { from: 'runtime', to: 'runtime', filter: ['**/*'] },
  ],
  asar: true,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Future Cup',
    uninstallDisplayName: 'Future Cup',
  },
}
